// #5633 fund 6 · Automatiske layout-guards på Boardroom (390 + 1440), så tre
// spillerrapporterede fund fra samme issue ikke kommer igen, nu hvor fund 1-5
// er leveret (#5679):
//
//   "trange navne"           MemberTile-navne i medlems-gitteret pressede
//                            naboerne og fik forskellig tile-højde alt efter
//                            ords-antal (rettet med line-clamp-2 + min-h,
//                            BoardCard.jsx).
//   "ujaevne maaltitler"     Mandat-fanens måltitler brød linjer ujaevnt
//                            (rettet med [text-wrap:balance], MandateCard.jsx).
//   "skjult medlemsfunktion" Medlems-gitteret havde ingen synlig instruktion,
//                            kun en hover-only title-tooltip (rettet med den
//                            synlige memberGridHint-linje, #5633 punkt 1,
//                            allerede dækket funktionelt af 5632-specen).
//
// Denne spec dækker det #5632-specen IKKE gør: GEOMETRI under worst-case
// data (lange navne, lange måltitler), ikke bare at teksten er til stede.
// Mock-mønsteret er lånt fra 5632 (samme payload-form som GET /api/board/room
// rent faktisk sender), og selve overflow-målingen er 5383-vagtens egen
// (`scanPageForTextDefects`/`text-overflow-scan.js`) — samme måler som
// board-desktop-layout.spec.ts bruger på Boardroom, her kørt på begge de to
// bredder ejeren efterspurgte i stedet for hele 5383-matricens fem.
//
// Ingen produktkode røres i denne PR: finder specen en reel regression,
// rapporteres den i PR-body i stedet for at rette den her.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage } from "./fixtures.js";
import { scanPageForTextDefects, formatFinding } from "./lib/text-overflow-scan.js";
import { isKnownContrastDebt } from "./lib/text-overflow-allowlist.js";

const boardRoomFixture = JSON.parse(
  readFileSync(new URL("../../src/pages/boardroom/__fixtures__/boardRoom.json", import.meta.url), "utf8"),
);

const TABS = ["overview", "mandate", "vision", "board"] as const;
type TabName = (typeof TABS)[number];

const WIDTHS = [
  { name: "390", size: { width: 390, height: 844 } },
  { name: "1440", size: { width: 1440, height: 900 } },
];

// Worst-case navne: RIGTIGE yderpunkter fra den faktiske navnepulje
// (backend/lib/fictionalRiderNames.js — bestyrelsesmedlemmer er altid
// "{first_name} {last_name}" fra ÉT DNA-cluster, boardMandateNames.js) i
// stedet for opfundne 4-ords-navne ingen generator nogensinde ville sende.
// "Bo Li" (5 tegn) er den ABSOLUT korteste kombination på tværs af alle
// clusters; "Bonaventure Ghebreigzabhier" (27 tegn, east African-clusteret)
// den ABSOLUT længste — begge verificeret ved at gennemløbe hvert clusters
// first[] × last[] 25/9. Netop den blanding (kort vs. langt navn i samme
// række) gav før #5633 MemberTile'en forskellig højde (BoardCard.jsx's
// line-clamp-2 + min-h-[26px] skal holde dem ens uanset dette).
function worstCaseMembers(members: Record<string, unknown>[]) {
  const NAMES = [
    "Bo Li",
    "Bonaventure Ghebreigzabhier",
    "Žygimantas Stankevičius",
    "Przemysław Lewandowski",
    "Aleksandar Radovanović",
  ];
  return members.map((member, i) => ({ ...member, name: NAMES[i % NAMES.length] }));
}

