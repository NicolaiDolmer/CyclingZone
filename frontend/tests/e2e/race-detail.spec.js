import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json } from "./fixtures.js";

// #959 Etape-resultater V1 — renderer-regression for /races/:raceId.
// Mocker ét 2-etapers stage-race med etape-resultater, daglige trøjebærere og
// endelige klassementer, og verificerer faner + trøje-badges + målrækkefølge.

const RACE = {
  id: "race-e2e-1",
  name: "E2E Tour",
  race_type: "stage_race",
  race_class: "TourFrance",
  stages: 2,
  edition_year: 2026,
  status: "completed",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

function rider(id, first, last) {
  return { id, firstname: first, lastname: last, nationality_code: "dk", team: { id: "team-x", name: "Team X" } };
}

function row(id, stage_number, result_type, rank, r, points = 0, finish_time = null, breakaway = {}) {
  return {
    id, stage_number, result_type, rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time, points_earned: points, prize_money: 0, rider: r,
    // #1499 deskriptive udbruds-etiketter (default false).
    in_breakaway: breakaway.in_breakaway === true,
    breakaway_caught: breakaway.breakaway_caught === true,
  };
}

const ADA = rider("rider-1", "Ada", "Pedersen");
const MIK = rider("rider-2", "Mikkel", "Hansen");

// #1484 stiliseret terræn-indikator: ét profil pr. etape (flad → bjerg).
const STAGE_PROFILES = [
  { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint" },
  { stage_number: 2, profile_type: "mountain", finale_type: "long_climb" },
];

const RESULTS = [
  // Etape 1 målrækkefølge (Race Engine v2 skriver pr.-etape-gab i finish_time)
  // #1499: ADA holdt hjem fra udbruddet (survived), MIK var i udbruddet men blev indhentet (caught).
  row("r1", 1, "stage", 1, ADA, 100, "+0:00", { in_breakaway: true, breakaway_caught: false }),
  row("r2", 1, "stage", 2, MIK, 80, "+0:23", { in_breakaway: true, breakaway_caught: true }),
  // Etape 1 trøjebærere (ingen finish_time)
  row("j1", 1, "leader", 1, ADA, 0),
  row("j2", 1, "points_day", 1, MIK, 0),
  row("j3", 1, "mountain_day", 1, ADA, 0),
  row("j4", 1, "young_day", 1, ADA, 0),
  // Etape 2 målrækkefølge
  row("r3", 2, "stage", 1, MIK, 100, "+0:00"),
  row("r4", 2, "stage", 2, ADA, 80, "+0:14"),
  // Endelige klassementer (sidste etape) — gc har kumulativt gab
  row("g1", 2, "gc", 1, ADA, 0, "+0:00"),
  row("g2", 2, "gc", 2, MIK, 0, "+0:09"),
  row("p1", 2, "points", 1, MIK, 0),
  row("m1", 2, "mountain", 1, ADA, 0),
  row("y1", 2, "young", 1, ADA, 0),
  row("t1", 2, "team", 1, MIK, 0),
];

// Sub-2 (#2770): passage-detaljer (KOM/mellemsprint-krydsninger) for etape 1 —
// én kom-gruppe + én sprint-gruppe, hver med 2 rangerede ryttere.
const PASSAGES = [
  { id: "pass-kom-1", stage_number: 1, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col E2E", waypoint_km: 60, climb_category: "2", rider_id: MIK.id, rider_name: "Mikkel Hansen", team_id: "team-x", passage_rank: 1, points: 5, bonus_seconds: 0 },
  { id: "pass-kom-2", stage_number: 1, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col E2E", waypoint_km: 60, climb_category: "2", rider_id: ADA.id, rider_name: "Ada Pedersen", team_id: "team-x", passage_rank: 2, points: 3, bonus_seconds: 0 },
  { id: "pass-sprint-1", stage_number: 1, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Sprint E2E", waypoint_km: 85, climb_category: null, rider_id: ADA.id, rider_name: "Ada Pedersen", team_id: "team-x", passage_rank: 1, points: 20, bonus_seconds: 3 },
];

test("race detail page renders stage tabs, jerseys and overall classifications", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  // Override races + race_results for det specifikke detalje-load.
  await page.route("**/rest/v1/races**", route => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", route => json(route, RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, STAGE_PROFILES));
  // Sub-2 (#2770): tom passage-liste for denne test — ingen passage-sektion
  // skal rendere (etape 1 og 2 har ingen KOM/mellemsprint-data i dette fixture).
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));

  await login(page);
  await page.goto("/races/race-e2e-1");

  // Header + faner
  await expect(page.getByRole("heading", { name: "E2E Tour" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Samlet" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Etape 1" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Etape 2" })).toBeVisible();

  // Samlet-fane (default): tekst-recap (#1311) + alle 5 klassementer + kumulativt GC-gab (#959 gaps).
  // #1485/#1311: klassement-titler matches på heading-rollen — recap-teksten
  // ("...førte holdkonkurrencen...") matcher ellers getByText("Holdkonkurrence") (strict-mode-kollision).
  await expect(page.getByText("Løbsreferat")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Samlet (GC)" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Pointkonkurrence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Bjergkonkurrence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Holdkonkurrence" })).toBeVisible();
  await expect(page.getByText("+0:09")).toBeVisible();

  // Etape 1: trøje-badges + målrækkefølge + pr.-etape-gab (#959 gaps)
  await page.getByRole("button", { name: "Etape 1" }).click();
  await expect(page.getByText("Trøjer efter etapen")).toBeVisible();
  // #2081: jersey-badges collide on text with the classTab button strip
  // (added in 317e5dc7) for "Point"/"Bjerg"/"Ungdom" — scope to `span` so the
  // classTab `<button>` can't match (same fix pattern as #1485/#1311 above).
  await expect(page.getByText("Fører", { exact: true })).toBeVisible();
  await expect(page.locator("span", { hasText: /^Bjerg$/ })).toBeVisible();
  await expect(page.getByText("Etape 1 · målrækkefølge")).toBeVisible();
  await expect(page.getByText("+0:23")).toBeVisible();

  // #1499 udbruds-markør: survived (ADA) + caught (MIK) via title-tooltip.
  await expect(page.getByTitle("Udbrud — holdt hjem til mål")).toBeVisible();
  await expect(page.getByTitle("Udbrud — indhentet af feltet")).toBeVisible();

  // #3914: den fulde profilgraf (inkl. #1484-terræn-indikatoren) er flyttet ned
  // i en default-lukket CollapsibleSection ("Etapeprofil") nederst på etape-
  // fanen — resultatet er etapens vigtigste indhold nu, ikke ruten. Udfold den
  // via <summary> (native <details>, ingen ekstra ARIA) før vi kan verificere
  // terræn-badges. Etape 1 = fladt + massespurt.
  await page.locator("summary", { hasText: "Etapeprofil" }).click();
  await expect(page.getByText("Terræn", { exact: true })).toBeVisible();
  await expect(page.getByText("Fladt")).toBeVisible();
  await expect(page.getByRole("button", { name: "Massespurt" })).toBeVisible();

  // Etape 2 = bjerge + bjergfinale (skifter med fanen). StageTab remountes pr.
  // etape (key={n}) → "Etapeprofil"-sektionen er lukket igen og skal udfoldes på ny.
  await page.getByRole("button", { name: "Etape 2" }).click();
  await page.locator("summary", { hasText: "Etapeprofil" }).click();
  await expect(page.getByText("Bjerge")).toBeVisible();
  await expect(page.getByRole("button", { name: "Bjergfinale" })).toBeVisible();

  // Sub-2 (#2770): ingen passage-data mocket → ingen passage-sektion nogen steder.
  await expect(page.getByText("Mellemresultater")).toHaveCount(0);
});

// Sub-2 (#2770): passage-liste — KOM + mellemsprint vises UNDER etape-
// måltavlen når race_stage_passages har rækker for etapen.
test("race detail page renders KOM and intermediate sprint passages under stage results", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", route => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", route => json(route, RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, STAGE_PROFILES));
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, PASSAGES));

  await login(page);
  await page.goto("/races/race-e2e-1");

  await page.getByRole("button", { name: "Etape 1" }).click();

  await expect(page.getByText("Mellemresultater")).toBeVisible();
  await expect(page.getByText("Col E2E (kat. 2) — km 60")).toBeVisible();
  await expect(page.getByText("Sprint E2E — km 85")).toBeVisible();
  // "Mikkel Hansen" optræder også i etape-måltavlen/trøje-badges — brug .first().
  await expect(page.getByText("Mikkel Hansen").first()).toBeVisible();
  // Etape 2 har ingen passage-data for dette fixture → ingen sektion.
  await page.getByRole("button", { name: "Etape 2" }).click();
  await expect(page.getByText("Mellemresultater")).toHaveCount(0);
});

