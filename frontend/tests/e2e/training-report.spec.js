import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, TEST_TEAM,
} from "./fixtures.js";

// Trænings-polish (#1305): rapporten skal vise dags-opsummering, progress mod
// næste +1, og et gennembrud som faktisk tal-spring (71 → 72) — ikke rå score.
// Mocker /api/training/me med ét gennembrud (rider-1, climbing 71 → 72) oven på
// standard-fixturen (riders kommer fra Supabase-mocken: rider-1 = Ada Pedersen).

const TRAINING_ME = {
  enabled: true,
  betaTester: true,
  teamId: TEST_TEAM.id,
  slots: { total: null, used: 1, remaining: null },
  focuses: ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"],
  intensities: ["easy", "normal", "hard", "rest"],
  plans: { "rider-1": { focus: "vo2max", intensity: "hard" } },
  condition: { "rider-1": { form: 75, fatigue: 20, injured_until: null, risk: 0 } },
  // climbing tæt på gennembrud (91 %) → baren bliver grøn i roster + rapport.
  progress: { "rider-1": { climbing: 0.91, punch: 0.3, tempo: 0.5 } },
  todayRun: {
    executed_by: "manual",
    bonus_applied: true,
    tick_date: "2026-06-18",
    report: {
      bonus_applied: true,
      executed_by: "manual",
      tick_date: "2026-06-18",
      riders: [
        {
          rider_id: "rider-1",
          name: "Ada Pedersen",
          score: 12,
          gains: { climbing: 1 },
          gains_detail: { climbing: { from: 71, to: 72 } },
          status: "over",
          form: 75,
          fatigue: 20,
          fatigue_delta: -5,
          injured: false,
          injury_days: 0,
          focus: "vo2max",
          intensity: "hard",
        },
        {
          // #1937: hviledags-rytter MED valgt fokus — må ikke vises som "uden fokus".
          rider_id: "rider-2",
          name: "Ming Zhou",
          score: 0,
          gains: {},
          gains_detail: {},
          status: "neutral",
          form: 60,
          fatigue: 30,
          fatigue_delta: 0,
          injured: false,
          injury_days: 0,
          focus: "endurance",
          intensity: "rest",
        },
      ],
    },
  },
};

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  // #3643: denne spec maaler DESKTOP-rosterets indhold. Telefonen har siden
  // 18/9 sin egen visning (tabel med dagens loebsdage, mockup 2), og den er
  // daekket af 3643-training-mobile.spec.js. Viewporten saettes derfor
  // eksplicit, saa alle tre projekter bliver ved med at koere DENNE flade i
  // deres egen motor i stedet for at teste en flade der ikke findes laengere.
  await page.setViewportSize({ width: 1280, height: 900 });
  await installNetworkMocks(page);
  // Override OVEN PÅ installNetworkMocks (senest registrerede route vinder).
  await page.route("**/api/training/me**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") {
      return route.fulfill({ status: 204, headers: corsHeaders(request) });
    }
    return json(route, TRAINING_ME);
  });
});

test("training report shows day summary, progress and breakthrough jump", async ({ page }) => {
  await login(page);
  await page.goto("/training");

  // Dags-opsummering (payoff, holdniveau) — DA-locale via stabilizePage.
  await expect(page.getByText("Ryttere trænet")).toBeVisible();
  await expect(page.getByText("Gennembrud")).toBeVisible();
  await expect(page.getByText("I topform")).toBeVisible();

  // Gennembrud vist som faktisk tal-spring (71 → 72), ikke flad "+1".
  // #3924: samme spring findes nu OGSÅ i den sammenfoldede kvitteringslinje
  // ("Landede et point i Klatring: 71 → 72."), så locatoren matcher rapportens
  // rækkefølge ("71 → 72 Klatring") for at ramme den synlige Resultat-celle.
  await expect(page.getByText(/71\s*→\s*72\s*Klatring/)).toBeVisible();

  // Result-kolonnen har erstattet rå score: ingen "Score"-kolonne mere.
  await expect(page.getByRole("columnheader", { name: "Resultat" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Score" })).toHaveCount(0);

  // Roster viser progress-kolonnen mod næste +1 (anticipation).
  await expect(page.getByRole("columnheader", { name: "Næste +1" }).first()).toBeVisible();

  // #1937: en hviledags-rytter MED valgt fokus vises som "Hviledag" i Næste +1,
  // ikke som "Intet fokus valgt". Fokus-kolonnen viser stadig fokusset.
  // #3924: exact, så kvitteringens "Hviledag. Træthed …"-linje ikke rammer strict mode.
  await expect(page.getByText("Hviledag", { exact: true })).toBeVisible();
  await expect(page.getByText("Intet fokus valgt")).toHaveCount(0);
});

// #3194's portræt-test ("sticky navnekolonne æder ikke skærmen") er SLETTET her
// af #3643. Den målte en tilstand der ikke findes længere: desktop-rosterets
// sticky navnekolonne blev aldrig tegnet i portræt, fordi telefonen siden 18/9
// har sin egen visning (tabel med dagens løbsdage, mockup 2). Den regression
// fejlklassen handlede om — at siden ender bag vandret scroll på en telefon —
// er nu målt direkte på `document.scrollingElement.scrollWidth` ved både 412 px
// og 375 px i `3643-training-mobile.spec.js`, altså strengere end 65 %-reglen
// her. Testen er fjernet frem for at blive skippet, så der ikke står en grøn
// test tilbage der ikke måler noget.
