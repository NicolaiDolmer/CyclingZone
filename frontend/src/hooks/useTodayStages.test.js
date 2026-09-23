import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #4378 (opdateret #5589): race_results-selecten manglede finish_time.
// deriveTeamStandings (raceLiveStandings.js) bruger r.finish_time til at
// beregne hvert holds GC-gap (parseGapSeconds); uden kolonnen bliver
// finish_time altid undefined, parseGapSeconds returnerer 0 for alle rækker,
// alle holds "total" bliver 0, og sorteringen falder tilbage til alfabetisk
// team_id-sammenligning i stedet for den reelle stilling. Symptom set af
// ejeren: dashboardets "dagens etaper" viste en helt forkert GC-placering.
// Fixture-rækkerne i dashboardTodayStages.test.js/raceLiveStandings.test.js
// inkluderer selv finish_time og fanger derfor IKKE denne regression — kun
// selve fetch-callet kan. Samme kilde-regex-mønster som
// App.racesLegacyRedirect.test.js (hooket trækker React+Supabase ind og er
// ikke egnet til en almindelig unit-test-import).
//
// #5589: hooket har siden PostgREST's 1.000-rækkers-loft blev fanget i prod
// fået TO afgrænsede race_results-forespørgsler i stedet for én ubegrænset —
// en vinder-forespørgsel (rank=1 stage-resultater) og en placerings-
// forespørgsel pr. eget etapeløb (leader/team-resultater for den ene
// aktuelle etape). Disse kilde-læsende tests holder begge forespørgslers
// afgrænsende filtre fast, så ingen af dem regredierer til den ubegrænsede
// form der ramte 92 af dagens 254 hold 23/9.

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(__dirname, "useTodayStages.js"), "utf8");

test("#4378/#5589 useTodayStages: placerings-forespørgslen henter finish_time (deriveTeamStandings' GC-gap-input)", () => {
  const match = hookSource.match(
    /supabase\.from\("race_results"\)\s*\n\s*\.select\("([^"]*)"\)\s*\n\s*\.eq\("race_id", race\.id\)\s*\n\s*\.eq\("stage_number", race\.stages_completed\)/,
  );
  assert.ok(match, "kunne ikke finde placerings-forespørgslen (.eq(\"stage_number\", race.stages_completed)) i useTodayStages.js");
  const selectedColumns = match[1].split(",").map((c) => c.trim());
  assert.ok(
    selectedColumns.includes("finish_time"),
    `placerings-forespørgslens select mangler finish_time — deriveTeamStandings' parseGapSeconds(r.finish_time) vil altid returnere 0, og "dagens etaper" viser alfabetisk rækkefølge i stedet for reel GC-stilling (#4378). Fundne kolonner: ${selectedColumns.join(", ")}`,
  );
});

test("#5589 useTodayStages: vinder-forespørgslen er afgrænset til rank=1 OG dagens etapenumre", () => {
  const match = hookSource.match(
    /supabase\.from\("race_results"\)\s*\n\s*\.select\("([^"]*)"\)\s*\n\s*\.in\("race_id", ownRaceIds\)\s*\n\s*\.in\("stage_number", todayStageNumbers\)\s*\n\s*\.eq\("result_type", "stage"\)\s*\n\s*\.eq\("rank", 1\)/,
  );
  assert.ok(
    match,
    "vinder-forespørgslen skal have BÅDE .in(\"stage_number\", todayStageNumbers) OG .eq(\"rank\", 1) — uden dem henter den igen hele feltets rækker og rammer PostgREST's 1.000-rækkers-loft (#5589)",
  );
});

test("#5589 useTodayStages: placerings-forespørgslen er afgrænset pr. løb til dets aktuelle etape", () => {
  assert.match(
    hookSource,
    /\.eq\("stage_number", race\.stages_completed\)/,
    "placerings-forespørgslen skal have .eq(\"stage_number\", race.stages_completed) — uden den henter den alle etaper for løbet, ikke kun den aktuelle (#5589)",
  );
});

test("#5589 regression guard: ingen race_results-forespørgsel er kun afgrænset af race_id og result_type", () => {
  const RACE_RESULTS_CALL = 'supabase.from("race_results")';
  const positions = [];
  let idx = hookSource.indexOf(RACE_RESULTS_CALL);
  while (idx !== -1) {
    positions.push(idx);
    idx = hookSource.indexOf(RACE_RESULTS_CALL, idx + 1);
  }
  assert.ok(
    positions.length >= 2,
    `forventede mindst 2 race_results-forespørgsler (vinder + placering pr. løb), fandt ${positions.length}`,
  );
  for (let i = 0; i < positions.length; i++) {
    const pos = positions[i];
    // Slut blokken ved starten af NÆSTE .from("race_results")-kald (eller
    // filens slutning) — IKKE et fast tegn-vindue. Et fast vindue kan nå ind
    // i den EFTERFØLGENDE forespørgsels filtre og fejlagtigt "låne" dens
    // rank/stage_number-filter til denne, så guarden lukker en reelt
    // ubegrænset forespørgsel igennem (CodeRabbit, denne PR).
    const end = i + 1 < positions.length ? positions[i + 1] : hookSource.length;
    const block = hookSource.slice(pos, end);
    const hasStageNumberFilter = /\.(?:eq|in)\("stage_number"/.test(block);
    const hasRankFilter = /\.eq\("rank"/.test(block);
    assert.ok(
      hasStageNumberFilter || hasRankFilter,
      `race_results-forespørgsel er kun afgrænset af race_id/result_type uden et rank- eller stage_number-filter — det er PRÆCIS den form der ramte PostgREST's 1.000-rækkers-loft (#5589): ${block.slice(0, 200)}`,
    );
  }
});