// #3396/#3914: "The Final Kilometre" skal følge den valgte etape-fane, ikke
// altid dramatisere den seneste kørte etape — og er nu (#3914, bølge 3) en
// stille (ghost) sekundærknap i StoryOfTheStageSection i stedet for en altid-
// synlig sektion, KUN til stede på etape-faner (ikke på Samlet-fanen, som ikke
// er etape-scopet indhold). RESULTS' etape 1 har begge ryttere sat som
// in_breakaway (ADA holdt hjem → "breakawaySurvived"-beat), etape 2 har ingen
// breakaway-flag → intet beat. Meta-labelen ("Etape N") verificerer
// stageNumber-propen direkte; breakaway-beatet verificerer at finalKmRows/
// moments rent faktisk filtreres pr. valgt fane. StageTab remountes pr. etape
// (key={n} i RaceDetailPage), så knappen skal klikkes på ny for hver fane —
// ingen "hængende" åben-state fra en tidligere etape.
test("Final Kilometre playback follows the selected stage tab, not always the latest", async ({ page }) => {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", route => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", route => json(route, RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, STAGE_PROFILES));
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));

  await login(page);
  await page.goto("/races/race-e2e-1");

  // FinalKilometrePlayback renderer i sit eget Card (div.rounded-cz) med
  // "Den sidste kilometer" som <h2> (SectionHeader). Samme streng er ALSO
  // knappens label i StoryOfTheStageSection — scope derfor på headingen
  // (ikke bare :has-text) så de to elementer ikke kolliderer.
  const finalKmCard = page.locator("div.rounded-cz").filter({
    has: page.getByRole("heading", { name: "Den sidste kilometer" }),
  });
  const finalKmButton = page.getByRole("button", { name: "Den sidste kilometer" });

  // Samlet-fanen (default): Final Km er etape-scopet indhold — hverken
  // knappen eller playbacken findes her.
  await expect(finalKmButton).toHaveCount(0);
  await expect(finalKmCard).toHaveCount(0);

  // Etape 1-fanen: åbn playbacken via den stille knap → label + breakaway-
  // beat for etape 1.
  await page.getByRole("button", { name: "Etape 1" }).click();
  await finalKmButton.click();
  await expect(finalKmCard.getByText("Etape 1")).toBeVisible();
  await expect(finalKmCard.getByText("Et udbrud på 2 ryttere holdt hjem til mål.")).toBeVisible();

  // Etape 2-fanen: StageTab remountes → playbacken er lukket igen (ny knap-
  // klik nødvendig), label + fravær af breakaway-beat opdateres for etape 2.
  await page.getByRole("button", { name: "Etape 2" }).click();
  await expect(finalKmCard).toHaveCount(0);
  await finalKmButton.click();
  await expect(finalKmCard.getByText("Etape 2")).toBeVisible();
  await expect(finalKmCard.getByText(/udbrud/i)).toHaveCount(0);

  // Tilbage til Samlet-fanen: Final Km forsvinder helt igen.
  await page.getByRole("button", { name: "Samlet" }).click();
  await expect(finalKmButton).toHaveCount(0);
});
