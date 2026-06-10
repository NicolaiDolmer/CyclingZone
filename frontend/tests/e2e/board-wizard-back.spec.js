// #1240 regressionstest: tilbageknap i bestyrelsens forhandlings-wizard.
// Wizard-flowet var lineært (trin 1→2→3) uden tilbagenavigation — gik man for
// hurtigt frem, var eneste udvej at lukke wizard'en og starte forfra (alle valg
// tabt). Denne spec verificerer hele tilbage-kæden UDEN tab af valg:
//   mål 2 → mål 1 (forhandlet-state bevaret) → trin 1 → genoptag på samme mål.
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

test("wizard back button navigates goals/steps without losing choices (#1240)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/board/status", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(EXPIRED_BOARD) }));
  await page.route("**/api/board/proposal", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROPOSAL) }));

  await login(page);
  await page.goto("/board");

  // Udløbet plan → wizard trin 1.
  await page.getByRole("button", { name: "Forhandl ny plan →" }).click();
  await expect(page.getByRole("heading", { name: "Bestyrelsens forslag" })).toBeVisible();

  // Trin 1 har INGEN intern tilbageknap.
  await expect(page.getByRole("button", { name: "← Tilbage", exact: true })).toHaveCount(0);

  // Trin 2, mål 1/2: forhandl mål 0 ned (valget vi ikke må miste).
  await page.getByRole("button", { name: "Start forhandling →" }).click();
  await expect(page.getByText("Mål 1/2")).toBeVisible();
  await page.getByRole("button", { name: "Forhandl ned ↓" }).click();
  await expect(page.getByText("Bestyrelsen har accepteret kompromis")).toBeVisible();

  // Tilbage fra kompromis-viewet → samme mål, nu markeret "Allerede forhandlet".
  await page.getByRole("button", { name: "← Tilbage", exact: true }).click();
  await expect(page.getByText("Mål 1/2")).toBeVisible();
  await expect(page.getByRole("button", { name: "Allerede forhandlet" })).toBeDisabled();

  // Videre til mål 2/2 → tilbage → mål 1/2 igen med forhandlet-state intakt.
  await page.getByRole("button", { name: "Accepter →" }).click();
  await expect(page.getByText("Mål 2/2")).toBeVisible();
  await page.getByRole("button", { name: "← Tilbage", exact: true }).click();
  await expect(page.getByText("Mål 1/2")).toBeVisible();
  await expect(page.getByText("Top 7 i divisionen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Allerede forhandlet" })).toBeDisabled();

  // Tilbage fra første mål → trin 1 (strategi).
  await page.getByRole("button", { name: "← Tilbage", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Bestyrelsens forslag" })).toBeVisible();

  // Genoptag uden strategi-skifte → samme mål, forhandlingen er IKKE nulstillet.
  await page.getByRole("button", { name: "Start forhandling →" }).click();
  await expect(page.getByText("Mål 1/2")).toBeVisible();
  await expect(page.getByText("Top 7 i divisionen")).toBeVisible();
  await expect(page.getByRole("button", { name: "Allerede forhandlet" })).toBeDisabled();

  // Hele vejen til trin 3 → tilbage lander på SIDSTE mål, ikke det første.
  await page.getByRole("button", { name: "Accepter →" }).click();
  await expect(page.getByText("Mål 2/2")).toBeVisible();
  await page.getByRole("button", { name: "Accepter →" }).click();
  await expect(page.getByRole("heading", { name: "Underskrift" })).toBeVisible();
  await page.getByRole("button", { name: "← Tilbage", exact: true }).click();
  await expect(page.getByText("Mål 2/2")).toBeVisible();
});
