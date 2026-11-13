// #7982 trin 2-5, dommerens proevesaet ("samme resultat som foer"). Skrevet FOER foerste kodelinje
// (AGENTS.md regel 40). Filen ejes af dommeren: byggeren aendrer den ikke. Skal den udvides
// (fx en ny databasefunktion i et senere trin), goer dommeren det og fryser facit igen.
//
// Hvad den goer: koerer et fast saet scenarier gennem de TO offentlige indgange
//   runTrainNow (trykket, kaldt som ruten kalder det) og runTeamTrainingDay (aftenkoerslen)
// mod en database-stedfortraeder, der (a) svarer ud fra en tilstand i hukommelsen, (b) optager
// HVERT kald (laesning, skrivning, databasefunktion) i raekkefoelge, og (c) udfoerer skrivningerne
// paa tilstanden, saa naeste laesning ser dem. Resultatet pr. scenarie er: svarene, alle
// skrivninger i raekkefoelge, sluttilstanden i alle tabeller, og antal kald.
//
// Kun to ting injiceres ud over det ruten sender: `now` (regel 16, intet vaegur) og `logger`.
// Trykket bruger altsaa de RIGTIGE laesere (ogsaa train_now_date_context og advarslen om korte
// loeb). Ingen tal fra motoren staar i denne fil eller i facit (regel 17): facit er fingeraftryk.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { runTrainNow } from "./trainNow.js";
import { runTeamTrainingDay } from "./dailyTrainingEngine.js";

const id = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const TEAM = id(1);
export const USER = id(2);
export const SEASON = { id: id(5), number: 5 };
export const DIVISION = id(10);
export const RACE = id(800); // holdets loeb: én etape paa datoens tredje loebsdag
export const FILLER = id(801); // andet loeb i samme pulje, saa datoen har fem loebsdage
export const DATE1 = "2026-11-09";
export const DATE2 = "2026-11-10";
export const DAYS1 = [41, 42, 43, 44, 45];
export const DAYS2 = [46, 47, 48, 49, 50];
export const PRESS_AT = new Date("2026-11-09T06:00:00Z");
export const EVENING_AT = new Date("2026-11-09T19:30:00Z");
export const PRESS2_AT = new Date("2026-11-10T06:00:00Z");
export const rider = (n) => id(1000 + n);

// Kontakterne som de stod i prod 13/11 (laest med SELECT af dommeren). Kun til/fra, ingen tal.
export const PROD_FLAGS = Object.freeze({
  training_condition_per_date: "on", training_tick_per_race_day: "on", training_train_now: "on",
  training_train_now_instant: "beta", training_train_now_bonus: "off",
  race_day_engine_enabled: "on", race_day_development_enabled: "on", race_day_role_yield_enabled: "on",
  race_day_role_base_day_enabled: "off", race_day_catchup_enabled: "off",
  condition_model_v2: "on", condition_v2_race_date_training_day: "on",
  ability_cap_per_date_enabled: "on", development_v2_aging_enabled: "on",
  development_curve_b: "on", development_curve_b_ignited_at: "2026-10-31",
  development_score_v2: "off", development_xp_model: "off",
  training_catalog_v3: "on", training_program_cells: "on", training_programs: "on",
  training_fatigue_rules: "on", training_groups: "on", daily_training_enabled: "on",
});

// Valgfrit og privat: en JSON-fil med raekker til private_config ([{ key, value }, ...]).
// Bruges kun af dommeren til en privat koersel med de rigtige parametre; filen ligger uden for repoet.
const PRIVATE_ROWS = process.env.SAME_RESULT_7982_PRIVATE
  ? JSON.parse(readFileSync(process.env.SAME_RESULT_7982_PRIVATE, "utf8"))
  : [];
export const PRIVATE_PARAMS_LOADED = PRIVATE_ROWS.length > 0;

const TYPES = ["climber", "sprinter", "rouleur", "puncheur", "tt", "gc"];
const FOCUS = ["vo2max", "threshold", "sprint", "endurance", "climbing"];
const INTENSITY = ["normal", "hard", "easy", "normal", "rest", "hard"];
const WEEKDAYS = ["mon", "tue", "wed", "thu", "fri", "sat", "sun"];

/**
 * Udgangstilstand. Alt er udledt af rytterens nummer, saa samme kald altid giver samme tilstand.
 *  - `count` ryttere paa holdet
 *  - `entered`: rytternumre tilmeldt holdets loeb (etapen paa loebsdag 43)
 *  - `injured`, `tired`, `noAbilities`, `noPlan`, `boughtLate`, `academy`: rytternumre med undtagelser
 *  - `weekPlan`, `fatigueRules`, `staff`: ugeplan, spillerens traethedsregler, traeningsstab og facilitet
 *  - `stageRun`: etapen er koert (resultat + belastning for de tilmeldte)
 *  - `secondDate`: kalender ogsaa for naeste dato
 */
