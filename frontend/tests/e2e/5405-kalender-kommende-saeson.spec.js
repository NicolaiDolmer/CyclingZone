// #5405 — kalendersiden viser en KOMMENDE sæson ærligt.
//
// Baggrund (docs/audits/2026-09-19-5405-s4-kalender-synlig.md §3f): sæson-vælgeren
// på kalendersiden viser enhver sæson-række, også en med status 'upcoming'. Men
// "mit holds løb"-markeringen blev bygget på holdets NUVÆRENDE pulje, og op-/
// nedrykningen er ikke afgjort før sæsonskiftet. For langt de fleste managers ville
// markeringen derfor pege på løb holdet ikke skal køre.
//
// Kontrakten der bevises her, på alle tre Playwright-projekter:
//   - aktiv sæson (S3): UÆNDRET — "Mit hold"-fanen, "Mit holds løb"-filteret og
//     egen-hold-markeringen er der som før, og linjen om ventende division er væk.
//   - kommende sæson (S4, divisionPending): ingen "Mit hold"-fane, intet
//     "Mit holds løb"-filter, og ÉN linje der siger hvorfor.
//   - kalenderen tilbyder ingen udtagelses-genvej for et kommende løb: chip'en er
//     og bliver et link ind på løbets side (backend afviser selve udtagelsen,
//     fejlkode selection_season_not_active, PR #5407).
//
// Mocken er bevidst SELVSTÆNDIG (ikke preview-seedet): fire sæson-rækker er
// netop den tilstand seedet ikke har, og en delt seed-ændring ville flytte
// pixel-snapshots i specs denne PR ikke rører.
import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json } from "./fixtures.js";

const OWN_POOL_ID = 2;

// Fire sæsoner, som i prod: to afsluttede, én aktiv, én der endnu ikke er startet.
const AVAILABLE_SEASONS = [
  { id: "s-1", number: 1, status: "completed" },
  { id: "s-2", number: 2, status: "completed" },
  { id: "s-3", number: 3, status: "active" },
  { id: "s-4", number: 4, status: "upcoming" },
];

const DIVISIONS = [
  { division: 1, pools: [{ id: 1, label: "Division 1", poolIndex: 0 }] },
  { division: 2, pools: [{ id: 2, label: "Division 2 — A", poolIndex: 0 }, { id: 3, label: "Division 2 — B", poolIndex: 1 }] },
  { division: 3, pools: [{ id: 4, label: "Division 3 — A", poolIndex: 0 }] },
];

function entry({ id, name, poolId, division, poolLabel, date, terrain, isMine }) {
  return {
    id, name, raceType: "single", raceClass: "ProSeries", stages: 1,
    division, poolId, poolLabel, date, terrain,
    stageSchedule: [{ stage: 1, date, time: "14:00", terrain }],
    isMine, leaderSet: false, entered: false,
  };
}

// Samme løbsnavne i de to sæsoner, så før/efter kun adskiller sig på markeringen.
function races(month, { markMine }) {
  return [
    entry({ id: `${month}-a`, name: "Grand Prix de Namur", poolId: 2, division: 2, poolLabel: "Division 2 — A", date: `${month}-06`, terrain: "sprint", isMine: markMine }),
    entry({ id: `${month}-b`, name: "E3 Saxo Classic", poolId: 2, division: 2, poolLabel: "Division 2 — A", date: `${month}-13`, terrain: "cobbles", isMine: markMine }),
    entry({ id: `${month}-c`, name: "Klasika Bizkaia", poolId: 2, division: 2, poolLabel: "Division 2 — A", date: `${month}-20`, terrain: "itt", isMine: markMine }),
    entry({ id: `${month}-d`, name: "Giro Veneto", poolId: 1, division: 1, poolLabel: "Division 1", date: `${month}-06`, terrain: "hilly", isMine: false }),
    entry({ id: `${month}-e`, name: "Roue Tourangelle", poolId: 3, division: 2, poolLabel: "Division 2 — B", date: `${month}-13`, terrain: "mountain", isMine: false }),
    entry({ id: `${month}-f`, name: "Coppa Bernocchi", poolId: 4, division: 3, poolLabel: "Division 3 — A", date: `${month}-20`, terrain: "sprint", isMine: false }),
  ];
}

function days(month) {
  return [
    { gameDay: 1, date: `${month}-06` },
    { gameDay: 8, date: `${month}-13` },
    { gameDay: 15, date: `${month}-20` },
  ];
}

// S3 — aktiv. Holdets pulje er kendt, så markeringen er sand.
const CALENDAR_S3 = {
  season: { id: "s-3", number: 3, raceDaysTotal: 28, raceDaysCompleted: 22 },
  availableSeasons: AVAILABLE_SEASONS,
  ownPoolId: OWN_POOL_ID,
  divisionPending: false,
  divisions: DIVISIONS,
  days: days("2026-09"),
  entries: races("2026-09", { markMine: true }),
};

