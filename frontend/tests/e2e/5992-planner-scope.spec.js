// #5992 — formplanlæggeren må ikke pege på løb der er startet, og
// ungdomsryttere må ikke blandes ind i seniorplanlægningen.
//
// Spilleren thelamba 30/9: "It shouldn't suggest you plan peak for races that
// has already been done" + "Is there a reason it's showing U23 and junior
// riders?". Boardet nedenfor er bygget af ÆGTE data fra et beta-hold i aktiv
// sæson (ryttere, trupper, ratings, form, peaks, løb og deres status), med dagen
// sat til 1/10 om aftenen: to løb med startdato i dag er da kørt (Trofeo Ligure)
// eller i gang (Volta Catalana), og holdet har ungdomsryttere med ægte peaks.
//
// `before`-varianten er boardets payload FØR rettelsen (ingen `started`, ingen
// `squad`) og bruges kun til PR-billedet (CZ_WRITE_COMMITTED_SHOTS=1).
import { test, expect } from "./e2e-base.js";
import {
  installNetworkMocks, stabilizePage, login, json, corsHeaders, evidenceShotPath, WRITES_COMMITTED_SHOTS,
} from "./fixtures.js";
import { previewPlannerBoard } from "../../src/preview/plannerMock.js";

const TODAY = "2026-10-01";
const DAY = 86_400_000;
const shift = (iso, d) => new Date(Date.parse(`${iso}T00:00:00Z`) + d * DAY).toISOString().slice(0, 10);
const ord = (iso) => Date.parse(`${iso}T00:00:00Z`) / DAY;

const BASE = previewPlannerBoard();
const DEMAND = BASE.races[0].demandVector;
const VALUE = BASE.riders.find((r) => r.peaks.length)?.peaks[0]?.value ?? null;
const ABILITIES = BASE.riders[0].abilities;

// [id, navn, klasse, etaper, startet?, startdato, slutdato]
const RACES = [
  ["trofeo-ligure", "Trofeo Ligure", "ProSeries", 1, true, "2026-10-01", "2026-10-01"],
  ["volta-catalana", "Volta Catalana", "OtherWorldTourB", 7, true, "2026-10-01", "2026-10-04"],
  ["sierra-nevada", "Vuelta a Sierra Nevada", "OtherWorldTourC", 7, false, "2026-10-02", "2026-10-05"],
  ["brugge", "Klassieker van Brugge", "OtherWorldTourC", 1, false, "2026-10-04", "2026-10-04"],
  ["navarra", "Gran Premio de Navarra", "ProSeries", 1, false, "2026-10-05", "2026-10-05"],
  ["vasca", "Vuelta Vasca", "OtherWorldTourB", 6, false, "2026-10-05", "2026-10-07"],
  ["cantabrico", "Clásica del Cantábrico", "OtherWorldTourB", 1, false, "2026-10-07", "2026-10-07"],
  ["kobenhavn", "Københavns Klassiker", "OtherWorldTourC", 1, false, "2026-10-07", "2026-10-07"],
  ["flandres", "Grand Prix des Flandres Françaises", "ProSeries", 1, false, "2026-10-08", "2026-10-08"],
  ["pirineos", "Vuelta a los Pirineos", "OtherWorldTourC", 6, false, "2026-10-08", "2026-10-10"],
  ["vosges", "Tour du Massif des Vosges", "OtherWorldTourC", 6, false, "2026-10-11", "2026-10-13"],
  ["avesnois", "Classique de l'Avesnois", "ProSeries", 1, false, "2026-10-12", "2026-10-12"],
];
const raceName = Object.fromEntries(RACES.map(([id, name]) => [id, name]));

function races({ withStarted }) {
  return RACES.map(([id, name, raceClass, stages, started, date, dateEnd]) => ({
    id, name, raceClass, division: 3, isMine: true, date, dateEnd,
    ...(withStarted ? { started } : {}),
    peakWindow: { window_start: shift(date, -2), window_end: shift(date, 2) },
    gameDayStart: ord(date), gameDayEnd: ord(dateEnd), stages, raceDays: stages,
    terrain: "hilly", stageProfiles: [{ stage: 1, terrain: "hilly", summit: false }],
    profileSummary: { stages, summitFinishes: 0 }, demandVector: DEMAND, rivalPeakCount: 0,
  }));
}

// [id, fornavn, efternavn, nation, type, sekundær, trup, rating, form, [mål-løb]]
const RIDERS = [
  ["vargas", "Raúl", "Vargas", "co", "sprinter", "rouleur", "senior", 60, 67, ["brugge", "avesnois"]],
  ["holm", "Viktor", "Holm", "dk", "gc", "climber", "senior", 59, 67, ["sierra-nevada"]],
  ["hughes", "Lachlan", "Hughes", "gb", "baroudeur", "gc", "senior", 41, 65, ["cantabrico"]],
  ["bravo", "Diego", "Bravo", "co", "gc", "rouleur", "senior", 31, 67, ["trofeo-ligure"]],
  ["garcia", "Diego", "García", "es", "sprinter", "rouleur", "senior", 20, 67, ["avesnois"]],
  ["gao", "Long", "Gao", "cn", "sprinter", "climber", "u23", 33, 60, ["kobenhavn"]],
  ["torres", "Gonzalo M.", "Torres", "co", "brostensrytter", "gc", "u23", 25, 68, ["flandres"]],
  ["verhoeven", "Maarten B.", "Verhoeven", "nl", "brostensrytter", "tt", "junior", 14, 61, ["flandres"]],
  ["barbieri", "Michele", "Barbieri", "it", "gc", "rouleur", "junior", 12, 56, ["trofeo-ligure", "vosges"]],
];

