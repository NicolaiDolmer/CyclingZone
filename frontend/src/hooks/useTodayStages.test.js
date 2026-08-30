import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// #4378: race_results-selecten i useTodayStages.js manglede finish_time.
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

const __dirname = dirname(fileURLToPath(import.meta.url));
const hookSource = readFileSync(join(__dirname, "useTodayStages.js"), "utf8");

test("#4378 useTodayStages: race_results-selecten henter finish_time (deriveTeamStandings' GC-gap-input)", () => {
  const match = hookSource.match(/supabase\.from\("race_results"\)\s*\n\s*\.select\("([^"]*)"\)/);
  assert.ok(match, "kunne ikke finde race_results-selecten i useTodayStages.js");
  const selectedColumns = match[1].split(",").map((c) => c.trim());
  assert.ok(
    selectedColumns.includes("finish_time"),
    `race_results-selecten mangler finish_time — deriveTeamStandings' parseGapSeconds(r.finish_time) vil altid returnere 0, og "dagens etaper" viser alfabetisk rækkefølge i stedet for reel GC-stilling (#4378). Fundne kolonner: ${selectedColumns.join(", ")}`,
  );
});
