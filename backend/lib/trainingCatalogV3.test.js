// #5319 · Træningskatalog v3: invarianter (spec §2) + flag-off bit-identitet.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  TRAINING_FOCUSES, FOCUS_ABILITY_WEIGHT, SMART_DEFAULT_FOCUS_KEYS, TRAINING_FOCUS_KEYS,
  programAbilityWeight, focusAbilityWeight,
} from "./training.js";
import {
  TRAINING_SESSIONS_BY_LEVEL, SESSION_INTENSITY, ALL_SESSIONS, sessionsForDayType, programForChoice,
  normalizeProgram, TRAINING_SESSIONS_BY_LEVEL_V3, SESSION_INTENSITY_V3,
} from "./trainingDayTypes.js";
import { resolveDayProgram, isProgramSession, intensityForSession, PROGRAM_SESSIONS } from "./trainingPrograms.js";
import { abilityMult } from "./dailyTraining.js";
import { RIDER_TYPE_KEYS } from "./riderTypes.js";
import {
  TRAINING_CATALOG_V3_FLAG_KEY, V3_NEW_HARD_SESSIONS, V3_TRAINING_FOCUSES, V3_FOCUS_ABILITY_WEIGHT,
  V3_RIDER_TYPE_HARD_PAIRS, v3FocusAbilityWeight, v3FocusWeightSum, applyTrainingCatalog,
  isV3OnlySession, isTrainingCatalogV3Enabled, isTrainingCatalogV3EnabledForTeam,
} from "./trainingCatalogV3.js";
import { STAGE_FLAGS, PLAYER_VISIBLE_FLAG_KEYS } from "./stageFlagCatalog.js";

const here = path.dirname(fileURLToPath(import.meta.url));

// ── Dagens katalog, skrevet ud som facit. Flag off SKAL give præcis dette. ──
const TODAY_FOCUSES = {
  vo2max: ["climbing", "punch", "tempo"],
  vo2max_climb: ["climbing", "tempo"],
  vo2max_punch: ["punch", "tempo"],
  threshold: ["time_trial", "tempo"],
  sprint: ["sprint", "acceleration"],
  endurance: ["endurance", "recovery", "durability"],
  technique: ["descending", "cobblestone"],
  aero: ["time_trial", "flat"],
  tempo: ["tempo", "flat", "durability"],
  restitution: ["recovery"],
  loebslaere: ["positioning", "tactics", "aggression"],
  cobbled_sectors: ["cobblestone", "durability", "positioning"],
  echelon_drills: ["flat", "positioning", "durability"],
  attack_repeats: ["aggression", "punch", "acceleration"],
};
const TODAY_WEIGHTS = {
  vo2max_climb: { climbing: 2, tempo: 1 },
  vo2max_punch: { punch: 2, tempo: 1 },
  cobbled_sectors: { cobblestone: 1, durability: 1, positioning: 1 },
  echelon_drills: { flat: 1, positioning: 1, durability: 1 },
  attack_repeats: { aggression: 1, punch: 1, acceleration: 1 },
};
const TODAY_HARD = [
  "vo2max", "vo2max_climb", "vo2max_punch", "threshold", "sprint",
  "cobbled_sectors", "echelon_drills", "attack_repeats",
];

test("flag off: dagens tabeller er bit-identiske med facit (ingen v3-nøgle siver ind)", () => {
  assert.deepEqual(JSON.parse(JSON.stringify(TRAINING_FOCUSES)), TODAY_FOCUSES);
  assert.deepEqual(JSON.parse(JSON.stringify(FOCUS_ABILITY_WEIGHT)), TODAY_WEIGHTS);
  assert.deepEqual([...TRAINING_FOCUS_KEYS], Object.keys(TODAY_FOCUSES));
  assert.deepEqual([...TRAINING_SESSIONS_BY_LEVEL.hard], TODAY_HARD);
  assert.deepEqual([...TRAINING_SESSIONS_BY_LEVEL.easy], ["endurance"]);
  assert.deepEqual([...TRAINING_SESSIONS_BY_LEVEL.normal], ["tempo"]);
  for (const s of V3_NEW_HARD_SESSIONS) {
    assert.equal(s in SESSION_INTENSITY, false, `${s} må ikke stå i dagens SESSION_INTENSITY`);
    assert.equal(ALL_SESSIONS.includes(s), false);
    assert.equal(PROGRAM_SESSIONS.includes(s), false);
  }
  assert.deepEqual([...sessionsForDayType("training")], ["endurance", "tempo", ...TODAY_HARD]);
});

