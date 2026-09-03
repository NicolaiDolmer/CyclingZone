// i18n layout-overflow-guard — Refs #4733 (scope 3).
//
// ── Hvorfor denne spec findes ───────────────────────────────────────────────
//
// #4275: sprogvælgeren flød ud over skærmkanten på mobil, fordi den engelske
// label var kortere end den danske. Ingen test kunne se det — hele e2e-suiten
// kører på DA-strenge i deres nuværende længde, og pixel-snapshots maskerer
// netop tekst (TEXT_MASK_SELECTOR) for ikke at drive på copy-ændringer.
//
// Et NYT sprog (fransk/hollandsk står først i køen på #4110) skal koste ~0 at
// vedligeholde. Så må en 30 % længere streng ikke kunne knække en side uset.
//
// ── Hvorfor `pad=30` og ikke bare `?pseudo=1` ───────────────────────────────
//
// `?pseudo=1` alene wrapper hver streng i `[…·••]` — 5 FASTE tegn. Det er ikke
// en længde-simulering: +50 % på en 10-tegns knap-label, +8 % på en 60-tegns
// hjælpetekst. Præcis de lange strenge, hvor overflow gør mest ondt, får mindst
// tillæg. Derfor er pseudo-generatoren (frontend/src/i18n/index.js) udvidet med
// `?pseudo=1&pad=30`, som lægger ~30 % af strengens EGEN længde til. Samme
// dev/preview-gate som i dag — padding findes kun når pseudo er slået til.
//
// ── Hvad testen assertere, og hvorfor IKKE mod window.innerWidth ────────────
//
// Den bindende assertion er
//   documentElement.scrollWidth <= documentElement.clientWidth + 1
// altså: siden må ikke kunne scrolles vandret. Den er selektor-fri med vilje —
// ingen side skal have et `data-testid` for at være dækket, og en ny side får
// dækning ved at blive tilføjet i PAGES herunder.
//
// Referencen er `documentElement.clientWidth` (layout-viewporten), IKKE
// `window.innerWidth`. Første udgave af denne spec brugte innerWidth og var
// grøn på alt — også når siden beviseligt flød over. Målt på /dashboard i
// mobile-chromium med kraftig padding:
//
//   documentElement.clientWidth  393   (= visualViewport.width, layout-viewport)
//   documentElement.scrollWidth  451   (58 px reelt overløb)
//   window.innerWidth            451   ← vokser MED overløbet
//
// Chromiums mobil-emulering rapporterer innerWidth som den initiale
// containing block, der udvides når indholdet er bredere end viewporten. Så
// `scrollWidth <= innerWidth` er en tautologi på præcis det projekt hvor testen
// betyder mest. clientWidth og visualViewport.width bliver begge stående på 393.
//
// DOM-scanningen er DIAGNOSTIK, ikke en selvstændig assertion: den kører kun
// når siden allerede er faldet, og navngiver de første 5 elementer der stikker
// ud, så fejlbeskeden peger på et element frem for på et tal. Elementer inde i
// deres EGEN vandrette scroll-container springes over — brede datatabeller
// scroller lovligt i sig selv (T2 i docs/design/PAGE_TEMPLATES.md).
//
// ── Hvad testen antager ─────────────────────────────────────────────────────
//
// Samme mock-seed som resten af suiten (installNetworkMocks + seedData.js) og
// samme login-flow (fixtures.js's `login`). Login sker UDEN pseudo, fordi
// login-formularens felter slås op på deres danske labels; pseudo slås først
// til på de sider der måles. Alle 3 playwright-projekter kører specen — mobilen
// er hele pointen, men desktop fanger den modsatte fejlklasse (faste px-bredder).

import { expect, test } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// ~30 % længere strenge oven på pseudo-wrappen. Tysk og fransk ligger typisk
// 25-35 % over engelsk, så 30 er midt i det bånd — ikke et worst case.
const PSEUDO_QUERY = "pseudo=1&pad=30";

const PAGES = [
  { name: "dashboard", path: "/dashboard" },
  { name: "auktioner", path: "/auctions" },
  // Rytterprofil: rider-1 er seedens senior-rytter og bruges af de øvrige
  // rytterprofil-specs (core-smoke, auction-startprice-typo-guard m.fl.).
  { name: "rytterprofil", path: "/riders/rider-1" },
  { name: "finans", path: "/finance" },
];

function withPseudo(path) {
  return `${path}${path.includes("?") ? "&" : "?"}${PSEUDO_QUERY}`;
}

