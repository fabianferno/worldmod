/**
 * Episode submission.
 *
 * Accepts a multipart upload — the sealed manifest plus the stream bytes it
 * describes — verifies integrity from the bytes that arrived, and returns
 * immediately. Scoring happens afterwards, in the background.
 *
 * That split is not a convenience. Scoring a fifteen-second episode takes over
 * a minute: every sampled frame is decoded, hands are detected across the take
 * and optical flow is solved between consecutive pairs. Holding an upload open
 * for that would strand a phone on a mobile connection and lose the bytes if it
 * timed out. product-spec §10.1 draws the validator as its own box for the same
 * reason.
 *
 * Nothing the client asserts about quality is taken on trust — it owns the
 * device. The server recomputes every hash on arrival and every score after.
 */

import { storeStream } from "@/lib/market/blobs";
import { fileStore } from "@/lib/market/store";
import type { EpisodeSubmission } from "@/lib/market/types";
import type { Manifest } from "@/lib/manifest";
import { scoreEpisode } from "@/lib/validator/score";
import { validateEpisode, type StreamBytes } from "@/lib/validator/validate";
import type { EpisodeFingerprint } from "@/lib/validator/duplicate";

/** Video is a few MB; refuse anything that could not plausibly be an episode. */
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export async function GET(request: Request) {
  const bountyId = new URL(request.url).searchParams.get("bounty") ?? undefined;
  return Response.json({ episodes: await fileStore.listEpisodes(bountyId) });
}

/**
 * Score in the background and record the outcome.
 *
 * Deliberately not awaited by the request. Any failure is written to the
 * episode rather than thrown into a void, so a stuck upload is visible as a
 * failed episode instead of one that sits in "scoring" forever.
 */
async function scoreInBackground(
  episodeId: string,
  submission: EpisodeSubmission,
  manifest: Manifest,
  streams: StreamBytes[],
  requiredModalities: readonly string[],
  durationRange: readonly [number, number],
): Promise<void> {
  try {
    const video = streams.find((s) => s.kind === "rgb");
    const imu = streams.find((s) => s.kind === "imu");
    if (!video) throw new Error("No video stream was uploaded, so nothing can be scored.");

    const scores = await scoreEpisode(video.bytes, imu?.bytes ?? new Uint8Array());

    const prior: EpisodeFingerprint[] = (await fileStore.listEpisodes())
      .filter((e) => e.episode_id !== episodeId && e.signature?.length)
      .map((e) => ({
        episode_id: e.episode_id,
        entity_id: e.entity_id,
        signature: e.signature ?? [],
      }));

    // The manifest carries the client's advisory scores; the validator is given
    // the server's, so what it checks is what the server measured.
    const scored: Manifest = {
      ...manifest,
      quality: {
        framing_percent: scores.framing.percent,
        framing_verdict: scores.framing.verdict,
        plausibility_percent: scores.plausibility.percent,
        plausibility_verdict: scores.plausibility.verdict,
        motion_rms_deg_per_sec: scores.plausibility.motionRmsDegPerSec,
        frames_analyzed: scores.framesAnalyzed,
        signature: scores.signature,
        trust_level: "heuristic",
      },
    };

    const validation = await validateEpisode({
      manifest: scored,
      streams,
      requiredModalities,
      durationRangeS: durationRange,
      fingerprint: {
        episode_id: episodeId,
        entity_id: submission.entity_id,
        signature: scores.signature,
      },
      priorFingerprints: prior,
    });

    // The manifest hash covers the CLIENT's manifest, so re-verify against that
    // one rather than the copy carrying server scores.
    validation.checks.manifest_intact = (
      await validateEpisode({
        manifest,
        streams,
        requiredModalities,
        durationRangeS: durationRange,
      })
    ).checks.manifest_intact;

    await fileStore.completeScoring(
      episodeId,
      {
        framing: scores.framing.percent === null ? null : scores.framing.percent / 100,
        plausibility:
          scores.plausibility.percent === null ? null : scores.plausibility.percent / 100,
        hands_visible_percent: scores.framing.visibilityPercent,
        signature: scores.signature,
      },
      validation,
    );
  } catch (err) {
    await fileStore.failScoring(episodeId, err instanceof Error ? err.message : String(err));
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      { error: "Episodes must be uploaded as multipart/form-data with their streams." },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const manifestRaw = form.get("manifest");
  const submissionRaw = form.get("submission");

  if (typeof manifestRaw !== "string" || typeof submissionRaw !== "string") {
    return Response.json({ error: "manifest and submission fields are required." }, { status: 400 });
  }

  let manifest: Manifest;
  let submission: EpisodeSubmission;
  try {
    manifest = JSON.parse(manifestRaw) as Manifest;
    submission = JSON.parse(submissionRaw) as EpisodeSubmission;
  } catch {
    return Response.json({ error: "manifest or submission is not valid JSON." }, { status: 400 });
  }

  if (!submission.episode_id || !submission.bounty_id || !submission.manifest_hash) {
    return Response.json(
      { error: "episode_id, bounty_id and manifest_hash are required." },
      { status: 400 },
    );
  }
  if (!/^0x[0-9a-f]{64}$/.test(submission.manifest_hash)) {
    return Response.json({ error: "manifest_hash is not a SHA-256 digest." }, { status: 400 });
  }

  const bounty = await fileStore.getBounty(submission.bounty_id);
  if (!bounty) return Response.json({ error: "No such bounty." }, { status: 404 });

  const declared = (manifest.streams ?? {}) as Record<string, { sha256: string }>;
  const streams: StreamBytes[] = [];
  let total = 0;

  for (const [kind, meta] of Object.entries(declared)) {
    const part = form.get(kind);
    if (!(part instanceof Blob)) continue;

    total += part.size;
    if (total > MAX_UPLOAD_BYTES) {
      return Response.json({ error: "Upload exceeds the size limit." }, { status: 413 });
    }
    streams.push({ kind, sha256: meta.sha256, bytes: new Uint8Array(await part.arrayBuffer()) });
  }

  if (streams.length === 0) {
    return Response.json({ error: "No stream bytes were uploaded." }, { status: 400 });
  }

  // Integrity is checked before anything is stored: bytes that do not match
  // the commitment should never reach disk.
  const integrity = await validateEpisode({
    manifest,
    streams,
    requiredModalities: bounty.required_modalities,
    durationRangeS: bounty.duration_range_s,
  });

  if (!integrity.checks.manifest_intact || !integrity.checks.streams_intact) {
    return Response.json(
      { error: "Integrity check failed.", failures: integrity.failures },
      { status: 422 },
    );
  }

  const stored = [];
  for (const stream of streams) {
    stored.push(await storeStream(submission.episode_id, stream.kind, stream.bytes));
  }

  try {
    const episode = await fileStore.acceptUpload({ ...submission, signature: [] }, stored);

    // Fire and forget: the wearer gets their phone back, and the result appears
    // when the validator is done.
    void scoreInBackground(
      submission.episode_id,
      submission,
      manifest,
      streams,
      bounty.required_modalities,
      bounty.duration_range_s,
    );

    return Response.json({ episode }, { status: 202 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
