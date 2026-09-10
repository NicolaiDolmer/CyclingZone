import { createRequire } from "node:module"; import { fileURLToPath } from "node:url"; import path from "node:path";
const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "../../../..");
const { chromium } = createRequire(import.meta.url)(path.join(REPO, "frontend/node_modules/playwright"));
import { writeFileSync, mkdirSync } from "node:fs";

const OUT = path.join(HERE, "out");
mkdirSync(OUT, { recursive: true });
const FONTS = "file:///" + path.join(REPO, "frontend/public/fonts").replace(/\\/g, "/");
const Y = 2028;
const R = [
  ["Rubén","Lozano","ES",2004,"BAR","ROU",6742616,35839,6,"4,0",78,68,[71,66,67,70,64,68,69,66,67]],
  ["Hugo","Moreau","FR",2002,"BAR","ROU",1173665,53673,6,"3,5",24,64,[63,64,60,73,59,64,62,69,66]],
  ["Quentin","Sauvage","FR",1999,"SPR","ROU",781809,56707,4,"5,5",69,68,[70,63,61,64,65,68,64,75,78]],
  ["Lucas","Hervé","FR",2005,"BAR","ROU",473622,8748,6,"6,0",0,55,[58,55,55,56,60,59,57,53,46]],
  ["Clément","Guerin","FR",2008,"BJE","PUN",393328,4997,6,"4,5",0,54,[53,57,56,55,53,54,54,52,53]],
  ["Corentin","Vidal","FR",1996,"BJE","PUN",352776,55530,6,"3,0",18,66,[56,80,73,69,64,68,65,58,61]],
  ["Adrien","Lemaire","FR",1999,"BRO","ROU",293138,37730,6,"2,5",12,67,[73,65,69,66,67,62,76,56,66]],
  ["Jack","Holland","GB",1998,"PUN","BJE",276342,30831,6,"2,0",42,66,[60,68,73,80,57,70,67,55,63]],
  ["Julien","Faure","FR",1998,"BAR","ROU",204766,22868,6,"2,0",35,65,[72,61,63,72,52,65,66,67,67]],
  ["Loïc","Delcroix","FR",1996,"BRO","ROU",188032,29787,4,"3,0",42,65,[72,52,63,68,63,66,73,61,66]],
].map(([fn,ln,nat,by,t1,t2,val,sal,ce,pot,pop,ovr,st]) => ({fn,ln,nat,age:Y-by,t1,t2,val,sal,ce,pot,pop,ovr,st}));
const STATS = ["FL","BJ","KB","BK","TT","PRL","BRO","SP","ACC"];
const n = (v) => v.toLocaleString("da-DK");

