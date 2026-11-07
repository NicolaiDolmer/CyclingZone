// #6110 trin 2: faste, syntetiske scenarier for "XP-kontakten slukket = bit-identisk".
//
// Delt af developmentXpWiring.test.js og generatoren af den frosne fixture
// (developmentXpOffGolden.json). SAMME fil koeres i merge-basen (foer XP-grenen fandtes)
// og i den nye kode; kun hashes forlader modulet (hard rule 17). Ingen prod-data, ingen rng.
//
// Filen maa kun importere moduler, der fandtes i merge-basen. Det, der er nyt, gives ind
// som `hooks` (fx withRaceDayRoleYield: i basen den gamle funktion, i den nye kode
// withRaceDayRoleYieldXp med kontakten slukket).
//
// XP-raekkerne (kontakt, startdato, params) laegges ind i scenarierne i BEGGE koersler.
// Basen kender dem ikke og ignorerer dem; den nye kode skal goere det samme, saa
// enhver slukket opsaetning (off, beta, on uden startdato, on foer startdatoen, on uden
// eller med ugyldige params) giver basens udfald bit for bit.

import { createHash } from "node:crypto";

import { applyDailyTick, dailyAbilityDelta } from "../dailyTraining.js";
import { runTeamTrainingDay } from "../dailyTrainingEngine.js";
import { VISIBLE_ABILITIES } from "../abilityDerivation.js";
import { TRAINING_FOCUSES } from "../training.js";
import { applyTrainingCatalog, V3_NEW_HARD_SESSIONS } from "../trainingCatalogV3.js";
import { raceDayProgram } from "../raceDayYield.js";
import { RACE_PROFILE_ABILITY_MAP } from "../dailyTraining.js";
import { VALID_RACE_ROLES } from "../raceRoles.js";
import { validateDevelopmentCurveBParams } from "../developmentCurveB.ts";
import { DEVELOPMENT_SCORE_V2_FLAG_KEY, DEVELOPMENT_SCORE_V2_PARAMS_ENV } from "../developmentScoreWiring.js";
import { RACE_DAY_CATCHUP_FLAG_KEY, RACE_DAY_CATCHUP_PARAMS_ENV } from "../raceCatchUpWiring.js";
import { SCORE_PARAMS, CATCHUP_PARAMS } from "../developmentScoreWiring.fixtures.js";

// Hashen skal kunne genskabes paa tvaers af platforme: Node paa Windows og Node paa
// Linux (CI) giver ikke altid samme sidste bit fra Math-funktionerne, saa en raa hash
// var groen lokalt og roed i CI med uaendret kode. Kommatal afrundes derfor til et fast
// antal betydende cifre foer hashen. En reel aendring i den slukkede sti flytter langt
// mere end afrundingen og fanges stadig; hele tal (evner, point) sammenlignes eksakt.
const SIGNIFICANT_DIGITS = 10;
const canonical = (_key, v) => (typeof v === "number" && Number.isFinite(v) && !Number.isInteger(v)
  ? Number(v.toPrecision(SIGNIFICANT_DIGITS)) : v);
const sha = (value) => createHash("sha256").update(JSON.stringify(value, canonical)).digest("hex");

// Syntetiske XP-params (IKKE kalibreringen). Gyldige, saa "on + params" kun er slukket
// af startdatoen eller kontakten selv.
export const XP_TEST_PARAMS = Object.freeze({
  price: { base: 10, exponent: 2 },
  potentialXp: [{ at: 1, value: 10 }, { at: 3, value: 30 }, { at: 6, value: 90 }],
  ageShare: {
    physical: [{ at: 28, value: 1 }, { at: 32, value: 0.5 }, { at: 36, value: 0.1 }],
    mental: [{ at: 32, value: 1 }, { at: 36, value: 0.5 }, { at: 40, value: 0.2 }],
  },
  offFocusShare: 0.1,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.5, andenRolle: 0.3, svaghed: 0.1 },
});

// Syntetiske kurve B-params (samme som developmentCurveB.test.ts).
const CURVE_B = validateDevelopmentCurveBParams({
  rate: 10, levelExponent: 2, capExponent: 0.5,
  load: { fromAge: 16, fullAge: 24, floor: 0.5 },
  potentialCeiling: [0.5, 0.6, 0.7, 0.8, 0.9, 1],
});

