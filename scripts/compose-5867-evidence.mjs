// Rebuild one annotated UI artifact from the passing #5867 Playwright test.
// The four inputs are real browser screenshots of the same five-rider fixture.
import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultRoot = path.join(root, "frontend", "test-results");
const folders = await readdir(resultRoot);
async function shot(project, state) {
  const folder = folders.find((name) => name.startsWith("5867-senior-start-warning") && name.endsWith(project));
  if (!folder) throw new Error(`No #5867 ${project} test output`);
  return `data:image/png;base64,${(await readFile(path.join(resultRoot, folder, `${state}.png`))).toString("base64")}`;
}

const sources = {
  desktopBefore: await shot("desktop-chromium", "before"),
  desktopAfter: await shot("desktop-chromium", "after"),
  mobileBefore: await shot("mobile-chromium", "before"),
  mobileAfter: await shot("mobile-chromium", "after"),
};
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1110 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="da"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#eceae4;color:#17213d;font-family:Arial,sans-serif}
    header{height:112px;background:#17213d;color:#fff;padding:25px 42px}
    h1{font-size:30px;margin:0 0 7px}header p{font-size:15px;margin:0;color:#dad8cf}
    main{display:grid;grid-template-columns:1fr 1fr;gap:25px;padding:23px 38px}
    section{background:#fff;border:1px solid #d7d3c8;border-radius:6px;padding:19px}
    h2{font-size:22px;margin:0 0 5px}.sub{font-size:14px;color:#576078;margin:0 0 16px}
    .label{font-size:13px;font-weight:bold;letter-spacing:.08em;text-transform:uppercase;margin:0 0 7px}
    .crop{overflow:hidden;border:1px solid #cdc9bf;background:#f8f7f3;border-radius:5px}
    .desktop{height:315px}.desktop img{width:100%;display:block}
    .mobileRow{display:flex;align-items:flex-start;gap:20px;margin-top:16px}
    .mobile{width:350px;height:420px;flex:none}.mobile img{width:100%;display:block}
    .callout{max-width:330px;margin-top:60px;padding:16px;border-left:4px solid #d4a600;background:#faf7e8;line-height:1.45;font-size:17px}
    .after .callout{border-left-color:#c9312c;background:#fff0ee}
    footer{font-size:12px;color:#596070;margin:0 40px}
  </style><header><h1>#5867 · Seniortrup før start</h1><p>Samme fem seniorryttere · faktisk dashboard i browser · desktop 1280 px og mobil 393 px</p></header>
  <main><section><h2>Før</h2><p class="sub">Advarselsstrip skjult for at vise den hidtidige flade med samme testdata.</p>
  <div class="label">Desktop</div><div class="crop desktop"><img src="${sources.desktopBefore}"></div>
  <div class="mobileRow"><div><div class="label">Mobil</div><div class="crop mobile"><img src="${sources.mobileBefore}"></div></div>
  <div class="callout">Truppen har fem seniorryttere. Øverst på dashboardet er der ingen tydelig vej til at løse manglen.</div></div></section>
  <section class="after"><h2>Efter</h2><p class="sub">Ny vedvarende advarsel, samme fem ryttere; linket åbner ryttermarkedet.</p>
  <div class="label">Desktop</div><div class="crop desktop"><img src="${sources.desktopAfter}"></div>
  <div class="mobileRow"><div><div class="label">Mobil</div><div class="crop mobile"><img src="${sources.mobileAfter}"></div></div>
  <div class="callout">Advarslen viser 5 af 6 og hvor mange der mangler. Den forsvinder, når truppen når seks; browser-testet på begge størrelser.</div></div></section></main>
  <footer>Mocket managerhold, ingen produktionsdata. Før-billedet er samme efter-build, hvor den nye strip er skjult i browseren; resten af UI og data er identiske.</footer></html>`);
  await page.locator("img").first().evaluate(async (el) => { await el.decode(); });
  const output = path.join(root, "pr-screens", "5867", "before-after.png");
  await mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output });
  console.log(output);
} finally {
  await browser.close();
}
