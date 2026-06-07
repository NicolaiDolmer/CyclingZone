// #864 forward-guard: "Forhandl ned"-knappen i bestyrelsens forhandlings-wizard
// var altid aktiveret, men handleren returnerede tavst hvis målet ikke havde en
// forhandlings-option (negotiationOptions[goalIdx] mangler) → dead-click. Clarity
// viste brugere der spam-klikkede "Forhandl ned" uden respons. Denne spec mocker
// en udløbet plan + et forslag hvor mål 0 KAN forhandles og mål 1 IKKE kan, og
// verificerer at knappen er aktiveret for mål 0 og tydeligt deaktiveret ("Kan ikke
// forhandles") for mål 1 — altså at hvert klik-mål altid giver feedback.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

const EXPIRED_BOARD = {
  is_baseline_phase: false,
  setup_next_plan_type: null,
  plans: {
    "5yr": {
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
    },
    "3yr": null,
    "1yr": null,
  },
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
  team_dna: { key: "climb_dna", emoji: "🧬", label: "Mountain Soul", short_description: "x", long_description: "y" },
  dna_suggestions: [],
};

// Mål 0 har en forhandlings-option; mål 1 har INGEN (null) → her var dead-clicket.
const PROPOSAL = {
  goals: [
    { type: "top_n_finish", target: 5, label: "Top 5 i divisionen", importance: "optional", satisfaction_penalty: 10 },
    { type: "monument_podium", target: 1, label: "Monument-podie", importance: "optional", satisfaction_penalty: 8 },
  ],
  negotiation_options: [
    { type: "top_n_finish", target: 7, label: "Top 7 i divisionen", negotiated: true, satisfaction_penalty: 5 },
    null,
  ],
};

test("negotiate-down button is disabled (not a silent no-op) when a goal can't be negotiated (#864)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/board/status", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EXPIRED_BOARD) }));
  await page.route("**/api/board/proposal", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROPOSAL) }));

  await login(page);
  await page.goto("/board");

  // Udløbet plan → "Forhandl ny plan →" åbner wizard'en (step 1).
  await page.getByRole("button", { name: "Forhandl ny plan →" }).click();
  await expect(page.getByRole("heading", { name: "Bestyrelsens forslag" })).toBeVisible();

  // Start forhandling → step 2, mål 0.
  await page.getByRole("button", { name: "Start forhandling →" }).click();
  await expect(page.getByRole("heading", { name: "Forhandling" })).toBeVisible();

  // Mål 0 KAN forhandles → knappen er aktiveret og viser "Forhandl ned".
  const negotiateBtn = page.getByRole("button", { name: /Forhandl ned/ });
  await expect(negotiateBtn).toBeEnabled();

  // Accepter mål 0 → frem til mål 1.
  await page.getByRole("button", { name: "Accepter →" }).click();

  // Mål 1 kan IKKE forhandles → knappen er deaktiveret og mærket tydeligt,
  // i stedet for at se klikbar ud og gøre ingenting (dead-click).
  const cannotBtn = page.getByRole("button", { name: "Kan ikke forhandles" });
  await expect(cannotBtn).toBeVisible();
  await expect(cannotBtn).toBeDisabled();
});