// Slukkede XP-opsaetninger. Hver er en liste af app_config-raekker + en private_config-raekke.
export const XP_OFF_OVERLAYS = Object.freeze({
  none: { app: [], params: undefined },
  off: { app: [["development_xp_model", "off"], ["development_xp_from_date", "2026-01-01"]], params: XP_TEST_PARAMS },
  beta: { app: [["development_xp_model", "beta"], ["development_xp_from_date", "2026-01-01"]], params: XP_TEST_PARAMS },
  falseBool: { app: [["development_xp_model", false], ["development_xp_from_date", "2026-01-01"]], params: XP_TEST_PARAMS },
  onNoDate: { app: [["development_xp_model", "on"]], params: XP_TEST_PARAMS },
  onBadDate: { app: [["development_xp_model", "on"], ["development_xp_from_date", "2026-02-30"]], params: XP_TEST_PARAMS },
  onFutureDate: { app: [["development_xp_model", "on"], ["development_xp_from_date", "2026-06-13"]], params: XP_TEST_PARAMS },
  onNoParams: { app: [["development_xp_model", "on"], ["development_xp_from_date", "2026-06-12"]], params: undefined },
  onBadParams: { app: [["development_xp_model", "on"], ["development_xp_from_date", "2026-06-12"]], params: { ...XP_TEST_PARAMS, offFocusShare: 2 } },
});

// ── Funktions-niveau: applyDailyTick og dailyAbilityDelta ─────────────────────

const TYPES = [["climber", "puncheur"], ["sprinter", "rouleur"], ["tt", "gc"], ["baroudeur", null], [null, null]];
const AGES = [17, 22, 27, 31, 36, null];

function rider(seed) {
  const [primaryType, secondaryType] = TYPES[seed % TYPES.length];
  return {
    riderId: `r${seed}`, dateStr: "2026-11-05", age: AGES[seed % AGES.length], potentiale: seed % 7 === 6 ? null : 1 + (seed % 6),
    primaryType, secondaryType,
    abilities: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, i === seed % VISIBLE_ABILITIES.length ? 98 : 30 + ((seed * 13 + i * 7) % 60)])),
    caps: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, i === (seed + 3) % VISIBLE_ABILITIES.length ? 30 : 75 + ((seed + i) % 24)])),
    progress: Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, ((seed + i) % 7) / 4])),
    conditionMult: 0.9 + (seed % 3) * 0.05,
  };
}

function programs(withRoleYield) {
  const out = [];
  for (const focus of [...Object.keys(TRAINING_FOCUSES), ...V3_NEW_HARD_SESSIONS]) {
    for (const intensity of ["rest", "recovery", "easy", "normal", "hard"]) {
      out.push({ focus, intensity });
      out.push(applyTrainingCatalog({ focus, intensity }, { v3: true }));
    }
  }
  const roleParams = [{ stageBonus: 0.37, leadShare: 0.43 }, { stageBonus: 0.5, leadShare: 0.6, roleDrivesBaseDay: true }];
  for (const profile of [...Object.keys(RACE_PROFILE_ABILITY_MAP), null]) {
    out.push(raceDayProgram(profile));
    out.push(raceDayProgram(profile, { includeOffFocus: false }));
    for (const params of roleParams) {
      for (const role of [VALID_RACE_ROLES[0], VALID_RACE_ROLES[VALID_RACE_ROLES.length - 1], null]) {
        const args = withRoleYield({}, { params, profileType: profile, role });
        out.push({ ...args.program, __yield: args.abilityYieldMult ?? null });
      }
    }
  }
  return out;
}

const STAFF = { training_staff: [{ dimension: "physical", level: 3 }] };

const OPTION_SETS = [
  {},
  { staff: STAFF, facilityTier: 2, riderLevel: "senior" },
  { hardDailyCap: 1, budgetDivisor: 126.4516129032258, tickSeedKey: "season-1#gd12" },
  { curveB: CURVE_B },
  { curveB: CURVE_B, curveBTransition: { weight: 0.4, abilities: VISIBLE_ABILITIES.slice(0, 6) } },
  { developmentScore: { score: 55, devMult: 1.2, kind: "training" } },
  { abilityYieldMult: { climbing: 1.3, sprint: 0.8 } },
  { academyRateMult: 1.25, hardDailyCap: 1 },
];

