// #6514 · Taendingskort for race_library_v2 (Loebsbiblioteket).
//
// Flaget er OFF i prod. Koden ligger paa main bag det: kalenderens loebskort,
// status-prikken, "Kalender | Tabel" og Loebshistorik (Resultater -> Arkiv).
// Denne spec er beviset, ejeren kan se foer flaget flyttes:
//
//   - flag ON:  et klik paa et loeb aabner et lille kort (ikke en navigation),
//               holdets loeb uden udtagelse har en status-prik, "Kalender | Tabel"
//               findes, og Arkiv hedder Loebshistorik med soegning.
//   - flag OFF: kalenderen og arkivet er praecis som foer (loeb er links, ingen
//               prik, ingen visningsvaelger, fanen hedder Arkiv).
//
// Flaget er en bar boolean fra GET /api/races/race-library-v2 (serveren
// evaluerer viewerens beta-status). Her svarer vi den med en mutable tilstand,
// saa samme side kan vises med flaget taendt og slukket.
//
// Det sidste testcase tager de rigtige skaermbilleder (desktop 1440 + mobil 390,
// flag on og off) og stiller dem sammen til ET annoteret foer/efter-billede.
// De skrives til pr-screens/6514-ignition/ naar CZ_WRITE_COMMITTED_SHOTS=1,
// ellers til frontend/test-results/evidence/ (fixtures.evidenceShotPath).
import type { Page, Route } from "@playwright/test";
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, corsHeaders, evidenceShotPath } from "./fixtures.js";

interface MockState { flag: boolean }

// ── Datoer: en maaned i fremtiden, saa "mangler udtagelse" altid er sand ───────
// (status-prikken vises kun for loeb der endnu ikke er begyndt.)
function copenhagenToday(): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
}
function futureDate(day: number): string {
  const [y, m] = copenhagenToday().split("-").map(Number);
  const d = new Date(Date.UTC(y, m - 1 + 2, day, 12));
  return d.toISOString().slice(0, 10);
}

// ── Kalenderen (GET /api/races/calendar) ──────────────────────────────────────
const SEASON = { id: "season-lib", number: 6, raceDaysTotal: 28, raceDaysCompleted: 0 };

interface CalOpts {
  id: string; name: string; raceType: "single" | "stage_race"; stages: number;
  poolId: number; poolLabel: string; division: number; gameDayStart: number;
  startDay: number; terrains: string[]; isMine: boolean; entered: boolean; raceClass?: string;
}
function calEntry(o: CalOpts) {
  const stageSchedule = o.terrains.map((terrain, i) => ({ stage: i + 1, date: futureDate(o.startDay + i), time: "14:00", terrain }));
  return {
    id: o.id, name: o.name, raceType: o.raceType, raceClass: o.raceClass ?? "ProSeries", stages: o.stages,
    division: o.division, poolId: o.poolId, poolLabel: o.poolLabel, poolIndex: 0, status: "scheduled",
    gameDayStart: o.gameDayStart, gameDayEnd: o.gameDayStart + o.stages - 1,
    date: futureDate(o.startDay), terrain: o.terrains[0], terrainStages: o.terrains, stageSchedule,
    isMine: o.isMine, entered: o.entered, leaderSet: false,
  };
}

