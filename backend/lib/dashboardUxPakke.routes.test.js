import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #2288 Slice A + G — dashboard-ux-pakke.
//
// A. /api/me/onboarding-progress skal måle 4 ÆGTE spiller-handlinger, ikke
//    trin der er completed fra start (team_named/first_rider_owned var altid
//    sande for enhver ny manager). Tests scanner kildeteksten (samme mønster
//    som boardBankGuard.routes.test.js) så en regression fanges uden en live
//    DB/supertest-harness.
// G. /api/dashboard/recent-results skal filtrere på managerens egen
//    league_division_id (mønster: nextRaces-queryen i DashboardPage.jsx).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker, len = 2500) {
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i api.js`);
  return apiSource.slice(start, start + len);
}

test("onboarding-progress: de 4 ægte trin-nøgler er til stede", () => {
  const block = routeBlock('router.get("/me/onboarding-progress"');
  for (const key of ["first_bid_placed", "first_training_run", "first_squad_selected", "board_plan_set"]) {
    assert.match(block, new RegExp(`key:\\s*"${key}"`), `steps skal indeholde "${key}"`);
  }
  // De gamle altid-sande trin må IKKE være tilbage.
  assert.doesNotMatch(block, /"team_named"/, "team_named var altid completed fra start — skal være fjernet");
  assert.doesNotMatch(block, /"first_rider_owned"/, "first_rider_owned var altid completed fra start — skal være fjernet");
});

test("onboarding-progress: first_squad_selected querier race_entries med is_auto_filled=false (samme kilde som RaceSelectionPanel/saveSelection)", () => {
  const block = routeBlock('router.get("/me/onboarding-progress"');
  assert.match(
    block,
    /\.from\("race_entries"\)[\s\S]*?\.eq\("team_id",\s*teamId\)[\s\S]*?\.eq\("is_auto_filled",\s*false\)/,
    "first_squad_selected skal tælle race_entries-rækker med is_auto_filled=false for holdet",
  );
});

test("onboarding-progress: board_plan_set kræver negotiation_status='completed' (ikke bare 'findes en board_profiles-række', som er auto-seedet ved sæson-start)", () => {
  const block = routeBlock('router.get("/me/onboarding-progress"');
  assert.match(
    block,
    /\.from\("board_profiles"\)[\s\S]*?\.eq\("team_id",\s*teamId\)[\s\S]*?\.eq\("negotiation_status",\s*"completed"\)/,
    "board_plan_set skal filtrere på negotiation_status='completed'",
  );
});

// #2439: onboarding-progress-kortet re-triggerede for etablerede spillere,
// fordi dismiss var session-scopet (sessionStorage, #1569) — completed_count
// nåede aldrig total_count for veteraner der fx altid bruger squad-auto-fill,
// så kortet dukkede op igen ved hver ny fane/browser/enhed. Fix: server-
// persisteret dismiss (teams.onboarding_progress_dismissed_at) + en
// "etableret hold"-auto-heuristik der skjuler kortet uden krav om et klik.
test("onboarding-progress: GET returnerer server-persisteret dismissed + established (ikke kun completed_count)", () => {
  const block = routeBlock('router.get("/me/onboarding-progress"', 4000);
  assert.match(block, /onboarding_progress_dismissed_at/, "skal læse teams.onboarding_progress_dismissed_at");
  assert.match(block, /dismissed\s*=\s*Boolean\(/, "dismissed skal afledes af den persisterede kolonne, ikke kun frontend-state");
  assert.match(block, /established\s*=\s*isEstablishedTeam\(/, "established skal komme fra en hold-alder-heuristik");
  assert.match(block, /steps,\s*completed_count,\s*total_count:\s*steps\.length,\s*dismissed,\s*established/, "response skal inkludere dismissed+established ved siden af steps");
});

test("onboarding-progress: isEstablishedTeam bruger teams.created_at-alder (ikke completed_count) til at afgøre 'etableret'", () => {
  assert.match(
    apiSource,
    /function isEstablishedTeam\(team\)[\s\S]{0,300}created_at/,
    "isEstablishedTeam skal basere sig på team.created_at, uafhængigt af step-completion",
  );
});

test("POST /me/onboarding-progress/dismiss persisterer server-side og degraderer gracefully hvis kolonnen mangler (42703)", () => {
  const block = routeBlock('router.post("/me/onboarding-progress/dismiss"', 1200);
  assert.match(block, /\.from\("teams"\)/, "skal opdatere teams-tabellen");
  assert.match(block, /onboarding_progress_dismissed_at:\s*new Date\(\)\.toISOString\(\)/, "skal sætte dismiss-timestamp");
  assert.match(block, /error\.code\s*!==\s*"42703"/, "skal tåle en manglende onboarding_progress_dismissed_at-kolonne uden 500");
});

test("training/today-status: querier kun training_day_runs på team_id + tick_date (letvægts, ingen rider/condition-joins)", () => {
  const block = routeBlock('router.get("/training/today-status"');
  assert.match(block, /\.from\("training_day_runs"\)/);
  assert.match(block, /\.eq\("team_id",\s*req\.team\.id\)/);
  assert.match(block, /\.eq\("tick_date",\s*todayDate\)/);
  assert.doesNotMatch(block, /rider_condition|rider_derived_abilities/, "endpointet skal IKKE joine condition/progress — det er /api/training/me's job");
});

test("recent-results: races-query filtrerer på req.team.league_division_id (#2288 G)", () => {
  const block = routeBlock('router.get("/dashboard/recent-results"');
  assert.match(
    block,
    /req\.team\.league_division_id[\s\S]*?\.eq\("league_division_id",\s*req\.team\.league_division_id\)/,
    "recent-results skal betinget filtrere races på holdets league_division_id",
  );
});

test("recent-results: cache-keyExtras skelner mellem divisioner (ellers deler alle divisioner samme cache-entry)", () => {
  const block = routeBlock('router.get("/dashboard/recent-results"');
  assert.match(
    block,
    /keyExtras:\s*\(req\)\s*=>\s*String\(req\.team\?\.league_division_id/,
    "cached()-wrapperen skal have keyExtras der inkluderer league_division_id",
  );
});

// #2328 — rider-ranking hentede FØR ALLE sæsonens løb på tværs af samtlige ~15
// puljer (423 løb / ~125k race_results-rækker i prod) via fetchAllRows' side-
// for-side paginering, hvilket timede stille ud på Railway og lod ranglisten
// forblive tom uden synlig fejl. Samme division-filter som recent-results (#2288
// G) begrænser datasættet til managerens egen pulje.
test("rider-ranking: races-query filtrerer på req.team.league_division_id (#2328, samme mønster som recent-results #2288 G)", () => {
  const block = routeBlock('router.get("/dashboard/rider-ranking"');
  assert.match(
    block,
    /req\.team\.league_division_id[\s\S]*?\.eq\("league_division_id",\s*req\.team\.league_division_id\)/,
    "rider-ranking skal betinget filtrere races på holdets league_division_id",
  );
});

test("rider-ranking: cache-keyExtras skelner mellem divisioner", () => {
  const block = routeBlock('router.get("/dashboard/rider-ranking"');
  assert.match(
    block,
    /keyExtras:\s*\(req\)\s*=>\s*String\(req\.team\?\.league_division_id/,
    "cached()-wrapperen skal have keyExtras der inkluderer league_division_id",
  );
});

test("rider-ranking: seasons/races Supabase-fejl kastes (throw), ikke tavst || []", () => {
  const block = routeBlock('router.get("/dashboard/rider-ranking"');
  assert.match(block, /seasonError/, "season-queryen skal tjekke error og kaste");
  assert.match(block, /racesError/, "races-queryen skal tjekke error og kaste");
});

// #2593 (del 2) — "Nyt"-badget på MyLatestResultCard brugte localStorage
// (nulstiller sig pr. enhed/browser; 54,9% af besøg er mobil). Fix:
// server-persisteret seen-flag (teams.my_result_seen_race_id), samme mønster
// som teams.onboarding_progress_dismissed_at (#2439).
test("my-latest-result: GET inkluderer race.seen afledt af teams.my_result_seen_race_id (ingen ekstra roundtrip for at læse status)", () => {
  const block = routeBlock('router.get("/dashboard/my-latest-result"', 5000);
  assert.match(
    block,
    /seen:\s*raceId\s*===\s*req\.team\.my_result_seen_race_id/,
    "race-objektet i GET-responsen skal inkludere et seen-felt afledt af den persisterede kolonne",
  );
});

test("POST /dashboard/my-latest-result/seen: team udledes udelukkende server-side (req.team), ikke fra request-body", () => {
  const block = routeBlock('router.post("/dashboard/my-latest-result/seen"', 1800);
  assert.match(block, /if \(!req\.team\)/, "skal afvise uden hold (samme guard som naboendpoints)");
  assert.match(block, /\.eq\("team_id",\s*req\.team\.id\)/, "ownership-check skal filtrere på req.team.id, ikke et body-felt");
  assert.match(block, /\.eq\("id",\s*req\.team\.id\)/, "UPDATE på teams skal ramme req.team.id");
});

test("POST /dashboard/my-latest-result/seen: validerer race_id mod holdets EGNE race_results FØR skrivning (kan ikke markere et vilkårligt løb som set)", () => {
  const block = routeBlock('router.post("/dashboard/my-latest-result/seen"', 1800);
  assert.match(
    block,
    /\.from\("race_results"\)[\s\S]*?\.eq\("race_id",\s*raceId\)[\s\S]*?\.eq\("team_id",\s*req\.team\.id\)/,
    "skal tjekke at holdet reelt har en race_results-række for det race_id der markeres set",
  );
  assert.match(block, /if \(!ownRow\)\s*return res\.status\(404\)/, "manglende ejerskab skal give 404, ikke stille skrive kolonnen");
});

test("POST /dashboard/my-latest-result/seen: idempotent UPDATE persisterer my_result_seen_race_id og degraderer gracefully hvis kolonnen mangler (42703)", () => {
  const block = routeBlock('router.post("/dashboard/my-latest-result/seen"', 1800);
  assert.match(block, /\.from\("teams"\)/, "skal opdatere teams-tabellen");
  assert.match(block, /my_result_seen_race_id:\s*raceId/, "skal sætte my_result_seen_race_id til det validerede race_id");
  assert.match(block, /error\.code\s*!==\s*"42703"/, "skal tåle en manglende my_result_seen_race_id-kolonne uden 500");
  assert.match(
    block,
    /invalidateNamespace\("dashboard-my-latest-result"\)/,
    "POST skal invalidere GET-cachen (TTL 60s) — ellers serveres seen:false op til 60s efter markering og badgen genopstår ved reload",
  );
});
