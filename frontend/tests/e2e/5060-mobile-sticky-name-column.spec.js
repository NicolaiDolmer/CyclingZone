import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login } from "./fixtures.js";

// #5060 — ADFAERDS-guard for den pinnede navnekolonne paa mobil.
//
// ── Hvorfor denne fil findes ────────────────────────────────────────────────
//
// Spilleren (Discord 8/9) skrev ordret: "kolonnen med spillernavne foelger ikke
// med naar man scroller til siden". Den foerste udgave af #5060 laaste fixet med
// tre KLASSE-STRENG-guards (dataTableStyles.test.js, table.source.test.js,
// zIndexScale.test.js) plus et screenshot-script uden assertions. De guards
// beviser hvad `thClass()` RETURNERER — ikke hvad browseren MALER. En senere
// aendring kan genindfoere praecis den samme visuelle defekt og holde alle tre
// groenne: giver `<thead>` sig selv et stacking context (moensteret findes
// allerede paa AuctionsPage/TransfersPage), bliver hjoernets z-table-corner
// indkapslet, og klasse-strengene er uaendrede.
//
// Denne spec maaler derfor i en RIGTIG browser, paa begge mobil-motorer:
//   · mobile-chromium (Pixel 5, Android-UA + touch) = spillerens sandsynlige motor
//   · mobile-webkit   (iPhone 13) = den eneste ikke-Chromium-daekning der findes
// `position: sticky` i en `border-collapse`-tabel er praecis den klasse hvor de
// to motorer historisk afviger, og den foerste udgave af PR'en var kun verificeret
// i desktop-Chromium med `isMobile`-emulering.
//
// ── Hvad der maales ────────────────────────────────────────────────────────
//
//   1. Tabellen overflower faktisk vandret (ellers reproducerer testen ikke
//      spillerens situation, og en groen koersel ville vaere falsk tryghed).
//   2. Navnecellen (KROPPEN — det spilleren skrev om) staar stille naar tallene
//      scroller forbi, og den er oeverst i sit eget punkt.
//   3. Navnekolonnens OVERSKRIFT staar stille og er oeverst i sit eget punkt.
//      Det var den der forsvandt: "Salary"/"Wins" delte z-lag med "Rider" og
//      vandt paa DOM-raekkefoelge.
//   4. Hjoernet ligger over kroppens pinnede celle ved LODRET scroll.
//   5. Hairline-skillet males af cellen selv (1px, absolut, ikke gennemsigtigt),
//      saa navn og tal ikke loeber sammen naar der er scrollet ud.
//
// Ingen evidens for en fysisk Android-enhed: der findes ingen i harnessen.
// Daekningen her er de to motorer CI koerer, ikke en enhedstest paa spillerens
// telefon.

const ROUTES = [
  // Ranglisterne og traeningssiden er de to flader spillerne navngav konkret
  // (Discord 8/9 + skemaet 10/9). De rammer ogsaa de to forskellige opskrifter:
  // <DataTable> (thClass({sticky})) og den haandrullede tabel med egen offset
  // (thClass({pinned}) + left-10).
  { name: "rytter-ranglisten", path: "/standings?tab=riders" },
  { name: "traeningssiden", path: "/training" },
];

// Den pinnede celle er den der tegner sit eget hairline-skille. Samme markoer i
// begge opskrifter, saa specen behoever ikke kende den enkelte sides kolonner.
const HEAD_CELL = "main thead th.cz-pinned-rule-end";
const BODY_CELL = "main tbody td.cz-pinned-rule-end";

/** Maaler de to pinnede cellers position + hvem der maler oeverst i deres punkt. */
async function measure(page) {
  return page.evaluate(({ headSel, bodySel }) => {
    const head = document.querySelector(headSel);
    const body = document.querySelector(bodySel);
    const scroller = head?.closest("div[class*='overflow']");
    if (!head || !body || !scroller) return { found: false, head: !!head, body: !!body, scroller: !!scroller };

    const read = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      const hit = document.elementFromPoint(x, y);
      const rule = getComputedStyle(el, "::after");
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        zIndex: cs.zIndex,
        position: cs.position,
        // true = cellen (eller dens indhold) er det oeverste element i sit eget
        // midtpunkt. false = en anden celle maler oven paa den.
        topmost: Boolean(hit && (el === hit || el.contains(hit))),
        painterOnTop: hit && !el.contains(hit) ? (hit.textContent || "").trim().slice(0, 30) : null,
        rule: {
          width: rule.width,
          position: rule.position,
          background: rule.backgroundColor,
        },
      };
    };

    // De celler der SCROLLER forbi: header-celler uden vandret pin (`left: auto`).
    // Traeningssidens checkbox-header er selv pinnet (left-0) og deler med rette
    // hjoerne-laget — den ligger ved siden af navnet, ikke oven paa det.
    const scrollingHeadZ = [...document.querySelectorAll("main thead th")]
      .filter((th) => th !== head && getComputedStyle(th).left === "auto")
      .map((th) => Number(getComputedStyle(th).zIndex) || 0);

    return {
      found: true,
      scrollLeft: Math.round(scroller.scrollLeft),
      maxScroll: Math.round(scroller.scrollWidth - scroller.clientWidth),
      head: read(head),
      body: read(body),
      maxScrollingHeadZ: scrollingHeadZ.length ? Math.max(...scrollingHeadZ) : 0,
    };
  }, { headSel: HEAD_CELL, bodySel: BODY_CELL });
}

