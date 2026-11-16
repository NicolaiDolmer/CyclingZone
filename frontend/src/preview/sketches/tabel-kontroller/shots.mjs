// #8280: levende wireframes af kontrolomraadet over tabeller, tre retninger.
//
//   node frontend/src/preview/sketches/tabel-kontroller/shots.mjs        # A, B og C
//   node frontend/src/preview/sketches/tabel-kontroller/shots.mjs B      # kun B
//
// Starter selv Vite med preview-mocken (VITE_PREVIEW_MOCK, ingen login, ingen
// backend, ingen prod-data) i SAMME proces, tager billederne med Playwright fra
// frontend/node_modules og lukker serveren igen. "I dag" er siden som den er paa
// branchen; retningen er en skitse bygget i browseren (recipes.mjs). Ingen
// produktkode aendres. Uddata: frontend/pr-screens/tabel-kontroller/.
//
// CZ_CHROMIUM kan pege paa en anden Chromium (fx naar Playwrights egen version
// ikke er hentet paa maskinen); CZ_SKETCH_PORT vaelger porten (default 5291).
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { installSketchLib } from "./sketchLib.mjs";
import { rankings, riders, team } from "./recipes.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const FRONTEND = resolve(HERE, "../../../..");
const OUT = resolve(FRONTEND, "pr-screens/tabel-kontroller");
const require = createRequire(resolve(FRONTEND, "package.json"));
mkdirSync(OUT, { recursive: true });

// Preview-mocken, aldrig prod: samme e2e-vaerdier som Playwright-fixtures bruger.
process.env.VITE_PREVIEW_MOCK = "1";
process.env.VITE_SUPABASE_URL = "https://cycling-zone-e2e.supabase.co";
process.env.VITE_SUPABASE_ANON_KEY = "e2e-anon-key";

function findChromium() {
  if (process.env.CZ_CHROMIUM) return process.env.CZ_CHROMIUM;
  const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : null;
  if (!base || !existsSync(base)) return undefined;
  const shell = readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  const exe = shell ? join(base, shell, "chrome-headless-shell-win64", "chrome-headless-shell.exe") : null;
  return exe && existsSync(exe) ? exe : undefined;
}

const CONSENT = JSON.stringify({ necessary: true, analytics: false, updated_at: "2026-11-16T00:00:00Z" });
const VIEW = { 390: { width: 390, height: 844 }, 1440: { width: 1440, height: 900 } };
const PAGES = {
  rankings: { url: "/standings", name: "Rankings", fn: rankings },
  riders: { url: "/riders", name: "Rytterdatabase", fn: riders },
  team: { url: "/team", name: "Mit hold", fn: team },
};
// Raekkerne i hvert billede: Rankings i lys og moerk, de to andre sider i hver sin.
const ROWS = [
  { page: "rankings", theme: "light" },
  { page: "rankings", theme: "dark" },
  { page: "riders", theme: "light" },
  { page: "team", theme: "dark" },
];

async function shoot(browser, base, { page: key, theme, vw, dir = null, open = null }) {
  const ctx = await browser.newContext({ viewport: VIEW[vw], deviceScaleFactor: 2 });
  await ctx.addInitScript(({ c, th }) => {
    try {
      localStorage.setItem("cz_consent_v1", c);
      localStorage.setItem("cz_lang", "en");
      localStorage.setItem("cz-theme", th);
    } catch { /* preview uden storage: siden viser bare standarden */ }
  }, { c: CONSENT, th: theme });
  await ctx.addInitScript(installSketchLib);
  const page = await ctx.newPage();
  await page.goto(base + PAGES[key].url, { waitUntil: "load" });
  await page.waitForSelector("main table tbody tr", { timeout: 30000 });
  await page.waitForTimeout(2500);
  if (dir) await page.evaluate(`(${PAGES[key].fn.toString()})(${JSON.stringify(dir)}, ${JSON.stringify(open ? { open } : {})})`);
  await page.waitForTimeout(300);
  const m = await page.evaluate(() => window.__sk.measure());
  await page.evaluate((mm) => window.__sk.ruler(mm, mm.color), { ...m, color: dir ? "#2e7d32" : "#c62828" });
  const png = await page.screenshot();
  await ctx.close();
  return { png, m };
}

const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]);

