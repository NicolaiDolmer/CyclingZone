import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #4245 forward-guard: sæson-belastningens LØBSDAGE må aldrig igen afledes af
// races.stages (etapetal) som PRIMÆR kilde, og chippen der siger "denne sæson"
// må aldrig igen tælle entries fra tidligere sæsoner. Kilde-scan efter samme
// mønster som riderPeakPlans.routes.test.js. Låser wiringen i routes/api.js, så
// hverken etape-tallet eller det manglende sæsonfilter kan snige sig tilbage
// uden at CI råber.
// SSOT for reglen: docs/CALENDAR_RULES.md §0 (game_day og scheduled_at er to
// uafhængige akser) + §2b (bindingen sker pr. løbsdag, ikke pr. kalenderdag).
//
// NB: `stages` er tilladt som FALLBACK for løb helt uden game_day-rækker, men kun
// via den navngivne `stagesByRaceId`-option til raceDaysByRace, så begge flader
// falder ens tilbage (#4245 rework: Race Hub faldt til 1, planneren til etapetal).

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function handlerBlock(marker) {
  const idx = apiSource.indexOf(marker);
  assert.ok(idx !== -1, `${marker} skal findes`);
  const next = apiSource.indexOf("\nrouter.", idx + 1);
  return apiSource.slice(idx, next === -1 ? idx + 4000 : next);
}

test("GET /races/distribution: raceDays kommer fra game_day, ikke fra races.stages (#4245)", () => {
  const block = handlerBlock('router.get("/races/distribution"');
  assert.match(
    block,
    /const raceDaysByRaceId = raceDaysByRace\(schedRows/,
    "løbsdage skal afledes af schedRows (allerede hentet MED game_day) via raceDaysByRace"
  );
  assert.match(
    block,
    /seasonLoadByRider\(\{\s*entries: teamEntries \|\| \[\],\s*raceDaysByRaceId,/,
    "belastningen skal bygges af den rene helper med de eligibility-krydsede entries (#1906)"
  );
  assert.match(
    block,
    /seasonRaceIds: new Set\(raceIds\)/,
    "chippen siger 'tilmeldt denne sæson', så entries SKAL sæson-scopes (#4245 rework: 73 % af entries i prod var fra tidligere sæsoner)"
  );
  assert.doesNotMatch(
    block,
    /raceDays\s*\+=/,
    "belastnings-løkken skal bo i den testbare lib-helper, ikke inline i handleren"
  );
  assert.match(
    block,
    /raceDaysByRace\(schedRows \|\| \[\], \{\s*stagesByRaceId:/,
    "etapetallet må kun bruges som det FÆLLES fallback via raceDaysByRace, aldrig som primær kilde (#4245)"
  );
});

test("GET /peak-plans/board: racesOut sender raceDays pr. løb, ikke kun stages (#4245)", () => {
  const block = handlerBlock('router.get("/peak-plans/board"');
  assert.match(
    block,
    /const raceDaysByRaceId = raceDaysByRace\(scheduleRows/,
    "planner-boardet skal aflede løbsdage af de allerede hentede scheduleRows"
  );
  assert.match(
    block,
    /raceDays: raceDaysByRaceId\.get\(e\.id\)/,
    "hvert løb i payloaden skal bære raceDays, så formplanens chip ikke regner etaper klient-side"
  );
  assert.match(
    block,
    /raceDaysByRace\(scheduleRows \|\| \[\], \{\s*stagesByRaceId:/,
    "planneren skal bruge SAMME fallback-kilde som Race Hub'en, ellers divergerer de to chips igen (#4245 rework)"
  );
  assert.doesNotMatch(
    block,
    /raceDays: raceDaysByRaceId\.get\(e\.id\) \?\? e\.stages/,
    "fallbacket skal bo i raceDaysByRace, ikke som en egen gren her (det var kilden til divergensen)"
  );
});