function calendarPayload() {
  return {
    season: SEASON,
    availableSeasons: [{ id: SEASON.id, number: SEASON.number, status: "active" }],
    ownPoolId: 2,
    divisions: [
      { division: 1, pools: [{ id: 1, label: "Division 1", poolIndex: 0 }] },
      { division: 2, pools: [{ id: 2, label: "Division 2 — A", poolIndex: 0 }, { id: 3, label: "Division 2 — B", poolIndex: 1 }] },
    ],
    days: [
      { gameDay: 1, date: futureDate(6) }, { gameDay: 5, date: futureDate(10) }, { gameDay: 9, date: futureDate(14) },
    ],
    entries: [
      // Holdets egne loeb. Namur og Veneto har ingen udtagelse (= status-prik), Burgos er udtaget.
      calEntry({ id: "lib-namur", name: "Grand Prix de Namur", raceType: "single", stages: 1, poolId: 2, poolLabel: "Division 2 — A", division: 2, gameDayStart: 1, startDay: 6, terrains: ["sprint"], isMine: true, entered: false }),
      calEntry({ id: "lib-burgos", name: "Vuelta a Burgos", raceType: "stage_race", stages: 3, poolId: 2, poolLabel: "Division 2 — A", division: 2, gameDayStart: 5, startDay: 10, terrains: ["mountain", "hilly", "sprint"], isMine: true, entered: true }),
      calEntry({ id: "lib-veneto", name: "Giro Veneto", raceType: "single", stages: 1, poolId: 2, poolLabel: "Division 2 — A", division: 2, gameDayStart: 9, startDay: 14, terrains: ["hilly"], isMine: true, entered: false }),
      // Andre puljer (kun synlige paa "Alle hold").
      calEntry({ id: "lib-ain", name: "Tour de l'Ain", raceType: "stage_race", stages: 3, poolId: 3, poolLabel: "Division 2 — B", division: 2, gameDayStart: 5, startDay: 10, terrains: ["hilly", "mountain", "hilly"], isMine: false, entered: false }),
      calEntry({ id: "lib-roue", name: "Roue Tourangelle", raceType: "single", stages: 1, poolId: 3, poolLabel: "Division 2 — B", division: 2, gameDayStart: 1, startDay: 6, terrains: ["sprint"], isMine: false, entered: false }),
    ],
  };
}

// ── Passer til holdet (GET /api/races/selection/season) ───────────────────────
const ABILITY_KEYS = ["climbing", "time_trial", "sprint", "punch", "endurance", "cobblestone", "acceleration",
  "recovery", "tactics", "positioning", "flat", "tempo", "durability", "aggression", "descending"];
const abilities = (over: Record<string, number> = {}) => Object.fromEntries(ABILITY_KEYS.map((k) => [k, over[k] ?? 58]));

function seasonFitPayload() {
  return {
    enabled: true,
    season: { id: SEASON.id, number: SEASON.number },
    ownPoolId: 2,
    readOnly: false,
    races: [
      { id: "lib-namur", name: "Grand Prix de Namur", raceClass: "ProSeries", stages: 1, status: "scheduled", gameDayStart: 1, gameDayEnd: 1, restGameDays: [], sizeMin: 6, sizeMax: 6, demandVector: { sprint: 0.7, positioning: 0.3 } },
      { id: "lib-veneto", name: "Giro Veneto", raceClass: "ProSeries", stages: 1, status: "scheduled", gameDayStart: 9, gameDayEnd: 9, restGameDays: [], sizeMin: 6, sizeMax: 6, demandVector: { punch: 0.7, climbing: 0.3 } },
    ],
    riders: [
      { id: "fit-r1", name: "Lei Wu", abilities: abilities({ sprint: 76, positioning: 70 }), injured: false },
      { id: "fit-r2", name: "Jack Marsh", abilities: abilities({ climbing: 71 }), injured: false },
      { id: "fit-r3", name: "Tao Han", abilities: abilities({ time_trial: 76, punch: 63 }), injured: false },
      { id: "fit-r4", name: "Mathis Dumas", abilities: abilities({ cobblestone: 75, punch: 66 }), injured: false },
      { id: "fit-r5", name: "Seungho Hong", abilities: abilities({ climbing: 74, recovery: 70 }), injured: false },
      { id: "fit-r6", name: "Ada Pedersen", abilities: abilities({ sprint: 64, flat: 66 }), injured: false },
    ],
  };
}

