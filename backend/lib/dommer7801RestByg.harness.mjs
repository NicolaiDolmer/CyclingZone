// #7801 rest-byg: dommerens harness. Skrevet FOER foerste kodelinje (AGENTS.md regel 40).
// Ejes af dommeren; byggeren aendrer ikke filen.
//
// Hvad den goer: bygger faste, opdigtede verdener (ingen prod-data, intet vaegur, ingen
// tilfaeldighed), koerer hver flade, der viser eller bruger "traethed lige nu", mod en
// stedfortraeder for databasen, og giver for hver flade: svaret som fingeraftryk, og hvert
// databasekald med den runde, det blev sendt i.
//
// "Runde" = en ventetid paa databasen. Kald, der sendes samtidig, ligger i samme runde. Kald,
// der foerst sendes, naar et tidligere svar er kommet, ligger i en ny runde. Antal runder er
// derfor antallet af gange, visningen staar og venter efter hinanden.
//
// Kun fingeraftryk og antal forlader modulet (hard rule 17). Decimaltal afrundes foer hash (#8113).

import { createHash } from "node:crypto";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { getSelectionContext, ridersAtOpeningFatigue } from "./raceSelection.js";
import * as raceSelectionModule from "./raceSelection.js";
import { getStageRolesContext } from "./raceStageRolesApi.js";
import { riderCardFatigueNow7801 } from "./riderCardFatigueNow7801.js";
import { applyStageStartFatigue, fatigueByRiderForRaces, fatigueByRiderNow, fatigueOutlookForTeam, firstStageNumber } from "./riderFatigueNow.js";
import { loadMedicalBonusByTeam } from "./medicalEffects.js";
import { ABILITY_KEYS } from "./raceSimulator.js";
import { createTrainingFatigueRulesRouter } from "../routes/trainingFatigueRules.js";

// ── Stedfortraeder for databasen ──────────────────────────────────────────────────────────────
// `fail(table, key)` -> null | "error" (svar med fejl) | "gateway" (kort 502) | "throw" (kaldet kaster, fx netvaerk).
export function createFake(state, { fail = null } = {}) {
  const log = [];
  let round = 1; let waiting = [];
  const deliver = (make) => new Promise((resolve, reject) => {
    if (!waiting.length) setImmediate(() => { const batch = waiting; waiting = []; round += 1; for (const done of batch) done(); });
    waiting.push(() => { try { resolve(make()); } catch (err) { reject(err); } });
  });
  const pathValue = (row, col) => {
    if (!col.includes("->")) return row[col];
    return col.split("->").reduce((value, key) => (value == null ? undefined : value[key.replace(/^>/, "")]), row);
  };
  function from(table) {
    const filters = []; const orders = []; let single = false; let aliases = []; let keyHint = null;
    const exec = () => {
      const target = table === "app_config" && keyHint ? `app_config:${keyHint}` : table;
      const mode = fail ? fail(table, keyHint) : null;
      log.push({ table, target, round, failed: mode ?? null });
      return deliver(() => {
        if (mode === "throw") throw new Error(`dommer: ${target} kunne ikke naas`);
        if (mode === "error") return { data: null, error: { message: `dommer: ${target} kan ikke laeses` }, status: 500 };
        if (mode === "gateway") return { data: null, error: { message: "Bad Gateway" }, status: 502 };
        let rows = (state[table] ?? []).filter((row) => filters.every((f) => f(row)));
        for (const { col, asc } of orders.slice().reverse()) {
          rows = rows.map((row, i) => [row, i]).sort(([a, ai], [b, bi]) => {
            const x = a[col]; const y = b[col];
            const cmp = x > y ? 1 : x < y ? -1 : 0;
            return (asc ? cmp : -cmp) || ai - bi;
          }).map(([row]) => row);
        }
        rows = rows.map((row) => {
          const copy = { ...row };
          for (const [alias, col] of aliases) copy[alias] = pathValue(row, col) ?? null;
          return copy;
        });
        return single ? { data: rows[0] ?? null, error: null, status: 200 } : { data: rows, error: null, status: 200 };
      });
    };
    const known = {
      select: (cols) => {
        if (typeof cols === "string") aliases = cols.split(",").map((part) => part.trim()).filter((part) => /^[a-z_]+:[a-z_]+->/i.test(part)).map((part) => { const i = part.indexOf(":"); return [part.slice(0, i), part.slice(i + 1)]; });
      },
      eq: (c, v) => {
        if (c === "key") keyHint = String(v);
        // "races.season_id": filter paa den sammenkaedede loebsraekke (races!inner), som PostgREST goer.
        if (c.startsWith("races.")) { const col = c.slice(6); filters.push((r) => (state.races ?? []).find((race) => race.id === r.race_id)?.[col] === v); return; }
        filters.push((r) => r[c] === v);
      },
      neq: (c, v) => filters.push((r) => r[c] !== v),
      in: (c, vs) => { const list = [...(vs ?? [])]; filters.push((r) => list.includes(r[c])); },
      lt: (c, v) => filters.push((r) => r[c] < v),
      lte: (c, v) => filters.push((r) => r[c] <= v),
      gt: (c, v) => filters.push((r) => r[c] > v),
      gte: (c, v) => filters.push((r) => r[c] >= v),
      is: (c, v) => filters.push((r) => (r[c] ?? null) === v),
      not: (c, op, v) => { if (op === "is" && v === null) filters.push((r) => pathValue(r, c) != null); },
      order: (col, opts) => orders.push({ col, asc: opts?.ascending !== false }),
    };
    const proxy = new Proxy({}, {
      get(_t, prop) {
        if (prop === "then") return (resolve, reject) => exec().then(resolve, reject);
        if (prop === "maybeSingle" || prop === "single") return () => { single = true; return exec(); };
        if (known[prop]) return (...args) => { known[prop](...args); return proxy; };
        if (typeof prop === "symbol") return undefined;
        return () => proxy; // or/range/limit m.fl.: ingen virkning i stedfortraederen
      },
    });
    return proxy;
  }
  return { from, log };
}

