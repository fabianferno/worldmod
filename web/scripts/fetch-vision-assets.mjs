/**
 * Fetches the vision runtime assets the capture page needs.
 *
 * These are ~42MB of binaries and are deliberately not committed. They are
 * self-hosted rather than loaded from a CDN because the demo cannot depend on
 * network reachability at the moment it runs, and a strict CSP would block a
 * CDN anyway.
 *
 * Idempotent: existing files are left alone, so this is cheap to run on every
 * dev and build.
 */

import { cp, mkdir, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const WASM_SRC = join(root, "node_modules/@mediapipe/tasks-vision/wasm");
const WASM_DEST = join(root, "public/mediapipe/wasm");

const MODEL_DEST = join(root, "public/models/hand_landmarker.task");
const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task";

async function exists(path) {
  try {
    await stat(path);
    return true;
  } catch {
    return false;
  }
}

async function copyWasm() {
  if (await exists(join(WASM_DEST, "vision_wasm_internal.wasm"))) {
    console.log("• MediaPipe WASM already present");
    return;
  }
  if (!(await exists(WASM_SRC))) {
    throw new Error(
      "@mediapipe/tasks-vision is not installed; run npm install before this script.",
    );
  }
  await mkdir(WASM_DEST, { recursive: true });
  await cp(WASM_SRC, WASM_DEST, { recursive: true });
  console.log("✓ Copied MediaPipe WASM from node_modules");
}

async function fetchModel() {
  if (await exists(MODEL_DEST)) {
    console.log("• Hand landmarker model already present");
    return;
  }
  await mkdir(dirname(MODEL_DEST), { recursive: true });

  console.log("… Downloading hand landmarker model (~7.8MB)");
  const response = await fetch(MODEL_URL);
  if (!response.ok) {
    throw new Error(`Model download failed: HTTP ${response.status}`);
  }
  await writeFile(MODEL_DEST, Buffer.from(await response.arrayBuffer()));
  console.log("✓ Downloaded hand landmarker model");
}

await copyWasm();
await fetchModel();
