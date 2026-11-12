// #7855: troejejagten i etapeplanen (Hent point / Hent bjergpoint) bag kontakten jersey_hunt_7855.
//
// Slukket = bit-identisk med merge-basen FOER kontakten: __fixtures__/raceRunner7855FlagOff.json
// er skrevet af merge-basens kode (sourceCommit) med de samme scenarier, hvor holdene allerede har
// gemt planer med jagt-opgaver. Merge-basen kender ikke opgaverne og ignorerer de planer; den nye
// kode slukket skal goere praecis det samme. Fixturen genereres aldrig med den nye kode (#7587).
//
// Taendt: rytteren med opgaven kaemper om passagen paa sin straekning (ogsaa i feltet), passagen
// siger hvem der jagede, og leddet taeller som en haard indsats (traethed). Kun hashes og
// kvalitative udfald i denne fil (hard rule 17).

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { JERSEY_HUNT_7855_EMERGENCY_STOP, JERSEY_HUNT_7855_FLAG_KEY, bindJerseyHunt7855, evaluateJerseyHunt7855Flag, isJerseyHunt7855Enabled, jerseyHunt7855OpenForRace } from "./jerseyHunt7855Flag.js";
import { resolveRaceEngineV4, v4JerseyHunt7855Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, loadRaceEngineV4 } from "./raceEngineV4Bridge.js";
import { FRESH_FLAG_KEYS } from "./featureStage.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import { stageWorkExposure } from "./raceFatigue.js";
import { jerseyHuntFrontWork7855 } from "./engine/v4/mechanics/jerseyHunt7855.ts";
import { OFF_DIGEST_CASES_7855, RACE_7855, computeOffDigests7855Runner, digests7855, wholeRace7855 } from "./__fixtures__/raceRunner7855Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7855FlagOff.json", import.meta.url), "utf8"));

function configStub(value) {
  const seen = [];
  return {
    seen,
    from(table) {
      return { select: () => ({ eq: (col, key) => { seen.push([table, col, key]); return { maybeSingle: async () => ({ data: value === undefined ? null : { value }, error: null }) }; } }) };
    },
  };
}

/** Et loeb i races-tabellen, med kun de kald bindingen bruger. */
function raceTable(row, { readError = null, updateError = null } = {}) {
  const calls = { reads: 0, updates: [] };
  const supabase = {
    from(table) {
      assert.equal(table, "races");
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => { calls.reads += 1; return readError ? { data: null, error: readError } : { data: { race_type: "stage_race", ...row }, error: null }; } }) }),
        update: (patch) => {
          const filters = [];
          const chain = {
            eq: (col, value) => { filters.push(["eq", col, value]); return chain; },
            is: (col, value) => { filters.push(["is", col, value]); return chain; },
            then: (done) => {
              calls.updates.push({ patch, filters });
              if (!updateError && row.jersey_hunt_7855 == null && row.stages_completed === 0) Object.assign(row, patch);
              return Promise.resolve({ error: updateError }).then(done);
            },
          };
          return chain;
        },
      };
    },
  };
  return { supabase, calls, row };
}

const ENGINE = Object.freeze({ version: ENGINE_VERSION_V4, jerseyHunt7855: true });
const PLAIN = Object.freeze({ version: ENGINE_VERSION_V4 });
const bind = (table, over = {}) => bindJerseyHunt7855({ supabase: table.supabase, race: { id: "r1" }, v4Engine: ENGINE, rulesRevision: "s5_profiles_v3", firstStageClaim: true, ...over });
const MISSING = { code: "42703", message: "column races.jersey_hunt_7855 does not exist" };

// ── Flaget ───────────────────────────────────────────────────

