// #7947: alle træninger på Let/Mellem/Hård bag kontakten training_effort_levels (PR 1 af 4).
//
// Fem krav (Fable-design 20/11), bevist mod en FROSSET golden fra merge-basen (#7587):
//   1. off = bit-identisk: lib-matricen og en hel dato gennem motoren er basens svar.
//   2. on + standardniveau/ingen indsats-nøgle = off: samme delmængde, samme svar som basen.
//   3. on + andet niveau = motorens udfald for det rå par (session, indsats).
//   4. rækker med indsats-nøgler læst under off giver standardniveau og er gyldige programrækker.
//   5. hvile, restitution, løbsfelt og træthedsreglen er uændrede.
// Kun fingeraftryk og kvalitative udfald i repoet (regel 17).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  TRAINING_EFFORT_LEVELS_KEY, EFFORT_LEVELS, isEffortLevel, effortForDayEntry, isTrainingEffortLevelsEnabled,
} from "./trainingEffortLevels.js";
import { TRAINING_LEVELS, programForChoice, normalizeProgram, SESSION_INTENSITY } from "./trainingDayTypes.js";
import {
  isValidProgramWeekDays, setProgramCell, stripProgramFromWeekDays, resolveDayProgram, programWeekDaysFor,
  intensityForSession, programForSession,
} from "./trainingPrograms.js";
import { seedProgramWeekDays } from "./trainingWeekPlanCells.js";
import { STAGE_FLAGS } from "./stageFlagCatalog.js";
import { WEEKDAY_KEYS } from "./training.js";
import {
  libDigests, programForChoiceCases, normalizeProgramCases, resolveDayProgramCases, engineDigest, rawPairDigest,
  ENGINE_SPECS, hashOf,
} from "./trainingEffortLevels7947.golden.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = JSON.parse(readFileSync(join(here, "trainingEffortLevels7947.golden.json"), "utf8"));
const repoRoot = join(here, "..", "..");

// Stedfortræderen skriver advarsler om manglende private parametre; de er ikke testens sag.
const quiet = async (fn) => {
  const { warn, log } = console;
  console.warn = () => {}; console.log = () => {};
  try { return await fn(); } finally { console.warn = warn; console.log = log; }
};

const ON = { training_effort_levels: "on" };

// ── Kontakten og grundbegreberne ─────────────────────────────────────────────────────────────
test("kontakten: kun den eksakte værdi on tænder; manglende, beta, true, off og fejl er slukket", async () => {
  const fake = (value, { error = null, throws = false } = {}) => ({
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => {
      if (throws) throw new Error("down");
      return { data: value === undefined ? null : { value }, error };
    } }) }) }),
  });
  assert.equal(await isTrainingEffortLevelsEnabled(fake("on")), true);
  for (const value of [undefined, "off", "beta", true, false, "ON"]) {
    assert.equal(await isTrainingEffortLevelsEnabled(fake(value)), false, String(value));
  }
  assert.equal(await isTrainingEffortLevelsEnabled(fake("on", { error: { message: "x" } })), false);
  assert.equal(await isTrainingEffortLevelsEnabled(fake("on", { throws: true })), false);
  assert.equal(await isTrainingEffortLevelsEnabled(null), false);
});