export function seedState({
  count = 6, entered = [], injured = [], tired = [], noAbilities = [], noPlan = [], boughtLate = [], academy = [],
  flags = {}, stageRun = false, secondDate = false, teamPatch = {}, weekPlan = false, fatigueRules = false, staff = false,
} = {}) {
  const nums = Array.from({ length: count }, (_, i) => i);
  const state = {
    app_config: Object.entries({ ...PROD_FLAGS, ...flags }).filter(([, value]) => value !== undefined).map(([key, value]) => ({ key, value })),
    seasons: [{ id: SEASON.id, number: SEASON.number, start_date: "2026-09-29", end_date: "2026-12-20", status: "active" },
      // Forrige saeson slutter dagen foer: ingen bro-datoer mellem saesonerne i dette saet.
      { id: id(4), number: 4, start_date: "2026-06-01", end_date: "2026-09-28", status: "completed" }],
    // Private motor-parametre staar ALDRIG i repoet (regel 17). Dommeren kan koere saettet privat
    // med dem via SAME_RESULT_7982_PRIVATE (se loadPrivateRows); uden dem koerer motoren "dagens model".
    private_config: structuredClone(PRIVATE_ROWS),
    teams: [{
      id: TEAM, user_id: USER, name: "Hold", league_division_id: DIVISION, u23_league_division_id: null, junior_league_division_id: null,
      is_ai: false, is_bank: false, is_frozen: false, is_test_account: false, parked_at: null, assistant_autopick_enabled: false,
      created_at: "2026-01-01T00:00:00Z", comeback_at: null, ...teamPatch,
    }],
    users: [{ id: USER, is_beta_tester: true, role: "manager" }],
    riders: nums.map((n) => ({
      id: rider(n), team_id: TEAM, primary_type: TYPES[n % TYPES.length], secondary_type: n % 4 === 0 ? TYPES[(n + 2) % TYPES.length] : null,
      potentiale: 2 + (n % 5), birthdate: `${1994 + (n % 12)}-0${1 + (n % 9)}-15`, firstname: "Rytter", lastname: String(n).padStart(2, "0"),
      is_retired: false, is_academy: academy.includes(n), squad: "senior", pending_team_id: null,
      created_at: "2026-01-01T00:00:00Z", acquired_at: boughtLate.includes(n) ? "2026-11-09T23:30:00Z" : null,
    })),
    rider_derived_abilities: nums.filter((n) => !noAbilities.includes(n)).map((n) => ({
      rider_id: rider(n), climbing: 40 + (n * 7) % 35, sprint: 40 + (n * 11) % 35, flat: 40 + (n * 5) % 35, recovery: 35 + (n * 3) % 30,
      time_trial: 40 + (n * 13) % 35, stamina: 40 + (n * 17) % 35, punch: 40 + (n * 19) % 35, ability_caps: null,
      ability_progress: n % 3 === 0 ? { climbing: 0.4, sprint: 0.1 } : {},
    })),
    rider_condition: nums.map((n) => ({
      rider_id: rider(n), form: 40 + (n * 7) % 30, fatigue: tired.includes(n) ? 90 + (n % 8) : 10 + (n * 9) % 50,
      injured_until: injured.includes(n) ? "2026-11-20" : null, injury_cause: injured.includes(n) ? "training_overload" : null,
      updated_at: "2026-11-08T20:00:00Z", injury_end_game_day: injured.includes(n) ? 90 : null,
      injury_season_id: injured.includes(n) ? SEASON.id : null, injury_race_days_left: injured.includes(n) ? 49 : null,
    })),
    training_plans: nums.filter((n) => !noPlan.includes(n)).map((n) => ({
      rider_id: rider(n), team_id: TEAM, season_id: SEASON.id, focus: FOCUS[n % FOCUS.length], intensity: INTENSITY[n % INTENSITY.length],
    })),
    training_week_plans: weekPlan ? [
      { team_id: TEAM, rider_id: null, days: Object.fromEntries(WEEKDAYS.map((d, i) => [d, { intensity: INTENSITY[i % INTENSITY.length] }])) },
      { team_id: TEAM, rider_id: rider(1), days: Object.fromEntries(WEEKDAYS.map((d) => [d, { intensity: "easy" }])) },
    ] : [],
    // Spillerens egne traethedsregler: en holdregel og to undtagelser (egen graense, og "ingen graense").
    team_training_rules: fatigueRules ? [
      { team_id: TEAM, rider_id: null, fatigue_threshold: 45, fallback: "light", recovery_after_stage: true },
      { team_id: TEAM, rider_id: rider(2), fatigue_threshold: 30, fallback: "rest", recovery_after_stage: null },
      { team_id: TEAM, rider_id: rider(14), fatigue_threshold: null, fallback: "off", recovery_after_stage: false },
    ] : [],
    // Traeningsstab og traeningsfacilitet (holdets dagsbonus). Tomt = intet tillaeg.
    team_staff: staff ? [{ id: id(9001), team_id: TEAM, name: "Traener Et", role: "training", tier: 2, status: "active" }] : [],
    team_facilities: staff ? [{ team_id: TEAM, track: "training", tier: 2 }] : [],
    training_groups: [], training_group_members: [],
    races: [
      { id: RACE, season_id: SEASON.id, league_division_id: DIVISION, race_type: "single", squad: "senior", name: "Holdets loeb", status: stageRun ? "completed" : "scheduled", stages_completed: stageRun ? 1 : 0, finalize_state: null },
      { id: FILLER, season_id: SEASON.id, league_division_id: DIVISION, race_type: "stage_race", squad: "senior", name: "Andet loeb", status: "scheduled", stages_completed: 1, finalize_state: null },
    ],
    race_stage_schedule: [
      { race_id: FILLER, stage_number: 1, game_day: 40, scheduled_at: "2026-11-08T15:00:00Z" },
      { race_id: RACE, stage_number: 1, game_day: 43, scheduled_at: "2026-11-09T15:00:00Z" },
      { race_id: FILLER, stage_number: 2, game_day: 45, scheduled_at: "2026-11-09T17:00:00Z" },
      ...(secondDate ? [{ race_id: FILLER, stage_number: 3, game_day: 50, scheduled_at: "2026-11-10T17:00:00Z" }] : []),
      { race_id: FILLER, stage_number: 4, game_day: 55, scheduled_at: "2026-11-11T17:00:00Z" },
    ],
    race_entries: entered.map((n) => ({ id: id(5000 + n), race_id: RACE, rider_id: rider(n), team_id: TEAM, race_role: n % 2 ? "helper" : "captain" })),
    race_results: [], race_incidents: [], race_simulation_runs: [], race_entry_days: [], race_entry_clears: [], race_withdrawals: [],
    training_day_runs: [], training_date_work: [], training_rider_ticks: [], training_condition_settlements: [], training_race_loads: [],
    training_train_now_locks: [], rider_derived_ability_history: [], rider_ability_race_day_history: [], rider_training_scores: [],
    notifications: [],
  };
  if (stageRun) finishRace(state);
  return state;
}

/** Etapen er koert: resultat, startliste og belastning for de tilmeldte. */
export function finishRace(state) {
  const race = state.races.find((row) => row.id === RACE);
  race.stages_completed = 1; race.status = "completed";
  const ids = state.race_entries.filter((row) => row.race_id === RACE).map((row) => row.rider_id);
  state.race_simulation_runs.push({ id: id(7000), race_id: RACE, stage_number: 1, entrant_snapshot: [...ids] });
  ids.forEach((rider_id, i) => {
    state.race_results.push({ id: id(7100 + i), race_id: RACE, stage_number: 1, rider_id, result_type: "stage", rank: i + 1, imported_at: "2026-11-09T16:00:00Z" });
    state.training_race_loads.push({ rider_id, race_id: RACE, stage_number: 1, season_id: SEASON.id, game_day: 43, tick_date: DATE1, load: 9, consumed_at: null, duplicate_of_race_id: null, duplicate_of_stage_number: null });
    state.race_entry_days.push({ race_id: RACE, rider_id, team_id: TEAM, season_id: SEASON.id, game_day: 43 });
  });
}

// ── Kanonisk form og fingeraftryk ─────────────────────────────────────────────────────────────
// Decimaltal afrundes, foer de sammenlignes eller hashes. Motoren regner med potenser, og de sidste
// cifre i saadan et tal afhaenger af maskinens regnebibliotek (Windows og Linux giver ikke altid
// samme sidste ciffer). Facit frosset paa én maskine skal kunne proeves paa en anden. Afrundingen
// er til SIGNIFICANT_DIGITS betydende cifre; tal taettere paa nul end TINY er regnestoej og bliver
// nul. Heltal (evnepoint, form, traethed, dage) roeres aldrig. En aendring paa mere end cirka én
// milliardtedel af tallet fanges stadig (maalt af dommeren, se dom).
export const SIGNIFICANT_DIGITS = 9;
const TINY = 1e-9;
export const stableNumber = (value) => {
  if (!Number.isFinite(value) || Number.isInteger(value)) return value;
  const rounded = Number(value.toPrecision(SIGNIFICANT_DIGITS));
  return Math.abs(rounded) < TINY ? 0 : rounded;
};
export const canon = (value) => {
  if (Array.isArray(value)) return value.map(canon);
  if (value instanceof Date) return value.toISOString();
  if (value && typeof value === "object") return Object.fromEntries(Object.keys(value).sort().map((key) => [key, canon(value[key])]));
  if (typeof value === "number") return stableNumber(value);
  return value === undefined ? null : value;
};
export const digest = (value) => createHash("sha256").update(JSON.stringify(canon(value))).digest("hex").slice(0, 20);

