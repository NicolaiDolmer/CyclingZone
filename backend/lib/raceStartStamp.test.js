// #7557/#7733: kontakterne rammer kun loeb der ikke er startet. Et loeb koeres faerdigt med de
// regler, det startede med; "stop" er ejerens noedstop. Syntetisk fixture, ingen prod-data.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { bindLetGoOrder7557 } from "./letGoOrder7557Flag.js";
import { bindStartedFieldLock7733, raceHasStartedFieldLock7733 } from "./startedFieldLock7733Flag.js";
import { floorChaseWanted7730 } from "./engine/v4/mechanics/chaseGroup.ts";

const LET_GO = "let_go_order_7557";
const LOCK = "started_field_lock_7733";
const RACE = { id: "race-1", stages_completed: 0 };
const REV = "s5_profiles_v3";

/** Én raekke i races; update respekterer .is(kolonne, null) og .eq("stages_completed", 0). */
function raceStub(row, { readError = null, writeError = null } = {}) {
  const state = { row: { ...row }, writes: 0 };
  return {
    state,
    from() {
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => (readError ? { data: null, error: readError } : { data: { ...state.row }, error: null }) }) }),
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

const bindLetGo = (supabase, engine, extra = {}) => bindLetGoOrder7557({ supabase, race: RACE, v4Engine: engine, rulesRevision: REV, firstStageClaim: true, ...extra });

test("#7557: taendt ved foerste claim stempler loebet og beholder ordren", async () => {
  const supabase = raceStub({ stages_completed: 0 });
  const out = await bindLetGo(supabase, { letGoOrder7557: true });
  assert.equal(out.letGoOrder7557, true);
  assert.equal(supabase.state.row[LET_GO], true);
});

test("#7557: et startet loeb uden stempel koerer videre uden reglen, og intet skrives", async () => {
  const supabase = raceStub({ stages_completed: 3 });
  const out = await bindLetGo(supabase, { letGoOrder7557: true }, { firstStageClaim: false });
  assert.equal("letGoOrder7557" in out, false);
  assert.equal(supabase.state.writes, 0);
});

test("#7557: selv et 'foerste claim' paa et startet loeb stempler ikke", async () => {
  const supabase = raceStub({ stages_completed: 1 });
  const out = await bindLetGo(supabase, { letGoOrder7557: true });
  assert.equal("letGoOrder7557" in out, false);
  assert.equal(supabase.state.writes, 0);
});

test("#7557: et stemplet loeb koerer faerdigt, ogsaa med slukket kontakt og fejl i opslaget", async () => {
  const supabase = raceStub({ stages_completed: 4, [LET_GO]: true });
  const off = await bindLetGo(supabase, {}, { firstStageClaim: false, readStage: async () => "off" });
  assert.equal(off.letGoOrder7557, true);
  const failing = await bindLetGo(supabase, {}, { firstStageClaim: false, readStage: async () => { throw new Error("boom"); } });
  assert.equal(failing.letGoOrder7557, true);
});

test("#7557: noedstop fjerner reglen fra et stemplet loeb", async () => {
  const supabase = raceStub({ stages_completed: 4, [LET_GO]: true });
  const out = await bindLetGo(supabase, {}, { firstStageClaim: false, readStage: async () => "stop" });
  assert.equal("letGoOrder7557" in out, false);
});

test("#7557: slukket kontakt paa et nyt loeb skriver intet", async () => {
  const supabase = raceStub({ stages_completed: 0 });
  const engine = {};
  assert.equal(await bindLetGo(supabase, engine), engine);
  assert.equal(supabase.state.writes, 0);
});

test("#7557: aeldre revision og v3-motor roeres ikke", async () => {
  const supabase = raceStub({ stages_completed: 0 });
  const out = await bindLetGo(supabase, { letGoOrder7557: true }, { rulesRevision: "s5_profiles_v2" });
  assert.equal("letGoOrder7557" in out, false);
  assert.equal(await bindLetGo(supabase, null), null);
  assert.equal(supabase.state.writes, 0);
});

test("#7557: manglende kolonne er slukket, anden DB-fejl kaster", async () => {
  const missing = raceStub({}, { readError: { code: "42703", message: `column races.${LET_GO} does not exist` } });
  assert.equal("letGoOrder7557" in await bindLetGo(missing, { letGoOrder7557: true }), false);
  const broken = raceStub({}, { readError: { code: "500", message: "boom" } });
  await assert.rejects(bindLetGo(broken, { letGoOrder7557: true }), /kunne ikke laeses/);
});

