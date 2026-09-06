/**
 * Renders the app icons from one SVG source.
 *
 * Android requires PNG at 192 and 512 for installability, plus a maskable
 * variant — without maskable padding the launcher crops a circle out of the
 * icon and clips the mark.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(root, "public/icons");

/** The lens and its pivot point — the same orange the skeleton overlay uses. */
function svg({ padding }) {
  const s = 512;
  const c = s / 2;
  const r = (s / 2 - padding) * 0.62;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}">
  <rect width="${s}" height="${s}" fill="#0a0a0a"/>
  <circle cx="${c}" cy="${c}" r="${r}" fill="none" stroke="#38bdf8" stroke-width="${r * 0.16}"/>
  <circle cx="${c}" cy="${c}" r="${r * 0.34}" fill="#f97316"/>
  <path d="M ${c - r * 1.24} ${c} A ${r * 1.24} ${r * 1.24} 0 0 1 ${c + r * 1.24} ${c}"
        fill="none" stroke="#ffffff" stroke-opacity="0.85" stroke-width="${r * 0.1}" stroke-linecap="round"/>
</svg>`;
}

await mkdir(OUT, { recursive: true });

const targets = [
  { name: "icon-192.png", size: 192, padding: 0 },
  { name: "icon-512.png", size: 512, padding: 0 },
  // Maskable icons are cropped to a circle inscribed in ~80% of the canvas.
  { name: "icon-maskable-512.png", size: 512, padding: 96 },
  { name: "apple-touch-icon.png", size: 180, padding: 0 },
];

for (const { name, size, padding } of targets) {
  const png = await sharp(Buffer.from(svg({ padding }))).resize(size, size).png().toBuffer();
  await writeFile(join(OUT, name), png);
  console.log(`✓ ${name} (${size}px, ${(png.length / 1024).toFixed(1)}kB)`);
}
