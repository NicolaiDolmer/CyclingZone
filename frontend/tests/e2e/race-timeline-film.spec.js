import { test, expect } from "@playwright/test";
import { installNetworkMocks, login, stabilizePage, json } from "./fixtures.js";
import { MOUNTAIN_TIMELINE, MOUNTAIN_STAGE_PROFILE } from "../../src/lib/stageTimelineFixtures.js";

// #3859 (bølge 2 — løbsfilm-afspiller + "The story of the stage", EFTER-
// tilstanden). Mocker spec §2.4's afspilnings-API (`GET /api/races/:raceId/
// timeline?stage=N`) direkte via page.route — backend-API'et (#3860) bygges
// PARALLELT i en anden worktree, så disse tests kalder ALDRIG det ægte
// endpoint. Verificerer: story-sektionen renderer 3-5 kuraterede events,
// afspilleren åbner, feedet følger scrubberen (fri scrubbing), og et løb uden
// tidslinje-data degraderer ærligt til INTET (404 → ingen sektion, ingen knap).

const RACE = {
  id: "race-timeline-1",
  name: "Film E2E Tour",
  race_type: "stage_race",
  race_class: "TourFrance",
  stages: 1,
  edition_year: 2026,
  status: "completed",
  season: { id: "season-timeline-e2e", number: 1 },
  pool_race: null,
};

function rider(id, first, last) {
  return { id, firstname: first, lastname: last, nationality_code: "dk", team: { id: "team-x", name: "Team X" } };
}
const ADA = rider("rider-1", "Ada", "Pedersen");
const MIK = rider("rider-2", "Mikkel", "Hansen");
const SOFIE = rider("rider-3", "Sofie", "Lund");
const JONAS = rider("rider-4", "Jonas", "Berg");
const ELIN = rider("rider-5", "Elin", "Aas");

function row(id, rank, r, finish_time) {
  return {
    id, stage_number: 1, result_type: "stage", rank,
    rider_id: r.id, rider_name: `${r.firstname} ${r.lastname}`,
    team_id: r.team.id, team_name: r.team.name,
    finish_time, points_earned: 0, prize_money: 0, rider: r,
    in_breakaway: false, breakaway_caught: false,
  };
}

// Fem ryttere så riderNameById-opslaget dækker alle rider_ids i fixture-
// tidslinjen (rider-1..rider-5, samme roster som stageTimelineFixtures.js).
const RESULTS = [
  row("r1", 1, ADA, "+0:00"),
  row("r2", 2, ELIN, "+0:18"),
  row("r3", 3, MIK, "+0:30"),
  row("r4", 4, SOFIE, "+0:35"),
  row("r5", 5, JONAS, "+1:10"),
];

// Samme fixture som unit-tests (stageTimelineStory.test.js/stageTimelineFilm.
// test.js) — stage_number overstyres til 1 så den matcher det étetapes-løb
// e2e-fixturet her bruger.
const TIMELINE = { ...MOUNTAIN_TIMELINE, stage_number: 1 };
// Ejer-fix 17/8: scrubberen skal tegne den ÆGTE rute-silhuet — mock derfor
// race_stage_profiles med rigtige climbs (crest_km/kategori/distance) i
// stedet for en tom liste, ellers falder StageFilmScrubber tilbage til den
// simple km-akse og testen dækker aldrig silhuet-stien.
const PROFILE = { ...MOUNTAIN_STAGE_PROFILE, stage_number: 1 };

async function mockRace(page, { withTimeline = true, withProfile = true } = {}) {
  await stabilizePage(page);
  await installNetworkMocks(page);

  await page.route("**/rest/v1/races**", route => {
    const wantsObject = (route.request().headers().accept || "").includes("vnd.pgrst.object");
    return json(route, wantsObject ? RACE : [RACE]);
  });
  await page.route("**/rest/v1/race_results**", route => json(route, RESULTS));
  await page.route("**/rest/v1/race_stage_profiles**", route => json(route, withProfile ? [PROFILE] : []));
  await page.route("**/rest/v1/race_stage_passages**", route => json(route, []));

  if (withTimeline) {
    await page.route("**/api/races/*/timeline**", route => json(route, TIMELINE));
  } else {
    // #3859: 404 (ingen tidslinje for dette løb/denne etape endnu, spec §4
    // valg 3A forward-only) — useStageTimeline degraderer til null.
    await page.route("**/api/races/*/timeline**", route =>
      route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ error: "not_found" }) }));
  }

  await login(page);
}