// ── Database-stedfortraederen ─────────────────────────────────────────────────────────────────
const READ_ONLY_RPCS = new Set(["train_now_date_context", "find_spent_race_days"]);
const pathGet = (row, col) => {
  if (!col.includes("->")) return row?.[col];
  const parts = col.split(/->>?/);
  let cur = row;
  for (const part of parts) cur = cur?.[part.replace(/^'|'$/g, "")];
  return col.includes("->>") && cur != null && typeof cur !== "string" ? String(cur) : cur;
};
// Tidsstempler sammenlignes som tid ("...00Z" og "...00.000Z" er samme oejeblik), alt andet som vaerdi.
const STAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;
const order = (a, b) => {
  const [x, y] = typeof a === "string" && typeof b === "string" && STAMP.test(a) && STAMP.test(b) ? [Date.parse(a), Date.parse(b)] : [a, b];
  return x < y ? -1 : x > y ? 1 : 0;
};
const sameValue = (a, b) => (a ?? null) === (b ?? null) || (a != null && b != null && String(a) === String(b));
const parseList = (text) => text.replace(/^\(|\)$/g, "").split(",").map((s) => s.trim().replace(/^"|"$/g, "")).filter((s) => s.length);
const parseScalar = (text) => (text === "null" ? null : text === "true" ? true : text === "false" ? false : text);

function orPredicate(expr, unsupported) {
  // PostgREST or-streng: "a.eq.1,b.is.null,and(c.gte.2,d.lt.3)".
  const split = (text) => { const out = []; let depth = 0, cur = ""; for (const ch of text) { if (ch === "(") depth += 1; if (ch === ")") depth -= 1; if (ch === "," && depth === 0) { out.push(cur); cur = ""; } else cur += ch; } if (cur) out.push(cur); return out; };
  const term = (text) => {
    const group = /^(and|or)\((.*)\)$/s.exec(text.trim());
    if (group) { const parts = split(group[2]).map(term); return group[1] === "and" ? (row) => parts.every((fn) => fn(row)) : (row) => parts.some((fn) => fn(row)); }
    const m = /^([^.]+)\.(not\.)?(eq|neq|is|in|gt|gte|lt|lte)\.(.*)$/s.exec(text.trim());
    if (!m) { unsupported.push(`or:${text}`); return () => false; }
    const [, col, neg, op, raw] = m;
    const test = (row) => {
      const v = pathGet(row, col);
      if (op === "eq") return sameValue(v, parseScalar(raw));
      if (op === "neq") return !sameValue(v, parseScalar(raw));
      if (op === "is") return (v ?? null) === parseScalar(raw);
      if (op === "in") return parseList(raw).some((x) => sameValue(v, x));
      if (v == null) return false;
      if (op === "gt") return v > raw; if (op === "gte") return v >= raw; if (op === "lt") return v < raw; return v <= raw;
    };
    return neg ? (row) => !test(row) : test;
  };
  const parts = split(expr).map(term);
  return (row) => parts.some((fn) => fn(row));
}

const UNIQUE_KEYS = {
  training_train_now_locks: ["rider_id", "tick_date"],
  rider_condition: ["rider_id"],
  rider_derived_ability_history: ["rider_id", "snapshot_date", "source"],
  rider_ability_race_day_history: ["rider_id", "season_id", "game_day", "source"],
  app_config: ["key"],
};

