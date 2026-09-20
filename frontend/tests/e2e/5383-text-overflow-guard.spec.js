// Vagt: tekst maa ikke flyde ud over sin boks eller vaere ulaeselig — Refs #5383.
//
// ── Hvorfor den findes ─────────────────────────────────────────────────────
//
// Ejer-direktiv 18/9, ordret: "Det er meningen at du helt af dig selv skal
// opdage ting som, at teksten gaar ud over boksene. Det skal ikke kunne opstaa."
// Der skal altsaa ikke sendes skaermbilleder ind for hvert enkelt sted; vagten
// skal selv finde dem, paa begge sprog og i begge stoerrelser.
//
// Selve maalingen bor i `lib/text-overflow-scan.js` (de fire regler og hvad de
// bevidst IKKE doemmer staar dokumenteret dér). Denne fil er kun matricen:
// hvilke sider, hvilke sprog, hvilke viewports — og fejlbeskeden.
//
// ── Hvorfor kun eet playwright-projekt ─────────────────────────────────────
//
// Specen saetter selv sine viewports (mobil 412x915 = en typisk Android-bredde,
// desktop 1280x900), fordi et fund skal kunne navngive PRAECIS den bredde det
// opstod paa. Kørte den ogsaa i mobile-chromium og mobile-webkit, ville den
// maale de samme to bredder tre gange og tredoble en i forvejen tung matrice
// (16 sider x 2 sprog x 2 bredder). Den koerer derfor i desktop-chromium-sharden.
//
// Prisen, sagt hoejt: Safari-specifikke tekstbrud (fx hvordan webkit bryder
// lange ord) fanges ikke her. Det er stadig `core-smoke`s og de tre projekters
// snapshots' opgave.
//
// ── Hvad der ikke maales ───────────────────────────────────────────────────
//
// Kun sider som mock-seedet (installNetworkMocks + seedData.js) fylder med
// rigtigt indhold. Loebsdetaljen (/races/:id) staar udenfor: standard-mocken
// returnerer ingen loeb, saa siden ville blive maalt tom — og en tom side er
// gronn uanset hvad. Den skal have sit eget seed foer den kan med (#5383).

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, waitForStableSnapshotTarget } from "./fixtures.js";
import { RULES, scanPageForTextDefects, formatFinding } from "./lib/text-overflow-scan.js";
import {
  TEXT_OVERFLOW_ALLOWLIST,
  allowlistProblems,
  isKnownContrastDebt,
  matchesAllowlist,
} from "./lib/text-overflow-allowlist.js";

const VIEWPORTS = [
  // 412x915 er Pixel 6/7/8-klassens logiske bredde og den bredde ejeren selv
  // spiller paa (Android). 393 (Pixel 5) daekkes af mobile-chromium-projektet.
  { name: "mobil", size: { width: 412, height: 915 } },
  { name: "desktop", size: { width: 1280, height: 900 } },
];

const LANGS = ["da", "en"];

// Raa fund pr. flade. Ligger under test-results/ (gitignoreret) og er inputtet
// til audit-dokumentet.
const REPORT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../test-results/5383-tekst-overflow",
);

// Siderne. `name` er noeglen undtagelser slaas op paa, saa den maa ikke aendres
// uden at allowlisten foelger med.
const PAGES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "indbakke", path: "/notifications" },
  { name: "mit-hold", path: "/team" },
  { name: "traening", path: "/training" },
  { name: "oekonomi", path: "/finance" },
  { name: "akademi", path: "/academy" },
  { name: "bestyrelse", path: "/board" },
  { name: "sponsorer", path: "/sponsors" },
  { name: "kalender", path: "/planning?tab=calendar" },
  { name: "loebscenter", path: "/race-centre" },
  { name: "auktioner", path: "/auctions" },
  { name: "transfers", path: "/transfers" },
  { name: "rytterdatabase", path: "/riders" },
  { name: "rytterprofil", path: "/riders/rider-1" },
  { name: "indstillinger", path: "/profile" },
  { name: "hjaelp", path: "/help" },
];

async function setLanguage(page, lang) {
  await page.evaluate(async (next) => {
    window.localStorage.setItem("cz_lang", next);
    if (window.__i18n) await window.__i18n.changeLanguage(next);
  }, lang);
  await expect.poll(() => page.evaluate(() => window.__i18n?.language)).toBe(lang);
}

async function settle(page) {
  await page.waitForLoadState("networkidle");
  await expect(page.locator("main")).toBeVisible();
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
  // Samme stabiliserings-gate som snapshot-specerne: geometri og element-tal
  // skal staa stille i 4 frames, saa maalingen ikke lander mid-render.
  await waitForStableSnapshotTarget(page);
}

