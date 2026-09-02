import { test, expect } from "./e2e-base.js";
import { installNetworkMocks, login, stabilizePage, json, evidenceShotPath, raceResultsRoute } from "./fixtures.js";

// #3519 — to uafhængige spillerønsker: (a) synlige point pr. waypoint på
// etape-resultatsiden (allerede bygget, Sub-2 #2770/#2448 — PassageList/
// StageWaypointReadout), (b) en spiller der vandt 3 etaper uden top-3 i
// bjergkonkurrencen og ikke kunne se hvorfor — mountain_day/points_day-
// rækkerne bar kun RANGEN, aldrig pointtallet bag den. Denne fil dækker
// begge dele med et etapeløb der er MIDT I (ingen gc-rækker endnu →
// LiveOverallTab), så både "point pr. waypoint" og "løbende stilling" er
// synlige på samme fikstur.
//
// Fixturen er bevidst designet til at genskabe #3519-klagen: Lars Nielsen
// vinder BEGGE etaper (stage-rank 1) men samler næsten ingen bjergpoint
// (kom_points 0+2=2) — mens Freya Olsen angriber stigningerne uden at vinde
// etaper og ender som suveræn bjergfører (kom_points 8+10=18). Rangordenen
// fandtes allerede før #3519; det nye er point-TOTAL-kolonnen der forklarer den.

const RACE = {
  id: "race-e2e-3519",
  name: "E2E Climbers Cup",
  race_type: "stage_race",
  race_class: "TourFrance",
  stages: 3,
  stages_completed: 2,
  edition_year: 2026,
  status: "scheduled",
  season: { id: "season-e2e", number: 1 },
  pool_race: null,
};

function rider(id, first, last, teamId, teamName) {
  return { id, firstname: first, lastname: last, nationality_code: "dk", team: { id: teamId, name: teamName } };
}

const FREYA = rider("rider-f", "Freya", "Olsen", "team-alpha", "Team Alpha");
const OSCAR = rider("rider-o", "Oscar", "Berg", "team-alpha", "Team Alpha");
const ADA = rider("rider-a", "Ada", "Pedersen", "team-alpha", "Team Alpha");
const MIKKEL = rider("rider-m", "Mikkel", "Hansen", "team-beta", "Team Beta");
const LARS = rider("rider-l", "Lars", "Nielsen", "team-beta", "Team Beta");

const STAGE_PROFILES = [
  { stage_number: 1, profile_type: "flat", finale_type: "bunch_sprint" },
  { stage_number: 2, profile_type: "mountain", finale_type: "long_climb" },
];

function stageRow(id, stage_number, rank, r, { sprint = 0, kom = 0, finish = "+0:00" } = {}) {
  return {
    id, stage_number, result_type: "stage", rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time: finish, points_earned: 0, prize_money: 0,
    sprint_points: sprint, kom_points: kom, bonus_seconds: 0,
    rider: r, in_breakaway: false, breakaway_caught: false,
  };
}

function dayRow(id, stage_number, result_type, rank, r, finish = null) {
  return {
    id, stage_number, result_type, rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time: finish, points_earned: 0, prize_money: 0,
    rider: r, in_breakaway: false, breakaway_caught: false,
  };
}

