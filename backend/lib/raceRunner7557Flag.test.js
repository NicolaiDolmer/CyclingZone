// #7557: tænd-ledningen for at spillerens gemte "lad andre jage" vinder over motorens egen jagt.
// Kun app_config let_go_order_7557 = "on" taender; raceRunner sender kontakten til broen KUN
// under s5_profiles_v3 (og senere); vaerdien er med i run-identiteten (input_checksum) og i
// motor-argumenterne, saa #1857-genafspilningen genskaber den.
//
// Slukket = bit-identisk med merge-basen FOER kontakten: __fixtures__/raceRunner7557FlagOff.json
// er skrevet af merge-basens kode (sourceCommit i filen) med de samme scenarier
// (__fixtures__/raceRunner7557Scenarios.js) og genereres aldrig med den nye kode.
// Kun hashes; syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { LET_GO_ORDER_7557_FLAG_KEY, evaluateLetGoOrder7557Flag, isLetGoOrder7557Enabled } from "./letGoOrder7557Flag.js";
import { resolveRaceEngineV4, v4LetGoOrder7557Arg } from "./raceRunner.js";
import { ENGINE_VERSION_V4, loadRaceEngineV4, withManagerLetGo7557 } from "./raceEngineV4Bridge.js";
import { findStageFlag, isStageFlagKey } from "./stageFlagCatalog.js";
import { buildSnapshotRows, decodeSnapshot, replayEngineInput } from "./engineInputSnapshot1857.js";
import {
  OFF_DIGEST_CASES_7557, RACE_7557, computeOffDigests7557Runner, digests7557, letGoTeamIds7557, stageByStage7557, wholeRace7557,
} from "./__fixtures__/raceRunner7557Scenarios.js";

const FROZEN = JSON.parse(readFileSync(new URL("./__fixtures__/raceRunner7557FlagOff.json", import.meta.url), "utf8"));

function configStub(value, { error = null, throws = false } = {}) {
  const seen = [];
  return {
    seen,
    from(table) {
      if (throws) throw new Error("boom");
      return {
        select: () => ({
          eq: (col, key) => {
            seen.push([table, col, key]);
            return { maybeSingle: async () => (error ? { data: null, error } : { data: value === undefined ? null : { value }, error: null }) };
          },
        }),
      };
    },
  };
}

/** De hold paa listen der reagerede eller stod som jagende i outputtene. */
function chasingLetGoTeams(outputs, teamIds) {
  const teams = new Set(teamIds);
  const seen = new Set();
  for (const output of outputs) {
    for (const e of output.timeline?.events ?? output.timeline ?? []) {
      if (e.type === "gc_reaction" && e.params?.status === "started" && teams.has(e.params.team_id)) seen.add(e.params.team_id);
      if (e.type === "breakaway_caught") for (const t of e.params?.chasing_team_ids ?? []) if (teams.has(t)) seen.add(t);
    }
  }
  return [...seen].sort();
}

// ── Flaget ───────────────────────────────────────────────────

test("#7557 flag: kun den eksakte streng 'on' taender", () => {
  assert.equal(LET_GO_ORDER_7557_FLAG_KEY, "let_go_order_7557");
  assert.equal(evaluateLetGoOrder7557Flag("on"), true);
  for (const v of ["off", "beta", true, false, null, undefined, "ON", 1, "true"]) {
    assert.equal(evaluateLetGoOrder7557Flag(v), false, `${JSON.stringify(v)} er slukket`);
  }
});

test("#7557 flag: app_config-opslaget, fail-safe slukket ved fravaer og fejl", async () => {
  const on = configStub("on");
  assert.equal(await isLetGoOrder7557Enabled(on), true);
  assert.deepEqual(on.seen, [["app_config", "key", "let_go_order_7557"]]);
  assert.equal(await isLetGoOrder7557Enabled(configStub(undefined)), false, "raekken mangler");
  assert.equal(await isLetGoOrder7557Enabled(configStub("beta")), false);
});

test("#7557 flag: staar i flag-kataloget", () => {
  assert.equal(isStageFlagKey("let_go_order_7557"), true);
  assert.equal(findStageFlag("let_go_order_7557").area, "race-engine");
});

test("#7557 resolveRaceEngineV4: slukket = samme motor-objekt, fejl = slukket, taendt = markering", async () => {
  const engine = { version: ENGINE_VERSION_V4, simulateStage: () => ({}) };
  const base = {
    supabase: {}, race: RACE_7557, checkV4Enabled: async () => true, loadEngine: async () => engine, loadOrders: async () => [],
    checkFormPeaksEnabled: async () => true, checkDayForm6649Enabled: async () => false, checkQueenStageGap7236Enabled: async () => false,
    checkStagePlanDroppedFront7635Enabled: async () => false, checkDescentRegroupCap7644Enabled: async () => false, checkSplitAttackCause7640Enabled: async () => false,
  };
  const off = await resolveRaceEngineV4({ ...base, checkLetGoOrder7557Enabled: async () => false });
  assert.equal(off.v4Engine, engine, "slukket: intet wrapper-lag, ingen markering");
  const failed = await resolveRaceEngineV4({ ...base, checkLetGoOrder7557Enabled: async () => { throw new Error("db"); } });
  assert.equal(failed.v4Engine, engine, "fejl i opslaget = slukket, motoren koerer stadig");
  const on = await resolveRaceEngineV4({ ...base, checkLetGoOrder7557Enabled: async () => true });
  assert.equal(on.v4Engine.letGoOrder7557, true);
  assert.equal("letGoOrder7557" in engine, false, "den indlaeste motor muteres aldrig");
  const all = await resolveRaceEngineV4({ ...base, checkSplitAttackCause7640Enabled: async () => true, checkLetGoOrder7557Enabled: async () => true });
  assert.equal(all.v4Engine.splitAttackCause7640, true, "de andre kontakter bevares");
  assert.equal(all.v4Engine.letGoOrder7557, true);
});