// S4 — upcoming. Præcis hvad backend sender efter denne PR: ingen egen pulje,
// ingen isMine, og flaget der lader fladen sige hvorfor.
const CALENDAR_S4 = {
  season: { id: "s-4", number: 4, raceDaysTotal: 28, raceDaysCompleted: 0 },
  availableSeasons: AVAILABLE_SEASONS,
  ownPoolId: null,
  divisionPending: true,
  divisions: DIVISIONS,
  days: days("2026-10"),
  entries: races("2026-10", { markMine: false }),
};

async function gotoCalendar(page) {
  await stabilizePage(page);
  await installNetworkMocks(page);
  // Registreres OVEN PÅ installNetworkMocks — senest registrerede route vinder.
  await page.route("**/api/races/calendar**", (route) => {
    const seasonNumber = new URL(route.request().url()).searchParams.get("season_number");
    return json(route, seasonNumber === "4" ? CALENDAR_S4 : CALENDAR_S3);
  });
  await login(page);
  await expect(async () => {
    await page.goto("/planning?tab=calendar");
    expect(page.url()).toMatch(/\/planning\?tab=calendar$/);
  }).toPass({ timeout: 15000 });
  await expect(page.getByText(/Sæson 3 · 28 løbsdage/)).toBeVisible();
}

const seasonSelect = (page) => page.getByLabel("Sæson", { exact: true });
const pendingNote = (page) => page.getByTestId("calendar-division-pending");

test("aktiv sæson er uændret: 'Mit hold' vælges som default, filteret findes, ingen ventende-division-linje", async ({ page }) => {
  await gotoCalendar(page);

  const tablist = page.getByRole("tablist", { name: /^(Race calendar|Løbskalender)$/i });
  await expect(tablist.getByRole("tab")).toHaveCount(3);
  await expect(page.getByRole("tab", { name: "Mit hold" })).toHaveAttribute("aria-selected", "true");
  await expect(pendingNote(page)).toHaveCount(0);

  // "Mit hold"-fanen filtrerer til holdets egen pulje: egne løb er der, andre
  // divisioners er væk. Det er netop den markering der ikke må overleve til S4.
  await expect(page.getByRole("link", { name: /Grand Prix de Namur/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Coppa Bernocchi/ })).toHaveCount(0);

  await page.getByRole("tab", { name: "Alle hold" }).click();
  await expect(page.getByText("Mit holds løb")).toBeVisible();
});

test("#5405: kommende sæson viser hverken 'Mit hold'-fane eller -filter, men siger hvorfor i én linje", async ({ page }) => {
  await gotoCalendar(page);
  await seasonSelect(page).selectOption("4");

  await expect(page.getByText(/Sæson 4 · 28 løbsdage/)).toBeVisible();

  // Linjen står øverst på siden og nævner både sæsonen og grunden.
  const note = pendingNote(page);
  await expect(note).toBeVisible();
  await expect(note).toHaveText(
    "Sæson 4 er ikke startet endnu. Din division afgøres ved sæsonskiftet, så dine egne løb er ikke markeret.",
  );

  // Fanen er væk (ikke bare fravalgt), og "Alle hold" er den valgte.
  const tablist = page.getByRole("tablist", { name: /^(Race calendar|Løbskalender)$/i });
  await expect(tablist.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { name: "Mit hold" })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Alle hold" })).toHaveAttribute("aria-selected", "true");

  // Filteret i legend-rækken er væk sammen med fanen.
  await expect(page.getByText("Mit holds løb")).toHaveCount(0);

  // Hele pyramidens program er stadig synligt — fladen bliver ikke tom af at
  // undlade markeringen.
  await expect(page.getByRole("link", { name: /Grand Prix de Namur/ }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: /Coppa Bernocchi/ }).first()).toBeVisible();
});

test("#5405: kalenderen tilbyder ingen udtagelses-genvej for en kommende sæsons løb", async ({ page }) => {
  await gotoCalendar(page);
  await seasonSelect(page).selectOption("4");
  await expect(pendingNote(page)).toBeVisible();

  // Kalenderens eneste handling pr. løb er og bliver en navigation ind på løbets
  // side. Ingen "Udtag"/"Vælg trup"-knap må dukke op her: backend afviser
  // udtagelse i en ikke-aktiv sæson (selection_season_not_active, PR #5407), og
  // en knap der altid fejler er værre end ingen knap.
  const chips = page.getByTestId("calendar-race-chip");
  await expect(chips.first()).toBeVisible();
  for (const chip of await chips.all()) {
    await expect(chip).toHaveJSProperty("tagName", "A");
    await expect(chip).toHaveAttribute("href", /^\/races\//);
  }
  await expect(page.getByRole("button", { name: /Udtag|Vælg trup|Gem udtagelse/i })).toHaveCount(0);
});

test("#5405: tilbage til den aktive sæson bringer fane, filter og markering tilbage", async ({ page }) => {
  await gotoCalendar(page);
  await seasonSelect(page).selectOption("4");
  await expect(pendingNote(page)).toBeVisible();

  await seasonSelect(page).selectOption("3");
  await expect(pendingNote(page)).toHaveCount(0);
  // Gaten ophæver sig selv: valget "Mit hold" blev aldrig kastet væk, kun
  // overtrumfet mens divisionen var ukendt.
  await expect(page.getByRole("tab", { name: "Mit hold" })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("link", { name: /Coppa Bernocchi/ })).toHaveCount(0);
});
