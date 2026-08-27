import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #4245 forward-guard: sæson-belastningens LØBSDAGE må aldrig igen afledes af
// races.stages (etapetal). Kilde-scan efter samme mønster som
// riderPeakPlans.routes.test.js — låser wiringen i routes/api.js, så etape-tallet
// ikke kan snige sig tilbage i belastnings-blokken uden at CI råber.
// SSOT for reglen: docs/CALENDAR_RULES.md §0 (game_day og scheduled_at er to
// uafhængige akser) + §2b (bindingen sker pr. løbsdag, ikke pr. kalenderdag).

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
    /seasonLoadByRider\(\{\s*entries: teamEntries \|\| \[\], raceDaysByRaceId \}\)/,
    "belastningen skal bygges af den rene helper med de eligibility-krydsede entries (#1906)"
  );
  assert.doesNotMatch(
    block,
    /raceDays\s*\+=/,
    "belastnings-løkken skal bo i den testbare lib-helper, ikke inline i handleren"
  );
  assert.doesNotMatch(
    block,
    /stagesByRaceId/,
    "etape-antallet må ALDRIG være kilden til løbsdage (#4245: to etaper på samme game_day er én løbsdag)"
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
});