// ── Loebshistorik (rest: races / race_results / race_stage_profiles) ──────────
// Kun pulje 2 (holdets egen) har afsluttede loeb. Navne og vindere er opdigtede.
interface HistRace { id: string; name: string; race_type: "single" | "stage_race"; race_class: string; stages: number; season: number }
const HISTORY_RACES: HistRace[] = [
  { id: "h-ain-2", name: "Tour de l'Ain", race_type: "stage_race", race_class: "ProSeries", stages: 3, season: 2 },
  { id: "h-ain-3", name: "Tour de l'Ain", race_type: "stage_race", race_class: "ProSeries", stages: 3, season: 3 },
  { id: "h-avenir-3", name: "Tour de l'Avenir", race_type: "stage_race", race_class: "ProSeries", stages: 4, season: 3 },
  { id: "h-burgos-1", name: "Vuelta a Burgos", race_type: "stage_race", race_class: "ProSeries", stages: 3, season: 1 },
  { id: "h-burgos-2", name: "Vuelta a Burgos", race_type: "stage_race", race_class: "ProSeries", stages: 3, season: 2 },
  { id: "h-burgos-3", name: "Vuelta a Burgos", race_type: "stage_race", race_class: "ProSeries", stages: 3, season: 3 },
  { id: "h-andalucia-3", name: "Vuelta a Andalucía", race_type: "stage_race", race_class: "ProSeries", stages: 3, season: 3 },
  { id: "h-namur-1", name: "Grand Prix de Namur", race_type: "single", race_class: "ProSeries", stages: 1, season: 1 },
  { id: "h-namur-2", name: "Grand Prix de Namur", race_type: "single", race_class: "ProSeries", stages: 1, season: 2 },
  { id: "h-namur-3", name: "Grand Prix de Namur", race_type: "single", race_class: "ProSeries", stages: 1, season: 3 },
  { id: "h-veneto-3", name: "Giro Veneto", race_type: "single", race_class: "ProSeries", stages: 1, season: 3 },
];
const WINNERS: Record<string, string> = {
  "h-ain-2": "Seungho Hong", "h-ain-3": "Jack Marsh", "h-avenir-3": "Lei Wu",
  "h-burgos-1": "Tao Han", "h-burgos-2": "Seungho Hong", "h-burgos-3": "Seungho Hong",
  "h-andalucia-3": "Mathis Dumas", "h-namur-1": "Lei Wu", "h-namur-2": "Ada Pedersen", "h-namur-3": "Lei Wu",
  "h-veneto-3": "Jack Marsh",
};
// Holdets placering (gc ved sidste etape). Intet = "Ikke i resultaterne".
const MY_RANK: Record<string, number> = { "h-burgos-2": 4, "h-burgos-3": 2, "h-namur-2": 1, "h-ain-3": 7 };
const PROFILES: Record<string, string[]> = {
  "h-ain-3": ["hilly", "mountain", "hilly"], "h-avenir-3": ["flat", "hilly", "mountain", "itt"],
  "h-burgos-3": ["mountain", "hilly", "flat"], "h-andalucia-3": ["flat", "hilly", "flat"],
  "h-namur-3": ["flat"], "h-veneto-3": ["hilly"],
  "lib-namur": ["flat"], "lib-burgos": ["mountain", "hilly", "flat"], "lib-veneto": ["hilly"], "lib-ain": ["hilly", "mountain", "hilly"],
};
const finalStage = (r: HistRace) => (r.race_type === "stage_race" ? r.stages : 1);

function inList(search: string, column: string): string[] | null {
  const m = decodeURIComponent(search).match(new RegExp(`[?&]${column}=in\\.\\(([^)]*)\\)`));
  return m ? m[1].split(",").map((s) => s.trim().replace(/^"|"$/g, "")) : null;
}

function restOverride(table: string, search: string): unknown[] | null {
  if (table === "races") {
    if (!/status=eq\.completed/.test(search)) return null;
    const pool = Number((search.match(/league_division_id=eq\.(\d+)/) || [])[1]);
    if (pool !== 2) return [];
    return HISTORY_RACES.map((r) => ({
      id: r.id, name: r.name, race_type: r.race_type, race_class: r.race_class, stages: r.stages,
      status: "completed", season: { number: r.season },
    }));
  }
  if (table === "race_results") {
    const ids = inList(search, "race_id");
    if (!ids) return null;
    const mine = /team_id=eq\./.test(search);
    const out: unknown[] = [];
    for (const r of HISTORY_RACES.filter((x) => ids.includes(x.id))) {
      if (mine) {
        if (MY_RANK[r.id]) out.push({ race_id: r.id, stage_number: finalStage(r), result_type: "gc", rank: MY_RANK[r.id] });
      } else {
        out.push({ race_id: r.id, stage_number: finalStage(r), result_type: "gc", rank: 1, rider_id: `w-${r.id}`, rider_name: WINNERS[r.id], team_name: "Hold A" });
      }
    }
    return out;
  }
  if (table === "race_stage_profiles") {
    const single = (search.match(/race_id=eq\.([^&]+)/) || [])[1];
    const ids = single ? [decodeURIComponent(single)] : inList(search, "race_id");
    if (!ids) return null;
    return ids.flatMap((id) => (PROFILES[id] || []).map((profile_type, i) => ({ race_id: id, stage_number: i + 1, profile_type })));
  }
  return null;
}