test("#7557: dryRun skriver aldrig, men previewer reglen", async () => {
  const supabase = raceStub({ stages_completed: 0 });
  const out = await bindLetGo(supabase, { letGoOrder7557: true }, { dryRun: true });
  assert.equal(out.letGoOrder7557, true);
  assert.equal(supabase.state.writes, 0);
});

test("#7557: er loebet startet imens, gaelder den gemte vaerdi", async () => {
  const supabase = raceStub({ stages_completed: 0 });
  const update = supabase.from;
  supabase.from = () => {
    const client = update();
    const original = client.update;
    client.update = (obj) => { supabase.state.row.stages_completed = 1; return original(obj); };
    return client;
  };
  const out = await bindLetGo(supabase, { letGoOrder7557: true });
  assert.equal("letGoOrder7557" in out, false);
});

test("#7733: foerste claim stempler kun med taendt kontakt, og fejl i opslaget er slukket", async () => {
  const on = raceStub({ stages_completed: 0 });
  assert.equal(await bindStartedFieldLock7733({ supabase: on, race: RACE, firstStageClaim: true, checkEnabled: async () => true }), true);
  assert.equal(on.state.row[LOCK], true);
  const off = raceStub({ stages_completed: 0 });
  assert.equal(await bindStartedFieldLock7733({ supabase: off, race: RACE, firstStageClaim: true, checkEnabled: async () => false }), false);
  const failing = raceStub({ stages_completed: 0 });
  assert.equal(await bindStartedFieldLock7733({ supabase: failing, race: RACE, firstStageClaim: true, checkEnabled: async () => { throw new Error("boom"); } }), false);
  assert.equal(off.state.writes + failing.state.writes, 0);
});

test("#7733: et startet loeb stemples aldrig", async () => {
  const supabase = raceStub({ stages_completed: 2 });
  assert.equal(await bindStartedFieldLock7733({ supabase, race: RACE, firstStageClaim: false, checkEnabled: async () => true }), false);
  assert.equal(await bindStartedFieldLock7733({ supabase, race: RACE, firstStageClaim: true, checkEnabled: async () => true }), false);
  assert.equal(supabase.state.writes, 0);
});

test("#7733: stemplet afgoer fra etape 2, kontakten goer ikke, og stop fjerner det", async () => {
  const stamped = raceStub({ stages_completed: 2, [LOCK]: true });
  assert.equal(await raceHasStartedFieldLock7733({ supabase: stamped, race: RACE, readStage: async () => "off" }), true);
  assert.equal(await raceHasStartedFieldLock7733({ supabase: stamped, race: RACE, readStage: async () => { throw new Error("boom"); } }), true);
  assert.equal(await raceHasStartedFieldLock7733({ supabase: stamped, race: RACE, readStage: async () => "stop" }), false);
  const plain = raceStub({ stages_completed: 2 });
  assert.equal(await raceHasStartedFieldLock7733({ supabase: plain, race: RACE, readStage: async () => "on" }), false);
});

test("#7730: en jag-ordre taeller, ogsaa uden etapeinteresse", () => {
  assert.equal(floorChaseWanted7730(null, [{ breakaway_stance: "chase" }]), true);
  assert.equal(floorChaseWanted7730(false, [{ breakaway_stance: "let_go" }, { breakaway_stance: "neutral" }]), false);
  assert.equal(floorChaseWanted7730(undefined, []), false);
  assert.equal(floorChaseWanted7730({ teamIds: ["a"] }, []), true);
  assert.equal(floorChaseWanted7730({ teamIds: [] }, [{ breakaway_stance: "chase" }]), true, "holdet ville jage, men har egen mand foran");
  assert.equal(floorChaseWanted7730({ teamIds: [] }, [{ breakaway_stance: "let_go" }]), false);
});

// Bindingen skal staa paa begge afviklings-veje. Forsvinder et kald, rammer kontakten loeb i gang.
test("#7557/#7733: raceRunner binder paa begge veje", () => {
  const source = readFileSync(new URL("./raceRunner.js", import.meta.url), "utf8");
  assert.equal(source.match(/await bindLetGoOrder7557\(\{/g)?.length, 2, "helt-loeb og etape-stien");
  assert.equal(source.match(/await bindStartedFieldLock7733\(\{/g)?.length, 1, "etape-stien");
  assert.match(source, /stageIndex > 0 && await readStartedFieldLock7733\(\{ supabase, race \}\) === true/, "kun fra etape 2, og en laesefejl sluges ikke");
});
