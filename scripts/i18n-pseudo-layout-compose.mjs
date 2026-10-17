#!/usr/bin/env node
// #6800 — ét samlet, annoteret foer/efter-kort ud af to sweep-koersler.
//
//   node scripts/i18n-pseudo-layout-compose.mjs --before <mappe> --after <mappe> --out kort.png
//
// <mappe> er en `i18n-pseudo-layout.mjs --out X --label L`-koersel (X/L med
// findings.json og skaermbillederne). Hver case klipper samme udsnit af siden
// foer og efter. Roede rammer = nye fund i foer-koerslen, ravgule = fund der
// stadig staar i efter-koerslen; ingen ramme paa efter-siden = rettet.
//
// Billederne laeses som data-URI'er og males af Chromium (Playwright fra
// frontend/node_modules). Ingen server, ingen netvaerk, ingen efterladt proces.

import { createRequire } from "node:module";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const req = createRequire(join(REPO_ROOT, "frontend", "package.json"));
const { chromium } = req("@playwright/test");

function arg(name) {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : null;
}
const beforeDir = arg("--before");
const afterDir = arg("--after");
const outPng = arg("--out");
if (!beforeDir || !afterDir || !outPng) {
  console.error("Brug: --before <mappe> --after <mappe> --out <png>");
  process.exit(1);
}

const load = (dir) => JSON.parse(readFileSync(join(resolve(dir), "findings.json"), "utf8"));
const before = load(beforeDir);
const after = load(afterDir);

// Hver case: side + viewport, et udvalg af foer-fund (`pick`) der afgraenser
// udsnittet, eller et fast udsnit (`fixed`). `shot` vaelger viewport-billedet.
const CASES = [
  { title: "Bundnavigation 375: label klippes i venstre kant", page: "dashboard", viewport: "mobile", shot: "-viewport", fixed: { x: 0, y: 740, w: 375, h: 72 }, mark: [{ x: 0, y: 756, w: 75, h: 56 }] },
  { title: "Rangliste 375: holdnavn knuses til ét tegn pr. linje", page: "standings", viewport: "mobile", pick: (f) => f.kind === "wrap-control", pad: 24 },
  { title: "Rytterdatabase 375: Potential-kolonnen skubbes ud af kanten", page: "riders", viewport: "mobile", pick: (f) => f.kind === "clipped-by-ancestor", pad: 24 },
  { title: "Mit hold 375: Salary-kolonnen klippes", page: "team", viewport: "mobile", pick: (f) => f.kind === "clipped-by-ancestor", pad: 24 },
  { title: "Formplan 1440: siden kan scrolles vandret", page: "planning-form", viewport: "desktop", pick: (f) => f.kind === "beyond-viewport", pad: 24, cropX: [720, 1440] },
  { title: "Formplan 375: række-meta presser siden bredere end skærmen", page: "planning-form", viewport: "mobile", pick: (f) => f.kind === "beyond-viewport" && !/nav/.test(f.path), pad: 24 },
  { title: "Rytterprofil 1440: kontraktfeltet klippes", page: "rider-profile", viewport: "desktop", pick: (f) => f.kind === "clipped-by-ancestor", pad: 40 },
  { title: "Træning 375: oversigtsfelterne afkorter deres label", page: "training", viewport: "mobile", pick: (f) => f.kind === "ellipsis" && /training-overview/.test(f.path), pad: 12, fallbackAny: true },
];

const findingsOf = (run, c) => run.find((r) => r.page === c.page && r.viewport === c.viewport);
const dataUri = (file) => `data:image/png;base64,${readFileSync(file).toString("base64")}`;

