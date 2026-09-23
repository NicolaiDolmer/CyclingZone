// #5472 · Bestyrelsessiden (Boardroom, /board) bryder ikke layoutet på desktop.
//
// Beta-feedback 21/9: siden så forkert ud både i et smalt desktop-vindue
// (skærmbillede 967 px) og i fuld skærm (1831 px). To fund:
//   · Fuld skærm: Boardroom-siden havde ingen T1-container (PAGE_TEMPLATES:
//     max-w-4xl, centreret), så kortene strakte sig til Layoutets max-w-6xl.
//     Preview-siden (/ui/boardroom) pakker selv ind i max-w-4xl, så fejlen var
//     usynlig dér.
//   · Smalt vindue: flerkolonne-rækkerne skiftede ved sm (en VIEWPORT-grænse),
//     men fra md står sidebaren, så indholdet er langt smallere end sm antyder.
//     Ved 774 px løb "RESULTATER" ud af sin meter-kolonne, og mål-målerne stod
//     i hver sin højde.
//
// Specen dækker:
//   1. Ingen vandret overflow, intet indhold uden for sidens container og
//      ingen tekst uden for sin boks (#5383-måleren) ved 390 / 774 / 970 /
//      1440 / 1830, på dansk og engelsk, på alle fire faner, med en mål-
//      kvittering og et medlemspanel foldet ud.
//   2. Siden holder T1-bredden (max 896 px) uanset skærmbredde.
//   3. Ingen rå i18n-nøgler på siden, med en payload i samme form som
//      backend/lib/boardRoom.js faktisk sender (nøgle-familierne
//      goalReceipt.counted.*, chairmanBeat.*, goalType.*, archetypes.*). Den
//      delte fixture bruger egne fixture-nøgler og kunne derfor ikke se hullet.
//
// Kun desktop-chromium: specen sætter selv sine bredder, så de to mobil-
// projekter ville måle de samme bredder igen.
import { readFileSync } from "node:fs";
import type { Page } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, evidenceShotPath } from "./fixtures.js";
import { scanPageForTextDefects, formatFinding } from "./lib/text-overflow-scan.js";
import { isKnownContrastDebt } from "./lib/text-overflow-allowlist.js";

const boardRoomFixture = JSON.parse(
  readFileSync(new URL("../../src/pages/boardroom/__fixtures__/boardRoom.json", import.meta.url), "utf8"),
);

// T1 = max-w-4xl = 56rem = 896 px (PAGE_TEMPLATES §T1).
const T1_MAX_WIDTH = 896;

const WIDTHS = [
  { name: "390", size: { width: 390, height: 844 } },
  // Et 967 px-skærmbillede kan være ENHEDS-pixels: med Windows' 125 %-
  // skalering er vinduet ca. 774 CSS-px bredt. Det er lige over md-grænsen,
  // hvor sidebaren (208 px) står, så indholdet har under 520 px: den
  // smalleste desktop-geometri siden kan få.
  { name: "774", size: { width: 774, height: 862 } },
  { name: "970", size: { width: 970, height: 1077 } },
  { name: "1440", size: { width: 1440, height: 900 } },
  { name: "1830", size: { width: 1830, height: 1077 } },
];

const TABS = ["overview", "mandate", "vision", "board"] as const;
type TabName = (typeof TABS)[number];

