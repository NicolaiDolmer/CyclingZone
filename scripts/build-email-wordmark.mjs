// Builds frontend/public/brand/wordmark-email.png: the retina (2x) raster of
// the canonical Cycling Zone wordmark used in the navy band of the
// transactional emails (backend/lib/emailTemplates.js, #2853).
//
// Why a PNG and not the SVG we already host: Gmail, Outlook.com and the
// Outlook apps all refuse <img src="*.svg">, so an email needs a raster. Why a
// baked-in navy plate instead of transparency: Outlook.com's dark mode
// rewrites background colours behind the image, and a transparent gold mark
// would then sit on whatever grey it picked. The plate is the exact band navy
// (#1B2A4A), so the seam is invisible when the band renders correctly and the
// mark stays on brand when it does not.
//
// Source of truth is frontend/public/brand/wordmark-ondark.svg — this script
// only crops its padding away and rasterises it, it never redraws the mark.
// Run from the repo root: node scripts/build-email-wordmark.mjs

import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(repoRoot, "frontend/public/brand/wordmark-ondark.svg");
const TARGET = path.join(repoRoot, "frontend/public/brand/wordmark-email.png");

// The source art is drawn in a 480x140 box with generous padding. The ink
// (glyphs + rule + accent dash) lives in x 60..420, y 25..106; this crop keeps
// a hair of breathing room on every side and lands on an exact 4.2:1 box.
// DISPLAY_* is the CSS size the email asks for; the file itself is written at
// 2x so it stays sharp on retina.
const CROP = { x: 52, y: 20, width: 378, height: 90 };
const DISPLAY_HEIGHT = 22;
const DISPLAY_WIDTH = Math.round((CROP.width / CROP.height) * DISPLAY_HEIGHT);
const BAND_NAVY = "#1B2A4A";

const source = readFileSync(SOURCE, "utf8");
const inner = source.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const cropped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CROP.x} ${CROP.y} ${CROP.width} ${CROP.height}">
  <rect x="${CROP.x}" y="${CROP.y}" width="${CROP.width}" height="${CROP.height}" fill="${BAND_NAVY}"/>
  ${inner}
</svg>`;

const png = await sharp(Buffer.from(cropped), { density: 600 })
  .resize({ width: DISPLAY_WIDTH * 2 })
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();

writeFileSync(TARGET, png);
const meta = await sharp(png).metadata();
console.log(
  `wrote ${TARGET} (${meta.width}x${meta.height}px file, ${png.length} bytes, ` +
    `display ${DISPLAY_WIDTH}x${DISPLAY_HEIGHT})`
);
