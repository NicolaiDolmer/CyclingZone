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
