// #7644 startstempel (ejer 26/11, "Byg stempel, taend ved S6"): nedkoersels-loftet rammer kun
// loeb der STARTER efter taending. Et igangvaerende etapeloeb skifter aldrig regler.
//
// Beviset koerer bindingen (bindDescentRegroupCap7644) og derefter den rigtige v4-motor gennem
// raceRunner og sammenligner med en FROSSEN golden fra merge-basen
// (__fixtures__/raceRunner7644StampGolden.json, sourceCommit i filen, skrevet af
// generateRaceRunner7644StampGolden.mjs i en separat checkout af basen). Den genereres aldrig
// med den nye kode (#7587). Tre udsagn:
//   1. Slukket = bit-identisk med merge-basen, og intet skrives.
//   2. Taendt midt i et etapeloeb (ikke stemplet, allerede startet) = merge-basens gamle regler.
//   3. Nyt loeb (stemplet ved foerste etape) = merge-basens regel med loftet, ogsaa paa senere
//      etaper efter at kontakten er slukket igen. Kun "stop" fjerner den.
// Kun hashes; syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { DESCENT_REGROUP_CAP_7644_FLAG_KEY, bindDescentRegroupCap7644 } from "./descentRegroupCap7644Flag.js";
import { loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { OFF_DIGEST_CASES_7644, RACE_7644, digests7644 } from "./__fixtures__/raceRunner7644Scenarios.js";

const GOLDEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7644StampGolden.json", import.meta.url), "utf8"));
const COLUMN = DESCENT_REGROUP_CAP_7644_FLAG_KEY;
const V3 = "s5_profiles_v3";
const STAGE2 = "stageByStage:s5_profiles_v3:stage2";
const WHOLE = "wholeRace:s5_profiles_v3";

/** Een raekke i races; update respekterer .is(kolonne, null) og .eq("stages_completed", 0). */
function raceStub(row, { readError = null, writeError = null } = {}) {
  const state = { row: { ...row }, writes: 0, reads: 0 };
  return {
    state,
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => { state.reads += 1; return readError ? { data: null, error: readError } : { data: { ...state.row }, error: null }; } }) }),
        update(obj) {
          const filters = {};
          const chain = {
            eq(col, val) { filters[col] = val; return chain; },
            is(col) { filters.isNull = col; return chain; },
            then(res) {
              state.writes += 1;
              if (writeError) return Promise.resolve({ error: writeError }).then(res);
              const open = state.row[filters.isNull] == null && state.row.stages_completed === filters.stages_completed;
              if (open) Object.assign(state.row, obj);
              return Promise.resolve({ error: null }).then(res);
            },
          };
          return chain;
        },
      };
    },
  };
}

/** Som resolveRaceEngineV4: taendt kontakt = forslag om markeringen paa en kopi. */
const proposeOn = (engine) => ({ ...engine, descentRegroupCap7644: true });
const bind = (supabase, v4Engine, extra = {}) => bindDescentRegroupCap7644({
  supabase, race: { id: RACE_7644.id, stages_completed: supabase.state.row.stages_completed }, v4Engine, rulesRevision: V3, firstStageClaim: true, ...extra,
});
const run = async (key, engine) => {
  const c = OFF_DIGEST_CASES_7644.find((x) => x.key === key);
  const { result, recorder } = c.run(engine);
  return digests7644(result, recorder);
};

// ── Den frosne golden ───────────────────────────────────────────────────────

test("#7644 stempel: golden er fra en merge-base og daekker scenarierne slukket og taendt", () => {
  assert.match(GOLDEN.sourceCommit, /^[0-9a-f]{40}$/);
  const keys = OFF_DIGEST_CASES_7644.map((c) => c.key);
  assert.deepEqual(Object.keys(GOLDEN.off), keys);
  assert.deepEqual(Object.keys(GOLDEN.on), keys);
  assert.notDeepEqual(GOLDEN.on[WHOLE].outputSha256, GOLDEN.off[WHOLE].outputSha256, "loftet aendrer bjergetaperne i basen");
});

// ── 1. Slukket = bit-identisk ────────────────────────────────────────────────

