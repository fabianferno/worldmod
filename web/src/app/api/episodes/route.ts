/**
 * Episode submission.
 *
 * Accepts a multipart upload: the sealed manifest plus the stream bytes it
 * describes. The bytes matter — without them the validator can check that a
 * manifest is internally consistent but nothing about whether it describes
 * real data, and product-spec §6.1's integrity claim would begin at the
 * client's word rather than at the bytes.
 *
 * Nothing the client asserts about quality is taken on trust. The server
 * recomputes every hash from what arrived, re-derives the manifest hash, and
 * runs the duplicate check against prior submissions.
 */

import { fileStore } from "@/lib/market/store";
import { storeStream } from "@/lib/market/blobs";
import type { EpisodeSubmission } from "@/lib/market/types";
import type { Manifest } from "@/lib/manifest";
import { validateEpisode, type StreamBytes } from "@/lib/validator/validate";
import type { EpisodeFingerprint } from "@/lib/validator/duplicate";

/** Video is a few MB; refuse anything that could not plausibly be an episode. */
const MAX_UPLOAD_BYTES = 80 * 1024 * 1024;

export async function GET(request: Request) {
  const bountyId = new URL(request.url).searchParams.get("bounty") ?? undefined;
  return Response.json({ episodes: await fileStore.listEpisodes(bountyId) });
}

export async function POST(request: Request) {
  const contentType = request.headers.get("content-type") ?? "";

  let manifest: Manifest;
  let submission: EpisodeSubmission;
  const streams: StreamBytes[] = [];

  if (contentType.includes("multipart/form-data")) {
    const form = await request.formData();

    const manifestRaw = form.get("manifest");
    const submissionRaw = form.get("submission");
    if (typeof manifestRaw !== "string" || typeof submissionRaw !== "string") {
      return Response.json(
        { error: "manifest and submission fields are required." },
        { status: 400 },
      );
    }

    try {
      manifest = JSON.parse(manifestRaw) as Manifest;
      submission = JSON.parse(submissionRaw) as EpisodeSubmission;
    } catch {
      return Response.json({ error: "manifest or submission is not valid JSON." }, { status: 400 });
    }

    const declared = (manifest.streams ?? {}) as Record<string, { sha256: string }>;
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
  } else {
    // Manifest-only submission. Accepted, but it cannot be integrity-checked
    // and the validator says so rather than silently scoring it as verified.
    try {
      const body = (await request.json()) as { manifest?: Manifest; submission?: EpisodeSubmission };
      if (!body.manifest || !body.submission) {
        return Response.json({ error: "manifest and submission are required." }, { status: 400 });
      }
      manifest = body.manifest;
      submission = body.submission;
    } catch {
      return Response.json({ error: "Body must be JSON or multipart/form-data." }, { status: 400 });
    }
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

  // Compare against what has already been submitted, not just this bounty:
  // the same footage resubmitted under a different bounty is still the same
  // footage.
  const priorFingerprints: EpisodeFingerprint[] = (await fileStore.listEpisodes())
    .filter((e) => e.signature?.length)
    .map((e) => ({
      episode_id: e.episode_id,
      entity_id: e.entity_id,
      signature: e.signature ?? [],
    }));

  const quality = manifest.quality as { signature?: string[] } | undefined;
  const signature = quality?.signature ?? [];

  const validation = await validateEpisode({
    manifest,
    streams,
    requiredModalities: bounty.required_modalities,
    durationRangeS: bounty.duration_range_s,
    fingerprint: signature.length
      ? { episode_id: submission.episode_id, entity_id: submission.entity_id, signature }
      : undefined,
    priorFingerprints,
  });

  // Persist bytes only once they have been verified against the commitment.
  const stored = [];
  if (validation.checks.streams_intact) {
    for (const stream of streams) {
      stored.push(await storeStream(submission.episode_id, stream.kind, stream.bytes));
    }
  }

  try {
    const episode = await fileStore.submitEpisode({ ...submission, signature }, validation, stored);
    return Response.json({ episode, validation }, { status: 201 });
  } catch (err) {
    return Response.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 400 },
    );
  }
}
