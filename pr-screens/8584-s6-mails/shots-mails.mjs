// #8396: renderer begge S6-mails i Chromium og laver ét annoteret oversigtsbillede pr. dato.
//
//   node pr-screens/8584-s6-mails/shots-mails.mjs
//
// Bruger den rigtige skabelon (backend/lib/emailTemplates.js) med et opdigtet hold ("Hold A",
// "Division 2") og et syntetisk afmeldingslink. Topbilledet og ordmaerket hentes fra
// frontend/public i stedet for cyclingzone.org, saa billederne ogsaa virker foer deploy.
// Sender intet og roerer intet uden for denne mappe.
import { createRequire } from "node:module";
import { existsSync, mkdirSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "../..");
const require = createRequire(join(ROOT, "frontend", "package.json"));
const { chromium } = require("playwright");
const { buildS6SeasonEmail, S6_AUDIENCES } = await import(
  pathToFileURL(join(ROOT, "backend", "lib", "emailTemplates.js")).href
);

const RENDERS = join(HERE, "renders");
mkdirSync(RENDERS, { recursive: true });
const PUBLIC = join(ROOT, "frontend", "public");
const UNSUB = "https://cyclingzone.org/api/email/unsubscribe?token=preview";
const TEAM = { teamName: "Hold A", divisionName: "Division 2" };
const DATES = [
  { edition: "before-start", file: "26-11-torsdag", label: { da: "Torsdag 26/11", en: "Thursday 26/11" } },
  { edition: "started", file: "29-11-soendag", label: { da: "Søndag 29/11", en: "Sunday 29/11" } },
];
const AUDIENCE_LABEL = {
  active: "Aktive (sidst inde under 2 uger)",
  dormant: "Sovende (2-8 uger)",
  away: "Væk (over 8 uger)",
};

function findChromium() {
  if (process.env.CZ_CHROMIUM) return process.env.CZ_CHROMIUM;
  const base = process.env.LOCALAPPDATA ? join(process.env.LOCALAPPDATA, "ms-playwright") : null;
  if (!base || !existsSync(base)) return undefined;
  const shell = readdirSync(base).filter((d) => d.startsWith("chromium_headless_shell-")).sort().pop();
  const exe = shell ? join(base, shell, "chrome-headless-shell-win64", "chrome-headless-shell.exe") : null;
  return exe && existsSync(exe) ? exe : undefined;
}