export function createFake(state, { failRpc = null } = {}) {
  const log = []; // hvert kald i raekkefoelge
  const unsupported = []; // noget stedfortraederen ikke kender: saa er proeven ugyldig
  // "Runder": kald, der sendes af sted samtidig (fx i én Promise.all), faar svar i samme runde.
  // Kald, der venter paa et tidligere svar, havner i en senere runde. Antal runder pr. tryk er
  // derfor det antal gange, koden staar og venter paa databasen efter hinanden (maaletal for trin 3).
  let round = 1; let waiting = [];
  const deliver = (result) => new Promise((resolve) => {
    if (!waiting.length) setImmediate(() => { const batch = waiting; waiting = []; round += 1; for (const done of batch) done(); });
    waiting.push(() => resolve(result));
  });
  const record = (entry) => { entry.round = round; log.push(entry); return entry; };

  function builder(table) {
    const filters = []; const spec = [];
    let write = null, limit = null, orders = [], countOnly = false, returning = false;
    const add = (name, col, val, fn) => { spec.push([name, col, canon(val)]); filters.push(fn); };
    const matching = () => (state[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
    const run = () => {
      state[table] ??= [];
      if (!write) {
        record({ kind: "read", target: table, filters: spec });
        let out = matching();
        for (const [col, asc] of [...orders].reverse()) out = [...out].sort((a, b) => { const x = pathGet(a, col), y = pathGet(b, col); return (x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
        const count = out.length;
        if (limit != null) out = out.slice(0, limit);
        return countOnly ? { data: null, count, error: null } : { data: structuredClone(out), count, error: null };
      }
      record({ kind: "write", target: table, op: write.kind, filters: spec, payload: canon(write.payload), options: canon(write.options ?? null) });
      let touched = [];
      if (write.kind === "update") { touched = matching(); for (const row of touched) Object.assign(row, structuredClone(write.payload)); }
      if (write.kind === "delete") { touched = matching(); state[table] = state[table].filter((row) => !touched.includes(row)); }
      if (write.kind === "insert" || write.kind === "upsert") {
        const keys = (write.options?.onConflict ? write.options.onConflict.split(",").map((s) => s.trim()) : UNIQUE_KEYS[table]) ?? null;
        for (const incoming of [write.payload].flat()) {
          const existing = keys ? state[table].find((row) => keys.every((key) => sameValue(row[key], incoming[key]))) : null;
          if (existing && write.kind === "insert") return { data: null, error: { code: "23505", message: `duplicate key value violates unique constraint on ${table}` } };
          if (existing) { if (!write.options?.ignoreDuplicates) Object.assign(existing, structuredClone(incoming)); touched.push(existing); } else { const row = structuredClone(incoming); state[table].push(row); touched.push(row); }
        }
      }
      return { data: returning ? structuredClone(touched) : null, error: null };
    };
    const q = {
      select(_cols, options) { if (write) returning = true; if (options?.head) countOnly = true; return q; },
      eq(col, val) { add("eq", col, val, (row) => sameValue(pathGet(row, col), val)); return q; },
      neq(col, val) { add("neq", col, val, (row) => !sameValue(pathGet(row, col), val)); return q; },
      is(col, val) { add("is", col, val, (row) => (pathGet(row, col) ?? null) === val); return q; },
      in(col, vals) { add("in", col, vals, (row) => (vals ?? []).some((v) => sameValue(pathGet(row, col), v))); return q; },
      gt(col, val) { add("gt", col, val, (row) => pathGet(row, col) != null && order(pathGet(row, col), val) > 0); return q; },
      gte(col, val) { add("gte", col, val, (row) => pathGet(row, col) != null && order(pathGet(row, col), val) >= 0); return q; },
      lt(col, val) { add("lt", col, val, (row) => pathGet(row, col) != null && order(pathGet(row, col), val) < 0); return q; },
      lte(col, val) { add("lte", col, val, (row) => pathGet(row, col) != null && order(pathGet(row, col), val) <= 0); return q; },
      not(col, op, val) {
        const test = op === "is" ? (row) => (pathGet(row, col) ?? null) === parseScalar(String(val))
          : op === "eq" ? (row) => sameValue(pathGet(row, col), val)
            : op === "in" ? (row) => parseList(String(val)).some((x) => sameValue(pathGet(row, col), x))
              : (unsupported.push(`not:${op}`), () => false);
        add(`not.${op}`, col, val, (row) => !test(row)); return q;
      },
      or(expr) { add("or", expr, null, orPredicate(expr, unsupported)); return q; },
      contains(col, val) { add("contains", col, val, (row) => { const v = pathGet(row, col); return Array.isArray(val) ? val.every((x) => (v ?? []).includes(x)) : Object.entries(val ?? {}).every(([k, x]) => sameValue(v?.[k], x)); }); return q; },
      overlaps(col, val) { add("overlaps", col, val, (row) => (pathGet(row, col) ?? []).some((x) => val.includes(x))); return q; },
      order(col, options) { orders.push([col, options?.ascending !== false]); return q; },
      limit(n) { limit = n; return q; },
      range(from, to) { const r = run(); return deliver({ ...r, data: (r.data ?? []).slice(from, to + 1) }); },
      maybeSingle() { const r = run(); return deliver({ data: r.data?.[0] ?? null, error: r.error }); },
      single() { const r = run(); return deliver(r.data?.length === 1 ? { data: r.data[0], error: null } : { data: null, error: r.error ?? { code: "PGRST116", message: "no single row" } }); },
      insert(payload, options) { write = { kind: "insert", payload, options }; return q; },
      update(payload, options) { write = { kind: "update", payload, options }; return q; },
      upsert(payload, options) { write = { kind: "upsert", payload, options }; return q; },
      delete() { write = { kind: "delete", payload: null }; return q; },
      abortSignal() { return q; }, throwOnError() { return q; }, returns() { return q; },
      then(resolve, reject) {
        try { return deliver(run()).then(resolve, reject); } catch (err) {
          // swallow-ok: fejlen sluges ikke. Et kast inde i stedfortraederen gives videre til kalderen
          // som et afvist loefte, praecis som en rigtig databaseklient ville goere.
          return Promise.reject(err).then(resolve, reject);
        }
      },
    };
    return new Proxy(q, { get(target, prop) { if (prop in target || typeof prop === "symbol") return target[prop]; unsupported.push(`${table}.${String(prop)}`); return () => target; } });
  }

  const workOf = (args) => state.training_date_work.find((row) => row.team_id === args.p_team_id && row.season_id === args.p_season_id && row.tick_date === args.p_tick_date);
  const todayStages = (start, end) => state.race_stage_schedule.filter((s) => s.scheduled_at >= start && s.scheduled_at < end && state.races.some((r) => r.id === s.race_id));
  const openSlots = (riderId, tickDate) => {
    const stages = todayStages(`${tickDate}T00:00:00Z`, `${tickDate}T23:59:59Z`);
    return stages.filter((s) => {
      const race = state.races.find((r) => r.id === s.race_id);
      return state.race_entries.some((e) => e.race_id === s.race_id && e.rider_id === riderId) && Number(race.stages_completed) < s.stage_number;
    }).map((s) => ({ raceId: s.race_id, stageNumber: s.stage_number, gameDay: s.game_day }));
  };
  const raise = (message, code = "P0001") => ({ data: null, error: { code, message } });

  const RPCS = {
    train_now_date_context(args) {
      const team = state.teams.find((row) => row.id === args.p_team_id) ?? null;
      const riders = state.riders.filter((row) => row.team_id === args.p_team_id && row.is_retired === false)
        .map(({ id: rid, team_id, squad, is_academy, is_retired, pending_team_id, created_at, acquired_at }) => ({ id: rid, team_id, squad, is_academy, is_retired, pending_team_id, created_at, acquired_at }))
        .sort((a, b) => (a.id < b.id ? -1 : 1));
      const ids = new Set(riders.map((row) => row.id));
      const races = state.races.filter((row) => row.season_id === args.p_season_id);
      const raceIds = new Set(races.map((row) => row.id));
      const stages = state.race_stage_schedule.filter((s) => raceIds.has(s.race_id) && order(s.scheduled_at, args.p_day_start) >= 0 && order(s.scheduled_at, args.p_day_end) < 0);
      const todayRaceIds = new Set(stages.map((s) => s.race_id));
      const onToday = (row) => stages.some((s) => s.race_id === row.race_id && s.stage_number === row.stage_number);
      const calendar = [...new Set(races.map((r) => r.league_division_id).filter(Boolean))].sort().map((league_division_id) => {
        const rows = state.race_stage_schedule.filter((s) => races.some((r) => r.id === s.race_id && r.league_division_id === league_division_id));
        const prior = rows.filter((s) => order(s.scheduled_at, args.p_day_start) < 0);
        return { league_division_id, prior_rows: prior.length, prior_has_unknown: prior.some((s) => s.game_day == null),
          prior_max_game_day: prior.length ? Math.max(...prior.map((s) => s.game_day ?? -1)) : null, later_exists: rows.some((s) => order(s.scheduled_at, args.p_day_end) >= 0) };
      });
      return { data: {
        team: team && Object.fromEntries(["id", "league_division_id", "u23_league_division_id", "junior_league_division_id", "is_ai", "parked_at", "assistant_autopick_enabled", "is_bank", "is_frozen", "is_test_account", "created_at", "comeback_at"].map((k) => [k, team[k] ?? null])),
        riders,
        races: races.map(({ id: rid, league_division_id, race_type, squad, stages_completed, finalize_state }) => ({ id: rid, league_division_id, race_type, squad, stages_completed, finalize_state })),
        stages: stages.map(({ race_id, stage_number, game_day, scheduled_at }) => ({ race_id, stage_number, game_day, scheduled_at })),
        runs: state.race_simulation_runs.filter((row) => todayRaceIds.has(row.race_id)).map(({ race_id, stage_number, entrant_snapshot }) => ({ race_id, stage_number, entrant_snapshot })),
        entries: state.race_entries.filter((row) => todayRaceIds.has(row.race_id) && ids.has(row.rider_id)).map(({ race_id, rider_id, team_id }) => ({ race_id, rider_id, team_id })),
        results: state.race_results.filter((row) => ["stage", "gc"].includes(row.result_type) && ids.has(row.rider_id) && onToday(row)).map(({ race_id, stage_number, rider_id, result_type }) => ({ race_id, stage_number, rider_id, result_type })),
        incidents: state.race_incidents.filter((row) => row.outcome === "abandon" && ids.has(row.rider_id) && onToday(row)).map(({ race_id, stage_number, rider_id, outcome }) => ({ race_id, stage_number, rider_id, outcome })),
        loads: state.training_race_loads.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && ids.has(row.rider_id)).map(({ rider_id, race_id, stage_number, game_day, load }) => ({ rider_id, race_id, stage_number, game_day, load })),
        frozen: state.training_train_now_locks.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && row.instant_entry_snapshot != null && ids.has(row.rider_id)).map(({ rider_id, instant_entry_snapshot }) => ({ rider_id, instant_entry_snapshot })),
        locked_rider_ids: state.training_train_now_locks.filter((row) => row.tick_date === args.p_tick_date && ids.has(row.rider_id)).map((row) => row.rider_id).sort(),
        calendar,
      }, error: null };
    },
    // Ingen rytter i saettet har koert samme loebsdag i et andet loeb.
    find_spent_race_days() { return { data: [], error: null }; },
    register_training_date_work(args) {
      let work = workOf(args);
      if (!work) {
        work = { team_id: args.p_team_id, season_id: args.p_season_id, tick_date: args.p_tick_date, game_days: [...args.p_game_days],
          expected_rider_ids: [...args.p_expected_rider_ids], deadline_at: args.p_deadline_at, registered_at: args.p_registered_at, status: "pending",
          quarantined_rider_ids: [], departed_rider_ids: [], missing_evidence: [],
          opening_conditions: Object.fromEntries(state.rider_condition.filter((row) => args.p_expected_rider_ids.includes(row.rider_id)).map((row) => [row.rider_id, structuredClone(row)])) };
        state.training_date_work.push(work);
      }
      return { data: structuredClone(work), error: null };
    },
    quarantine_training_date_riders(args) {
      const work = workOf(args);
      work.quarantined_rider_ids = [...new Set([...work.quarantined_rider_ids, ...args.p_rider_ids])];
      return { data: { work: structuredClone(work) }, error: null };
    },
    depart_training_date_riders(args) {
      const work = workOf(args);
      const departed = args.p_rider_ids.filter((rid) => state.riders.find((row) => row.id === rid)?.team_id == null);
      work.expected_rider_ids = work.expected_rider_ids.filter((rid) => !departed.includes(rid));
      work.departed_rider_ids = [...new Set([...work.departed_rider_ids, ...departed])];
      return { data: { departed_rider_ids: departed, work: structuredClone(work) }, error: null };
    },
    freeze_train_now_date_entries(args) {
      return { data: args.p_rider_ids.map((rider_id) => {
        const lock = state.training_train_now_locks.find((row) => row.rider_id === rider_id && row.tick_date === args.p_tick_date);
        if (!lock) return { rider_id, slots: null };
        lock.instant_entry_snapshot ??= { slots: openSlots(rider_id, args.p_tick_date) };
        return { rider_id, slots: structuredClone(lock.instant_entry_snapshot.slots) };
      }), error: null };
    },
    // Samme regler som databasens funktion, i den udstraekning motoren kan maerke dem:
    // kvitteringer skrives én gang, raekkefoelgen vogtes, stemplede ryttere maa udfylde frit,
    // tilstand lukker datoen, og datoens status foelger kvitteringerne.
    commit_training_date_tick(args) {
      const work = workOf(args);
      if (!work) return raise("query returned no rows", "P0002");
      if (JSON.stringify(args.p_date_game_days) !== JSON.stringify(work.game_days) || !work.game_days.includes(args.p_game_day)) return raise("Registered complete date required");
      const reports = args.p_report?.riders ?? [];
      if (reports.some((r) => !work.expected_rider_ids.includes(r.rider_id))) return raise("Rider outside frozen date roster");
      const hasTick = (rid, day) => state.training_rider_ticks.some((row) => row.rider_id === rid && row.season_id === args.p_season_id && row.game_day === day);
      const oldRun = state.training_day_runs.find((row) => row.team_id === args.p_team_id && row.season_id === args.p_season_id && row.game_day === args.p_game_day);
      const fresh = reports.filter((r) => !work.quarantined_rider_ids.includes(r.rider_id) && !hasTick(r.rider_id, args.p_game_day)).map((r) => r.rider_id);
      if (!fresh.length) return { data: { already_ran: true, report: oldRun?.report ?? null, work_status: work.status }, error: null };
      const instant = new Set(state.training_train_now_locks.filter((row) => row.tick_date === args.p_tick_date && row.instant_at != null).map((row) => row.rider_id));
      const final = args.p_game_day === Math.max(...work.game_days);
      const ticksOnDate = (rid) => state.training_rider_ticks.filter((row) => row.rider_id === rid && row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && work.game_days.includes(row.game_day)).map((row) => row.game_day).sort((a, b) => a - b);
      for (const rid of fresh) {
        if (!instant.has(rid) && work.game_days.some((day) => day < args.p_game_day && !hasTick(rid, day))) return raise("Earlier rider date ticks must commit first");
        if (instant.has(rid)) {
          const expected = reports.find((r) => r.rider_id === rid)?.expected_date_receipt_days;
          if (JSON.stringify(expected) !== JSON.stringify(ticksOnDate(rid))) return raise("Training receipt snapshot changed; retry with current rider development");
        }
      }
      const settling = fresh.filter((rid) => (instant.has(rid) ? ticksOnDate(rid).filter((day) => day !== args.p_game_day).length === work.game_days.length - 1 : final));
      const keep = (list, key) => (list ?? []).filter((row) => fresh.includes(row[key]));
      const conditions = keep(args.p_conditions, "rider_id");
      if (conditions.some((row) => !settling.includes(row.rider_id) && !(instant.has(row.rider_id) && row.provisional === true))) return raise("Condition writes only at date settlement");
      if (settling.some((rid) => !conditions.some((row) => row.rider_id === rid && row.provisional !== true))) return raise("Every final rider receipt needs condition settlement");
      for (const item of keep(args.p_abilities, "riderId")) {
        const row = state.rider_derived_abilities.find((x) => x.rider_id === item.riderId);
        if (!row) return raise("Missing rider ability row");
        Object.assign(row, structuredClone(item.patch));
      }
      for (const item of conditions) {
        let row = state.rider_condition.find((x) => x.rider_id === item.rider_id);
        if (item.provisional === true) { if (row) Object.assign(row, { form: item.form, fatigue: item.fatigue }); continue; }
        if (!row) { row = { rider_id: item.rider_id }; state.rider_condition.push(row); }
        const { provisional: _p, ...full } = item;
        Object.assign(row, structuredClone(full));
      }
      const pushUnique = (table, rows, keys) => { for (const row of rows) if (!state[table].some((x) => keys.every((k) => sameValue(x[k], row[k])))) state[table].push(structuredClone(row)); };
      pushUnique("rider_derived_ability_history", keep(args.p_history, "rider_id"), ["rider_id", "snapshot_date", "source"]);
      pushUnique("rider_ability_race_day_history", keep(args.p_race_history, "rider_id"), ["rider_id", "season_id", "game_day", "source"]);
      pushUnique("rider_training_scores", keep(args.p_scores, "rider_id"), ["rider_id", "season_id", "game_day"]);
      for (const r of reports.filter((x) => fresh.includes(x.rider_id))) {
        state.training_rider_ticks.push({ rider_id: r.rider_id, season_id: args.p_season_id, game_day: args.p_game_day, tick_date: args.p_tick_date, team_id: args.p_team_id, report: structuredClone(r), created_at: args.p_now });
      }
      for (const rid of settling) {
        const r = reports.find((x) => x.rider_id === rid);
        state.training_condition_settlements.push({ rider_id: rid, season_id: args.p_season_id, tick_date: args.p_tick_date, team_id: args.p_team_id,
          status: (r.missing_evidence ?? []).length ? "needs_reconciliation" : "complete", opening_condition: structuredClone(work.opening_conditions[rid] ?? null),
          applied_condition: structuredClone(conditions.find((row) => row.rider_id === rid)), missing_evidence: structuredClone(r.missing_evidence ?? []) });
        for (const load of state.training_race_loads) if (load.season_id === args.p_season_id && load.tick_date === args.p_tick_date && load.rider_id === rid) load.consumed_at = args.p_now;
      }
      const active = work.expected_rider_ids.filter((rid) => !work.quarantined_rider_ids.includes(rid));
      const dayTicks = state.training_rider_ticks.filter((row) => row.season_id === args.p_season_id && row.game_day === args.p_game_day && work.expected_rider_ids.includes(row.rider_id)).sort((a, b) => (a.rider_id < b.rider_id ? -1 : 1));
      const all = active.every((rid) => dayTicks.some((row) => row.rider_id === rid));
      const { riders: _riders, ...rest } = args.p_report;
      const report = { ...structuredClone(rest), riders: dayTicks.map((row) => structuredClone(row.report)), complete: all, partial: !all, condition_settled: settling.length > 0 && all };
      if (oldRun) oldRun.report = report;
      else state.training_day_runs.push({ team_id: args.p_team_id, season_id: args.p_season_id, squad: args.p_squad, game_day: args.p_game_day, tick_date: args.p_tick_date, executed_by: args.p_executed_by, bonus_applied: false, report });
      const count = state.training_rider_ticks.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && active.includes(row.rider_id)).length;
      const missing = state.training_condition_settlements.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && work.expected_rider_ids.includes(row.rider_id)).flatMap((row) => row.missing_evidence.map((e) => ({ ...e, rider_id: row.rider_id })));
      work.status = count === active.length * work.game_days.length ? (missing.length ? "needs_reconciliation" : "complete") : "partial";
      work.missing_evidence = missing; work.updated_at = args.p_now;
      return { data: { already_ran: false, applied_rider_ids: fresh, report: structuredClone(report), work_status: work.status }, error: null };
    },
  };

  let rpcCalls = 0;
  async function rpc(name, args) {
    rpcCalls += 1;
    const base = name.replace(/^try_/, "");
    record({ kind: READ_ONLY_RPCS.has(base) ? "read" : "rpc", target: name, payload: canon(args) });
    if (failRpc?.({ name, base, args, n: rpcCalls, state })) { await deliver(null); throw new Error(`dommer-fejlinjektion: ${name}`); }
    const impl = RPCS[base];
    if (!impl) { unsupported.push(`rpc:${name}`); return deliver({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } }); }
    return deliver(impl(structuredClone(args)));
  }
  return { supabase: { from: builder, rpc }, log, unsupported, deliver };
}

