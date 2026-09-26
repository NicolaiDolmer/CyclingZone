import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS,
} from "./fixtures.js";
import { scanPageForTextDefects, formatFinding } from "./lib/text-overflow-scan.js";

// #4851 — traeningsscoren 1-99. UI-daekning, der manglede helt.
//
// Scoren gik live for beta-gruppen uden en eneste UI-test (#5449 pegede paa
// netop det hul: "der findes ingen 4851-*.spec.js"). Denne spec laaser de fire
// paastande fladen goer, paa alle tre Playwright-projekter:
//
//   1. Kolonnen paa Daglig traening: tal, "Loeb" uden tal, streg, og sortering.
//   2. Rytterprofilens kort (RiderTrainingScoreCard), inkl. den TOMME tilstand.
//   3. Flaget off ⇒ kolonnen findes IKKE. Serveren UDELADER `trainingScore`-
//      feltet naar `training_score_visible` er off, og det er den kontrakt der
//      testes — ikke et tomt objekt.
//   4. Mobilvisningen (flag `training_mobile_table`): tallet i tabellen og
//      tal + kurve i det udfoldede rytterkort. Kortet folder ud LIGE UNDER
//      rytterens egen raekke (ejer 21/9, #3643) og er lukket ved indlaesning,
//      saa maalingerne her aabner det selv.
//
// Sproget er DANSK: stabilizePage laaser cz_lang til "da", saa labels her er
// de danske ("Løb", "Score").

const SCORED = {
  ...RIDERS[0],
  id: "rider-4851-scored",
  firstname: "Jonas",
  lastname: "Holm",
  team_id: TEST_TEAM.id,
  is_academy: false,
};

const RACING = {
  ...RIDERS[0],
  id: "rider-4851-racing",
  firstname: "Petter",
  lastname: "Iversen",
  team_id: TEST_TEAM.id,
  is_academy: false,
};

const RESTING = {
  ...RIDERS[0],
  id: "rider-4851-resting",
  firstname: "Aksel",
  lastname: "Krogh",
  team_id: TEST_TEAM.id,
  is_academy: false,
};

const SQUAD = [SCORED, RACING, RESTING];

// Rytterprofilen slaar rytteren op paa id (`?id=eq.<id>`) og viser kun
// traeningsfanen for EGNE ryttere. Det opslag falder tilbage til
// installNetworkMocks, som kun kender fixturens egne ryttere — profil-testene
// bruger derfor RIDERS[0] i stedet for en af de tre roster-ryttere ovenfor.
const PROFILE_RIDER = RIDERS[0];

// De sidste 7 loebsdage med ET hul (loebsdagen). Kurven skal tegne segmenter,
// ikke een polyline hen over hullet.
const SPARK = [
  { date: "2026-09-08", score: 41, raceDay: false },
  { date: "2026-09-09", score: 55, raceDay: false },
  { date: "2026-09-10", score: null, raceDay: true },
  { date: "2026-09-11", score: 49, raceDay: false },
  { date: "2026-09-12", score: 58, raceDay: false },
  { date: "2026-09-13", score: 66, raceDay: false },
  { date: "2026-09-14", score: 72, raceDay: false },
];

// De TRE tilstande paa een gang: et tal, en loebsdag uden tal, og en dag helt
// uden maaling. En rytter pr. tilstand, saa en raekke aldrig kan forveksles
// med en anden.
const TRAINING_SCORE = {
  [SCORED.id]: {
    today: 72,
    todayIsRaceDay: false,
    todaySession: "vo2max",
    spark: SPARK,
    avg: 57,
    best: 72,
    days: 23,
    contributions: [
      { key: "focusMatch", points: 9, direction: "up" },
      { key: "condition", points: -4, direction: "down" },
    ],
  },
  [RACING.id]: {
    today: null,
    todayIsRaceDay: true,
    todaySession: null,
    spark: SPARK,
    avg: 51,
    best: 66,
    days: 19,
    contributions: [],
  },
  // Hviledag: ingen score, ingen kurve, ingen gennemsnit. Det er kortets
  // TOMME tilstand — den maa ikke falde tilbage til den boks den erstattede.
  [RESTING.id]: {
    today: null,
    todayIsRaceDay: false,
    todaySession: null,
    spark: [],
    avg: null,
    best: null,
    days: 0,
    contributions: [],
  },
  [PROFILE_RIDER.id]: {
    today: 72,
    todayIsRaceDay: false,
    todaySession: "vo2max",
    spark: SPARK,
    avg: 57,
    best: 66,
    days: 23,
    contributions: [
      { key: "focusMatch", points: 9, direction: "up" },
      { key: "condition", points: -4, direction: "down" },
    ],
  },
};

