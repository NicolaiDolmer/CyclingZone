// #4557 (S-M2c) · Aarsmoedet (/board/meeting). Spec-krav (docs/slices/09c-
// board-annual-meeting.md §5.3 + orkestrator-briefen):
//   1. To-klik-stien: "Enter annual meeting" fra Boardroom → "Sign mandate"
//      underskriver mandatet uden yderligere klik.
//   2. Stretch paa et maal viser ejerens forudberegnede reaktion inline.
//   3. En anmodning viser ALTID et modtilbud (aldrig et rent nej) — synligt
//      i det oejeblik anmodningen vaelges, foer underskrift.
//   4. Deadline-teksten ("signs automatically in N days") er synlig i
//      sidehovedet.
import { readFileSync } from "node:fs";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

// Samme moenster som manager-profile.spec.js/network-abort-leaves-no-stuck-
// loading.spec.js: readFileSync + JSON.parse i stedet for et ESM JSON-import
// (Playwright-test-runnerens transform understoetter ikke import-attributter).
const boardRoomFixture = JSON.parse(
  readFileSync(new URL("../../src/pages/boardroom/__fixtures__/boardRoom.json", import.meta.url), "utf8"),
);

const SEASON_NUMBER = 4;
const DEADLINE_DAYS = 5;

function inDays(n) {
  return new Date(Date.now() + n * 24 * 60 * 60 * 1000).toISOString();
}

function buildGoals() {
  return [
    {
      goalKey: "meeting-stage-wins",
      type: "stage_wins",
      target: 4,
      label: "Mindst 4 etapesejre i sæsonen",
      label_key: null,
      cumulative: false,
      race_scope: null,
      nationality_code: null,
      satisfaction_bonus: 6,
      satisfaction_penalty: 3,
      owner: { archetypeKey: "resultatjaegeren", name: "Jørgen Brandt", initials: "JB" },
      options: {
        easier: { target: 3, label: "Mindst 3 etapesejre i sæsonen", satisfaction_bonus: 3, satisfaction_penalty: 1.5 },
        keep: { target: 4, label: "Mindst 4 etapesejre i sæsonen", satisfaction_bonus: 6, satisfaction_penalty: 3 },
        stretch: { target: 5, label: "Mindst 5 etapesejre i sæsonen", satisfaction_bonus: 9, satisfaction_penalty: 4.5 },
      },
      reactions: {
        easier: { textKey: "archetypes.resultatjaegeren.reactions.meeting_easier.0", textFallback: "", memberName: "Jørgen Brandt" },
        stretch: { textKey: "archetypes.resultatjaegeren.reactions.meeting_stretch.0", textFallback: "", memberName: "Jørgen Brandt" },
      },
    },
    {
      goalKey: "meeting-no-debt",
      type: "no_outstanding_debt",
      target: 0,
      label: "Ingen udestående gæld ved sæsonens afslutning",
      label_key: null,
      cumulative: false,
      race_scope: null,
      nationality_code: null,
      satisfaction_bonus: 5,
      satisfaction_penalty: 3,
      owner: { archetypeKey: "sponsoraten", name: "Søren Lindqvist", initials: "SL" },
      options: { easier: null, keep: { target: 0, label: "Ingen udestående gæld ved sæsonens afslutning", satisfaction_bonus: 5, satisfaction_penalty: 3 }, stretch: null },
      reactions: { easier: null, stretch: null },
    },
  ];
}

function buildRequestOptions() {
  return [
    {
      type: "lower_results_pressure",
      label_key: "requestDefs.lower_results_pressure.label",
      description_key: "requestDefs.lower_results_pressure.description",
      tradeoff_preview_key: "requestDefs.lower_results_pressure.tradeoffPreview",
      label: "", description: "", tradeoff_preview: "",
      disabled: false, disabled_reason: null, disabled_reason_key: null, disabled_reason_params: {},
    },
    {
      type: "more_youth_focus",
      label_key: "requestDefs.more_youth_focus.label",
      description_key: "requestDefs.more_youth_focus.description",
      tradeoff_preview_key: "requestDefs.more_youth_focus.tradeoffPreview",
      label: "", description: "", tradeoff_preview: "",
      disabled: false, disabled_reason: null, disabled_reason_key: null, disabled_reason_params: {},
    },
  ];
}