// ── De to indgange ────────────────────────────────────────────────────────────────────────────
const QUIET = { info() {}, warn() {}, error() {}, log() {} };
const teamOf = (state) => structuredClone(state.teams[0]);

/** Trykket, kaldt som ruten kalder det (plus fast `now` og en stille logger). */
export function press(state, fake, { now = PRESS_AT, isBetaTester = true, confirm = true, season = SEASON, team = teamOf(state) } = {}) {
  return runTrainNow({
    supabase: fake.supabase, team, season, isBetaTester, now, logger: QUIET,
    loadDaySpans: async () => new Map(),
    confirmedShortRaceIds: confirm ? state.races.map((row) => row.id) : [],
  });
}

/** Aftenkoerslen for holdet: ét kald pr. loebsdag, som sweepen goer. Klar-listen regnes her af tilstanden. */
export async function sweep(state, fake, { now = EVENING_AT, tickDate = DATE1, deadlineReached = false } = {}) {
  const work = state.training_date_work.find((row) => row.tick_date === tickDate);
  const days = work?.game_days ?? (tickDate === DATE1 ? DAYS1 : DAYS2);
  const roster = work?.expected_rider_ids ?? state.riders.filter((row) => row.team_id === TEAM && !row.is_retired).map((row) => row.id);
  const unresolved = {};
  for (const rid of roster) {
    const frozen = state.training_train_now_locks.find((row) => row.rider_id === rid && row.tick_date === tickDate)?.instant_entry_snapshot?.slots;
    const slots = (frozen ?? state.race_entries.filter((e) => e.rider_id === rid).flatMap((e) => state.race_stage_schedule
      .filter((s) => s.race_id === e.race_id && s.scheduled_at.startsWith(tickDate)).map((s) => ({ raceId: s.race_id, stageNumber: s.stage_number, gameDay: s.game_day }))))
      .filter((slot) => Number(state.races.find((r) => r.id === slot.raceId)?.stages_completed) < Number(slot.stageNumber));
    if (slots.length) unresolved[rid] = slots;
  }
  const stamped = new Set(state.training_train_now_locks.filter((row) => row.tick_date === tickDate && row.instant_at != null).map((row) => row.rider_id));
  const eligible = roster.filter((rid) => !unresolved[rid] || stamped.has(rid) || deadlineReached);
  const out = [];
  for (const gameDay of days) {
    out.push(await runTeamTrainingDay({
      supabase: fake.supabase, teamId: TEAM, seasonId: SEASON.id, seasonNumber: SEASON.number, now, tickDateOverride: tickDate, gameDay,
      dateGameDays: days, executedBy: "assistant", eligibleRiderIds: eligible, unresolvedSlotsByRider: unresolved,
      deadlineAt: `${tickDate}T23:00:00.000Z`, deadlineReached,
    }).then((r) => ({ alreadyRan: r.alreadyRan, gameDay: r.gameDay, workStatus: r.workStatus ?? null, riders: (r.report?.riders ?? []).length }),
      (err) => ({ error: String(err.message) })));
  }
  return out;
}