test("#7557 v4LetGoOrder7557Arg: kun taendt flag OG s5_profiles_v3 eller nyere", () => {
  const on = { letGoOrder7557: true };
  assert.deepEqual(v4LetGoOrder7557Arg(on, "s5_profiles_v3"), { letGoOrder7557: true });
  for (const rev of ["legacy", "orders_gc_v1", "s5_profiles_v1", "s5_profiles_v2", undefined, null]) {
    assert.deepEqual(v4LetGoOrder7557Arg(on, rev), {}, `revision ${rev}`);
  }
  assert.deepEqual(v4LetGoOrder7557Arg({}, "s5_profiles_v3"), {});
  assert.deepEqual(v4LetGoOrder7557Arg({ letGoOrder7557: "on" }, "s5_profiles_v3"), {}, "kun boolean true");
  assert.deepEqual(v4LetGoOrder7557Arg(null, "s5_profiles_v3"), {});
});

// ── Broen: kun spillerens eget valg markeres ───────────────────

test("#7557 withManagerLetGo7557: kun holdets gemte let_go for netop denne etape", () => {
  const orders = [
    { kind: "team_tactics", team_id: "A", params: { breakaway_stance: "let_go" } },
    { kind: "team_tactics", team_id: "B", params: { breakaway_stance: "let_go" } }, // standard, ingen gemt raekke
    { kind: "team_tactics", team_id: "C", params: { breakaway_stance: "neutral" } },
    { kind: "team_tactics", team_id: "D", params: { breakaway_stance: "let_go" } }, // gemt paa en anden etape
    { kind: "leadout", team_id: "A", params: {} },
  ];
  const before = JSON.stringify(orders);
  const rows = [
    { team_id: "A", stage_number: 2, breakaway_stance: "let_go" },
    { team_id: "C", stage_number: 2, breakaway_stance: "neutral" },
    { team_id: "D", stage_number: 1, breakaway_stance: "let_go" },
  ];
  const out = withManagerLetGo7557(orders, rows, 2);
  assert.equal(JSON.stringify(orders), before, "input muteres ikke");
  assert.deepEqual(out.filter((o) => o.params.manager_let_go_7557 === true).map((o) => `${o.kind}:${o.team_id}`), ["team_tactics:A"]);
  assert.equal(withManagerLetGo7557(orders, [], 2), orders, "ingen raekker = samme liste");
});

// ── Slukket = bit-identisk med merge-basen ─────────────────────

test("#7557 slukket: den frosne fixture er fra merge-basen og daekker praecis scenarierne", () => {
  assert.match(FROZEN.sourceCommit, /^[0-9a-f]{40}$/);
  assert.deepEqual(Object.keys(FROZEN).filter((k) => k !== "sourceCommit" && k !== "note"), OFF_DIGEST_CASES_7557.map((c) => c.key));
});

test("#7557 slukket: checksum, motor-input og output er bit-identiske med merge-basen", async () => {
  const now = await computeOffDigests7557Runner();
  for (const c of OFF_DIGEST_CASES_7557) assert.deepEqual(now[c.key], FROZEN[c.key], c.key);
});

// ── Taendt: ordren vinder ──────────────────────────────────────

test("#7557 slukket: scenariet viser fejlen (et lad-gaa-hold jager)", async () => {
  const off = wholeRace7557(await loadRaceEngineV4(), "s5_profiles_v3");
  assert.ok(chasingLetGoTeams(off.outputs, letGoTeamIds7557()).length > 0, "fejlen skal kunne ses, ellers beviser testen nedenfor intet");
});

test("#7557 taendt: et hold med gemt lad-gaa reagerer ikke og staar aldrig som jagende", async () => {
  const engine = await loadRaceEngineV4();
  const on = wholeRace7557({ ...engine, letGoOrder7557: true }, "s5_profiles_v3");
  assert.deepEqual(chasingLetGoTeams(on.outputs, letGoTeamIds7557()), []);
  const stage = stageByStage7557({ ...engine, letGoOrder7557: true }, "s5_profiles_v3", 1);
  assert.deepEqual(chasingLetGoTeams(stage.outputs, letGoTeamIds7557()), []);
});

test("#7557 taendt: run-identiteten aendres, og genafspilningen genskaber etapen", async () => {
  const engine = await loadRaceEngineV4();
  const on = wholeRace7557({ ...engine, letGoOrder7557: true }, "s5_profiles_v3");
  const digests = await digests7557(on);
  assert.notDeepEqual(digests.inputChecksums, FROZEN["wholeRace:s5_profiles_v3"].inputChecksums);
  const rows = await buildSnapshotRows({ raceId: RACE_7557.id, recorder: on.recorder });
  for (const row of rows) {
    const replay = await replayEngineInput(decodeSnapshot(row));
    assert.equal(replay.outputSha256, row.output_sha256, `etape ${row.stage_number}`);
  }
});

test("#7557 taendt: under s5_profiles_v2 goer kontakten intet", async () => {
  const engine = await loadRaceEngineV4();
  const off = await digests7557(wholeRace7557(engine, "s5_profiles_v2"));
  const on = await digests7557(wholeRace7557({ ...engine, letGoOrder7557: true }, "s5_profiles_v2"));
  assert.deepEqual(on, off);
});
