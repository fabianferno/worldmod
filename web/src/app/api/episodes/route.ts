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
import { validatorAddress } from "@/lib/chain/relay";
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
    if (!video)
      throw new Error(
        "No video stream was uploaded, so nothing can be scored.",
      );

    const scores = await scoreEpisode(
      video.bytes,
      imu?.bytes ?? new Uint8Array(),
    );

    const prior: EpisodeFingerprint[] = (await fileStore.listEpisodes())
      .filter((e) => e.episode_id !== episodeId && e.signature?.length)
      .map((e) => ({
        episode_id: e.episode_id,
        entity_id: e.entity_id,
        signature: e.signature ?? [],
      }));

    // The manifest goes in exactly as the phone sealed it, and the measured
    // scores go in beside it. Injecting them into the manifest instead would
    // change the bytes the hash covers, and the integrity check would fail on
    // every honest episode — which is precisely what it used to do.
    const validation = await validateEpisode({
      manifest,
      streams,
      scores: {
        framingPercent: scores.framing.percent,
        plausibilityPercent: scores.plausibility.percent,
      },
      requiredModalities,
      durationRangeS: durationRange,
      validator: validatorAddress(),
      fingerprint: {
        episode_id: episodeId,
        entity_id: submission.entity_id,
        signature: scores.signature,
      },
      priorFingerprints: prior,
    });

    await fileStore.completeScoring(
      episodeId,
      {
        framing:
          scores.framing.percent === null ? null : scores.framing.percent / 100,
        plausibility:
          scores.plausibility.percent === null
            ? null
            : scores.plausibility.percent / 100,
        hands_visible_percent: scores.framing.visibilityPercent,
        signature: scores.signature,
      },
      validation,
    );
  } catch (err) {
    await fileStore.failScoring(
      episodeId,
      err instanceof Error ? err.message : String(err),
    );
  }
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("multipart/form-data")) {
    return Response.json(
      {
        error:
          "Episodes must be uploaded as multipart/form-data with their streams.",
      },
      { status: 400 },
    );
  }

  const form = await request.formData();
  const manifestRaw = form.get("manifest");
  const submissionRaw = form.get("submission");

  if (typeof manifestRaw !== "string" || typeof submissionRaw !== "string") {
    return Response.json(
      { error: "manifest and submission fields are required." },
      { status: 400 },
    );
  }

  let manifest: Manifest;
  let submission: EpisodeSubmission;
  try {
    manifest = JSON.parse(manifestRaw) as Manifest;
    submission = JSON.parse(submissionRaw) as EpisodeSubmission;
  } catch {
    return Response.json(
      { error: "manifest or submission is not valid JSON." },
      { status: 400 },
    );
  }

  if (
    !submission.episode_id ||
    !submission.bounty_id ||
    !submission.manifest_hash
  ) {
    return Response.json(
      { error: "episode_id, bounty_id and manifest_hash are required." },
      { status: 400 },
    );
  }
  if (!/^0x[0-9a-f]{64}$/.test(submission.manifest_hash)) {
    return Response.json(
      { error: "manifest_hash is not a SHA-256 digest." },
      { status: 400 },
    );
  }

  const bounty = await fileStore.getBounty(submission.bounty_id);
  if (!bounty)
    return Response.json({ error: "No such bounty." }, { status: 404 });

  const declared = (manifest.streams ?? {}) as Record<
    string,
    { sha256: string; content_type?: string }
  >;
  const streams: StreamBytes[] = [];
  // The container each stream was recorded in, as sealed in the manifest, so
  // an MP4 from an iPhone is not later served as though it were WebM.
  const containers = new Map<string, string | undefined>();
  let total = 0;

  for (const [kind, meta] of Object.entries(declared)) {
    const part = form.get(kind);
    if (!(part instanceof Blob)) continue;

    total += part.size;
    if (total > MAX_UPLOAD_BYTES) {
      return Response.json(
        { error: "Upload exceeds the size limit." },
        { status: 413 },
      );
    }
    streams.push({
      kind,
      sha256: meta.sha256,
      bytes: new Uint8Array(await part.arrayBuffer()),
    });
    containers.set(kind, meta.content_type);
  }

  if (streams.length === 0) {
    return Response.json(
      { error: "No stream bytes were uploaded." },
      { status: 400 },
    );
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
    stored.push(
      await storeStream(
        submission.episode_id,
        stream.kind,
        stream.bytes,
        containers.get(stream.kind),
      ),
    );
  }

  try {
    const episode = await fileStore.acceptUpload(
      { ...submission, signature: [] },
      stored,
    );

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