async function compose(browser, { letter, title, sentence, rows, notes, file }) {
  const panel = (p) => `<div class=p><h4><b>${esc(p.label)}</b>${p.sub ? " · " + esc(p.sub) : ""}</h4><img src="data:image/png;base64,${p.png.toString("base64")}" style="width:${p.w}px"></div>`;
  const html = `<!doctype html><meta charset=utf-8><style>
  body{margin:0;background:#f4f2ec;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1f2a}
  .hd{background:#1b2236;color:#fff;padding:18px 24px;display:flex;gap:16px;align-items:center}
  .id{background:#c9a227;color:#1b2236;font-weight:800;padding:4px 14px;border-radius:4px;font-size:28px}
  .t{font-weight:700;font-size:22px}.s{color:#cfd4e2;font-size:16px;margin-top:4px}
  .rl{padding:18px 24px 0;font-weight:700;font-size:15px;color:#1b2236}
  .row{display:flex;gap:14px;padding:8px 24px 0;align-items:flex-start}
  .p{background:#fff;border:1px solid #d9d5ca;border-radius:5px;padding:8px}
  .p h4{margin:0 0 6px;font-size:12px;letter-spacing:.04em;color:#555;font-weight:500}
  .p h4 b{color:#1b2236;font-weight:700}.p img{display:block;border:1px solid #e6e2d8}
  .n{padding:16px 24px 22px;font-size:14px;max-width:1500px}.n ol{margin:6px 0 0 18px;padding:0}.n li{margin:3px 0}
  </style><div class=hd><span class=id>${esc(letter)}</span><div><div class=t>${esc(title)}</div><div class=s>${esc(sentence)}</div></div></div>
  ${rows.map((r) => `<div class=rl>${esc(r.label)}</div><div class=row>${r.panels.map(panel).join("")}</div>`).join("")}
  <div class=n><b>Noter</b><ol>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ol></div>`;
  const ctx = await browser.newContext({ viewport: { width: 900, height: 300 }, deviceScaleFactor: 1 });
  const page = await ctx.newPage();
  await page.setContent(html);
  const w = await page.evaluate(() => Math.max(...[...document.querySelectorAll(".row")].map((r) => r.scrollWidth), 1200));
  await page.setViewportSize({ width: w, height: 300 });
  const png = await page.screenshot({ fullPage: true });
  await ctx.close();
  writeFileSync(resolve(OUT, file), png);
  console.log("skrevet", file);
}

const DIRS = {
  A: {
    file: "A-filterbar-d047-strammet.png",
    title: "Kittet som det er: FilterBar + D-047 strammet",
    sentence: "Søg og to valg på én linje, visning og sammenlign i tabellens værktøjslinje, kolonnevalget som firkantede felter inde i tabellens ramme.",
    extras: [],
    notes: [
      "1 FilterBar (findes i kittet): søg i fuld bredde + to halve valg på mobil, én linje på desktop. Rankings bruger den ikke i dag.",
      "2 Visning (Standings/Squad strength) styrer kun tabellen og flytter ind i tabellens værktøjslinje som Segmented (PAGE_TEMPLATES: tabel-kontroller bor i DataTable's toolbar). 3 Sammenlign følger med.",
      "4 D-047 strammet: kolonnevalget bliver firkantede felter (5 px, hairline) inde i rammen i stedet for runde piller over den. Pille-undtagelsen i TASTE forsvinder. 'Fuld tabel' er et ikon i samme række.",
      "5 Sæson og op/ned-reglen flytter ned i tællelinjen under tabellen, hvor zone-forklaringen allerede står (P9). Boksen 'Movement' forsvinder.",
      "Rytterdatabasen: tredje valg, AI-hold og 'Nulstil' bag 'More filters' på mobil; Pro-boksen og den ekstra 'Sort by'-række væk (overskrifterne sorterer allerede, P1). Mit hold: kun kolonnevalget flytter ind i rammen.",
      "Fordel: ingen nye komponenter, kun regler. Ulempe: stadig 3-4 rækker kontroller på mobil før første hold.",
    ],
  },
  B: {
    file: "B-samlet-valg-og-ark.png",
    title: "Ét samlet valg + søg-ikon + kolonne-ark",
    sentence: "Én knap viser og ændrer alt det, tabellen viser; søg og kolonner er ikoner, og valgene åbner som ark nederst på telefonen.",
    extras: [{ open: "scope", label: "B · arket 'Show standings for'" }, { open: "columns", label: "B · kolonne-arket" }],
    notes: [
      "1 Én knap med et resumé af det valgte ('Division 2 · All · Standings'). Tryk åbner ét ark (P18) med division, pulje og visning som Segmented.",
      "2 Søg er et ikon på mobil (felt på desktop). 3 Kolonner er et ikon med '3/5'; arket viser hvilke tre tal telefonen viser og 'Fuld tabel'. Chip-rækken forsvinder.",
      "4 Sæson og op/ned-reglen står i tællelinjen under tabellen. Sammenlign: tryk på holdets placering (findes i dag); knappen vises først, når to er valgt.",
      "Rytterdatabasen: alle filtre bag én 'Filters'-knap med antal aktive. Mit hold: 'Overview/Abilities' og kolonnerne samles i én knap på mobil; desktop er uændret.",
      "Fordel: én linje (44 px) på alle tabelsider. Ulempe: det valgte er skjult bag et resumé, og hvert skift koster et ekstra tryk; to nye komponenter (scope-knap, kolonne-ark).",
    ],
  },
  C: {
    file: "C-tabellen-baerer-kontrollerne.png",
    title: "Tabellen bærer selv kontrollerne",
    sentence: "Valgene står som tekst i tabellens egen titellinje, og en kolonne byttes ved at trykke på dens overskrift, som i Football Manager og FotMob.",
    extras: [{ open: "picker", label: "C · tryk på 'Prize'-overskriften" }],
    notes: [
      "1 Titellinje inde i tabellens ramme: 'Division 2 · All · Standings' som tekst med en lille chevron (ingen kasser). Hvert ord åbner sit eget valg. Søg er et ikon på mobil, felt på desktop.",
      "2 Kolonneoverskrifterne er kolonnevalget på mobil: tryk på 'Prize' og vælg et andet tal til den plads i et ark (P18), med 'Fuld tabel' nederst. Chip-rækken forsvinder; D-047's tre tal og 'Fuld tabel' er uændrede.",
      "3 Sæson og op/ned-reglen står i tællelinjen under tabellen (samme som A og B).",
      "Benchmark: Football Manager skifter kolonner fra tabellens egen overskrift og 'Views'-menu; FotMob og Sofascore viser ligaens valg som en kort linje lige over tabellen; ProCyclingStats har valgene i én kompakt linje over resultatlisten.",
      "Fordel: lavest chrome, og valget står der man læser (ved tallene). Ulempe: et tryk på overskriften sorterer i dag på desktop; på mobil skal det betyde 'byt kolonne', så sortering flytter ind i samme ark. Ny regel at lære.",
    ],
  },
};

