// #1076 · E2E-dækning af det interaktive board (non-baseline fase).
// core-smoke's /board-fixture er baseline-fase → kun observations-banneret
// testes dér. Denne spec bruger den genbrugelige makeBoardStatus-fixture
// (fixtures.js) til at rendre HELE det interaktive board og dækker de
// sektioner board-auditen (2026-06, Dim A/C) fandt udækkede:
//   - aktiv plan + mål-kort (plan-faner)        - medlems-grid
//   - klub-DNA badge + drivers-panel            - aktive konsekvenser (lag 2-5)
//   - bonus-tilbud (lag 6) inkl. accept-flow    - auto-accept countdown
//   - DNA-valg (sæson 2-onboarding)             - bestyrelse-feed
// Wizard-flowet er allerede dækket af board-wizard-back/-negotiate-deadclick.
import { test, expect } from "@playwright/test";
import {
  installNetworkMocks,
  installBoardStatusMock,
  login,
  json,
  makeBoardStatus,
  stabilizePage,
  TEXT_MASK_SELECTOR,
  waitForStableSnapshotTarget,
} from "./fixtures.js";

// Samme dev-noise-filter som core-smoke: WebKit + Vite HMR + route-mocks giver
// dev-only fejl der ikke reproducerer på prod iOS Safari.
const WEBKIT_DEV_NOISE = [/Importing a module script failed/i, /due to access control checks/i];

const BOARD_FEED_NOTIFICATIONS = [
  {
    id: "notif-board-1",
    type: "board_update",
    title: "Bestyrelsen er tilfreds",
    message: "Tilfredsheden steg efter sidste løbsdag.",
    created_at: "2026-05-14T10:00:00.000Z",
    read: true,
  },
  {
    id: "notif-board-2",
    type: "board_critical",
    title: "Tvunget salg undervejs",
    message: "I har få race-days til at sælge.",
    created_at: "2026-05-15T10:00:00.000Z",
    read: false,
  },
];

test("interactive board renders every section without page errors + layout snapshot (#1076)", async ({ page }, testInfo) => {
  const isWebkit = testInfo.project.name.includes("webkit");
  const pageErrors = [];
  page.on("pageerror", (error) => {
    if (isWebkit && WEBKIT_DEV_NOISE.some((p) => p.test(error.message))) return;
    pageErrors.push(error.message);
  });

  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardStatusMock(page, makeBoardStatus({
    active_consequences: [
      { id: "cons-layer2", layer: 2, severity: 250000, payload: {} },
      { id: "cons-layer4", layer: 4, severity: 90000, payload: { rider_name: "Ada Pedersen" } },
    ],
    bonus_offer: { id: "bonus-1", layer: 6, severity: 200000, payload: { extra_goal_label: "Vind 1 ekstra etape" } },
  }));
  await page.route("**/api/notifications**", route => {
    if (route.request().method() !== "GET") return route.fallback();
    return json(route, BOARD_FEED_NOTIFICATIONS);
  });

  await login(page);
  await page.goto("/board");

  // Interaktiv fase — baseline-banneret må IKKE vises.
  await expect(page.getByRole("heading", { name: "Bestyrelse", exact: true })).toBeVisible();
  await expect(page.getByText("Bestyrelsen observerer din første sæson")).toHaveCount(0);

  // Klub-DNA badge + "Hvad vægter dette board?"-panel.
  await expect(page.getByText("Klubbens DNA")).toBeVisible();
  await expect(page.getByText("Skandinavisk udviklingshold").first()).toBeVisible();
  await expect(page.getByTestId("board-drivers")).toBeVisible();

  // Medlems-grid: 3 medlemmer, formanden er markeret.
  await expect(page.getByText("3 medlemmer")).toBeVisible();
  await expect(page.getByRole("button", { name: /Sponsoraten/ })).toBeVisible();
  await expect(page.getByText("Formand", { exact: true })).toBeVisible();

  // Bonus-tilbud (lag 6) med aktiverede handlinger.
  await expect(page.getByText("Bonus-tilbud fra bestyrelsen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Acceptér tilbud" })).toBeEnabled();
  await expect(page.getByRole("button", { name: "Afvis" })).toBeEnabled();

  // Aktive konsekvenser (lag 2 = warning, lag 4 = kritisk).
  await expect(page.getByText("Aktive konsekvenser")).toBeVisible();
  await expect(page.getByText("2 aktive")).toBeVisible();
  await expect(page.getByText("Lønloft", { exact: true })).toBeVisible();
  await expect(page.getByText("Tvunget salg", { exact: true })).toBeVisible();

  // Aktiv plan: fane-bar + mål-kort i panelet.
  const tablist = page.getByRole("tablist", { name: "Planhorisonter" });
  await expect(tablist).toBeVisible();
  await expect(tablist.getByRole("tab")).toHaveCount(3);
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("5-årsplan").first()).toBeVisible();
  await expect(panel.getByText("Win 3 stages")).toBeVisible();

  // Bestyrelse-feed med kritisk "Skal handles"-event.
  await expect(page.getByText("Bestyrelse-feed")).toBeVisible();
  await expect(page.getByText("Skal handles")).toBeVisible();

  // Layout-snapshot (tekst maskeret — samme mønster som core-smoke, se
  // fixtures.js). Fanger at sektioner forsvinder/kollapser uden copy-kobling.
  await waitForStableSnapshotTarget(page);
  await expect(page).toHaveScreenshot("board-interactive.png", {
    animations: "disabled",
    caret: "hide",
    scale: "css",
    mask: [page.locator(TEXT_MASK_SELECTOR)],
    maxDiffPixelRatio: 0.05,
  });

  expect(pageErrors).toEqual([]);
});