/** Scroller tabellens EGEN scroller (ikke siden) helt ud til hoejre. */
async function scrollTableRight(page) {
  await page.evaluate((headSel) => {
    const scroller = document.querySelector(headSel)?.closest("div[class*='overflow']");
    if (scroller) scroller.scrollLeft = scroller.scrollWidth;
  }, HEAD_CELL);
  // Sticky-omplacering sker ved naeste maling; to frames er nok i alle tre motorer.
  await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
}

test.describe("#5060: navnekolonnen bliver liggende ved vandret scroll (mobil)", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
  });

  for (const route of ROUTES) {
    test(`${route.name}: navn + overskrift staar fast naar tallene scroller forbi`, async ({ page }, testInfo) => {
      const viewport = page.viewportSize();
      test.skip(viewport.width >= 640, "portraet-kontrakten; desktop har plads til hele tabellen");

      await login(page);
      await page.goto(route.path);
      await expect(page.locator(HEAD_CELL).first()).toBeVisible({ timeout: 20000 });
      await expect(page.locator(BODY_CELL).first()).toBeVisible();

      const before = await measure(page);
      expect(before.found, `pinnet celle + scroller skal findes paa ${route.path}`).toBe(true);
      // Ingen vandret overflow = testen reproducerer ikke spillerens situation.
      // Det skal FEJLE, ikke skippe: en guard der stille holder op med at maale
      // noget er praecis den fejlklasse denne fil findes for.
      expect(before.maxScroll, "tabellen skal overflowe vandret paa mobil, ellers maaler testen intet").toBeGreaterThan(20);
      expect(before.head.position).toBe("sticky");
      expect(before.body.position).toBe("sticky");

      await scrollTableRight(page);
      const after = await measure(page);
      expect(after.scrollLeft, "scrolleren skal faktisk vaere rykket").toBeGreaterThan(20);

      // 1) Kroppens navnecelle — spillerens egne ord. Uaendret x, og intet maler
      //    oven paa den.
      expect(Math.abs(after.body.left - before.body.left), "navnecellen maa ikke flytte sig naar tallene scroller")
        .toBeLessThanOrEqual(1);
      expect(after.body.topmost, `noget malede oven paa navnecellen: ${after.body.painterOnTop}`).toBe(true);

      // 2) Navnekolonnens overskrift. Det var den der blev malet over af
      //    "Salary"/"Wins"/"Prize" (samme z-lag, senere i DOM).
      expect(Math.abs(after.head.left - before.head.left), "overskriften skal blive hos sin kolonne")
        .toBeLessThanOrEqual(1);
      expect(after.head.topmost, `noget malede oven paa navne-overskriften: ${after.head.painterOnTop}`).toBe(true);
      expect(Number(after.head.zIndex) || 0, "hjoernet skal rangere over de overskrifter der scroller forbi")
        .toBeGreaterThan(after.maxScrollingHeadZ);

      // 3) Hairline-skillet: cellen maler det selv, saa "245,000" ikke loeber
      //    ind i "Ada Pedersen". 1px, ikke en skygge.
      expect(after.body.rule.position).toBe("absolute");
      expect(after.body.rule.width).toBe("1px");
      expect(after.body.rule.background).not.toBe("rgba(0, 0, 0, 0)");

      // 4) Lodret scroll: hjoernet skal blive over kroppens pinnede kolonne.
      //    Faar <thead> senere sit eget stacking context med et for lavt lag,
      //    kravler kroppens celler op over overskriften — usynligt for enhver
      //    klasse-streng-test.
      await page.evaluate((headSel) => {
        const scroller = document.querySelector(headSel)?.closest("div[class*='overflow']");
        if (scroller) scroller.scrollTop = Math.min(240, scroller.scrollHeight);
      }, HEAD_CELL);
      await page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))));
      const scrolled = await measure(page);
      expect(scrolled.head.topmost, `kroppen malede op over overskriften: ${scrolled.head.painterOnTop}`).toBe(true);

      await page.screenshot({
        path: testInfo.outputPath(`5060-${route.name}-${testInfo.project.name}.png`),
        fullPage: false,
      });
    });
  }
});