/** Antal kald og runder for en log. Kun antal og tabelnavne. */
export function countCalls(log) {
  const byTarget = {};
  for (const entry of log) byTarget[entry.target] = (byTarget[entry.target] ?? 0) + 1;
  return { kald: log.length, runder: new Set(log.map((entry) => entry.round)).size, byTarget };
}
/** Kaldene runde for runde, sorteret inden for runden (raekkefoelgen i en runde er ligegyldig). */
export function callShape(log) {
  const rounds = new Map();
  for (const entry of log) rounds.set(entry.round, [...(rounds.get(entry.round) ?? []), entry.target]);
  return [...rounds.keys()].sort((a, b) => a - b).map((r) => rounds.get(r).slice().sort().join(" + "));
}

// ── Fingeraftryk ──────────────────────────────────────────────────────────────────────────────
const ROUND = 1e6; // #8113: decimaltal afrundes foer hash, saa Windows og Linux giver samme aftryk
export function canon(value) {
  if (value instanceof Map) return canon(Object.fromEntries([...value].map(([k, v]) => [String(k), v])));
  if (value instanceof Set) return [...value].map(canon).sort();
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) return value.map(canon);
  if (typeof value === "number") return Number.isInteger(value) || !Number.isFinite(value) ? (Number.isFinite(value) ? value : String(value)) : Math.round(value * ROUND) / ROUND;
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) if (value[key] !== undefined) out[key] = canon(value[key]);
    return out;
  }
  return value === undefined ? null : value;
}
export const sha = (value) => createHash("sha256").update(JSON.stringify(canon(value))).digest("hex");

// ── Verdener ──────────────────────────────────────────────────────────────────────────────────
// Alt er opdigtet. Datoen er en fast dansk sommerdato (UTC+2), saa intet afhaenger af vaeguret.
export const DATE = "2026-06-15";
export const TOMORROW = "2026-06-16";
export const SEASON = "season-1";
const at = (date, hhmm) => `${date}T${hhmm}:00.000Z`;
const ability = (id, recovery, base) => ({ rider_id: id, ...Object.fromEntries(ABILITY_KEYS.map((k, i) => [k, k === "recovery" ? recovery : 40 + ((base + i * 7) % 45)])) });
const rider = (id, team, extra = {}) => ({ id, firstname: id.toUpperCase(), lastname: `Hold${team.slice(-1).toUpperCase()}`, team_id: team, squad: "senior", is_academy: false, is_retired: false, primary_type: "climber", secondary_type: null, pending_team_id: null, birthdate: "1998-04-04", ...extra });
const cond = (id, fatigue, form, extra = {}) => ({ rider_id: id, fatigue, form, injured_until: null, injury_race_days_left: null, injury_cause: null, ...extra });
const load = (id, gameDay, value, date = DATE) => ({ rider_id: id, season_id: SEASON, race_id: "r-etape", stage_number: gameDay - 99, game_day: gameDay, tick_date: date, load: value, consumed_at: null, duplicate_of_race_id: null });

const CONFIG_ON = { condition_model_v2: "on", training_condition_per_date: "on", training_tick_per_race_day: "on", training_fatigue_rules: "on", training_train_now_instant: "beta", race_day_engine_enabled: "on", condition_v2_race_date_training_day: "on" };