// Samme svar, men UDEN en raekke for profil-rytteren. Det er den tilstand
// serveren leverer for en rytter der ikke har en maalt dag endnu:
// RiderTrainingTab sender `{}` videre, og kortet skal staa med sin tomme form.
const TRAINING_SCORE_WITHOUT_PROFILE_RIDER = Object.fromEntries(
  Object.entries(TRAINING_SCORE).filter(([id]) => id !== PROFILE_RIDER.id),
);

function trainingMe({ withScore = true, mobileTable = false, score = TRAINING_SCORE } = {}) {
  const body = {
    enabled: true,
    betaTester: true,
    teamId: TEST_TEAM.id,
    slots: { total: null, used: SQUAD.length, remaining: null },
    focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
    intensities: ["easy", "normal", "hard", "rest"],
    plans: {
      [SCORED.id]: { focus: "vo2max", intensity: "hard" },
      [RACING.id]: { focus: "endurance", intensity: "normal" },
      [RESTING.id]: { focus: "endurance", intensity: "rest" },
    },
    condition: {
      [SCORED.id]: { form: 71, fatigue: 28, injured_until: null, risk: 0 },
      [RACING.id]: { form: 64, fatigue: 41, injured_until: null, risk: 0 },
      [RESTING.id]: { form: 52, fatigue: 63, injured_until: null, risk: 0 },
    },
    progress: {},
    capped: {},
    trainability: {},
    smartDefaultFocus: {},
    weekPlan: null,
    riderWeekPlans: {},
    todayRun: null,
    mobileTable,
  };
  // Flaget OFF = feltet er slet ikke i svaret (backend udelader det). At sende
  // `trainingScore: null` ville teste en kontrakt serveren ikke har.
  if (withScore) body.trainingScore = score;
  return body;
}

async function mockTraining(page, options) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    const url = request.url();
    // Kun holdets roster-query overtages; rytterprofilens enkelt-opslag
    // (id=eq.<uuid>) falder tilbage til installNetworkMocks' egen form.
    if (request.method() === "GET" && !/[?&]id=eq\./.test(url)) return json(route, SQUAD);
    return route.fallback();
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, trainingMe(options));
  });
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

// ── 1. Kolonnen paa Daglig traening ─────────────────────────────────────────

test("#4851 Score-kolonnen viser tal, 'Løb' og streg — een raekke pr. tilstand", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Telefonen har sin egen visning (training_mobile_table) — daekket af mobil-testen nedenfor.",
  );
  await mockTraining(page, { withScore: true });
  await login(page);
  await page.goto("/training");

  const header = page.getByRole("columnheader", { name: /^Score/ }).first();
  await expect(header).toBeVisible();

  const scoredRow = page.locator("tbody tr", { hasText: "Jonas Holm" }).first();
  const racingRow = page.locator("tbody tr", { hasText: "Petter Iversen" }).first();
  const restingRow = page.locator("tbody tr", { hasText: "Aksel Krogh" }).first();

  // Tallet staar i rytterens EGEN raekke — et bart tal-match ville ogsaa ramme
  // form/traethed, saa cellen adresseres via score-kolonnens celle-indhold.
  await expect(scoredRow.getByText("72", { exact: true })).toBeVisible();
  // Loebsdag uden tal: ordet, aldrig et tal.
  await expect(racingRow.getByText(/^Løb$/)).toBeVisible();
  await expect(racingRow.getByText("72", { exact: true })).toHaveCount(0);
  // Ingen maaling: en streg. En streg er sand; et 0 ville vaere en paastand.
  await expect(restingRow.getByText("—", { exact: true }).first()).toBeVisible();
});