test("flag off: SMART_DEFAULT_FOCUS_KEYS er urørt", () => {
  assert.deepEqual([...SMART_DEFAULT_FOCUS_KEYS], ["vo2max", "threshold", "sprint", "endurance", "technique", "aero"]);
});

test("flag off: applyTrainingCatalog returnerer programmet uroert, og abilityMult er som i dag", () => {
  for (const focus of [...TODAY_HARD, "endurance", "tempo", "technique", "aero", "loebslaere"]) {
    const program = { focus, intensity: SESSION_INTENSITY[focus] };
    const before = JSON.stringify(program);
    const out = applyTrainingCatalog(program, { v3: false });
    assert.equal(out, program);
    assert.equal(JSON.stringify(out), before);
    for (const ability of ["time_trial", "tempo", "endurance", "sprint", "acceleration", "climbing"]) {
      const inFocus = TODAY_FOCUSES[focus].includes(ability);
      const expected = inFocus ? null : 0.35;
      const got = abilityMult(ability, out);
      if (expected != null) assert.equal(got, expected);
      else assert.equal(got, abilityMult(ability, { focus, intensity: SESSION_INTENSITY[focus] }));
    }
  }
});

test("flag off: en v3-session kan hverken vælges eller træne", () => {
  for (const s of V3_NEW_HARD_SESSIONS) {
    assert.equal(programForChoice({ dayType: "training", session: s }).ok, false);
    assert.equal(normalizeProgram({ focus: s, intensity: "hard" }).focus, "endurance");
    const days = { mon: { session: s, intensity: "hard" } };
    const out = resolveDayProgram({
      weekday: "mon", riderOverrideDays: days, teamWeekDays: null,
      program: { focus: "endurance", intensity: "easy" }, programsOn: true,
    });
    assert.equal(out.source, "legacy");
    assert.equal(out.focus, "endurance");
  }
});

// ── v3-invarianter (spec §2) ────────────────────────────────────────────────
const V3_HARD = TRAINING_SESSIONS_BY_LEVEL_V3.hard;

test("v3: de fem nye sessioner står efter attack_repeats, dagens rækkefølge uændret", () => {
  assert.deepEqual([...V3_HARD], [...TODAY_HARD, ...V3_NEW_HARD_SESSIONS]);
  assert.deepEqual([...V3_NEW_HARD_SESSIONS], ["long_climbs", "lead_out", "itt_short", "itt_long", "cobbled_classic"]);
  for (const s of V3_HARD) assert.equal(SESSION_INTENSITY_V3[s], "hard");
});

test("v3: alle hårde sessioner har vægtsum 3, ingen evne over 2", () => {
  assert.equal(V3_HARD.length, 13);
  for (const s of V3_HARD) {
    assert.equal(v3FocusWeightSum(s), 3, `${s}: vægtsum`);
    for (const a of V3_TRAINING_FOCUSES[s]) assert.ok(v3FocusAbilityWeight(s, a) <= 2, `${s}.${a} > 2`);
  }
});

test("v3: ingen session træner både enkeltstart og tempo", () => {
  for (const [s, abilities] of Object.entries(V3_TRAINING_FOCUSES)) {
    assert.ok(!(abilities.includes("time_trial") && abilities.includes("tempo")), `${s}`);
  }
});

