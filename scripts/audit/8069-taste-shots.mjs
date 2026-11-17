// scripts/audit/8069-taste-shots.mjs: billeder til TASTE-forslaget og top 10 (#8069, PR #8235).
//
// Koerer mod preview-mocken (ingen login, ingen backend, ingen prod-data):
//   VITE_SUPABASE_URL=https://cycling-zone-e2e.supabase.co VITE_SUPABASE_ANON_KEY=e2e-anon-key \
//     npm run dev:preview --prefix frontend -- --port 5173
//   node scripts/audit/8069-taste-shots.mjs [id ...]      # fx F1 T03; uden id: alle
//
// "Foer" er siden som den er i dag. "Efter" er en SKITSE: CSS/DOM aendres i
// browseren for billedets skyld. Ingen produktkode aendres. Hvert billede faar
// id, navn og en saetning braendt ind oeverst. Uddata: frontend/pr-screens/8069-taste/.
import { createRequire } from "node:module";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const require = createRequire(resolve(ROOT, "frontend/package.json"));
const { chromium } = require("playwright");
const BASE = process.env.CZ_PREVIEW_URL || "http://localhost:5173";
const OUT = resolve(ROOT, "frontend/pr-screens/8069-taste");
const EXE = process.env.CZ_CHROMIUM || "/opt/pw-browsers/chromium";
mkdirSync(OUT, { recursive: true });

const CONSENT = JSON.stringify({ necessary: true, analytics: false, updated_at: "2026-11-16T00:00:00Z" });
const VIEW = { 1440: { width: 1440, height: 900 }, 1280: { width: 1280, height: 900 }, 390: { width: 390, height: 844 } };

// ---------- i siden: annoteringer (roede, stiplede: de er ikke en del af designet) ----------
const ANNOTATE = () => {
  const layer = () => {
    let l = document.getElementById("__ann");
    if (!l) { l = document.createElement("div"); l.id = "__ann"; l.style.cssText = "position:absolute;left:0;top:0;width:100%;height:0;z-index:2147483647;pointer-events:none;font:600 12px/1.2 system-ui,sans-serif"; document.body.appendChild(l); }
    return l;
  };
  const sy = () => window.scrollY;
  window.__line = (y, label, color = "#d32f2f") => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:0;right:0;top:${y + sy()}px;border-top:2px dashed ${color}`;
    const t = document.createElement("span"); t.textContent = label;
    t.style.cssText = `position:absolute;right:8px;top:-20px;background:${color};color:#fff;padding:2px 6px;border-radius:3px;white-space:nowrap`;
    d.appendChild(t); layer().appendChild(d);
  };
  window.__span = (y1, y2, label, color = "#d32f2f", x = 6) => {
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${x}px;top:${y1 + sy()}px;height:${y2 - y1}px;width:10px;border:2px solid ${color};border-right:0`;
    const t = document.createElement("span"); t.textContent = label;
    t.style.cssText = `position:absolute;left:14px;top:50%;transform:translateY(-50%);background:${color};color:#fff;padding:2px 6px;border-radius:3px;white-space:nowrap`;
    d.appendChild(t); layer().appendChild(d);
  };
  window.__box = (el, n, label, color = "#d32f2f") => {
    if (!el) return;
    const b = el.getBoundingClientRect();
    const d = document.createElement("div");
    d.style.cssText = `position:absolute;left:${b.left - 4}px;top:${b.top + sy() - 4}px;width:${b.width + 8}px;height:${b.height + 8}px;border:2px dashed ${color};border-radius:4px`;
    const t = document.createElement("span"); t.textContent = n + (label ? " " + label : "");
    t.style.cssText = `position:absolute;left:-2px;top:-22px;background:${color};color:#fff;padding:2px 6px;border-radius:3px;white-space:nowrap`;
    d.appendChild(t); layer().appendChild(d);
  };
  window.__byText = (sel, re) => [...document.querySelectorAll(sel)].find((e) => re.test(e.textContent || ""));
  window.__rect = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { top: Math.round(b.top), bottom: Math.round(b.bottom), left: Math.round(b.left), right: Math.round(b.right), width: Math.round(b.width), height: Math.round(b.height) }; };
  window.__css = (css) => { const s = document.createElement("style"); s.textContent = css; document.head.appendChild(s); };
};

async function shoot(browser, { url, vw, prep, clip, fullPage, routes, scrollTo }) {
  const ctx = await browser.newContext({ viewport: VIEW[vw], deviceScaleFactor: 2 });
  await ctx.addInitScript((c) => { try { localStorage.setItem("cz_consent_v1", c); } catch { /* ignore */ } }, CONSENT);
  await ctx.addInitScript(ANNOTATE);
  const page = await ctx.newPage();
  // Svar-overrides INDE i siden: preview-mocken fanger fetch foer netvaerket, saa
  // page.route naar aldrig derned. Wrapperen ligger over mockens fetch.
  if (routes && routes.length) await ctx.addInitScript((list) => {
    let current = window.fetch;
    const wrapped = (input, init) => {
      const u = typeof input === "string" ? input : (input && input.url) || "";
      const hit = list.find(([re]) => new RegExp(re).test(u));
      if (hit) return Promise.resolve(new Response(JSON.stringify(hit[1]), { status: 200, headers: { "content-type": "application/json" } }));
      return current(input, init);
    };
    Object.defineProperty(window, "fetch", { configurable: true, get: () => wrapped, set: (v) => { current = v; } });
  }, routes);
  await page.goto(BASE + url, { waitUntil: "load" });
  await page.waitForTimeout(3500);
  if (scrollTo) await page.evaluate((y) => window.scrollTo(0, y), scrollTo);
  let meta = null;
  if (prep) meta = await prep(page);
  await page.waitForTimeout(400);
  const png = await page.screenshot({ clip, fullPage: !!fullPage });
  await ctx.close();
  return { png, meta };
}