test.describe("#5383 · tekst holder sig inde i sin boks og kan laeses", () => {
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "Specen saetter selv sine viewports — se filhovedet for hvorfor kun eet projekt koerer den.",
    );
    await installNetworkMocks(page);
    await stabilizePage(page);
    await login(page);
  });

  test("undtagelseslisten er smal, begrundet og ikke udloebet", () => {
    const problems = allowlistProblems();
    expect(
      problems,
      `Undtagelseslisten i tests/e2e/lib/text-overflow-allowlist.js holder ikke:\n${problems
        .map((p) => `  · ${p}`)
        .join("\n")}`,
    ).toEqual([]);
  });

  /**
   * Maal een flade paa tvaers af sprog og viewports, doem mod undtagelseslisten
   * og fejl med en laesbar, grupperet liste.
   */
  async function guardSurface(page, testInfo, target, scope) {
    const findings = [];
    const usedAllowlistEntries = new Set();

    for (const viewport of VIEWPORTS) {
      await page.setViewportSize(viewport.size);
      for (const lang of LANGS) {
        await page.goto(target.path);
        await setLanguage(page, lang);
        await settle(page);

        const context = { page: target.name, lang, viewport: viewport.name };
        const where = `${lang} · ${viewport.name} ${viewport.size.width}x${viewport.size.height}`;
        for (const raw of await scanPageForTextDefects(page, scope)) {
          // Kendt kontrast-gaeld doemmes pr. farvepar, ikke pr. side — se
          // hovedet af text-overflow-allowlist.js for hvorfor.
          if (isKnownContrastDebt(raw)) continue;
          const allowed = matchesAllowlist(raw, context);
          if (allowed >= 0) {
            usedAllowlistEntries.add(allowed);
            continue;
          }
          findings.push({ ...raw, where });
        }
      }
    }

    // Rapporten skrives ALTID, ogsaa naar testen er groen: den er raamaterialet
    // til docs/audits/2026-09-19-5383-tekst-overflow-fund.md. Baade som fil (saa
    // hele matricen kan laeses samlet efter en koersel) og som vedhaeftning i
    // HTML-rapporten (saa et CI-fald kan aabnes uden at koere noget igen).
    const report = JSON.stringify(findings, null, 2);
    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.writeFileSync(path.join(REPORT_DIR, `${target.name}.json`), report);
    await testInfo.attach(`5383-${target.name}-fund.json`, {
      body: report,
      contentType: "application/json",
    });

    // Stale undtagelser: en post der ikke laengere daekker noget fund lyver om
    // hvad der mangler. Naar fladen er rettet, skal posten vaek.
    const stale = TEXT_OVERFLOW_ALLOWLIST
      .map((entry, index) => ({ entry, index }))
      .filter(({ entry, index }) => entry.page === target.name && !usedAllowlistEntries.has(index))
      .map(({ entry }) => `  · ${entry.rule}: ${entry.match} (${entry.reason})`);
    expect(
      stale,
      `Disse undtagelser for "${target.name}" matcher ingen fund laengere. ` +
        `Er fladen rettet, skal posten slettes fra text-overflow-allowlist.js:\n${stale.join("\n")}`,
    ).toEqual([]);

    // Samme fund paa flere sprog/bredder er EET problem — gruppér, ellers
    // druknner fejlbeskeden i fire kopier af hver linje.
    const grouped = new Map();
    for (const finding of findings) {
      const key = `${finding.rule}|${finding.selector}|${finding.text}|${finding.detail.replace(/\d+(\.\d+)?/g, "#")}`;
      if (!grouped.has(key)) grouped.set(key, { ...finding, where: [] });
      grouped.get(key).where.push(finding.where);
    }
    const lines = [...grouped.values()].map((f) => formatFinding({ ...f, where: f.where.join(" · ") }));

    const byRule = Object.values(RULES)
      .map((rule) => `${rule}: ${findings.filter((f) => f.rule === rule).length}`)
      .join(", ");

    expect(
      lines.join("\n"),
      `${grouped.size} tekst-problemer paa ${target.path} (${findings.length} maalinger — ${byRule}).\n` +
        `Ret fladen efter docs/design/TASTE.md og docs/design/PAGE_TEMPLATES.md — wrap, min-w-0, ` +
        `kortere label — frem for at skjule teksten. Er det tilsigtet afkortning, saa giv elementet ` +
        `title/aria-label (eller data-allow-clip) i stedet for at undtage det.\n`,
    ).toBe("");
  }

  // App-skallen (sidebar, topbar, bundnavigation) staar paa hver eneste side.
  // Maales den pr. side, gentages det samme fund 16 gange og rapporten bliver
  // ulaeselig. Den maales derfor EEN gang, paa dashboardet.
  test("app-skal (sidebar, topbar, bundnav)", async ({ page }, testInfo) => {
    await guardSurface(page, testInfo, { name: "app-skal", path: "/dashboard" }, {
      root: "body",
      excludeRoot: "main",
    });
  });

  for (const target of PAGES) {
    test(`${target.name} (${target.path})`, async ({ page }, testInfo) => {
      await guardSurface(page, testInfo, target, { root: "main" });
    });
  }
});