test("#4851 Score-kolonnen er sorterbar som de oevrige", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Kolonne-headers er telefonens visning uvedkommende; sorteringen ligger i RosterMobileSortControl.",
  );
  await mockTraining(page, { withScore: true });
  await login(page);
  await page.goto("/training");

  // Samme SortableTh-kontrakt som alder/form/traethed: aria-sort gaar fra
  // "none" til en retning ved klik. Et bart <th> var netop fejlen #3706 rettede.
  const header = page.getByRole("columnheader", { name: /^Score/ }).first();
  await expect(header).toHaveAttribute("aria-sort", "none");
  await header.getByRole("button").first().click();
  await expect(header).toHaveAttribute("aria-sort", "descending");

  // Desc: rytteren MED et tal staar oeverst. Ryttere uden et tal (loeb, hvile)
  // er null og lander sidst uanset retning — de maa ikke forurene toppen.
  await expect(page.locator("tbody tr").first()).toContainText("Jonas Holm");
});

test("#4851 kolonne-overskriften forklarer sig selv og linker til Hjaelp", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Overskriften findes kun i desktop-rosteret.",
  );
  await mockTraining(page, { withScore: true });
  // #5274: Hjaelp-siden (destinationen for linket herunder) gater
  // dailytraining.trainingScore-blokken bag training_score_visible
  // (SECTION_DEFS' `flag`-egenskab, helpFlagGates.js). installNetworkMocks'
  // generiske /api/**-fallback svarer {} paa GET /api/feature-flags, saa
  // uden denne override er flaget slukket og blokken korrekt skjult —
  // testen her klikker sig netop til den blok, saa den skal se flaget TAENDT,
  // som en viewer i beta-gruppen ville. Registreret EFTER installNetworkMocks'
  // route, saa den vinder (senest registrerede route vinder i Playwright).
  await page.route("**/api/feature-flags**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, { flags: { training_score_visible: true } });
  });
  await login(page);
  await page.goto("/training");

  // Kort tekst paa fladen (title-tooltip), prosa i Hjaelp (#4025). Uden begge
  // dele er "Score" et ord uden indhold — det var fundet 20/9.
  const header = page.getByRole("columnheader", { name: /^Score/ }).first();
  await expect(header).toHaveAttribute("title", /1-99/);

  const help = header.getByRole("link");
  await expect(help).toHaveAttribute("href", "/help?section=dailytraining");
  await help.click();
  await page.waitForURL(/\/help\?section=dailytraining/);
  // Hjaelpe-afsnittet findes og baerer den prosa fladen henviser til.
  await expect(page.getByText(/Træningsscoren/i).first()).toBeVisible();
});

// ── 2. Flaget off ───────────────────────────────────────────────────────────

test("#4851 flag off: Score-kolonnen findes ikke", async ({ page }, testInfo) => {
  test.skip(
    testInfo.project.name !== "desktop-chromium",
    "Samme kontrakt paa telefonen; maalt een gang paa den flade der har kolonnen.",
  );
  await mockTraining(page, { withScore: false });
  await login(page);
  await page.goto("/training");

  // Rosteret skal vaere hydreret, foer fravaeret af kolonnen betyder noget.
  await expect(page.locator("tbody tr", { hasText: "Jonas Holm" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: /^Score/ })).toHaveCount(0);
});

// ── 3. Rytterprofilens kort ─────────────────────────────────────────────────

test("#4851 profilkortet viser dagens tal, gennemsnit og bedste", async ({ page }) => {
  await mockTraining(page, { withScore: true });
  await login(page);
  await page.goto(`/riders/${PROFILE_RIDER.id}?tab=training`);

  const card = page.locator('[data-testid="rider-training-score-card"]');
  await expect(card).toBeVisible();
  await expect(card.getByText("72", { exact: true })).toBeVisible();
  // Gennemsnit og bedste over 30 loebsdage — ejer-beslutning 6 (6/9).
  await expect(card.getByText("57", { exact: true })).toBeVisible();
  await expect(card.getByText("66", { exact: true })).toBeVisible();
  // Kurven: loebsdagen efterlader et hul, saa den tegnes som segmenter.
  await expect(card.getByRole("img", { name: /Træningsscore, seneste 7 dage/i })).toBeVisible();
});