/** Grundverdenen: to hold, et etapeloeb med fire etaper i dag, et endagsloeb i morgen, et koert endagsloeb i dag, et uplanlagt loeb. */
function baseWorld() {
  const riders = [
    rider("a1", "team-a"), rider("a2", "team-a"), rider("a3", "team-a"), rider("a4", "team-a"), rider("a5", "team-a"),
    rider("a6", "team-a"), rider("a7", "team-a"), rider("a8", "team-a"), rider("a9", "team-a"), rider("a10", "team-a"),
    rider("b1", "team-b"), rider("b2", "team-b"), rider("b3", "team-b"), rider("b4", "team-b"),
  ];
  const conditions = [
    cond("a1", 45, 62), cond("a2", 62, 55), cond("a3", 30, 40, { injured_until: "2026-06-20", injury_cause: "race_crash" }),
    cond("a4", 71, 48), /* a5: ingen raekke */ cond("a6", 38, 70), cond("a7", 52, 66), cond("a8", 57, 51),
    cond("a9", 0, 50), cond("a10", 96, 35),
    cond("b1", 45, 62), cond("b2", 20, 58), cond("b3", 66, 44), cond("b4", 49, 60),
  ];
  const abilities = [
    ability("a1", 55, 3), ability("a2", 80, 11), ability("a3", 50, 5), ability("a4", 35, 9), ability("a5", 60, 2),
    ability("a6", 62, 13), ability("a7", 48, 17), ability("a8", 71, 19), ability("a9", 20, 23), ability("a10", 44, 29),
    ability("b1", 55, 3), ability("b2", 90, 31), ability("b3", 30, 37), ability("b4", 58, 41),
  ];
  const races = [
    { id: "r-etape", name: "Etapeloebet", race_type: "stage_race", race_class: "Class1", stages: 8, stages_completed: 0, status: "scheduled", season_id: SEASON, league_division_id: "div-1", scheduled_for: DATE, squad: "senior", engine_rules_revision: null },
    { id: "r-imorgen", name: "Endagsloeb i morgen", race_type: "single", race_class: "Class2", stages: 1, stages_completed: 0, status: "scheduled", season_id: SEASON, league_division_id: "div-1", scheduled_for: TOMORROW, squad: "senior", engine_rules_revision: null },
    { id: "r-koert", name: "Endagsloeb i morges", race_type: "single", race_class: "Class2", stages: 1, stages_completed: 0, status: "scheduled", season_id: SEASON, league_division_id: "div-1", scheduled_for: DATE, squad: "senior", engine_rules_revision: null },
    { id: "r-sent", name: "Endagsloeb sidst paa dagen", race_type: "single", race_class: "Class2", stages: 1, stages_completed: 0, status: "scheduled", season_id: SEASON, league_division_id: "div-1", scheduled_for: DATE, squad: "senior", engine_rules_revision: null },
    // Et loeb to dage foer (loebsdag 99), saa datoen i dag har praecis fem loebsdage (100 til 104).
    { id: "r-forleden", name: "Koert forleden", race_type: "single", race_class: "Class2", stages: 1, stages_completed: 1, status: "completed", season_id: SEASON, league_division_id: "div-1", scheduled_for: "2026-06-13", squad: "senior", engine_rules_revision: null },
    { id: "r-uplanlagt", name: "Uden plan", race_type: "single", race_class: "Class2", stages: 1, stages_completed: 0, status: "scheduled", season_id: SEASON, league_division_id: "div-1", scheduled_for: "2026-06-25", squad: "senior", engine_rules_revision: null },
  ];
  const stageTimes = ["09:00", "11:00", "13:00", "15:00"];
  const schedule = [
    ...stageTimes.map((t, i) => ({ race_id: "r-etape", stage_number: i + 1, game_day: 100 + i, scheduled_at: at(DATE, t) })),
    ...stageTimes.map((t, i) => ({ race_id: "r-etape", stage_number: i + 5, game_day: 105 + i, scheduled_at: at(TOMORROW, t) })),
    { race_id: "r-imorgen", stage_number: 1, game_day: 106, scheduled_at: at(TOMORROW, "10:00") },
    { race_id: "r-koert", stage_number: 1, game_day: 100, scheduled_at: at(DATE, "07:00") },
    { race_id: "r-sent", stage_number: 1, game_day: 104, scheduled_at: at(DATE, "16:30") },
    { race_id: "r-forleden", stage_number: 1, game_day: 99, scheduled_at: at("2026-06-13", "10:00") },
  ];
  const profiles = [
    ...Array.from({ length: 8 }, (_, i) => ({ race_id: "r-etape", stage_number: i + 1, profile_type: ["flat", "hilly", "mountain", "itt"][i % 4], finale_type: null, demand_vector: null, distance_km: 150 + i * 9, segments: null, climbs: null, sectors: null })),
    { race_id: "r-imorgen", stage_number: 1, profile_type: "hilly", finale_type: null, demand_vector: null, distance_km: 190, segments: null, climbs: null, sectors: null },
    { race_id: "r-koert", stage_number: 1, profile_type: "flat", finale_type: null, demand_vector: null, distance_km: 170, segments: null, climbs: null, sectors: null },
    { race_id: "r-sent", stage_number: 1, profile_type: "hilly", finale_type: null, demand_vector: null, distance_km: 140, segments: null, climbs: null, sectors: null },
    { race_id: "r-uplanlagt", stage_number: 1, profile_type: "flat", finale_type: null, demand_vector: null, distance_km: 160, segments: null, climbs: null, sectors: null },
  ];
  const entry = (race, team, id, role = "helper") => ({ race_id: race, team_id: team, rider_id: id, race_role: role, is_auto_filled: false });
  const entries = [
    entry("r-etape", "team-a", "a1", "captain"), entry("r-etape", "team-a", "a2"), entry("r-etape", "team-a", "a8"), entry("r-etape", "team-a", "a10"), entry("r-etape", "team-a", "a9"),
    entry("r-etape", "team-b", "b1", "captain"), entry("r-etape", "team-b", "b2"),
    entry("r-imorgen", "team-a", "a6", "captain"), entry("r-imorgen", "team-a", "a7"), entry("r-imorgen", "team-b", "b4", "captain"),
    entry("r-koert", "team-a", "a7", "captain"), entry("r-koert", "team-b", "b3", "captain"),
    entry("r-sent", "team-a", "a7", "captain"), entry("r-sent", "team-a", "a6"), entry("r-sent", "team-b", "b3", "captain"),
    entry("r-uplanlagt", "team-a", "a4", "captain"),
  ];
  const entryDays = [];
  for (const e of entries) for (const s of schedule.filter((row) => row.race_id === e.race_id)) entryDays.push({ rider_id: e.rider_id, race_id: e.race_id, season_id: SEASON, game_day: s.game_day });
  return {
    riders, rider_condition: conditions, rider_derived_abilities: abilities, races, race_stage_schedule: schedule, race_stage_profiles: profiles,
    race_entries: entries, race_entry_days: entryDays, training_race_loads: [], race_incidents: [], race_results: [], race_stage_roles: [], race_withdrawals: [],
    seasons: [{ id: SEASON, status: "active", number: 4, start_date: "2026-03-01" }],
    // Hold A har en laegeafdeling med laege; hold B har ingen.
    team_facilities: [{ team_id: "team-a", track: "medical", tier: 5 }, { team_id: "team-a", track: "training", tier: 2 }],
    team_staff: [{ id: "staff-a-med", team_id: "team-a", name: "Laege A", role: "medical", tier: 5, status: "active" }],
    staff_derived_abilities: [{ staff_id: "staff-a-med", overall: 95, dimensions: {}, levels: {} }],
    team_training_rules: [
      { id: "rule-a", team_id: "team-a", rider_id: null, fatigue_threshold: 60, fallback: "light", recovery_after_stage: false },
      { id: "rule-a2", team_id: "team-a", rider_id: "a2", fatigue_threshold: 50, fallback: "rest", recovery_after_stage: null },
      { id: "rule-a4", team_id: "team-a", rider_id: "a4", fatigue_threshold: null, fallback: "off", recovery_after_stage: null },
      { id: "rule-b", team_id: "team-b", rider_id: null, fatigue_threshold: 40, fallback: "recovery", recovery_after_stage: true },
    ],
    training_rider_ticks: [
      { rider_id: "a4", team_id: "team-a", season_id: SEASON, tick_date: "2026-06-13", game_day: 91, report: { intensity: "easy", fatigue_rule: { kind: "fatigue", fallback: "light", fatigue: 73, threshold: 60 } } },
    ],
    training_train_now_locks: [], training_date_work: [], training_condition_settlements: [],
    app_config: Object.entries(CONFIG_ON).map(([key, value]) => ({ key, value })),
  };
}