const only = process.argv.slice(2).filter((a) => DIRS[a]);
const { createServer } = await import(pathToFileURL(require.resolve("vite")).href);
const { chromium } = require("playwright");
const port = Number(process.env.CZ_SKETCH_PORT || 5291);
// fs.strict: node_modules er en junction til en delt cache uden for worktreet; uden
// dette naegter Vite at servere flag-icons' SVG'er, og flagene forsvinder.
const server = await createServer({
  root: FRONTEND,
  configFile: resolve(FRONTEND, "vite.config.js"),
  server: { port, strictPort: true, host: "127.0.0.1", hmr: false, fs: { strict: false } },
  logLevel: "error",
});
await server.listen();
const base = `http://127.0.0.1:${port}`;
const browser = await chromium.launch({ executablePath: findChromium() });
try {
  const now = {};
  for (const r of ROWS) for (const vw of [390, 1440]) now[`${r.page}-${r.theme}-${vw}`] = await shoot(browser, base, { ...r, vw });
  const summary = [];
  for (const [letter, d] of Object.entries(DIRS)) {
    if (only.length && !only.includes(letter)) continue;
    const rows = [];
    for (const r of ROWS) {
      const panels = [];
      const pageName = PAGES[r.page].name;
      for (const vw of [390, 1440]) {
        const before = now[`${r.page}-${r.theme}-${vw}`];
        const after = await shoot(browser, base, { ...r, vw, dir: letter });
        const w = vw === 390 ? 300 : 700;
        panels.push({ label: `I dag · ${vw}`, sub: `${before.m.chrome} px · ${before.m.controls} kontroller`, png: before.png, w });
        panels.push({ label: `${letter} · ${vw}`, sub: `${after.m.chrome} px · ${after.m.controls} kontroller`, png: after.png, w });
        summary.push({ letter, page: r.page, theme: r.theme, vw, before: before.m, after: after.m });
      }
      if (r.page === "rankings" && r.theme === "light") {
        for (const x of d.extras) {
          const s = await shoot(browser, base, { ...r, vw: 390, dir: letter, open: x.open });
          panels.push({ label: x.label, sub: "390", png: s.png, w: 300 });
        }
      }
      rows.push({ label: `${pageName} · ${r.theme === "light" ? "lys" : "mørk"}`, panels });
    }
    await compose(browser, { letter, title: d.title, sentence: d.sentence, rows, notes: d.notes, file: d.file });
  }
  writeFileSync(resolve(OUT, "maalinger.json"), JSON.stringify(summary, null, 1) + "\n");
  console.log("skrevet maalinger.json");
} finally {
  await browser.close();
  await server.close();
}