const RESULTS = [
  // Etape 1 (flad) målrækkefølge — Lars vinder, Freya (klatrespecialist) sidst.
  stageRow("s1-1", 1, 1, LARS, { sprint: 2, kom: 0, finish: "+0:00" }),
  stageRow("s1-2", 1, 2, ADA, { sprint: 5, kom: 3, finish: "+0:00" }),
  stageRow("s1-3", 1, 3, MIKKEL, { sprint: 1, kom: 1, finish: "+0:04" }),
  stageRow("s1-4", 1, 4, OSCAR, { sprint: 1, kom: 4, finish: "+0:22" }),
  stageRow("s1-5", 1, 5, FREYA, { sprint: 0, kom: 8, finish: "+1:10" }),
  // Etape 1 dag-trøjer (rank 1..5 pr. klassement — #2081 fulde dag-snapshots)
  dayRow("l1-1", 1, "leader", 1, LARS, "+0:00"),
  dayRow("l1-2", 1, "leader", 2, ADA, "+0:00"),
  dayRow("l1-3", 1, "leader", 3, MIKKEL, "+0:04"),
  dayRow("l1-4", 1, "leader", 4, OSCAR, "+0:22"),
  dayRow("l1-5", 1, "leader", 5, FREYA, "+1:10"),
  dayRow("p1-1", 1, "points_day", 1, ADA),
  dayRow("p1-2", 1, "points_day", 2, LARS),
  dayRow("p1-3", 1, "points_day", 3, OSCAR),
  dayRow("p1-4", 1, "points_day", 4, MIKKEL),
  dayRow("p1-5", 1, "points_day", 5, FREYA),
  dayRow("m1-1", 1, "mountain_day", 1, FREYA),
  dayRow("m1-2", 1, "mountain_day", 2, OSCAR),
  dayRow("m1-3", 1, "mountain_day", 3, ADA),
  dayRow("m1-4", 1, "mountain_day", 4, MIKKEL),
  dayRow("m1-5", 1, "mountain_day", 5, LARS),
  dayRow("y1-1", 1, "young_day", 1, LARS, "+0:00"),

  // Etape 2 (bjerge) målrækkefølge — Lars vinder IGEN, men taber bjergpointene til Freya.
  stageRow("s2-1", 2, 1, LARS, { sprint: 1, kom: 2, finish: "+0:00" }),
  stageRow("s2-2", 2, 2, FREYA, { sprint: 0, kom: 10, finish: "+0:18" }),
  stageRow("s2-3", 2, 3, ADA, { sprint: 3, kom: 5, finish: "+0:31" }),
  stageRow("s2-4", 2, 4, OSCAR, { sprint: 0, kom: 6, finish: "+0:47" }),
  stageRow("s2-5", 2, 5, MIKKEL, { sprint: 0, kom: 2, finish: "+1:05" }),
  // Etape 2 dag-trøjer — KUMULATIVE totaler (ingen gc/points/mountain/young
  // slut-rækker endnu → race_type stage_race + finalByType.gc tom → siden
  // vælger LiveOverallTab, "stillingen efter etape 2").
  dayRow("l2-1", 2, "leader", 1, LARS, "+0:00"),
  dayRow("l2-2", 2, "leader", 2, ADA, "+0:31"),
  dayRow("l2-3", 2, "leader", 3, FREYA, "+1:18"),
  dayRow("l2-4", 2, "leader", 4, MIKKEL, "+1:09"),
  dayRow("l2-5", 2, "leader", 5, OSCAR, "+1:14"),
  dayRow("p2-1", 2, "points_day", 1, ADA), // sprint total 5+3=8
  dayRow("p2-2", 2, "points_day", 2, LARS), // 2+1=3
  dayRow("p2-3", 2, "points_day", 3, OSCAR), // 1+0=1
  dayRow("p2-4", 2, "points_day", 4, MIKKEL), // 1+0=1
  dayRow("p2-5", 2, "points_day", 5, FREYA), // 0+0=0
  // #3519 kernescenariet: mountain_day rank 1..5 EFTER etape 2 — Lars (etape-
  // vinder begge dage) ligger SIDST (kom-total 2), Freya (ingen etapesejr) er
  // suveræn 1'er (kom-total 18). Pointkolonnen (denne PR) forklarer hvorfor.
  dayRow("m2-1", 2, "mountain_day", 1, FREYA), // 8+10=18
  dayRow("m2-2", 2, "mountain_day", 2, OSCAR), // 4+6=10
  dayRow("m2-3", 2, "mountain_day", 3, ADA), // 3+5=8
  dayRow("m2-4", 2, "mountain_day", 4, MIKKEL), // 1+2=3
  dayRow("m2-5", 2, "mountain_day", 5, LARS), // 0+2=2
  dayRow("y2-1", 2, "young_day", 1, LARS, "+0:00"),
];