/** Etaper i etapeloebet, der er koert: belastninger i ledgeren og loebets taeller. */
function ride(state, stagesDone, { koert = true } = {}) {
  const LOADS = { a1: [28, 22, 31, 12], a2: [2, 1, 3, 1], a8: [30, 26, 24, 20], a10: [19, 23, 17, 21], a9: [14, 9, 16, 11], b1: [28, 22, 31, 12], b2: [11, 6, 13, 8] };
  for (const [id, loads] of Object.entries(LOADS)) for (let s = 0; s < stagesDone; s += 1) state.training_race_loads.push(load(id, 100 + s, loads[s]));
  state.races.find((r) => r.id === "r-etape").stages_completed = stagesDone;
  if (koert) {
    // Endagsloebet kl. 07 er koert (samme loebsdag 100 som etape 1, andre ryttere).
    state.training_race_loads.push({ ...load("a7", 100, 18), race_id: "r-koert", stage_number: 1 }, { ...load("b3", 100, 24), race_id: "r-koert", stage_number: 1 });
    Object.assign(state.races.find((r) => r.id === "r-koert"), { stages_completed: 1, status: "completed" });
  }
  // En gammel, uafregnet raekke fra en tidligere dato maa aldrig taelle med.
  state.training_race_loads.push({ ...load("a4", 93, 40, "2026-06-12") });
  return state;
}