function esc(s) { return String(s).replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" })[c]); }

// Saml paneler i et ark: id + navn + saetning oeverst, noter nederst.
async function compose(browser, { id, title, sentence, rows, notes, file }) {
  const html = `<!doctype html><meta charset=utf-8><style>
  body{margin:0;background:#f4f2ec;font:14px/1.4 system-ui,-apple-system,"Segoe UI",sans-serif;color:#1b1f2a}
  .hd{background:#1b2236;color:#fff;padding:18px 24px;display:flex;gap:16px;align-items:baseline}
  .id{background:#c9a227;color:#1b2236;font-weight:800;padding:3px 10px;border-radius:4px;font-size:18px}
  .t{font-weight:700;font-size:20px}.s{color:#cfd4e2;font-size:15px;margin-top:4px}
  .row{display:flex;gap:16px;padding:16px 24px 0;align-items:flex-start}
  .p{background:#fff;border:1px solid #d9d5ca;border-radius:5px;padding:8px}
  .p h4{margin:0 0 6px;font-size:13px;text-transform:uppercase;letter-spacing:.06em;color:#555}
  .p h4 b{color:#1b2236}.p img{display:block;border:1px solid #e6e2d8}
  .n{padding:14px 24px 20px;font-size:14px}.n ol{margin:6px 0 0 18px;padding:0}
  </style><div class=hd><span class=id>${esc(id)}</span><div><div class=t>${esc(title)}</div><div class=s>${esc(sentence)}</div></div></div>
  ${rows.map((r) => `<div class=row>${r.map((p) => `<div class=p><h4><b>${esc(p.label)}</b>${p.sub ? " · " + esc(p.sub) : ""}</h4><img src="data:image/png;base64,${p.png.toString("base64")}" style="width:${p.w}px"></div>`).join("")}</div>`).join("")}
  ${notes && notes.length ? `<div class=n><b>Noter</b><ol>${notes.map((n) => `<li>${esc(n)}</li>`).join("")}</ol></div>` : "<div class=n></div>"}`;
  const ctx = await browser.newContext({ viewport: { width: 400, height: 300 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  await page.setContent(html);
  const w = await page.evaluate(() => Math.max(...[...document.querySelectorAll(".row")].map((r) => r.scrollWidth), 900));
  await page.setViewportSize({ width: w, height: 300 });
  const png = await page.screenshot({ fullPage: true });
  await ctx.close();
  writeFileSync(resolve(OUT, file), png);
  console.log("skrevet", file);
}

// ---------- F1: 250 px-reglen paa loebssiden v6 ----------
const raceMeasure = async (page) => page.evaluate(() => {
  const h1 = document.querySelector("h1");
  const hero = h1.closest("[class*='rounded-cz']") || h1.parentElement;
  const strip = window.__byText("main *", /Sat 03:00 PM/) ? [...document.querySelectorAll("main div")].filter((d) => /Sat 03:00 PM/.test(d.textContent) && /Sun 03:00 PM/.test(d.textContent)).sort((a, b) => a.getBoundingClientRect().height - b.getBoundingClientRect().height)[0] : null;
  const tabs = document.querySelector("[role=tablist]");
  const row = [...document.querySelectorAll("main li, main tr")].find((e) => /Mikkel Hansen/.test(e.textContent) && e.getBoundingClientRect().height < 80);
  return { hero: window.__rect(hero), strip: window.__rect(strip), tabs: window.__rect(tabs), row: window.__rect(row) };
});

const ITEMS = {};

ITEMS.F1 = async (b) => {
  const url = "/races/race-done-2?racePageV6=on";
  const before = await shoot(b, { url, vw: 1280, prep: async (p) => {
    const m = await raceMeasure(p);
    await p.evaluate((m) => {
      window.__span(0, m.strip.top, `hoved ${m.strip.top} px`, "#d32f2f", 985);
      window.__span(m.strip.top, m.strip.bottom, `etapestribe ${m.strip.height} px`, "#1565c0", 985);
      window.__span(m.strip.bottom, m.row.top, `faner + kort-hoved ${m.row.top - m.strip.bottom} px`, "#6d4c41", 985);
      window.__line(250, "250 px");
      window.__line(m.row.top, `første datarække ${m.row.top} px`, "#2e7d32");
    }, m);
    return m;
  } });
  const m = before.meta;
  const A = await shoot(b, { url, vw: 1280, prep: async (p) => {
    await p.evaluate((m) => {
      window.__span(0, m.strip.top, `hoved ${m.strip.top} px: under 250, OK`, "#2e7d32", 985);
      window.__span(m.strip.top, m.strip.bottom, `etapestribe = data, tæller ikke`, "#1565c0", 985);
      window.__line(250, "250 px");
    }, m);
  } });
  const B = await shoot(b, { url, vw: 1280, prep: async (p) => {
    // Skitse: lavere hoved. Stat-raekkens underlinjer vaek, mindre luft, stat-raekken rykker op ved siden af titlen.
    await p.evaluate(() => {
      const h1 = document.querySelector("h1");
      const hero = h1.closest("[class*='rounded-cz']");
      window.__css(`h1{font-size:30px!important}`);
      hero.querySelectorAll("*").forEach((e) => { const cs = getComputedStyle(e); if (parseFloat(cs.paddingTop) >= 16) { e.style.paddingTop = "10px"; e.style.paddingBottom = "10px"; } });
      [...hero.querySelectorAll("div")].filter((d) => /^(All ridden|Ada Pedersen|1 abandon)$/.test(d.textContent.trim())).forEach((d) => (d.style.display = "none"));
      hero.querySelectorAll("*").forEach((e) => { if (e.children.length === 0 && parseFloat(getComputedStyle(e).fontSize) >= 19 && e.tagName !== "H1") e.style.fontSize = "16px"; });
    });
    const m2 = await raceMeasure(p);
    await p.evaluate((m) => {
      window.__span(0, m.strip.top, `hoved ${m.strip.top} px`, m.strip.bottom <= 250 ? "#2e7d32" : "#d32f2f", 985);
      window.__span(m.strip.top, m.strip.bottom, `etapestribe ${m.strip.height} px`, "#1565c0", 985);
      window.__line(250, "250 px");
      window.__line(m.strip.bottom, `hoved + stribe ${m.strip.bottom} px`, m.strip.bottom <= 250 ? "#2e7d32" : "#d32f2f");
    }, m2);
    return m2;
  } });
  const m2 = B.meta;
  await compose(b, {
    id: "F1", title: "250 px-reglen og etapestriben (løbssiden v6, 1280×900)",
    sentence: "A: striben er data og tæller ikke, hovedet over den skal under 250 px. B: reglen står, hovedet gøres lavere.",
    rows: [[
      { label: "I dag", sub: "målt", png: before.png, w: 640 },
      { label: "A · striben er data", sub: "anbefalet", png: A.png, w: 640 },
      { label: "B · lavere hoved", sub: "skitse", png: B.png, w: 640 },
    ]],
    notes: [
      `Målt i dag: hoved (sidens top til striben) ${m.strip.top} px, etapestribe ${m.strip.height} px, hoved + stribe ${m.strip.bottom} px, første datarække ved ${m.row.top} px.`,
      `A: hovedet er ${m.strip.top} px og holder 250 px uden ændringer. Faner og kortets hoved (${m.row.top - m.strip.bottom} px) er stadig chrome; dem rører A ikke.`,
      `B: med mindre titel (30 px), stat-tal 16 px, mindre luft og uden stat-underlinjer bliver hoved + stribe ${m2.strip.bottom} px${m2.strip.bottom <= 250 ? ", altså under 250" : ", stadig over 250; der skal mere til (fx stat-rækken ind i titellinjen)"}. Det koster underlinjerne ("All ridden" o.l.).`,
      "Modern web guidance: ingen af dem er en sticky bjælke, så 12 %-reglen for faste bjælker gælder ikke. Begge holder 'ingen bannere over indholdet'.",
    ],
    file: "F1-250px-etapestribe-A-B.png",
  });
};

// ---------- hjaelpere til de oevrige billeder ----------
const REMINDER = {
  enabled: true, tone: "warning", count: 2, window_hours: 48, urgent_hours: 6,
  races: [
    { id: "race-up-1", name: "Tour de Preview", deadline_at: "2026-11-17T12:00:00Z", hours_until: 12, entry_count: 4, target_size: 8, tone: "warning" },
    { id: "race-live-1", name: "Settimana Preview", deadline_at: "2026-11-17T20:00:00Z", hours_until: 20, entry_count: 6, target_size: 7, tone: "warning" },
  ],
};
const REMINDER_ROUTE = [["/api/me/selection-reminder", REMINDER]];
// Fristen som EN linje i hovedets handlingsraekke (skitse af F3/T01).
const deadlineInHeader = async (p) => p.evaluate(() => {
  const box = document.querySelector("[role=status]");
  const h1 = document.querySelector("h1");
  const header = h1.closest("div.flex") ? h1.closest("div.flex").parentElement : h1.parentElement;
  if (box) box.remove();
  const line = document.createElement("a");
  line.href = "#";
  line.textContent = "Deadline in 12 h · 2 races need a squad";
  line.style.cssText = "font:600 13px/1.2 'Inter Tight',system-ui;color:#a07800;white-space:nowrap;align-self:center;font-variant-numeric:tabular-nums";
  const actions = h1.closest("header, div")?.parentElement?.querySelector("a[class*='secondary'], a[href='/planning/workbench']");
  const row = header.querySelector(":scope > div:last-child") || header;
  (actions ? actions.parentElement : row).prepend(line);
  if (!actions) { header.style.display = "flex"; header.style.justifyContent = "space-between"; header.style.alignItems = "center"; header.appendChild(line); }
  window.__box(line, "1", "frist i hovedet");
});
const PAGEHEADER_H1 = "font-family:var(--font-data,'Inter Tight'),system-ui!important;font-size:20px!important;font-weight:700!important;letter-spacing:-0.01em!important;text-transform:none!important;line-height:1.5!important";
const pair = (label1, label2, a, b, w) => [{ label: label1, sub: a.sub, png: a.png, w }, { label: label2, sub: b.sub, png: b.png, w }];
async function fourUp(b, { id, title, sentence, url, url390, before, after, notes, file, routes, scrollTo, scrollTo390 }) {
  const s = (vw, prep, u, y) => shoot(b, { url: u || url, vw, prep, routes, scrollTo: y });
  const b1 = await s(1440, before, url, scrollTo), a1 = await s(1440, after, url, scrollTo);
  const b3 = await s(390, before, url390, scrollTo390), a3 = await s(390, after, url390, scrollTo390);
  await compose(b, { id, title, sentence, file, notes, rows: [
    [{ label: "Før · 1440", sub: "i dag", png: b1.png, w: 720 }, { label: "Efter · 1440", sub: "skitse", png: a1.png, w: 720 }],
    [{ label: "Før · 390", sub: "i dag", png: b3.png, w: 330 }, { label: "Efter · 390", sub: "skitse", png: a3.png, w: 330 }],
  ] });
}

// ---------- F2: et spil paa web, mobil og app ----------
ITEMS.F2 = async (b) => {
  const a = await shoot(b, { url: "/team", vw: 1440 });
  const m = await shoot(b, { url: "/team", vw: 390 });
  await compose(b, { id: "F2", title: "P20 · Ét spil på web, mobil og app", sentence: "Samme komponenter, tokens, fonte og ikoner på alle skærme; kun geometrien skifter. Appen er mobilsiden.",
    rows: [[{ label: "Web · 1440", sub: "Mit hold i dag", png: a.png, w: 900 }, { label: "Mobil = app · 390", sub: "samme side", png: m.png, w: 330 }]],
    notes: ["Eksemplet viser, at Mit hold allerede er ét design: samme tabel (DataTable), samme mærker og guld-regel; mobil viser navn + tre tal (D-047).", "Reglen forbyder et app-eget udseende senere (#6584 Google Play): ingen platform-kontroller og ingen komponent, der kun findes i appen.", "Modern web guidance (form-factor-adaptation): lever op. Layout tilpasses formfaktoren, trykflader 44 px på touch, safe-area-insets til appens kanter."],
    file: "F2-et-spil-web-mobil-app.png" });
};

// ---------- F3 / T01: fristboksen paa Planlaegning ----------
const planningBefore = async (p) => p.evaluate(() => { window.__box(document.querySelector("[role=status]"), "1", "boks mellem hoved og faner"); });
ITEMS.F3 = async (b) => {
  const be = await shoot(b, { url: "/planning", vw: 1440, routes: REMINDER_ROUTE, prep: planningBefore });
  const af = await shoot(b, { url: "/planning", vw: 1440, routes: REMINDER_ROUTE, prep: deadlineInHeader });
  await compose(b, { id: "F3", title: "Frist og tip er ikke bannere (regel 3 fra 12/11, præciseret)", sentence: "En frist er én linje i hovedets handlingsrække, aldrig en boks mellem hovedet og indholdet.",
    rows: [pair("Før", "Efter", { png: be.png, sub: "Planlægning i dag" }, { png: af.png, sub: "skitse" }, 720)],
    notes: ["Boksen (1) skubber fanerne og tabellen ned på hver side med en frist. Efter: én linje i guld-tekst i hovedet; listen over løb ligger ét klik væk (selve linjen linker til løbene).", "Mock-data: fristen er sat ind med en eksempel-påmindelse (2 løb, 12 t), så boksen kan ses.", "Modern web guidance (content-first-noise-reduction): lever op. 'Where possible, remove banners and unrelated content that compete with the main content.'"],
    file: "F3-frist-i-hovedet.png" });
};
ITEMS.T01 = (b) => fourUp(b, { id: "T01", title: "Fristboksen på Planlægning ind i hovedet", sentence: "Spilleren ser fanerne og løbene med det samme; fristen står stadig synligt i hovedet.", url: "/planning", routes: REMINDER_ROUTE, before: planningBefore, after: deadlineInHeader,
  notes: ["Planlægning har 2.714 visninger på 30 dage. Boksen fylder ca. 120 px på 1440 og mere på 390, hvor den ombryder.", "Mock-data: eksempel-påmindelse med 2 løb."], file: "T01-planlaegning-frist.png" });

// ---------- F4: mobiltabellen ved 390 ----------
ITEMS.F4 = async (b) => {
  const now = await shoot(b, { url: "/team", vw: 390, prep: async (p) => p.evaluate(() => window.__box(document.querySelector("table"), "1", "navn + 3 tal")) });
  const old = await shoot(b, { url: "/team", vw: 390, prep: async (p) => { const btn = await p.$("text=Full table"); if (btn) { await btn.click(); await p.waitForTimeout(500); } await p.evaluate(() => window.__box(document.querySelector("table"), "1", "vandret scroll")); } });
  await compose(b, { id: "F4", title: "§6 række 6: mobiltabellen er D-047, ikke 'pinned navn + vandret scroll'", sentence: "Rettelse af et forældet punkt: dokumentet beskrev en standard, der blev afløst 10/9.",
    rows: [pair("Gammel række 6", "D-047 i dag (gælder)", { png: old.png, sub: "vandret scroll som standard" }, { png: now.png, sub: "navn + tre tal" }, 360)],
    notes: ["Til venstre: det, den gamle række beskrev, vist med 'Full table' (to-lags, vandret scroll). Det er i dag kun en tilvalgt visning.", "Til højre: standarden siden 10/9: navn + rating, værdi, løn uden vandret scroll; chip-rækken bytter kolonner.", "Modern web guidance (responsive-table): afviger delvist. Guiden anbefaler en stablet kort-visning via container queries; ejeren valgte 10/9 tre kolonner + chips (variant med kort pr. rytter blev afvist). Kolonne-overskrifter er bevaret, så semantikken holder."],
    file: "F4-mobiltabel-D047.png" });
};

// ---------- F5: overlay 384 px ----------
ITEMS.F5 = async (b) => {
  const s = await shoot(b, { url: "/riders", vw: 1440, prep: async (p) => {
    const t = await p.$("main table tbody tr span.cursor-pointer:has(svg)");
    if (t) { await t.hover(); await p.waitForTimeout(1500); }
    return p.evaluate(() => {
      const card = [...document.querySelectorAll("[popover], [role=dialog], [aria-labelledby]")].find((e) => { const w = e.getBoundingClientRect().width; return w > 250 && w < 500; });
      if (!card) return null;
      const r = window.__rect(card);
      window.__box(card, "1", `${r.width} px bredt`);
      const ghost = document.createElement("div");
      ghost.style.cssText = `position:absolute;left:${r.left}px;top:${r.top + window.scrollY}px;width:360px;height:${r.height}px;border:2px dashed #1565c0;pointer-events:none;z-index:2147483646`;
      const lab = document.createElement("span"); lab.textContent = "2 P18's 'ca. 360 px'"; lab.style.cssText = "position:absolute;left:0;bottom:-22px;background:#1565c0;color:#fff;font:600 12px system-ui;padding:2px 6px;border-radius:3px";
      ghost.appendChild(lab); document.getElementById("__ann").appendChild(ghost);
      return r;
    });
  } });
  await compose(b, { id: "F5", title: "§5a er P18's opskrift: hover-kortet er 384 px", sentence: "Overlay-afsnittet var markeret 'ikke godkendt', selvom P18 er godkendt; bredden rettes til det byggede.",
    rows: [[{ label: "Hover-kortet i dag", sub: s.meta ? `målt ${s.meta.width} px` : "ikke åbnet", png: s.png, w: 1100 }]],
    notes: [s.meta ? `Kortet (1) måler ${s.meta.width} px i bredden. Den blå ramme (2) viser P18's 'ca. 360 px'. Forslaget skriver 384 px begge steder.` : "Kortet kunne ikke åbnes i mocken; bredden 384 px står i koden (w-[24rem]).", "Modern web guidance (hovercard): lever op i retning: guiden bruger popover + anchor positioning og prefers-reduced-motion på fade; P18 kræver det samme ('browserens popover og ankerpositionering'). Anchor positioning har begrænset support og kræver fallback, som guiden beskriver."],
    file: "F5-overlay-384px.png" });
};

// ---------- F6: score i procent ----------
ITEMS.F6 = async (b) => {
  const html = `<div style="font:14px/1.5 'Inter Tight',system-ui;padding:20px;background:#fff;width:900px">
  <table style="border-collapse:collapse;width:100%;font-variant-numeric:tabular-nums">
  <tr style="text-align:left;color:#777;font-size:11px;text-transform:uppercase"><th style="padding:6px">Side (audit 2/9)</th><th>Ja / relevante</th><th>Gammel skala (/17)</th><th>Ny skala (%)</th><th>Bånd</th></tr>
  ${[["Indbakke", 18, 21], ["Planlægning", 16, 21], ["Dashboard", 13, 21], ["Auktioner", 11, 21]].map(([n, y, t]) => { const pc = Math.round((y / t) * 100); const band = pc >= 95 ? "verdensklasse" : pc >= 80 ? "på system" : "skal have en runde"; return `<tr style="border-top:1px solid #ddd"><td style="padding:6px">${n}</td><td>${y} / ${t}</td><td>giver ikke mening (21 ≠ 17)</td><td>${pc} %</td><td>${band}</td></tr>`; }).join("")}
  </table></div>`;
  const ctx = await b.newContext({ viewport: { width: 940, height: 300 }, deviceScaleFactor: 2 }); const p = await ctx.newPage(); await p.setContent(html); const png = await p.screenshot({ fullPage: true }); await ctx.close();
  await compose(b, { id: "F6", title: "Scoren regnes i procent", sentence: "Tjeklisten har 22 spørgsmål, ikke 17; '17/17' kan ikke længere bruges, procent kan.",
    rows: [[{ label: "Eksempel", sub: "auditten 2/9 regnet om", png, w: 900 }]],
    notes: ["Auditten 2/9 normaliserede allerede til /21 for at kunne rangere sider; forslaget gør det til reglen.", "Grænserne svarer til de gamle: 95 % ≈ 17/17, 80-94 % ≈ 14-16/17. Dobbeltvægtede spørgsmål (2, 7, 8, 13) er uændrede.", "Modern web guidance: ikke relevant (procesregel)."],
    file: "F6-score-procent.png" });
};

// ---------- F7 / T02: haandlavet guld mod Button ----------
const openDirectOffer = async (p) => { const btn = await p.$("button:has-text('offer')") || await p.$("button:has-text('Offer')"); if (btn) { await btn.click(); await p.waitForTimeout(600); } };
const markHandGold = async (p) => p.evaluate(() => {
  const hand = [...document.querySelectorAll("button")].filter((e) => /bg-cz-accent(?![\/-])/.test(e.className) && /font-bold/.test(e.className));
  hand.forEach((h, i) => window.__box(h, String(i + 1), "håndlavet"));
  return hand.length;
});
const toButton = async (p) => p.evaluate(() => {
  const ref = [...document.querySelectorAll("button, a")].find((e) => /bg-cz-accent(?![\/-])/.test(e.className) && /font-semibold/.test(e.className));
  const hand = [...document.querySelectorAll("button")].filter((e) => /bg-cz-accent(?![\/-])/.test(e.className) && /font-bold/.test(e.className));
  hand.forEach((h, i) => { if (ref) h.className = ref.className + (/w-full/.test(h.className) ? " w-full" : ""); window.__box(h, String(i + 1), "Button primary"); });
  return hand.length;
});
ITEMS.F7 = async (b) => {
  const url = "/riders/rider-2";
  const be = await shoot(b, { url, vw: 1440, prep: async (p) => { await openDirectOffer(p); return markHandGold(p); } });
  const af = await shoot(b, { url, vw: 1440, prep: async (p) => { await openDirectOffer(p); return toButton(p); } });
  await compose(b, { id: "F7", title: "Forbud mod håndlavet guld-knap", sentence: "Guld-knappen findes kun som Button/buttonClass; en håndlavet kopi kan vagterne ikke se.",
    rows: [pair("Før · håndlavet", "Efter · Button primary", { png: be.png, sub: `${be.meta} håndlavede i view'et` }, { png: af.png, sub: "samme klasser som resten" }, 720)],
    notes: ["Rytterprofilen for en anden managers rytter: budknappen (Bid) i auktionspanelet. Den håndlavede knap er font-bold og har egen højde; Button er font-semibold og følger størrelses-skalaen.", "Forskellen er lille for øjet; pointen er, at 'én guld pr. view'-tællingen og række-vagten (#4625) kun kender Button. 13 håndlavede i spillerflader i dag.", "Modern web guidance (css: design tokens): lever op. Én komponent bærer token og størrelse, i stedet for kopier af klasserne."],
    file: "F7-haandlavet-guld.png" });
};
ITEMS.T02 = (b) => fourUp(b, { id: "T02", title: "Håndlavede guld-knapper til Button + CI-vagt", sentence: "Spilleren ser samme knap overalt (vægt, højde, trykflade); vagten fanger nye kopier.", url: "/riders/rider-2", scrollTo390: 900,
  before: async (p) => { await openDirectOffer(p); return markHandGold(p); }, after: async (p) => { await openDirectOffer(p); return toButton(p); },
  notes: ["På 390 giver Button trykfladen 44 px (P16) uden særskilt min-h; de håndlavede har min-h-[44px] skrevet i hånden.", "Steder: Transfers 4, Bestyrelsen 4, rytterprofilen 5, CompareSelection, BoardEmptyState, OnboardingTour."], file: "T02-guld-knap-button.png" });

// ---------- F8: T3 bred ----------
ITEMS.F8 = async (b) => {
  const old = await shoot(b, { url: "/races/race-done-2?racePageV6=off", vw: 1440 });
  const neu = await shoot(b, { url: "/races/race-done-2?racePageV6=on", vw: 1440 });
  await compose(b, { id: "F8", title: "Små rettelser: CLAUDE.md-blokken nævner T3 bred (1600 px)", sentence: "T3 med tabeller i fanerne bruger 1600 px (godkendt 12/11); skabelonens kopi-blok sagde stadig kun 1024 px.",
    rows: [pair("T3 1024 px", "T3 bred 1600 px", { png: old.png, sub: "løbssiden i dag" }, { png: neu.png, sub: "løbssiden v6 (bag kontakt)" }, 720)],
    notes: ["Kun tekst i PAGE_TEMPLATES ændres; reglen er allerede godkendt. P17 flyttes desuden før P18 (rækkefølge), og kilderne peger på rapporten.", "Modern web guidance (responsive-design): lever op. Bredden er et loft (max-width), ikke en fast bredde."],
    file: "F8-T3-bred.png" });
};

// ---------- T03: rounded 4 px -> 5 px ----------
const radiusFix = async (p) => p.evaluate(() => window.__css(`[class~="rounded"]{border-radius:5px!important}`));
const zoomBadges = async (p, fix) => { if (fix) await radiusFix(p); return p.evaluate(() => { const t = document.querySelector("main table"); if (t) { if (innerWidth > 600) t.style.zoom = "1.6"; window.__box(t.querySelector("tbody tr"), "1", ""); } }); };
ITEMS.T03 = (b) => fourUp(b, { id: "T03", title: "4 px-hjørner til 5 px i rytter-mærkerne (kit)", sentence: "Ét kit-sted (RiderTypeBadge, TeamCell, statColor) gør hjørnerne ens på seks af de ti mest besøgte sider.", url: "/riders", scrollTo390: 420,
  before: (p) => zoomBadges(p, false), after: (p) => zoomBadges(p, true),
  notes: ["Tabellen er zoomet 1,6× for at gøre forskellen synlig. Forskellen er 1 px pr. hjørne; den mærkes som 'alt er samme familie', ikke som en ny side.", "57 × ren 'rounded' i spillerflader i dag; lint-ui-slop fanger kun md/lg/xl."], file: "T03-radius-5px.png" });

// ---------- T04: Dashboard-bredde ----------
const dashBefore = async (p) => p.evaluate(() => { const c = document.querySelector("[translate=no].max-w-5xl") || document.querySelector(".max-w-5xl"); const r = window.__rect(c); if (c) window.__box(c, "1", `container ${r.width} px`); });
const dashAfter = async (p) => { await radiusFix(p); return p.evaluate(() => { const c = document.querySelector("[translate=no].max-w-5xl") || document.querySelector(".max-w-5xl"); if (c) { c.style.maxWidth = "896px"; const r = window.__rect(c); window.__box(c, "1", `T1 ${r.width} px`); } }); };
ITEMS.T04 = (b) => fourUp(b, { id: "T04", title: "Dashboard: bredde efter regel 2 (anbefaling T1 896 px)", sentence: "Dashboardet er kort, ikke tabeller; det følger læsebredden som Indbakken.", url: "/dashboard", before: dashBefore, after: dashAfter,
  notes: ["Dit valg (#8073, én side ad gangen): A 896 px (anbefalet, samme som Indbakke/Bestyrelsen) eller B 1600 px med to kolonner. Billedet viser A.", "På 390 er der ingen forskel; begge fylder skærmen med 16 px kant.", "Mest besøgte side (12.038 visninger)."], file: "T04-dashboard-bredde.png" });

// ---------- T05: rytterprofilens Bebas-korttitler ----------
const bebasBefore = async (p) => p.evaluate(() => { [...document.querySelectorAll("h3.font-display")].slice(0, 4).forEach((h, i) => window.__box(h, String(i + 1), "Bebas")); });
ITEMS.T05 = (b) => fourUp(b, { id: "T05", title: "Rytterprofilen: Bebas kun på navnet (P4)", sentence: "Kort-titlerne i fanerne bliver kortets 15/600; navnet i heroen er stadig det ene store ord.", url: "/riders/rider-1",
  before: bebasBefore, after: async (p) => p.evaluate((css) => { window.__css(`h3.font-display,h4.font-display{${css}}`); [...document.querySelectorAll("h3.font-display")].slice(0, 4).forEach((h, i) => window.__box(h, String(i + 1), "15/600")); }, PAGEHEADER_H1.replace("20px", "15px").replace("font-weight:700", "font-weight:600")),
  scrollTo: 430, scrollTo390: 1150,
  notes: ["Billedet viser Oversigt-fanen (Physical, Mental, Technical, Rider types). Samme Bebas-korttitel (17 px, versaler) i Palmarès, Træning, Fysiologi, Scouting og Udvikling. P4 tillader kun Bebas på hero-navnet.", "Udviklingsfanens venstre-accent-bjælke (§3-forbud) fjernes i samme PR."], file: "T05-profil-bebas.png" });

// ---------- T06: emoji ud af copy ----------
const ZAP = '<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:-2px;margin-right:4px"><path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/></svg>';
const emojiBefore = async (p) => p.evaluate(() => { const e = [...document.querySelectorAll("body *")].find((x) => x.children.length === 0 && /⚡/.test(x.textContent)); window.__box(e, "1", "emoji"); });
const emojiAfter = async (p) => p.evaluate((zap) => { const e = [...document.querySelectorAll("body *")].find((x) => x.children.length === 0 && /⚡/.test(x.textContent)); if (e) { e.textContent = e.textContent.replace(/⚡\s*/, ""); e.insertAdjacentHTML("afterbegin", zap); window.__box(e, "1", "stroke-ikon"); } }, ZAP);
ITEMS.T06 = (b) => fourUp(b, { id: "T06", title: "Emoji ud af spillervendt tekst", sentence: "⚡, ✅, 🎉, 🚨 og ⭐ bliver spillets stroke-ikoner; teksten står alene.", url: "/riders/rider-1", before: emojiBefore, after: emojiAfter,
  notes: ["Eksempel: '⚡ Active auction' på rytterprofilen. Samme mønster i toasts på Transfers ('✅ Offer sent!') og Watchlist (⭐ i tom tilstand).", "Toasts har deres egen ikonplads, så emojien står der to gange. EN først, DA bagefter; copy-ordlyd til ejerens review."], file: "T06-emoji-ud.png" });

// ---------- T07: OEkonomi ----------
const finBefore = async (p) => p.evaluate(() => { const h = document.querySelector("h1"); window.__box(h.parentElement, "1", "eget sidehoved"); const c = h.closest(".max-w-3xl"); const r = window.__rect(c); window.__box(c, "2", `${r.width} px`); window.__box(window.__byText("main div", /How your finances work/) && [...document.querySelectorAll("main div")].filter((d) => /How your finances work/.test(d.textContent)).sort((a, b) => a.textContent.length - b.textContent.length)[0].closest("[class*='rounded']"), "3", "tip øverst"); });
const finAfter = async (p) => p.evaluate((css) => {
  const h = document.querySelector("h1"); h.style.cssText = css;
  const c = h.closest(".max-w-3xl"); c.style.maxWidth = "896px";
  const tip = [...document.querySelectorAll("main div")].filter((d) => /How your finances work/.test(d.textContent)).sort((a, b) => a.textContent.length - b.textContent.length)[0]?.closest("[class*='rounded']");
  if (tip) tip.remove();
  const head = h.parentElement; head.style.cssText = "display:flex;justify-content:space-between;align-items:center;margin-bottom:24px";
  const wrap = document.createElement("div"); wrap.appendChild(h.cloneNode(true)); const sub = head.querySelector("p"); if (sub) wrap.appendChild(sub); h.remove(); head.prepend(wrap);
  const btn = document.createElement("button"); btn.textContent = "Show me around"; btn.className = "inline-flex items-center justify-center gap-2 font-semibold rounded-cz border border-cz-border bg-cz-card text-cz-1 text-xs px-3 py-1.5"; head.appendChild(btn);
  window.__box(head, "1", "PageHeader"); const r = window.__rect(c); window.__box(c, "2", `T1 ${r.width} px`);
}, PAGEHEADER_H1);
ITEMS.T07 = (b) => fourUp(b, { id: "T07", title: "Økonomi: PageHeader, T1 896 px, tip i rundvisningen", sentence: "Siden får samme hoved og bredde som resten; tallene står øverst i stedet for et forklaringskort.", url: "/finance", before: finBefore, after: finAfter,
  notes: ["(1) eget <h1> → PageHeader. (2) 768 px → 896 px (T1). (3) 'How your finances work' flyttes bag 'Show me around' i hovedet.", "Lånevilkårs-tabellen (længere nede) flyttes til DataTable med tabular figures i samme PR."], file: "T07-oekonomi.png" });

// ---------- T08: Klub (og Scouting) ----------
const klubBefore = async (p) => p.evaluate(() => window.__box(document.querySelector("h1"), "1", "Bebas-sidehoved"));
const klubAfter = async (p) => p.evaluate((css) => { const h = document.querySelector("h1"); h.style.cssText = css; window.__box(h, "1", "PageHeader 20/700"); }, PAGEHEADER_H1);
ITEMS.T08 = (b) => fourUp(b, { id: "T08", title: "Klub og Scouting: eget Bebas-sidehoved til PageHeader", sentence: "Sidehovedet ser ud som på alle andre sider; Bebas er forbeholdt hero-navne.", url: "/klub", before: klubBefore, after: klubAfter,
  notes: ["Scouting har samme brud (Bebas-h1 + Bebas-korttitler 21 px) og rettes i samme PR.", "Kort-titlerne på Klub (Training Center osv.) er 15/600 og står uændret."], file: "T08-klub-pageheader.png" });

// ---------- T09: fyldt guld som aktiv tilstand ----------
const pressCompare = async (p) => { const btn = await p.$("button.h-6.w-6[aria-pressed]"); if (btn) { await btn.click(); await p.waitForTimeout(400); } };
const goldBefore = async (p) => { await pressCompare(p); return p.evaluate(() => { const e = document.querySelector("button.h-6.w-6[aria-pressed=true]"); if (e) { window.__box(e, "1", "fyldt guld"); } }); };
const goldAfter = async (p) => { await pressCompare(p); return p.evaluate(() => { const e = document.querySelector("button.h-6.w-6[aria-pressed=true]"); if (e) { e.classList.remove("bg-cz-accent", "text-cz-on-accent"); e.style.background = "color-mix(in srgb, var(--accent, #c9a227) 10%, transparent)"; e.style.color = "var(--accent-t, #a07800)"; window.__box(e, "1", "guld-tekst på 10 %"); } }); };
ITEMS.T09 = (b) => fourUp(b, { id: "T09", title: "Fyldt guld som 'valgt' bliver P3's aktiv-tilstand", sentence: "Guld-fyld er forbeholdt sidens ene primære knap; en valgt knap er guld-tekst på 10 % guld.", url: "/standings", before: goldBefore, after: goldAfter,
  notes: ["Eksempel: sammenlign-knappen på Stillinger efter et klik. Samme fejl i Bestyrelsens guide (aktivt trin) og 'My races'-chippen på Planlægning.", "StatsToggle og CompareSelection får samtidig shadow-overlay i stedet for shadow-xl."], file: "T09-aktiv-tilstand.png" });

// ---------- T10: foerstegangs-tip paa Auktioner ----------
const tipEl = () => [...document.querySelectorAll("main div")].filter((d) => /Win the bid, the rider joins your team/.test(d.textContent)).sort((a, b) => a.textContent.length - b.textContent.length)[0]?.closest("[class*='rounded'], [class*='border']");
const aucBefore = async (p) => p.evaluate((f) => { const t = eval(f)(); window.__box(t, "1", "tip mellem hoved og filtre"); }, `(${tipEl})`);
const aucAfter = async (p) => p.evaluate((f) => { const t = eval(f)(); if (t) t.remove(); const h1 = document.querySelector("h1"); const actions = h1.closest("div.flex")?.parentElement?.querySelector("button, a"); if (actions) window.__box(actions.parentElement, "1", "rundvisning / Hjælp i hovedet"); }, `(${tipEl})`);
ITEMS.T10 = (b) => fourUp(b, { id: "T10", title: "Førstegangs-tip på Auktioner ud af toppen", sentence: "Rytterlisten står lige under filtrene; forklaringen ligger i rundvisningen og Hjælp.", url: "/auctions", before: aucBefore, after: aucAfter,
  notes: ["Tippet fylder ca. 130 px på 1440 og over 250 px på 390, før første rytter.", "Modern web guidance (content-first-noise-reduction): lever op. Onboarding-tips hører i popovers eller en tour, ikke som permanent indhold over data."], file: "T10-auktioner-tip.png" });

const only = process.argv.slice(2);
const browser = await chromium.launch({ executablePath: EXE });
try {
  for (const [id, fn] of Object.entries(ITEMS)) if (!only.length || only.includes(id)) await fn(browser);
} finally { await browser.close(); }