// ── Scenarierne ───────────────────────────────────────────────────────────────────────────────
const BIG = { count: 48, entered: [3, 7, 11, 19, 23, 31, 40], injured: [5, 23], tired: [2, 14, 29, 44], noPlan: [4, 16, 33], boughtLate: [47], academy: [46], weekPlan: true, fatigueRules: true, staff: true };
const step = async (out, label, fn) => {
  try { out.push({ label, response: canon(await fn()) }); } catch (err) {
    // swallow-ok: et kast ER trinnets svar i optagelsen (fx et tryk, der afbrydes med vilje). Det
    // gemmes som svaret og sammenlignes med facit; det forsvinder ikke.
    out.push({ label, response: { thrown: String(err.message) } });
  }
};

export const SCENARIOS = {
  // Lille hold uden loeb: alle faar hele datoen.
  lille_hold_uden_loeb: { seed: { count: 6 }, async run(s, f, out) { await step(out, "tryk", () => press(s, f)); } },
  // Stort hold (45+), blandede dag-felter, loebsryttere med aaben etape, skadede, traette, undtagelser. Beta-tryk.
  stort_hold_beta_tryk: { seed: BIG, async run(s, f, out) { await step(out, "tryk", () => press(s, f)); } },
  // Samme hold, almindelig spiller (ikke beta): loebsrytterne venter paa deres loeb.
  stort_hold_almindeligt_tryk: { seed: BIG, async run(s, f, out) { await step(out, "tryk", () => press(s, f, { isBetaTester: false })); } },
  // Loebsdag hvor etapen ER koert foer trykket: loebsrytterne faar loebsdagen med.
  stort_hold_etape_koert: { seed: { ...BIG, stageRun: true }, async run(s, f, out) { await step(out, "tryk", () => press(s, f, { now: new Date("2026-11-09T17:30:00Z") })); } },
  // Allerede traenet: andet og tredje tryk samme dato.
  to_tryk_samme_dato: { seed: { count: 14, entered: [2, 5] }, async run(s, f, out) {
    await step(out, "tryk 1", () => press(s, f)); await step(out, "tryk 2", () => press(s, f, { now: new Date("2026-11-09T06:05:00Z") }));
    await step(out, "tryk 3 uden beta", () => press(s, f, { now: new Date("2026-11-09T06:10:00Z"), isBetaTester: false }));
  } },
  // Tryk, etapen koeres, aftenkoerslen lukker loebsrytterne, aftenkoerslen igen, og et sent tryk.
  tryk_saa_aftenkoersel: { seed: BIG, async run(s, f, out) {
    await step(out, "tryk", () => press(s, f)); finishRace(s);
    await step(out, "aftenkoersel", () => sweep(s, f)); await step(out, "aftenkoersel igen", () => sweep(s, f, { now: new Date("2026-11-09T19:35:00Z") }));
    await step(out, "tryk efter lukning", () => press(s, f, { now: new Date("2026-11-09T20:00:00Z") }));
  } },
  // Almindeligt tryk (uden straks-traening), saa etape og aftenkoersel.
  almindeligt_tryk_saa_aftenkoersel: { seed: BIG, async run(s, f, out) {
    await step(out, "tryk", () => press(s, f, { isBetaTester: false })); finishRace(s); await step(out, "aftenkoersel", () => sweep(s, f));
  } },
  // Aftenkoerslen alene (ingen tryk): den vej maa ikke aendre sig.
  aftenkoersel_uden_tryk: { seed: { ...BIG, stageRun: true }, async run(s, f, out) { await step(out, "aftenkoersel", () => sweep(s, f)); await step(out, "aftenkoersel igen", () => sweep(s, f, { now: new Date("2026-11-09T19:40:00Z") })); } },
  // Aftenkoerslen foer etapen er koert, saa efter, saa ved fristen.
  aftenkoersel_foer_og_efter_etape: { seed: { count: 20, entered: [1, 4, 6, 9, 12, 15, 18] }, async run(s, f, out) {
    await step(out, "foer etapen", () => sweep(s, f, { now: new Date("2026-11-09T14:00:00Z") })); finishRace(s); await step(out, "efter etapen", () => sweep(s, f));
  } },
  // To datoer: tryk dag 1, lukning, tryk dag 2 (bygger paa dag 1's tilstand).
  to_datoer: { seed: { count: 16, entered: [3, 8], secondDate: true, tired: [5] }, async run(s, f, out) {
    await step(out, "tryk dato 1", () => press(s, f)); finishRace(s); await step(out, "aftenkoersel dato 1", () => sweep(s, f));
    await step(out, "tryk dato 2", () => press(s, f, { now: PRESS2_AT }));
    await step(out, "tryk dato 2 igen", () => press(s, f, { now: new Date("2026-11-10T06:03:00Z") }));
  } },
  // Afbrudt tryk: gemme-kald nr. 3 fejler, og et nyt tryk goer dagen faerdig.
  afbrudt_og_genoptaget: { seed: { count: 14, entered: [2, 5] }, fail: ({ base, state }) => base === "commit_training_date_tick" && !state.__failed && (state.__commits = (state.__commits ?? 0) + 1) === 3 && (state.__failed = true),
    async run(s, f, out) { await step(out, "tryk der afbrydes", () => press(s, f)); await step(out, "nyt tryk", () => press(s, f, { now: new Date("2026-11-09T06:02:00Z") })); } },
  // Afbrudt tryk, hvorefter en rytter frigives og en skifter hold, foer det nye tryk.
  afbrudt_rytter_forlader_holdet: { seed: { count: 14, entered: [2] }, fail: ({ base, state }) => base === "commit_training_date_tick" && !state.__failed && (state.__commits = (state.__commits ?? 0) + 1) === 2 && (state.__failed = true),
    async run(s, f, out) {
      await step(out, "tryk der afbrydes", () => press(s, f));
      s.riders.find((row) => row.id === rider(6)).team_id = null; s.riders.find((row) => row.id === rider(8)).team_id = id(99);
      await step(out, "nyt tryk", () => press(s, f, { now: new Date("2026-11-09T06:02:00Z") })); finishRace(s); await step(out, "aftenkoersel", () => sweep(s, f));
    } },
  // En kontakt skiftes mellem to tryk (straks-traening slukkes): stemplet afgoer, ikke kontakten.
  kontakt_slukkes_mellem_tryk: { seed: { count: 12, entered: [1, 4] }, async run(s, f, out) {
    await step(out, "beta-tryk", () => press(s, f)); s.app_config.find((row) => row.key === "training_train_now_instant").value = "off";
    await step(out, "tryk efter slukning", () => press(s, f, { now: new Date("2026-11-09T06:04:00Z") })); finishRace(s); await step(out, "aftenkoersel", () => sweep(s, f));
  } },
  // En tilmelding gemmes efter trykket (maa ikke goere en laast rytter til loebsrytter).
  tilmelding_efter_tryk: { seed: { count: 12, entered: [1] }, async run(s, f, out) {
    await step(out, "tryk", () => press(s, f)); s.race_entries.push({ id: id(5999), race_id: RACE, rider_id: rider(7), team_id: TEAM, race_role: "helper" });
    await step(out, "tryk igen", () => press(s, f, { now: new Date("2026-11-09T06:06:00Z") })); finishRace(s); await step(out, "aftenkoersel", () => sweep(s, f));
  } },
  // Afvisninger. Hvert trin starter fra frisk tilstand; intet maa blive skrevet.
  afvisninger: { seed: { count: 8, entered: [1] }, async run(_s, _f, out, fresh) {
    const tryIt = async (label, seedPatch, opts = {}, mutate = () => {}) => { const { state, fake } = fresh(seedPatch); mutate(state); await step(out, label, async () => ({ ...(await press(state, fake, opts(state))), writes: fake.log.filter((e) => e.kind !== "read").length })); };
    const none = () => ({});
    await tryIt("kontakt slukket", { flags: { training_train_now: "off" } }, none);
    await tryIt("kontakt beta, ikke beta-spiller", { flags: { training_train_now: "beta" } }, () => ({ isBetaTester: false }));
    await tryIt("kontakt beta, beta-spiller", { flags: { training_train_now: "beta" } }, none);
    await tryIt("dato-afregning slukket", { flags: { training_condition_per_date: "off" } }, none);
    await tryIt("ingen saeson", {}, () => ({ season: null }));
    await tryIt("intet hold", {}, () => ({ team: null }));
    await tryIt("parkeret hold", { teamPatch: { parked_at: "2026-11-01T00:00:00Z" } }, none);
    await tryIt("hold uden pulje", { teamPatch: { league_division_id: null } }, none);
    await tryIt("korte loeb ikke bekraeftet", {}, () => ({ confirm: false }));
    await tryIt("ingen ryttere", { count: 0 }, none);
    await tryIt("ingen loebsdag i dag", {}, none, (state) => { state.race_stage_schedule = state.race_stage_schedule.filter((row) => !row.scheduled_at.startsWith(DATE1)); });
    await tryIt("dato allerede lukket", {}, none, (state) => { state.training_date_work.push({ team_id: TEAM, season_id: SEASON.id, tick_date: DATE1, status: "complete", game_days: DAYS1, expected_rider_ids: [], quarantined_rider_ids: [], opening_conditions: {} }); });
    await tryIt("tidligere dato aaben", {}, none, (state) => { state.training_date_work.push({ team_id: TEAM, season_id: SEASON.id, tick_date: "2026-11-08", status: "partial", game_days: [36, 37, 38, 39, 40], expected_rider_ids: [], quarantined_rider_ids: [], opening_conditions: {} }); });
    await tryIt("aftenkoerslen holder datoen", {}, none, (state) => { state.__held = true; });
  } },
};

