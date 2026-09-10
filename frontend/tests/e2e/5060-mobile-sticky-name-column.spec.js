import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, stabilizePage, login } from "./fixtures.js";

// #5060 — ADFAERDS-guard for den pinnede navnekolonne paa mobil.
//
// ── Hvorfor denne fil findes ────────────────────────────────────────────────
//
// Spilleren (Discord 8/9) skrev ordret: "kolonnen med spillernavne foelger ikke
// med naar man scroller til siden". Foerste udgave af #5060 laaste fixet med
// tre KLASSE-STRENG-guards (dataTableStyles.test.js, table.source.test.js,
// zIndexScale.test.js) plus et screenshot-script uden assertions. De guards
// beviser hvad `thClass()` RETURNERER — ikke hvad browseren MALER. En senere
// aendring kan genindfoere praecis den samme visuelle defekt og holde alle tre
// groenne: giver `<thead>` sig selv et stacking context (moensteret findes
// allerede paa AuctionsPage/TransfersPage), bliver hjoernets z-table-corner
// indkapslet, og klasse-strengene er uaendrede.
//
// Denne spec maaler derfor i en RIGTIG browser, paa begge mobil-motorer CI koerer:
//   · mobile-chromium (Pixel 5, Android-UA + touch) = spillerens sandsynlige motor
//   · mobile-webkit   (iPhone 13) = den eneste ikke-Chromium-daekning der findes
// `position: sticky` i en `border-collapse`-tabel er praecis den klasse hvor de
// to motorer historisk afviger, og PR'ens egen verifikation var desktop-Chromium
// med `isMobile`-emulering. Ingen evidens for en fysisk Android-enhed: der findes
// ingen i harnessen. Daekningen her er de to motorer, ikke spillerens telefon.
//
// ── Hvad der maales ────────────────────────────────────────────────────────
//
//   1. Tabellen overflower faktisk vandret (ellers reproducerer testen ikke
//      spillerens situation, og en groen koersel ville vaere falsk tryghed).
//   2. Navnecellen i KROPPEN — det spilleren skrev om — staar stille naar
//      tallene scroller forbi, og intet maler oven paa den.
//   3. Navnekolonnens OVERSKRIFT staar stille og er oeverst i sit eget punkt.
//      Det var den der forsvandt: "Salary"/"Wins" delte z-lag med "Rider" og
//      vandt paa DOM-raekkefoelge.
//   4. Hjoernet bliver over kroppens pinnede celle ved LODRET scroll.
//   5. Hairline-skillet males af cellen selv (1px, absolut, ikke gennemsigtigt),
//      saa navn og tal ikke loeber sammen naar der er scrollet ud.
//
// Cellerne findes paa deres BEREGNEDE stil, ikke paa en klasse fixet indfoerte
// (`position: sticky` + vandret laas). Ellers ville guarden kun bevise at et
// klassenavn stadig staar i markuppen, og den ville vaere groen-ved-fravaer.

const ROUTES = [
  // Ranglisterne og traeningssiden er de to flader spillerne navngav konkret
  // (Discord 8/9 + skemaet 10/9). De rammer ogsaa de to forskellige opskrifter:
  // <DataTable> (thClass({sticky})) og den haandrullede tabel med egen offset
  // (thClass({pinned}) + left-10).
  { name: "rytter-ranglisten", path: "/standings?tab=riders" },
  { name: "traeningssiden", path: "/training" },
];

/**
 * Maaler de to pinnede celler: position, z-lag, hvem der maler oeverst i deres
 * eget midtpunkt, og cellens egen hairline. Alt sker i EEN evaluate, saa
 * opslaget af cellerne og maalingen ikke kan komme ud af trit.
 */