function buildMeetingPayload({ requestUsed = false } = {}) {
  return {
    available: true,
    mandate: {
      id: "mandate-e2e-meeting",
      seasonNumber: SEASON_NUMBER,
      focus: "youth_development",
      deadlineAt: inDays(DEADLINE_DAYS),
      adjustments: { allowed: 2, used: 0 },
      trustTier: "trusted",
      goals: buildGoals(),
    },
    request: { options: requestUsed ? [] : buildRequestOptions() },
    visionSlot: null,
  };
}

// Registrerer /api/board/room + /api/board/meeting* OVEN PAA installNetworkMocks
// (senest registrerede route vinder i Playwright — samme moenster som
// installBoardStatusMock). `signed` er en delt state-container saa GET
// /board/meeting svarer available:false EFTER POST /sign (idempotens-
// signalet UI'en er afhaengig af naar den navigerer tilbage til /board).
async function installMeetingMocks(page) {
  const state = { signed: false, lastSignBody: null };

  await page.route("**/api/board/room", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(boardRoomFixture) });
  });

  await page.route("**/api/board/meeting", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    const body = state.signed ? { available: false } : buildMeetingPayload();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });

  await page.route("**/api/board/meeting/sign", (route) => {
    if (route.request().method() !== "POST") return route.fallback();
    state.lastSignBody = JSON.parse(route.request().postData() || "{}");
    state.signed = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ...boardRoomFixture, request_outcome: null, vision_slot_outcome: null }),
    });
  });

  return state;
}

test("to-klik-stien: Enter annual meeting fra Boardroom, saa Sign mandate underskriver (#4557)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  const state = await installMeetingMocks(page);

  await login(page);
  await page.goto("/board");

  // Klik 1: gold-CTA'en paa Boardroom (kun synlig fordi /api/board/meeting → available:true).
  await page.getByRole("button", { name: "Gå til årsmødet" }).click();
  await expect(page).toHaveURL(/\/board\/meeting$/);
  await expect(page.getByRole("heading", { level: 1 })).toContainText(`${SEASON_NUMBER}`);

  // Klik 2: signér uden at aendre noget (alle mål paa Behold/Keep).
  await page.getByRole("button", { name: "Underskriv mandat" }).click();
  await expect(page).toHaveURL(/\/board$/);

  expect(state.lastSignBody.mandateId).toBe("mandate-e2e-meeting");
  expect(state.lastSignBody.adjustments).toEqual([]);
  expect(state.lastSignBody.request).toBeNull();
});

test("Stræk paa et mål viser ejerens forudberegnede reaktion inline (#4557)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installMeetingMocks(page);

  await login(page);
  await page.goto("/board/meeting");
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();

  // Goal 1 (stage_wins) kommer først i DOM-rækkefølgen — dens Stræk-pille er
  // den eneste AKTIVEREDE (Goal 2 er binær og har ingen Stræk-mulighed).
  await page.getByRole("button", { name: "Stræk" }).first().click();

  // Mål-titlen opdaterer sig til det strakte tal (type-styret resolver,
  // lib/boardGoalLabel.js: "stage_wins" → "Mindst N sejre"), og medlemmets
  // citat vises inline (spec §4.2: kun ved Easier/Stretch, ikke Keep).
  await expect(page.getByText("Mindst 5 sejre")).toBeVisible();
  await expect(page.getByText(/Jørgen Brandt bakker op om stræk/)).toBeVisible();

  // Det binaere mål (Goal 2, no_outstanding_debt) kan IKKE strækkes —
  // pillen er deaktiveret, ikke et dødt klik (#3012-klassen).
  await expect(page.getByRole("button", { name: "Stræk" }).last()).toBeDisabled();
});

test("en anmodning viser altid et modtilbud, aldrig et rent nej (#4557)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installMeetingMocks(page);

  await login(page);
  await page.goto("/board/meeting");
  await expect(page.getByText("Din anmodning · 1 pr. møde")).toBeVisible();

  // "Sænk resultatpresset" (lower_results_pressure) er den første anmodnings-
  // raekke i mocken.
  await page.getByRole("button", { name: "Vælg" }).first().click();

  // Modtilbuddet ("hvis de siger ja, forventer de typisk...") er synligt med
  // det samme — anmodningen praesenteres ALDRIG som et tomt "ja/nej".
  await expect(page.getByText(/strammere økonomisk disciplin/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Skift anmodning" })).toBeVisible();
});

test("deadline-teksten viser dage tilbage til automatisk underskrift (#4557)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installMeetingMocks(page);

  await login(page);
  await page.goto("/board/meeting");

  await expect(page.getByText(new RegExp(`automatisk om ${DEADLINE_DAYS} dage`))).toBeVisible();
});