// Sub-2 (#2770): waypoint-passager for etape 2 — KOM + mellemsprint, samme
// data der driver AC1 (point pr. waypoint på etape-resultatsiden).
const PASSAGES = [
  { id: "p-kom-1", stage_number: 2, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col du Test", waypoint_km: 90, climb_category: "1", rider_id: FREYA.id, rider_name: "Freya Olsen", team_id: FREYA.team.id, passage_rank: 1, points: 6, bonus_seconds: 0 },
  { id: "p-kom-2", stage_number: 2, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col du Test", waypoint_km: 90, climb_category: "1", rider_id: OSCAR.id, rider_name: "Oscar Berg", team_id: OSCAR.team.id, passage_rank: 2, points: 4, bonus_seconds: 0 },
  { id: "p-kom-3", stage_number: 2, waypoint_kind: "kom", waypoint_index: 0, waypoint_name: "Col du Test", waypoint_km: 90, climb_category: "1", rider_id: ADA.id, rider_name: "Ada Pedersen", team_id: ADA.team.id, passage_rank: 3, points: 2, bonus_seconds: 0 },
  { id: "p-sprint-1", stage_number: 2, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Sprint E2E", waypoint_km: 45, climb_category: null, rider_id: ADA.id, rider_name: "Ada Pedersen", team_id: ADA.team.id, passage_rank: 1, points: 5, bonus_seconds: 3 },
  { id: "p-sprint-2", stage_number: 2, waypoint_kind: "sprint", waypoint_index: 0, waypoint_name: "Sprint E2E", waypoint_km: 45, climb_category: null, rider_id: LARS.id, rider_name: "Lars Nielsen", team_id: LARS.team.id, passage_rank: 2, points: 3, bonus_seconds: 0 },
];

// Mønster fra tests/e2e/training-race-day.spec.js (#3459): på mobil bruges et
// manuelt page.screenshot({clip}) i stedet for element.screenshot() — sidstnævnte
// viste sig at fange et FORKERT/stale compositor-frame på det emulerede mobil-
// viewport her (verificeret ved en debug-boundingBox der matchede layoutet 1:1,
// mens element.screenshot() alligevel klippede naboafsnittet med) — samme
// pixel-klip page.screenshot() bruger internt, men uden den ekstra interne
// re-scroll locator.screenshot() foretager.
async function screenshotSection(page, section, screenshotPath) {
  await section.scrollIntoViewIfNeeded();
  const box = await section.boundingBox();
  const viewportSize = page.viewportSize();
  const clip = {
    x: Math.max(0, box.x),
    y: Math.max(0, box.y),
    width: Math.min(box.width, viewportSize.width - Math.max(0, box.x)),
    height: Math.min(box.height, viewportSize.height - Math.max(0, box.y)),
  };
  await page.screenshot({ path: screenshotPath, clip });
}

async function mockRace(page) {
  await page.route("**/rest/v1/races**", route => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", raceResultsRoute(RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, STAGE_PROFILES));
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, PASSAGES));
}

test("#3519 waypoint-point synlige på etape-resultatsiden", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockRace(page);
  await login(page);
  await page.goto("/races/race-e2e-3519");

  // #3519 note: race.status="scheduled" (live etapeløb, #2637-konventionen) gør
  // at BÅDE den kommende-etape-vælger (holdudtagelse) OG resultat-striben viser
  // "Etape 2"-knapper — nth(1) er resultat-striben (renderes efter holdudtagelses-
  // blokken i JSX, samme rækkefølge som #2637-panelet ovenfor på siden).
  await page.getByRole("button", { name: "Etape 2" }).nth(1).click();

  const passageHeading = page.getByText("Mellemresultater", { exact: true });
  const passageSection = passageHeading.locator("xpath=ancestor::*[contains(@class,'bg-cz-card')][1]");
  await expect(passageHeading).toBeVisible();
  await expect(passageSection.getByText("Col du Test (kat. 1) — km 90")).toBeVisible();
  await expect(passageSection.getByText("Sprint E2E — km 45")).toBeVisible();
  // Rytter + point pr. waypoint — netop det AC1 efterspørger ("hvem tog hvad ved hvilken stigning/sprint").
  await expect(passageSection.getByText("Freya Olsen")).toBeVisible();
  await expect(passageSection.getByText("6 point")).toBeVisible();
  await expect(passageSection.getByText("5 point")).toBeVisible();

  await page.addStyleTag({ content: "nav.fixed.bottom-0 { display: none !important; }" });
  const isMobile = testInfo.project.name.startsWith("mobile");
  if (testInfo.project.name === "mobile-webkit") return; // ét skud pr. viewport-klasse er nok (samme mønster som #3459)
  const screenshotPath = evidenceShotPath(`pr-screens/3519-waypoint-points-${isMobile ? "mobile" : "desktop"}.png`);
  await screenshotSection(page, passageSection, screenshotPath);
});

test("#3519 løbende bjerg-/pointkonkurrence synlig mens etapeløbet er i gang", async ({ page }, testInfo) => {
  await stabilizePage(page);
  await installNetworkMocks(page);
  await mockRace(page);
  await login(page);
  await page.goto("/races/race-e2e-3519");

  // "Samlet"-fanen er default — LiveOverallTab (ingen gc-slutrækker endnu).
  await expect(page.getByText("Stillingen efter 2. etape")).toBeVisible();
  const mountainHeading = page.getByRole("heading", { name: "Bjergkonkurrence" });
  const mountainSection = mountainHeading.locator("xpath=ancestor::*[contains(@class,'bg-cz-card')][1]");
  await expect(mountainHeading).toBeVisible();

  // #3519 kernen: Freya (18 point) topper bjergkonkurrencen, Lars (etape-
  // vinder begge dage, kun 2 point) ligger sidst — nu SYNLIGT, ikke kun rang.
  await expect(mountainSection.getByText("Freya Olsen")).toBeVisible();
  await expect(mountainSection.getByText("18 point")).toBeVisible();
  await expect(mountainSection.getByText("Lars Nielsen")).toBeVisible();
  await expect(mountainSection.getByText("2 point")).toBeVisible();

  await page.addStyleTag({ content: "nav.fixed.bottom-0 { display: none !important; }" });
  const isMobile = testInfo.project.name.startsWith("mobile");
  if (testInfo.project.name === "mobile-webkit") return;
  const screenshotPath = evidenceShotPath(`pr-screens/3519-live-standings-${isMobile ? "mobile" : "desktop"}.png`);
  await screenshotSection(page, mountainSection, screenshotPath);
});