test("bonus offer accept posts offer_id and removes the card after refetch (#1076)", async ({ page }) => {
  let boardStatus = makeBoardStatus({
    bonus_offer: { id: "bonus-1", layer: 6, severity: 200000, payload: { extra_goal_label: "Vind 1 ekstra etape" } },
  });
  let postedBody = null;

  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardStatusMock(page, () => boardStatus);
  await page.route("**/api/board/bonus-offer/accept", route => {
    postedBody = JSON.parse(route.request().postData() || "{}");
    // Backend markerer tilbuddet som accepteret → næste status-fetch er uden offer.
    boardStatus = makeBoardStatus();
    return json(route, { ok: true });
  });

  await login(page);
  await page.goto("/board");

  await expect(page.getByText("Bonus-tilbud fra bestyrelsen")).toBeVisible();
  await page.getByRole("button", { name: "Acceptér tilbud" }).click();

  // Kortet forsvinder efter refetch, og accept-kaldet bar det rigtige offer_id.
  await expect(page.getByText("Bonus-tilbud fra bestyrelsen")).toHaveCount(0);
  expect(postedBody).toEqual({ offer_id: "bonus-1" });

  // Resten af boardet står stadig (ingen blank-screen efter reload af state).
  await expect(page.getByRole("tablist", { name: "Planhorisonter" })).toBeVisible();
});

test("auto-accept countdown shows waiting and last-chance variants for expired plan (#1076)", async ({ page }) => {
  const expiredPlan = {
    board: { satisfaction: 60, focus: "balanced", current_goals: [] },
    plan_duration: 5,
    seasons_remaining: 0,
    seasons_completed: 5,
    plan_progress_pct: 100,
    cumulative_stats: { stage_wins: 0, gc_wins: 0 },
    snapshots: [],
    is_expired: true,
    renew_locked: false,
    outlook: null,
    request_status: null,
    request_options: [],
  };
  let daysLeft = 3;

  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardStatusMock(page, () => makeBoardStatus({
    plans: { "5yr": expiredPlan, "3yr": null, "1yr": null },
    auto_accept: { deadline_days: 5, days_since_open: 2, days_left: daysLeft, pending_plan_type: "5yr" },
  }));

  await login(page);
  await page.goto("/board");

  // 3 dage tilbage → warning-variant.
  await expect(page.getByText(/Bestyrelsen venter på din forhandling, 3 dage tilbage/)).toBeVisible();

  // 1 dag tilbage → kritisk "sidste chance"-variant.
  daysLeft = 1;
  await page.reload();
  await expect(page.getByText(/Sidste chance, bestyrelsen tager over om 1 dag/)).toBeVisible();
  await expect(page.getByText(/vælger bestyrelsen selv en plan/)).toBeVisible();
});

