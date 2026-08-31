import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readFlagStage, evaluateFlagStage } from "./featureStage.js";
import { RACE_DAY_DEVELOPMENT_FLAG_KEY } from "./raceDayDevelopmentFlag.js";
import { RACE_DAY_ENGINE_FLAG_KEY } from "./raceDayEngineFlag.js";

// #3459 V3 / #4375: GET /api/training/me's racingToday-felt (løbsdags-badge på
// trænings-siden). Kildeteksten scannes (samme mønster som dashboardUxPakke.
// routes.test.js/boardBankGuard.routes.test.js), reelle query/fail-safe-tests
// mod en fake supabase-client bor i racingTodayLookup.test.js, dette dækker KUN
// route-wiring: flag-gating og at feltet udelades helt (ikke bare tomt) når
// flaget er off.
//
// #4375: gaten hang oprindeligt på RACE_DAY_ENGINE_FLAG_KEY. Efter #4277 splittede
// løbsdags-motoren i to uafhængige flag styrer motor-flagget kun D3 (recovery-
// konstanter) + D4 (AI-hold), mens løbsdags-UDVIKLINGEN (D1+D2) er præcis det
// badgen fortæller om, og det hænger på race_day_development_enabled. Med udviklingen
// slukket for S3 og motoren stadig on fik spillerne derfor et løbsdags-badge og
// dæmpede intensitets-knapper for ryttere der i virkeligheden trænede helt
// normalt. Testene herunder låser den rigtige nøgle fast i begge ender.

const __dirname = dirname(fileURLToPath(import.meta.url));
const apiSource = readFileSync(resolve(__dirname, "../routes/api.js"), "utf8");

function routeBlock(marker, len = 7200) {
  const start = apiSource.indexOf(marker);
  assert.ok(start !== -1, `${marker} skal findes i api.js`);
  return apiSource.slice(start, start + len);
}

// Fake app_config-klient: returnerer `valueByKey[key]` for det opslag route'n
// laver. `undefined` = ingen række (fail-safe-vejen).
function fakeSupabase(valueByKey) {
  return {
    from: () => ({
      select: () => ({
        eq: (_column, key) => ({
          maybeSingle: async () => {
            const value = valueByKey[key];
            return { data: value === undefined ? null : { value }, error: null };
          },
        }),
      }),
    }),
  };
}

// Spejler route'ns to gatede udtryk (loader-kaldet + response-spreadet) med de
// ÆGTE helpers. Kildescanningerne herunder beviser at api.js bruger nøjagtig de
// samme udtryk; denne funktion beviser hvad de udtryk gør pr. flag-tilstand.
async function trainingMeRaceDayGate(supabase, { isBetaTester = false } = {}, loader) {
  const raceDayDevelopmentStage = await readFlagStage(supabase, RACE_DAY_DEVELOPMENT_FLAG_KEY);
  const raceDayDevelopmentOn = evaluateFlagStage(raceDayDevelopmentStage, { isBetaTester });
  const racingToday = raceDayDevelopmentOn ? await loader() : {};
  return { ...(raceDayDevelopmentOn ? { racingToday } : {}) };
}

test("api.js importerer racingToday-lookuppet + gater på race_day_development_enabled (#4375)", () => {
  assert.match(
    apiSource,
    /import \{ RACE_DAY_DEVELOPMENT_FLAG_KEY \} from "\.\.\/lib\/raceDayDevelopmentFlag\.js"/,
    "skal bruge samme flag-nøgle som dailyTrainingEngine.js's D1+D2-gate",
  );
  assert.match(
    apiSource,
    /import \{ loadRacingTodayByRider \} from "\.\.\/lib\/racingTodayLookup\.js"/,
  );
});

test("GET /training/me: raceDayDevelopmentOn læses via readFlagStage(RACE_DAY_DEVELOPMENT_FLAG_KEY) + evaluateFlagStage (samme mønster som 'enabled')", () => {
  const block = routeBlock('router.get("/training/me"');
  assert.match(block, /readFlagStage\(supabase, RACE_DAY_DEVELOPMENT_FLAG_KEY\)/);
  assert.match(
    block,
    /const raceDayDevelopmentOn = evaluateFlagStage\(raceDayDevelopmentStage, \{ isBetaTester \}\)/,
  );
});

test("#4375 regressions-guard: /training/me må ALDRIG gate løbsdags-badgen på motor-flagget", () => {
  const block = routeBlock('router.get("/training/me"');
  assert.doesNotMatch(
    block,
    /RACE_DAY_ENGINE_FLAG_KEY/,
    "motor-flagget styrer D3+D4 efter #4277, det siger intet om løbsdags-udviklingen badgen beskriver",
  );
  assert.doesNotMatch(block, /raceDayEngineOn/);
  assert.notEqual(RACE_DAY_DEVELOPMENT_FLAG_KEY, RACE_DAY_ENGINE_FLAG_KEY);
});