test("story of the stage renders curated events + gold watch-film button", async ({ page }) => {
  await mockRace(page);
  await page.goto("/races/race-timeline-1?stage=1");

  await expect(page.getByRole("heading", { name: "Etape 1" })).toBeVisible();
  await expect(page.getByText("Etapens historie")).toBeVisible();

  // Kuraterings-logikken (stageTimelineStory.js) vælger finish/finale_attack/
  // favorite_crack/breakaway_caught/breakaway_formed for denne fixture (se
  // stageTimelineStory.test.js) — ikke de lavvægtede kom_passage/stage_start.
  await expect(page.getByText("Ada Pedersen angriber i finalen.")).toBeVisible();
  await expect(page.getByText("Jonas Berg sprækker og mister kontakten til front.")).toBeVisible();
  await expect(page.getByText("Ada Pedersen soloer til etapesejr.")).toBeVisible();

  await expect(page.getByRole("button", { name: "Se løbsfilmen" })).toBeVisible();
});

test("race film opens and the event feed follows the scrubber", async ({ page }) => {
  await mockRace(page);
  await page.goto("/races/race-timeline-1?stage=1");

  await page.getByRole("button", { name: "Se løbsfilmen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Løbsfilm" })).toBeVisible();

  const scrubber = dialog.getByRole("slider", { name: "Scrub gennem etapen" });
  await expect(scrubber).toBeVisible();

  // Helt i bunden af scrubberen (km 0): kun stage_start er "afspillet". Scopet
  // til dialogen — "The story of the stage" bag modalen viser ALTID finish-
  // eventet statisk, uafhængigt af scrubberen, så en usscoped tekst-assertion
  // ville false-positive matche den i stedet for feedet.
  await scrubber.fill("0");
  await expect(dialog.getByText("142 ryttere ruller ud på 168 km.")).toBeVisible();
  await expect(dialog.getByText("Ada Pedersen soloer til etapesejr.")).toHaveCount(0);

  // Scrub helt til målstregen: hele feedet (inkl. finish) er nu afspillet —
  // beviser at feedet er en FUNKTION af scrub-positionen, ikke en fast liste.
  await scrubber.fill("168");
  await expect(dialog.getByText("Ada Pedersen soloer til etapesejr.")).toBeVisible();
  await expect(dialog.getByText("Mikkel Hansen, Sofie Lund rykker væk fra feltet.")).toBeVisible();
});

test("race without timeline data renders nothing (404 degrades honestly)", async ({ page }) => {
  await mockRace(page, { withTimeline: false });
  await page.goto("/races/race-timeline-1?stage=1");

  await expect(page.getByRole("heading", { name: "Etape 1" })).toBeVisible();
  await expect(page.getByText("Etapens historie")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Se løbsfilmen" })).toHaveCount(0);
});

// Ejer-fix 17/8: scrubberen skal tegne etapens ÆGTE rute-silhuet (climbs fra
// race_stage_profiles), ikke en flad skema-linje.
test("race film draws the real route silhouette with climb chips anchored on it", async ({ page }) => {
  await mockRace(page);
  await page.goto("/races/race-timeline-1?stage=1");

  await page.getByRole("button", { name: "Se løbsfilmen" }).click();
  const dialog = page.getByRole("dialog");
  const svgs = dialog.locator("svg");
  await expect(svgs.first()).toBeVisible();

  // Kategori-chippene (kategori + navn) er ANKRET på silhuetten, samme
  // visuelle sprog som rute-kortet (StageProfileGraph) — ikke fritsvævende
  // trekanter.
  await expect(dialog.getByText("COL DU TEST", { exact: true })).toBeVisible();
  await expect(dialog.getByText("MONT FIXTURE", { exact: true })).toBeVisible();
});

// Ejer-fix 17/8, punkt 5: legacy-etaper uden rutedata falder tilbage til den
// simple km-akse — fallback, ikke standard, men skal stadig virke.
test("stage without route data falls back to the simple km axis, feed still works", async ({ page }) => {
  await mockRace(page, { withProfile: false });
  await page.goto("/races/race-timeline-1?stage=1");

  await page.getByRole("button", { name: "Se løbsfilmen" }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByRole("heading", { name: "Løbsfilm" })).toBeVisible();

  const scrubber = dialog.getByRole("slider", { name: "Scrub gennem etapen" });
  await scrubber.fill("168");
  await expect(dialog.getByText("Ada Pedersen soloer til etapesejr.")).toBeVisible();
  // Ingen klima-chips uden rutedata (fallback-stien tegner ikke silhuet-navne).
  await expect(dialog.getByText("COL DU TEST", { exact: true })).toHaveCount(0);
});