test("#4851 profilkortets TOMME tilstand: streg, ikke et maalt nul", async ({ page }) => {
  // Flaget er ON, men rytteren har ingen maalt dag — serveren udelader hans
  // raekke, og RiderTrainingTab sender `{}` videre.
  await mockTraining(page, { withScore: true, score: TRAINING_SCORE_WITHOUT_PROFILE_RIDER });
  await login(page);
  await page.goto(`/riders/${PROFILE_RIDER.id}?tab=training`);

  const card = page.locator('[data-testid="rider-training-score-card"]');
  await expect(card).toBeVisible();
  // Ingen score, ingen kurve. Kortet maa ikke vise et 0 og maa ikke falde
  // tilbage til den 30-dages-boks det erstattede.
  await expect(card.getByText("—").first()).toBeVisible();
  await expect(card.getByText("0", { exact: true })).toHaveCount(0);
  await expect(card.getByRole("img", { name: /Træningsscore, seneste 7 dage/i })).toHaveCount(0);
});

// ── 4. Mobilvisningen ───────────────────────────────────────────────────────

test("#4851 mobil: dagens tal staar i tabellen, tal + kurve i rytterens kort", async ({ page }) => {
  await mockTraining(page, { withScore: true, mobileTable: true });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/training");

  const roster = page.locator('[data-testid="training-mobile-roster"]');
  await roster.waitFor();

  // Kolonnen er der (loebsdags-flaget er off ⇒ een loebsdags-kolonne, saa
  // scoren holder budgettet "navn + hoejst 3 datakolonner").
  await expect(roster.getByRole("columnheader", { name: /^Score$/ })).toBeVisible();
  const scoredRow = roster.locator("tr", { hasText: /Holm/ }).first();
  await expect(scoredRow.getByText("72", { exact: true })).toBeVisible();
  // Loebsdag: ordet, ikke et tal — samme tilstand som desktop.
  await expect(roster.locator("tr", { hasText: /Iversen/ }).first().getByText(/^Løb$/)).toBeVisible();

  // Rytterens kort, foldet ud lige under hans egen række (ejer 21/9, #3643):
  // tal + kurve. Ingen rytter er foldet ud ved indlæsning, så trykket er
  // også det der åbner kortet.
  await expect(page.locator('[data-testid="training-mobile-score"]')).toHaveCount(0);
  await scoredRow.getByRole("button", { name: /Holm/ }).click();
  const scoreBlock = page.locator('[data-testid="training-mobile-score"]');
  await expect(scoreBlock).toBeVisible();
  await expect(scoreBlock.getByText("72", { exact: true })).toBeVisible();
  await expect(scoreBlock.getByRole("img", { name: /Træningsscore, seneste 7 dage/i })).toBeVisible();
});

test("#4851 mobil, flag off: hverken kolonne eller score-blok", async ({ page }) => {
  await mockTraining(page, { withScore: false, mobileTable: true });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/training");

  const roster = page.locator('[data-testid="training-mobile-roster"]');
  await roster.waitFor();
  await expect(roster.getByRole("columnheader", { name: /^Score$/ })).toHaveCount(0);
  // Kortet er lukket ved indlaesning (#3643, ejer 21/9), saa en bar taelling
  // paa nul ville vaere groen uanset flaget. Rytteren foldes ud FOERST, saa
  // maalingen siger noget om flaget og ikke om udgangstilstanden.
  await roster.locator("tr", { hasText: /Holm/ }).first().getByRole("button", { name: /Holm/ }).click();
  await expect(page.locator('[data-testid="training-mobile-rider-detail"]')).toHaveCount(1);
  await expect(page.locator('[data-testid="training-mobile-score"]')).toHaveCount(0);
});