function esc(s) {
  return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

// Billeder fra cyclingzone.org serveres lokalt; alt andet udefra blokeres.
async function routeAssets(ctx, { imagesOff = false } = {}) {
  await ctx.route("**/*", async (route) => {
    const url = new URL(route.request().url());
    if (url.protocol === "data:" || url.protocol === "about:") return route.continue();
    if (!imagesOff && url.hostname === "cyclingzone.org" && /\/(email|brand)\//.test(url.pathname)) {
      const file = join(PUBLIC, decodeURIComponent(url.pathname));
      if (existsSync(file)) return route.fulfill({ body: readFileSync(file), contentType: "image/png" });
    }
    return route.abort();
  });
}

// Nummererede maerker paa de elementer, som oversigten forklarer.
const MARKERS = [
  ["img.cz-hero", "1"],
  ["h1", "2"],
  [".cz-body > p:nth-of-type(1)", "3"],
  [".cz-body > p:nth-of-type(2)", "4"],
  ["a.cz-btn", "5"],
  [".cz-muted", "6"],
];

async function render(browser, html, { width, dark = false, imagesOff = false, annotate = false }) {
  const ctx = await browser.newContext({ viewport: { width, height: 900 }, deviceScaleFactor: 1, colorScheme: dark ? "dark" : "light" });
  await routeAssets(ctx, { imagesOff });
  const page = await ctx.newPage();
  await page.setContent(html, { waitUntil: "load" });
  await page.waitForTimeout(150);
  if (annotate) {
    await page.evaluate((markers) => {
      for (const [selector, label] of markers) {
        const el = document.querySelector(selector);
        if (!el) continue;
        const r = el.getBoundingClientRect();
        const dot = document.createElement("div");
        dot.textContent = label;
        dot.style.cssText = `position:absolute;left:${Math.max(2, r.left - 30)}px;top:${r.top + window.scrollY + 2}px;width:24px;height:24px;border-radius:12px;background:#d6336c;color:#fff;font:700 14px/24px Arial,sans-serif;text-align:center;z-index:9;box-shadow:0 0 0 2px #fff;`;
        document.body.appendChild(dot);
      }
    }, MARKERS);
  }
  const buf = await page.screenshot({ fullPage: true });
  await ctx.close();
  return buf;
}

function dataUrl(buf) {
  return `data:image/png;base64,${buf.toString("base64")}`;
}

const browser = await chromium.launch({ executablePath: findChromium() });
try {
  for (const date of DATES) {
    const mails = {};
    const shots = {};
    for (const language of ["en", "da"]) {
      for (const audience of S6_AUDIENCES) {
        const mail = buildS6SeasonEmail({ edition: date.edition, audience, language, unsubscribeUrl: UNSUB, ...TEAM });
        mails[`${language}-${audience}`] = mail;
        for (const width of [390, 700]) {
          const buf = await render(browser, mail.html, { width });
          shots[`${language}-${audience}-${width}`] = buf;
          await (await import("node:fs/promises")).writeFile(join(RENDERS, `${date.file}-${language}-${audience}-${width}.png`), buf);
        }
      }
    }
    const fallback = buildS6SeasonEmail({ edition: date.edition, audience: "active", language: "da", unsubscribeUrl: UNSUB });
    const extra = {
      annotated: await render(browser, mails["da-active"].html, { width: 700, annotate: true }),
      imagesOff: await render(browser, mails["en-dormant"].html, { width: 390, imagesOff: true }),
      dark: await render(browser, mails["da-away"].html, { width: 390, dark: true }),
      fallback: await render(browser, fallback.html, { width: 390 }),
    };

    const en = mails["en-active"];
    const da = mails["da-active"];
    const phones = ["en", "da"].flatMap((lang) =>
      S6_AUDIENCES.map((aud) => `<figure><figcaption><b>${lang.toUpperCase()}</b> · ${esc(AUDIENCE_LABEL[aud])} · 390 px</figcaption><img src="${dataUrl(shots[`${lang}-${aud}-390`])}" width="270"></figure>`)
    ).join("");
    const wides = ["en", "da"].map((lang) => `<figure><figcaption><b>${lang.toUpperCase()}</b> · Aktive · 700 px</figcaption><img src="${dataUrl(shots[`${lang}-active-700`])}" width="400"></figure>`).join("");
    const openings = (lang) => S6_AUDIENCES.map((aud) => `<li><b>${esc(AUDIENCE_LABEL[aud])}:</b> ${esc(mails[`${lang}-${aud}`].text.split("\n\n")[3])}</li>`).join("");
    const cta = en.html.match(/<a class="cz-btn" href="([^"]+)"/)[1].replaceAll("&amp;", "&");

    const sheet = `<!doctype html><html><head><meta charset="utf-8"><style>
      body{margin:0;padding:32px;background:#eceae4;font:15px/1.45 "Segoe UI",Arial,sans-serif;color:#1a1a1a;width:1900px}
      h1{margin:0 0 4px;font-size:30px} h2{margin:28px 0 10px;font-size:20px}
      .meta{display:grid;grid-template-columns:1fr 1fr;gap:16px 32px;background:#fff;border:1px solid #d8d5cc;border-radius:5px;padding:20px 24px}
      .meta div{min-width:0} .k{color:#5a5a5a;font-size:13px;text-transform:uppercase;letter-spacing:.5px}
      code{font-size:12px;word-break:break-all;background:#f4f2ec;padding:1px 4px;border-radius:3px}
      .row{display:flex;flex-wrap:wrap;gap:20px;align-items:flex-start}
      figure{margin:0;background:#fff;border:1px solid #d8d5cc;border-radius:5px;padding:10px}
      figcaption{font-size:13px;margin:0 0 8px;color:#333;max-width:460px}
      figure img{display:block;border:1px solid #e3e0d8}
      ol.notes li{margin:0 0 6px} .pin{display:inline-block;width:22px;height:22px;border-radius:11px;background:#d6336c;color:#fff;text-align:center;font:700 13px/22px Arial;margin-right:6px}
    </style></head><body>
      <h1>S6-mail · ${esc(date.label.da)} / ${esc(date.label.en)}</h1>
      <div>Udkast til ejergodkendelse #8396. Hold A og Division 2 er opdigtede eksempler. Intet er sendt.</div>
      <h2>Emne (A/B), preheader og knap</h2>
      <div class="meta">
        <div><div class="k">EN emne A / B</div>${esc(en.subjectVariants.a)} (${en.subjectVariants.a.length}) · ${esc(en.subjectVariants.b)} (${en.subjectVariants.b.length})</div>
        <div><div class="k">DA emne A / B</div>${esc(da.subjectVariants.a)} (${da.subjectVariants.a.length}) · ${esc(da.subjectVariants.b)} (${da.subjectVariants.b.length})</div>
        <div><div class="k">EN preheader</div>${esc(en.preheader)}</div>
        <div><div class="k">DA preheader</div>${esc(da.preheader)}</div>
        <div><div class="k">Primær knap (EN / DA)</div>${esc(en.text.match(/\n\n([^\n]+): https:\/\/cyclingzone\.org\/(training|planning)/)[1])} / ${esc(da.text.match(/\n\n([^\n]+): https:\/\/cyclingzone\.org\/(training|planning)/)[1])}</div>
        <div><div class="k">Dybt link (UTM bevaret)</div><code>${esc(cta)}</code></div>
      </div>
      <h2>Tre grupper, hver med egen indledning</h2>
      <div class="meta"><div><div class="k">EN</div><ul>${openings("en")}</ul></div><div><div class="k">DA</div><ul>${openings("da")}</ul></div></div>
      <h2>Annoteret (DA, aktive, 700 px)</h2>
      <div class="row">
        <figure><img src="${dataUrl(extra.annotated)}" width="560"></figure>
        <ol class="notes" style="list-style:none;padding:0;max-width:640px">
          <li><span class="pin">1</span>Topbillede: rigtige skærmbilleder fra preview-mocken (løbsside v6 med løbsfilm, træningssiden med dagsvælger, potentiale 1-99). Hostes som <code>/email/s6/s6-hero-&lt;sprog&gt;.png</code> med absolut URL og alt-tekst på navy flade.</li>
          <li><span class="pin">2</span>Én h1 med datoen. &lt;title&gt; = emnet, lang og dir på &lt;html&gt; og første tabel.</li>
          <li><span class="pin">3</span>Hilsen med holdnavn (fallback "Hi," / "Hej,").</li>
          <li><span class="pin">4</span>Én linje om spillerens eget hold med S6-division (fallback uden division).</li>
          <li><span class="pin">5</span>Én primær knap, 48 px høj, 16 px tekst, dybt link med UTM (utm_content = gruppe og emnevariant).</li>
          <li><span class="pin">6</span>Footer: hvorfor du får mailen, signeret afmeldingslink, Dolmer Digital og CVR. One-click-headeren sættes af afsenderen.</li>
          <li style="margin-top:14px">Brødtekst 16 px, footer 14 px. Ingen Discord-knap, så der kun er én handling. Tekstversion følger med.</li>
        </ol>
      </div>
      <h2>Alle grupper på telefon (390 px)</h2>
      <div class="row">${phones}</div>
      <h2>Bred (700 px), billeder slået fra, mørk tilstand og fallback</h2>
      <div class="row">${wides}
        <figure><figcaption><b>EN</b> · Sovende · billeder slået fra (alt-tekst på navy)</figcaption><img src="${dataUrl(extra.imagesOff)}" width="270"></figure>
        <figure><figcaption><b>DA</b> · Væk · mørk tilstand (farvelåsen holder lys)</figcaption><img src="${dataUrl(extra.dark)}" width="270"></figure>
        <figure><figcaption><b>DA</b> · Aktive · uden holdnavn og division</figcaption><img src="${dataUrl(extra.fallback)}" width="270"></figure>
      </div>
    </body></html>`;
    const ctx = await browser.newContext({ viewport: { width: 1964, height: 1200 }, deviceScaleFactor: 1 });
    const page = await ctx.newPage();
    await page.setContent(sheet, { waitUntil: "load" });
    await page.waitForTimeout(300);
    const out = join(HERE, `${date.file}-oversigt.png`);
    await page.screenshot({ path: out, fullPage: true });
    await ctx.close();
    console.log("ok", out);
  }
} finally {
  await browser.close();
}
