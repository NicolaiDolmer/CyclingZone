// #955 forward-guard: bestyrelsens 5/3/1-års-planer vises som FANER (én ad gangen,
// fuld bredde) i stedet for et 3-kolonne grid. core-smoke's board-fixture er
// baseline-fase (interaktivt board-UI rendres ikke), så denne spec mocker en
// non-baseline board-status med rigtige plan-data — det "non-baseline board-fixture"
// testhul som board-auditen (Pakke 4) bad om at lukke. Verificerer: fane-bar med 3
// faner, kvalitativ standing-label skifter ved fane-skift, #818-forhandlingsrækkefølge.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

const plan5yr = {
  board: {
    satisfaction: 75,
    focus: "balanced",
    current_goals: [
      { type: "stage_wins_total", target: 3, label: "Win 3 stages", importance: "required" },
      { type: "relative_rank", target: 5, label: "Top 5 in division" },
      // #815 · gammel DB-label med vilje → frontenden skal omdøbe til "højt omdømme".
      { type: "signature_rider", target: 1, label: "Mindst 1 stjerne-rytter (popularity >= 75)" },
    ],
  },
  plan_duration: 5,
  seasons_remaining: 3,
  seasons_completed: 2,
  plan_progress_pct: 40,
  cumulative_stats: { stage_wins: 1, gc_wins: 0 },
  snapshots: [
    { id: "s1", season_number: 1, season_within_plan: 1, division_rank: 4, stage_wins: 1, gc_wins: 0, goals_met: 1, goals_total: 2, satisfaction_delta: 5 },
    { id: "s2", season_number: 2, season_within_plan: 2, division_rank: 3, stage_wins: 0, gc_wins: 0, goals_met: 1, goals_total: 2, satisfaction_delta: 4 },
  ],
  is_expired: false,
  renew_locked: false,
  outlook: { goal_evaluations: [{ status: "on_track", actual: 1, target: 3 }, { status: "watch" }, { status: "behind", actual: 0, target: 1 }] },
  request_status: null,
  request_options: [],
};

const plan1yr = {
  board: {
    satisfaction: 30,
    focus: "youth_development",
    current_goals: [{ type: "top_n_finish", target: 10, label: "Top 10 GC", importance: "required" }],
  },
  plan_duration: 1,
  seasons_remaining: 0,
  seasons_completed: 0,
  plan_progress_pct: 0,
  cumulative_stats: { stage_wins: 0, gc_wins: 0 },
  snapshots: [],
  is_expired: false,
  renew_locked: false,
  outlook: { goal_evaluations: [{ status: "behind", actual: 14, target: 10 }] },
  request_status: null,
  request_options: [],
};

const NON_BASELINE_BOARD = {
  is_baseline_phase: false,
  setup_next_plan_type: null,
  plans: { "5yr": plan5yr, "3yr": null, "1yr": plan1yr },
  team: { id: "team-1", name: "Test Team", balance: 900000 },
  riders: [],
  standing: { division_rank: 3, division_manager_count: 18 },
  identity_profile: {
    primary_specialization_label: "Climbers",
    competitive_tier_label: "Contender",
    summary: "A climbing-focused outfit.",
    squad_limits: { max: 30 },
    star_profile: { label: "One star", star_rider_count: 1 },
  },
  auto_accept: null,
  active_loans_count: 0,
  team_members: [],
  active_consequences: [],
  bonus_offer: null,
  team_dna: { key: "climb_dna", emoji: "🧬", label: "Mountain Soul", short_description: "Built for the climbs.", long_description: "Your club leans into mountainous terrain.",
    // #102 · DNA goal_weighting → "Hvad vægter dette board?"-panel (>1.0 = boostet).
    goal_weighting: { u25_development_delta: 1.4, min_national_riders: 1.2, signature_rider: 0.8 } },
  dna_suggestions: [],
};

test("board plans render as tabs; standing label switches per tab (#955)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/board/status", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NON_BASELINE_BOARD) }));

  await login(page);
  await page.goto("/board");

  // Fane-bar med præcis 3 faner (5/3/1-år).
  const tablist = page.getByRole("tablist", { name: "Planhorisonter" });
  await expect(tablist).toBeVisible();
  await expect(tablist.getByRole("tab")).toHaveCount(3);

  // #818 · forhandlingsrækkefølgen forklares.
  await expect(page.getByText("Planer forhandles længst først: 5 → 3 → 1 år.")).toBeVisible();

  // Default = 5-årsplan: kvalitativ standing-label (satisfaction 75 → "Stærk").
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("5-årsplan").first()).toBeVisible();
  await expect(panel.getByText("Status", { exact: true })).toBeVisible();
  await expect(panel.getByText("Stærk", { exact: true })).toBeVisible();

  // Skift til 1-årsplan → standing-label skifter (satisfaction 30 → "Under niveau").
  const oneYearTab = page.getByRole("tab", { name: "Vis 1-årsplan" });
  await oneYearTab.click();
  await expect(oneYearTab).toHaveAttribute("aria-selected", "true");
  await expect(panel.getByText("1-årsplan").first()).toBeVisible();
  await expect(panel.getByText("Under niveau", { exact: true })).toBeVisible();
  await expect(panel.getByText("Stærk", { exact: true })).toHaveCount(0);
});

test("'Hvad vægter dette board?'-panel viser samlet tilfredshed + top-vægtede måltyper (#102/#165)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/board/status", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NON_BASELINE_BOARD) }));

  await login(page);
  await page.goto("/board");

  const drivers = page.getByTestId("board-drivers");
  await expect(drivers).toBeVisible();

  // #165 · samlet tilfredsheds-bar (gnsn. af 5yr=75 + 1yr=30 = 53%).
  await expect(drivers.getByText("Hvad vægter dette board?")).toBeVisible();
  await expect(drivers.getByText("Samlet tilfredshed")).toBeVisible();

  // #102 · top-vægtede måltyper (>1.0): u25 (1.4) + national kerne (1.2), IKKE signature (0.8).
  await expect(drivers.getByText("U25-udvikling")).toBeVisible();
  await expect(drivers.getByText("National kerne")).toBeVisible();
  await expect(drivers.getByText("Rytter med højt omdømme")).toHaveCount(0);
});

test("signature_rider-mål vises som 'højt omdømme', ikke 'popularity'/'stjerne-rytter' (#815)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/board/status", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NON_BASELINE_BOARD) }));

  await login(page);
  await page.goto("/board");

  // 5-årsplan er default → signature_rider-målet er i listen, omdøbt på trods af gammel DB-label.
  const panel = page.getByRole("tabpanel");
  await expect(panel.getByText("Mindst 1 rytter med højt omdømme")).toBeVisible();
  await expect(panel.getByText(/popularity/i)).toHaveCount(0);
  await expect(panel.getByText(/stjerne-rytter/i)).toHaveCount(0);
});
