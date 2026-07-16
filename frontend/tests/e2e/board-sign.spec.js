// #2463 · Bestyrelses-wizarden forhandler i 3 trin (strategi → forhandling → signatur)
// og POST'er til /api/board/sign (BoardPage.jsx signContract). Ingen eksisterende spec
// gennemførte selve signeringen — board-wizard-back.spec.js (#1240) går til
// signatur-trinnet men stopper der. Denne spec dækker to ting:
//
//   1. Det lykkedes flow: forhandl ét mål ned, accepter resten, signér, og verificér
//      at sign-POST'ens body er korrekt + at wizarden lukker + siden refetcher og
//      viser den fornyede (ikke-udløbede) plan.
//   2. Escape-hatch-fælden i setup-wizarden: fejler /api/board/proposal vedvarende
//      under førstegangs-setup, viser wizarden en fejlbesked med INGEN udgang (før
//      #2463-fixet). Verificerer at luk-knappen nu er synlig + lukker wizarden, og
//      at wizarden ikke genåbner sig selv (auto-open-guard, se BoardPage.jsx).
import { test, expect } from "@playwright/test";
import { installNetworkMocks, installBoardStatusMock, login, makeBoardStatus, stabilizePage } from "./fixtures.js";

// Samme fixture-form som board-wizard-back.spec.js (#1240): udløbet 5yr-plan →
// "Forhandl ny plan →"-flowet. Duplikeret bevidst — specs skal kunne ændre deres
// egen fixture uden at påvirke #1240-regressionstesten.
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

// 3 mål; mål 0 har en negotiation_option (forhandles ned), mål 1+2 ingen (accepteres som er).
const PROPOSAL = {
  goals: [
    { type: "top_n_finish", target: 5, label: "Top 5 i divisionen", importance: "optional", satisfaction_penalty: 10 },
    { type: "monument_podium", target: 1, label: "Monument-podie", importance: "optional", satisfaction_penalty: 8 },
    { type: "stage_wins", target: 3, label: "3 etapesejre", importance: "required" },
  ],
  negotiation_options: [
    { type: "top_n_finish", target: 7, label: "Top 7 i divisionen", negotiated: true, satisfaction_penalty: 5 },
    null,
    null,
  ],
};

// Sign-request'ens forventede `goals`: mål 0 erstattet af negotiation_options[0]
// (negotiateCurrentGoal-mekanikken i BoardPage.jsx), mål 1+2 uændrede fra PROPOSAL.
const SIGNED_GOALS = [
  PROPOSAL.negotiation_options[0],
  PROPOSAL.goals[1],
  PROPOSAL.goals[2],
];

// Refetch-tilstanden efter sign: samme 5yr-plan, ikke længere udløbet, med de
// forhandlede mål som current_goals + negotiation_status: "completed".
function makeSignedBoard() {
  return {
    ...EXPIRED_BOARD,
    plans: {
      ...EXPIRED_BOARD.plans,
      "5yr": {
        ...EXPIRED_BOARD.plans["5yr"],
        board: { satisfaction: 65, focus: "balanced", current_goals: SIGNED_GOALS, negotiation_status: "completed" },
        seasons_remaining: 5,
        seasons_completed: 0,
        plan_progress_pct: 0,
        is_expired: false,
      },
    },
  };
}