function riders({ withSquad }) {
  return RIDERS.map(([id, firstname, lastname, nationality, primaryType, secondaryType, squad, rating, form, targets]) => ({
    id, firstname, lastname, nationality, age: squad === "senior" ? 27 : squad === "u23" ? 20 : 17,
    primaryType, secondaryType, isAcademy: squad !== "senior",
    ...(withSquad ? { squad } : {}),
    abilities: ABILITIES, rating, form, fatigue: 20, injuredUntil: null, registeredRaceIds: [],
    peaks: targets.map((raceId) => {
      const date = RACES.find((r) => r[0] === raceId)[5];
      return {
        id: `pk-${id}-${raceId}`, riderId: id, seasonId: "s4", targetRaceId: raceId, targetRaceName: raceName[raceId],
        windowStart: shift(date, -2), windowEnd: shift(date, 2), lockedAt: null, locked: false, createdAt: "2026-09-28",
        trainingQuality: null, status: "pending", value: VALUE, paybackCollisions: [], isSuggestion: false,
      };
    }),
  }));
}

function board({ fixed }) {
  return {
    ...BASE, season: { id: "s4", number: 4, status: "active" },
    availableSeasons: [{ id: "s4", number: 4, status: "active" }], today: TODAY,
    riders: riders({ withSquad: fixed }), races: races({ withStarted: fixed }),
  };
}

async function routeBoard(page, payload) {
  await page.route("**/api/peak-plans/board**", (route) => {
    const request = route.request();
    if (request.method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(request) });
    return json(route, payload);
  });
}

async function openPlanner(page, width) {
  await page.setViewportSize({ width, height: width < 768 ? 844 : 900 });
  await page.goto("/planning?tab=form");
  await page.getByText("Holm", { exact: false }).first().waitFor();
}

// Dropdown-valgmulighederne for en tom/sat plads hos seniorrytteren Hughes.
async function hughesOptions(page) {
  const select = page.getByRole("combobox", { name: /Hughes/ }).first();
  return select.locator("option").allInnerTexts();
}

test.beforeEach(async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
});

test("#5992: startede løb kan ikke vælges, og ungdomsryttere står adskilt", async ({ page }, testInfo) => {
  await routeBoard(page, board({ fixed: true }));
  await login(page);
  await openPlanner(page, 1440);

  // 1) Peak-mål: kun løb der ikke er startet.
  const options = (await hughesOptions(page)).join("\n");
  expect(options).not.toContain("Trofeo Ligure");
  expect(options).not.toContain("Volta Catalana");
  expect(options).toContain("Vuelta a Sierra Nevada");

  // 2) Seniortabellen viser kun seniorryttere.
  const seniorTable = page.locator("table").first();
  await expect(seniorTable).toContainText("Holm");
  await expect(seniorTable).not.toContainText("Barbieri");
  await expect(seniorTable).not.toContainText("Gao");

  // Ungdomsryttere med en ægte peak står i deres egen gruppe, hvor peaken kan fjernes.
  const youth = page.getByRole("heading", { name: /U23 (and|og) junior/i });
  await expect(youth).toBeVisible();
  const youthSection = page.locator("section, div").filter({ has: youth }).last();
  await expect(youthSection).toContainText("Barbieri");
  await expect(youthSection).toContainText("Trofeo Ligure");
  await expect(youthSection.getByRole("button", { name: /Remove|Fjern/ }).first()).toBeEnabled();

  if (WRITES_COMMITTED_SHOTS) {
    await page.screenshot({ path: evidenceShotPath(`pr-screens/5992/after-1440-${testInfo.project.name}.png`), fullPage: true });
    await openPlanner(page, 390);
    await page.screenshot({ path: evidenceShotPath(`pr-screens/5992/after-390-${testInfo.project.name}.png`), fullPage: true });
  }
});

test("#5992: billede af boardet før rettelsen", async ({ page }, testInfo) => {
  test.skip(!WRITES_COMMITTED_SHOTS, "kun til PR-billedet");
  await routeBoard(page, board({ fixed: false }));
  await login(page);
  await openPlanner(page, 1440);
  const options = (await hughesOptions(page)).join("\n");
  expect(options).toContain("Trofeo Ligure");
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5992/before-1440-${testInfo.project.name}.png`), fullPage: true });
  await openPlanner(page, 390);
  await page.screenshot({ path: evidenceShotPath(`pr-screens/5992/before-390-${testInfo.project.name}.png`), fullPage: true });
});