/** Hele applyDailyTick-gitteret med `developmentXp: null`, som motoren sender med kontakten slukket. */
export function applyDailyTickOffDigest(withRoleYield) {
  const rows = [];
  const progs = programs(withRoleYield);
  for (let seed = 0; seed < 7; seed++) {
    const base = rider(seed);
    for (const [pi, prog] of progs.entries()) {
      if ((pi + seed) % 3 !== 0) continue; // tyndet gitter: alle programmer, ikke alle kombinationer
      const { __yield: yieldMult, ...program } = prog;
      for (const opts of OPTION_SETS) {
        const args = { ...base, program, ...opts, developmentXp: null };
        if (yieldMult) args.abilityYieldMult = { ...(opts.abilityYieldMult ?? {}), ...yieldMult };
        const r = applyDailyTick(args);
        rows.push([r.abilities, r.progress, r.gains, r.score, r.trainingScore, r.noise, r.status]);
      }
    }
  }
  return sha(rows);
}

/** dailyAbilityDelta pr. evne, med og uden kurve B. */
export function dailyAbilityDeltaOffDigest(withRoleYield) {
  const rows = [];
  const progs = programs(withRoleYield);
  for (let seed = 0; seed < 5; seed++) {
    const base = rider(seed);
    for (const [pi, prog] of progs.entries()) {
      if ((pi + seed) % 4 !== 0) continue;
      const { __yield: _y, ...program } = prog;
      for (const opts of [OPTION_SETS[0], OPTION_SETS[1], OPTION_SETS[2], OPTION_SETS[3], { riderQualityMult: 0.8 }]) {
        for (const ability of VISIBLE_ABILITIES) {
          rows.push(dailyAbilityDelta({
            ability, current: base.abilities[ability], cap: base.caps[ability], age: base.age, program,
            conditionMult: base.conditionMult, noise: 1.07, potentiale: base.potentiale,
            primaryType: base.primaryType, secondaryType: base.secondaryType, ...opts, developmentXp: null,
          }));
        }
      }
    }
  }
  return sha(rows);
}

// ── Motor-niveau: runTeamTrainingDay med en lille in-memory Supabase ──────────
// (kopi af developmentScoreWiring.engine.test.js' mock, uden assert)