test("DNA selection card renders suggestions and choosing posts dna_key (#1076)", async ({ page }) => {
  const suggestions = [
    { key: "skandinavisk_udvikling", emoji: "🌱", suggestion_slot: "national_match" },
    { key: "italiensk_klassiker", emoji: "🏛️", suggestion_slot: "specialization_match" },
    { key: "sprint_kommerciel", emoji: "💨", suggestion_slot: "wildcard" },
  ];
  let boardStatus = makeBoardStatus({ team_dna: null, dna_suggestions: suggestions, team_members: [] });
  let postedBody = null;

  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardStatusMock(page, () => boardStatus);
  await page.route("**/api/board/dna-choose", route => {
    postedBody = JSON.parse(route.request().postData() || "{}");
    boardStatus = makeBoardStatus(); // DNA valgt → badge + medlemmer i næste fetch.
    return json(route, { team_dna: boardStatus.team_dna, team_members: boardStatus.team_members });
  });

  await login(page);
  await page.goto("/board");

  // Uden DNA: valg-kortet vises med 3 forslag, ingen badge/medlems-grid endnu.
  await expect(page.getByText("Vælg klubbens identitet")).toBeVisible();
  await expect(page.getByRole("button", { name: "Vælg dette DNA" })).toHaveCount(3);
  await expect(page.getByText("Skandinavisk udviklingshold")).toBeVisible();
  await expect(page.getByText("Klubbens DNA")).toHaveCount(0);

  await page.getByRole("button", { name: "Vælg dette DNA" }).first().click();

  // Valget POSTes med dna_key, og boardet skifter til badge + medlems-grid.
  await expect(page.getByText("Vælg klubbens identitet")).toHaveCount(0);
  expect(postedBody).toEqual({ dna_key: "skandinavisk_udvikling" });
  await expect(page.getByText("Klubbens DNA")).toBeVisible();
  await expect(page.getByText("3 medlemmer")).toBeVisible();
});

test("first-season teams can re-choose their club DNA (#2022)", async ({ page }) => {
  // Forslagene inkluderer det allerede valgte DNA (skandinavisk = makeBoardStatus-
  // default) + to alternativer. dna_can_rechoose=true → holdet er stadig i sin
  // første sæson, så "Skift klub-DNA"-affordancen vises.
  const suggestions = [
    { key: "skandinavisk_udvikling", emoji: "🌱", suggestion_slot: "national_match" },
    { key: "italiensk_klassiker", emoji: "🏛️", suggestion_slot: "specialization_match" },
    { key: "sprint_kommerciel", emoji: "💨", suggestion_slot: "wildcard" },
  ];
  const boardStatus = makeBoardStatus({ dna_can_rechoose: true, dna_suggestions: suggestions });
  let postedBody = null;

  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardStatusMock(page, () => boardStatus);
  await page.route("**/api/board/dna-choose", route => {
    postedBody = JSON.parse(route.request().postData() || "{}");
    return json(route, { ok: true, team_dna: boardStatus.team_dna, team_members: boardStatus.team_members });
  });

  await login(page);
  await page.goto("/board");

  // Det valgte DNA vises som badge + re-valg-toggle. Forslagene er kollapset by default.
  await expect(page.getByText("Klubbens DNA")).toBeVisible();
  const toggle = page.getByRole("button", { name: "Skift klub-DNA" });
  await expect(toggle).toBeVisible();
  await expect(page.getByRole("button", { name: "Skift til dette DNA" })).toHaveCount(0);

  await toggle.click();

  // Udfoldet: det nuværende DNA er markeret (ingen skift-knap), de to andre kan vælges.
  await expect(page.getByText("Skift dit klub-DNA")).toBeVisible();
  await expect(page.getByText("Nuværende", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Skift til dette DNA" })).toHaveCount(2);

  await page.getByRole("button", { name: "Skift til dette DNA" }).first().click();
  expect(postedBody).toEqual({ dna_key: "italiensk_klassiker" });
});