// Worst-case måltitler: fire haandskrevne saetninger af meget forskellig
// laengde. `type` og `labelKey` er begge null, saa resolveGoalTitle
// (boardroomFormat.js) falder tilbage til `label` ORDRET i stedet for en kort
// goalType-korttitel — netop den lange, virkelige saetning
// [text-wrap:balance] (MandateCard.jsx) skal fordele paa flere linjer uden at
// noget loeber uden for kortet. Alle fire har en receipt, saa
// expandableGoalIds.length (MandateCard.jsx) bliver 4 > 1 og
// "Fold alle ud"/"Fold alle sammen" vises.
function worstCaseGoals() {
  const owner = (archetypeKey: string, name: string, initials: string) => ({ archetypeKey, name, initials });
  const owners = [
    owner("traditionalisten", "Ellen Kjær", "EK"),
    owner("resultatjaegeren", "Jørgen Brandt", "JB"),
    owner("sponsoraten", "Søren Lindqvist", "SL"),
    owner("ungdomsidealisten", "Astrid Holm", "AH"),
  ];
  const LABELS = [
    "Vind mindst tre etaper i sæsonens grand tours og befæst holdets ry som et angrebslystent sprinterhold hele vejen igennem sæsonen",
    "Hold nul",
    "Giv mindst to akademiryttere en førsteholdsdebut inden sæsonens sidste løbsdag, med saerligt fokus på U23-klassen",
    "Top 40 i klubranglisten ved sæsonens afslutning",
  ];
  const STATUSES = ["on_track", "achieved", "at_risk", "behind"];
  return LABELS.map((label, i) => ({
    id: `goal-${i}`,
    type: null,
    target: 10 + i,
    label,
    labelKey: null,
    labelParams: null,
    cumulative: false,
    race_scope: null,
    nationality_code: null,
    achievedDisplay: String(i + 1),
    targetDisplay: String(10 + i),
    unitKey: null,
    status: STATUSES[i],
    awaitingData: false,
    isStretch: false,
    isBonus: false,
    owner: owners[i],
    receipt: {
      // #5633 · countedKey/weightedByLineKey er begge EKSISTERENDE noegler
      // (goalReceipt.counted.unknown / archetypes.<key>.label) — de er
      // uafhaengige af goal.type/labelKey ovenfor, saa maalet kan have en raa
      // label OG en oversat kvittering paa samme tid.
      countedKey: "goalReceipt.counted.unknown",
      countedParams: {},
      lastMovementKey: null,
      lastMovementParams: {},
      lastMovementAt: null,
      weightedByName: owners[i].name,
      weightedByLineKey: `archetypes.${owners[i].archetypeKey}.label`,
    },
  }));
}

