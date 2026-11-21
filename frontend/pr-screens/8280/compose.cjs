// Laver ÉT billede pr. retning: FØR (rigtig app, preview-mock) og EFTER (skitse)
// side om side ved 390 og 1440, bogstav + én sætning øverst og nummererede noter.
// Brug: dev-serveren kører (`npm run dev:preview`), så `node compose.cjs <config.json>`.
// Config: { out, sketch, items: [{ file, letter, title, line, notes[], before, query }] }
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const cfg = JSON.parse(fs.readFileSync(process.argv[2], "utf8"));
const BASE = "http://localhost:5173";
const consent = () => {
  try {
    localStorage.setItem("cz_consent_v1", JSON.stringify({ version: 1, necessary: true, analytics: false, marketing: false, email_marketing: false, updated_at: new Date().toISOString() }));
  } catch (e) { /* skitse */ }
};

async function shot(browser, url, w, mobile) {
  const ctx = await browser.newContext({ viewport: { width: w, height: w === 390 ? 844 : 900 }, deviceScaleFactor: 2, isMobile: mobile, hasTouch: mobile, locale: "en-US" });
  await ctx.addInitScript(consent);
  const p = await ctx.newPage();
  await p.goto(BASE + url, { waitUntil: "networkidle" });
  await p.waitForTimeout(url.includes("sketches") ? 800 : 2500);
  const buf = await p.screenshot();
  await ctx.close();
  return "data:image/png;base64," + buf.toString("base64");
}

(async () => {
  const b = await chromium.launch(fs.existsSync("/opt/pw-browsers/chromium") ? { executablePath: "/opt/pw-browsers/chromium" } : {});
  const cp = await b.newPage({ viewport: { width: 1720, height: 1400 }, deviceScaleFactor: 2 });
  fs.mkdirSync(cfg.out, { recursive: true });
  for (const it of cfg.items) {
    const sk = (w) => `${cfg.sketch}?${it.query}&w=${w}`;
    const [b390, a390, b1440, a1440] = [
      await shot(b, it.before, 390, true), await shot(b, sk(390), 390, false),
      await shot(b, it.before, 1440, false), await shot(b, sk(1440), 1440, false),
    ];
    const n390 = it.noPhoto ? await shot(b, sk(390) + "&photo=0&marks=0", 390, false) : null;
    const width = n390 ? 1680 : 1520;
    const lab = (t) => `<div style="font:700 12px system-ui;letter-spacing:.08em;margin-bottom:6px">${t}</div>`;
    const img = (src, w, h) => `<img src="${src}" style="width:${w}px;height:${h}px;display:block;border:1px solid #c9c4b8">`;
    await cp.setContent(`<html><body style="margin:0;background:#e9e6de;color:#15161c;font-family:system-ui,sans-serif">
      <div id="w" style="width:${width}px;padding:20px">
        <div style="display:flex;align-items:baseline;gap:14px">
          <div style="font:800 44px system-ui;line-height:1;background:#15161c;color:#e8c547;padding:6px 14px;border-radius:5px">${it.letter}</div>
          <div><div style="font:700 24px system-ui">${it.title}</div><div style="font-size:17px;margin-top:4px">${it.line}</div></div>
        </div>
        <div style="display:flex;gap:28px;margin-top:18px">
          <div>${lab("FØR (i dag) · 390")}${img(b390, 390, 844)}</div>
          <div>${lab("EFTER (skitse) · 390")}${img(a390, 390, 844)}</div>
          ${n390 ? `<div>${lab("EFTER, UDEN BILLEDE · 390")}${img(n390, 390, 844)}</div>` : ""}
          <div style="flex:1;padding-top:22px">
            ${lab("ÆNDRINGER (røde numre i skitsen)")}
            <ol style="margin:0;padding-left:22px;font-size:15px;line-height:1.45">${it.notes.map((n) => `<li style="margin-bottom:8px">${n}</li>`).join("")}</ol>
            ${it.aside ? `<div style="margin-top:14px;font-size:13px;color:#5b5a55;line-height:1.45">${it.aside}</div>` : ""}
          </div>
        </div>
        <div style="display:flex;gap:28px;margin-top:22px">
          <div>${lab("FØR (i dag) · 1440")}${img(b1440, 732, 457)}</div>
          <div>${lab("EFTER (skitse) · 1440")}${img(a1440, 732, 457)}</div>
        </div>
        <div style="font-size:11px;margin-top:10px;color:#5b5a55">390 × 844 og 1440 × 900 · preview-mock · ${cfg.ref}</div>
      </div></body></html>`);
    await cp.waitForTimeout(300);
    const el = await cp.$("#w");
    await el.screenshot({ path: path.join(cfg.out, it.file) });
    console.log("wrote", it.file);
  }
  await b.close();
})();