/** Hold A har trykket Traen nu kl. 10:30 dansk tid i dag (efter etape 1): tre slags stempler. */
function pressTrainNow(state) {
  const days = [100, 101, 102, 103, 104];
  const opening = Object.fromEntries(state.rider_condition.filter((c) => c.rider_id.startsWith("a")).map((c) => [c.rider_id, { fatigue: c.fatigue, form: c.form }]));
  state.training_date_work.push({ tick_date: DATE, season_id: SEASON, team_id: "team-a", opening_conditions: opening, game_days: days });
  const lock = (id, slots) => ({ rider_id: id, team_id: "team-a", season_id: SEASON, tick_date: DATE, pressed_at: at(DATE, "08:30"), instant_at: at(DATE, "08:30"), instant_entry_snapshot: { slots: slots.map((gameDay) => ({ gameDay })) } });
  const receipt = (id, gameDay, intensity, recovery) => ({ rider_id: id, team_id: "team-a", season_id: SEASON, tick_date: DATE, game_day: gameDay, report: { intensity, recovery_before_date: recovery } });
  // a1: koerer etapeloebet. Etape 1 er koert foer trykket (kvittering "race"); 101 til 103 er reserveret; 104 er traenet.
  state.training_train_now_locks.push(lock("a1", [101, 102, 103]));
  state.training_rider_ticks.push(receipt("a1", 100, "race", 55), receipt("a1", 104, "hard", 55));
  Object.assign(state.rider_condition.find((c) => c.rider_id === "a1"), { fatigue: 51, form: 63 }); // den gemte, foreloebige tilstand efter trykket
  // a6: loeb i morgen, ingen etaper i dag. Kun fire af fem frie felter har kvittering endnu (ufuldstaendigt stempel).
  state.training_train_now_locks.push(lock("a6", []));
  state.training_rider_ticks.push(receipt("a6", 100, "normal", 62), receipt("a6", 101, "normal", 62), receipt("a6", 102, "easy", 62), receipt("a6", 103, "normal", 62));
  // a4: ingen loeb. Datoen er allerede gjort op for ham (afregnet stempel): den gemte tilstand gaelder.
  state.training_train_now_locks.push(lock("a4", []));
  for (const day of days.slice(0, 4)) state.training_rider_ticks.push(receipt("a4", day, "normal", 35));
  state.training_condition_settlements.push({ rider_id: "a4", team_id: "team-a", season_id: SEASON, tick_date: DATE });
  state.rider_condition.find((c) => c.rider_id === "a4").fatigue = 78;
  // a3 (skadet) fik et laast stempel uden straks-tidspunkt: det taeller ikke som straks-stempel.
  state.training_train_now_locks.push({ ...lock("a3", []), instant_at: null });
  return state;
}

/** Scenarier: navn -> { now, state }. Kontakten saettes udefra. */
export const SCENARIOS = {
  // Kl. 14:00 dansk tid: etaperne kl. 11 og 13 er koert, etaperne kl. 15 og 17 venter.
  midt_paa_dagen: () => ({ now: new Date(at(DATE, "12:00")), state: ride(baseWorld(), 2) }),
  // Kl. 08:00 dansk tid: intet er koert endnu.
  morgen_foer_etaper: () => ({ now: new Date(at(DATE, "06:00")), state: ride(baseWorld(), 0, { koert: false }) }),
  // Kl. 20:00 dansk tid: alle fire etaper er koert, naeste etape er i morgen.
  aften_alle_koert: () => ({ now: new Date(at(DATE, "18:00")), state: ride(baseWorld(), 4) }),
  // Hviledag: en dato uden etaper for nogen (dagen foer etapeloebet); naeste etape er i morgen.
  hviledag: () => ({ now: new Date("2026-06-14T12:00:00.000Z"), state: ride(baseWorld(), 0, { koert: false }) }),
  // Traen nu trykket af hold A efter etape 1; to etaper koert.
  traen_nu_trykket: () => ({ now: new Date(at(DATE, "12:00")), state: pressTrainNow(ride(baseWorld(), 2)) }),
  // Form og traethed 2.0 slukket: rider_condition er selv det sande tal.
  model_v2_slukket: () => {
    const state = ride(baseWorld(), 2);
    state.app_config = state.app_config.filter((row) => row.key !== "condition_model_v2");
    return { now: new Date(at(DATE, "12:00")), state };
  },
  // Hold A uden laegeafdeling og hold B med: bonussen foelger holdet, ikke rytteren.
  laege_byttet: () => {
    const state = ride(baseWorld(), 3);
    state.team_facilities = [{ team_id: "team-b", track: "medical", tier: 5 }];
    state.team_staff = [];
    state.staff_derived_abilities = [];
    return { now: new Date(at(DATE, "14:00")), state };
  },
};
export const SCENARIO_NAMES = Object.keys(SCENARIOS);

