// #5632/#5633 · Bestyrelseslokalet (beta): tre spillerrapporterede fund i
// samme lokale, alle verificeret på den RIGTIGE route (/board, bag et mocket
// GET /api/board/room), ikke kun dev-previewen (/ui/boardroom).
//
//   #5618 (backend, dækket af backend/lib/boardRoom.test.js + boardMandate.
//   test.js — et forhandlet mål der er nyere end mandatet overtager targetet)
//   er IKKE denne spec's ansvar: den er backend-only og verificeres uden
//   browser. Denne spec dækker kun det spillerne så på skærmen:
//
//   1. (#5632) Afstand til et bonustilbud + bestyrelsens sponsoreffekt var
//      usynlige i det nye Boardroom (fandtes i det gamle rum). Begge linjer
//      skal nu stå i Mandat-fanen, og sponsoreffektens fortegn må aldrig
//      dubleres ("++10%" — samme fund det gamle rum aldrig rettede).
//   2. (#5633 punkt 4) Kun ét mål kunne foldes ud ad gangen. "Fold alle ud"/
//      "Fold alle sammen" skal nu kunne åbne/lukke ALLE mål samtidig.
//   3. (#5633 punkt 1) Medlems-gitteret havde ingen synlig instruktion —
//      kun en hover-only title-tooltip, usynlig på mobil/touch. En kort
//      instruktionslinje skal nu stå over gitteret.
//
// Samme mock-mønster som #5472 (board-desktop-layout.spec.ts): en payload i
// PRÆCIS den form GET /api/board/room sender, bygget oven på den delte
// fixture (som nu bærer bonusOfferProgress/passiveModifier, se
// src/pages/boardroom/__fixtures__/boardRoom.json).
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";

const boardRoomFixture = JSON.parse(
  readFileSync(new URL("../../src/pages/boardroom/__fixtures__/boardRoom.json", import.meta.url), "utf8"),
);

const TABS = ["overview", "mandate", "vision", "board"] as const;
type TabName = (typeof TABS)[number];

// Fire mål MED kvittering (receipt), så "Fold alle ud" har noget reelt at
// folde — under ét mål ville kontrollen slet ikke vise sig (samme regel som
// MandateCard.jsx's expandableGoalIds.length > 1).
function payloadWithFourGoals() {
  const owner = (archetypeKey: string, name: string, initials: string) => ({ archetypeKey, name, initials });
  const chair = owner("traditionalisten", "Ellen Kjær", "EK");
  const goal = (type: string, target: number, achieved: string, status: string) => ({
    id: `${type}:${target}`,
    type,
    target,
    label: null,
    cumulative: false,
    race_scope: null,
    nationality_code: null,
    labelKey: `goalType.${type}`,
    labelParams: { target, nationalityCode: null, raceScope: null, cumulative: false },
    achievedDisplay: achieved,
    targetDisplay: String(target),
    unitKey: null,
    status,
    awaitingData: false,
    isStretch: false,
    isBonus: false,
    owner: chair,
    receipt: {
      countedKey: `goalReceipt.counted.${type}`,
      countedParams: { achieved, target: String(target) },
      lastMovementKey: null,
      lastMovementParams: {},
      lastMovementAt: null,
      weightedByName: chair.name,
      weightedByLineKey: `archetypes.${chair.archetypeKey}.label`,
    },
  });

  return {
    ...boardRoomFixture,
    mandate: {
      seasonNumber: 3,
      signedAt: "2026-08-28",
      goals: [
        goal("stage_wins", 3, "2", "on_track"),
        goal("min_riders", 20, "18", "on_track"),
        goal("no_outstanding_debt", 0, "1074082", "achieved"),
        goal("top_n_finish", 5, "7", "behind"),
      ],
    },
    // #5632 · afstand til bonustilbud (under tærsklen — satisfaction 71 < 75,
    // 0/4 mål opnået — reel afstand, ikke bare eligible:false) + sponsor-
    // effektens fortegn (KUN ét "+", ikke "++10%").
    bonusOfferProgress: {
      eligible: false,
      satisfaction_ok: false,
      satisfaction_gap: 5,
      goals_met: 1,
      goals_total: 4,
      goals_needed: 3,
      goals_gap: 2,
      satisfaction_threshold: 75,
      goals_threshold_pct: 75,
    },
    passiveModifier: { satisfaction: 71, modifier: 1.1, pct: 10, band: "boost" },
    board: {
      ...boardRoomFixture.board,
      // Kort navn (Ellen Kjær) + ét langt/flerords navn — dækker begge
      // grid-cases uden at ændre fixturens antal medlemmer.
      members: (boardRoomFixture.board?.members || []).map((m: Record<string, unknown>, i: number) =>
        (i === 3 ? { ...m, name: "Kristian Møller Sørensen" } : m)),
    },
  };
}