test("v3: hver rytter-type har præcis 2 hårde sessioner, og alle nye/specialiserede bruges", () => {
  assert.deepEqual(Object.keys(V3_RIDER_TYPE_HARD_PAIRS).sort(), [...RIDER_TYPE_KEYS].sort());
  for (const [type, pair] of Object.entries(V3_RIDER_TYPE_HARD_PAIRS)) {
    assert.equal(pair.length, 2, type);
    assert.equal(new Set(pair).size, 2, type);
    for (const s of pair) assert.ok(V3_HARD.includes(s), `${type}: ${s} er ikke hård`);
  }
  const used = new Set(Object.values(V3_RIDER_TYPE_HARD_PAIRS).flat());
  for (const s of V3_HARD) {
    if (s === "vo2max") assert.equal(used.has(s), false, "hybriden er ikke par for nogen");
    else assert.ok(used.has(s), `${s} er ikke par for nogen type`);
  }
});

test("v3: ændringerne er præcis spec'ens (tærskel, spurt; navneskift uden vægt-ændring)", () => {
  assert.deepEqual([...V3_TRAINING_FOCUSES.threshold], ["tempo", "endurance"]);
  assert.deepEqual({ ...V3_FOCUS_ABILITY_WEIGHT.threshold }, { tempo: 2, endurance: 1 });
  assert.deepEqual({ ...V3_FOCUS_ABILITY_WEIGHT.sprint }, { sprint: 2, acceleration: 1 });
  assert.deepEqual(V3_TRAINING_FOCUSES.vo2max_climb, TRAINING_FOCUSES.vo2max_climb);
  assert.deepEqual(V3_FOCUS_ABILITY_WEIGHT.vo2max_climb, FOCUS_ABILITY_WEIGHT.vo2max_climb);
  assert.deepEqual(V3_TRAINING_FOCUSES.vo2max_punch, TRAINING_FOCUSES.vo2max_punch);
  assert.deepEqual(V3_FOCUS_ABILITY_WEIGHT.vo2max_punch, FOCUS_ABILITY_WEIGHT.vo2max_punch);
  // Ejer-valg 1A: hovedevnen 1,5 i de tre nye enkeltstart-/brostenssessioner.
  assert.equal(v3FocusAbilityWeight("itt_short", "time_trial"), 1.5);
  assert.equal(v3FocusAbilityWeight("itt_long", "time_trial"), 1.5);
  assert.equal(v3FocusAbilityWeight("cobbled_classic", "cobblestone"), 1.5);
  // Ikke-hårde sessioner er uændrede.
  for (const s of ["endurance", "tempo", "technique", "aero", "loebslaere", "restitution"]) {
    assert.deepEqual(V3_TRAINING_FOCUSES[s], TRAINING_FOCUSES[s]);
  }
});

test("v3 on: motoren træner v3-evnerne med v3-vægtene", () => {
  const threshold = applyTrainingCatalog({ focus: "threshold", intensity: "hard" }, { v3: true });
  assert.deepEqual([...threshold.focusAbilities], ["tempo", "endurance"]);
  assert.equal(abilityMult("time_trial", threshold), 0.35, "enkeltstart er off-fokus i v3-tærskel");
  assert.equal(abilityMult("tempo", threshold), 1.6 * 2);
  assert.equal(abilityMult("endurance", threshold), 1.6 * 1);
  const itt = applyTrainingCatalog({ focus: "itt_long", intensity: "hard" }, { v3: true });
  assert.equal(abilityMult("time_trial", itt), 1.6 * 1.5);
  assert.equal(programAbilityWeight(itt, "endurance"), 1.5);
  const sprint = applyTrainingCatalog({ focus: "sprint", intensity: "hard" }, { v3: true });
  assert.equal(abilityMult("sprint", sprint), 1.6 * 2);
  // Sessioner v3 ikke ændrer, er uroerte ogsaa med flaget on.
  const climb = { focus: "vo2max_climb", intensity: "hard" };
  assert.equal(applyTrainingCatalog(climb, { v3: true }).focusWeights, undefined);
  assert.equal(programAbilityWeight(climb, "climbing"), focusAbilityWeight("vo2max_climb", "climbing"));
  // Løbsdagens pas (egen evne-liste) røres aldrig.
  const race = { focus: "threshold", intensity: "hard", focusAbilities: ["flat"] };
  assert.deepEqual(applyTrainingCatalog(race, { v3: true }).focusAbilities, ["flat"]);
});

