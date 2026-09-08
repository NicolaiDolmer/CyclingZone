// Builds frontend/public/brand/wordmark-email.<hash>.png: the retina (2x)
// raster of the canonical Cycling Zone wordmark used in the navy band of the
// transactional emails (backend/lib/emailTemplates.js, #2853), plus the
// generated backend/lib/emailWordmarkAsset.js that names the current file.
//
// Why the content hash in the filename (fundet 8/9): PR #5045 made the mark
// transparent, prod served the new bytes, and Outlook still showed the old
// image — the URL was unchanged and Vercel serves /brand/* with
// `Cache-Control: public, max-age=604800`, so the mail clients' image proxies
// kept their week-old copy. Assets referenced from email have to be immutable
// URLs: new pixels means a new filename, and an already-sent mail keeps
// pointing at exactly the image it was composed with.
//
// Why a PNG and not the SVG we already host: Gmail, Outlook.com and the
// Outlook apps all refuse <img src="*.svg">, so an email needs a raster. Why
// transparent and not a baked-in navy plate: an earlier version baked in the
// exact band navy (#1B2A4A) so the mark would keep its own background if a
// client repainted the band. Outlook on Windows dark mode does exactly that —
// but it repaints the band to a slate grey while the *image* still has the
// old navy baked in, so the plate showed up as a visible dark square sitting
// on top of the lighter slate band (owner report 8/9, screenshot: gold mark
// on a grey-blue rectangle). A transparent PNG has no seam to mismatch: the
// gold ink sits directly on whatever colour the surrounding <td> is painted,
// in any client, in any theme.
//
// Source of truth is frontend/public/brand/wordmark-ondark.svg — this script
// only crops its padding away and rasterises it, it never redraws the mark.
// Run from the repo root: node scripts/build-email-wordmark.mjs

import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import sharp from "sharp";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const SOURCE = path.join(repoRoot, "frontend/public/brand/wordmark-ondark.svg");
const BRAND_DIR = path.join(repoRoot, "frontend/public/brand");
const ASSET_MODULE = path.join(repoRoot, "backend/lib/emailWordmarkAsset.js");

// The un-hashed frontend/public/brand/wordmark-email.png stays in the repo on
// purpose: the two test mails sent 8/9 point at that exact URL, and deleting
// the file would turn the mark into a broken image in an already-delivered
// inbox. It is no longer referenced by any template — new mails use the hashed
// name below — so it is dead weight only until those mails are gone.

// The source art is drawn in a 480x140 box with generous padding. The ink
// (glyphs + rule + accent dash) lives in x 60..420, y 25..106; this crop keeps
// a hair of breathing room on every side and lands on an exact 4.2:1 box.
// DISPLAY_* is the CSS size the email asks for; the file itself is written at
// 2x so it stays sharp on retina.
const CROP = { x: 52, y: 20, width: 378, height: 90 };
const DISPLAY_HEIGHT = 22;
const DISPLAY_WIDTH = Math.round((CROP.width / CROP.height) * DISPLAY_HEIGHT);

const source = readFileSync(SOURCE, "utf8");
const inner = source.replace(/^[\s\S]*?<svg[^>]*>/, "").replace(/<\/svg>\s*$/, "");

const cropped = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${CROP.x} ${CROP.y} ${CROP.width} ${CROP.height}">
  ${inner}
</svg>`;

const png = await sharp(Buffer.from(cropped), { density: 600 })
  .resize({ width: DISPLAY_WIDTH * 2 })
  .png({ compressionLevel: 9, palette: true })
  .toBuffer();

// Same input art + same sharp settings give the same bytes, so the same hash
// and the same filename: re-running the script never leaves a second copy
// behind. Only an actual pixel change produces a new name (and then the old
// file stays, still valid for the mails that reference it).
const hash = createHash("sha256").update(png).digest("hex").slice(0, 8);
const filename = `wordmark-email.${hash}.png`;
const target = path.join(BRAND_DIR, filename);
const alreadyBuilt = existsSync(target);

writeFileSync(target, png);
writeFileSync(
  ASSET_MODULE,
  [
    "// GENERERET af scripts/build-email-wordmark.mjs, rediger ikke.",
    "// Filnavnet baerer indholds-hashen af selve PNG'en, saa mail-klienternes",
    "// billed-proxier aldrig kan servere en gammel version af wordmarket (#2853).",
    `export const WORDMARK_FILENAME = ${JSON.stringify(filename)};`,
    "",
  ].join("\n")
);

const meta = await sharp(png).metadata();
console.log(
  `${alreadyBuilt ? "unchanged" : "wrote"} ${target} (${meta.width}x${meta.height}px file, ` +
    `${png.length} bytes, display ${DISPLAY_WIDTH}x${DISPLAY_HEIGHT})`
);
console.log(`wrote ${ASSET_MODULE} (WORDMARK_FILENAME = ${filename})`);