function createMockSupabase(state) {
  function builder(table, op = "select", filters = [], patch = null) {
    const cell = (row, col) => (col.includes("->>") ? row[col.split("->>")[0]]?.[col.split("->>")[1]] : row[col]);
    const matchRow = (rawRow) => !filters.some(([col, val, fop]) => {
      if (fop === "meta") return false;
      const row = { [col]: cell(rawRow, col) };
      if (fop === "gte") return !(row[col] >= val);
      if (fop === "lt") return !(row[col] < val);
      if (fop === "lte") return !(row[col] <= val);
      if (fop === "in") return !val.includes(row[col]);
      return row[col] !== val;
    });
    const next = (f) => builder(table, op, [...filters, f], patch);
    const obj = {
      select() { return builder(table, op === "select" ? "select" : op, filters, patch); },
      eq(col, val) { return next([col, val, "eq"]); },
      is(col, val) { return next([col, val, "eq"]); },
      gte(col, val) { return next([col, val, "gte"]); },
      lt(col, val) { return next([col, val, "lt"]); },
      lte(col, val) { return next([col, val, "lte"]); },
      in(col, vals) { return next([col, vals, "in"]); },
      order(col, o = {}) { return next(["__order", { col, ascending: o.ascending !== false }, "meta"]); },
      limit(n) { return next(["__limit", n, "meta"]); },
      async maybeSingle() {
        const result = await new Promise((resolve) => obj.then(resolve));
        return { data: (result.data ?? [])[0] ?? null, error: result.error };
      },
      update(p) { return builder(table, "update", filters, p); },
      delete() { return builder(table, "delete", filters, patch); },
      insert(row) {
        state[table] ??= [];
        const r = Array.isArray(row) ? row[0] : row;
        if (table === "training_day_runs") {
          const hasGameDay = r.game_day != null;
          const exists = state[table].some((x) => ((x.game_day != null) === hasGameDay) && (hasGameDay
            ? x.team_id === r.team_id && x.season_id === r.season_id && (x.squad ?? "senior") === (r.squad ?? "senior") && x.game_day === r.game_day
            : x.team_id === r.team_id && x.tick_date === r.tick_date));
          if (exists) return Promise.resolve({ error: { code: "23505", message: "duplicate key" } });
        }
        for (const x of (Array.isArray(row) ? row : [row])) state[table].push({ ...x });
        return Promise.resolve({ error: null });
      },
      upsert(rows, upsertOpts = {}) {
        state[table] ??= [];
        const conflict = (upsertOpts.onConflict || "").split(",").map((s) => s.trim()).filter(Boolean);
        for (const r of (Array.isArray(rows) ? rows : [rows])) {
          const idx = conflict.length ? state[table].findIndex((x) => conflict.every((c) => x[c] === r[c])) : -1;
          if (idx >= 0) { if (!upsertOpts.ignoreDuplicates) Object.assign(state[table][idx], r); } else state[table].push({ ...r });
        }
        return Promise.resolve({ error: null });
      },
      then(resolve) {
        state[table] ??= [];
        let result;
        if (op === "update") {
          const hit = state[table].filter(matchRow);
          for (const row of hit) Object.assign(row, patch);
          result = { data: hit, error: null };
        } else if (op === "delete") {
          const hit = state[table].filter(matchRow);
          state[table] = state[table].filter((row) => !matchRow(row));
          result = { data: hit, error: null };
        } else {
          let rows = state[table].filter(matchRow);
          const ord = filters.find((f) => f[2] === "meta" && f[0] === "__order")?.[1];
          const lim = filters.find((f) => f[2] === "meta" && f[0] === "__limit")?.[1];
          if (ord) rows = [...rows].sort((a, b) => (ord.ascending ? a[ord.col] - b[ord.col] : b[ord.col] - a[ord.col]));
          if (Number.isFinite(lim)) rows = rows.slice(0, lim);
          result = { data: rows, error: null };
        }
        return Promise.resolve(result).then(resolve);
      },
    };
    return obj;
  }
  return {
    async rpc(name) {
      throw new Error(`developmentXpOffScenarios: rpc ${name} er ikke med i mocken`);
    },
    from(table) {
      state[table] ??= [];
      return builder(table);
    },
  };
}

const TEAM_ID = "team-a";
const SEASON_ID = "season-1";
const NOW = new Date("2026-06-12T10:00:00+02:00");

export function engineSeed({ flags, raced, overlay, plan }) {
  const state = {
    riders: [
      { id: "r1", team_id: TEAM_ID, primary_type: "climber", secondary_type: "puncheur", potentiale: 4, birthdate: "2003-01-01", firstname: "A", lastname: "A", is_retired: false },
      { id: "r2", team_id: TEAM_ID, primary_type: "sprinter", secondary_type: null, potentiale: 2, birthdate: "1994-05-01", firstname: "B", lastname: "B", is_retired: false },
    ],
    rider_derived_abilities: [
      { rider_id: "r1", ...Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, 40 + (i * 3) % 40])), ability_caps: null, ability_progress: { climbing: 0.94, punch: 1.6, endurance: 0.2 } },
      { rider_id: "r2", ...Object.fromEntries(VISIBLE_ABILITIES.map((k, i) => [k, 55 + (i * 5) % 40])), ability_caps: null, ability_progress: { sprint: 0.99, flat: 0.5 } },
    ],
    rider_condition: [
      { rider_id: "r1", form: 50, fatigue: 40, injured_until: null, injury_cause: null },
      { rider_id: "r2", form: 62, fatigue: 20, injured_until: null, injury_cause: null },
    ],
    training_plans: [
      { rider_id: "r1", team_id: TEAM_ID, season_id: SEASON_ID, focus: plan, intensity: "hard" },
      { rider_id: "r2", team_id: TEAM_ID, season_id: SEASON_ID, focus: "sprint", intensity: "normal" },
    ],
    training_day_runs: [],
    teams: [{ id: TEAM_ID, user_id: "user-a", is_ai: false, is_bank: false, is_test_account: false }],
    app_config: [
      ...Object.entries(flags).map(([key, value]) => ({ key, value })),
      ...overlay.app.map(([key, value]) => ({ key, value })),
    ],
    private_config: overlay.params === undefined ? [] : [{ key: "development_xp_params", value: overlay.params }],
  };
  if (raced) {
    state.app_config.push({ key: "race_day_development_enabled", value: "on" });
    state.race_results = [{ rider_id: "r1", result_type: "stage", race_id: "race-1", stage_number: 1, imported_at: "2026-06-12T08:00:00Z" }];
    state.race_stage_profiles = [{ race_id: "race-1", stage_number: 1, profile_type: "mountain" }];
  }
  return state;
}

