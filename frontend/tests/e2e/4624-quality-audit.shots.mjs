// #4624 — screenshots + mekaniske slop-maalinger for ALLE manager-app-sider
// (slice 2 af designsystem-epic'et #4622). Ad-hoc capture-script (ikke en del
// af CI-suiten — testMatch fanger kun *.spec.js), samme moenster som
// 2849-quality-dashboard-contract.shots.mjs. Koerer mod en koerende
// preview/dev-server med e2e-netvaerksmocks.
//
//   node tests/e2e/4624-quality-audit.shots.mjs [baseURL] [outDir]

import { chromium } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const fixtures = await import(pathToFileURL(resolve(__dirname, "fixtures.js")).href);
const { installNetworkMocks, login, waitForPageReady } = fixtures;
const routesMod = await import(pathToFileURL(resolve(__dirname, "4624-audit-routes.mjs")).href);
// MSYS/git-bash konverterer argumenter/env-vaerdier der starter med "/" til
// Windows-stier — derfor tager CZ_AUDIT_ONLY route-navne UDEN foerende skraastreg
// (fx "dashboard,riders"), og vi tilfoejer den her.
const ONLY = process.env.CZ_AUDIT_ONLY
  ? process.env.CZ_AUDIT_ONLY.split(",").map((r) => (r.startsWith("/") ? r : `/${r}`))
  : null;
const ROUTES = ONLY ? routesMod.ROUTES.filter((r) => ONLY.includes(r.route)) : routesMod.ROUTES;
const { slugFor } = routesMod;

const BASE = process.argv[2] || "http://127.0.0.1:4468";
const SHOTS_OUT = resolve(__dirname, "../../../docs/screenshots/quality-audit-2026-09");
const AUDITS_OUT = resolve(__dirname, "../../../docs/audits");
const METRICS_JSON = resolve(AUDITS_OUT, "quality-audit-2026-09-metrics.json");

mkdirSync(SHOTS_OUT, { recursive: true });
mkdirSync(AUDITS_OUT, { recursive: true });

const VARIANTS = [
  { name: "desktop-light", width: 1280, height: 900, theme: "light" },
  { name: "desktop-dark", width: 1280, height: 900, theme: "dark" },
  { name: "mobile-light", width: 375, height: 812, theme: "light" },
];

