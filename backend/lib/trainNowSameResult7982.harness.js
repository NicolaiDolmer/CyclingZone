// #7982 trin 2-5, dommerens proevesaet ("samme resultat som foer"). Skrevet FOER foerste kodelinje
// (AGENTS.md regel 40). Filen ejes af dommeren: byggeren aendrer den ikke. Skal den udvides
// (fx en ny databasefunktion i et senere trin), goer dommeren det og fryser facit igen.
//
// Udgave til trin 3 (13/11): udvidet FOER trin 3's foerste kodelinje med (a) hvilke laesninger der
// ligger mellem hvilke skrivninger ("hver laesning ser samme database som foer"), (b) fejl i hver
// laesning og en database der falder ud, (c) forrang mellem afvisninger, (d) to hold og to tryk paa
// samme tid, og (e) en cache der ikke maa leve videre til naeste tryk. De 15 oprindelige scenarier
// er uaendrede og giver praecis samme fingeraftryk som i trin 2's facit.
//
// Udgave til trin 4a (13/11), frosset fra main EFTER trin 3 og FOER trin 4a's foerste kodelinje.
// Trin 4a lader serveren regne datoens fem dag-felter fra ÉN indlaesning. Nyt i saettet:
// (f) seks scenarier mere: loebsryttere bundet til et loeb paa loebsdage uden etape (hullet fra
//     dommen over trin 3), og aftenkoerslen, der tager datoen midt i et tryk;
// (g) stedfortraederen kan svare i OMVENDT raekkefoelge og med noeglerne i databasens (jsonb)
//     raekkefoelge: resultatet maa ikke afhaenge af nogen af delene;
// (h) reglerne for, hvilke laesninger der maa forsvinde i trin 4a (compareToFacit nederst);
// (i) en genregistrering af en dato, der allerede er registreret, taeller ikke som en skrivning
//     (den aendrer intet; bevist mod rigtig PostgreSQL i trainNowDatabaseSvar7982.integration.test.js).
//
// Udgave 2 til trin 4a (13/11, efter dommerens afgoerelse om PR #8148, se afgoerelse-proever.md):
// (j) et AFBRUDT tryk maa hente loebs-opslagene for alle datoens loebsdage foer foerste gemme-kald,
//     ogsaa dem, det gamle tryk aldrig naaede, fordi det blev afbrudt ("uafbrudt" i facit);
// (k) i "fejl_i_hver_laesning" skal hver laesning FOER foerste gemme-kald stadig findes og proeves;
//     laesninger efter maa forsvinde (gulvet paa 100 laesninger i proevefilen er vaek);
// (l) gemme-kaldets vaern mod en frigivet rytter (karantaene) og karantaenens bevis, som databasen
//     skriver dem, og et scenarie, hvor en rytter frigives lige foer et gemme-kald.
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

// Tabeller et tryk aldrig selv skriver i (dommerens gennemgang i trin 2: trykkets databasefunktioner
// og triggere roerer dem ikke). En laesning i dem maa flytte sig inden for trykket. Alle ANDRE
// laesninger skal blive mellem de samme to skrivninger som foer (se readIntervals).
export const NEVER_WRITTEN_BY_PRESS = Object.freeze(new Set([
  "app_config", "private_config", "teams", "team_facilities", "team_staff",
  "team_training_rules", "training_groups", "training_plans", "training_week_plans", "races",
]));
class InjectedFailure extends Error {}

// PostgreSQL gemmer jsonb med noeglerne sorteret: kortest foerst, derefter efter tegn. Saadan
// kommer de ogsaa tilbage. Stedfortraederen kan svare paa samme maade (se jsonbOrden).
export const jsonbOrder = (value) => {
  if (Array.isArray(value)) return value.map(jsonbOrder);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.keys(value).sort((a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0)).map((key) => [key, jsonbOrder(value[key])]));
};

/**
 * @param {object} state
 * @param {{failRpc?: Function|null, fail?: Function|null, omvendt?: boolean, jsonbOrden?: boolean}} [options]
 *   omvendt: af de kald, der er sendt samtidig, faar det SIDST sendte svar foerst, og hvert svar
 *   kommer for sig (et rigtigt netvaerk lover ingen raekkefoelge). jsonbOrden: alle svar har
 *   noeglerne i databasens raekkefoelge.
 */
