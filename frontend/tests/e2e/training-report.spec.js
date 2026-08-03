import { test, expect } from "@playwright/test";
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
  await expect(page.getByText(/71\s*→\s*72/)).toBeVisible();

  // Result-kolonnen har erstattet rå score: ingen "Score"-kolonne mere.
  await expect(page.getByRole("columnheader", { name: "Resultat" }).first()).toBeVisible();
  await expect(page.getByRole("columnheader", { name: "Score" })).toHaveCount(0);

  // Roster viser progress-kolonnen mod næste +1 (anticipation).
  await expect(page.getByRole("columnheader", { name: "Næste +1" }).first()).toBeVisible();

  // #1937: en hviledags-rytter MED valgt fokus vises som "Hviledag" i Næste +1,
  // ikke som "Intet fokus valgt". Fokus-kolonnen viser stadig fokusset.
  await expect(page.getByText("Hviledag")).toBeVisible();
  await expect(page.getByText("Intet fokus valgt")).toHaveCount(0);
});

// #3194: portræt-regression fra PR #3075 — den nye Type/Form/Træthed-underlinje
// var whitespace-nowrap i en STICKY navnecelle, så navnekolonnen voksede til
// ~skærmbredde i portræt og efterlod fokus/intensitet som en ubrugelig
// scroll-strimmel (2 spillere, iOS Safari + Android Firefox, 31/7). Kontrakten:
// den sticky region (checkbox + navn) må højst optage ~65 % af viewporten på
// mobil, så de redigerbare kolonner har reel plads at scrolle i.
test("#3194: portræt — sticky navnekolonne æder ikke skærmen", async ({ page }) => {
  await login(page);
  await page.goto("/training");
  await expect(page.getByRole("columnheader", { name: "Næste +1" }).first()).toBeVisible();

  const viewport = page.viewportSize();
  test.skip(viewport.width >= 640, "portræt-kolonnekontrakten gælder kun under sm-breakpointet");

  // Rækkens navnecelle er den 2. sticky-celle ([0] = checkbox-cellen, w-10).
  const nameCell = page.locator("tbody td.sticky-name-cell").nth(1);
  await expect(nameCell).toBeVisible();
  const box = await nameCell.boundingBox();
  expect(box.x + box.width, "sticky region (checkbox + navn) skal efterlade plads til fokus/intensitet")
    .toBeLessThanOrEqual(viewport.width * 0.65);

  // Underlinjens fold-info er der stadig (den blev ombrudt, ikke fjernet).
  await expect(nameCell.getByText(/Form 75/i)).toBeVisible();
});