/**
 * Mål sidens vandrette overløb og navngiv de værste syndere.
 * Kører ÉT evaluate-kald, så tal og kandidater kommer fra samme layout-frame.
 */
async function measureOverflow(page) {
  return page.evaluate(() => {
    // Layout-viewporten — se spec-headeren for hvorfor window.innerWidth ikke
    // duer som reference under mobil-emulering.
    const viewportWidth = document.documentElement.clientWidth;
    const limit = viewportWidth + 1;

    // Et element der ligger i en vandret scroll-container må gerne stikke ud:
    // containeren scroller det selv, og siden bliver ikke bredere af det.
    const hasHorizontalScrollAncestor = (el) => {
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const overflowX = getComputedStyle(node).overflowX;
        if (overflowX === "auto" || overflowX === "scroll" || overflowX === "hidden") return true;
        node = node.parentElement;
      }
      return false;
    };

    const describe = (el) => {
      const tag = el.tagName.toLowerCase();
      const id = el.id ? `#${el.id}` : "";
      const classes = (el.getAttribute("class") || "")
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 3)
        .map((c) => `.${c}`)
        .join("");
      const text = (el.textContent || "").trim().replace(/\s+/g, " ").slice(0, 40);
      return `${tag}${id}${classes}${text ? ` — "${text}"` : ""}`;
    };

    const candidates = [];
    for (const el of document.querySelectorAll("body *")) {
      if (candidates.length >= 5) break;
      const style = getComputedStyle(el);
      if (style.display === "none" || style.visibility === "hidden") continue;
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      if (rect.right <= limit) continue;
      if (hasHorizontalScrollAncestor(el)) continue;
      candidates.push(`${describe(el)} (right=${Math.round(rect.right)}px)`);
    }

    return {
      scrollWidth: document.documentElement.scrollWidth,
      viewportWidth,
      candidates,
    };
  });
}

test.describe("i18n · ingen vandret overflow på 30 % længere strenge", () => {
  test.beforeEach(async ({ page }) => {
    await installNetworkMocks(page);
    await stabilizePage(page);
    await login(page);
  });

  for (const target of PAGES) {
    test(`${target.name} flyder ikke over (en-XA, +30 %)`, async ({ page }) => {
      await page.goto(withPseudo(target.path));

      // Netværks-ro: alle kald besvares af Playwright-mocks, så idle nås med det
      // samme; gaten er der for de lazy-loadede i18n-namespaces (HttpBackend),
      // som ellers kan nå at ombryde siden EFTER målingen.
      await page.waitForLoadState("networkidle");
      await expect(page.locator("main")).toBeVisible();
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });

      // ── False-green-guard ────────────────────────────────────────────────
      // En overflow-måling på UFORLÆNGEDE strenge måler ingenting og ville
      // være grøn for evigt. Bekræft derfor BEGGE led før vi måler: at
      // pseudo-locale er aktiv (instansen + den faktisk rendrede DOM), og at
      // `pad=30` rent faktisk forlænger. Falder en af dem, er det spec'en der
      // er i stykker — ikke siden.
      const pseudo = await page.evaluate(() => {
        const i18n = window.__i18n;
        if (!i18n) return null;
        return { language: i18n.language, sample: i18n.t("nav.item.dashboard") };
      });
      expect(pseudo, "window.__i18n mangler — kører preview-serveren uden VITE_E2E=1?").not.toBeNull();
      expect(pseudo.language, "pseudo-locale blev ikke aktiveret af ?pseudo=1").toBe("en-XA");
      expect(pseudo.sample, "pseudo-wrappen mangler på t()").toMatch(/·••\]$/);
      expect(pseudo.sample, "pad=30 forlængede ikke strengen").toMatch(/ x/);
      await expect(page.locator("body"), "den rendrede side bruger ikke pseudo-strengene").toContainText("·••");

      const report = await measureOverflow(page);

      const detail =
        report.candidates.length > 0
          ? `\nFørste elementer uden for viewport:\n${report.candidates.map((c) => `  · ${c}`).join("\n")}`
          : "\n(ingen enkelt-element-kandidater — overløbet kommer fra en container-bredde, ikke et barn)";

      expect(
        report.scrollWidth,
        `${target.path} kan scrolles vandret på en 30 % længere locale: ` +
          `scrollWidth=${report.scrollWidth}px vs. viewport=${report.viewportWidth}px.` +
          detail,
      ).toBeLessThanOrEqual(report.viewportWidth + 1);
    });
  }
});