const HELD = ({ base, state }) => state.__held === true && base === "register_training_date_work";

/** Koer ét scenarie og returnér alt, der blev optaget. */
export async function runScenario(name) {
  const scenario = SCENARIOS[name];
  const fakes = [];
  const fresh = (seedPatch = {}) => {
    const state = seedState({ ...scenario.seed, ...seedPatch });
    const fake = createFake(state, { failRpc: (ctx) => scenario.fail?.(ctx) === true });
    // "Aftenkoerslen holder datoen": databasens proev-laas svarer optaget.
    const realRpc = fake.supabase.rpc;
    fake.supabase.rpc = async (rpcName, args) => (HELD({ base: rpcName.replace(/^try_/, ""), state }) && rpcName.startsWith("try_")
      ? (fake.log.push({ kind: "rpc", target: rpcName, payload: canon(args), round: 0 }), fake.deliver({ data: { held: true }, error: null })) : realRpc(rpcName, args));
    fakes.push({ state, fake });
    return { state, fake };
  };
  const main = fresh();
  const steps = [];
  const marks = [];
  const mark = () => marks.push(fakes.reduce((sum, x) => sum + x.fake.log.length, 0));
  // Kald pr. trin: loggens laengde foer og efter hvert trin (kun hovedtilstanden taeller pr. trin).
  const counting = new Proxy(steps, { get(target, prop) { if (prop === "push") return (item) => { item.calls = countCalls(main.fake.log.slice(main.lastLen ?? 0)); main.lastLen = main.fake.log.length; mark(); return target.push(item); }; return target[prop]; } });
  // Motoren skriver advarsler direkte til konsollen (fx manglende private parametre). De er ikke en
  // del af resultatet; de samles her, saa en testkoersel ikke drukner i dem.
  const notes = new Set();
  const saved = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  for (const key of Object.keys(saved)) console[key] = (...parts) => { notes.add(String(parts[0]).slice(0, 160)); };
  try { await scenario.run(main.state, main.fake, counting, fresh); } finally { Object.assign(console, saved); }
  const log = fakes.flatMap((x) => x.fake.log);
  const { __failed: _f, __commits: _c, __held: _h, ...tables } = main.state;
  return {
    steps: steps.map(({ label, response }) => ({ label, response })),
    writes: main.fake.log.filter((entry) => entry.kind !== "read").map(({ round: _round, ...entry }) => entry),
    finalState: Object.fromEntries(Object.keys(tables).sort().map((table) => [table, canon(tables[table])])),
    calls: { perStep: steps.map(({ label, calls }) => ({ label, ...calls })), total: countCalls(log) },
    unsupported: [...new Set(fakes.flatMap((x) => x.fake.unsupported))],
    consoleNotes: [...notes],
  };
}