function unionRect(rects, pad) {
  const x0 = Math.min(...rects.map((r) => r.x));
  const y0 = Math.min(...rects.map((r) => r.y));
  const x1 = Math.max(...rects.map((r) => r.x + r.w));
  const y1 = Math.max(...rects.map((r) => r.y + r.h));
  return { x: Math.max(0, x0 - pad), y: Math.max(0, y0 - pad), w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
}

const blocks = [];
for (const c of CASES) {
  const b = findingsOf(before, c);
  const a = findingsOf(after, c);
  if (!b || !a) continue;
  const shotName = `${c.page}-${c.viewport}-pseudo${c.shot ?? ""}.png`;
  const bFile = join(resolve(beforeDir), shotName);
  const aFile = join(resolve(afterDir), shotName);
  if (!existsSync(bFile) || !existsSync(aFile)) continue;

  let region = c.fixed;
  let beforeMarks = c.mark ?? [];
  let afterMarks = [];
  if (c.pick) {
    const hits = b.new.filter(c.pick);
    if (hits.length === 0) continue;
    const capped = hits.slice(0, 12);
    region = unionRect(capped.map((f) => f.rect), c.pad ?? 24);
    if (c.cropX) {
      region.x = c.cropX[0];
      region.w = c.cropX[1] - c.cropX[0];
    }
    beforeMarks = capped.map((f) => f.rect);
    afterMarks = a.new.filter(c.pick).slice(0, 12).map((f) => f.rect);
  }
  // Maksimalt 900px lodret udsnit, saa kortet ikke bliver uendeligt langt.
  region.h = Math.min(region.h, 900);
  const scale = Math.min(2, Math.max(0.5, 640 / region.w));
  blocks.push({ c, region, scale, beforeMarks, afterMarks, bImg: dataUri(bFile), aImg: dataUri(aFile), afterOk: afterMarks.length === 0 });
}

if (blocks.length === 0) throw new Error("ingen cases kunne bygges (mangler billeder eller fund)");

const pane = (img, region, scale, marks, color) => `
  <div class="pane" style="width:${Math.round(region.w * scale)}px;height:${Math.round(region.h * scale)}px">
    <img src="${img}" style="position:absolute;left:0;top:0;max-width:none;transform-origin:0 0;transform:translate(${-region.x * scale}px,${-region.y * scale}px) scale(${scale})" />
    ${marks.map((m) => `<div class="box" style="border-color:${color};left:${Math.round((m.x - region.x) * scale)}px;top:${Math.round((m.y - region.y) * scale)}px;width:${Math.round(m.w * scale)}px;height:${Math.round(m.h * scale)}px"></div>`).join("")}
  </div>`;

const html = `<!doctype html><html><head><meta charset="utf-8"><style>
  body{margin:0;padding:24px;background:#f3f1ec;font-family:Inter,Segoe UI,Arial,sans-serif;color:#1a1a1a;width:1400px}
  h1{font-size:22px;margin:0 0 4px}
  p.sub{margin:0 0 20px;color:#555;font-size:13px}
  .case{background:#fff;border:1px solid #d8d4cb;border-radius:5px;padding:14px;margin-bottom:18px}
  .case h2{font-size:15px;margin:0 0 10px}
  .row{display:flex;gap:18px;align-items:flex-start}
  .col{flex:1;min-width:0}
  .tag{display:inline-block;font-size:11px;font-weight:700;letter-spacing:.06em;text-transform:uppercase;padding:2px 8px;border-radius:3px;margin-bottom:6px}
  .tag.b{background:#fbe3e0;color:#a4261b}.tag.a{background:#e0f0e1;color:#1d6a2a}.tag.w{background:#fbefd3;color:#8a5a00}
  .pane{position:relative;overflow:hidden;border:1px solid #cfcabd;background:#fff}
  .box{position:absolute;border:2px solid;box-sizing:border-box;border-radius:2px}
</style></head><body>
<h1>Layout i pseudo-locale en-XA (+30 % tegn): foer og efter</h1>
<p class="sub">Roed ramme = nyt klip/overloeb fundet i foer-koerslen. Ingen ramme efter = rettet. Skaermbillederne er maalt mod Playwright-mocks, ikke prod-data.</p>
${blocks
  .map(
    (k) => `<div class="case"><h2>${k.c.title}</h2><div class="row">
  <div class="col"><span class="tag b">Foer</span>${pane(k.bImg, k.region, k.scale, k.beforeMarks, "#d6342a")}</div>
  <div class="col"><span class="tag ${k.afterOk ? "a" : "w"}">Efter${k.afterOk ? " · rettet" : " · rest"}</span>${pane(k.aImg, k.region, k.scale, k.afterMarks, "#d98b00")}</div>
</div></div>`,
  )
  .join("\n")}
</body></html>`;

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1448, height: 900 }, deviceScaleFactor: 1 });
  await page.setContent(html, { waitUntil: "load" });
  await page.screenshot({ path: resolve(outPng), fullPage: true });
} finally {
  await browser.close();
}
console.log(`Kort → ${resolve(outPng)} (${blocks.length} cases)`);