/** Slukkede vaerdier: alt andet end den eksakte streng "on". `undefined` = raekken findes ikke (prod i dag). */
export const OFF_FLAGS = [undefined, "off", "beta"];
export function world(name, flag) {
  const { now, state } = SCENARIOS[name]();
  if (flag !== undefined) state.app_config.push({ key: "fatigue_now_7801", value: flag });
  return { now, state };
}

// ── Flader ────────────────────────────────────────────────────────────────────────────────────
const quiet = async (fn) => {
  const saved = { warn: console.warn, error: console.error };
  console.warn = () => {}; console.error = () => {};
  try { return await fn(); } finally { Object.assign(console, saved); }
};
const raceOf = (state, id) => ({ ...state.races.find((r) => r.id === id) });
const teamConditions = (state, team, cols = null) => {
  const ids = new Set(state.riders.filter((r) => r.team_id === team).map((r) => r.id));
  return state.rider_condition.filter((c) => ids.has(c.rider_id)).map((c) => (cols ? Object.fromEntries(cols.map((k) => [k, c[k]])) : { ...c }));
};
const abilityMap = (state, ids) => new Map(state.rider_derived_abilities.filter((a) => ids.includes(a.rider_id)).map((a) => [a.rider_id, { ...a }]));

/** Regelpanelets GET, kaldt direkte paa routerens handler (ingen server, ingen port). */
async function rulesGet({ supabase, teamId, now }) {
  const router = createTrainingFatigueRulesRouter({
    supabase, requireAuth: (_req, _res, next) => next(), isViewerBetaTester: async () => true, now: () => now,
  });
  const layer = router.stack.find((l) => l.route?.path === "/" && l.route.methods.get);
  const handler = layer.route.stack.at(-1).handle;
  let status = 200; let body;
  const res = { status(code) { status = code; return res; }, json(value) { body = value; return res; } };
  await handler({ team: { id: teamId }, user: { id: "user" }, params: {}, body: {} }, res);
  return { status, body };
}

const RACES = ["r-etape", "r-imorgen", "r-koert", "r-sent", "r-uplanlagt"];
const TEAMS = ["team-a", "team-b"];

/**
 * Alle flader: [noegle, slags, koer({ supabase, state, now })]. Slags:
 *  "flade"  = en skaerm, spilleren ser (reglen "fejl = streg, aldrig et forkert tal" gaelder).
 *  "bruger" = kode, der bruger tallet uden at vise det, eller viser det uden at vaere en del af opgaven.
 *  "motor"  = loebsmotorens indgang (laeser ikke kontakten; skal vaere urort).
 */
