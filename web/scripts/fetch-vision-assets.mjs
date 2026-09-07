/**
 * Fetches the hand-tracking models the capture page needs.
 *
 * These run on the TensorFlow.js runtime that optical flow already loads, so
 * hand tracking adds model weights and no second runtime. The earlier
 * MediaPipe Tasks approach shipped its own ~34MB WASM build alongside TFJS —
 * two tensor runtimes doing the same class of work on a phone.
 *
 * Models are self-hosted rather than fetched from tfhub at runtime: the demo
 * cannot depend on network reachability at the moment it runs, tfhub.dev is
 * deprecated in favour of Kaggle and may move again, and a strict CSP would
 * block the cross-origin fetch anyway.
 *
 * Idempotent, so it is cheap to run on every dev and build.
 */

import { mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const DEST = join(root, "public/models/hand");

const BASE = "https://tfhub.dev/mediapipe/tfjs-model/handpose_3d";

/** The lite variants. Full costs several times the bytes for accuracy this does not need. */
const MODELS = [
  { name: "detector", url: `${BASE}/detector/lite/1` },
  { name: "landmark", url: `${BASE}/landmark/lite/1` },
];

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function download(url, dest) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`HTTP ${response.status} for ${url}`);
  const bytes = Buffer.from(await response.arrayBuffer());
  await writeFile(dest, bytes);
  return bytes.length;
}

/**
 * Guard against a silent 200 that is actually HTML. A truncated shard passes
 * every check until TFJS tries to read tensors out of it.
 */
async function assertRealWeights(dir, manifest, shards) {
  const declared = manifest.weightsManifest
    .flatMap((group) => group.weights)
    .reduce((acc, w) => {
      const count = (w.shape ?? []).reduce((a, b) => a * b, 1);
      const bytes = w.quantization ? (w.quantization.dtype === "uint16" ? 2 : 1) : 4;
      return acc + count * bytes;
    }, 0);

  let onDisk = 0;
  for (const shard of shards) onDisk += (await stat(join(dir, shard))).size;

  if (onDisk < declared * 0.9) {
    throw new Error(
      `Weights for ${dir} are ${onDisk} bytes but the manifest declares ~${declared}. ` +
        "The download probably returned an HTML page instead of the shard.",
    );
  }
}

async function mirror({ name, url }) {
  const dir = join(DEST, name);
  const modelJson = join(dir, "model.json");

  if (await exists(modelJson)) {
    console.log(`• ${name} model already present`);
    return 0;
  }

  await mkdir(dir, { recursive: true });

  let total = await download(`${url}/model.json?tfjs-format=file`, modelJson);

  // Weight shards are named by the manifest and must sit beside model.json.
  const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(modelJson, "utf8"));
  const shards = manifest.weightsManifest.flatMap((group) => group.paths);

  // The tfjs-format param is required on shards too. Without it tfhub
  // serves a Kaggle HTML landing page with a 200, which lands on disk as a
  // 5KB 'weights' file and fails only later, at model load.
  for (const shard of shards) {
    total += await download(`${url}/${shard}?tfjs-format=file`, join(dir, shard));
  }

  await assertRealWeights(dir, manifest, shards);

  console.log(`✓ ${name}: model.json + ${shards.length} shard(s), ${(total / 1e6).toFixed(2)}MB`);
  return total;
}

let total = 0;
for (const model of MODELS) total += await mirror(model);
if (total > 0) console.log(`  total ${(total / 1e6).toFixed(2)}MB`);