// ── 5. Kolonnebredderne: ingen tekst uden for sin celle ─────────────────────
//
// Ejer-review 20/9 afviste tabellen som den var: navnekolonnen stod paa faste
// 124 px mens `table-fixed` delte HELE resten ligeligt mellem TODAY og SCORE.
// Paa 390 px fik "VO2" ca. 115 px, mens "TIME-TRIALIST/COBBLES SPECIALIST · F78
// · T59" blev presset ned i 3-4 linjer og stak ud over kolonnestregen. Det er
// samme fejlklasse som #5383/#5410 (tekst ud over sin boks), og den blev foerst
// synlig da #5449 fik `table-fixed` til at virke.
//
// Vagten her er MAALT, ikke set: for hvert element i tabellen kraeves
//
//   scrollWidth <= clientWidth      teksten er ikke bredere end sin egen kasse
//   kassen ligger inde i sin <td>   den krydser ikke kolonnestregen
//   meta-linjen fylder <= 2 linjer  og intet er klippet vaek af line-clamp
//
// `scrollWidth` er det led der faktisk fanger den gamle fejl: et for langt ord
// i en boks med `overflow: visible` flytter ikke elementets rect — det males
// bare uden for den — men det TAELLER i scrollWidth. En ren rect-sammenligning
// ville have vaeret groen paa praecis den fejl vi retter.
//
// Oven i det koeres den generelle tekst-vagt fra #5383 mod selve tabellen.
// Vagtens egen spec (5383-text-overflow-guard.spec.js) naar den ikke: den
// maaler /training med standard-mocken, som IKKE saetter `mobileTable`, saa
// mobil-tabellen findes slet ikke i den koersel. Det er her fladen bliver
// daekket.

// De LAENGSTE rigtige typenavne i begge sprog — ikke opdigtede strenge:
//   tt + brostensrytter  "Time-trialist/Cobbles specialist"  (laengst paa EN)
//   gc + brostensrytter  "Etapeløbsrytter/Brostensrytter"    (laengst paa DA)
//   puncheur + baroudeur "Puncheur/Baroudeur"                (ingen bindestreg
//                        og intet mellemrum at bryde paa — det var netop det
//                        ord der loeb ud over kolonnestregen)
const WIDE_SQUAD = [
  { id: "rider-4851-w1", firstname: "Mathias", lastname: "Sørensen", primary_type: "tt", secondary_type: "brostensrytter" },
  { id: "rider-4851-w2", firstname: "Kristoffer", lastname: "Ødegaard", primary_type: "gc", secondary_type: "brostensrytter" },
  { id: "rider-4851-w3", firstname: "Sebastian", lastname: "Mikkelsen", primary_type: "puncheur", secondary_type: "baroudeur" },
  { id: "rider-4851-w4", firstname: "Aleksander", lastname: "Kristiansen", primary_type: "brostensrytter", secondary_type: "gc" },
].map((rider) => ({ ...RIDERS[0], ...rider, team_id: TEST_TEAM.id, is_academy: false }));

// De laengste celle-etiketter kolonnen kan faa, een pr. rytter:
//   loebslaere     "Løbslære" (DA) / "Craft"   — laengste DA-session
//   echelon_drills "Vifte" (DA) / "Echelon"    — laengste EN-session
//   threshold      "Tærskel" (DA) / "Thresh"
//   ingen plan     "Ikke valgt" (DA) / "Not set" — den laengste af dem alle
const WIDE_PLANS = {
  "rider-4851-w1": { focus: "loebslaere", intensity: "easy" },
  "rider-4851-w2": { focus: "echelon_drills", intensity: "hard" },
  "rider-4851-w3": { focus: "threshold", intensity: "hard" },
};

const WIDE_CONDITION = Object.fromEntries(
  WIDE_SQUAD.map((rider, i) => [
    rider.id,
    // To cifre i baade form og traethed: "· F78 · T59" er den laengste hale
    // meta-linjen kan faa, og den er det der presser typenavnene.
    { form: 78 - i, fatigue: 59 + i, injured_until: null, risk: 0 },
  ]),
);

const WIDE_SCORE = Object.fromEntries(
  WIDE_SQUAD.map((rider, i) => [
    rider.id,
    i === 1
      ? { today: null, todayIsRaceDay: true, spark: SPARK, avg: 51, best: 66, days: 19, contributions: [] }
      : { today: 70 + i, todayIsRaceDay: false, todaySession: "vo2max", spark: SPARK, avg: 57, best: 72, days: 23, contributions: [] },
  ]),
);