function worstCasePayload() {
  return {
    ...boardRoomFixture,
    mandate: {
      seasonNumber: 3,
      signedAt: "2026-08-28",
      goals: worstCaseGoals(),
    },
    board: {
      ...boardRoomFixture.board,
      members: worstCaseMembers(boardRoomFixture.board?.members || []),
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

async function openBoardroom(page: Page, size: { width: number; height: number }) {
  await page.setViewportSize(size);
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installBoardroomMocks(page, worstCasePayload());
  await login(page);
  await page.goto("/board");
  await expect(page.getByTestId("boardroom-page")).toBeVisible();
}

async function openTab(page: Page, tab: TabName) {
  const root = page.getByTestId("boardroom-page");
  await root.getByRole("tab").nth(TABS.indexOf(tab)).click();
  await expect(page).toHaveURL(new RegExp(`[?&]tab=${tab}`));
  await expect(root.getByRole("tab").nth(TABS.indexOf(tab))).toHaveAttribute("aria-selected", "true");
}

// #5383-moensteret: kendt kontrast-gaeld (--text-3-paletten, se
// text-overflow-allowlist.js) doemmes ikke her — den er sit eget, allerede
// dokumenterede spor (Refs #5383) og ikke denne specs ansvar. Alt andet
// (clipped/spilling-text/outside-container/unreadable-daekket/raw-i18n-key)
// er et fund.
async function scanForDefects(page: Page) {
  return (await scanPageForTextDefects(page, { root: '[data-testid="boardroom-page"]' })).filter(
    (finding) => !isKnownContrastDebt(finding),
  );
}

for (const width of WIDTHS) {
  test.describe(`#5633 Boardroom layout-guards ved ${width.name}px`, () => {
    test.beforeEach(async ({ page }) => {
      await openBoardroom(page, width.size);
    });

    test(`medlems-gitter: samme tile-højde uanset navnelængde, ingen tekst uden for boksen, synlig hint (${width.name})`, async ({ page }) => {
      await openTab(page, "board");
      const card = page.getByTestId("boardroom-page");

      // (b) instruktionslinjen over gitteret er synlig — #5633 punkt 1
      // ("skjult medlemsfunktion"), ikke kun en hover-only title-tooltip.
      await expect(card.getByText("Tryk på et medlem for at se, hvad de mener, og hvilke mål de ejer.")).toBeVisible();

      // (a) alle fem tiles har SAMME navne-højde, uanset 1-ords vs. 4-ords
      // navn ("trange navne" — foer #5633 pressede et langt navn naboerne).
      const tiles = card.locator('button[aria-pressed]');
      await expect(tiles).toHaveCount(5);
      const nameBoxes = await Promise.all(
        Array.from({ length: 5 }, (_, i) => tiles.nth(i).locator("p").first().boundingBox()),
      );
      for (const box of nameBoxes) expect(box, "MemberTile-navnet har ingen boundingBox").not.toBeNull();
      // Tolerance 2 px: text-2xs/leading-tight giver 2 klippede linjer en
      // naturlig højde på 27.5 px (11 px × 1.25 × 2), mens min-h-[26px]'s
      // GULV er 1.5 px lavere — en kendt, harmløs sub-linje-afrunding, ikke
      // den "trange navne"-fejl (der gav en HEL linjes forskel, ~13-14 px,
      // mellem et 1-ords og et 3-ords navn i samme række). Et udslag over
      // denne tolerance er derfor et reelt fund, ikke støj.
      const heights = nameBoxes.map((box) => box!.height);
      for (let i = 1; i < heights.length; i += 1) {
        expect(
          Math.abs(heights[i] - heights[0]),
          `tile ${i} (${heights[i]} px) har en anden navne-højde end tile 0 (${heights[0]} px)`,
        ).toBeLessThanOrEqual(2);
      }

      // (a) ingen tekst noget sted på boardroom-page løber uden for sin boks
      // (overflow-vagtens egen måling, #5383-mønster).
      const defects = (await scanForDefects(page)).map((finding) => formatFinding({ ...finding, where: `board @ ${width.name}` }));
      expect(defects, `board-fanen (${width.name}): tekst-fund`).toEqual([]);
    });

    test(`mandat: 'Fold alle ud'/'Fold alle sammen' åbner/lukker ALLE fire mål, ingen måltitel uden for sin boks (${width.name})`, async ({ page }) => {
      await openTab(page, "mandate");
      const card = page.getByTestId("boardroom-page");

      const expandAll = card.getByRole("button", { name: "Fold alle ud" });
      await expect(expandAll).toBeVisible();
      // Ingen kvittering er åben endnu — "Tælles:" findes kun inde i en åben
      // kvittering (samme metode som 5632-specen).
      await expect(card.getByText("Tælles:")).toHaveCount(0);

      await expandAll.click();
      await expect(card.getByText("Tælles:")).toHaveCount(4);

      // (d) måltitlerne målt MED alle fire kvitteringer åbne — den bredeste
      // tilstand, samme princip som board-desktop-layout.spec.ts's openTab.
      const defects = (await scanForDefects(page)).map((finding) => formatFinding({ ...finding, where: `mandate @ ${width.name}` }));
      expect(defects, `mandat-fanen (${width.name}): tekst-fund`).toEqual([]);

      const collapseAll = card.getByRole("button", { name: "Fold alle sammen" });
      await expect(collapseAll).toBeVisible();
      await collapseAll.click();
      await expect(card.getByText("Tælles:")).toHaveCount(0);
    });

    test(`ingen vandret scroll, hverken i medlems-gitteret eller med alle mål åbne (${width.name})`, async ({ page }) => {
      const overflowOf = () =>
        page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

      await openTab(page, "board");
      expect(await overflowOf(), `${width.name}: bestyrelse-fanen (lange navne) scroller vandret`).toBeLessThanOrEqual(0);

      await openTab(page, "mandate");
      const expandAll = page.getByTestId("boardroom-page").getByRole("button", { name: "Fold alle ud" });
      await expandAll.click();
      await expect(page.getByTestId("boardroom-page").getByText("Tælles:")).toHaveCount(4);
      expect(
        await overflowOf(),
        `${width.name}: mandat-fanen (lange måltitler, alle kvitteringer åbne) scroller vandret`,
      ).toBeLessThanOrEqual(0);
    });
  });
}