test("v3 on: skrive- og læsestien accepterer de nye sessioner", () => {
  for (const s of V3_NEW_HARD_SESSIONS) {
    assert.ok(isV3OnlySession(s));
    assert.ok(isProgramSession(s));
    assert.equal(intensityForSession(s), "hard");
    assert.deepEqual(programForChoice({ dayType: "training", session: s, catalogV3: true }), { ok: true, focus: s, intensity: "hard" });
    assert.equal(normalizeProgram({ focus: s, intensity: "hard" }, { catalogV3: true }).focus, s);
    assert.equal(programForChoice({ dayType: "rest", previousFocus: s, catalogV3: true }).focus, s);
    const out = resolveDayProgram({
      weekday: "mon", riderOverrideDays: { mon: { session: s, intensity: "hard" } }, teamWeekDays: null,
      program: { focus: "endurance", intensity: "easy" }, programsOn: true, catalogV3: true,
    });
    assert.deepEqual(out, { focus: s, intensity: "hard", source: "program" });
  }
  assert.equal(isV3OnlySession("threshold"), false);
  assert.equal(isV3OnlySession(null), false);
});

// ── Flag-læsere ──────────────────────────────────────────────────────────
function mockSupabase({ flag, user = null, team = { user_id: "u1" }, flagError = null }) {
  return {
    from(table) {
      const rows = { app_config: { value: flag }, teams: team, users: user };
      const chain = {
        select: () => chain,
        eq: () => chain,
        maybeSingle: async () => (table === "app_config" && flagError
          ? { data: null, error: { message: flagError } }
          : { data: rows[table] ?? null, error: null }),
      };
      return chain;
    },
  };
}

test("isTrainingCatalogV3EnabledForTeam: on / beta-ejer / ikke-beta / off / manglende, og KAST ved fejl", async () => {
  assert.equal(await isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: "on" }), "t"), true);
  assert.equal(await isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: true }), "t"), true);
  assert.equal(await isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: "beta", user: { is_beta_tester: true } }), "t"), true);
  assert.equal(await isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: "beta", user: { role: "admin" } }), "t"), true);
  assert.equal(await isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: "beta", user: { is_beta_tester: false } }), "t"), false);
  assert.equal(await isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: "beta", team: { user_id: null } }), "t"), false);
  assert.equal(await isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: "off" }), "t"), false);
  assert.equal(await isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: null }), "t"), false);
  await assert.rejects(isTrainingCatalogV3EnabledForTeam(mockSupabase({ flag: "on", flagError: "boom" }), "t"), /training_catalog_v3/);
});

test("isTrainingCatalogV3Enabled: viewer-gate, fail-safe off", async () => {
  assert.equal(await isTrainingCatalogV3Enabled(mockSupabase({ flag: "on" })), true);
  assert.equal(await isTrainingCatalogV3Enabled(mockSupabase({ flag: "beta" }), { isBetaTester: true }), true);
  assert.equal(await isTrainingCatalogV3Enabled(mockSupabase({ flag: "beta" })), false);
  assert.equal(await isTrainingCatalogV3Enabled(null), false);
});