test("#7855 flag: kun den eksakte streng 'on' taender, og motoren laeser den frisk", async () => {
  assert.equal(JERSEY_HUNT_7855_FLAG_KEY, "jersey_hunt_7855");
  assert.equal(evaluateJerseyHunt7855Flag("on"), true);
  for (const v of ["off", "beta", "stop", true, false, null, undefined, "ON", 1]) assert.equal(evaluateJerseyHunt7855Flag(v), false, `${JSON.stringify(v)} er slukket`);
  const on = configStub("on");
  assert.equal(await isJerseyHunt7855Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "jersey_hunt_7855"]]);
  assert.equal(await isJerseyHunt7855Enabled(configStub(undefined)), false);
  assert.equal(isStageFlagKey("jersey_hunt_7855"), true);
  assert.equal(findStageFlag("jersey_hunt_7855").area, "race-engine");
  assert.equal(FRESH_FLAG_KEYS.has("jersey_hunt_7855"), true);
});

test("#7855 flag: migrationen seeder raekken 'off' og tilfoejer stemplet, additivt og idempotent", () => {
  const sql = readFileSync(new URL("../../database/2026-11-07-7855-race-jersey-hunt-binding.sql", import.meta.url), "utf8");
  assert.match(sql, /'jersey_hunt_7855',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
  assert.match(sql, /ADD COLUMN IF NOT EXISTS jersey_hunt_7855 boolean;/);
  assert.doesNotMatch(sql.replace(/^--.*$/gm, ""), /\b(UPDATE|DELETE|DROP|TRUNCATE)\b/i);
});

test("#7855 resolveRaceEngineV4: slukket = samme motor-objekt, fejl = slukket, taendt er kun et forslag", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const off = async () => false;
  const base = { supabase: {}, race: RACE_7855, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [], checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: off, checkQueenStageGap7236Enabled: off, checkStagePlanDroppedFront7635Enabled: off, checkDescentRegroupCap7644Enabled: off, checkSplitAttackCause7640Enabled: off, checkLetGoOrder7557Enabled: off, checkDayWords7725Enabled: off, checkIttNoDayRoll7726Enabled: off, checkTeamChase7730Enabled: off, checkTimeLimitFatigue7715Enabled: off };
  assert.equal((await resolveRaceEngineV4({ ...base, checkJerseyHunt7855Enabled: off })).v4Engine, engine);
  assert.equal((await resolveRaceEngineV4({ ...base, checkJerseyHunt7855Enabled: async () => { throw new Error("db"); } })).v4Engine, engine);
  const on = (await resolveRaceEngineV4({ ...base, checkJerseyHunt7855Enabled: async () => true })).v4Engine;
  assert.equal(on.jerseyHunt7855, true);
  const started = raceTable({ jersey_hunt_7855: null, stages_completed: 1 });
  assert.deepEqual(v4JerseyHunt7855Arg(await bind(started, { v4Engine: on, firstStageClaim: false }), "s5_profiles_v3"), {}, "flaget alene omfatter intet startet loeb");
  assert.equal("jerseyHunt7855" in engine, false, "den indlaeste motor muteres aldrig");
});

