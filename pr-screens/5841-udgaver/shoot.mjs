// #5841 skitse: tager billeder af frontend/src/preview/sketches/5841-udgaver/index.html
// og samler dem side om side med wireframe-referencen (v=0).
// Koer: node pr-screens/5841-udgaver/shoot.mjs   (bruger frontend/node_modules/@playwright/test)
import fs from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const DIR = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(DIR, "../..");
const PAGE = pathToFileURL(resolve(ROOT, "frontend/src/preview/sketches/5841-udgaver/index.html")).href;
const SHOTS = resolve(DIR, "shots");
fs.mkdirSync(SHOTS, { recursive: true });
const { chromium } = await import(pathToFileURL(resolve(ROOT, "frontend/node_modules/@playwright/test/index.mjs")).href);

// Appens sidemenu (208 px) simuleres paa desktop, som i wireframe-billederne.
const SIDEBAR = "body{padding-left:208px!important}#__sb{position:fixed;left:0;top:0;bottom:0;width:208px;background:#1a1f38;z-index:60;color:#fff;font:600 11px 'DM Sans',sans-serif;padding:16px;box-sizing:border-box;letter-spacing:.08em}";
const HIDE = ".note,#pagesw{display:none!important}";

const RACE = {
  ref: "v=0&st=1",
  "a-pool": "v=A&st=1&menu=pool",
  "a-season": "v=A&st=1&menu=season",
  "a-c": "v=A&st=1&pool=C",
  b: "v=B&st=1",
  "b-c": "v=B&st=1&pool=C",
  "b-s3": "v=B&st=1&season=3",
};
const CARD = { ref: "v=0&page=card", a: "v=A&page=card", b: "v=B&page=card", "b-c": "v=B&page=card&pool=C" };

async function shoot(b, kind, key, qs, vw) {
  const mobile = vw < 700;
  const ctx = await b.newContext({ viewport: { width: vw, height: mobile ? 844 : 900 }, deviceScaleFactor: 1, hasTouch: mobile, isMobile: mobile });
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(String(e)));
  await p.goto(`${PAGE}?${qs}`);
  await p.waitForTimeout(900);
  await p.addStyleTag({ content: HIDE + (!mobile && kind === "race" ? SIDEBAR : "") });
  await p.evaluate(() => document.body.classList.add("nolabels"));
  if (!mobile && kind === "race") await p.evaluate(() => { const d = document.createElement("div"); d.id = "__sb"; d.textContent = "APP SIDEBAR 208 PX"; document.body.prepend(d); });
  await p.waitForTimeout(300);
  const docW = await p.evaluate(() => document.documentElement.scrollWidth);
  const name = `${kind}-${key}-${vw}.png`;
  if (kind === "card" && !mobile) {
    const box = await p.evaluate(() => { const r = document.querySelector(".mp").getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height }; });
    const pad = 48;
    await p.screenshot({ path: resolve(SHOTS, name), clip: { x: Math.max(0, box.x - pad), y: Math.max(0, box.y - pad), width: box.w + 2 * pad, height: box.h + 2 * pad } });
  } else if (mobile && kind === "race") {
    await p.screenshot({ path: resolve(SHOTS, name), fullPage: true, clip: { x: 0, y: 0, width: vw, height: 1300 } });
  } else {
    await p.screenshot({ path: resolve(SHOTS, name) });
  }
  // Banneret skal vaere med oeverst i hvert billede.
  const banner = await p.evaluate(() => document.querySelector("#sk .nm")?.textContent || "");
  await ctx.close();
  return { name, errs, docW, vw, banner };
}

// Mangler Playwrights egen browser, kan PW_CHANNEL=msedge/chrome bruge den installerede.
const b = await chromium.launch(process.env.PW_CHANNEL ? { channel: process.env.PW_CHANNEL } : {});
const out = [];
for (const [key, qs] of Object.entries(RACE)) for (const vw of [1440, 390]) out.push(await shoot(b, "race", key, qs, vw));
for (const [key, qs] of Object.entries(CARD)) for (const vw of [1440, 390]) out.push(await shoot(b, "card", key, qs, vw));