test("GET /training/me: racingToday-loaderen kaldes KUN når raceDayDevelopmentOn (flag off = ingen ekstra DB-kald, bit-identisk)", () => {
  const block = routeBlock('router.get("/training/me"');
  assert.match(
    block,
    /raceDayDevelopmentOn \? loadRacingTodayByRider\(supabase, teamId, riderIds, new Date\(\)\) : Promise\.resolve\(\{\}\)/,
  );
});

test("GET /training/me: racingToday-feltet spredes KUN ind i responsen når raceDayDevelopmentOn (udeladt helt, ikke tomt, når flag er off)", () => {
  const block = routeBlock('router.get("/training/me"');
  assert.match(block, /\.\.\.\(raceDayDevelopmentOn \? \{ racingToday \} : \{\}\)/);
  // Feltet må ALDRIG stå ubetinget i res.json, det ville lække et tomt/delvist
  // racingToday-objekt til klienter med flaget off.
  assert.doesNotMatch(block, /res\.json\(\{[\s\S]{0,600}racingToday,[\s\S]{0,200}\}\);/);
});

// ── Flag-OFF-adfærden (#4375's faktiske bug) ────────────────────────────────
// Dette er tilstanden i S3 lige nu: race_day_development_enabled er off, mens
// race_day_engine_enabled stadig er on. Feltet SKAL være helt fraværende.

test("#4375 flag off (udvikling off, motor on): racingToday er helt fraværende og loaderen kaldes aldrig", async () => {
  let loaderCalls = 0;
  const loader = async () => {
    loaderCalls += 1;
    return { 42: { race: "Tour de Test" } };
  };
  const out = await trainingMeRaceDayGate(
    fakeSupabase({
      [RACE_DAY_DEVELOPMENT_FLAG_KEY]: false,
      [RACE_DAY_ENGINE_FLAG_KEY]: true,
    }),
    {},
    loader,
  );
  assert.equal(loaderCalls, 0, "flag off må ikke koste et ekstra DB-opslag");
  assert.equal(
    Object.prototype.hasOwnProperty.call(out, "racingToday"),
    false,
    "feltet skal udelades HELT: et tomt objekt ville stadig være et nyt felt for klienten",
  );
});

test("#4375 flag off via manglende app_config-række eller ukendt værdi (fail-safe) → intet racingToday-felt", async () => {
  const loader = async () => ({ 7: { race: "Etape" } });
  for (const valueByKey of [{}, { [RACE_DAY_DEVELOPMENT_FLAG_KEY]: "vaguely-on" }]) {
    const out = await trainingMeRaceDayGate(fakeSupabase(valueByKey), {}, loader);
    assert.deepEqual(out, {});
  }
});

test("#4375 beta-stage: feltet leveres kun til beta-testere, ikke til alle", async () => {
  const loader = async () => ({ 9: { race: "Beta Classic" } });
  const supabase = fakeSupabase({ [RACE_DAY_DEVELOPMENT_FLAG_KEY]: "beta" });
  assert.deepEqual(await trainingMeRaceDayGate(supabase, { isBetaTester: false }, loader), {});
  assert.deepEqual(await trainingMeRaceDayGate(supabase, { isBetaTester: true }, loader), {
    racingToday: { 9: { race: "Beta Classic" } },
  });
});

test("#4375 flag on: racingToday leveres uændret (badgen kommer tilbage når udviklingen tændes til S4)", async () => {
  const loader = async () => ({ 13: { race: "Nordic Classic" } });
  const out = await trainingMeRaceDayGate(
    fakeSupabase({ [RACE_DAY_DEVELOPMENT_FLAG_KEY]: "on" }),
    {},
    loader,
  );
  assert.deepEqual(out, { racingToday: { 13: { race: "Nordic Classic" } } });
});

// ── Frontendens side af kontrakten ──────────────────────────────────────────
// Feltet forsvinder helt fra responsen. Klienten må derfor ikke antage at det
// findes: useTraining normaliserer med `?? {}`, og TrainingPage lader
// tilstedeværelse pr. rytter være hele gaten for badge + dæmpning.

test("#4375 frontend tåler at feltet mangler: useTraining normaliserer med ?? {} og badge/dæmpning hænger på pr-rytter-opslaget", () => {
  const useTrainingSource = readFileSync(
    resolve(__dirname, "../../frontend/src/lib/useTraining.js"),
    "utf8",
  );
  assert.match(
    useTrainingSource,
    /setRacingToday\(data\.racingToday \?\? \{\}\)/,
    "manglende felt skal give samme tomme state som et tomt felt",
  );
  const pageSource = readFileSync(
    resolve(__dirname, "../../frontend/src/pages/TrainingPage.jsx"),
    "utf8",
  );
  assert.match(pageSource, /const raceToday = racingToday\[rider\.id\] \?\? null;/);
  // Tom racingToday ⇒ raceToday er null for hver rytter ⇒ hverken badge eller
  // opacity-dæmpning renderes, og knapperne er kun disabled af `busy`.
  assert.match(pageSource, /\$\{raceToday \? "opacity-\[0\.55\]" : ""\}/);
  assert.match(pageSource, /disabled=\{busy\}/);
  assert.doesNotMatch(pageSource, /disabled=\{busy\s*\|\|\s*raceToday/);
});