// Payload i PRÆCIS den form GET /api/board/room sender (boardRoom.js): mål-
// titler via goalType.<type>, kvitteringens "Counted" via
// goalReceipt.counted.<type>, formandscitatets kontekst via chairmanBeat.<beat>
// og alle citater som archetypes.<key>.reactions.<beat>.<idx>. Navnene er
// fiktive bestyrelsesmedlemmer fra fixturen.
function prodShapedPayload() {
  const owner = (archetypeKey: string, name: string, initials: string) => ({ archetypeKey, name, initials });
  const goal = (
    type: string,
    target: number,
    achieved: string,
    status: string,
    o: ReturnType<typeof owner>,
    extra: Record<string, unknown> = {},
  ) => ({
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
    owner: o,
    receipt: {
      countedKey: `goalReceipt.counted.${type}`,
      countedParams: { achieved, target: String(target) },
      lastMovementKey: `archetypes.${o.archetypeKey}.reactions.receipt_positive.0`,
      lastMovementParams: {},
      lastMovementAt: "2026-09-20T12:00:00Z",
      weightedByName: o.name,
      weightedByLineKey: `archetypes.${o.archetypeKey}.label`,
    },
    ...extra,
  });

  const chair = owner("traditionalisten", "Ellen Kjær", "EK");
  const results = owner("resultatjaegeren", "Jørgen Brandt", "JB");
  const economy = owner("sponsoraten", "Søren Lindqvist", "SL");
  const identity = owner("ungdomsidealisten", "Astrid Holm", "AH");
  const ranking = owner("nationalist_purist", "Niels Østergaard", "NO");

  return {
    ...boardRoomFixture,
    mandate: {
      seasonNumber: 3,
      signedAt: "2026-08-28",
      goals: [
        goal("stage_wins", 3, "2", "on_track", results),
        goal("no_outstanding_debt", 0, "0", "on_track", economy),
        goal("u25_development_delta", 4, "1", "at_risk", identity),
        goal("top_n_finish", 40, "46", "behind", chair, { isStretch: true }),
        // DB-labelen er rå dansk (backend buildGoalLabel); titlen skal komme
        // fra nationality_code + locale, ellers lækker dansk ud på engelsk.
        goal("min_national_riders", 3, "4", "on_track", ranking, {
          label: "Min. 3 ryttere fra dk",
          nationality_code: "dk",
        }),
      ],
    },
    vision: {
      startSeason: 3,
      endSeason: 6,
      titleKey: "vision.title.skandinavisk_udvikling",
      milestones: [3, 4, 5, 6].map((season, i) => ({
        id: `m${season}`,
        seasonNumber: season,
        type: "top_n_finish",
        target: 40 - i * 5,
        label: null,
        cumulative: false,
        race_scope: null,
        nationality_code: null,
        labelKey: "goalType.top_n_finish",
        labelParams: { target: 40 - i * 5, nationalityCode: null, raceScope: null, cumulative: false },
        status: i === 0 ? "current" : "upcoming",
        isCurrentSeason: i === 0,
      })),
    },
    board: {
      ...boardRoomFixture.board,
      chairmanQuote: {
        textKey: "archetypes.traditionalisten.reactions.meeting_keep.0",
        textParams: {},
        memberName: chair.name,
        contextKey: "chairmanBeat.meeting_keep",
      },
    },
    minutes: [
      { id: "e1", delta: 2, textKey: "archetypes.resultatjaegeren.reactions.receipt_positive.1", textParams: { raceName: null }, memberName: results.name, occurredAt: "2026-09-20T12:00:00Z" },
      { id: "e2", delta: -1, textKey: "archetypes.sponsoraten.reactions.receipt_negative.0", textParams: { raceName: null }, memberName: economy.name, occurredAt: "2026-09-19T12:00:00Z" },
      { id: "e3", delta: 1, textKey: "archetypes.traditionalisten.reactions.milestone_achieved.0", textParams: { raceName: null }, memberName: chair.name, occurredAt: "2026-09-18T12:00:00Z" },
    ],
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

async function setLanguage(page: Page, lang: "da" | "en") {
  await page.evaluate(async (next) => {
    window.localStorage.setItem("cz_lang", next);
    const i18n = (window as unknown as { __i18n?: { changeLanguage: (l: string) => Promise<unknown> } }).__i18n;
    if (i18n) await i18n.changeLanguage(next);
  }, lang);
  await expect
    .poll(() => page.evaluate(() => (window as unknown as { __i18n?: { language: string } }).__i18n?.language))
    .toBe(lang);
}

// stabilizePage låser cz_lang=da ved HVER navigation, så sproget sættes efter
// den ene goto, og fanerne skiftes derefter i appen (ikke via ny goto).
async function openBoardroom(page: Page, lang: "da" | "en") {
  await page.goto("/board");
  await expect(page.getByTestId("boardroom-page")).toBeVisible();
  await setLanguage(page, lang);
}

// Åbner fanen og folder den detalje ud der gør fanen bredest: mål-kvitteringen
// i Mandat, medlemspanelet i Bestyrelse. En måling af en lukket fane ville
// være grøn uanset hvad (samme princip som #5383-vagten).
async function openTab(page: Page, tab: TabName) {
  const root = page.getByTestId("boardroom-page");
  await root.getByRole("tab").nth(TABS.indexOf(tab)).click();
  await expect(page).toHaveURL(new RegExp(`[?&]tab=${tab}`));
  await expect(root.getByRole("tab").nth(TABS.indexOf(tab))).toHaveAttribute("aria-selected", "true");
  if (tab === "mandate") {
    await root.locator('[role="button"][tabindex="0"]').first().click();
  }
  if (tab === "board") {
    await root.locator("button[aria-pressed]").first().click();
  }
  await page.evaluate(async () => {
    if (document.fonts?.ready) await document.fonts.ready;
  });
}

type LayoutReport = {
  docOverflow: number;
  mainOverflow: number;
  rootWidth: number;
  escaped: string[];
};

async function measureLayout(page: Page): Promise<LayoutReport> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const main = document.querySelector("main");
    const root = document.querySelector('[data-testid="boardroom-page"]');
    if (!main || !root) throw new Error("main eller boardroom-page mangler");
    const rootRect = root.getBoundingClientRect();
    const escaped: string[] = [];
    for (const el of Array.from(root.querySelectorAll<HTMLElement>("*"))) {
      const rect = el.getBoundingClientRect();
      if (rect.width === 0 || rect.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.position === "fixed" || el.closest(".sr-only")) continue;
      // Indhold i en bevidst vandret scroller (fanerækken på mobil) er ikke et brud.
      const scroller = el.parentElement?.closest<HTMLElement>("[role=tablist]");
      if (scroller) continue;
      if (rect.right > rootRect.right + 1 || rect.left < rootRect.left - 1) {
        const text = (el.textContent || "").trim().slice(0, 40);
        escaped.push(`${el.tagName.toLowerCase()}.${String(el.className).slice(0, 60)} "${text}" [${Math.round(rect.left)}-${Math.round(rect.right)} vs ${Math.round(rootRect.left)}-${Math.round(rootRect.right)}]`);
      }
    }
    return {
      docOverflow: doc.scrollWidth - doc.clientWidth,
      mainOverflow: main.scrollWidth - main.clientWidth,
      rootWidth: rootRect.width,
      escaped: escaped.slice(0, 10),
    };
  });
}

