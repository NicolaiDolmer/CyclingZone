// #7982 trin 4a: the failure path of the press's new code, with a fault in every read.
//
// The judge's set (trainNowSameResult7982.test.js) has a fault test, "fejl i hver laesning", but
// on this branch it stops at its floor of 100 reads (trin 4a removes the reads after the first
// save), so its later checks never run. This file is the builder's own, and runs those checks
// here, plus two that aim straight at the new code:
//   - prefetchPressRaceDays: the later race days' lookups, sent before the first save;
//   - watchReads: a read the first day field tolerates (a warning and a neutral answer) must make
//     the press forget its fetch, so every later day field reads again, as before.
// The judge's files are not touched; this only imports the harness.
import test from "node:test";
import assert from "node:assert/strict";
import { SCENARIOS, runScenario, seedState, createFake, digest, stateDigest } from "./trainNowSameResult7982.harness.js";

const isCommit = (entry) => entry.kind === "rpc" && !entry.holdt && entry.target.endsWith("commit_training_date_tick");
const commitsIn = (entries) => entries.filter(isCommit).length;
// A read is known by its table, its question and how many times the press asked it before.
const slotOf = (entry, counts) => {
  const base = `${entry.target} | ${digest(entry.filters ?? entry.payload ?? null)}`;
  const n = (counts.get(base) ?? 0) + 1;
  counts.set(base, n);
  return `${base} | nr. ${n}`;
};

async function quietly(fn) {
  const saved = { warn: console.warn, error: console.error, info: console.info, log: console.log };
  console.warn = () => {}; console.error = () => {}; console.info = () => {}; console.log = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
}

/** One press of the scenario, as the judge's set runs it, optionally with one read failing. */
async function pressScenario(name, { state = null, fake = null, failSlot = null, mode = "error" } = {}) {
  const ownState = state ?? seedState(SCENARIOS[name].seed);
  let fired = false;
  const seen = new Map();
  const ownFake = fake ?? createFake(ownState, {
    fail: ({ entry }) => {
      if (!failSlot || fired || entry.kind !== "read") return null;
      if (slotOf(entry, seen) !== failSlot) return null;
      fired = true;
      return mode;
    },
  });
  const from = ownFake.log.length;
  const out = [];
  await quietly(() => SCENARIOS[name].run(ownState, ownFake, out));
  assert.equal(out.length, 1, `${name}: the scenario is one press`);
  return { state: ownState, fake: ownFake, response: out[0].response, entries: ownFake.log.slice(from), fired: () => fired };
}

const firstGameDay = (entries) => entries.find(isCommit)?.payload?.p_game_day ?? null;
// A read that asks for a later race day of the date than the day field it was sent in.
const asksLaterRaceDay = (entry, day) => (entry.filters ?? []).some(([op, col, value]) => col === "game_day"
  && ((op === "eq" && Number(value) > day) || (op === "in" && Array.isArray(value) && value.length > 0 && value.every((v) => Number(v) > day))));
const rereadsAbilitiesAfterFirstSave = (entries) => {
  const first = entries.findIndex(isCommit);
  return first >= 0 && entries.slice(first + 1).some((entry) => entry.kind === "read" && entry.target === "rider_derived_abilities");
};

test("fejl i hver laesning (the judge's scenario): every read is hit, most stop the press, and a new press always goes through", async () => {
  const run = await quietly(() => runScenario("fejl_i_hver_laesning"));
  const [asError, asThrow] = run.steps.map((s) => s.response);
  const slots = Object.keys(asError);
  // The judge's floor is 100 (main's press makes 128 reads); trin 4a removes reads after the first
  // save, and this branch's press makes 78. The floor keeps the scenario breaking a real number.
  assert.ok(slots.length >= 70, `only ${slots.length} reads found in the press`);
  assert.deepEqual(Object.keys(asThrow).sort(), [...slots].sort());
  for (const [mode, result] of [["fejlsvar", asError], ["kast", asThrow]]) {
    for (const [slot, r] of Object.entries(result)) assert.equal(r.ramt, true, `${mode}: the read "${slot}" was never sent in the fault run`);
    const stopped = Object.values(result).filter((r) => r.svar === "kast").length;
    assert.ok(stopped >= slots.length * 0.8, `${mode}: most faults stop the press (${stopped} of ${slots.length})`);
    for (const [slot, r] of Object.entries(result)) assert.equal(r.nytTryk, "200", `${mode}: "${slot}": a new press goes through`);
  }
});