test("#7855 v4JerseyHunt7855Arg: kun et omfattet loeb OG s5_profiles_v3 eller nyere", () => {
  assert.deepEqual(v4JerseyHunt7855Arg({ jerseyHunt7855: true }, "s5_profiles_v3"), { jerseyHunt7855: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) assert.deepEqual(v4JerseyHunt7855Arg({ jerseyHunt7855: true }, rev), {}, `revision ${rev}`);
  assert.deepEqual(v4JerseyHunt7855Arg({ jerseyHunt7855: "on" }, "s5_profiles_v3"), {}, "kun boolean true");
  assert.deepEqual(v4JerseyHunt7855Arg(null, "s5_profiles_v3"), {});
});

// ── Kun loeb der ikke er startet ───────────────────────────────

test("#7855 binding: aeldre revision eller ingen motor = intet sker; slukket og ikke stemplet = samme motor", async () => {
  const table = raceTable({ jersey_hunt_7855: true, stages_completed: 0 });
  assert.equal(await bind(table, { v4Engine: null }), null);
  assert.deepEqual(await bind(table, { rulesRevision: "s5_profiles_v2" }), PLAIN);
  assert.deepEqual([table.calls.reads, table.calls.updates.length], [0, 0]);
  const fresh = raceTable({ jersey_hunt_7855: null, stages_completed: 0 });
  assert.equal(await bind(fresh, { v4Engine: PLAIN }), PLAIN);
  assert.equal(fresh.calls.updates.length, 0);
});

test("#7855 binding: et ikke-startet loeb stemples betinget ved foerste claim; et startet loeb aldrig", async () => {
  const table = raceTable({ jersey_hunt_7855: null, stages_completed: 0 });
  assert.equal((await bind(table)).jerseyHunt7855, true);
  assert.deepEqual(table.calls.updates[0].filters, [["eq", "id", "r1"], ["is", "jersey_hunt_7855", null], ["eq", "stages_completed", 0]]);
  for (const over of [{ firstStageClaim: false }, { firstStageClaim: true }]) {
    const started = raceTable({ jersey_hunt_7855: null, stages_completed: 2 });
    assert.deepEqual(await bind(started, over), PLAIN);
    assert.equal(started.calls.updates.length, 0);
  }
  const dry = raceTable({ jersey_hunt_7855: null, stages_completed: 0 });
  assert.equal((await bind(dry, { dryRun: true })).jerseyHunt7855, true);
  assert.equal(dry.calls.updates.length, 0, "dryRun skriver aldrig");
});

test("#7855 slukke-regel: et stemplet loeb koerer faerdigt; kun 'stop' fjerner reglen", async () => {
  const stamped = () => raceTable({ jersey_hunt_7855: true, stages_completed: 2 });
  for (const value of ["off", "beta", null, true]) {
    assert.equal((await bind(stamped(), { v4Engine: PLAIN, firstStageClaim: false, readStage: async () => value })).jerseyHunt7855, true);
  }
  assert.equal((await bind(stamped(), { v4Engine: PLAIN, firstStageClaim: false, readStage: async () => { throw new Error("db"); } })).jerseyHunt7855, true);
  assert.equal(JERSEY_HUNT_7855_EMERGENCY_STOP, "stop");
  assert.equal(await bind(stamped(), { v4Engine: PLAIN, firstStageClaim: false, readStage: async () => "stop" }), PLAIN);
});

test("#7855 binding: uden kolonnen er loebet ikke omfattet; andre fejl er hoejlydte", async () => {
  assert.deepEqual(await bind(raceTable({}, { readError: MISSING })), PLAIN);
  await assert.rejects(bind(raceTable({}, { readError: { code: "500", message: "boom" } })), /kunne ikke laeses/);
  await assert.rejects(bind(raceTable({ jersey_hunt_7855: null, stages_completed: 0 }, { updateError: { code: "500", message: "boom" } })), /kunne ikke bindes/);
});

test("#7855 API-gaten: opgaverne kan kun gemmes i et loeb der vil koere med dem", async () => {
  const open = (row, value, opts = {}) => jerseyHunt7855OpenForRace({ supabase: raceTable(row, opts).supabase, race: { id: "r1" }, readStage: async () => value });
  assert.equal(await open({ jersey_hunt_7855: null, stages_completed: 0 }, "on"), true, "ikke startet + taendt");
  assert.equal(await open({ jersey_hunt_7855: null, stages_completed: 0 }, "beta"), false, "beta er slukket");
  assert.equal(await open({ jersey_hunt_7855: null, stages_completed: 1 }, "on"), false, "startet uden stempel");
  assert.equal(await open({ jersey_hunt_7855: true, stages_completed: 2 }, "off"), true, "stemplet koerer faerdigt");
  assert.equal(await open({ jersey_hunt_7855: true, stages_completed: 2 }, "stop"), false, "noedstop");
  assert.equal(await open({}, "on", { readError: MISSING }), false, "uden kolonnen");
  assert.equal(await jerseyHunt7855OpenForRace({ supabase: raceTable({ jersey_hunt_7855: null, stages_completed: 0 }).supabase, race: { id: "r1" }, readStage: async () => { throw new Error("db"); } }), false, "fejl = lukket");
});

test("#7855 Codex-review: endagsloeb giver ingen passagepoint, saa opgaverne hverken tilbydes eller stemples dér", async () => {
  const oneDay = () => raceTable({ jersey_hunt_7855: null, stages_completed: 0, race_type: "single" });
  const table = oneDay();
  assert.deepEqual(await bind(table), PLAIN, "ingen markering");
  assert.equal(table.calls.updates.length, 0, "intet stempel");
  assert.equal(await jerseyHunt7855OpenForRace({ supabase: oneDay().supabase, race: { id: "r1" }, readStage: async () => "on" }), false);
  assert.equal(await jerseyHunt7855OpenForRace({ supabase: raceTable({ jersey_hunt_7855: null, stages_completed: 0 }).supabase, race: { id: "r1" }, readStage: async () => "on" }), true, "etapeloeb som foer");
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────

test("#7855 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => !["sourceCommit", "note"].includes(k)), OFF_DIGEST_CASES_7855.map((c) => c.key));
});

test("#7855 slukket: checksum, motor-input og output er bit-identiske med merge-basen (ogsaa med gemte jagt-planer)", async () => {
  const now = await computeOffDigests7855Runner();
  for (const c of OFF_DIGEST_CASES_7855) assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
});

// ── Taendt ─────────────────────────────────────────────────────

/** Passagerne undervejs pr. etape (kind+index -> passage). */
function inRacePassages(outputs) {
  return outputs.map((o) => new Map(o.v4Output.passages.filter((p) => p.kind !== "finish").map((p) => [`${p.kind}${p.index}`, p])));
}
const ridersOf = (p) => p.results.map((r) => r.rider_id);

test("#7855 taendt: jaegeren kaemper om passagen paa sin straekning, og kun dér", async () => {
  const engine = await loadRaceEngineV4();
  const off = inRacePassages(wholeRace7855(engine, "s5_profiles_v3").outputs);
  const on = inRacePassages(wholeRace7855({ ...engine, jerseyHunt7855: true }, "s5_profiles_v3").outputs);
  // Etape 1: hjaelperen r001 kaemper ikke om spurten i feltet uden opgaven; med den koerer han med i
  // sin gruppe (opgaven fik ham med: hunt_work_7855), men slaar kun dem, der ikke koerer med (ejer
  // 12/11 valg B). Her er alle pointpladser taget af ryttere der kaemper i forvejen, saa pladserne er
  // de samme som uden opgaven.
  assert.equal(off[0].get("sprint0").hunters, undefined, "slukket: ingen jaegere paa passagen");
  assert.ok(on[0].get("sprint0").hunters.includes("r001"));
  assert.deepEqual(on[0].get("sprint0").hunt_work_7855, ["r001"], "kun hjaelperen fik opgaven til at koere med");
  assert.deepEqual(ridersOf(on[0].get("sprint0")), ridersOf(off[0].get("sprint0")), "evnen afgoer mod de kaempende");
  // r007's plan har point kun i de sidste km (ingen spurt dér): ugyldig, han jager aldrig.
  for (const stage of on) for (const p of stage.values()) assert.ok(!(p.hunters ?? []).includes("r007"));
  // Etape 2: sprinterkaptajnen r003 jager point; bjergpoint kun paa topankomsten (r009) er ugyldigt.
  assert.ok(on[1].get("sprint0").hunters.includes("r003"));
  // Valg B: sprinterkaptajnen koerer med i forvejen, saa opgaven giver ham ingen plads foran andre
  // kaempende; passagen er den samme som uden opgaven, og opgaven fik ham ikke til at koere med.
  assert.deepEqual(ridersOf(on[1].get("sprint0")), ridersOf(off[1].get("sprint0")));
  assert.equal(on[1].get("sprint0").hunt_work_7855, undefined);
  assert.equal(on[1].get("kom0").hunters, undefined, "topankomsten afgoeres af maalordenen, ingen jagt");
  // Etape 3: r002 jager bjergpoint EFTER Col B (ikke paa den); r013 jager point frem til Col C.
  assert.ok(!(on[2].get("kom0").hunters ?? []).includes("r002"), "ikke foer sit skift-punkt");
  assert.ok(on[2].get("kom1").hunters.includes("r002"));
  assert.ok(on[2].get("sprint0").hunters.includes("r013"));
  assert.ok(!(on[2].get("kom1").hunters ?? []).includes("r013"), "jagten paa point er ikke bjergpoint");
  // Kun passagens art: en bjergpoint-jaeger er aldrig jaeger i en spurt.
  assert.ok(!(on[2].get("sprint0").hunters ?? []).includes("r008"));
});

test("#7855 taendt: gruppen afgoer foerst; jagten flytter kun pladser inden for gruppen", async () => {
  const engine = await loadRaceEngineV4();
  const on = wholeRace7855({ ...engine, jerseyHunt7855: true }, "s5_profiles_v3").outputs;
  for (const o of on) {
    for (const p of o.v4Output.passages) {
      if (p.kind === "finish" || !p.hunters) continue;
      // Pointskalaerne er de samme: samme antal pladser og samme point pr. plads som slukket.
      assert.ok(p.results.every((r, i) => r.passage_rank === i + 1));
    }
  }
});

test("#7855 taendt: passagerne koster traethed (valg C), og run-identiteten + genafspilningen holder", async () => {
  const engine = await loadRaceEngineV4();
  const off = wholeRace7855(engine, "s5_profiles_v3");
  const on = wholeRace7855({ ...engine, jerseyHunt7855: true }, "s5_profiles_v3");
  assert.equal(off.outputs[0].v4Output.stage_plan_load_efforts?.r001, undefined, "slukket: planen ignoreres som i merge-basen");
  // Ejer 12/11 valg C: jagt-leddet taeller som Middel; prisen er passagerne opgaven fik ham til at koere med.
  assert.equal(on.outputs[0].v4Output.stage_plan_load_efforts.r001, "normal");
  assert.equal(on.outputs[1].v4Output.stage_plan_load_efforts.r003, "normal");
  const frontOf = (o, id) => stageWorkExposure(o.v4Output, null).get(id)?.front ?? 0;
  assert.ok(frontOf(on.outputs[0], "r001") > frontOf(off.outputs[0], "r001"), "hjaelperens spurt koster arbejde i front");
  assert.equal(jerseyHuntFrontWork7855(on.outputs[1].v4Output.passages).has("r003"), false, "sprinterkaptajnen koerte med alligevel: intet ekstra");
  const digests = await digests7855(on);
  assert.notDeepEqual(digests.inputChecksums, FROZEN["wholeRace:s5_profiles_v3"].inputChecksums);
  const rows = await buildSnapshotRows({ raceId: RACE_7855.id, recorder: on.recorder });
  for (const row of rows) {
    const replay = await replayEngineInput(decodeSnapshot(row));
    assert.equal(replay.outputSha256, row.output_sha256, `etape ${row.stage_number}`);
  }
});

test("#7855 taendt: filmen siger det samme som passagen (hunters paa eventet)", async () => {
  const engine = await loadRaceEngineV4();
  const on = wholeRace7855({ ...engine, jerseyHunt7855: true }, "s5_profiles_v3");
  const events = on.outputs[0].v4Output.timeline.events.filter((e) => e.type === "intermediate_sprint");
  assert.equal(events.length, 1);
  assert.deepEqual(events[0].params.hunters, on.outputs[0].v4Output.passages.find((p) => p.kind === "sprint").hunters);
});

test("#7855 taendt: under s5_profiles_v2 goer kontakten intet", async () => {
  const engine = await loadRaceEngineV4();
  const off = await digests7855(wholeRace7855(engine, "s5_profiles_v2"));
  const on = await digests7855(wholeRace7855({ ...engine, jerseyHunt7855: true }, "s5_profiles_v2"));
  assert.deepEqual(on, off);
  assert.deepEqual(off, FROZEN["wholeRace:s5_profiles_v2"]);
});