// Samlebilleder: wireframe/i dag til venstre, varianten til hoejre.
const css = `<meta charset="utf-8"><style>body{margin:0;background:#e9e6de;font:14px/1.4 'Segoe UI',system-ui,sans-serif;color:#0e0f15;padding:20px;box-sizing:border-box}
h1{font-size:22px;margin:0 0 4px}p.s{margin:0 0 16px;color:#4c4a5e;font-size:13px;max-width:1400px}
.g{display:grid;gap:24px 28px;align-items:start}.c .t{font:700 13px system-ui;margin:0 0 6px}.c .t span{font-weight:400;color:#4c4a5e}
.c img{display:block;border:1px solid #cfc9bb;background:#fff}</style>`;
const col = (title, sub, file, w) => `<div class="c"><div class="t">${title} <span>${sub}</span></div><img src="shots/${file}" width="${w}"></div>`;
const L = { A: "A · Små menuer", B: "B · Fast udgave-linje" };
const SENT = {
  A: "Løbssiden får \"Pool B\" og \"Season 5\" som to små menuer i hovedet med vindere og tider, og kalenderkortet får rækken \"Runs in 4 pools\" med en knap pr. pulje, der åbner den puljes løbsside.",
  B: "Løbssiden får en fast linje i hovedet med alle puljer og sæsoner som knapper (ét klik, din pulje markeret), og kalenderkortet skifter mellem puljerne uden at forlade kalenderen.",
};
const comps = [
  { out: "A-1440-loebsside", w: 2940, cols: 2, title: `${L.A}: løbssiden ved 1440 px`, sub: "Øverst til venstre wireframe v6c uændret, de tre andre er variant A. Blå stiplet ramme = det nye.",
    cells: [["Wireframe v6c", "uændret reference", "race-ref-1440.png"], ["A", "Pool-menuen åben", "race-a-pool-1440.png"], ["A", "Season-menuen åben: vindere og tider", "race-a-season-1440.png"], ["A", "Viser Pulje C (ikke holdets)", "race-a-c-1440.png"]], iw: 1440 },
  { out: "A-390-loebsside", w: 1750, cols: 4, title: `${L.A}: løbssiden ved 390 px`, sub: "Telefon, øverste 1.300 px.",
    cells: [["Wireframe v6c", "uændret", "race-ref-390.png"], ["A", "Pool-menuen åben", "race-a-pool-390.png"], ["A", "Season-menuen åben", "race-a-season-390.png"], ["A", "Viser Pulje C", "race-a-c-390.png"]], iw: 390 },
  { out: "B-1440-loebsside", w: 2940, cols: 2, title: `${L.B}: løbssiden ved 1440 px`, sub: "Øverst til venstre wireframe v6c uændret, de tre andre er variant B. Blå stiplet ramme = det nye.",
    cells: [["Wireframe v6c", "uændret reference", "race-ref-1440.png"], ["B", "Din egen udgave (Pulje B, S5)", "race-b-1440.png"], ["B", "Viser Pulje C", "race-b-c-1440.png"], ["B", "Sæson 3: løbet kørte i Division 4 med 8 puljer", "race-b-s3-1440.png"]], iw: 1440 },
  { out: "B-390-loebsside", w: 1750, cols: 4, title: `${L.B}: løbssiden ved 390 px`, sub: "Telefon, øverste 1.300 px.",
    cells: [["Wireframe v6c", "uændret", "race-ref-390.png"], ["B", "Din egen udgave", "race-b-390.png"], ["B", "Viser Pulje C", "race-b-c-390.png"], ["B", "Sæson 3, 8 puljer", "race-b-s3-390.png"]], iw: 390 },
  { out: "A-kalenderkort", w: 1420, cols: 4, title: `${L.A}: kalenderens løbskort`, sub: "Til venstre kortet som i dag (replika af RacePeekCard), til højre variant A. 1440 px (udsnit om kortet) og 390 px.",
    cells: [["I dag", "1440", "card-ref-1440.png", 480], ["A", "1440", "card-a-1440.png", 480], ["I dag", "390", "card-ref-390.png", 390], ["A", "390", "card-a-390.png", 390]] },
  { out: "B-kalenderkort", w: 2040, cols: 6, title: `${L.B}: kalenderens løbskort`, sub: "Til venstre kortet som i dag, så variant B på holdets egen pulje og efter et klik på Pulje C. 1440 px (udsnit om kortet) og 390 px.",
    cells: [["I dag", "1440", "card-ref-1440.png", 480], ["B", "1440 · egen pulje", "card-b-1440.png", 480], ["B", "1440 · Pulje C", "card-b-c-1440.png", 480], ["I dag", "390", "card-ref-390.png", 390], ["B", "390 · egen pulje", "card-b-390.png", 390], ["B", "390 · Pulje C", "card-b-c-390.png", 390]] },
];
for (const c of comps) {
  const tmpl = c.out.endsWith("kalenderkort") ? `grid-template-columns:repeat(${c.cols === 6 ? 3 : 2},auto)` : `grid-template-columns:repeat(${c.cols},${c.iw}px)`;
  const sent = SENT[c.out[0]];
  const html = `${css}<body style="width:${c.w}px"><h1>${c.title}</h1><p class="s"><b>${sent}</b><br>${c.sub}</p><div class="g" style="${tmpl}">${c.cells.map(([t, s, f, w]) => col(t, s, f, w || c.iw)).join("")}</div></body>`;
  const f = resolve(DIR, `${c.out}.comp.html`);
  fs.writeFileSync(f, html);
  const p = await b.newPage({ viewport: { width: c.w, height: 900 } });
  await p.goto(pathToFileURL(f).href);
  await p.waitForTimeout(500);
  await p.screenshot({ path: resolve(DIR, `${c.out}.png`), fullPage: true });
  await p.close();
  fs.unlinkSync(f);
}
await b.close();
console.log(out.map((o) => `${o.name} docW=${o.docW}/${o.vw} banner="${o.banner}" errs=${o.errs.length ? o.errs.join("|") : 0}`).join("\n"));