// ── In-page maalefunktion (koeres via page.evaluate) ────────────────────────
function measurePage() {
  // #4624: nogle offentlige sider (login, landing, legal) er ikke pakket i
  // app-shellens <main> (den findes kun under den loggede-ind Layout). Falder
  // tilbage til <body> for de sider, og noterer det i outputtet.
  let main = document.querySelector("main");
  const noMainFallback = !main;
  if (!main) main = document.body;
  if (!main) return { error: "hverken <main> eller <body> fundet" };

  const ARROW_CHARS = ["→", "←", "↔", "↑", "↓", "›", "«", "»"];
  const GLYPH_CHARS = ["✓", "✕", "✦", "▲", "▼", "○", "ⓘ"];

  function isVisible(el) {
    const cs = getComputedStyle(el);
    if (cs.visibility === "hidden" || cs.display === "none") return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  }
  function inSvg(el) {
    return !!(el.closest && el.closest("svg"));
  }
  function inOverlay(el) {
    return !!(
      el.closest &&
      el.closest('[role="dialog"], .modal, [class*="modal" i], [class*="popover" i], [class*="toast" i]')
    );
  }
  function classString(el) {
    if (typeof el.className === "string") return el.className;
    return el.getAttribute ? el.getAttribute("class") || "" : "";
  }
  function isGold(colorStr) {
    const m = colorStr && colorStr.match(/rgba?\((\d+),\s*(\d+),\s*(\d+)/);
    if (!m) return false;
    const r = parseInt(m[1], 10), g = parseInt(m[2], 10), b = parseInt(m[3], 10);
    const close = (a, b2) => Math.abs(a - b2) <= 3;
    return (close(r, 232) && close(g, 197) && close(b, 71)) || (close(r, 255) && close(g, 217) && close(b, 102));
  }

  // ── text-node walk (pile/emoji/glyffer) — main, ekskl. SVG ────────────────
  const walker = document.createTreeWalker(main, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.parentElement) return NodeFilter.FILTER_REJECT;
      if (inSvg(node.parentElement)) return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  let allText = "";
  while (walker.nextNode()) allText += walker.currentNode.textContent + "\n";

  function countChar(text, ch) {
    let n = 0, i = 0;
    while ((i = text.indexOf(ch, i)) !== -1) { n++; i += ch.length; }
    return n;
  }
  let unicodeArrows = 0;
  for (const ch of ARROW_CHARS) unicodeArrows += countChar(allText, ch);
  let textGlyphIcons = 0;
  for (const ch of GLYPH_CHARS) textGlyphIcons += countChar(allText, ch);
  const emojiMatches = allText.match(/\p{Extended_Pictographic}/gu) || [];
  const emojiCount = emojiMatches.filter((m) => !ARROW_CHARS.includes(m) && !GLYPH_CHARS.includes(m)).length;

  // ── element-pass (én gennemloebning af main *) ────────────────────────────
  const all = Array.from(main.querySelectorAll("*"));
  let shadowElements = 0, gradientElements = 0, offTokenRadius = 0, rawHexInClass = 0;
  let goldPrimaryButtons = 0, textBelow10px = 0, textBetween10And12NonToken = 0;
  const bebasEls = new Map();
  const emptyStateEls = [];
  const roundedRe = /rounded-(2xl|xl|lg|md|\[)/;
  const hexInClassRe = /#[0-9a-fA-F]{3,8}/;

  for (const el of all) {
    if (!isVisible(el)) continue;
    const cs = getComputedStyle(el);
    const cls = classString(el);

    if (!inOverlay(el) && cs.boxShadow && cs.boxShadow !== "none") shadowElements++;
    if (cs.backgroundImage && cs.backgroundImage.includes("gradient")) gradientElements++;
    if (cls && roundedRe.test(cls)) offTokenRadius++;
    if (cls && hexInClassRe.test(cls)) rawHexInClass++;
    if ((el.tagName === "BUTTON" || el.tagName === "A") && isGold(cs.backgroundColor)) goldPrimaryButtons++;

    let ownText = "";
    for (const child of el.childNodes) {
      if (child.nodeType === 3) ownText += child.textContent;
    }
    if (ownText.trim()) {
      const fs = parseFloat(cs.fontSize);
      if (fs < 10) textBelow10px++;
      else if (fs >= 10 && fs <= 12) {
        const hasToken = cls.includes("text-2xs") || cls.includes("text-3xs");
        if (!hasToken) textBetween10And12NonToken++;
      }
      if (cs.fontFamily && cs.fontFamily.toLowerCase().includes("bebas")) {
        bebasEls.set(el, ownText.trim());
      }
    }

    const sides = [cs.borderTopStyle, cs.borderRightStyle, cs.borderBottomStyle, cs.borderLeftStyle];
    if (sides.includes("dashed")) {
      const label = el.querySelector("h1,h2,h3,h4,p,strong");
      emptyStateEls.push(((label ? label.textContent : el.textContent) || "").trim().slice(0, 80));
    }
  }

  // ── chrome-foer-data ───────────────────────────────────────────────────────
  const mainRect = main.getBoundingClientRect();
  let target = main.querySelector('table tbody tr, [role="row"], .cz-table tbody tr');
  let measuredOn = "table/row";
  if (!target) {
    const h1El = main.querySelector("h1");
    const h1Bottom = h1El ? h1El.getBoundingClientRect().bottom : mainRect.top;
    const cardCandidates = Array.from(main.querySelectorAll('section, [class*="card" i]'))
      .filter(isVisible)
      .filter((e) => e.getBoundingClientRect().top >= h1Bottom - 4)
      .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    target = cardCandidates[0] || null;
    measuredOn = target ? "card/section-efter-h1" : "intet match";
  }
  const chromeBeforeDataPx = target ? Math.round(target.getBoundingClientRect().top - mainRect.top) : null;

  const h1El = main.querySelector("h1");
  const h1cs = h1El ? getComputedStyle(h1El) : null;

  return {
    noMainFallback,
    chromeBeforeDataPx,
    chromeMeasuredOn: measuredOn,
    unicodeArrows,
    emojiCount,
    textGlyphIcons,
    goldPrimaryButtons,
    shadowElements,
    gradientElements,
    offTokenRadius,
    textBelow10px,
    textBetween10And12NonToken,
    rawHexInClass,
    bebasCount: bebasEls.size,
    bebasSamples: Array.from(bebasEls.values()).slice(0, 3),
    emptyStatesCount: emptyStateEls.length,
    emptyStatesTitles: emptyStateEls.slice(0, 5),
    h1Text: h1El ? h1El.textContent.trim() : null,
    pageTitleFont: h1cs ? `${h1cs.fontFamily} ${h1cs.fontSize}` : null,
    bodyScrollHeight: document.body.scrollHeight,
  };
}

async function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout(${ms}ms): ${label}`)), ms);
  });
  try {
    return await Promise.race([promise, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

async function genericReady(page, spec) {
  // Offentlige sider (login/landing/legal) er ikke pakket i app-shellens
  // <main> — waitForPageReady's generiske main-gate ville saa altid time out.
  // Prøv kort om <main> findes; brug kun den fulde gate hvis den gør.
  const hasMain = await page
    .locator("main")
    .first()
    .waitFor({ state: "visible", timeout: 3000 })
    .then(() => true)
    .catch(() => false);
  if (hasMain) {
    try {
      await withTimeout(waitForPageReady(page, spec), 9000, "waitForPageReady");
    } catch { /* route-specifik gate/stabilisering kunne ikke naas — best effort */ }
  } else {
    await page.locator("body").first().waitFor({ state: "visible", timeout: 3000 }).catch(() => {});
    await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; }).catch(() => {});
  }
  await page.waitForTimeout(250);
}

const results = {};
let allFailures = [];

function saveResults() {
  writeFileSync(METRICS_JSON, JSON.stringify(results, null, 2), "utf8");
}

async function runVariant(browser, variant, group) {
  const routes = ROUTES.filter((r) => r.auth === group);
  if (routes.length === 0) return;

  const context = await browser.newContext({
    baseURL: BASE,
    viewport: { width: variant.width, height: variant.height },
    deviceScaleFactor: 1,
  });
  // #4624: stabilizePage() (fixtures.js) tager en PAGE og kalder page.addInitScript,
  // som kun gaelder den ene side-instans. Vi opretter en ny page pr. route i denne
  // konteksten, saa vi replikerer PRAECIS samme addInitScript-payload paa
  // CONTEXT-niveau (context.addInitScript gaelder alle fremtidige pages).
  await context.addInitScript(() => {
    try {
      window.localStorage.setItem("cz_lang", "da");
      window.localStorage.setItem(
        "cz_consent_v1",
        JSON.stringify({
          version: 1, necessary: true, analytics: false, marketing: false,
          email_marketing: false, updated_at: "2026-05-13T00:00:00.000Z",
        })
      );
    } catch { /* ignore */ }
    const css = `
      *, *::before, *::after {
        animation-duration: 0.001s !important;
        animation-iteration-count: 1 !important;
        caret-color: transparent !important;
        transition-duration: 0s !important;
      }
    `;
    const inject = () => {
      const style = document.createElement("style");
      style.textContent = css;
      document.head.appendChild(style);
    };
    if (document.readyState === "loading") {
      document.addEventListener("DOMContentLoaded", inject, { once: true });
    } else {
      inject();
    }
  });
  if (variant.theme === "dark") {
    await context.addInitScript(() => {
      try { window.localStorage.setItem("cz-theme", "dark"); } catch { /* ignore */ }
    });
  }

  const loginPage = await context.newPage();
  await installNetworkMocks(loginPage);
  if (group === "protected") {
    await login(loginPage);
  }
  await loginPage.close();

  for (const spec of routes) {
    const slug = slugFor(spec.route);
    const page = await context.newPage();
    await installNetworkMocks(page);

    let consoleErrors = 0;
    page.on("console", (msg) => { if (msg.type() === "error") consoleErrors++; });
    page.on("pageerror", () => { consoleErrors++; });

    try {
      await page.goto(spec.path, { waitUntil: "domcontentloaded" });
      await genericReady(page, { path: spec.path, route: spec.route });

      const shotPath = resolve(SHOTS_OUT, `${slug}-${variant.name}.png`);
      await page.screenshot({ path: shotPath, fullPage: true });

      if (!results[spec.route]) results[spec.route] = { route: spec.route, file: spec.file, template: spec.template, auth: spec.auth, note: spec.note || null };
      results[spec.route][`screenshot_${variant.name}`] = `docs/screenshots/quality-audit-2026-09/${slug}-${variant.name}.png`;

      if (variant.name === "desktop-light") {
        const metrics = await page.evaluate(measurePage);
        Object.assign(results[spec.route], metrics);
        results[spec.route].consoleErrors = consoleErrors;
      }
      if (variant.name === "mobile-light") {
        const overflow = await page.evaluate(() => ({
          hasHorizontalOverflow: document.documentElement.scrollWidth > document.documentElement.clientWidth,
          mobileScrollWidth: document.documentElement.scrollWidth,
          mobileClientWidth: document.documentElement.clientWidth,
        }));
        Object.assign(results[spec.route], overflow);
      }

      console.log(`[4624] OK  ${variant.name.padEnd(14)} ${spec.route}`);
    } catch (err) {
      console.error(`[4624] FEJL ${variant.name.padEnd(14)} ${spec.route}: ${err.message}`);
      allFailures.push({ variant: variant.name, route: spec.route, error: err.message });
      if (!results[spec.route]) results[spec.route] = { route: spec.route, file: spec.file, template: spec.template, auth: spec.auth };
      results[spec.route][`error_${variant.name}`] = err.message;
    } finally {
      await page.close();
      saveResults();
    }
  }

  await context.close();
}

const browser = await chromium.launch();

for (const variant of VARIANTS) {
  await runVariant(browser, variant, "public");
  await runVariant(browser, variant, "protected");
}

await browser.close();
saveResults();

writeFileSync(resolve(AUDITS_OUT, "quality-audit-2026-09-failures.json"), JSON.stringify(allFailures, null, 2), "utf8");
console.log(`\n[4624] Faerdig. ${Object.keys(results).length} ruter, ${allFailures.length} fejl.`);
console.log(`[4624] Metrics: ${METRICS_JSON}`);