async function mockWideTraining(page) {
  await page.route("**/rest/v1/riders**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    const url = request.url();
    if (request.method() === "GET" && !/[?&]id=eq\./.test(url)) return json(route, WIDE_SQUAD);
    return route.fallback();
  });
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, {
      ...trainingMe({ withScore: true, mobileTable: true, score: WIDE_SCORE }),
      slots: { total: null, used: WIDE_SQUAD.length, remaining: null },
      plans: WIDE_PLANS,
      condition: WIDE_CONDITION,
    });
  });
}

async function setLanguage(page, lang) {
  // #5747: src/i18n/index.js's egen filhoved (#5177) advarer eksplicit —
  // "Kald ALDRIG changeLanguage foer 'initialized' er udsendt". Lige efter
  // goto() kan i18next stadig vaere midt i SIN EGEN interne changeLanguage
  // (til det detekterede sprog), og de to kald deler `isLanguageChangingTo`.
  // Rammer vi ind i det vindue, kan vores "en"-kald tabe racen og blive
  // nulstillet tilbage til dansk — reproduceret lokalt: 2/5 koersler af
  // "360 px · en" viste stadig dansk indhold trods et fuldfoert
  // changeLanguage("en"). Derfor: vent paa isInitialized FOER vi aendrer
  // sproget, samme moenster som core-smoke.spec.js's forceEnglish().
  await expect.poll(() => page.evaluate(() => window.__i18n?.isInitialized === true)).toBe(true);
  await page.evaluate(async (next) => {
    window.localStorage.setItem("cz_lang", next);
    if (window.__i18n) await window.__i18n.changeLanguage(next);
  }, lang);
  await expect.poll(() => page.evaluate(() => window.__i18n?.language)).toBe(lang);
}

/**
 * Maal hver celle i mobil-tabellen. Returnerer een linje pr. problem, saa en
 * fejl peger paa et element og et pixel-tal frem for paa "noget flyder over".
 */
async function measureRoster(page) {
  return page.evaluate(() => {
    const roster = document.querySelector('[data-testid="training-mobile-roster"]');
    if (!roster) return { problems: ["tabellen findes ikke i DOM'en"], widths: null };

    const describe = (el) => {
      const cls = (el.getAttribute("class") || "").split(/\s+/).filter(Boolean).slice(0, 3).map((c) => `.${c}`).join("");
      const text = (el.textContent || "").replace(/\s+/g, " ").trim().slice(0, 48);
      return `${el.tagName.toLowerCase()}${cls} — "${text}"`;
    };

    const problems = [];
    for (const cell of roster.querySelectorAll("th, td")) {
      const cellRect = cell.getBoundingClientRect();
      for (const el of [cell, ...cell.querySelectorAll("*")]) {
        // (a) teksten er bredere end sin egen kasse. Det er leddet der fanger
        //     et ubrydeligt ord: rect'en flytter sig ikke, men scrollWidth gør.
        if (el.scrollWidth > el.clientWidth + 1) {
          problems.push(
            `${describe(el)} er ${el.scrollWidth - el.clientWidth} px bredere end sin kasse ` +
              `(scrollWidth ${el.scrollWidth} > clientWidth ${el.clientWidth})`,
          );
        }
        // (b) kassen selv stikker ud over cellen — kolonnestregen krydses.
        const rect = el.getBoundingClientRect();
        const out = Math.max(cellRect.left - rect.left, rect.right - cellRect.right);
        if (out > 1) problems.push(`${describe(el)} stikker ${Math.round(out)} px ud over sin celle`);
      }
    }

    // (c) meta-linjen: hoejst to linjer, og intet klippet vaek af line-clamp.
    for (const meta of roster.querySelectorAll("tbody .line-clamp-2")) {
      const range = document.createRange();
      range.selectNodeContents(meta);
      const lines = range.getClientRects().length;
      if (lines > 2) problems.push(`${describe(meta)} fylder ${lines} linjer (loftet er 2)`);
      if (meta.scrollHeight > meta.clientHeight + 1) {
        problems.push(`${describe(meta)} er klippet af line-clamp — ${meta.scrollHeight - meta.clientHeight} px skjult`);
      }
    }

    // Bredde-kontrakten: navnet skal have den STOERSTE kolonne, tal-kolonnerne
    // de smalle faste. Det var praecis omvendt foer #4851-rettelsen.
    const headers = [...roster.querySelectorAll("thead th")].map((th) => Math.round(th.getBoundingClientRect().width));
    return { problems, widths: { rider: headers[0], data: headers.slice(1) } };
  });
}