test("wizard negotiates a goal, signs, and POSTs the correct payload (#2463)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Funktions-baseret /api/board/status-mock: udløbet FØR sign, fornyet EFTER —
  // så closeWizard() + loadAll()-refetchen efter sign viser den nye tilstand.
  let signed = false;
  await installBoardStatusMock(page, () => (signed ? makeSignedBoard() : EXPIRED_BOARD));

  await page.route("**/api/board/proposal", route =>
    route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(PROPOSAL) }));

  let signRequestBody = null;
  await page.route("**/api/board/sign", route => {
    signRequestBody = JSON.parse(route.request().postData() || "{}");
    signed = true;
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ok: true, board: makeSignedBoard().plans["5yr"].board, goals: SIGNED_GOALS }),
    });
  });

  await login(page);
  await page.goto("/board");

  // Udløbet plan → wizard trin 1.
  await page.getByRole("button", { name: "Forhandl ny plan →" }).click();
  await expect(page.getByRole("heading", { name: "Bestyrelsens forslag" })).toBeVisible();
  await page.getByRole("button", { name: "Start forhandling →" }).click();

  // Mål 1/3: forhandl ned (negotiations-arrayet må ikke være tomt) → accepter kompromiset.
  await expect(page.getByText("Mål 1/3")).toBeVisible();
  await page.getByRole("button", { name: "Forhandl ned ↓" }).click();
  await expect(page.getByText("Bestyrelsen har accepteret kompromis")).toBeVisible();
  await page.getByRole("button", { name: "Accepter forhandlet mål →" }).click();

  // Mål 2/3 + 3/3: almindelig accept, ingen forhandling.
  await expect(page.getByText("Mål 2/3")).toBeVisible();
  await page.getByRole("button", { name: "Accepter →" }).click();
  await expect(page.getByText("Mål 3/3")).toBeVisible();
  await page.getByRole("button", { name: "Accepter →" }).click();

  // Trin 3: underskrift — de forhandlede/accepterede mål er alle synlige.
  await expect(page.getByRole("heading", { name: "Underskrift" })).toBeVisible();
  await expect(page.getByText("Top 7 i divisionen")).toBeVisible();
  await expect(page.getByText("Mindst 3 etapesejre")).toBeVisible();

  await page.getByRole("button", { name: /Underskriv kontrakt/ }).click();

  // Sign-POST'ens body indeholder korrekt focus/plan_type/negotiations/goals.
  await expect.poll(() => signRequestBody).not.toBeNull();
  expect(signRequestBody).toEqual({
    focus: "balanced",
    plan_type: "5yr",
    negotiations: [0],
    goals: SIGNED_GOALS,
  });

  // Wizarden lukker efter sign …
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // … og siden viser den fornyede (refetchede) plan — ikke længere udløbet,
  // med de forhandlede mål synlige i dashboard-panelet.
  await expect(page.getByRole("button", { name: "Forhandl ny plan →" })).toHaveCount(0);
  await expect(page.getByText("Top 7 i divisionen")).toBeVisible();
  await expect(page.getByText("Mindst 3 etapesejre")).toBeVisible();
});

test("setup wizard: persistent proposal error shows an exit, and it does not auto-reopen (#2463)", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Trigger-betingelserne for shouldAutoOpenSetupWizard (lib/boardWizardNav.js):
  // ikke baseline, setup_next_plan_type sat, mindst én eksisterende plan, DNA valgt.
  // makeBoardStatus() leverer en ikke-udløbet 5yr-plan + team_dna — akkurat det.
  const SETUP_BOARD = makeBoardStatus({ setup_next_plan_type: "3yr" });
  await installBoardStatusMock(page, SETUP_BOARD);

  // Proposal-endpointet fejler VEDVARENDE (ikke bare én gang) — den fælde #2463
  // beskriver: startNegotiation/loadPreview sætter kun previewError, ingen retry-exit.
  await page.route("**/api/board/proposal", route =>
    route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({}) }));

  await login(page);
  await page.goto("/board");

  // Setup-wizarden åbner automatisk (ikke via klik) og fejler med det samme.
  await expect(page.getByRole("dialog")).toBeVisible();
  await expect(page.getByText("Kunne ikke hente bestyrelsens forslag.")).toBeVisible();

  // Før #2463-fixet var wizardClosable false her (wizardIsSetup + teamDna, uden
  // hensyn til previewError) → INGEN "Tilbage til oversigt"-knap, ingen udgang.
  const closeButton = page.getByRole("button", { name: /Tilbage til oversigt/ });
  await expect(closeButton).toBeVisible();
  await closeButton.click();
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Uden ref-guarden i loadAll() ville ENHVER efterfølgende loadAll()-kørsel
  // (realtime-refetch, eller her: en manuel handling der refetcher status) slå
  // shouldAutoOpenSetupWizard op igen og genåbne wizarden — deadlock-fælden
  // ville blot udskydes til næste refetch. Trigger et nyt loadAll() via en
  // ufarlig handling (forny 5yr-planen, som er non-expired i fixturen) og
  // verificér at wizarden IKKE genåbner sig selv.
  // Forny-knappen sidder i det udfoldede detalje-panel.
  await page.getByRole("button", { name: "Vis detaljer" }).click();

  const statusRefetch = page.waitForResponse(r =>
    r.url().includes("/api/board/status") && r.request().method() === "GET");
  await page.getByRole("button", { name: "Forny plan (status quo)" }).click();
  await statusRefetch;

  await expect(page.getByRole("dialog")).toHaveCount(0);
});