test("drift-vagt: frontendens v3-spejl matcher backend præcist", async () => {
  const fe = await import("../../frontend/src/lib/training.js");
  const feDays = await import("../../frontend/src/lib/trainingDayTypes.js");
  assert.deepEqual([...fe.V3_NEW_HARD_SESSIONS], [...V3_NEW_HARD_SESSIONS]);
  assert.deepEqual(JSON.parse(JSON.stringify(fe.TRAINING_FOCUS_ABILITIES_V3)), JSON.parse(JSON.stringify(V3_TRAINING_FOCUSES)));
  assert.deepEqual(JSON.parse(JSON.stringify(feDays.TRAINING_SESSIONS_BY_LEVEL_V3)), JSON.parse(JSON.stringify(TRAINING_SESSIONS_BY_LEVEL_V3)));
  assert.deepEqual({ ...feDays.SESSION_INTENSITY_V3 }, { ...SESSION_INTENSITY_V3 });
  // Off: frontendens visning er dagens katalog.
  assert.deepEqual(fe.focusAbilitiesFor("threshold", { catalogV3: false }), TODAY_FOCUSES.threshold);
  assert.deepEqual([...fe.focusAbilitiesFor("threshold", { catalogV3: true })], ["tempo", "endurance"]);
  assert.deepEqual([...fe.focusAbilitiesFor("itt_long", { catalogV3: false })], ["time_trial", "endurance"]);
  assert.equal(feDays.sessionI18nKey("dayPanel.session", "vo2max_climb", false), "dayPanel.session_vo2max_climb");
  assert.equal(feDays.sessionI18nKey("dayPanel.session", "vo2max_climb", true), "dayPanel.sessionV3_vo2max_climb");
  assert.equal(feDays.sessionI18nKey("dayPanel.sessionNote", "threshold", true), "dayPanel.sessionNoteV3_threshold");
  assert.equal(feDays.sessionI18nKey("dayPanel.session", "threshold", true), "dayPanel.session_threshold");
});

test("i18n: alle v3-nøgler findes i alle fem sprog", () => {
  for (const lang of ["en", "da", "es", "fr", "nl"]) {
    const training = JSON.parse(readFileSync(path.join(here, `../../frontend/public/locales/${lang}/training.json`), "utf8"));
    const rider = JSON.parse(readFileSync(path.join(here, `../../frontend/public/locales/${lang}/rider.json`), "utf8"));
    for (const s of V3_NEW_HARD_SESSIONS) {
      assert.ok(training.dayPanel[`session_${s}`], `${lang} session_${s}`);
      assert.ok(training.dayPanel[`sessionNote_${s}`], `${lang} sessionNote_${s}`);
      assert.ok(training.mobile[`sessionShort_${s}`], `${lang} sessionShort_${s}`);
      assert.ok(rider.profile.training.focus[s], `${lang} rider focus ${s}`);
      assert.ok(rider.training[`focus_${s}`], `${lang} rider focus_${s}`);
    }
    for (const s of ["vo2max_climb", "vo2max_punch"]) {
      assert.ok(training.dayPanel[`sessionV3_${s}`], `${lang} sessionV3_${s}`);
      assert.ok(training.mobile[`sessionShortV3_${s}`], `${lang} sessionShortV3_${s}`);
    }
    for (const s of ["threshold", "sprint"]) assert.ok(training.dayPanel[`sessionNoteV3_${s}`], `${lang} sessionNoteV3_${s}`);
    for (const v of Object.values(training.dayPanel)) {
      if (typeof v === "string") assert.ok(!v.includes("—"), `${lang}: em-dash i training.dayPanel`);
    }
  }
});

test("flaget står i STAGE_FLAGS og er spiller-synligt; migrationen seeder 'off' idempotent", () => {
  assert.ok(STAGE_FLAGS.some((f) => f.key === TRAINING_CATALOG_V3_FLAG_KEY && f.area === "training"));
  assert.ok(PLAYER_VISIBLE_FLAG_KEYS.includes(TRAINING_CATALOG_V3_FLAG_KEY));
  const sql = readFileSync(path.join(here, "../../database/2026-10-29-5319-training-catalog-v3-flag.sql"), "utf8");
  assert.match(sql, /'training_catalog_v3',\s*'"off"'::jsonb/);
  assert.match(sql, /ON CONFLICT \(key\) DO NOTHING/);
});