export function createFake(state, { failRpc = null, fail = null, omvendt = false, jsonbOrden = false } = {}) {
  const ctx = { tryk: 0 }; // > 0 mens et tryk er undervejs (se press)
  const log = []; // hvert kald i raekkefoelge
  const unsupported = []; // noget stedfortraederen ikke kender: saa er proeven ugyldig
  // "Runder": kald, der sendes af sted samtidig (fx i én Promise.all), faar svar i samme runde.
  // Kald, der venter paa et tidligere svar, havner i en senere runde. Antal runder pr. tryk er
  // derfor det antal gange, koden staar og venter paa databasen efter hinanden (maaletal for trin 3).
  let round = 1; let waiting = [];
  const deliver = (result) => new Promise((resolve) => {
    if (!waiting.length) setImmediate(() => {
      const batch = waiting; waiting = []; round += 1;
      if (!omvendt) { for (const done of batch) done(); return; }
      const next = () => { const done = batch.pop(); if (!done) return; done(); if (batch.length) setImmediate(next); };
      next();
    });
    waiting.push(() => resolve(jsonbOrden ? jsonbOrder(result) : result));
  });
  // `after` = antal skrivninger og funktionskald FOER dette kald (for en laesning: hvilket mellemrum den ligger i).
  // En genregistrering (`gen`) taeller ikke: den aendrer intet i databasen.
  let nonReads = 0;
  const record = (entry) => { entry.round = round; entry.after = nonReads; if (ctx.tryk > 0) entry.tryk = true; if (entry.kind !== "read" && !entry.gen) nonReads += 1; log.push(entry); return entry; };
  // Dommerens fejl-indsproejtning: `fail({ entry, index, state })` svarer "error" (databasen svarer med
  // en fejl), "throw" (kaldet kaster, fx et netvaerk der falder ud) eller intet. Kaldet er allerede
  // optaget, saa det taeller med; det udfoeres ikke.
  const injected = (entry) => {
    const mode = fail?.({ entry, index: log.length - 1, state }) ?? null;
    if (mode === "throw") throw new InjectedFailure(`dommer-fejl (kast): ${entry.target}`);
    return mode === "error" ? { data: null, count: null, error: { code: "XX000", message: `dommer-fejl: ${entry.target}` } } : null;
  };
  // Et kast fra fejl-indsproejtningen leveres som et afvist loefte i samme runde som de andre kald.
  const settled = (fn) => { try { return deliver(fn()); } catch (err) { if (err instanceof InjectedFailure) return deliver(null).then(() => { throw err; }); throw err; } };

  function builder(table) {
    const filters = []; const spec = [];
    let write = null, limit = null, orders = [], countOnly = false, returning = false;
    const add = (name, col, val, fn) => { spec.push([name, col, canon(val)]); filters.push(fn); };
    const matching = () => (state[table] ?? []).filter((row) => filters.every((fn) => fn(row)));
    const run = () => {
      state[table] ??= [];
      if (!write) {
        const failed = injected(record({ kind: "read", target: table, filters: spec }));
        if (failed) return failed;
        let out = matching();
        for (const [col, asc] of [...orders].reverse()) out = [...out].sort((a, b) => { const x = pathGet(a, col), y = pathGet(b, col); return (x == null ? 1 : y == null ? -1 : x < y ? -1 : x > y ? 1 : 0) * (asc ? 1 : -1); });
        const count = out.length;
        if (limit != null) out = out.slice(0, limit);
        return countOnly ? { data: null, count, error: null } : { data: structuredClone(out), count, error: null };
      }
      const failed = injected(record({ kind: "write", target: table, op: write.kind, filters: spec, payload: canon(write.payload), options: canon(write.options ?? null) }));
      if (failed) return failed;
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
      range(from, to) { return settled(() => { const r = run(); return { ...r, data: (r.data ?? []).slice(from, to + 1) }; }); },
      maybeSingle() { return settled(() => { const r = run(); return { data: r.data?.[0] ?? null, error: r.error }; }); },
      single() { return settled(() => { const r = run(); return r.data?.length === 1 ? { data: r.data[0], error: null } : { data: null, error: r.error ?? { code: "PGRST116", message: "no single row" } }; }); },
      insert(payload, options) { write = { kind: "insert", payload, options }; return q; },
      update(payload, options) { write = { kind: "update", payload, options }; return q; },
      upsert(payload, options) { write = { kind: "upsert", payload, options }; return q; },
      delete() { write = { kind: "delete", payload: null }; return q; },
      abortSignal() { return q; }, throwOnError() { return q; }, returns() { return q; },
      then(resolve, reject) {
        try { return settled(run).then(resolve, reject); } catch (err) {
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
  // Karantaene, som databasen goer det: kun ryttere, der ikke allerede er i karantaene eller afregnet;
  // et bevis pr. rytter; datoens mangler = karantaene-beviserne (uden tilstandene) + afregningernes mangler;
  // status "partial", indtil alle andre har alle fem dag-felter, saa "needs_reconciliation".
  const quarantine = (work, riderIds, reason, now, args) => {
    const settled = (rid) => state.training_condition_settlements.some((row) => row.rider_id === rid && row.season_id === args.p_season_id && row.tick_date === args.p_tick_date);
    const added = [...new Set(riderIds)].filter((rid) => !work.quarantined_rider_ids.includes(rid) && !settled(rid)).sort();
    if (!added.length) return [];
    const evidence = added.map((rid) => ({ rider_id: rid, kind: "quarantined", reason, condition_applied: false, at: now,
      applied_receipt_days: state.training_rider_ticks.filter((row) => row.rider_id === rid && row.season_id === args.p_season_id && row.tick_date === args.p_tick_date).map((row) => row.game_day).sort((a, b) => a - b),
      opening_condition: structuredClone(work.opening_conditions?.[rid] ?? null), current_condition: structuredClone(state.rider_condition.find((row) => row.rider_id === rid) ?? null) }));
    work.quarantined_rider_ids = [...work.quarantined_rider_ids, ...added];
    work.quarantine_evidence = [...(work.quarantine_evidence ?? []), ...evidence];
    const fromSettlements = state.training_condition_settlements.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && work.expected_rider_ids.includes(row.rider_id)).flatMap((row) => row.missing_evidence.map((e) => ({ ...e, rider_id: row.rider_id })));
    work.missing_evidence = [...work.quarantine_evidence.map(({ opening_condition: _o, current_condition: _c, ...e }) => e), ...fromSettlements];
    const active = work.expected_rider_ids.filter((rid) => !work.quarantined_rider_ids.includes(rid));
    const receipts = state.training_rider_ticks.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && active.includes(row.rider_id)).length;
    work.status = receipts === active.length * 5 ? "needs_reconciliation" : "partial";
    work.updated_at = now;
    return added;
  };

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
          expected_rider_ids: [...args.p_expected_rider_ids], deadline_at: args.p_deadline_at, created_at: args.p_registered_at, updated_at: args.p_registered_at, status: "pending",
          quarantined_rider_ids: [], quarantine_evidence: [], missing_evidence: [],
          opening_conditions: Object.fromEntries(state.rider_condition.filter((row) => args.p_expected_rider_ids.includes(row.rider_id)).map((row) => [row.rider_id, structuredClone(row)])) };
        state.training_date_work.push(work);
      }
      return { data: structuredClone(work), error: null };
    },
    quarantine_training_date_riders(args) {
      const work = workOf(args);
      const added = quarantine(work, args.p_rider_ids, args.p_reason, args.p_now, args);
      return { data: { quarantined_rider_ids: added, work_status: work.status, work: structuredClone(work) }, error: null };
    },
    depart_training_date_riders(args) {
      const work = workOf(args);
      const settled = (rid) => state.training_condition_settlements.some((row) => row.rider_id === rid && row.season_id === args.p_season_id && row.tick_date === args.p_tick_date);
      const left = (rid) => { const r = state.riders.find((row) => row.id === rid); return Boolean(r) && r.team_id == null; };
      const added = [...new Set(args.p_rider_ids)].filter((rid) => !work.quarantined_rider_ids.includes(rid) && !settled(rid) && left(rid)).sort();
      if (!added.length) return { data: { departed_rider_ids: [], work_status: work.status }, error: null };
      const evidence = added.map((rid) => ({ rider_id: rid, kind: "departed", reason: "left_team", at: args.p_now,
        applied_receipt_days: state.training_rider_ticks.filter((row) => row.rider_id === rid && row.season_id === args.p_season_id && row.tick_date === args.p_tick_date).map((row) => row.game_day).sort((a, b) => a - b),
        opening_condition: structuredClone(work.opening_conditions?.[rid] ?? null) }));
      work.quarantined_rider_ids = [...work.quarantined_rider_ids, ...added];
      work.departure_evidence = [...(work.departure_evidence ?? []), ...evidence];
      const missing = state.training_condition_settlements.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && work.expected_rider_ids.includes(row.rider_id)).flatMap((row) => row.missing_evidence.map((e) => ({ ...e, rider_id: row.rider_id })))
        .concat((work.quarantine_evidence ?? []).map(({ opening_condition: _o, current_condition: _c, ...e }) => e));
      const active = work.expected_rider_ids.filter((rid) => !work.quarantined_rider_ids.includes(rid));
      const receipts = state.training_rider_ticks.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && active.includes(row.rider_id)).length;
      if (receipts === active.length * 5) work.status = missing.length ? "needs_reconciliation" : "complete";
      work.missing_evidence = missing; work.updated_at = args.p_now;
      return { data: { departed_rider_ids: added, work_status: work.status, work: structuredClone(work) }, error: null };
    },
    freeze_train_now_date_entries(args) {
      return { data: args.p_rider_ids.map((rider_id) => {
        const lock = state.training_train_now_locks.find((row) => row.rider_id === rider_id && row.tick_date === args.p_tick_date);
        if (!lock) return { rider_id, slots: null };
        if (lock.instant_entry_snapshot == null) {
          lock.instant_entry_snapshot = { raceIds: state.race_entries.filter((row) => row.rider_id === rider_id).map((row) => row.race_id).sort(), slots: openSlots(rider_id, args.p_tick_date) };
          lock.instant_game_days = [...(workOf(args)?.game_days ?? [])];
        }
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
      const unsafe = fresh.filter((rid) => { const r = state.riders.find((row) => row.id === rid); return !r || r.team_id == null || r.is_retired === true || !(rid in (work.opening_conditions ?? {})); });
      if (unsafe.length) {
        quarantine(work, unsafe, "unsafe_current_state", args.p_now, args);
        for (const rid of unsafe) fresh.splice(fresh.indexOf(rid), 1);
        if (!fresh.length) return { data: { already_ran: true, report: oldRun?.report ?? { riders: [], condition_per_date: true }, work_status: work.status, quarantined_rider_ids: unsafe }, error: null };
      }
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
      const missing = state.training_condition_settlements.filter((row) => row.season_id === args.p_season_id && row.tick_date === args.p_tick_date && work.expected_rider_ids.includes(row.rider_id)).flatMap((row) => row.missing_evidence.map((e) => ({ ...e, rider_id: row.rider_id })))
        .concat((work.quarantine_evidence ?? []).map(({ opening_condition: _o, current_condition: _c, ...e }) => e));
      work.status = count === active.length * work.game_days.length ? (missing.length ? "needs_reconciliation" : "complete") : "partial";
      work.missing_evidence = missing; work.updated_at = args.p_now;
      return { data: { already_ran: false, applied_rider_ids: fresh, report: structuredClone(report), work_status: work.status }, error: null };
    },
  };

  let rpcCalls = 0;
  async function rpc(name, args) {
    rpcCalls += 1;
    const base = name.replace(/^try_/, "");
    // Datoen er allerede registreret: kaldet svarer med den registrering, der staar, og skriver intet.
    const gen = base === "register_training_date_work" && Boolean(workOf(args));
    const entry = record({ kind: READ_ONLY_RPCS.has(base) ? "read" : "rpc", target: name, payload: canon(args), ...(gen ? { gen: true } : {}) });
    if (failRpc?.({ name, base, args, n: rpcCalls, state })) { await deliver(null); throw new Error(`dommer-fejlinjektion: ${name}`); }
    let failed;
    try { failed = injected(entry); } catch (err) { await deliver(null); throw err; }
    if (failed) return deliver(failed);
    const impl = RPCS[base];
    if (!impl) { unsupported.push(`rpc:${name}`); return deliver({ data: null, error: { code: "PGRST202", message: `Could not find the function public.${name} in the schema cache` } }); }
    return deliver(impl(structuredClone(args)));
  }
  return { supabase: { from: builder, rpc }, log, unsupported, deliver, ctx };
}

// ── De to indgange ────────────────────────────────────────────────────────────────────────────
const QUIET = { info() {}, warn() {}, error() {}, log() {} };
const teamOf = (state) => structuredClone(state.teams[0]);

/** Trykket, kaldt som ruten kalder det (plus fast `now` og en stille logger). */
export function press(state, fake, { now = PRESS_AT, isBetaTester = true, confirm = true, season = SEASON, team = teamOf(state) } = {}) {
  fake.ctx.tryk += 1;
  return runTrainNow({
    supabase: fake.supabase, team, season, isBetaTester, now, logger: QUIET,
    loadDaySpans: async () => new Map(),
    confirmedShortRaceIds: confirm ? state.races.map((row) => row.id) : [],
  }).finally(() => { fake.ctx.tryk -= 1; });
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
      deadlineAt: new Date(Date.parse(`${tickDate}T00:00:00Z`) + 25 * 3600 * 1000).toISOString(), deadlineReached,
    }).then((r) => ({ alreadyRan: r.alreadyRan, gameDay: r.gameDay, workStatus: r.workStatus ?? null, riders: (r.report?.riders ?? []).length }),
      (err) => ({ error: String(err.message) })));
  }
  return out;
}