// Felter der aendrer sig med vaegur eller uuid, ikke med modellen.
function normalize(value) {
  if (Array.isArray(value)) return value.map(normalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value)
      .filter(([k]) => k !== "id" && !k.endsWith("_at"))
      .map(([k, v]) => [k, normalize(v)]));
  }
  return value;
}

export function gameState(state, result) {
  return normalize(structuredClone({
    rider_derived_abilities: state.rider_derived_abilities,
    rider_condition: state.rider_condition,
    rider_derived_ability_history: state.rider_derived_ability_history ?? [],
    rider_training_scores: state.rider_training_scores ?? [],
    training_day_runs: state.training_day_runs,
    report: result?.report ?? null,
  }));
}

const CAP = { ability_cap_per_date_enabled: "on" };
export const ENGINE_SCENARIOS = Object.freeze({
  cap: { flags: CAP },
  noCap: { flags: {} },
  scoreB: { flags: { ...CAP, [DEVELOPMENT_SCORE_V2_FLAG_KEY]: "on" } },
  catchUp: { flags: { ...CAP, [RACE_DAY_CATCHUP_FLAG_KEY]: "on" } },
});

export async function runEngine(state, { teamAi = false } = {}) {
  if (teamAi) Object.assign(state.teams[0], { user_id: null, is_ai: true });
  const keys = [DEVELOPMENT_SCORE_V2_PARAMS_ENV, RACE_DAY_CATCHUP_PARAMS_ENV];
  const prev = Object.fromEntries(keys.map((k) => [k, process.env[k]]));
  process.env[DEVELOPMENT_SCORE_V2_PARAMS_ENV] = JSON.stringify(SCORE_PARAMS);
  process.env[RACE_DAY_CATCHUP_PARAMS_ENV] = JSON.stringify(CATCHUP_PARAMS);
  const warn = console.warn;
  console.warn = () => {};
  try {
    return await runTeamTrainingDay({
      supabase: createMockSupabase(state), teamId: TEAM_ID, seasonId: SEASON_ID,
      seasonNumber: 1, executedBy: "assistant", now: NOW,
    });
  } finally {
    console.warn = warn;
    for (const k of keys) {
      if (prev[k] === undefined) delete process.env[k];
      else process.env[k] = prev[k];
    }
  }
}

/** Én hash pr. (scenarie, traenings-/loebsdag, plan, slukket XP-opsaetning). */
export async function engineOffDigests() {
  const out = {};
  for (const [name, { flags }] of Object.entries(ENGINE_SCENARIOS)) {
    for (const raced of [false, true]) {
      for (const plan of ["vo2max", "long_climbs", "restitution"]) {
        for (const [overlayName, overlay] of Object.entries(XP_OFF_OVERLAYS)) {
          const state = engineSeed({ flags, raced, overlay, plan });
          const result = await runEngine(state);
          out[`${name}|${raced ? "race" : "train"}|${plan}|${overlayName}`] = sha(gameState(state, result));
        }
      }
    }
  }
  return out;
}

export async function allOffDigests(hooks) {
  return {
    applyDailyTick: applyDailyTickOffDigest(hooks.withRoleYield),
    dailyAbilityDelta: dailyAbilityDeltaOffDigest(hooks.withRoleYield),
    engine: await engineOffDigests(),
  };
}
