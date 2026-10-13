#!/usr/bin/env node
/**
 * PWA icon set (#6584): regenerates frontend/public/icons/ from the brand monogram.
 *
 * Source of truth is frontend/public/favicon.svg (the outlined CZ monogram on the
 * brand yellow). Nothing here is drawn by hand: the glyph paths are read from that
 * file, so a brand change to the favicon flows into every app icon on the next run.
 *
 *   node scripts/generate-pwa-icons.mjs
 *
 * Writes:
 *   icon-<size>.png         purpose "any": the favicon as is (rounded yellow square)
 *   maskable-<size>.png     purpose "maskable": full-bleed yellow, glyph inside the
 *                           80 % safe circle so Android's circle/squircle mask never
 *                           cuts a letter
 *   monochrome-512.png      purpose "monochrome": glyph alpha only (Android 13+
 *                           themed icons tint it)
 *   shortcut-<name>.png     96 px icons for the manifest shortcuts, built from the
 *                           same stroke icons the app uses (components/ui/icons)
 *
 * Requires the root devDependency sharp (same as scripts/brand-export.mjs).
 */
import sharp from "sharp";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const FAVICON = path.join(ROOT, "frontend", "public", "favicon.svg");
const OUT_DIR = path.join(ROOT, "frontend", "public", "icons");

// Brand tokens (frontend/src/index.css: --accent 232 197 71 and the dark canvas
// --bg-body #0e0f15). Raw hex is fine here: this is a brand rasterizer, not UI.
const YELLOW = "#e8c547";
const INK = "#0e0f15";

export const ANY_SIZES = [48, 72, 96, 128, 144, 152, 192, 256, 384, 512];
export const MASKABLE_SIZES = [192, 512];
// Glyph scale inside the maskable canvas. The monogram spans ~22 of 32 units;
// at 0.72 it is ~50 % of the width, well inside the 80 % safe-zone circle.
const MASKABLE_GLYPH_SCALE = 0.72;

// Stroke icons copied path-for-path from frontend/src/components/ui/icons/index.jsx
// (GavelIcon, FlagIcon, JerseyIcon) so a shortcut looks like its nav item.
export const SHORTCUT_ICONS = {
  auctions: [
    "M14 13l-7.5 7.5a2.12 2.12 0 0 1-3-3L11 10",
    "M9 8l6 6",
    "M13 4l7 7",
    "M16 5l3 3",
    "M4 22h8",
  ],
  "race-centre": ["M5 21V4", "M5 5h13l-2.5 4 2.5 4H5z", "M5 9h11M11.5 5v8"],
  team: ["M8 4L3 9l2.5 2.5L7 10v10h10V10l1.5 1.5L21 9l-5-5a4 4 0 0 1-8 0z"],
};

/** The <path> elements of the monogram, without their fill wrapper. */
export function extractGlyphPaths(faviconSvg) {
  const paths = faviconSvg.match(/<path\b[^>]*\/>/g);
  if (!paths || paths.length === 0) throw new Error("favicon.svg has no <path> glyphs, has the master moved?");
  return paths.join("");
}

function glyphGroup(glyphs, { scale, fill }) {
  // Scale around the canvas centre (16,16) of the 32-unit favicon grid.
  const offset = 16 - 16 * scale;
  return `<g transform="translate(${offset} ${offset}) scale(${scale})" fill="${fill}">${glyphs}</g>`;
}

export function maskableSvg(glyphs) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" fill="${YELLOW}"/>${glyphGroup(glyphs, { scale: MASKABLE_GLYPH_SCALE, fill: INK })}</svg>`;
}

export function monochromeSvg(glyphs) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">${glyphGroup(glyphs, { scale: MASKABLE_GLYPH_SCALE, fill: "#ffffff" })}</svg>`;
}

export function shortcutSvg(paths) {
  // 24-unit icon grid centred in a 48-unit canvas at 1x: icon = 50 % of the tile,
  // which keeps it inside the circle Android draws shortcut icons in.
  const strokes = paths.map((d) => `<path d="${d}"/>`).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48"><rect width="48" height="48" fill="${YELLOW}"/><g transform="translate(12 12)" fill="none" stroke="${INK}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${strokes}</g></svg>`;
}

async function rasterize(svg, size, file) {
  const buf = await sharp(Buffer.from(svg), { density: Math.max(72, size * 3) })
    .resize(size, size, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await writeFile(path.join(OUT_DIR, file), buf);
  return file;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const favicon = await readFile(FAVICON, "utf8");
  const glyphs = extractGlyphPaths(favicon);
  const written = [];
  for (const size of ANY_SIZES) written.push(await rasterize(favicon, size, `icon-${size}.png`));
  for (const size of MASKABLE_SIZES) written.push(await rasterize(maskableSvg(glyphs), size, `maskable-${size}.png`));
  written.push(await rasterize(monochromeSvg(glyphs), 512, "monochrome-512.png"));
  for (const [name, paths] of Object.entries(SHORTCUT_ICONS)) {
    written.push(await rasterize(shortcutSvg(paths), 96, `shortcut-${name}.png`));
  }
  console.log(`generate-pwa-icons: ${written.length} files in ${path.relative(ROOT, OUT_DIR)}`);
}

if (import.meta.url === `file://${process.argv[1]}` || process.argv[1]?.endsWith("generate-pwa-icons.mjs")) {
  await main();
}