// ── Scenarierne ───────────────────────────────────────────────────────────────────────────────
const BIG = { count: 48, entered: [3, 7, 11, 19, 23, 31, 40], injured: [5, 23], tired: [2, 14, 29, 44], noPlan: [4, 16, 33], boughtLate: [47], academy: [46], weekPlan: true, fatigueRules: true, staff: true };
const step = async (out, label, fn, fake = null) => {
  try { out.push({ label, response: canon(await fn()), fake }); } catch (err) {
    // swallow-ok: et kast ER trinnets svar i optagelsen (fx et tryk, der afbrydes med vilje). Det
    // gemmes som svaret og sammenlignes med facit; det forsvinder ikke.
    out.push({ label, response: { thrown: String(err.message) }, fake });
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
    const tryIt = async (label, seedPatch, opts = {}, mutate = () => {}) => { const { state, fake } = fresh(seedPatch); mutate(state); await step(out, label, async () => ({ ...(await press(state, fake, opts(state))), writes: fake.log.filter((e) => e.kind !== "read" && !e.gen).length }), fake); };
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

// ── Trin 3: hjaelpere til de nye scenarier ────────────────────────────────────────────────────
const tablesOf = (state) => { const { __failed: _f, __commits: _c, __held: _h, ...tables } = state; return Object.fromEntries(Object.keys(tables).sort().map((table) => [table, canon(tables[table])])); };
/** Fingeraftryk af hele tilstanden (alle tabeller). */
export const stateDigest = (state) => digest(tablesOf(state));
/** Fingeraftryk af alle skrivninger og funktionskald i en stedfortraeders log, i raekkefoelge. */
export const writesDigest = (log) => digest(log.filter((entry) => entry.kind !== "read" && !entry.gen && !entry.holdt).map(({ round: _round, after: _after, ...entry }) => entry));
const doubleDayFields = (state) => state.training_rider_ticks.length - new Set(state.training_rider_ticks.map((row) => `${row.rider_id}|${row.game_day}`)).size;
// Svaret paa et tryk som ét ord: statuskode (og fejlnavn), eller "kast". Fejlteksten er ikke med:
// hvilken laesning der naar at fejle foerst, maa aendre sig, naar laesninger sendes samtidig.
const answerOf = (promise) => promise.then(
  (result) => (result.status === 200 ? "200" : `${result.status} ${result.body?.error ?? ""}`.trim()),
  () => "kast",
);
// Hvilken laesning er det? En laesning i en tabel, trykket aldrig skriver i, kendes paa tabel og
// spoergsmaal. Alle andre kendes ogsaa paa, hvilke to skrivninger de ligger imellem.
const readSlotKey = (entry, counts) => {
  const fixed = NEVER_WRITTEN_BY_PRESS.has(entry.target);
  const base = `${fixed ? "fast" : `efter ${entry.after}`} | ${entry.target} | ${digest(entry.filters ?? entry.payload ?? null)}`;
  const n = counts.get(base) ?? 0; counts.set(base, n + 1);
  return { key: `${base} | nr. ${n + 1}`, fixed };
};
// Holdet til fejl-proeverne: lille nok til at koere mange gange, men med loebsryttere (beta-tryk),
// en skadet, en traet, ugeplan, traethedsregler, traener og facilitet, saa alle laesninger er med.
const FAULT = { count: 9, entered: [1, 4], injured: [5], tired: [2], weekPlan: true, fatigueRules: true, staff: true };
const SMALL_RESET = { count: 6, entered: [], injured: [], tired: [], noPlan: [], boughtLate: [], academy: [], weekPlan: false, fatigueRules: false, staff: false };

Object.assign(SCENARIOS, {
  // En cache maa ikke leve videre til naeste tryk: et tryk afbrydes, en anden aendrer noget i de
  // tabeller et tryk kun laeser én gang (plan, ugeplan, traethedsregel, stab, facilitet, en kontakt),
  // og det nye tryk skal regne resten af datoen paa det NYE, praecis som paa main.
  cache_lever_ikke_videre: { seed: { count: 14, entered: [2, 5], weekPlan: true, fatigueRules: true, staff: true },
    fail: ({ base, state }) => base === "commit_training_date_tick" && !state.__failed && (state.__commits = (state.__commits ?? 0) + 1) === 3 && (state.__failed = true),
    async run(s, f, out, fresh) {
      await step(out, "tryk der afbrydes", () => press(s, f));
      s.training_plans.forEach((plan, i) => { if (i % 3 === 0) plan.intensity = plan.intensity === "hard" ? "easy" : "hard"; });
      s.training_week_plans[0].days = Object.fromEntries(WEEKDAYS.map((d) => [d, { intensity: "hard" }]));
      s.team_training_rules[0].fatigue_threshold = 25;
      s.team_staff[0].tier = 3; s.team_facilities[0].tier = 3;
      s.app_config.find((row) => row.key === "training_fatigue_rules").value = "off";
      await step(out, "nyt tryk efter aendringerne", () => press(s, f, { now: new Date("2026-11-09T06:02:00Z") }));
      finishRace(s); await step(out, "aftenkoersel", () => sweep(s, f));
      // Kontrol: samme forloeb UDEN aendringerne skal ende et andet sted, ellers viser scenariet intet.
      await step(out, "kontrol uden aendringer ender et andet sted", async () => {
        const control = fresh();
        await answerOf(press(control.state, control.fake)); await answerOf(press(control.state, control.fake, { now: new Date("2026-11-09T06:02:00Z") }));
        finishRace(control.state); await sweep(control.state, control.fake);
        return { andetSlutresultat: stateDigest(control.state) !== stateDigest(s) };
      });
    } },
  // Forrang mellem afvisninger: gaelder to grunde paa én gang, vinder den, der tjekkes foerst i dag.
  // Hvert trin starter fra frisk tilstand; intet maa blive skrevet.
  afvisninger_forrang: { seed: { count: 8, entered: [1] }, async run(_s, _f, out, fresh) {
    const tryIt = async (label, seedPatch, opts = () => ({}), mutate = () => {}) => { const { state, fake } = fresh(seedPatch); mutate(state); await step(out, label, async () => ({ ...(await press(state, fake, opts(state))), writes: fake.log.filter((e) => e.kind !== "read" && !e.gen).length }), fake); };
    const settled = (state) => { state.training_date_work.push({ team_id: TEAM, season_id: SEASON.id, tick_date: DATE1, status: "complete", game_days: DAYS1, expected_rider_ids: [], quarantined_rider_ids: [], opening_conditions: {} }); };
    const earlierOpen = (state) => { state.training_date_work.push({ team_id: TEAM, season_id: SEASON.id, tick_date: "2026-11-08", status: "partial", game_days: [36, 37, 38, 39, 40], expected_rider_ids: [], quarantined_rider_ids: [], opening_conditions: {} }); };
    const noStageToday = (state) => { state.race_stage_schedule = state.race_stage_schedule.filter((row) => !row.scheduled_at.startsWith(DATE1)); };
    await tryIt("intet hold + kontakt slukket", { flags: { training_train_now: "off" } }, () => ({ team: null }));
    await tryIt("kontakt slukket + dato-afregning slukket", { flags: { training_train_now: "off", training_condition_per_date: "off" } });
    await tryIt("dato-afregning slukket + ingen saeson", { flags: { training_condition_per_date: "off" } }, () => ({ season: null }));
    await tryIt("ingen saeson + parkeret hold", { teamPatch: { parked_at: "2026-11-01T00:00:00Z" } }, () => ({ season: null }));
    await tryIt("parkeret hold + hold uden pulje", { teamPatch: { parked_at: "2026-11-01T00:00:00Z", league_division_id: null } });
    await tryIt("hold uden pulje + dato allerede lukket", { teamPatch: { league_division_id: null } }, undefined, settled);
    await tryIt("dato allerede lukket + tidligere dato aaben", {}, undefined, (state) => { settled(state); earlierOpen(state); });
    await tryIt("dato allerede lukket + korte loeb ikke bekraeftet", {}, () => ({ confirm: false }), settled);
    await tryIt("tidligere dato aaben + korte loeb ikke bekraeftet", {}, () => ({ confirm: false }), earlierOpen);
    await tryIt("korte loeb ikke bekraeftet + aftenkoerslen holder datoen", {}, () => ({ confirm: false }), (state) => { state.__held = true; });
    await tryIt("ingen loebsdag i dag + ingen ryttere", { count: 0 }, undefined, noStageToday);
    await tryIt("ingen ryttere + aftenkoerslen holder datoen", { count: 0 }, undefined, (state) => { state.__held = true; });
  } },
  // To hold trykker i samme oejeblik (hver sin database-stedfortraeder, samme proces). Hvert hold skal
  // ende praecis som naar det trykker alene: intet maa deles mellem to tryk.
  to_hold_samtidig: { seed: BIG, async run(s, f, out, fresh) {
    const other = fresh(SMALL_RESET);
    await step(out, "stort og lille hold samtidig", async () => {
      const [big, small] = await Promise.all([press(s, f), press(other.state, other.fake)]);
      return { stort: big, lille: small, lilleSkrivninger: writesDigest(other.fake.log), lilleSlut: stateDigest(other.state) };
    });
  } },
  // To tryk i samme oejeblik paa SAMME hold. Stedfortraederen har ikke databasens laas, saa det er
  // ikke et bevis for samtidighed i databasen (det doemmes paa rigtig PostgreSQL). Det er en vagt for
  // koden: ingen rytter faar et dag-felt to gange, og efter et nyt tryk og aftenkoerslen er
  // slutresultatet det samme som efter ét tryk. Kun de ting fryses, ikke hvem der kom foerst.
  to_tryk_i_samme_oejeblik: { seed: FAULT, concurrent: true, async run(_s, _f, out, fresh) {
    for (const isBetaTester of [true, false]) {
      await step(out, isBetaTester ? "beta-tryk" : "almindeligt tryk", async () => {
        const finish = async ({ state, fake }) => { await answerOf(press(state, fake, { isBetaTester })); await answerOf(press(state, fake, { isBetaTester })); finishRace(state); await sweep(state, fake); return stateDigest(state); };
        const twice = fresh();
        const answers = await Promise.all([answerOf(press(twice.state, twice.fake, { isBetaTester })), answerOf(press(twice.state, twice.fake, { isBetaTester }))]);
        const dobbelteDagFelter = doubleDayFields(twice.state);
        const once = fresh();
        await answerOf(press(once.state, once.fake, { isBetaTester }));
        return { mindstEtTrykGikIgennem: answers.includes("200"), dobbelteDagFelter, slutSomEfterEtTryk: await finish(twice) === await finish(once) };
      });
    }
  } },
  // Fejl i HVER laesning, én ad gangen, baade som fejlsvar og som kast. For hver: hvad svarede
  // trykket, hvad stod der i databasen bagefter, og hvor ender et nyt tryk (samme klokkeslaet)?
  // En laesning, der sendes samtidig med andre, skal stadig stoppe trykket, foer noget nyt skrives.
  fejl_i_hver_laesning: { seed: FAULT, async run(_s, _f, out, fresh) {
    const clean = fresh();
    await answerOf(press(clean.state, clean.fake));
    const counts = new Map();
    const firstCommit = clean.fake.log.findIndex((entry) => entry.kind === "rpc" && entry.target.endsWith("commit_training_date_tick"));
    const slots = clean.fake.log.map((entry, index) => ({ entry, index })).filter(({ entry }) => entry.kind === "read").map(({ entry, index }) => ({ ...readSlotKey(entry, counts), early: index < firstCommit }));
    for (const mode of ["error", "throw"]) {
      await step(out, mode === "error" ? "databasen svarer med en fejl" : "kaldet kaster", async () => {
        const result = {};
        for (const slot of slots) {
          const seen = new Map(); let fired = false;
          const { state, fake } = fresh({}, { fail: ({ entry }) => { if (fired || entry.kind !== "read") return null; if (readSlotKey(entry, seen).key !== slot.key) return null; fired = true; return mode; } });
          const svar = await answerOf(press(state, fake));
          const efterFejl = stateDigest(state);
          const nytTryk = await answerOf(press(state, fake));
          result[slot.key] = { ramt: fired, svar, ...(slot.fixed ? {} : { efterFejl }), nytTryk, efterNytTryk: stateDigest(state), ...(slot.early ? { foerFoersteGemmeKald: true } : {}) };
        }
        return result;
      });
    }
  } },
  // Databasen falder ud midt i trykket: efter skrivning nr. j fejler ALT (laesninger og skrivninger).
  // Intet nyt maa blive skrevet, intet loefte maa staa uden ejer, og et nyt tryk goer dagen faerdig.
  database_falder_ud: { seed: FAULT, async run(_s, _f, out, fresh) {
    const clean = fresh();
    await answerOf(press(clean.state, clean.fake));
    const points = clean.fake.log.filter((entry) => entry.kind !== "read" && !entry.gen).length;
    // Tredje udgave: kontakterne svarer stadig, saa trykket naar forbi de foerste tjek, foer alt andet kaster.
    for (const [label, mode, spared] of [["alt svarer med fejl", "error", null], ["alt kaster", "throw", null], ["alt undtagen kontakterne kaster", "throw", "app_config"]]) {
      await step(out, label, async () => {
        const result = {};
        for (let j = 0; j <= points; j += 1) {
          let down = true;
          const { state, fake } = fresh({}, { fail: ({ entry }) => (down && entry.after >= j && entry.target !== spared ? mode : null) });
          const svar = await answerOf(press(state, fake));
          const efterFejl = stateDigest(state); const skrevet = fake.log.filter((entry) => entry.kind !== "read" && !entry.gen && entry.after < j).length;
          down = false;
          const nytTryk = await answerOf(press(state, fake));
          result[`efter skrivning nr. ${String(j).padStart(2, "0")}`] = { gikIgennem: svar === "200", skrevetFoerFejlen: skrevet, efterFejl, nytTryk, efterNytTryk: stateDigest(state) };
        }
        return result;
      });
    }
  } },
});

const HELD = ({ base, state }) => state.__held === true && (base === "register_training_date_work" || base === "commit_training_date_tick");

// ── Trin 3: hver laesning ser samme database som foer ─────────────────────────────────────────
// Mellem to skrivninger (eller funktionskald) ligger et mellemrum. Laesninger maa bytte plads og
// sendes samtidig INDEN FOR et mellemrum, men ingen laesning maa flytte til et andet mellemrum:
// saa ville den se en anden database end foer. Laesninger i tabeller, trykket aldrig skriver i,
// er ikke med (de maa flytte). Pr. mellemrum: hvilke tabeller, hvor mange forskellige spoergsmaal,
// og et fingeraftryk af spoergsmaalene.
export function readIntervals(entries) {
  const out = []; let current = new Map();
  const close = (before) => { out.push({ foer: before, tabeller: [...new Set(current.values())].sort(), spoergsmaal: current.size, hash: digest([...current.keys()].sort()), noegler: [...current.keys()].sort() }); current = new Map(); };
  for (const entry of entries) {
    if (entry.kind !== "read" && (entry.gen || entry.holdt)) continue;
    if (entry.kind !== "read") { close(`${entry.kind === "write" ? `${entry.op} ` : ""}${entry.target}`); continue; }
    if (!NEVER_WRITTEN_BY_PRESS.has(entry.target)) current.set(`${entry.target}|${digest(entry.filters ?? entry.payload ?? null)}`, entry.target);
  }
  close("(trinnet slutter)");
  return out;
}
// En skrivning eller et funktionskald skal vaere alene i sin runde: sendes det samtidig med noget
// andet, afgoer tilfaeldet, hvem der kommer foerst i den rigtige database.
export function sharedWriteRounds(log) {
  const byRound = new Map();
  for (const entry of log) { if (!entry.round) continue; byRound.set(entry.round, [...(byRound.get(entry.round) ?? []), entry]); }
  return [...byRound.values()].filter((group) => group.length > 1 && group.some((entry) => entry.kind !== "read"))
    .map((group) => group.map((entry) => `${entry.kind}:${entry.target}`).join(" + "));
}
// Et loefte, der afvises uden at nogen venter paa det, vaelter serveren. Alle saadanne samles her.
export const UNHANDLED_REJECTIONS = [];
process.on("unhandledRejection", (reason) => { UNHANDLED_REJECTIONS.push(String(reason?.message ?? reason).slice(0, 200)); });

/** Koer ét scenarie og returnér alt, der blev optaget. */
export async function runScenario(name, mode = {}) {
  const scenario = SCENARIOS[name];
  const fakes = [];
  const fresh = (seedPatch = {}, { fail = null } = {}) => {
    const state = seedState({ ...scenario.seed, ...seedPatch });
    const fake = createFake(state, { failRpc: (ctx) => scenario.fail?.(ctx) === true, fail, ...mode });
    // "Aftenkoerslen holder datoen": databasens proev-laas svarer optaget.
    const realRpc = fake.supabase.rpc;
    fake.supabase.rpc = async (rpcName, args) => (HELD({ base: rpcName.replace(/^try_/, ""), state }) && rpcName.startsWith("try_")
      ? (fake.log.push({ kind: "rpc", target: rpcName, payload: canon(args), round: 0, holdt: true, ...(fake.ctx.tryk > 0 ? { tryk: true } : {}) }), fake.deliver({ data: { held: true }, error: null })) : realRpc(rpcName, args));
    fakes.push({ state, fake });
    return { state, fake };
  };
  const main = fresh();
  const steps = [];
  const marks = [];
  const mark = () => marks.push(fakes.reduce((sum, x) => sum + x.fake.log.length, 0));
  // Kald pr. trin: loggens laengde foer og efter hvert trin (kun hovedtilstanden taeller pr. trin).
  const counting = new Proxy(steps, { get(target, prop) { if (prop === "push") return (item) => { const own = item.fake ? item.fake.log : main.fake.log.slice(main.lastLen ?? 0); item.calls = countCalls(own); item.reads = readIntervals(own); item.tryk = own.some((entry) => entry.tryk === true); main.lastLen = main.fake.log.length; mark(); return target.push(item); }; return target[prop]; } });
  // Motoren skriver advarsler direkte til konsollen (fx manglende private parametre). De er ikke en
  // del af resultatet; de samles her, saa en testkoersel ikke drukner i dem.
  const notes = new Set();
  const saved = { warn: console.warn, error: console.error, log: console.log, info: console.info };
  for (const key of Object.keys(saved)) console[key] = (...parts) => { notes.add(String(parts[0]).slice(0, 160)); };
  try { await scenario.run(main.state, main.fake, counting, fresh); } finally { Object.assign(console, saved); }
  // Giv et loefte uden ejer tid til at melde sig, foer scenariet goeres op.
  await new Promise((resolve) => { setImmediate(resolve); });
  const log = fakes.flatMap((x) => x.fake.log);
  // Scenarier, der afbryder eller standser et tryk: det samme tryk koeres én gang uden afbrydelsen, og
  // dets spoergsmaal gemmes. Et afbrudt tryk maa hente dem foer foerste gemme-kald (se compareReadSteps).
  let uafbrudt = [];
  if (typeof scenario.fail === "function") {
    const state = seedState(scenario.seed); const fake = createFake(state, mode);
    for (const key of Object.keys(saved)) console[key] = () => {};
    try { await press(state, fake).catch(() => {}); } finally { Object.assign(console, saved); }
    uafbrudt = [...new Set(readIntervals(fake.log).flatMap((interval) => interval.noegler))].sort();
  }
  const { __failed: _f, __commits: _c, __held: _h, ...tables } = main.state;
  return {
    steps: steps.map(({ label, response }) => ({ label, response })),
    writes: main.fake.log.filter((entry) => entry.kind !== "read" && !entry.holdt).map(({ round: _round, after: _after, ...entry }) => entry),
    reads: steps.map(({ label, reads, response, tryk }) => ({ label, tryk, mellemrum: response?.status >= 400 ? "afvist tryk: laesningernes plads fryses ikke (det maa laese mere end foer, aldrig skrive)" : reads })),
    sharedWriteRounds: scenario.concurrent ? [] : fakes.flatMap((x) => sharedWriteRounds(x.fake.log)),
    finalState: Object.fromEntries(Object.keys(tables).sort().map((table) => [table, canon(tables[table])])),
    calls: { perStep: steps.map(({ label, calls }) => ({ label, ...calls })), total: countCalls(log) },
    uafbrudt,
    unsupported: [...new Set(fakes.flatMap((x) => x.fake.unsupported))],
    consoleNotes: [...notes],
  };
}

export function countCalls(entries) {
  const out = { total: entries.length, reads: 0, writes: 0, rpc: 0, gen: entries.filter((entry) => entry.gen === true).length, rounds: new Set(entries.map((entry) => entry.round)).size, byTarget: {} };
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
    reads: run.reads,
    uafbrudt: run.uafbrudt ?? [],
    writes: run.writes.map((entry) => {
      const base = { kind: entry.kind, target: entry.target, ...(entry.op ? { op: entry.op } : {}), ...(entry.filters ? { filters: entry.filters } : {}), ...(entry.options ? { options: entry.options } : {}), ...(entry.gen ? { gen: true } : {}), ...(entry.tryk ? { tryk: true } : {}) };
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

// ── Trin 4a: seks scenarier mere ──────────────────────────────────────────────────────────────
// En loebsrytter er "bundet" til sit loeb paa hver loebsdag i loebets spaend, ogsaa de dage hvor
// der ingen etape er. Paa saadan en dag laeser motoren, om rytteren har en etape paa datoen, og den
// laesning behoever svaret fra bindingen. Ingen af de oprindelige scenarier havde en bundet rytter.
const bind = (state, days) => {
  for (const entry of state.race_entries.filter((row) => row.race_id === RACE)) {
    for (const game_day of days) {
      if (!state.race_entry_days.some((row) => row.rider_id === entry.rider_id && row.game_day === game_day)) {
        state.race_entry_days.push({ race_id: RACE, rider_id: entry.rider_id, team_id: TEAM, season_id: SEASON.id, game_day });
      }
    }
  }
};
const AFTER_STAGE = new Date("2026-11-09T17:30:00Z");
Object.assign(SCENARIOS, {
  // Loebsrytterne er bundet paa alle datoens loebsdage; etapen er ikke koert endnu (beta-tryk).
  bundet_etape_ikke_koert: { seed: BIG, async run(s, f, out) { bind(s, [41, 42, 43, 44, 45]); await step(out, "tryk", () => press(s, f)); } },
  // Samme, men etapen er koert: hvem koerte en etape paa datoen?
  bundet_etape_koert: { seed: { ...BIG, stageRun: true }, async run(s, f, out) { bind(s, [41, 42, 44, 45]); await step(out, "tryk", () => press(s, f, { now: AFTER_STAGE })); } },
  // Som forrige, plus tre ryttere med en etape dagen foer (spillerens regel "dagen efter en etape").
  bundet_og_etape_dagen_foer: { seed: { ...BIG, stageRun: true }, async run(s, f, out) {
    bind(s, [41, 42, 44, 45]);
    [2, 9, 14].forEach((n, i) => s.race_results.push({ id: id(7900 + i), race_id: FILLER, stage_number: 1, rider_id: rider(n), result_type: "stage", rank: i + 1, imported_at: "2026-11-08T16:00:00Z" }));
    await step(out, "tryk", () => press(s, f, { now: AFTER_STAGE }));
  } },
  // Bundne loebsryttere, almindeligt tryk (uden straks-traening).
  almindeligt_tryk_bundet: { seed: { ...BIG, stageRun: true }, async run(s, f, out) { bind(s, [41, 42, 44, 45]); await step(out, "tryk", () => press(s, f, { now: AFTER_STAGE, isBetaTester: false })); } },
  // Holdets etape ligger paa datoens FOERSTE loebsdag, saa loebsdagens laesninger sker i dag-felt 1.
  etape_paa_datoens_foerste_loebsdag: { seed: { ...BIG, stageRun: true }, async run(s, f, out) {
    for (const table of ["race_stage_schedule", "training_race_loads", "race_entry_days"]) for (const row of s[table]) if (row.race_id === RACE && row.game_day === 43) row.game_day = 41;
    bind(s, [42, 43, 44, 45]);
    await step(out, "tryk", () => press(s, f, { now: AFTER_STAGE }));
  } },
  // Aftenkoerslen tager datoen, lige efter trykket har gemt sit andet dag-felt. Trykket skal standse
  // med samme svar som foer, uden at gemme mere; et nyt tryk og aftenkoerslen goer datoen faerdig.
  aftenkoerslen_tager_datoen_midt_i_trykket: { seed: { count: 14, entered: [2, 5] },
    fail: ({ base, state }) => { if (base === "commit_training_date_tick" && !state.__failed && (state.__commits = (state.__commits ?? 0) + 1) === 2) { state.__failed = true; state.__held = true; } return false; },
    async run(s, f, out) {
      await step(out, "tryk der standses", () => press(s, f));
      s.__held = false;
      await step(out, "nyt tryk", () => press(s, f, { now: new Date("2026-11-09T06:02:00Z") }));
      finishRace(s); await step(out, "aftenkoersel", () => sweep(s, f));
    } },
});

// ── Trin 4a: hvad maa aendre sig, og hvad maa ikke ────────────────────────────────────────────
// Trin 4a henter én gang og regner datoens fem dag-felter i serveren. Derfor forsvinder laesninger
// EFTER det foerste gemme-kald. Alt andet er som foer:
//   svar            ens (i "fejl_i_hver_laesning" maa en laesning, der er vaek, mangle; de andre er ens);
//   skrivninger     ens, i raekkefoelge. Undtaget er trykkets genregistreringer af en dato, der
//                   allerede er registreret: de maa blive faerre, aldrig flere, aldrig i ny raekkefoelge;
//   sluttilstand    ens;
//   laesninger      FOER foerste gemme-kald: praecis som foer, i samme mellemrum. En laesning fra
//                   senere i trykket maa flytte hen foran foerste gemme-kald, hvis den er i en tabel,
//                   trykket ikke selv skriver i. EFTER foerste gemme-kald: ingen ny laesning, og ingen
//                   laesning i et andet mellemrum end foer; de maa forsvinde;
//   aftenkoerslen   praecis som foer, ogsaa hver laesning og hver genregistrering.
export const PRESS_WRITTEN_TABLES = Object.freeze(new Set([
  "rider_derived_abilities", "rider_condition", "training_rider_ticks", "training_day_runs", "training_date_work",
  "training_condition_settlements", "training_race_loads", "training_train_now_locks", "rider_derived_ability_history",
  "rider_ability_race_day_history", "rider_training_scores", "training_condition_timeout_outbox",
]));
const isCommitBoundary = (label) => String(label).endsWith("commit_training_date_tick");
const tableOfKey = (key) => key.split("|")[0];
const pressGen = (entry) => entry.gen === true && entry.tryk === true;

function compareWrites(expected, actual) {
  const diff = firstDifference(expected.filter((entry) => !pressGen(entry)), actual.filter((entry) => !pressGen(entry)), "writes");
  if (diff) return diff;
  const before = expected.filter(pressGen).map((entry) => JSON.stringify(entry));
  let at = 0;
  for (const [i, entry] of actual.filter(pressGen).map((x) => JSON.stringify(x)).entries()) {
    const found = before.indexOf(entry, at);
    if (found === -1) return { path: `writes (trykkets genregistrering nr. ${i + 1})`, expected: "en genregistrering, facit ogsaa har, i samme raekkefoelge (de maa blive faerre, aldrig flere)", actual: JSON.parse(entry) };
    at = found + 1;
  }
  return null;
}

function compareReadSteps(expected, actual, uninterrupted = []) {
  if (expected.length !== actual.length) return { path: "reads.length", expected: expected.length, actual: actual.length };
  for (let i = 0; i < expected.length; i += 1) {
    const e = expected[i], a = actual[i], path = `reads[${i}]`;
    if (e.label !== a.label || Boolean(e.tryk) !== Boolean(a.tryk)) return { path: `${path}.label`, expected: [e.label, Boolean(e.tryk)], actual: [a.label, Boolean(a.tryk)] };
    const E = e.mellemrum, A = a.mellemrum;
    const firstE = Array.isArray(E) ? E.findIndex((x) => isCommitBoundary(x.foer)) : -1;
    const firstA = Array.isArray(A) ? A.findIndex((x) => isCommitBoundary(x.foer)) : -1;
    // En aftenkoersel, et afvist tryk og et tryk uden gemme-kald: praecis som foer.
    if (!e.tryk || !Array.isArray(E) || !Array.isArray(A) || firstE === -1 || firstA === -1) { const d = firstDifference(E, A, `${path}.mellemrum`); if (d) return d; continue; }
    if (firstE !== firstA) return { path: `${path}.mellemrum (antal skrivninger foer foerste gemme-kald)`, expected: firstE, actual: firstA };
    for (let k = 0; k < firstE; k += 1) { const d = firstDifference(E[k], A[k], `${path}.mellemrum[${k}]`); if (d) return d; }
    const gone = E[firstE].noegler.filter((key) => !A[firstE].noegler.includes(key));
    if (gone.length) return { path: `${path}.mellemrum[${firstE}] (foer foerste gemme-kald)`, expected: "alle laesninger fra foer", actual: `mangler ${gone[0]}` };
    // "Senere i trykket": det, facit-trykket selv spurgte om efter foerste gemme-kald, og (for et afbrudt
    // tryk) det, et uafbrudt tryk fra samme udgangstilstand spoerger om. Ingen kode kan vide foer foerste
    // gemme-kald, at et senere gemme-kald fejler.
    const later = new Set([...E.slice(firstE + 1).flatMap((x) => x.noegler), ...uninterrupted]);
    for (const key of A[firstE].noegler.filter((x) => !E[firstE].noegler.includes(x))) {
      if (!later.has(key) || PRESS_WRITTEN_TABLES.has(tableOfKey(key))) return { path: `${path}.mellemrum[${firstE}] (foer foerste gemme-kald)`, expected: "ingen ny laesning (kun en laesning fra senere i trykket, i en tabel trykket ikke selv skriver i, maa flytte herhen)", actual: key };
    }
    if (E.length !== A.length) return { path: `${path}.mellemrum.length (skrivninger efter foerste gemme-kald)`, expected: E.length, actual: A.length };
    for (let k = firstE + 1; k < E.length; k += 1) {
      if (E[k].foer !== A[k].foer) return { path: `${path}.mellemrum[${k}].foer`, expected: E[k].foer, actual: A[k].foer };
      const added = A[k].noegler.filter((key) => !E[k].noegler.includes(key));
      if (added.length) return { path: `${path}.mellemrum[${k}] (efter foerste gemme-kald)`, expected: "ingen ny laesning og ingen laesning flyttet hertil", actual: added[0] };
    }
  }
  return null;
}

function compareFaultSteps(expected, actual) {
  if (expected.length !== actual.length) return { path: "steps.length", expected: expected.length, actual: actual.length };
  for (let i = 0; i < expected.length; i += 1) {
    if (expected[i].label !== actual[i].label) return { path: `steps[${i}].label`, expected: expected[i].label, actual: actual[i].label };
    const E = expected[i].response, A = actual[i].response;
    const questions = new Set(Object.keys(E).map((key) => key.split(" | ").slice(1, 3).join(" | ")));
    // En laesning foer foerste gemme-kald skal stadig findes og vaere proevet med fejl (regel R4).
    for (const key of Object.keys(E)) if (E[key].foerFoersteGemmeKald === true && !(key in A)) return { path: "steps[" + i + "].response." + key, expected: "laesningen ligger foer foerste gemme-kald og skal stadig findes", actual: "(mangler)" };
    for (const key of Object.keys(A)) {
      if (key in E) { const d = firstDifference(E[key], A[key], `steps[${i}].response.${key}`); if (d) return d; continue; }
      const [, table, question] = key.split(" | ");
      if (PRESS_WRITTEN_TABLES.has(table) || !questions.has(`${table} | ${question}`)) return { path: `steps[${i}].response.${key}`, expected: "(findes ikke i facit: en ny laesning, eller en laesning flyttet til et andet mellemrum)", actual: A[key] };
    }
  }
  return null;
}

/** Foerste afvigelse fra facit efter reglerne for trin 4a (se ovenfor). null = bestaaet. */
export function compareToFacit(expected, actual, name) {
  const steps = name === "fejl_i_hver_laesning" ? compareFaultSteps(expected.steps, actual.steps) : firstDifference(expected.steps, actual.steps, "steps");
  if (steps) return { part: "steps", ...steps };
  const writes = compareWrites(expected.writes, actual.writes);
  if (writes) return { part: "writes", ...writes };
  const finalState = firstDifference(expected.finalState, actual.finalState, "finalState");
  if (finalState) return { part: "finalState", ...finalState };
  const reads = compareReadSteps(expected.reads, actual.reads, expected.uafbrudt ?? []);
  return reads ? { part: "reads", ...reads } : null;
}

// ── Trin 4a, udgave 2: en rytter frigives midt i et tryk ──────────────────────────────────────
// Lige foer trykkets ANDET gemme-kald frigives en rytter fra holdet. Baade det gamle og det nye tryk har
// da allerede regnet dag-feltet med ham; databasens gemme-funktion saetter ham i karantaene og gemmer
// resten. Derefter skal trykket goere datoen faerdig for de andre, og aftenkoerslen maa ikke aendre noget.
// (Frigives han i stedet lige EFTER et gemme-kald, opdager det gamle tryk det ved naeste laesning og tager
// ham stille ud; det nye tryk opdager det ved naeste gemme-kald. Den forskel proeves for sig i proevefilen.)
export const RELEASED = rider(7);
Object.assign(SCENARIOS, {
  rytter_frigives_foer_andet_gemme_kald: { seed: { count: 14, entered: [2, 5] },
    fail: ({ base, state }) => { if (base === "commit_training_date_tick" && !state.__failed && (state.__commits = (state.__commits ?? 0) + 1) === 2) { state.__failed = true; state.riders.find((row) => row.id === RELEASED).team_id = null; } return false; },
    async run(s, f, out) {
      await step(out, "tryk", () => press(s, f));
      finishRace(s); await step(out, "aftenkoersel", () => sweep(s, f));
    } },
});