const BASE = `
@font-face{font-family:"DM Sans";src:url(${FONTS}/dm-sans-latin-wght-normal.woff2) format("woff2");font-weight:100 900}
@font-face{font-family:"Inter Tight";src:url(${FONTS}/inter-tight-latin-wght-normal.woff2) format("woff2");font-weight:100 900}
@font-face{font-family:"Bebas Neue";src:url(${FONTS}/bebas-neue-latin-400-normal.woff2) format("woff2")}
:root{--bg:#f4f2ec;--card:#fcfbf7;--sub:#ece9e1;--bd:#e5e0d5;--t1:#0e0f15;--t2:#66637a;--t3:#9896b0;--acc:#a07800;--nav:#1a1f38}
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:375px;background:var(--bg);color:var(--t1);font-family:"DM Sans",system-ui,sans-serif;font-size:14px;-webkit-font-smoothing:antialiased}
.data{font-family:"Inter Tight",system-ui,sans-serif;font-variant-numeric:tabular-nums}
.top{height:48px;background:var(--nav);display:flex;align-items:center;justify-content:space-between;padding:0 16px;color:#fff}
.wm{font-family:"Bebas Neue",Impact,sans-serif;font-size:22px;letter-spacing:.04em;line-height:1}
.ico{width:20px;height:20px;stroke:currentColor;fill:none;stroke-width:1.6;stroke-linecap:round;stroke-linejoin:round}
.page{padding:16px 16px 84px}
.h1{font-family:"Inter Tight";font-size:20px;font-weight:700;letter-spacing:-.01em;line-height:1.15}
.sub{font-size:13px;color:var(--t2);margin-top:4px}
.tabs{display:flex;gap:18px;border-bottom:1px solid var(--bd);margin:14px 0 12px;overflow:hidden}
.tab{font-size:14px;font-weight:500;color:var(--t2);padding:0 0 8px;white-space:nowrap}
.tab.on{color:var(--t1);border-bottom:2px solid rgb(232 197 71);margin-bottom:-1px}
.fb{display:flex;gap:8px;margin-bottom:12px}
.in{height:34px;border:1px solid var(--bd);border-radius:5px;background:var(--card);display:flex;align-items:center;padding:0 10px;font-size:13px;color:var(--t3);gap:6px}
.in.s{flex:1 1 0}.in.h{flex:1 1 0;color:var(--t1);justify-content:space-between}
.card{background:var(--card);border:1px solid var(--bd);border-radius:5px;overflow:hidden}
table{border-collapse:collapse;width:100%}
th{font-family:"Inter Tight";font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--t3);text-align:left;padding:8px 8px;border-bottom:1px solid var(--bd);white-space:nowrap;background:var(--card)}
td{padding:7px 8px;border-bottom:1px solid var(--bd);font-size:13px;white-space:nowrap;vertical-align:middle}
tr:last-child td{border-bottom:0}
.num{text-align:right}
.nm{font-weight:500;font-size:13px;line-height:1.15}
.ml{font-family:"Inter Tight";font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--t3);margin-top:2px}
.val{color:var(--acc);font-weight:700}
.t2{color:var(--t2)}
.dot{display:inline-block;width:7px;height:7px;border-radius:50%;background:rgb(232 197 71);margin-right:6px;vertical-align:1px}
.bot{position:fixed;left:0;right:0;bottom:0;height:60px;background:var(--card);border-top:1px solid var(--bd);display:flex;justify-content:space-around;align-items:center;color:var(--t3)}
.bot div{display:flex;flex-direction:column;align-items:center;gap:3px;font-size:10px;font-family:"Inter Tight";letter-spacing:.04em;text-transform:uppercase}
.bot .on{color:var(--t1)}
.cnt{font-family:"Inter Tight";font-size:12px;color:var(--t3);margin-top:8px}
`;

const ICON = (d) => `<svg class="ico" viewBox="0 0 24 24">${d}</svg>`;
const I = {
  menu: ICON('<path d="M4 6h16M4 12h16M4 18h16"/>'),
  bell: ICON('<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10 21a2 2 0 0 0 4 0"/>'),
  search: ICON('<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>'),
  chev: ICON('<path d="m6 9 6 6 6-6"/>'),
  chevR: ICON('<path d="m9 6 6 6-6 6"/>'),
  home: ICON('<path d="M3 11l9-8 9 8v9a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/>'),
  team: ICON('<circle cx="9" cy="8" r="3.5"/><path d="M2 20a7 7 0 0 1 14 0"/><circle cx="17" cy="9" r="2.5"/><path d="M15 14.5a5 5 0 0 1 7 4.5"/>'),
  cal: ICON('<rect x="3" y="5" width="18" height="16" rx="2"/><path d="M3 10h18M8 3v4M16 3v4"/>'),
  cols: ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16M15 4v16"/>'),
  swap: ICON('<path d="M4 7h13l-3-3M20 17H7l3 3"/>'),
  table: ICON('<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M3 10h18M3 15h18M9 4v16"/>'),
  sort: ICON('<path d="M4 6h10M4 12h7M4 18h4M17 8v10M14 15l3 3 3-3"/>'),
};

const shell = (title, body, extraCss = "") => `<!doctype html><html lang="da"><head><meta charset="utf-8"><meta name="viewport" content="width=375"><style>${BASE}${extraCss}</style></head><body>
<div class="top"><span class="wm">CYCLING ZONE</span><span style="display:flex;gap:16px">${I.bell}${I.menu}</span></div>
<div class="page">
<div class="h1">Mit hold</div><div class="sub">Sæson 3 · 22 ryttere · lønbudget 78 % brugt</div>
<div class="tabs"><span class="tab on">Trup (22)</span><span class="tab">Udvikling</span><span class="tab">Statistik</span><span class="tab">Transfers</span></div>
${body}
</div>
<div class="bot"><div>${I.home}Hjem</div><div class="on">${I.team}Hold</div><div>${I.cal}Løb</div><div>${I.swap}Marked</div><div>${I.menu}Mere</div></div>
</body></html>`;

const filterBar = (right) => `<div class="fb"><div class="in s">${I.search}Søg rytter</div>${right}</div>`;
const sel = (label) => `<div class="in h">${label}${I.chev}</div>`;