async function installBoardroomMocks(page: Page, payload: unknown) {
  await page.route("**/api/board/room", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(payload) });
  });
  await page.route("**/api/board/meeting", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ available: false }) });
  });
  await page.route("**/api/board/dna-suggestions", (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    return route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ already_chosen: true, can_rechoose: true, suggestions: [] }),
    });
  });
}

async function openBoardroom(page: Page) {
  await page.goto("/board");
  await expect(page.getByTestId("boardroom-page")).toBeVisible();
}

async function openTab(page: Page, tab: TabName) {
  const root = page.getByTestId("boardroom-page");
  await root.getByRole("tab").nth(TABS.indexOf(tab)).click();
  await expect(page).toHaveURL(new RegExp(`[?&]tab=${tab}`));
  await expect(root.getByRole("tab").nth(TABS.indexOf(tab))).toHaveAttribute("aria-selected", "true");
}

test.describe("#5632/#5633 Bestyrelseslokalet: transparens + flere-mål-fold + medlems-hint", () => {
  test.beforeEach(async ({ page }) => {
    await stabilizePage(page);
    await installNetworkMocks(page);
    await installBoardroomMocks(page, payloadWithFourGoals());
    await login(page);
  });

  test("#5632 afstand til bonustilbud + sponsoreffekt vises i Mandat-fanen, ét fortegn (ikke '++10%')", async ({ page }) => {
    await openBoardroom(page);
    await openTab(page, "mandate");

    const card = page.getByTestId("boardroom-page");
    await expect(card.getByText("sponsorindtægt +10%")).toBeVisible();
    // #5632 · det gamle rums fund (dobbelt fortegn) må ikke genopstå her.
    await expect(card.getByText("++10%")).toHaveCount(0);
    await expect(card.getByText(/Kræver tilfredshed over 75%/)).toBeVisible();
  });

  test("#5633 punkt 4: 'Fold alle ud' åbner ALLE fire mål samtidig, 'Fold alle sammen' lukker dem igen", async ({ page }) => {
    await openBoardroom(page);
    await openTab(page, "mandate");

    const card = page.getByTestId("boardroom-page");
    const expandAll = card.getByRole("button", { name: "Fold alle ud" });
    await expect(expandAll).toBeVisible();

    // Kun 1 mål har en receipt-boks synlig FØR "Fold alle ud" (ingen er
    // foldet ud endnu) — "Tælles:"-linjen findes kun inde i en åben kvittering.
    await expect(card.getByText("Tælles:")).toHaveCount(0);

    await expandAll.click();
    // Alle fire mål har en receipt (payloadWithFourGoals) → 4 åbne kvitteringer.
    await expect(card.getByText("Tælles:")).toHaveCount(4);

    const collapseAll = card.getByRole("button", { name: "Fold alle sammen" });
    await expect(collapseAll).toBeVisible();
    await collapseAll.click();
    await expect(card.getByText("Tælles:")).toHaveCount(0);
  });

  test("#5633 punkt 1: synlig instruktion over medlems-gitteret i Bestyrelse-fanen (ikke kun en hover-tooltip)", async ({ page }) => {
    await openBoardroom(page);
    await openTab(page, "board");

    const card = page.getByTestId("boardroom-page");
    await expect(card.getByText("Tryk på et medlem for at se, hvad de mener, og hvilke mål de ejer.")).toBeVisible();
  });
});