test("#7644 stempel slukket: samme motor-objekt, intet skrives, alle scenarier bit-identiske med merge-basen", async () => {
  const engine = await loadRaceEngineV4();
  for (const c of OFF_DIGEST_CASES_7644) {
    const rev = c.key.includes("s5_profiles_v2") ? "s5_profiles_v2" : V3;
    for (const [stagesCompleted, firstStageClaim] of [[0, true], [1, false]]) {
      const supabase = raceStub({ stages_completed: stagesCompleted });
      const bound = await bind(supabase, engine, { rulesRevision: rev, firstStageClaim });
      assert.equal(bound, engine, `${c.key}: slukket = samme objekt`);
      assert.equal(supabase.state.writes, 0, `${c.key}: intet skrives`);
      assert.deepEqual(await run(c.key, bound), GOLDEN.off[c.key], `${c.key}: bit-identisk med merge-basen`);
    }
  }
});

test("#7644 stempel slukket: uden kolonnen (migrationen ikke applied) er alt uaendret", async () => {
  const engine = await loadRaceEngineV4();
  const missing = raceStub({ stages_completed: 0 }, { readError: { code: "42703", message: `column races.${COLUMN} does not exist` } });
  assert.equal(await bind(missing, engine), engine);
  const on = await bind(missing, proposeOn(engine));
  assert.equal("descentRegroupCap7644" in on, false, "taendt uden kolonne = ingen loft");
  assert.equal(missing.state.writes, 0);
  assert.deepEqual(await run(WHOLE, on), GOLDEN.off[WHOLE]);
});

// ── 2. Taendt midt i et etapeloeb = gamle regler ─────────────────────────────

test("#7644 stempel: taendt midt i et etapeloeb uden stempel koerer resten paa merge-basens gamle regler", async () => {
  const engine = await loadRaceEngineV4();
  const supabase = raceStub({ stages_completed: 1 });
  const bound = await bind(supabase, proposeOn(engine), { firstStageClaim: false });
  assert.equal("descentRegroupCap7644" in bound, false, "ingen markering paa et startet loeb");
  assert.equal(supabase.state.writes, 0, "et startet loeb stemples aldrig");
  assert.deepEqual(await run(STAGE2, bound), GOLDEN.off[STAGE2], "etape 2: bit-identisk med slukket i basen");
  // Selv et fejlagtigt "foerste claim" paa et startet loeb stempler ikke.
  const late = await bind(supabase, proposeOn(engine), { firstStageClaim: true });
  assert.equal("descentRegroupCap7644" in late, false);
  assert.equal(supabase.state.writes, 0);
});

// ── 3. Nyt loeb = ny regel, hele vejen ───────────────────────────────────────

test("#7644 stempel: nyt loeb stemples ved foerste etape og koerer med loftet, ogsaa efter at kontakten slukkes", async () => {
  const engine = await loadRaceEngineV4();
  const supabase = raceStub({ stages_completed: 0 });
  const first = await bind(supabase, proposeOn(engine));
  assert.equal(first.descentRegroupCap7644, true);
  assert.equal(supabase.state.row[COLUMN], true, "stemplet er sat");
  assert.deepEqual(await run(WHOLE, first), GOLDEN.on[WHOLE], "hele loebet: merge-basens regel med loftet");

  supabase.state.row.stages_completed = 1;
  // Kontakten er slukket igen: stemplet afgoer, ogsaa ved en opslagsfejl.
  for (const readStage of [async () => "off", async () => { throw new Error("boom"); }]) {
    const later = await bind(supabase, engine, { firstStageClaim: false, readStage });
    assert.equal(later.descentRegroupCap7644, true, "stemplet loeb beholder loftet");
    assert.deepEqual(await run(STAGE2, later), GOLDEN.on[STAGE2], "etape 2: samme regel som etape 1");
  }
  // Taendt og stemplet: samme motor-objekt, intet nyt skrives.
  const writes = supabase.state.writes;
  const still = proposeOn(engine);
  assert.equal(await bind(supabase, still, { firstStageClaim: false }), still);
  assert.equal(supabase.state.writes, writes);
});

