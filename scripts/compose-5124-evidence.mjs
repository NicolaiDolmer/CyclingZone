// Combine browser screenshots from #5124's passing Playwright spec into one
// annotated PR artifact. The mobile before state reveals the old table on the
// same data fixture; the mobile after state uses approved option A.
import { readFile, readdir, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "../frontend/node_modules/@playwright/test/index.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const resultRoot = path.join(root, "frontend", "test-results");
const folders = await readdir(resultRoot);
async function shot(fragment, project, name) {
  const folder = folders.find((entry) => entry.includes(fragment) && entry.endsWith(project));
  if (!folder) throw new Error(`No #5124 ${project} ${fragment} test output`);
  return `data:image/png;base64,${(await readFile(path.join(resultRoot, folder, name))).toString("base64")}`;
}

const before = await shot("llevalg-uden-vandret-scroll", "mobile-chromium", "before-mobile.png");
const after = await shot("llevalg-uden-vandret-scroll", "mobile-chromium", "after-mobile.png");
const desktop = await shot("sammenhængende-spænd", "desktop-chromium", "desktop-unchanged.png");

const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1700, height: 1080 }, deviceScaleFactor: 1 });
  await page.setContent(`<!doctype html><html lang="da"><meta charset="utf-8"><style>
    *{box-sizing:border-box}body{margin:0;background:#eceae4;color:#17213d;font-family:Arial,sans-serif}
    header{height:110px;background:#17213d;color:#fff;padding:23px 35px}
    h1{font-size:29px;margin:0 0 7px}header p{font-size:15px;color:#dad8cf;margin:0}
    main{display:grid;grid-template-columns:455px 455px 1fr;gap:20px;padding:20px 30px}
    section{background:white;border:1px solid #d7d3c8;border-radius:5px;padding:15px;min-width:0}
    h2{font-size:21px;margin:0 0 5px}.sub{font-size:14px;color:#576078;margin:0 0 14px;line-height:1.35;height:38px}
    .crop{overflow:hidden;border:1px solid #d0cdc6;border-radius:5px;background:#f8f7f3}
    .mobile{height:680px}.mobile img{width:100%;display:block}
    .desktop{height:425px}.desktop img{width:100%;display:block}
    .note{margin-top:14px;padding:13px 14px;background:#faf7e8;border-left:4px solid #c59a12;font-size:16px;line-height:1.4}
    .after .note{background:#eef6ed;border-color:#3f8550}
    footer{font-size:12px;color:#596070;margin:1px 33px}
  </style><header><h1>#5124 · Sæsonmatrix på mobil</h1><p>Ejerens valg A · samme browserdata i før/efter · mobil 390 px · desktop 1440 px</p></header>
  <main><section><h2>Før · mobil</h2><p class="sub">Den fulde tabel i telefonens bredde.</p>
    <div class="crop mobile"><img src="${before}"></div>
    <div class="note">Rytternavne og løbsdage kræver vandret bevægelse inde i tabellen.</div></section>
  <section class="after"><h2>Efter · mobil</h2><p class="sub">Vælg løb og se tre ordnede løbsdage uden vandret scroll.</p>
    <div class="crop mobile"><img src="${after}"></div>
    <div class="note">Dato og løbsdag vises særskilt. Før/Senere skifter vindue; rollevalg og Gem plan bruger samme kladde.</div></section>
  <section><h2>Desktop · bevaret</h2><p class="sub">Den fulde matrix og sæsonens tidslinje vises fortsat.</p>
    <div class="crop desktop"><img src="${desktop}"></div>
    <div class="note">Desktop får samme gitter som før. Mobilvalget ændrer ikke løbenes data eller gemmeregel.</div></section></main>
  <footer>Rigtige appskærmbilleder fra Playwright med en kontraktformet, fiktiv testtrup; ingen produktionskonto. Før er den eksisterende desktop-tabel vist i mobilbrowseren ved at skjule den nye mobilvisning i testen.</footer></html>`);
  await page.waitForFunction(() => [...document.images].every((img) => img.complete && img.naturalWidth > 0));
  const output = path.join(root, "pr-screens", "5124", "before-after.png");
  await mkdir(path.dirname(output), { recursive: true });
  await page.screenshot({ path: output });
  console.log(output);
} finally {
  await browser.close();
}