export function countCalls(entries) {
  const out = { total: entries.length, reads: 0, writes: 0, rpc: 0, rounds: new Set(entries.map((entry) => entry.round)).size, byTarget: {} };
  for (const entry of entries) {
    if (entry.kind === "read") out.reads += 1; else if (entry.kind === "write") out.writes += 1; else out.rpc += 1;
    const key = `${entry.kind}:${entry.target}`;
    out.byTarget[key] = (out.byTarget[key] ?? 0) + 1;
  }
  return out;
}

// ── Fingeraftryk: samme trae som den fulde optagelse, men motorens tal er erstattet af hashes ─
const RIDER_KEYS = ["rider_id", "riderId"];
const SAFE_ARGS = new Set(["p_team_id", "p_season_id", "p_squad", "p_game_day", "p_tick_date", "p_date_game_days", "p_executed_by", "p_deadline_reached", "p_now",
  "p_rider_ids", "p_eligible_rider_ids", "p_expected_rider_ids", "p_game_days", "p_deadline_at", "p_registered_at", "p_reason", "p_day_start", "p_day_end"]);
const byRider = (list) => {
  if (!Array.isArray(list) || !list.length || !list.every((row) => row && typeof row === "object" && RIDER_KEYS.some((k) => typeof row[k] === "string"))) return null;
  const out = {};
  list.forEach((row, i) => { const key = `${row.rider_id ?? row.riderId}#${Object.keys(out).filter((k) => k.startsWith(row.rider_id ?? row.riderId)).length}`; out[key] = { position: i, hash: digest(row) }; });
  return out;
};
const printValue = (value) => byRider(value) ?? (value && typeof value === "object" && !Array.isArray(value) ? { hash: digest(value) } : Array.isArray(value) ? { count: value.length, hash: digest(value) } : { hash: digest(value) });
const rowKey = (row) => ["key", "rider_id", "team_id", "race_id", "stage_number", "game_day", "tick_date", "snapshot_date", "source", "id"].filter((k) => row[k] != null).map((k) => `${k}=${row[k]}`).join(",") || digest(row);

// Saettets id'er deler et langt, ens forled; i fingeraftrykket forkortes det til "~" (kun for filstoerrelsen).
const ID_PREFIX = "00000000-0000-4000-8000-00000000";
export function fingerprint(run) {
  return JSON.parse(JSON.stringify(fullFingerprint(run)).replaceAll(ID_PREFIX, "~"));
}
function fullFingerprint(run) {
  return {
    steps: run.steps,
    writes: run.writes.map((entry) => {
      const base = { kind: entry.kind, target: entry.target, ...(entry.op ? { op: entry.op } : {}), ...(entry.filters ? { filters: entry.filters } : {}), ...(entry.options ? { options: entry.options } : {}) };
      if (entry.kind === "rpc") {
        const args = {};
        for (const [key, value] of Object.entries(entry.payload ?? {})) {
          if (SAFE_ARGS.has(key)) args[key] = value;
          else if (key === "p_report") { const { riders, ...rest } = value ?? {}; args[key] = { riders: byRider(riders ?? []) ?? { count: (riders ?? []).length }, rest: Object.fromEntries(Object.entries(rest).map(([k, v]) => [k, typeof v === "object" && v !== null ? digest(v) : v])) }; } else args[key] = printValue(value);
        }
        return { ...base, args };
      }
      return { ...base, payload: printValue(entry.payload) };
    }),
    finalState: Object.fromEntries(Object.entries(run.finalState).map(([table, rows]) => {
      const out = {}; for (const row of rows) { let key = rowKey(row); while (key in out) key += "+"; out[key] = digest(row); }
      return [table, { count: rows.length, rows: out }];
    })),
  };
}

/** Foerste afvigelse mellem facit og en koersel, som en sti man kan laese. null = ens. */
export function firstDifference(expected, actual, path = "") {
  if (expected === actual) return null;
  if (expected === null || actual === null || typeof expected !== "object" || typeof actual !== "object") return { path: path || "(roden)", expected, actual };
  if (Array.isArray(expected) !== Array.isArray(actual)) return { path, expected: Array.isArray(expected) ? "liste" : "objekt", actual: Array.isArray(actual) ? "liste" : "objekt" };
  if (Array.isArray(expected)) {
    for (let i = 0; i < Math.min(expected.length, actual.length); i += 1) { const d = firstDifference(expected[i], actual[i], `${path}[${i}]`); if (d) return d; }
    return expected.length === actual.length ? null : { path: `${path}.length`, expected: expected.length, actual: actual.length };
  }
  for (const key of Object.keys(expected)) {
    if (!(key in actual)) return { path: `${path}.${key}`, expected: expected[key], actual: "(mangler)" };
    const d = firstDifference(expected[key], actual[key], `${path}.${key}`); if (d) return d;
  }
  for (const key of Object.keys(actual)) if (!(key in expected)) return { path: `${path}.${key}`, expected: "(findes ikke i facit)", actual: actual[key] };
  return null;
}