// Brug: node docs/design/gdd/mockups/2026-09-10-5102-build.mjs  (skriver PNG/HTML til ./out ved siden af scriptet)
// ---------- 0: i dag (PR #5099-stilen: pinned navn + vandret scroll) ----------
const today = () => {
  const rows = R.map(r => `<tr>
<td class="stk"><div class="nm"><span class="dot"></span>${r.fn} ${r.ln}</div><div class="ml" style="padding-left:13px">${r.nat} · ${r.age} år · ${r.t1}/${r.t2} · ${r.ovr}</div></td>
<td class="num data val">${n(r.val)}</td><td class="num data t2">${n(r.sal)}</td><td class="data">${r.pot}</td><td class="num data">${r.pop}</td><td class="data t2">S${r.ce}</td>
${r.st.map(s=>`<td class="num data">${s}</td>`).join("")}</tr>`).join("");
  return shell("i dag", filterBar(sel("Alle typer")+sel("Værdi ↓")) + `<div class="card"><div style="overflow:auto"><table style="width:max-content;min-width:100%"><thead><tr>
<th class="stk">Rytter</th><th class="num">Værdi</th><th class="num">Løn</th><th>Pot.</th><th class="num">Omd.</th><th>Kontrakt</th>${STATS.map(s=>`<th class="num">${s}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table></div></div><div class="cnt">22 ryttere · scroll til siden for flere kolonner</div>`,
  `.stk{position:sticky;left:0;background:var(--card);border-right:1px solid var(--bd);min-width:148px;max-width:148px;white-space:normal}`);
};

// ---------- A: kort pr. rytter med fold ----------
const modelA = () => {
  const card = (r, open) => `<div class="rc${open?" open":""}">
<div class="rh"><div style="min-width:0"><div class="nm"><span class="dot"></span>${r.fn} ${r.ln}</div><div class="ml" style="padding-left:13px">${r.nat} · ${r.age} år · ${r.t1}/${r.t2}</div></div>
<div class="kv"><div><span class="k">OVR</span><span class="v data">${r.ovr}</span></div><div><span class="k">Værdi</span><span class="v data val">${n(r.val)}</span></div>${I.chev}</div></div>
${open?`<div class="rb"><div class="g"><div><span class="k">Løn</span><span class="v data">${n(r.sal)}</span></div><div><span class="k">Pot.</span><span class="v data">${r.pot}</span></div><div><span class="k">Omd.</span><span class="v data">${r.pop}</span></div><div><span class="k">Kontrakt</span><span class="v data">S${r.ce}</span></div></div>
<div class="g9">${STATS.map((s,i)=>`<div><span class="k">${s}</span><span class="v data">${r.st[i]}</span></div>`).join("")}</div></div>`:""}</div>`;
  return shell("A", filterBar(sel("Alle typer")+sel("Værdi ↓")) + `<div class="card">${R.slice(0,7).map((r,i)=>card(r,i===0)).join("")}</div><div class="cnt">22 ryttere · tryk på en rytter for alle tal</div>`,
  `.rc{border-bottom:1px solid var(--bd)}.rc:last-child{border-bottom:0}
.rh{display:flex;justify-content:space-between;align-items:center;gap:8px;padding:9px 10px}
.kv{display:flex;align-items:center;gap:12px;color:var(--t3)}.kv>div{display:flex;flex-direction:column;align-items:flex-end}
.k{font-family:"Inter Tight";font-size:10px;letter-spacing:.06em;text-transform:uppercase;color:var(--t3)}.v{font-size:13px;color:var(--t1);line-height:1.2}
.rb{padding:0 10px 10px;background:var(--sub);border-top:1px solid var(--bd)}
.g{display:grid;grid-template-columns:repeat(4,1fr);gap:6px;padding:8px 0 6px}.g>div,.g9>div{display:flex;flex-direction:column}
.g9{display:grid;grid-template-columns:repeat(9,1fr);gap:2px;padding-top:6px;border-top:1px solid var(--bd)}.g9 .v{font-size:12px}`);
};

// ---------- B: få standardkolonner + kolonnevælger + "fuld tabel" ----------
const modelB = () => {
  const rows = R.map(r => `<tr>
<td><div class="nm"><span class="dot"></span>${r.fn} ${r.ln}</div><div class="ml" style="padding-left:13px">${r.nat} · ${r.age} år · ${r.t1}/${r.t2}</div></td>
<td class="num data">${r.ovr}</td><td class="num data val">${n(r.val)}</td><td class="num data t2">${n(r.sal)}</td></tr>`).join("");
  return shell("B", filterBar(sel("Alle typer")+sel("Værdi ↓")) +
  `<div class="chips"><div class="cs"><span class="chip on">OVR</span><span class="chip on">Værdi</span><span class="chip on">Løn</span><span class="chip">Kontrakt</span><span class="chip">Pot.</span><span class="chip">Omd.</span><span class="chip">Evner</span></div><span class="chip more">${I.table}Fuld tabel</span></div>
  <div class="card"><table><thead><tr><th>Rytter</th><th class="num">OVR</th><th class="num">Værdi</th><th class="num">Løn</th></tr></thead><tbody>${rows}</tbody></table></div><div class="cnt">22 ryttere · 3 af 15 kolonner vist</div>`,
  `.chips{display:flex;gap:6px;margin-bottom:10px;align-items:center}.cs{flex:1 1 0;display:flex;gap:6px;overflow:hidden;min-width:0;-webkit-mask-image:linear-gradient(90deg,#000 78%,transparent)}
.chip{flex:none;height:26px;padding:0 9px;border:1px solid var(--bd);border-radius:999px;background:var(--card);font-family:"Inter Tight";font-size:11px;letter-spacing:.04em;text-transform:uppercase;color:var(--t2);display:flex;align-items:center;gap:4px}
.chip.on{border-color:var(--t1);color:var(--t1)}.chip.more{color:var(--acc);border-color:var(--acc)}.chip .ico{width:14px;height:14px}
th,td{padding-left:6px;padding-right:6px}td:first-child,th:first-child{padding-left:10px}`);
};

// ---------- C: to-lags: fast navneblok + scrollbar datablok ----------
const modelC = () => {
  const names = R.map(r => `<div class="nr"><div class="nm"><span class="dot"></span>${r.fn} ${r.ln}</div><div class="ml" style="padding-left:13px">${r.nat} · ${r.age} · ${r.t1}</div></div>`).join("");
  const data = R.map(r => `<tr><td class="num data">${r.ovr}</td><td class="num data val">${n(r.val)}</td><td class="num data t2">${n(r.sal)}</td><td class="data">${r.pot}</td><td class="num data">${r.pop}</td><td class="data t2">S${r.ce}</td>${r.st.map(s=>`<td class="num data">${s}</td>`).join("")}</tr>`).join("");
  return shell("C", filterBar(sel("Alle typer")+sel("Værdi ↓")) + `<div class="card"><div class="two">
<div class="nb"><div class="nh">Rytter</div>${names}</div>
<div class="db"><table><thead><tr><th class="num">OVR</th><th class="num">Værdi</th><th class="num">Løn</th><th>Pot.</th><th class="num">Omd.</th><th>Kontr.</th>${STATS.map(s=>`<th class="num">${s}</th>`).join("")}</tr></thead><tbody>${data}</tbody></table></div>
<div class="hint">${I.chevR}</div></div></div><div class="cnt">22 ryttere · 15 kolonner · sortér ved at trykke på en overskrift</div>`,
  `.two{display:flex;position:relative}
.nb{flex:none;width:140px;border-right:1px solid var(--bd);background:var(--card)}
.nh{font-family:"Inter Tight";font-size:11px;font-weight:500;letter-spacing:.06em;text-transform:uppercase;color:var(--t3);padding:8px 10px;border-bottom:1px solid var(--bd);height:33px}
.nr{padding:7px 10px;border-bottom:1px solid var(--bd);height:40px}.nr:last-child{border-bottom:0}
.db{flex:1 1 0;overflow:auto}.db table{width:max-content}.db th{height:33px}.db td{height:40px}
.hint{position:absolute;right:0;top:0;height:33px;width:26px;display:flex;align-items:center;justify-content:center;color:var(--t3);background:linear-gradient(90deg,rgba(252,251,247,0),var(--card))}`);
};

const files = { "0-idag": today(), "A-kort": modelA(), "B-kolonner": modelB(), "C-tolag": modelC() };
const browser = await chromium.launch();
for (const [name, html] of Object.entries(files)) {
  const p = `${OUT}/${name}.html`;
  writeFileSync(p, html);
  const page = await browser.newPage({ viewport: { width: 375, height: 812 }, deviceScaleFactor: 2 });
  await page.goto("file:///" + p.replace(/\\/g, "/"));
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(100);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  await page.close();
}
await browser.close();
console.log("done", Object.keys(files).join(" "));