test("#7644 stempel: 'stop' er ejerens noedstop og giver gamle regler fra naeste etape", async () => {
  const engine = await loadRaceEngineV4();
  const supabase = raceStub({ stages_completed: 2, [COLUMN]: true });
  const stopped = await bind(supabase, engine, { firstStageClaim: false, readStage: async () => "stop" });
  assert.equal(stopped, engine);
  assert.deepEqual(await run(STAGE2, stopped), GOLDEN.off[STAGE2]);
});

// ── Kanter ───────────────────────────────────────────────────────────────────

test("#7644 stempel: aeldre revision og v3-motor roeres ikke", async () => {
  const engine = await loadRaceEngineV4();
  const supabase = raceStub({ stages_completed: 0 });
  const older = await bind(supabase, proposeOn(engine), { rulesRevision: "s5_profiles_v2" });
  assert.equal("descentRegroupCap7644" in older, false);
  assert.equal(await bind(supabase, null), null);
  assert.equal(supabase.state.reads + supabase.state.writes, 0, "intet DB-kald");
  assert.deepEqual(await run("wholeRace:s5_profiles_v2", older), GOLDEN.off["wholeRace:s5_profiles_v2"]);
});

test("#7644 stempel: anden DB-fejl kaster (etapen venter hellere end koerer paa forkerte regler)", async () => {
  const broken = raceStub({ stages_completed: 0 }, { readError: { code: "500", message: "boom" } });
  await assert.rejects(bind(broken, { descentRegroupCap7644: true }), /kunne ikke laeses/);
  const unwritable = raceStub({ stages_completed: 0 }, { writeError: { code: "500", message: "boom" } });
  await assert.rejects(bind(unwritable, { descentRegroupCap7644: true }), /kunne ikke bindes/);
});

test("#7644 stempel: dryRun skriver aldrig, men previewer loftet paa et nyt loeb", async () => {
  const supabase = raceStub({ stages_completed: 0 });
  const out = await bind(supabase, { descentRegroupCap7644: true }, { dryRun: true });
  assert.equal(out.descentRegroupCap7644, true);
  assert.equal(supabase.state.writes, 0);
});

test("#7644 stempel: er loebet startet imens, gaelder den gemte vaerdi", async () => {
  const supabase = raceStub({ stages_completed: 0 });
  const from = supabase.from;
  supabase.from = () => {
    const client = from();
    const update = client.update;
    client.update = (obj) => { supabase.state.row.stages_completed = 1; return update(obj); };
    return client;
  };
  const out = await bind(supabase, { descentRegroupCap7644: true });
  assert.equal("descentRegroupCap7644" in out, false);
  assert.equal(supabase.state.row[COLUMN], undefined);
});

// ── Ledningen og migrationen ─────────────────────────────────────────────────

test("#7644 stempel: raceRunner binder paa begge afviklings-veje, foer de andre stempler laeser motoren", () => {
  const source = readFileSync(new URL("./raceRunner.js", import.meta.url), "utf8");
  assert.equal(source.match(/await bindDescentRegroupCap7644\(\{ supabase, race, v4Engine: huntBoundEngine, rulesRevision, firstStageClaim/g)?.length, 2, "helt-loeb og etape-stien");
  assert.equal(source.match(/await bindLetGoOrder7557\(\{ supabase, race, v4Engine: capBoundEngine,/g)?.length, 2, "den bundne motor gaar videre");
});

test("#7644 stempel: migrationen er additiv og idempotent og roerer ikke kontakten", () => {
  const sql = readFileSync(new URL("../../database/2026-11-26-7644-descent-regroup-cap-race-stamp.sql", import.meta.url), "utf8");
  assert.match(sql, /ADD COLUMN IF NOT EXISTS descent_regroup_cap_7644 boolean;/);
  assert.doesNotMatch(sql, /^\s*(UPDATE|DELETE|DROP|TRUNCATE|INSERT)\b/im);
  const ddl = sql.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
  assert.doesNotMatch(ddl, /NOT NULL|DEFAULT/i, "NULL = ikke stemplet");
});
