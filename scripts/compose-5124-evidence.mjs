// #5124 · Saml PR-beviset til ét annoteret foer/efter-billede.
//
// Input er output fra testen "evidens: matrix-kontroller paa 390 og 1440 px" i
// frontend/tests/e2e/5124-season-matrix-mobile.spec.js, koert to gange:
//   EVIDENCE_5124=before  mod main's SeasonMatrix.jsx (flag fra)
//   EVIDENCE_5124=after   mod denne branch (beta-flaget taendt)
// og kopieret til EEN mappe: before-390.png, before-1440.png, before-sizes.json,
// after-390.png, after-1440.png, after-sizes.json.
//
// Brug: node scripts/compose-5124-evidence.mjs <mappe>
import { readFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const dir = process.argv[2];
if (!dir) throw new Error("Brug: node scripts/compose-5124-evidence.mjs <mappe med before-/after-filer>");

const img = async (name) => `data:image/png;base64,${(await readFile(path.join(dir, name))).toString("base64")}`;
const sizes = async (phase) => JSON.parse(await readFile(path.join(dir, `${phase}-sizes.json`), "utf8"));

const [b390, b1440, a390, a1440, bSizes, aSizes] = await Promise.all([
  img("before-390.png"), img("before-1440.png"), img("after-390.png"), img("after-1440.png"),
  sizes("before"), sizes("after"),
]);

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);
function sizeTable(list) {
  return `<table><tr><th>Kontrol</th><th>B×H</th><th>Radius</th><th>Tekst</th></tr>${list.map((c) =>
    `<tr><td>${esc(c.label)}</td><td>${c.w}×${c.h}</td><td>${c.radius === "0px" ? "5px (gruppe)" : c.radius === "9999px" ? "pille" : esc(c.radius)}</td><td>${c.transform === "uppercase" ? "VERSALER" : "sentence"}</td></tr>`).join("")}</table>`;
}

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 2000, height: 1300 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="da"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#eceae4;color:#17213d;font-family:Arial,sans-serif}
    header{background:#17213d;color:#fff;padding:20px 32px}
    h1{font-size:28px;margin:0 0 6px}header p{font-size:15px;color:#dad8cf;margin:0}
    main{display:grid;grid-template-columns:400px 560px 400px 560px;gap:16px;padding:18px 24px}
    section{background:#fff;border:1px solid #d7d3c8;border-radius:5px;padding:12px;min-width:0}
    h2{font-size:19px;margin:0 0 4px}.sub{font-size:13px;color:#576078;margin:0 0 10px}
    .crop{overflow:hidden;border:1px solid #d0cdc6;border-radius:5px;background:#f8f7f3}
    .m{height:700px}.d{height:400px}.crop img{width:100%;display:block}
    .pin{display:inline-block;width:20px;height:20px;border-radius:50%;background:#c0392b;color:#fff;font:700 12px/20px Arial;text-align:center;margin-right:6px}
    .after .pin{background:#3f8550}
    .note{margin-top:10px;padding:10px 12px;background:#faf7e8;border-left:4px solid #c59a12;font-size:14px;line-height:1.4}
    .after .note{background:#eef6ed;border-color:#3f8550}
    table{border-collapse:collapse;font-size:12px;margin-top:8px;width:100%}td,th{border-bottom:1px solid #e3e0d8;padding:3px 5px;text-align:left}
    td:nth-child(2){font-variant-numeric:tabular-nums}
    footer{font-size:12px;color:#596070;margin:0 28px 14px}
  </style><header><h1>#5124 · Sæsonmatrix på mobil (beta) + linse-kontroller</h1>
  <p>Rigtig app-UI fra Playwright · 390 px og 1440 px · før = main (flag fra) · efter = denne PR med beta-flaget tændt</p></header>
  <main>
  <section><h2>Før · 390 px</h2><p class="sub">Main i dag</p><div class="crop m"><img src="${b390}"></div>
    <div class="note"><span class="pin">1</span>Linserne er runde versal-piller, og den aktive er en fyldt guld-flade (ud over "Gem plan").<br>
    <span class="pin">2</span>Matrixen kræver vandret scroll i tabellen.</div>${sizeTable(bSizes[390])}</section>
  <section><h2>Før · 1440 px</h2><p class="sub">Main i dag</p><div class="crop d"><img src="${b1440}"></div>${sizeTable(bSizes[1440])}</section>
  <section class="after"><h2>Efter · 390 px (beta)</h2><p class="sub">Beta-testere; alle andre ser den fulde tabel som før</p><div class="crop m"><img src="${a390}"></div>
    <div class="note"><span class="pin">1</span>Linserne er én Segmented: hairline, 5 px, sentence case, aktiv = guld-tekst. Én række, 32 px tryk-mål.<br>
    <span class="pin">2</span>Ét løb og tre løbsdage ad gangen, uden vandret scroll. Før/Senere og løbsvælger i samme anatomi.</div>${sizeTable(aSizes[390])}</section>
  <section class="after"><h2>Efter · 1440 px</h2><p class="sub">Desktop-matrixen er uændret; kun kontrollerne er ryddet op</p><div class="crop d"><img src="${a1440}"></div>${sizeTable(aSizes[1440])}</section>
  </main>
  <footer>Kontraktformet, fiktiv testtrup; ingen produktionskonto. Størrelser målt med getBoundingClientRect i samme testkørsel som skærmbillederne.</footer></html>`);
  await page.waitForFunction(() => [...document.images].every((i) => i.complete && i.naturalWidth > 0));
  const output = path.join(root, "pr-screens", "5124", "before-after.png");
  await mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output, fullPage: true });
  console.log(output);
} finally {
  await browser.close();
}
