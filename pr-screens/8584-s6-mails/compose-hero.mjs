// #8396: saetter mailens topbillede sammen af de tre preview-skaermbilleder fra shots-app.mjs.
//
//   node pr-screens/8584-s6-mails/compose-hero.mjs <raa-mappe>
//
// Uddata: frontend/public/email/s6/s6-hero-<lang>.png (2x af den viste bredde i mailen).
// Navy flade bag billederne, saa billedet ser ens ud i lys og moerk tilstand.
import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const require = createRequire(join(ROOT, "frontend", "package.json"));
const sharp = require("sharp");
const RAW = resolve(process.argv[2] || join(HERE, ".raw"));
const OUT = join(ROOT, "frontend", "public", "email", "s6");
mkdirSync(OUT, { recursive: true });

// Maal i pixels paa det faerdige billede (vises i halv stoerrelse i mailen).
const WIDTH = 1104;
const PAD = 32;
const GAP = 24;
const LABEL_H = 64;
const PANEL_W = Math.floor((WIDTH - 2 * PAD - 2 * GAP) / 3);
const CROP = { width: 780, height: 1120 };
const PANEL_H = Math.round((CROP.height * PANEL_W) / CROP.width);
const HEIGHT = PAD + LABEL_H + PANEL_H + PAD;
const NAVY = "#1B2A4A";
const GOLD = "#C9A227";

// Hvor i hvert skaermbillede (2x-pixels) udsnittet starter.
const PANELS = [
  { key: "race", top: 880, label: { en: "Race page and film", da: "Løbsside og film" } },
  { key: "training", top: 100, label: { en: "Training and day picker", da: "Træning og dagsvælger" } },
  { key: "development", top: 100, label: { en: "Potential 1-99", da: "Potentiale 1-99" } },
];

function esc(s) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
}

for (const lang of ["en", "da"]) {
  const layers = [];
  for (const [i, p] of PANELS.entries()) {
    const left = PAD + i * (PANEL_W + GAP);
    const radius = 10;
    const mask = Buffer.from(`<svg width="${PANEL_W}" height="${PANEL_H}"><rect width="${PANEL_W}" height="${PANEL_H}" rx="${radius}" ry="${radius}"/></svg>`);
    const panel = await sharp(join(RAW, `${p.key}-${lang}.png`))
      .extract({ left: 0, top: p.top, width: CROP.width, height: CROP.height })
      .resize(PANEL_W, PANEL_H)
      .composite([{ input: mask, blend: "dest-in" }])
      .png()
      .toBuffer();
    layers.push({ input: panel, left, top: PAD + LABEL_H });
  }
  const labels = PANELS.map((p, i) => {
    const x = PAD + i * (PANEL_W + GAP) + PANEL_W / 2;
    return `<text x="${x}" y="${PAD + 38}" text-anchor="middle" font-family="Segoe UI, Arial, sans-serif" font-size="27" font-weight="700" fill="${GOLD}">${esc(p.label[lang])}</text>`;
  }).join("");
  const base = Buffer.from(`<svg width="${WIDTH}" height="${HEIGHT}" xmlns="http://www.w3.org/2000/svg"><rect width="${WIDTH}" height="${HEIGHT}" fill="${NAVY}"/>${labels}</svg>`);
  const file = join(OUT, `s6-hero-${lang}.png`);
  await sharp(base).composite(layers).png({ compressionLevel: 9, palette: true, quality: 90 }).toFile(file);
  const meta = await sharp(file).metadata();
  console.log(file, meta.width, meta.height);
}