export function surfaces(state) {
  const list = [];
  for (const team of TEAMS) {
    const teamRiderIds = state.riders.filter((r) => r.team_id === team).map((r) => r.id);
    for (const raceId of RACES) {
      list.push([`udtagelse|${raceId}|${team}`, "flade", async ({ supabase, now }) => {
        const ctx = await getSelectionContext({ supabase, race: raceOf(state, raceId), teamId: team, now });
        return { ctx, laegensRyttere: ridersAtOpeningFatigue(ctx).map((r) => [r.id, r.fatigue ?? null]) };
      }]);
      list.push([`holdfane|${raceId}|${team}`, "flade", ({ supabase, now }) => getStageRolesContext({ supabase, race: raceOf(state, raceId), teamId: team, now })]);
    }
    for (const riderId of [...teamRiderIds.slice(0, team === "team-a" ? 10 : 2), team === "team-a" ? "b1" : "a1"]) {
      list.push([`rytterkort|${riderId}|${team}`, "flade", ({ supabase, now }) => riderCardFatigueNow7801({ supabase, riderId, teamId: team, now })]);
    }
    list.push([`traening|${team}`, "flade", async ({ supabase, now }) => {
      const out = await fatigueOutlookForTeam({ supabase, team: { id: team, league_division_id: "div-1" }, seasonId: SEASON, conditions: teamConditions(state, team), abilityByRider: abilityMap(state, teamRiderIds), now });
      return out == null ? null : out;
    }]);
    list.push([`regelpanel|${team}`, "flade", ({ supabase, now }) => rulesGet({ supabase, teamId: team, now })]);
    // Saesonplanlaeggeren (GET /api/peak-plans/board) henter tallet, men viser det ikke.
    list.push([`saesonplan|${team}`, "bruger", ({ supabase, now }) => fatigueByRiderNow({ supabase, conditions: teamConditions(state, team, ["rider_id", "form", "fatigue", "injured_until"]), teamId: team, now })]);
    // Assistentens auto-udfyld (tre ruter i api.js): alle loeb paa én gang.
    list.push([`autoudfyld|${team}`, "bruger", ({ supabase, now }) => fatigueByRiderForRaces({
      supabase, conditions: teamConditions(state, team, ["rider_id", "fatigue", "injured_until"]), abilityByRider: abilityMap(state, teamRiderIds), teamId: team, now,
      races: RACES.map((id) => ({ id, stages: state.race_stage_profiles.filter((p) => p.race_id === id).map((p) => ({ stage_number: p.stage_number })) })),
    })]);
  }
  // Assistenten ved loebsstart (raceRunner): begge hold, traetheden ved loebets foerste etape.
  for (const raceId of RACES) {
    list.push([`assistent_ved_start|${raceId}`, "bruger", ({ supabase, now }) => {
      const ids = state.race_entries.filter((e) => e.race_id === raceId).map((e) => e.rider_id);
      const conditions = state.rider_condition.filter((c) => ids.includes(c.rider_id)).map((c) => ({ rider_id: c.rider_id, fatigue: c.fatigue, form: c.form }));
      const stages = state.race_stage_profiles.filter((p) => p.race_id === raceId);
      return fatigueByRiderNow({ supabase, conditions, abilityByRider: abilityMap(state, ids), teamIdByRider: new Map(state.riders.map((r) => [r.id, r.team_id])), atStage: { raceId, stageNumber: firstStageNumber(stages) }, now });
    }]);
  }
  // Loebsmotoren ved etapestart (laeser ikke kontakten): etape 1 til 5 i etapeloebet og loebet i morgen.
  for (const [raceId, stageNumber] of [["r-etape", 1], ["r-etape", 2], ["r-etape", 3], ["r-etape", 4], ["r-etape", 5], ["r-imorgen", 1], ["r-sent", 1], ["r-uplanlagt", 1]]) {
    list.push([`motor|${raceId}|${stageNumber}`, "motor", async ({ supabase }) => {
      const ids = state.race_entries.filter((e) => e.race_id === raceId);
      const abil = abilityMap(state, ids.map((e) => e.rider_id));
      const entrants = ids.map((e) => {
        const c = state.rider_condition.find((row) => row.rider_id === e.rider_id);
        return { rider_id: e.rider_id, team_id: e.team_id, fatigue: c?.fatigue, form: c?.form, abilities: { recovery: abil.get(e.rider_id)?.recovery } };
      });
      const medicalBonusByTeam = await loadMedicalBonusByTeam(supabase, entrants.map((e) => e.team_id), { retryOnTransient: true });
      const changed = await applyStageStartFatigue({ supabase, raceId, stageNumber, entrants, medicalBonusByTeam });
      return { changed, entrants: entrants.map((e) => [e.rider_id, e.fatigue ?? null, e.form ?? null]) };
    }]);
  }
  return list;
}

/** Koer én flade én gang. Et kast bliver til { kastet: <fejlens klasse> }, saa ogsaa det kan fryses. */
export async function runSurface(name, flag, key, { fail = null } = {}) {
  const { now, state } = world(name, flag);
  const fake = createFake(state, { fail });
  const entry = surfaces(state).find(([k]) => k === key);
  if (!entry) throw new Error(`ukendt flade: ${key}`);
  let svar;
  try { svar = await quiet(() => entry[2]({ supabase: fake, now })); } catch (err) { svar = { kastet: err?.constructor?.name ?? "Error" }; }
  return { svar, log: fake.log, slags: entry[1] };
}

/** Traethedstallene i et svar som [rytter, tal|null], uanset fladens form. Bruges til "samme tal overalt". */
export function fatigueNumbers(key, svar) {
  if (!svar || svar.kastet) return null;
  const kind = key.split("|")[0];
  if (kind === "udtagelse") return svar.ctx.riders.map((r) => [r.id, r.fatigue ?? null]);
  if (kind === "holdfane") return svar.riders.map((r) => [r.rider_id, r.fatigue ?? null]);
  if (kind === "rytterkort") return svar.enabled && svar.own ? [[key.split("|")[1], svar.fatigue ?? null]] : [];
  if (kind === "traening") return svar instanceof Map ? [...svar].map(([id, row]) => [id, row.fatigue ?? null]) : null;
  if (kind === "regelpanel") return svar.status === 200 && svar.body?.enabled ? svar.body.roster.map((r) => [r.id, r.fatigue ?? null]) : null;
  if (kind === "saesonplan" || kind === "assistent_ved_start") return [...svar].map(([id, f]) => [id, f ?? null]);
  return null;
}

export const SURFACE_KEYS = surfaces(baseWorld()).map(([key, slags]) => ({ key, slags }));

/** Hele saettet for én kontaktvaerdi: { scenarie: { flade: { svar: <sha>, kald, runder, form: <sha af kaldene runde for runde> } } }. */
export async function runAll(flag) {
  const out = {};
  for (const name of SCENARIO_NAMES) {
    out[name] = {};
    for (const { key } of SURFACE_KEYS) {
      const { svar, log } = await runSurface(name, flag, key);
      const calls = countCalls(log);
      out[name][key] = { svar: sha(svar), kald: calls.kald, runder: calls.runder, form: sha(callShape(log)) };
    }
  }
  return out;
}