async function installLibraryMocks(page: Page, state: MockState) {
  await page.route("**/api/races/race-library-v2", (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, { enabled: state.flag });
  });
  await page.route("**/api/races/calendar**", (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, calendarPayload());
  });
  await page.route("**/api/races/selection/season**", (route: Route) => {
    if (route.request().method() === "OPTIONS") return route.fulfill({ status: 204, headers: corsHeaders(route.request()) });
    return json(route, seasonFitPayload());
  });
  await page.route("**/rest/v1/**", (route: Route) => {
    const request = route.request();
    if (request.method() !== "GET") return route.fallback();
    const url = new URL(request.url());
    const table = url.pathname.split("/").filter(Boolean).pop() || "";
    const rows = restOverride(table, url.search);
    if (rows === null) return route.fallback();
    return json(route, rows);
  });
}

async function setup(page: Page, flag: boolean): Promise<MockState> {
  const state: MockState = { flag };
  await stabilizePage(page);
  await installNetworkMocks(page);
  await installLibraryMocks(page, state);
  await login(page);
  return state;
}

async function gotoCalendar(page: Page) {
  await expect(async () => {
    await page.goto("/planning?tab=calendar");
    expect(page.url()).toMatch(/\/planning\?tab=calendar$/);
  }).toPass({ timeout: 15000 });
  await expect(page.getByTestId("calendar-race-chip").first()).toBeVisible();
}

async function gotoArchive(page: Page) {
  await page.goto("/resultater?tab=archive");
  await expect(page.getByRole("tab", { name: /^(Løbshistorik|Arkiv)$/ })).toBeVisible();
}

const visibleSwitch = (page: Page) => page.locator('[data-testid="calendar-view-switch"]:visible');

// ── Flag ON ───────────────────────────────────────────────────────────────────

