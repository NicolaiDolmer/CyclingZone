// #6584 · Feature graphic til Google Play: 1024 x 500, 24-bit PNG uden alfa (Googles krav).
// Navy baggrund (brandets --bg-body) med det officielle guld-wordmark fra frontend/public/brand.
// Ingen tekst opfundet: logoet er brandets eget, og alt andet er tomt rum.
//
//   node docs/app/play-listing/tools/make-feature-graphic.mjs [udfil]
//
// Standard-udfil: docs/app/play-listing/feature-graphic-1024x500.png
import { createRequire } from "node:module";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = resolve(here, "../../../..");
const require = createRequire(resolve(repo, "frontend/package.json"));
const sharp = require("sharp");

const WIDTH = 1024;
const HEIGHT = 500;
const BACKGROUND = "#0e0f15";
const WORDMARK_WIDTH = 620;

const out = resolve(process.argv[2] ?? resolve(here, "../feature-graphic-1024x500.png"));
const svg = readFileSync(resolve(repo, "frontend/public/brand/wordmark-ondark.svg"));

const wordmark = await sharp(svg, { density: 300 }).resize({ width: WORDMARK_WIDTH }).png().toBuffer();
const meta = await sharp(wordmark).metadata();

const png = await sharp({ create: { width: WIDTH, height: HEIGHT, channels: 3, background: BACKGROUND } })
  .composite([
    {
      input: wordmark,
      left: Math.round((WIDTH - (meta.width ?? WORDMARK_WIDTH)) / 2),
      top: Math.round((HEIGHT - (meta.height ?? 0)) / 2),
    },
  ])
  .removeAlpha()
  .png()
  .toBuffer();

writeFileSync(out, png);
const check = await sharp(png).metadata();
console.log(`${out}: ${check.width}x${check.height}, kanaler ${check.channels}, alfa ${check.hasAlpha ? "ja" : "nej"}`);
if (check.width !== WIDTH || check.height !== HEIGHT || check.hasAlpha) process.exit(1);