async function measure(page) {
  return page.evaluate(() => {
    const isPinned = (el) => {
      const cs = getComputedStyle(el);
      return cs.position === "sticky" && cs.left !== "auto";
    };

    // Er der flere pinnede celler (Traeningssiden pinner checkbox paa left-0 OG
    // navn paa left-10), er navnekolonnen den sidste af dem.
    const heads = [...document.querySelectorAll("main thead th")].filter(isPinned);
    const head = heads.length ? heads[heads.length - 1] : null;
    const firstPinnedTd = [...document.querySelectorAll("main tbody td")].filter(isPinned)[0];
    const row = firstPinnedTd ? firstPinnedTd.closest("tr") : null;
    const bodyCells = row ? [...row.querySelectorAll("td")].filter(isPinned) : [];
    const body = bodyCells.length ? bodyCells[bodyCells.length - 1] : null;
    const scroller = head ? head.closest("div[class*='overflow']") : null;

    if (!head || !body || !scroller) {
      return { found: false, hasHead: Boolean(head), hasBody: Boolean(body), hasScroller: Boolean(scroller) };
    }

    const read = (el) => {
      const r = el.getBoundingClientRect();
      const cs = getComputedStyle(el);
      const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
      const rule = getComputedStyle(el, "::after");
      return {
        left: Math.round(r.left),
        width: Math.round(r.width),
        text: (el.textContent || "").trim().slice(0, 24),
        zIndex: Number(cs.zIndex) || 0,
        position: cs.position,
        // true = cellen (eller dens indhold) er oeverst i sit eget midtpunkt.
        // false = en anden celle maler oven paa den.
        topmost: Boolean(hit && (el === hit || el.contains(hit))),
        painterOnTop: hit && !el.contains(hit) ? (hit.textContent || "").trim().slice(0, 30) : null,
        rule: { width: rule.width, position: rule.position, background: rule.backgroundColor },
      };
    };

    // De overskrifter der SCROLLER forbi (ingen vandret laas). Traeningssidens
    // checkbox-header er selv pinnet og deler med rette hjoerne-laget — den
    // ligger ved siden af navnet, ikke oven paa det.
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
  });
}

/** Scroller tabellens EGEN scroller (ikke siden) paa den valgte akse. */
async function scrollTable(page, { left, top }) {
  await page.evaluate(({ left: l, top: t }) => {
    const el = [...document.querySelectorAll("main thead th")]
      .find((th) => {
        const cs = getComputedStyle(th);
        return cs.position === "sticky" && cs.left !== "auto";
      });
    const scroller = el ? el.closest("div[class*='overflow']") : null;
    if (!scroller) return;
    if (l) scroller.scrollLeft = scroller.scrollWidth;
    if (t) scroller.scrollTop = Math.min(t, scroller.scrollHeight);
  }, { left, top });
  // Sticky-omplacering sker ved naeste maling; to frames raekker i begge motorer.
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
      await expect(page.locator("main tbody tr td").first()).toBeVisible({ timeout: 20000 });

      const before = await measure(page);
      expect(before.found, `pinnet overskrift + celle + scroller skal findes paa ${route.path}: ${JSON.stringify(before)}`).toBe(true);
      // Ingen vandret overflow = testen reproducerer ikke spillerens situation.
      // Det skal FEJLE, ikke skippe: en guard der stille holder op med at maale
      // noget er praecis den fejlklasse denne fil findes for.
      expect(before.maxScroll, "tabellen skal overflowe vandret paa mobil, ellers maaler testen intet").toBeGreaterThan(20);

      await scrollTable(page, { left: true });
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
      expect(after.head.zIndex, "hjoernet skal rangere over de overskrifter der scroller forbi")
        .toBeGreaterThan(after.maxScrollingHeadZ);

      // 3) Hairline-skillet: cellen maler det selv, saa "245,000" ikke loeber
      //    ind i "Ada Pedersen". 1px, ikke en skygge.
      expect(after.body.rule.position, "den pinnede celle skal selv tegne sit skille").toBe("absolute");
      expect(after.body.rule.width).toBe("1px");
      expect(after.body.rule.background).not.toBe("rgba(0, 0, 0, 0)");

      // 4) Lodret scroll: hjoernet skal blive over kroppens pinnede kolonne.
      //    Faar <thead> senere sit eget stacking context med et for lavt lag,
      //    kravler kroppens celler op over overskriften — usynligt for enhver
      //    klasse-streng-test.
      await scrollTable(page, { top: 240 });
      const scrolled = await measure(page);
      expect(scrolled.head.topmost, `kroppen malede op over overskriften: ${scrolled.head.painterOnTop}`).toBe(true);

      await page.screenshot({
        path: testInfo.outputPath(`5060-${route.name}-${testInfo.project.name}.png`),
        fullPage: false,
      });
    });
  }
});
