import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM, RIDERS,
} from "./fixtures.js";

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

// #6030: telefonens Today er række-listen (TodayRowsMobile) for alle, siden
// training_program_cells gik on 1/10. Den gamle mobil-tabel med Score-kolonne
// er slettet; scoren står i rytterens kort.
test("#4851 mobil: tal + kurve i rytterens kort", async ({ page }) => {
  await mockTraining(page, { withScore: true, mobileTable: true });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/training");

  const holm = page.getByTestId("training-onetap-row").filter({ hasText: /Holm/ });
  await holm.first().waitFor();

  // Ingen rytter er foldet ud ved indlæsning, så trykket er også det der
  // åbner kortet (ejer 21/9, #3643).
  await expect(page.locator('[data-testid="training-mobile-score"]')).toHaveCount(0);
  await holm.first().getByRole("button").first().click();
  const scoreBlock = page.locator('[data-testid="training-mobile-score"]');
  await expect(scoreBlock).toBeVisible();
  await expect(scoreBlock.getByText("72", { exact: true })).toBeVisible();
  await expect(scoreBlock.getByRole("img", { name: /Træningsscore, seneste 7 dage/i })).toBeVisible();
});

test("#4851 mobil, flag off: ingen score-blok i kortet", async ({ page }) => {
  await mockTraining(page, { withScore: false, mobileTable: true });
  await login(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/training");

  const holm = page.getByTestId("training-onetap-row").filter({ hasText: /Holm/ });
  await holm.first().waitFor();
  // Kortet er lukket ved indlaesning, saa rytteren foldes ud FOERST, saa
  // maalingen siger noget om flaget og ikke om udgangstilstanden.
  await holm.first().getByRole("button").first().click();
  await expect(page.getByTestId("training-onetap-detail")).toHaveCount(1);
  await expect(page.locator('[data-testid="training-mobile-score"]')).toHaveCount(0);
});