test.describe("#5472 Boardroom-layout på desktop", () => {
  test.skip(({ isMobile }) => isMobile, "specen sætter selv sine bredder; kun desktop-chromium");

  for (const width of WIDTHS) {
    for (const lang of ["en", "da"] as const) {
      test(`ingen vandret overflow, ingen tekst ud af boksene og T1-bredde ved ${width.name} px (${lang})`, async ({ page }) => {
        await page.setViewportSize(width.size);
        await stabilizePage(page);
        await installNetworkMocks(page);
        await installBoardroomMocks(page, prodShapedPayload());
        await login(page);
        await openBoardroom(page, lang);

        for (const tab of TABS) {
          await openTab(page, tab);
          const where = `${tab} @ ${width.name} (${lang})`;
          // Billedet tages FØR målingen, så et brud også efterlader bevis.
          if (lang === "en") {
            await page.screenshot({
              path: evidenceShotPath(`pr-screens/5472-board-${tab}-${width.name}.png`),
              fullPage: true,
            });
          }
          const report = await measureLayout(page);
          // Bløde asserts: alle fire faner måles, også når den første fejler.
          expect.soft(report.docOverflow, `${where}: dokumentet scroller vandret`).toBeLessThanOrEqual(0);
          expect.soft(report.mainOverflow, `${where}: <main> scroller vandret`).toBeLessThanOrEqual(0);
          expect.soft(report.rootWidth, `${where}: siden er bredere end T1`).toBeLessThanOrEqual(T1_MAX_WIDTH + 0.5);
          expect.soft(report.escaped, `${where}: elementer uden for sidens container`).toEqual([]);

          // #5383-måleren element for element: klippet tekst, tekst der løber
          // ud over sin boks eller sit kort, og rå nøgler. Kendt palet-
          // kontrastgæld dømmes i #5383-vagten, ikke her.
          const defects = (await scanPageForTextDefects(page, { root: '[data-testid="boardroom-page"]' }))
            .filter((finding) => !isKnownContrastDebt(finding))
            .map((finding) => formatFinding({ ...finding, where }));
          expect.soft(defects, `${where}: tekst-fund`).toEqual([]);
        }
      });
    }
  }

  for (const lang of ["en", "da"] as const) {
    test(`ingen rå i18n-nøgler på Boardroom (${lang})`, async ({ page }) => {
      await page.setViewportSize({ width: 1440, height: 900 });
      await stabilizePage(page);
      await installNetworkMocks(page);
      await installBoardroomMocks(page, prodShapedPayload());
      await login(page);
      await openBoardroom(page, lang);

      // innerText følger CSS text-transform, så en nøgle i en uppercase-meta-
      // linje ("CHAIRMANBEAT.MEETING_KEEP") skal fanges uden hensyn til store
      // og små bogstaver.
      const rawKey = /\b(?:goalReceipt|chairmanBeat|boardroom|archetypes|goalType|vision|dna|consequence)\.[A-Za-z_]+(?:\.[A-Za-z0-9_]+)*/i;
      for (const tab of TABS) {
        await openTab(page, tab);
        const text = await page.getByTestId("boardroom-page").innerText();
        expect.soft(text, `${tab} (${lang}) viser en rå nøgle`).not.toMatch(rawKey);
        // Replik + dato ("Keep them coming., Sun, Sep 20.") gav ".," midt i linjen.
        expect.soft(text, `${tab} (${lang}) har ".," efter en replik`).not.toMatch(/\.,/);
        // Den rå danske DB-label må ikke nå den engelske flade, og målet skal
        // stå som hel sætning med antal ("Min. 3 riders from ..."), ikke som
        // korttitlen "National core".
        if (lang === "en") expect.soft(text, `${tab} (en) viser dansk DB-label`).not.toMatch(/ryttere fra/i);
        if (lang === "en" && tab === "mandate") {
          expect.soft(text, "mandate (en): nationalt-kerne-målet mangler sin hele titel").toMatch(/Min\. 3 riders from/);
        }
      }
    });
  }
});