test.describe("race_library_v2 TIL", () => {
  test("kalenderen: et klik aabner loebskortet i stedet for at navigere, og prikken viser manglende udtagelse", async ({ page }) => {
    await setup(page, true);
    await gotoCalendar(page);

    // Status-prikken: Namur og Veneto mangler udtagelse, Burgos er udtaget (ingen prik).
    const namur = page.getByRole("button", { name: /Grand Prix de Namur/ });
    await expect(namur).toBeVisible();
    await expect(namur).toHaveAttribute("aria-label", /Mangler udtagelse/);
    await expect(namur.getByTestId("calendar-missing-dot")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Giro Veneto/ }).getByTestId("calendar-missing-dot")).toHaveCount(1);
    await expect(page.getByRole("button", { name: /Vuelta a Burgos/ }).first().getByTestId("calendar-missing-dot")).toHaveCount(0);
    await expect(page.getByTestId("calendar-missing-dot")).toHaveCount(2);

    // Klik: kortet aabner, URL'en er uaendret.
    await namur.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(page.url()).toMatch(/\/planning\?tab=calendar$/);
    await expect(dialog.getByRole("heading", { name: "Grand Prix de Namur" })).toBeVisible();
    await expect(dialog.getByText("Endagsløb")).toBeVisible();
    await expect(dialog.getByTestId("race-peek-terrain")).toBeVisible();
    await expect(dialog.getByText("Mangler udtagelse")).toBeVisible();
    await expect(dialog.getByText("Passer til holdet")).toBeVisible();
    await expect(dialog.getByText(/Bedste bud: Lei Wu/)).toBeVisible();
    // Den ene guld-knap til udtagelsen + "Aabn loebet" til loebssiden.
    await expect(dialog.getByRole("link", { name: "Åbn løbet" })).toHaveAttribute("href", "/races/lib-namur");
    await expect(dialog.getByRole("link", { name: "Udtag hold" })).toHaveAttribute("href", /\/planning\?tab=selection&day=\d+$/);

    await page.keyboard.press("Escape");
    await expect(dialog).toHaveCount(0);
  });

  test("loebskortet for et etapeloeb viser udtaget-status og ret-knap, og bevarer den klikkede etape", async ({ page }) => {
    await setup(page, true);
    await gotoCalendar(page);

    // Etapeloebet har en chip pr. etape; den anden etape ligger paa dag 2.
    const burgosStage2 = page.getByRole("button", { name: /Vuelta a Burgos/ }).filter({ hasText: "2. etape" });
    await expect(burgosStage2).toBeVisible();
    await burgosStage2.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("heading", { name: "Vuelta a Burgos" })).toBeVisible();
    await expect(dialog.getByText("3 etaper")).toBeVisible();
    await expect(dialog.getByText("Udtaget", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Ret udtagelse" })).toBeVisible();
    await expect(dialog.getByRole("link", { name: "Åbn løbet" })).toHaveAttribute("href", "/races/lib-burgos?stage=2");
  });

  test("Kalender | Tabel: tabellen viser holdets loeb, soeger, og kalenderen er intakt ved skift tilbage", async ({ page }) => {
    await setup(page, true);
    await gotoCalendar(page);

    const view = visibleSwitch(page);
    await expect(view).toBeVisible();
    await expect(view.getByRole("button", { name: "Kalender" })).toHaveAttribute("aria-pressed", "true");
    await view.getByRole("button", { name: "Tabel" }).click();

    await expect(page).toHaveURL(/view=table/);
    const table = page.getByTestId("calendar-table");
    await expect(table).toBeVisible();
    for (const name of ["Grand Prix de Namur", "Vuelta a Burgos", "Giro Veneto"]) {
      await expect(table.getByText(name, { exact: true }).first()).toBeVisible();
    }
    // "Mit hold" er stadig valgt: andre puljers loeb er ikke med.
    await expect(table.getByText("Tour de l'Ain")).toHaveCount(0);

    await page.getByPlaceholder("Søg i løb").fill("Vuelta");
    await expect(table.getByText("Vuelta a Burgos", { exact: true }).first()).toBeVisible();
    await expect(table.getByText("Giro Veneto")).toHaveCount(0);
    await expect(table.getByText("Grand Prix de Namur")).toHaveCount(0);

    await visibleSwitch(page).getByRole("button", { name: "Kalender" }).click();
    await expect(page).not.toHaveURL(/view=table/);
    await expect(page.getByTestId("calendar-table")).toHaveCount(0);
    await expect(page.getByTestId("calendar-race-chip").first()).toBeVisible();
  });

  test("Resultater: Arkiv hedder Loebshistorik, viser vindere og soeger paa 'Tour de l' og 'Vuelta'", async ({ page }) => {
    await setup(page, true);
    await gotoArchive(page);

    await expect(page.getByRole("tab", { name: "Løbshistorik" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Arkiv", exact: true })).toHaveCount(0);
    const library = page.getByTestId("race-history-library");
    await expect(library).toBeVisible();
    await expect(library.getByText("7 løb")).toBeVisible();

    // Navnet fører til loebets egen side, en udgave til sit resultat.
    await expect(library.getByRole("link", { name: "Vuelta a Burgos" }).first())
      .toHaveAttribute("href", /\/race-archive\/Vuelta%20a%20Burgos\?type=stage_race&pool=2$/);
    // Forsvarende mester = nyeste udgaves vinder.
    await expect(library.getByRole("link", { name: "Seungho Hong" }).first()).toHaveAttribute("href", "/races/h-burgos-3");

    const search = page.getByPlaceholder("Søg efter løb");
    await search.fill("Tour de l");
    await expect(library.getByText("2 løb")).toBeVisible();
    await expect(library.getByRole("link", { name: "Tour de l'Ain" }).first()).toBeVisible();
    await expect(library.getByRole("link", { name: "Tour de l'Avenir" }).first()).toBeVisible();
    await expect(library.getByRole("link", { name: "Vuelta a Burgos" })).toHaveCount(0);

    await search.fill("Vuelta");
    await expect(library.getByText("2 løb")).toBeVisible();
    await expect(library.getByRole("link", { name: "Vuelta a Burgos" }).first()).toBeVisible();
    await expect(library.getByRole("link", { name: "Vuelta a Andalucía" }).first()).toBeVisible();
    await expect(library.getByRole("link", { name: "Tour de l'Ain" })).toHaveCount(0);

    // Accent-uafhaengig soegning: "andalucia" finder "Andalucía".
    await search.fill("andalucia");
    await expect(library.getByText("1 løb")).toBeVisible();

    await search.fill("findes ikke");
    await expect(page.getByText("Prøv en anden søgning")).toBeVisible();
    await page.getByRole("button", { name: "Ryd søgning" }).click();
    await expect(library.getByText("7 løb")).toBeVisible();
  });
});

// ── Flag OFF: den gamle visning er uaendret ───────────────────────────────────

test.describe("race_library_v2 FRA", () => {
  test("kalenderen: loeb er links, ingen prik, ingen visningsvaelger, ?view=table ignoreres", async ({ page }) => {
    await setup(page, false);
    await gotoCalendar(page);

    // Chippen er stadig et link til loebssiden (ikke en knap der aabner et kort).
    const namur = page.getByRole("link", { name: /Grand Prix de Namur/ }).first();
    await expect(namur).toHaveAttribute("href", "/races/lib-namur");
    await expect(page.getByRole("button", { name: /Grand Prix de Namur/ })).toHaveCount(0);
    await expect(page.getByTestId("calendar-missing-dot")).toHaveCount(0);
    await expect(page.getByTestId("calendar-view-switch")).toHaveCount(0);

    // Flag off = altid kalenderen, selv med ?view=table i URL'en.
    await page.goto("/planning?tab=calendar&view=table");
    await expect(page.getByTestId("calendar-race-chip").first()).toBeVisible();
    await expect(page.getByTestId("calendar-table")).toHaveCount(0);
  });

  test("Resultater: fanen hedder stadig Arkiv og viser det gamle arkiv, ikke Loebshistorik", async ({ page }) => {
    await setup(page, false);
    await gotoArchive(page);

    await expect(page.getByRole("tab", { name: "Arkiv", exact: true })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Løbshistorik" })).toHaveCount(0);
    await expect(page.getByTestId("race-history-library")).toHaveCount(0);
    await expect(page.getByPlaceholder("Søg efter løb")).toHaveCount(0);
  });
});

// ── Billeder: flag on/off, desktop 1440 + mobil 390, og ET samlet foer/efter ───

const DESKTOP = { width: 1440, height: 1000 };
const MOBILE = { width: 390, height: 844 };

interface Pin { num: number; x: number; y: number; width: number; height: number }
interface Shot { dataUri: string; width: number; height: number; pins: Pin[] }

async function snap(page: Page, file: string, pinSelectors: Array<[number, string]> = [], fullPage = true): Promise<Shot> {
  await page.evaluate(async () => { if (document.fonts?.ready) await document.fonts.ready; });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(250);
  // Pins aflaeses foer billedet, i sidens egne koordinater (scrollY = 0, scale 1).
  const pins: Pin[] = [];
  for (const [num, selector] of pinSelectors) {
    const box = await page.locator(selector).first().boundingBox();
    if (box) pins.push({ num, x: box.x, y: box.y, width: box.width, height: box.height });
  }
  const buffer = await page.screenshot({ path: evidenceShotPath(`pr-screens/6514-ignition/${file}.png`), fullPage });
  const size = await page.evaluate(() => ({ width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight }));
  const dims = fullPage ? size : { width: page.viewportSize()!.width, height: page.viewportSize()!.height };
  return { dataUri: `data:image/png;base64,${buffer.toString("base64")}`, ...dims, pins };
}

const LEGEND = [
  "1. Ny: „Kalender | Tabel“. Tabellen viser hele sæsonen med én række pr. løb.",
  "2. Ny: en lille prik på holdets løb der mangler udtagelse. Udtagne løb har ingen prik.",
  "3. Nyt: et klik på et løb åbner et lille kort med terræn, „passer til holdet“, din status og „Udtag hold“, i stedet for at forlade kalenderen.",
  "4. Tabellen: søg, filtrér og se din status pr. løb.",
  "5. Arkivet hedder nu „Løbshistorik“.",
  "6. Ny: søg efter et løb. Pr. løb ser du forsvarende mester, dit bedste resultat, terræn og tidligere vindere.",
];

function composeHtml(panels: Record<string, Shot & { caption: string; scale: number }>, tones: Record<string, "before" | "after">, mobile: Array<Shot & { caption: string; tone: "before" | "after" }>): string {
  const card = (p: Shot & { caption: string; scale: number }, tone: "before" | "after") => {
    const w = Math.round(p.width * p.scale);
    const h = Math.round(p.height * p.scale);
    const pins = p.pins.map((pin) => `<span class="pin" style="left:${Math.round(pin.x * p.scale)}px;top:${Math.round((pin.y + pin.height / 2) * p.scale)}px">${pin.num}</span>`).join("");
    return `<figure class="panel"><figcaption><span class="tag ${tone}">${tone === "before" ? "Før" : "Efter"}</span>${p.caption}</figcaption>
      <div class="shot" style="width:${w}px;height:${h}px"><img src="${p.dataUri}" style="width:${w}px" alt="">${pins}</div></figure>`;
  };
  const phone = (p: Shot & { caption: string; tone: "before" | "after" }) => card({ ...p, scale: 0.8 }, p.tone);
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><style>
    :root { --ink:#16181d; --muted:#5b6070; --line:#d7dae2; --gold:#a07800; }
    * { box-sizing:border-box; }
    body { margin:0; background:#f4f5f7; color:var(--ink); font:400 15px/1.45 system-ui,-apple-system,"Segoe UI",sans-serif; padding:30px 32px 34px; width:2700px; }
    h1 { font-size:22px; font-weight:700; margin:0 0 5px; }
    .sub { font-size:14px; color:var(--muted); margin:0 0 22px; max-width:1200px; }
    .row { display:flex; gap:28px; align-items:flex-start; }
    .col { display:flex; flex-direction:column; gap:20px; }
    .panel { margin:0; }
    figcaption { font-size:13px; color:var(--muted); margin-bottom:6px; display:flex; align-items:center; gap:8px; }
    .tag { font-size:11px; font-weight:700; letter-spacing:.08em; text-transform:uppercase; padding:2px 7px; border-radius:5px; border:1px solid var(--line); color:var(--ink); }
    .tag.after { border-color:var(--gold); color:var(--gold); }
    .shot { position:relative; border:1px solid var(--line); background:#fff; overflow:hidden; border-radius:5px; }
    .shot img { display:block; }
    .pin { position:absolute; transform:translate(-50%,-50%); width:26px; height:26px; border-radius:13px; background:var(--gold); color:#fff; font:700 14px/26px system-ui,sans-serif; text-align:center; border:2px solid #fff; }
    ol.legend { margin:26px 0 0; padding:16px 0 0; list-style:none; border-top:1px solid var(--line); columns:2; column-gap:56px; font-size:14px; max-width:1800px; }
    ol.legend li { margin:0 0 8px; break-inside:avoid; }
  </style></head><body>
    <h1>Løbsbiblioteket (race_library_v2): før og efter</h1>
    <p class="sub">Ægte skærmbilleder (dansk UI). De tre første kolonner er desktop 1440 px skaleret til halv størrelse (venstre: i dag, midten og højre: med flaget tændt); den sidste kolonne er mobil 390 px. „Før“ er den nuværende visning (flaget slukket), „Efter“ er flaget tændt. Flaget er slukket i prod.</p>
    <div class="row">
      <div class="col">${["a", "e"].map((k) => card(panels[k], tones[k])).join("")}</div>
      <div class="col">${["b", "f"].map((k) => card(panels[k], tones[k])).join("")}</div>
      <div class="col">${["c", "d"].map((k) => card(panels[k], tones[k])).join("")}</div>
      <div class="col">${mobile.map(phone).join("")}</div>
    </div>
    <ol class="legend">${LEGEND.map((l) => `<li>${l}</li>`).join("")}</ol>
  </body></html>`;
}

test("billeder: flag on/off, desktop + mobil, og ET samlet foer/efter", async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "Beviset er ét billede, ikke tre: kun desktop-chromium");
  test.setTimeout(180_000);
  const state = await setup(page, false);

  // FØR (flag off)
  await page.setViewportSize(DESKTOP);
  await gotoCalendar(page);
  const beforeCal = await snap(page, "desktop-calendar-flag-off");
  await gotoArchive(page);
  await expect(page.getByText(/Viser|Ingen/).first()).toBeVisible();
  await page.waitForLoadState("networkidle");
  const beforeArchive = await snap(page, "desktop-archive-flag-off");
  await page.setViewportSize(MOBILE);
  await gotoCalendar(page);
  const beforeCalMobile = await snap(page, "mobile-calendar-flag-off", [], false);
  await gotoArchive(page);
  await page.waitForLoadState("networkidle");
  const beforeArchiveMobile = await snap(page, "mobile-archive-flag-off", [], false);

  // EFTER (flag on)
  state.flag = true;
  await page.setViewportSize(DESKTOP);
  await gotoCalendar(page);
  await expect(visibleSwitch(page)).toBeVisible();
  const afterCal = await snap(page, "desktop-calendar-flag-on", [
    [1, '[data-testid="calendar-view-switch"]:visible'],
    [2, '[data-testid="calendar-missing-dot"]'],
  ]);
  await page.getByRole("button", { name: /Grand Prix de Namur/ }).click();
  await expect(page.getByTestId("race-peek-terrain")).toBeVisible();
  await expect(page.getByText(/Bedste bud/)).toBeVisible();
  const afterPeek = await snap(page, "desktop-race-card-flag-on", [[3, '[data-testid="race-peek-card"]']], false);
  await page.keyboard.press("Escape");
  await visibleSwitch(page).getByRole("button", { name: "Tabel" }).click();
  await expect(page.getByTestId("calendar-table")).toBeVisible();
  const afterTable = await snap(page, "desktop-calendar-table-flag-on", [[4, '[data-testid="calendar-table-search"]']]);
  await gotoArchive(page);
  await expect(page.getByTestId("race-history-library").getByText("7 løb")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const afterHistory = await snap(page, "desktop-race-history-flag-on", [
    [5, '[role="tab"]:has-text("Løbshistorik")'],
    [6, '[data-testid="race-history-search"]'],
  ]);

  await page.setViewportSize(MOBILE);
  await gotoCalendar(page);
  const afterCalMobile = await snap(page, "mobile-calendar-flag-on", [], false);
  await page.getByRole("button", { name: /Grand Prix de Namur/ }).click();
  await expect(page.getByTestId("race-peek-terrain")).toBeVisible();
  await snap(page, "mobile-race-card-flag-on", [], false);
  await page.keyboard.press("Escape");
  await visibleSwitch(page).getByRole("button", { name: "Tabel" }).click();
  await expect(page.getByTestId("calendar-table")).toBeVisible();
  await snap(page, "mobile-calendar-table-flag-on", [], false);
  await gotoArchive(page);
  await expect(page.getByTestId("race-history-library").getByText("7 løb")).toBeVisible();
  await page.waitForLoadState("networkidle");
  const afterHistoryMobile = await snap(page, "mobile-race-history-flag-on", [], false);

  // Samlet billede. En ny side i samme browser, saa mocks og viewport ikke roeres.
  const sheet = await browser.newPage({ viewport: { width: 2700, height: 1000 } });
  const half = 0.5;
  await sheet.setContent(composeHtml(
    {
      a: { ...beforeCal, caption: "Kalenderen i dag: løb er links, ingen prik, ingen visningsvælger", scale: half },
      b: { ...afterCal, caption: "Kalenderen med flaget tændt", scale: half },
      c: { ...afterPeek, caption: "Et klik på et løb åbner løbskortet", scale: half },
      d: { ...afterTable, caption: "„Tabel“-visningen", scale: half },
      e: { ...beforeArchive, caption: "Resultater → Arkiv i dag", scale: half },
      f: { ...afterHistory, caption: "Resultater → Løbshistorik", scale: half },
    },
    { a: "before", b: "after", c: "after", d: "after", e: "before", f: "after" },
    [
      { ...beforeCalMobile, caption: "Mobil: kalender i dag", tone: "before" },
      { ...afterCalMobile, caption: "Mobil: kalender", tone: "after" },
      { ...beforeArchiveMobile, caption: "Mobil: Arkiv i dag", tone: "before" },
      { ...afterHistoryMobile, caption: "Mobil: Løbshistorik", tone: "after" },
    ],
  ));
  await sheet.waitForLoadState("load");
  await sheet.screenshot({ path: evidenceShotPath("pr-screens/6514-ignition/before-after.png"), fullPage: true });
  await sheet.close();
});