test.describe("#4851 · mobil-tabellen: ingen tekst uden for sin celle", () => {
  // Specen saetter selv sine bredder (360 og 390) og skifter sprog undervejs.
  // Koerte den ogsaa i mobile-chromium og mobile-webkit, ville den maale de
  // samme to bredder tre gange — samme afvejning som 5383-vagten, se dens
  // filhoved. Prisen, sagt hoejt: webkits egen ordbrydning maales ikke her.
  test.beforeEach(async ({ page }, testInfo) => {
    test.skip(
      testInfo.project.name !== "desktop-chromium",
      "Specen saetter selv sine viewports — se blokkens hoved for hvorfor kun eet projekt koerer den.",
    );
    await mockWideTraining(page);
    await login(page);
  });

  for (const width of [360, 390]) {
    for (const lang of ["da", "en"]) {
      test(`${width} px · ${lang}`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await page.goto("/training");
        await setLanguage(page, lang);

        const roster = page.locator('[data-testid="training-mobile-roster"]');
        await roster.waitFor();
        await page.evaluate(async () => {
          // Uden ventetid paa fonten maales Inter Tights metric-fallback, og
          // et overloeb paa 2-3 px ville komme og gaa mellem koersler.
          if (document.fonts?.ready) await document.fonts.ready;
        });
        // Tabellen skal baere de laengste typenavne, ellers maaler vi ingenting.
        await expect(roster).toContainText(lang === "da" ? /Brostensrytter/ : /Cobbles specialist/i);

        const { problems, widths } = await measureRoster(page);
        expect(
          problems.join("\n"),
          `Tekst uden for sin celle i mobil-traeningstabellen (${width} px, ${lang}). ` +
            `Ret bredderne i TrainingMobileRoster.tsx — wrap, min-w-0, break-words — ` +
            `frem for at skjule teksten:\n`,
        ).toBe("");

        // Navnekolonnen tager resten; tal-kolonnerne er de smalle faste.
        expect(widths.data.length).toBeGreaterThan(0);
        for (const dataWidth of widths.data) {
          expect(
            widths.rider,
            `navnekolonnen (${widths.rider} px) skal vaere bredere end tal-kolonnerne (${widths.data.join(", ")} px)`,
          ).toBeGreaterThan(dataWidth);
        }
      });
    }
  }

  // Den generelle tekst-vagt (#5383/#5410) mod selve tabellen — den naar ikke
  // hertil i sin egen spec, fordi standard-mocken ikke taender mobil-tabellen.
  for (const lang of ["da", "en"]) {
    test(`tekst-vagten (#5383) paa tabellen · ${lang}`, async ({ page }) => {
      await page.setViewportSize({ width: 390, height: 844 });
      await page.goto("/training");
      await setLanguage(page, lang);
      await page.locator('[data-testid="training-mobile-roster"]').waitFor();
      await page.evaluate(async () => {
        if (document.fonts?.ready) await document.fonts.ready;
      });

      const findings = (await scanPageForTextDefects(page, { root: '[data-testid="training-mobile-roster"]' }))
        // Kontrast doemmes pr. FARVEPAR i vagtens egen allowlist, ikke pr.
        // flade: `--text-3` paa kortbaggrunden er det samme fund paa 11 sider
        // og rettelsen er EEN token-vaerdi (se text-overflow-allowlist.js).
        // Den gaeld hoerer ikke til i en tabel-geometri-test.
        .filter((finding) => !finding.detail.includes("kontrast"));

      expect(
        findings.map((f) => formatFinding({ ...f, where: `${lang} · 390 px` })).join("\n"),
        `Tekst-vagten fandt ${findings.length} problemer i mobil-traeningstabellen (${lang}, 390 px).\n`,
      ).toBe("");
    });
  }
});