// ── Race Hub: alle holdets loebskolonner i én visning ─────────────────────────────────────────
// Paa main kalder ruten getSelectionContext én gang pr. kolonne, efter hinanden (api.js, "for (const race of cols)").
export const RACEHUB_RACES = RACES;
export const TEAM_IDS = TEAMS;
/** Soemmen, kravet maales paa: findes den ikke endnu (main), er svaret null. */
export const boardFunction = () => (typeof raceSelectionModule.getSelectionContextsForRaces === "function" ? raceSelectionModule.getSelectionContextsForRaces : null);
/** Dagens Race Hub: kolonnerne efter hinanden paa samme databaseklient. */
export const boardAsOnMain = async ({ supabase, races, teamId, now }) => {
  const out = [];
  for (const race of races) out.push(await getSelectionContext({ supabase, race, teamId, now }));
  return out;
};
export async function runBoard(name, flag, team, board = boardAsOnMain) {
  const { now, state } = world(name, flag);
  const fake = createFake(state);
  const ctxs = await quiet(() => board({ supabase: fake, races: RACEHUB_RACES.map((id) => raceOf(state, id)), teamId: team, now }));
  const svar = [...ctxs].map((ctx) => sha({ ctx, laegensRyttere: ridersAtOpeningFatigue(ctx).map((r) => [r.id, r.fatigue ?? null]) }));
  const calls = countCalls(fake.log);
  return { svar, kald: calls.kald, runder: calls.runder, form: sha(callShape(fake.log)), byTarget: calls.byTarget };
}

// ── Laesefejl ─────────────────────────────────────────────────────────────────────────────────
export const FAIL_MODES = ["error", "gateway", "throw"];
/** De tabeller (og kontakter), en flade laeser med kontakten taendt, i et scenarie. */
export async function targetsRead(name, key) {
  const { log } = await runSurface(name, "on", key);
  return [...new Set(log.map((entry) => entry.target))].sort();
}
/** Koer en flade taendt, hvor ét maal ikke kan laeses. */
export const runWithFailure = (name, key, target, mode) => runSurface(name, "on", key, {
  fail: (table, keyHint) => ((table === "app_config" && keyHint ? `app_config:${keyHint}` : table) === target ? mode : null),
});
export const MEDICAL_TABLES = ["team_facilities", "team_staff", "staff_derived_abilities"];
/** Veje, der IKKE er en skaerm: ved fejlet laegeopslag skal de opfoere sig praecis som paa main. */
export const ENGINE_PATH_KEYS = SURFACE_KEYS.filter(({ slags }) => slags !== "flade").map(({ key }) => key);
export async function enginePathsUnderMedicalFailure(name = "midt_paa_dagen") {
  const out = {};
  for (const key of ENGINE_PATH_KEYS) {
    out[key] = {};
    for (const table of MEDICAL_TABLES) for (const mode of FAIL_MODES) {
      const { svar } = await runWithFailure(name, key, table, mode);
      out[key][`${table}:${mode}`] = sha(svar);
    }
  }
  return out;
}

export const flagName = (flag) => (flag === undefined ? "mangler" : String(flag));

/** Hele facit, som det fryses paa main. */
export async function buildFacit(commit = null) {
  const facit = { frosset_fra: commit, afrunding: "decimaltal afrundet til 6 decimaler foer hash (#8113)", scenarier: SCENARIO_NAMES, flader: SURFACE_KEYS.length, kontakt: {}, racehub: {}, motorvej_ved_laegefejl: {} };
  for (const flag of [...OFF_FLAGS, "on"]) facit.kontakt[flagName(flag)] = await runAll(flag);
  for (const name of SCENARIO_NAMES) {
    facit.racehub[name] = {};
    for (const team of TEAMS) {
      facit.racehub[name][team] = {};
      for (const flag of [undefined, "on"]) {
        const { svar, kald, runder, form } = await runBoard(name, flag, team);
        facit.racehub[name][team][flagName(flag)] = { svar, kald, runder, form };
      }
    }
  }
  facit.motorvej_ved_laegefejl.midt_paa_dagen = await enginePathsUnderMedicalFailure("midt_paa_dagen");
  return facit;
}

// Frys facit (koeres KUN af dommeren paa main, aldrig med ny kode):
//   node backend/lib/dommer7801RestByg.harness.mjs <sti-til-facit.json> <commit>
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [, , target, commit] = process.argv;
  if (!target) throw new Error("brug: node dommer7801RestByg.harness.mjs <facit.json> <commit>");
  const facit = await buildFacit(commit ?? null);
  writeFileSync(target, `${JSON.stringify(facit, null, 1)}\n`);
  console.log(`frosset ${SCENARIO_NAMES.length} scenarier x ${SURFACE_KEYS.length} flader x ${OFF_FLAGS.length + 1} kontaktvaerdier til ${target}`);
}
