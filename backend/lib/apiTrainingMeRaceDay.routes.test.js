import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

// #3459 V3 — GET /api/training/me's racingToday-felt (løbsdags-badge på
// trænings-siden). Kildeteksten scannes (samme mønster som dashboardUxPakke.
// routes.test.js/boardBankGuard.routes.test.js) — reelle query/fail-safe-tests
// mod en fake supabase-client bor i racingTodayLookup.test.js, dette dækker KUN
// route-wiring: flag-gating (bygger på RACE_DAY_ENGINE_FLAG_KEY, ikke en ny
// config-vej) og at feltet udelades helt (ikke bare tomt) når flaget er off.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker, len = 6500) {
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i api.js`);
  return apiSource.slice(start, start + len);
}

test("api.js importerer racingToday-lookuppet + genbruger race_day_engine_enabled-flaget (ikke en ny config-vej)", () => {
  assert.match(
    apiSource,
    /import \{ RACE_DAY_ENGINE_FLAG_KEY \} from "\.\.\/lib\/raceDayEngineFlag\.js"/,
    "skal genbruge samme flag-nøgle som dailyTrainingEngine.js's D1-D4-gate",
  );
  assert.match(
    apiSource,
    /import \{ loadRacingTodayByRider \} from "\.\.\/lib\/racingTodayLookup\.js"/,
  );
});

test("GET /training/me: raceDayEngineOn læses via readFlagStage(RACE_DAY_ENGINE_FLAG_KEY) + evaluateFlagStage (samme mønster som 'enabled')", () => {
  const block = routeBlock('router.get("/training/me"');
  assert.match(block, /readFlagStage\(supabase, RACE_DAY_ENGINE_FLAG_KEY\)/);
  assert.match(block, /const raceDayEngineOn = evaluateFlagStage\(raceDayStage, \{ isBetaTester \}\)/);
});

test("GET /training/me: racingToday-loaderen kaldes KUN når raceDayEngineOn (flag off = ingen ekstra DB-kald, bit-identisk)", () => {
  const block = routeBlock('router.get("/training/me"');
  assert.match(
    block,
    /raceDayEngineOn \? loadRacingTodayByRider\(supabase, teamId, riderIds, new Date\(\)\) : Promise\.resolve\(\{\}\)/,
  );
});

test("GET /training/me: racingToday-feltet spredes KUN ind i responsen når raceDayEngineOn (udeladt helt, ikke tomt, når flag er off)", () => {
  const block = routeBlock('router.get("/training/me"');
  assert.match(block, /\.\.\.\(raceDayEngineOn \? \{ racingToday \} : \{\}\)/);
  // Feltet må ALDRIG stå ubetinget i res.json — det ville lække et tomt/delvist
  // racingToday-objekt til klienter med flaget off.
  assert.doesNotMatch(block, /res\.json\(\{[\s\S]{0,600}racingToday,[\s\S]{0,200}\}\);/);
});