// The afternoon press with bound race riders: its first day field fetches the later race days
// ahead. Every read of that first day field (the reads before training are the judge's scenario
// above) is broken once, as an error answer and as a throw.
for (const name of ["bundet_etape_koert"]) {
  test(`${name}: a fault in any read of the first day field (the race days fetched ahead among them) stops the press before it saves, or makes every later day field read again`, async () => {
    const clean = await pressScenario(name);
    assert.equal(clean.response.status, 200, `${name}: the clean press goes through`);
    assert.equal(commitsIn(clean.entries), 5, `${name}: five saves`);
    assert.equal(rereadsAbilitiesAfterFirstSave(clean.entries), false, `${name}: the clean press counts its later day fields from memory`);
    const cleanFinal = stateDigest(clean.state);
    // What a second press answers after one clean press (the date is then trained).
    const cleanAgainStatus = (await pressScenario(name, { state: clean.state, fake: clean.fake })).response.status;
    const day = firstGameDay(clean.entries);
    assert.ok(Number.isInteger(day), `${name}: the first save names its race day`);

    const firstCommit = clean.entries.findIndex(isCommit);
    // The day field re-registers its date (a `gen` call) right after it starts; every read after
    // that and before the first save is one of the first day field's own reads (watchReads).
    const dayFieldStart = clean.entries.findIndex((entry) => entry.gen === true);
    assert.ok(dayFieldStart > 0 && dayFieldStart < firstCommit, `${name}: the first day field re-registers its date before it saves`);
    const counts = new Map();
    const slots = [];
    clean.entries.forEach((entry, i) => {
      if (entry.kind !== "read") return;
      const slot = slotOf(entry, counts);
      if (i > dayFieldStart && i < firstCommit) slots.push({ slot, ahead: asksLaterRaceDay(entry, day) });
    });
    const ahead = slots.filter((s) => s.ahead);
    assert.ok(ahead.length >= 2, `${name}: the press fetches later race days before its first save (${ahead.length} reads)`);

    let tolerated = 0; let stoppedAhead = 0;
    for (const mode of ["error", "throw"]) {
      for (const { slot, ahead: isAhead } of slots) {
        const broken = await pressScenario(name, { failSlot: slot, mode });
        const label = `${name} / ${mode} / ${slot}`;
        assert.equal(broken.fired(), true, `${label}: the read was sent`);
        if (broken.response.status === 200) {
          // A tolerated failure: the day field trained with a neutral answer. The press must not
          // carry that answer on: every later day field reads again (watchReads), as on main.
          tolerated += 1;
          assert.equal(commitsIn(broken.entries), 5, `${label}: five saves`);
          assert.equal(rereadsAbilitiesAfterFirstSave(broken.entries), true, `${label}: the later day fields read again instead of counting from memory`);
        } else {
          // A read before the first save stops the press before anything of the date is trained.
          assert.equal(commitsIn(broken.entries), 0, `${label}: nothing saved after the fault`);
          if (isAhead) stoppedAhead += 1;
        }
        const again = await pressScenario(name, { state: broken.state, fake: broken.fake });
        if (broken.response.status === 200) {
          assert.equal(again.response.status, cleanAgainStatus, `${label}: a second press answers as after a clean press`);
        } else {
          assert.equal(again.response.status, 200, `${label}: a new press goes through`);
          assert.equal(stateDigest(broken.state), cleanFinal, `${label}: the new press ends where one clean press ends`);
        }
      }
    }
    assert.ok(stoppedAhead >= 2, `${name}: a fault in a race day fetched ahead stops the press (${stoppedAhead})`);
    assert.ok(tolerated >= 1, `${name}: at least one tolerated read is broken, so the forget path runs (${tolerated})`);
  });
}
