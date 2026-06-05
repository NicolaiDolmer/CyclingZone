// #1073 forward-guard: board-modalerne skal være tilgængelige for tastatur/skærmlæser.
// core-smoke's board-fixture er baseline-fase (interaktivt board-UI rendres ikke), så
// denne spec mocker en non-baseline board-status for at åbne en rigtig dialog og
// verificere role/aria-modal/aria-labelledby + mærket luk-knap + Escape-luk + focus-restore.
import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

const NON_BASELINE_BOARD = {
  is_baseline_phase: false,
  setup_next_plan_type: null,
  plans: { "5yr": null, "3yr": null, "1yr": null },
  team: { id: "team-1", name: "Test Team", balance: 900000 },
  riders: [],
  standing: null,
  identity_profile: {
    primary_specialization_label: "Climbers",
    secondary_specialization_label: "Time trial",
    competitive_tier_label: "Contender",
    summary: "A climbing-focused outfit.",
    u25_share_pct: 35,
    rider_count: 18,
    squad_limits: { max: 30 },
    squad_status_label: "Healthy",
    national_core: { established: true, code: "DK", count: 6, share_pct: 33 },
    star_profile: { label: "One star", star_rider_count: 1 },
  },
  auto_accept: null,
  active_loans_count: 0,
  team_members: [
    {
      archetype_key: "chairman_x", emoji: "🎩", is_chairman: true, selection_kind: "identity",
      label: "Chairman Test", short_description: "Demands results.", long_description: "A long character description for the chairman.",
    },
  ],
  active_consequences: [],
  bonus_offer: null,
  team_dna: { key: "climb_dna", emoji: "🧬", label: "Mountain Soul", short_description: "Built for the climbs.", long_description: "Your club leans into mountainous terrain." },
  dna_suggestions: [],
};

test("board member dialog is keyboard/screen-reader accessible (#1073)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await page.route("**/api/board/status", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(NON_BASELINE_BOARD) }));

  await login(page);
  await page.goto("/board");

  const trigger = page.getByRole("button", { name: /Chairman Test/ }).first();
  await expect(trigger).toBeVisible();
  // Drive as a keyboard user (WebKit doesn't focus <button> on tap), so focus-restore
  // is exercised the way it matters for a11y.
  await trigger.focus();
  await expect(trigger).toBeFocused();
  await page.keyboard.press("Enter");

  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await expect(dialog).toHaveAttribute("aria-modal", "true");
  await expect(dialog).toHaveAttribute("aria-labelledby", "board-member-dialog-title");
  // Title element referenced by aria-labelledby exists with that id.
  await expect(dialog.locator("#board-member-dialog-title")).toBeVisible();
  // Close button carries a screen-reader label (DA locale in fixtures).
  await expect(dialog.getByRole("button", { name: "Luk dialog" })).toBeVisible();

  // Escape closes the dialog and restores focus to the trigger.
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(trigger).toBeFocused();
});