test("kontakten står i admin-kataloget og seedes off af en additiv, idempotent migration", () => {
  assert.ok(STAGE_FLAGS.some((f) => f.key === TRAINING_EFFORT_LEVELS_KEY && f.area === "training"));
  const sql = readFileSync(join(repoRoot, "database", "2026-11-20-7947-training-effort-levels-flag.sql"), "utf8");
  assert.match(sql, /'training_effort_levels',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
});

test("indsatsniveauerne er sessionernes niveauer; feltets indsats vinder over dagens", () => {
  assert.deepEqual([...EFFORT_LEVELS], [...TRAINING_LEVELS]);
  for (const v of [null, undefined, "rest", "recovery", "bogus", 2]) assert.equal(isEffortLevel(v), false);
  const entry = { session: "tempo", intensity: "normal", effort: "hard", slotEfforts: [null, "easy", "bogus"] };
  assert.equal(effortForDayEntry(entry, 0), "hard");
  assert.equal(effortForDayEntry(entry, 1), "easy");
  assert.equal(effortForDayEntry(entry, 2), "hard", "ugyldig feltindsats = følg dagen");
  assert.equal(effortForDayEntry(entry, 4), "hard");
  assert.equal(effortForDayEntry({ session: "tempo", intensity: "normal" }, 0), null);
  assert.equal(effortForDayEntry({ session: "tempo", intensity: "normal", effort: "bogus" }, 0), null);
  assert.equal(effortForDayEntry(null, 0), null);
});

test("SESSION_INTENSITY er urørt: cellens intensity er fortsat sessionens standardniveau", () => {
  for (const [session, level] of Object.entries(SESSION_INTENSITY)) assert.equal(intensityForSession(session), level);
});

// ── Krav 1: off = bit-identisk med den frosne base ───────────────────────────────────────────
test("krav 1: off = lib-matricen er basens (alle sessioner x katalog v2/v3 x felter)", () => {
  const now = libDigests();
  for (const fn of Object.keys(GOLDEN.lib)) {
    assert.equal(now[fn].all, GOLDEN.lib[fn].all, `${fn} (merge-base ${GOLDEN.mergeBase})`);
    if (GOLDEN.lib[fn].count != null) assert.equal(now[fn].count, GOLDEN.lib[fn].count, `${fn} count`);
  }
});

test("krav 1: off = en hel dato gennem motoren er basens, også med indsats-nøgler i rækkerne", async () => {
  for (const spec of ENGINE_SPECS) {
    for (const flags of [{}, { training_effort_levels: "off" }, { training_effort_levels: "beta" }]) {
      const got = await quiet(() => engineDigest(spec, { flags }));
      assert.equal(got, GOLDEN.engine[spec], `${spec} ${JSON.stringify(flags)}`);
    }
  }
});

// ── Krav 2: on + standardniveau / ingen indsats = off ────────────────────────────────────────
test("krav 2: on + standardniveau eller ingen indsats = basens svar for hele matricen", () => {
  const pick = (cases) => cases.filter((c) => c.standard).map((c) => [c.id, c.result]);
  const same = (name, cases) => {
    const base = GOLDEN.lib[name].standard;
    const now = hashOf(pick(cases));
    assert.equal(now, base, name);
  };
  same("programForChoice", programForChoiceCases({ effortLevels: true }));
  same("normalizeProgram", normalizeProgramCases({ effortLevels: true }));
  same("resolveDayProgram", resolveDayProgramCases({ effortLevels: true }));
});

// PR 4: med kontakten on faar score-raekken det koerte niveau (intensity). Det er den eneste
// forskel; uden kolonnen er datoen stadig basens (niveauet selv proeves i "PR 4"-testene).
test("krav 2 og 5: on + standardniveau, hvile, restitution og løbsfelt = basens hele dato", async () => {
  for (const spec of ["plain", "standard", "ignored"]) {
    assert.equal(await quiet(() => engineDigest(spec, { flags: ON, withoutExecutedLevel: true })), GOLDEN.engine[spec], spec);
  }
});

// ── Krav 3: on + andet niveau = motorens udfald for det rå par ───────────────────────────────
test("krav 3: on + andet niveau giver præcis det rå par (session, indsats) i alle fire lib-funktioner", () => {
  let checked = 0;
  for (const c of programForChoiceCases({ effortLevels: true }).filter((x) => !x.standard)) {
    assert.equal(c.result.ok, true, c.id);
    assert.equal(c.result.intensity, c.effort, c.id);
    checked++;
  }
  for (const c of normalizeProgramCases({ effortLevels: true }).filter((x) => !x.standard)) {
    assert.equal(c.result.focus, c.program.focus, c.id);
    assert.equal(c.result.intensity, c.program.intensity, c.id);
    assert.equal(c.result.changed, false, c.id);
    checked++;
  }
  for (const c of resolveDayProgramCases({ effortLevels: true }).filter((x) => !x.standard)) {
    assert.deepEqual(c.result, { focus: c.off.focus, intensity: c.chosen, source: "program" }, c.id);
    checked++;
  }
  assert.ok(checked > 1000, "matricen rammer mange ikke-standard tilfælde");
});

test("krav 3: en hel dato med en programcelle på andet niveau = samme dato med det rå par som plan", async () => {
  const other = await quiet(() => engineDigest("other", { flags: ON }));
  assert.notEqual(other, GOLDEN.engine.other, "et andet niveau ændrer udfaldet (ellers tester vi ingenting)");
  // PR 4: kun programcellernes vej gemmer det koerte niveau paa scoren; udfaldet er det samme.
  const cells = await quiet(() => rawPairDigest("cells", { flags: ON, withoutExecutedLevel: true }));
  const plans = await quiet(() => rawPairDigest("plans", { flags: ON, withoutExecutedLevel: true }));
  assert.equal(cells, plans);
  // Og med kontakten off læses cellen på standardniveau, så de to veje skilles.
  assert.notEqual(await quiet(() => rawPairDigest("cells", { flags: {} })), plans);
});

// ── Krav 4: rækker med indsats-nøgler under off ──────────────────────────────────────────────
function weekWithEfforts() {
  const days = programWeekDaysFor("balanced_week");
  days.mon = { ...days.mon, effort: "hard", slotEfforts: [null, "easy", null, null, "normal"] };
  days.wed = { ...days.wed, effort: "easy" };
  return days;
}

test("krav 4: indsats-nøgler er gyldige programrækker uanset kontakten; ugyldige værdier afvises", () => {
  assert.equal(isValidProgramWeekDays(weekWithEfforts()), true);
  const bad = (patch) => ({ ...weekWithEfforts(), mon: { ...weekWithEfforts().mon, ...patch } });
  assert.equal(isValidProgramWeekDays(bad({ effort: "rest" })), false);
  assert.equal(isValidProgramWeekDays(bad({ effort: "bogus" })), false);
  assert.equal(isValidProgramWeekDays(bad({ slotEfforts: "hard" })), false);
  assert.equal(isValidProgramWeekDays(bad({ slotEfforts: [null, null, null, null, null, "hard"] })), false);
  assert.equal(isValidProgramWeekDays(bad({ slotEfforts: [null, "recovery"] })), false);
  assert.equal(isValidProgramWeekDays(bad({ effort: null, slotEfforts: null })), true);
  // Cellens intensity skal stadig være sessionens standardniveau.
  assert.equal(isValidProgramWeekDays(bad({ intensity: "hard", effort: "hard" })), weekWithEfforts().mon.intensity === "hard");
});

test("krav 4: under off læses en række med indsats-nøgler på standardniveau i hvert felt", () => {
  const days = weekWithEfforts();
  for (let slotIndex = 0; slotIndex < 5; slotIndex++) {
    const args = { weekday: "mon", slotIndex, riderOverrideDays: days, teamWeekDays: null, program: { focus: "threshold", intensity: "normal" }, programsOn: true };
    const off = resolveDayProgram(args);
    assert.equal(off.intensity, intensityForSession(days.mon.session), `slot ${slotIndex}`);
    const on = resolveDayProgram({ ...args, effortLevels: true });
    assert.equal(on.intensity, effortForDayEntry(days.mon, slotIndex), `slot ${slotIndex} on`);
  }
});

test("setProgramCell: uden indsats er cellen urørt; med indsats sættes, nulstilles og normaliseres den", () => {
  const days = weekWithEfforts();
  // Uden effort-argument: indsats-nøglerne følger med uændret.
  const moved = setProgramCell(days, { weekday: "mon", session: "sprint" });
  assert.equal(moved.mon.session, "sprint");
  assert.equal(moved.mon.intensity, "hard");
  assert.equal(moved.mon.effort, "hard");
  assert.deepEqual(moved.mon.slotEfforts, [null, "easy", null, null, "normal"]);
  assert.notEqual(moved.mon.slotEfforts, days.mon.slotEfforts, "en ny kopi, ikke samme array");
  // Dagens indsats sat og fjernet.
  assert.equal(setProgramCell(days, { weekday: "wed", session: "tempo", effort: "hard" }).wed.effort, "hard");
  assert.equal("effort" in setProgramCell(days, { weekday: "wed", session: "tempo", effort: null }).wed, false);
  // Et felts indsats lig dagens er "følg dagen"; alle null fjerner listen.
  const slot = setProgramCell(days, { weekday: "mon", slotIndex: 1, session: "sprint", effort: "hard" });
  assert.deepEqual(slot.mon.slotEfforts, [null, null, null, null, "normal"]);
  const cleared = setProgramCell(slot, { weekday: "mon", slotIndex: 4, session: days.mon.session, effort: null });
  assert.equal("slotEfforts" in cleared.mon, false);
  // Ugyldig indsats afvises.
  assert.equal(setProgramCell(days, { weekday: "mon", session: "sprint", effort: "rest" }), null);
  assert.equal(setProgramCell(days, { weekday: "mon", session: "sprint", effort: "bogus" }), null);
  assert.equal(isValidProgramWeekDays(slot), true);
});

test("stripProgramFromWeekDays fjerner indsats-nøglerne med programcellen; kopien bevarer dem", () => {
  const stripped = stripProgramFromWeekDays(weekWithEfforts());
  for (const weekday of WEEKDAY_KEYS) {
    assert.deepEqual(Object.keys(stripped[weekday]), ["intensity"], weekday);
  }
  const seeded = seedProgramWeekDays({ riderDays: weekWithEfforts() });
  assert.deepEqual(seeded, weekWithEfforts());
});

// ── Krav 5: hvile, restitution og løbsfelt ───────────────────────────────────────────────────
test("krav 5: hvile og restitution ignorerer indsatsen, også med kontakten on", () => {
  for (const effort of EFFORT_LEVELS) {
    assert.deepEqual(programForChoice({ dayType: "rest", previousFocus: "sprint", effort, effortLevels: true }),
      programForChoice({ dayType: "rest", previousFocus: "sprint" }));
    assert.deepEqual(programForChoice({ dayType: "recovery", effort, effortLevels: true }), programForChoice({ dayType: "recovery" }));
    assert.deepEqual(programForSession("rest", "sprint", { effort, effortLevels: true }), programForSession("rest", "sprint"));
    assert.deepEqual(programForSession("recovery", null, { effort, effortLevels: true }), programForSession("recovery"));
    assert.deepEqual(normalizeProgram({ focus: "sprint", intensity: "rest" }, { effortLevels: true }), normalizeProgram({ focus: "sprint", intensity: "rest" }));
  }
});

test("on: færdighedsdage kan køres på alle niveauer (håndværkets loft sidder i motoren, urørt)", () => {
  for (const session of ["technique", "aero", "loebslaere"]) {
    for (const effort of EFFORT_LEVELS) {
      assert.deepEqual(programForChoice({ dayType: "skill", session, effort, effortLevels: true }), { ok: true, focus: session, intensity: effort });
    }
  }
});

