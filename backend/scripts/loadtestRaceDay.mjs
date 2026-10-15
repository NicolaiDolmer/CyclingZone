#!/usr/bin/env node
/**
 * #5904 · Dry-run-gate: simulér en fuld S5-løbsdag (senior + U23 + junior, alle puljer)
 * FØR hvert sæsonskifte. Ingen netværk, ingen DB, ingen prod: alt kører i hukommelsen.
 *
 *   node backend/scripts/loadtestRaceDay.mjs                  # begge scenarier, exit 0/1
 *   node backend/scripts/loadtestRaceDay.mjs --json           # maskinlæsbar rapport
 *   node backend/scripts/loadtestRaceDay.mjs --profile legacy-s4-day1   # 28/9-kontrol: SKAL fejle
 *
 * Forhold til den fulde staging-test: `scripts/loadtest/race-day-sim.mjs` måler en rigtig
 * løbsdag på staging (prod-volumen, Auth/DB-udfald, genstart) og er den blokerende
 * releasegate. Denne dry-run er det billige første trin, der kan køres på enhver commit
 * uden staging: den fanger strukturelle regressioner (tavst sprungne puljer, en sweep
 * der læser for meget, et tick der ikke når at blive færdigt) før man bruger en staging-
 * kørsel på dem. Den erstatter ikke staging-testen.
 *
 * Hvad der er ÆGTE kode og hvad der er MODEL:
 *   - ÆGTE: `runStageScheduler` (backend/lib/stageScheduler.js) kører uændret hvert
 *     5. minut hele dagen på det klokke-justerede tick-gitter (schedulerTick.js) mod en
 *     tællende in-memory Supabase. Dens udvælgelse (forfaldne etaper, tomme puljer,
 *     dagligt loft, genoptagelse) og dens egne DB-kald + returnerede rækker er målt.
 *     Etape-tiderne kommer fra `slotsFor`/`TIER_STAGE_SLOTS` og `SQUAD_CALENDAR`, og
 *     puljestrukturen fra `SENIOR_CALENDAR_POOLS_FROM_S4` og `YOUTH_GROUP_SIZE`.
 *   - MODEL: selve etapeafviklingen (`runStageFn`, motoren) erstattes af en kalibreret
 *     omkostningsmodel (COST_PROFILES), fordi motoren ikke kan køres uden en fuld DB.
 *     Tallene og deres kilder står ved profilen. Ændres motorens eller afslutningens
 *     omkostning, skal profilen genkalibreres (fx fra en staging-kørsel).
 *
 * Grænser (DEFAULT_LIMITS, begrundelse ved hver):
 *   S4 løbsdag 1 (28/9, #5893): API faldt fra ca. 6.800 til ca. 150 kald/min, da DB'en
 *   gik ned. 6.800/min er derfor det niveau, platformen er set falde ved. Browserne alene
 *   toppede med 1.424 kald/min (#6275), så løbsdagens backend-arbejde må højst bruge
 *   resten: 6.800 - 1.424 = 5.376 kald/min i noget minut.
 *
 * Exit: 0 = alle scenarier består · 1 = mindst én grænse brudt · 2 = forkert brug.
 * Rapporten indeholder ingen hold-/managernavne eller id'er; puljer vises som aliaser.
 */
import { performance } from "node:perf_hooks";
import { writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";

import { runStageScheduler, MAX_STAGES_PER_DAY } from "../lib/stageScheduler.js";
import { STAGE_TICK_PERIOD_MS, STAGE_TICK_OFFSET_MS } from "../lib/schedulerTick.js";
import { TIER_STAGE_SLOTS, slotsFor } from "../lib/calendarPlanningWindow.js";
import { SQUAD_CALENDAR, SENIOR_CALENDAR_POOLS_FROM_S4 } from "../lib/calendarTierCaps.js";
import { YOUTH_GROUP_SIZE } from "../lib/youthPoolAssignment.js";
import { copenhagenHourToUTC, copenhagenMidnightUTC } from "../lib/copenhagenTime.js";
import { isStageSchedulerEnabled, STAGE_SCHEDULER_FLAG_KEY } from "../lib/stageSchedulerFlag.js";
import { isRaceEngineV2Enabled, RACE_ENGINE_V2_FLAG_KEY } from "../lib/raceEngineFlag.js";

// ─── Referencetal og grænser ──────────────────────────────────────────────────

/** Kald/min hvor S4 løbsdag 1 faldt sammen (#5893, 28/9 kl. 19:53). */
export const COLLAPSE_CALLS_PER_MIN = 6800;
/** Kald/min under selve udfaldet (#5893), kun til rapporten. */
export const OUTAGE_CALLS_PER_MIN = 150;
/** Browsernes målte peak (#6275, Supabase edge_logs 5-6/10). */
export const BROWSER_PEAK_CALLS_PER_MIN = 1424;
/** Backend-tickets målte peak-minut 6/10 kl. 15:00 (#6275); kalibrerer kald pr. sekund. */
export const MEASURED_TICK_PEAK_CALLS_PER_MIN = 5347;
/** PostgREST returnerer højst så mange rækker pr. svar uden paginering. */
export const POSTGREST_ROW_CAP = 1000;

export const DEFAULT_LIMITS = Object.freeze({
  // Kollaps-niveauet minus browsernes peak: det løbsdagens backend-arbejde må bruge.
  maxBackendCallsPerMinute: COLLAPSE_CALLS_PER_MIN - BROWSER_PEAK_CALLS_PER_MIN,
  // #6275's aftalte kriterie: et tick skal være færdigt før det næste. Ellers springer
  // overlap-guarden (#2090) ticks over, og køen vokser.
  maxTickDurationMs: STAGE_TICK_PERIOD_MS,
  // #3624 målte forsinkelse som "etaper over 15 min forsinket": planlagt tid -> færdig.
  maxStageDelayMs: 15 * 60 * 1000,
  // Sweepens egne kald pr. tick (uden etapearbejdet). Kører 288 gange i døgnet; et
  // loft fanger en sweep der begynder at lave et kald pr. løb/hold.
  maxSweepCallsPerTick: 80,
  // Et svar med 1.000 rækker er afkortet af PostgREST (P0 2/7: skjulte forfaldne etaper).
  maxRowsPerResponse: POSTGREST_ROW_CAP - 1,
});

// ─── Omkostningsmodel for etapeafvikling ──────────────────────────────────────

const CALLS_PER_SECOND = Math.round(MEASURED_TICK_PEAK_CALLS_PER_MIN / 60); // ca. 89/s

/**
 * Pr. etape: `stageMs` (alle etaper), + `finalizeMs` på løbets sidste etape, + `boardMs`
 * hvis bestyrelsen beregnes for løbet. Kald = målt kaldrate × varighed, undtagen
 * bestyrelsen, hvis kald er talt direkte (en RPC er få kald, men stadig DB-tid).
 */
export const COST_PROFILES = Object.freeze({
  current: Object.freeze({
    label: "Nuværende kode (efter #5890/#5892/#3624)",
    callsPerSecond: CALLS_PER_SECOND, // #6275: 5.347 kald i peak-minuttet under etapearbejde
    stageMs: 8_000, // #3624: median for en mellem-etape
    finalizeMs: 2_000, // #3624: notify-rækker skrives inden for 1,5 s (outbox, ingen Discord i ticket)
    boardMs: 10_000, // #3624: sidste etape forventet ca. 20 s i alt = etape + afslutning + bestyrelse
    boardCalls: 4, // #5892: én RPC + #3511: tre resultatlæsninger i boardGoalContext
    boardOnYouth: false, // #5892/#5898: bestyrelsen ser kun seniortruppen
    rankingRefresh: Object.freeze({ calls: 6, ms: 20_000 }), // #6184: tre matviews ca. 11,5 + 4,6 + 4,2 s
    // Ingen måling af aftentræningens samlede kald (antagelse): ca. 8 kald og 0,4 s pr. hold.
    trainingClosePerTeam: Object.freeze({ calls: 8, ms: 400 }),
  }),
  "legacy-s4-day1": Object.freeze({
    label: "S4 løbsdag 1 (28/9) før rettelserne: kontrolprofil, SKAL fejle",
    callsPerSecond: CALLS_PER_SECOND,
    stageMs: 8_000,
    finalizeMs: 34_000, // #3624: sidste etape 54 s median med Discord synkront i ticket
    boardMs: 14_000, // #3624: board-trinnet målt 13,8 s
    boardCalls: 200, // #5893: ca. 200 HTTP-kald pr. løb, O(alle hold)
    boardOnYouth: true, // #5893 rod-årsag 3: ungdomsløb kørte den fulde bestyrelse
    rankingRefresh: Object.freeze({ calls: 6, ms: 20_000 }),
    trainingClosePerTeam: Object.freeze({ calls: 8, ms: 400 }),
  }),
});

// ─── Argumenter ───────────────────────────────────────────────────────────────

export const SCENARIOS = Object.freeze(["normal", "season-last-day"]);
export const USAGE = "node backend/scripts/loadtestRaceDay.mjs [--date YYYY-MM-DD] "
  + "[--scenarios normal,season-last-day] [--profile current|legacy-s4-day1] "
  + "[--youth-groups 1-40] [--teams-per-senior-pool 2-40] [--final-share 0-1] "
  + "[--latency-ms 0-200] [--json] [--out <fil>]";

const DEFAULT_OPTIONS = Object.freeze({
  date: "2026-10-29", // første hverdag efter 28/10, efter skift til vintertid 25/10
  scenarios: [...SCENARIOS],
  profile: "current",
  youthGroups: 10, // S4 løbsdag 1: 20 ungdomsløb = 10 U23 + 10 junior (#5893)
  teamsPerSeniorPool: 20,
  finalShare: 1, // værst tænkelige: hver etape i dag er løbets sidste (afslutning + bestyrelse)
  latencyMs: 10, // Railway <-> Supabase RTT (scripts/loadtest/mock-supabase.js)
  json: false,
  out: null,
});

const VALUE_FLAGS = new Set(["date", "scenarios", "profile", "youth-groups", "teams-per-senior-pool", "final-share", "latency-ms", "out"]);
const BOOL_FLAGS = new Set(["json"]);

function intIn(raw, min, max) {
  if (!/^\d+$/.test(raw ?? "")) return null;
  const n = Number(raw);
  return n >= min && n <= max ? n : null;
}

export function parseArgs(argv) {
  const errors = [];
  const options = { ...DEFAULT_OPTIONS, scenarios: [...DEFAULT_OPTIONS.scenarios] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) { errors.push(`USAGE_UNEXPECTED_ARG:${arg}`); continue; }
    const key = arg.slice(2);
    if (BOOL_FLAGS.has(key)) { options.json = true; continue; }
    if (!VALUE_FLAGS.has(key)) { errors.push(`USAGE_UNKNOWN_FLAG:${key}`); continue; }
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) { errors.push(`USAGE_MISSING_VALUE:${key}`); continue; }
    i++;
    switch (key) {
      case "date":
        if (/^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T12:00:00Z`))) options.date = value;
        else errors.push("USAGE_INVALID_DATE");
        break;
      case "scenarios": {
        const list = value.split(",").map((s) => s.trim()).filter(Boolean);
        if (list.length && list.every((s) => SCENARIOS.includes(s))) options.scenarios = [...new Set(list)];
        else errors.push("USAGE_INVALID_SCENARIOS");
        break;
      }
      case "profile":
        if (Object.hasOwn(COST_PROFILES, value)) options.profile = value;
        else errors.push("USAGE_INVALID_PROFILE");
        break;
      case "youth-groups": {
        const n = intIn(value, 1, 40);
        if (n == null) errors.push("USAGE_INVALID_YOUTH_GROUPS"); else options.youthGroups = n;
        break;
      }
      case "teams-per-senior-pool": {
        const n = intIn(value, 2, 40);
        if (n == null) errors.push("USAGE_INVALID_TEAMS_PER_SENIOR_POOL"); else options.teamsPerSeniorPool = n;
        break;
      }
      case "final-share": {
        const n = Number(value);
        if (/^\d+(\.\d+)?$/.test(value) && n >= 0 && n <= 1) options.finalShare = n;
        else errors.push("USAGE_INVALID_FINAL_SHARE");
        break;
      }
      case "latency-ms": {
        const n = intIn(value, 0, 200);
        if (n == null) errors.push("USAGE_INVALID_LATENCY"); else options.latencyMs = n;
        break;
      }
      case "out":
        options.out = value;
        break;
      default:
        break;
    }
  }
  return { errors, options };
}

// ─── Tid ──────────────────────────────────────────────────────────────────────

/** UTC-ms for "HH:MM" dansk tid på en dansk kalenderdato (DST-robust). */
export function copenhagenSlotMs(date, hhmm) {
  const [h, m] = hhmm.split(":").map(Number);
  return copenhagenHourToUTC(date, h).getTime() + m * 60_000;
}

function addDays(date, days) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const HHMM_FMT = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Copenhagen", hour: "2-digit", minute: "2-digit", hour12: false,
});
export function copenhagenHHMM(ms) {
  return HHMM_FMT.format(new Date(ms));
}

/** Første tick-tidspunkt på gitteret k*periode+offset, der ligger >= fromMs. */
export function firstTickAtOrAfter(fromMs) {
  const k = Math.ceil((fromMs - STAGE_TICK_OFFSET_MS) / STAGE_TICK_PERIOD_MS);
  return k * STAGE_TICK_PERIOD_MS + STAGE_TICK_OFFSET_MS;
}

// ─── Fixture: én S5-løbsdag ───────────────────────────────────────────────────

const HISTORY_DAYS = 12; // afsluttede løb tidligere i sæsonen (fylder schedule-tabellen)

function poolAlias(squad, index) {
  const prefix = squad === "senior" ? "S" : squad === "u23" ? "U" : "J";
  return `${prefix}${String(index + 1).padStart(2, "0")}`;
}

/**
 * Bygger databasen for én løbsdag: aktiv sæson 5, flag tændt, seniorpyramiden 1/2/4/4,
 * `youthGroups` grupper pr. ungdomstrup à YOUTH_GROUP_SIZE hold, ét løb pr. (pulje, slot)
 * med dagens etape på slottet, plus afsluttede løb fra tidligere dage.
 *
 * @returns {{ state: object, expected: Array<object>, pools: Array<object>, teamsTotal: number }}
 */
export function buildRaceDayFixture({
  date,
  scenario = "normal",
  youthGroups = DEFAULT_OPTIONS.youthGroups,
  teamsPerSeniorPool = DEFAULT_OPTIONS.teamsPerSeniorPool,
  finalShare = DEFAULT_OPTIONS.finalShare,
  dropYouthPoolColumns = false,
} = {}) {
  const seasonLastRaceDay = scenario === "season-last-day" ? date : null;
  const seasonId = "season-5";
  const state = {
    app_config: [
      { key: STAGE_SCHEDULER_FLAG_KEY, value: "on" },
      { key: RACE_ENGINE_V2_FLAG_KEY, value: "on" },
    ],
    seasons: [
      { id: "season-4", number: 4, status: "completed" },
      { id: seasonId, number: 5, status: "active" },
    ],
    league_divisions: [],
    teams: [],
    races: [],
    race_stage_schedule: [],
    race_entries: [],
    race_simulation_runs: [],
  };

  // Puljer: senior pr. tier efter SENIOR_CALENDAR_POOLS_FROM_S4, ungdom i tier 1.
  const pools = [];
  let seniorIndex = 0;
  for (const [tierKey, count] of Object.entries(SENIOR_CALENDAR_POOLS_FROM_S4)) {
    const tier = Number(tierKey);
    for (let p = 0; p < count; p++) {
      pools.push({ id: `pool-senior-${tier}-${p}`, squad: "senior", tier, alias: poolAlias("senior", seniorIndex++) });
    }
  }
  for (const squad of Object.keys(SQUAD_CALENDAR)) {
    for (let g = 0; g < youthGroups; g++) {
      pools.push({ id: `pool-${squad}-${g}`, squad, tier: 1, alias: poolAlias(squad, g) });
    }
  }
  for (const pool of pools) {
    state.league_divisions.push({ id: pool.id, tier: pool.tier, squad: pool.squad });
  }

  // Hold: hvert seniorhold i én seniorpulje; ungdomsgrupperne fyldes med seniorholdenes
  // akademier og derefter rene AI-ungdomshold, YOUTH_GROUP_SIZE pr. gruppe.
  const seniorPools = pools.filter((p) => p.squad === "senior");
  let teamSeq = 0;
  const newTeam = (leagueDivisionId) => {
    teamSeq++;
    const team = {
      id: `team-${String(teamSeq).padStart(4, "0")}`,
      league_division_id: leagueDivisionId,
      u23_league_division_id: null,
      junior_league_division_id: null,
    };
    state.teams.push(team);
    return team;
  };
  for (const pool of seniorPools) {
    for (let t = 0; t < teamsPerSeniorPool; t++) newTeam(pool.id);
  }
  for (const squad of Object.keys(SQUAD_CALENDAR)) {
    const column = `${squad}_league_division_id`;
    const groups = pools.filter((p) => p.squad === squad);
    let cursor = 0;
    for (const group of groups) {
      for (let s = 0; s < YOUTH_GROUP_SIZE; s++) {
        const team = state.teams[cursor] ?? newTeam(null);
        cursor++;
        if (!dropYouthPoolColumns) team[column] = group.id;
      }
    }
  }
  if (dropYouthPoolColumns) {
    // Kontrol (#5890): skemaet før ungdomskolonnerne. Hold kender kun seniorpuljen.
    for (const team of state.teams) {
      delete team.u23_league_division_id;
      delete team.junior_league_division_id;
    }
  }

  // Løb: ét pr. (pulje, slot). Dagens etape er løbets næste uafviklede.
  const expected = [];
  let raceSeq = 0;
  let finalCounter = 0;
  const addRace = ({ pool, status, stages, stagesCompleted, schedule }) => {
    raceSeq++;
    const race = {
      id: `race-${String(raceSeq).padStart(5, "0")}`,
      season_id: seasonId,
      name: `${pool.alias}-R${raceSeq}`,
      stages,
      stages_completed: stagesCompleted,
      status,
      league_division_id: pool.id,
      squad: pool.squad,
      finalize_state: null,
    };
    state.races.push(race);
    for (const row of schedule) state.race_stage_schedule.push({ race_id: race.id, ...row });
    // Startfelt: én repræsentativ entry er nok til HEAD-tællingen i raceActiveGuard.
    state.race_entries.push({ race_id: race.id, team_id: null });
    return race;
  };

  for (const pool of pools) {
    // Afsluttede løb fra tidligere dage (fylder race_stage_schedule som i en rigtig sæson).
    const historicSlots = pool.squad === "senior" ? (TIER_STAGE_SLOTS[pool.tier] ?? TIER_STAGE_SLOTS[3]) : [SQUAD_CALENDAR[pool.squad].stageSlot];
    for (let d = HISTORY_DAYS; d >= 1; d--) {
      const day = addDays(date, -d);
      historicSlots.forEach((hhmm) => {
        addRace({
          pool, status: "completed", stages: 1, stagesCompleted: 1,
          schedule: [{ stage_number: 1, scheduled_at: new Date(copenhagenSlotMs(day, hhmm)).toISOString() }],
        });
      });
    }

    const slots = pool.squad === "senior"
      ? slotsFor(pool.tier, date, { seasonLastRaceDay })
      : slotsFor(1, date, { slots: { 1: [SQUAD_CALENDAR[pool.squad].stageSlot] }, seasonLastRaceDay });
    slots.forEach((hhmm, lane) => {
      const scheduledMs = copenhagenSlotMs(date, hhmm);
      // Andelen af afsluttende etaper styres deterministisk af finalShare.
      finalCounter += finalShare;
      const isFinal = finalCounter >= 1 - 1e-9;
      if (isFinal) finalCounter -= 1;
      const stages = isFinal ? 1 + (lane % 3) : 5;
      const stagesCompleted = isFinal ? stages - 1 : 2;
      const schedule = [];
      for (let n = 1; n <= stages; n++) {
        const offsetDays = n - (stagesCompleted + 1);
        schedule.push({
          stage_number: n,
          scheduled_at: new Date(copenhagenSlotMs(addDays(date, offsetDays), hhmm)).toISOString(),
        });
      }
      const race = addRace({ pool, status: stagesCompleted > 0 ? "active" : "scheduled", stages, stagesCompleted, schedule });
      expected.push({
        raceId: race.id,
        stageNumber: stagesCompleted + 1,
        scheduledMs,
        squad: pool.squad,
        pool: pool.alias,
        final: isFinal,
      });
    });
  }

  return { state, expected, pools, teamsTotal: state.teams.length };
}

// ─── Tællende in-memory Supabase ──────────────────────────────────────────────

// Indlejrede ressourcer: tabel -> fremmednøgle i den spurgte tabel.
const EMBED_FK = Object.freeze({ races: "race_id", teams: "team_id", seasons: "season_id" });

const MATCHERS = {
  eq: (v, x) => v === x,
  neq: (v, x) => v !== x,
  in: (v, x) => Array.isArray(x) && x.includes(v),
  gte: (v, x) => v != null && v >= x,
  lte: (v, x) => v != null && v <= x,
  gt: (v, x) => v != null && v > x,
  lt: (v, x) => v != null && v < x,
  is: (v, x) => (x === null ? v == null : v === x),
};

function splitTopLevel(select) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of String(select ?? "*")) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) { out.push(cur.trim()); cur = ""; continue; }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

function parseSelect(select) {
  const columns = [];
  const embeds = [];
  for (const token of splitTopLevel(select)) {
    const m = token.match(/^(\w+)(!inner)?\((.*)\)$/s);
    if (m) {
      if (!EMBED_FK[m[1]]) throw new Error(`fake-supabase: ukendt indlejret ressource "${m[1]}"`);
      embeds.push({ table: m[1], inner: Boolean(m[2]), columns: splitTopLevel(m[3]) });
    } else {
      columns.push(token);
    }
  }
  return { columns, embeds };
}

function project(row, columns) {
  if (columns.includes("*")) return { ...row };
  const out = {};
  for (const c of columns) if (Object.hasOwn(row, c)) out[c] = row[c];
  return out;
}

/**
 * Supabase-agtig klient, der tæller HVERT afsluttet kald (await/then/single/maybeSingle).
 * Ukendte metoder findes ikke på builderen og kaster derfor (fail-closed): begynder
 * scheduleren at bruge et filter, fake'en ikke kender, fejler gaten i stedet for at gætte.
 *
 * @param {object} state  { tabel: rækker[] } (læses og skrives direkte)
 * @param {{ clock: { now: number }, latencyMs: number, onCall: (call) => void }} opts
 */
export function createCountingSupabase(state, { clock, latencyMs = 0, onCall = () => {} }) {
  function table(name) {
    if (!state[name]) state[name] = [];
    return state[name];
  }

  function makeQuery(tableName, action, payload) {
    const filters = [];
    let select = action === "select" ? "*" : null;
    let countMode = null;
    let head = false;
    let order = null;
    let limit = null;
    let range = null;

    function joined(row, embed) {
      const fk = EMBED_FK[embed.table];
      return table(embed.table).find((r) => r.id === row[fk]) ?? null;
    }

    function rowMatches(row, embeds) {
      return filters.every(({ op, column, value }) => {
        const dot = column.indexOf(".");
        if (dot < 0) return MATCHERS[op](row[column], value);
        const embed = embeds.find((e) => e.table === column.slice(0, dot));
        if (!embed?.inner) throw new Error(`fake-supabase: filter på "${column}" kræver !inner-embed`);
        const other = joined(row, embed);
        return other != null && MATCHERS[op](other[column.slice(dot + 1)], value);
      });
    }

    function run() {
      const rows = table(tableName);
      let data = null;
      let count = null;
      let rowsOut = 0;
      if (action === "select") {
        const { columns, embeds } = parseSelect(select);
        let matched = rows.filter((row) => {
          for (const e of embeds) if (e.inner && !joined(row, e)) return false;
          return rowMatches(row, embeds);
        });
        if (order) {
          const { column, ascending } = order;
          matched = [...matched].sort((a, b) => (a[column] === b[column] ? 0 : (a[column] < b[column] ? -1 : 1) * (ascending ? 1 : -1)));
        }
        if (countMode) count = matched.length;
        if (range) matched = matched.slice(range.from, range.to + 1);
        if (limit != null) matched = matched.slice(0, limit);
        if (!head) {
          data = matched.map((row) => {
            const out = project(row, columns);
            for (const e of embeds) {
              const other = joined(row, e);
              out[e.table] = other ? project(other, e.columns) : null;
            }
            return out;
          });
          rowsOut = data.length;
        }
      } else if (action === "insert" || action === "upsert") {
        const incoming = Array.isArray(payload) ? payload : [payload];
        rows.push(...incoming.map((r) => ({ ...r })));
        rowsOut = incoming.length;
      } else if (action === "update") {
        const hit = rows.filter((row) => rowMatches(row, []));
        for (const row of hit) Object.assign(row, payload);
        rowsOut = hit.length;
      } else if (action === "delete") {
        const keep = rows.filter((row) => !rowMatches(row, []));
        rowsOut = rows.length - keep.length;
        state[tableName] = keep;
      }
      onCall({
        at: clock.now, table: tableName, action, rows: rowsOut, paged: Boolean(range), head,
      });
      clock.now += latencyMs;
      return { data, count, error: null };
    }

    const q = {
      select(cols = "*", opts = {}) {
        select = cols;
        countMode = opts.count ?? null;
        head = Boolean(opts.head);
        return q;
      },
      order(column, opts = {}) { order = { column, ascending: opts.ascending !== false }; return q; },
      limit(n) { limit = n; return q; },
      range(from, to) { range = { from, to }; return q; },
      single() { return Promise.resolve().then(run).then((r) => ({ ...r, data: r.data?.[0] ?? null })); },
      maybeSingle() { return Promise.resolve().then(run).then((r) => ({ ...r, data: r.data?.[0] ?? null })); },
      then(resolve, reject) { return Promise.resolve().then(run).then(resolve, reject); },
    };
    for (const op of Object.keys(MATCHERS)) {
      q[op] = (column, value) => { filters.push({ op, column, value }); return q; };
    }
    return q;
  }

  return {
    from(tableName) {
      return {
        select: (cols, opts) => makeQuery(tableName, "select").select(cols, opts),
        insert: (payload) => makeQuery(tableName, "insert", payload),
        upsert: (payload) => makeQuery(tableName, "upsert", payload),
        update: (payload) => makeQuery(tableName, "update", payload),
        delete: () => makeQuery(tableName, "delete"),
      };
    },
  };
}

// ─── Simulering ───────────────────────────────────────────────────────────────

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}

/** Fordeler `calls` kald jævnt over [startMs, startMs+durationMs) i minut-spande. */
function spreadCalls(minuteBuckets, startMs, durationMs, calls) {
  if (calls <= 0) return;
  if (durationMs <= 0) {
    const m = Math.floor(startMs / 60_000);
    minuteBuckets.set(m, (minuteBuckets.get(m) ?? 0) + calls);
    return;
  }
  const step = durationMs / calls;
  for (let i = 0; i < calls; i++) {
    const m = Math.floor((startMs + step * (i + 0.5)) / 60_000);
    minuteBuckets.set(m, (minuteBuckets.get(m) ?? 0) + 1);
  }
}

/**
 * Kører én løbsdag tick for tick med den ægte stage-scheduler.
 * @returns {Promise<object>} målinger + checks for scenariet
 */
export async function simulateRaceDay({
  date = DEFAULT_OPTIONS.date,
  scenario = "normal",
  profile = COST_PROFILES.current,
  limits = DEFAULT_LIMITS,
  latencyMs = DEFAULT_OPTIONS.latencyMs,
  youthGroups = DEFAULT_OPTIONS.youthGroups,
  teamsPerSeniorPool = DEFAULT_OPTIONS.teamsPerSeniorPool,
  finalShare = DEFAULT_OPTIONS.finalShare,
  dropYouthPoolColumns = false,
} = {}) {
  const fixture = buildRaceDayFixture({ date, scenario, youthGroups, teamsPerSeniorPool, finalShare, dropYouthPoolColumns });
  const { state, expected } = fixture;
  const clock = { now: 0 };
  const minuteBuckets = new Map();
  const sweepCallsByTick = [];
  let currentTick = null;
  let maxRowsPerResponse = 0;
  let maxRowsTable = null;

  const supabase = createCountingSupabase(state, {
    clock,
    latencyMs,
    onCall(call) {
      const m = Math.floor(call.at / 60_000);
      minuteBuckets.set(m, (minuteBuckets.get(m) ?? 0) + 1);
      if (currentTick) {
        currentTick.sweepCalls++;
        currentTick.sweepRows += call.rows;
      }
      if (!call.paged && call.rows > maxRowsPerResponse) {
        maxRowsPerResponse = call.rows;
        maxRowsTable = call.table;
      }
    },
  });

  const raceById = new Map(state.races.map((r) => [r.id, r]));
  const expectedByKey = new Map(expected.map((e) => [`${e.raceId}:${e.stageNumber}`, e]));
  const stageRuns = [];
  const errors = [];
  const concurrentJobs = [];
  let trainingCloseStarted = false;

  const emitJob = (kind, startMs, durationMs, calls) => {
    spreadCalls(minuteBuckets, startMs, durationMs, calls);
    concurrentJobs.push({ kind, startMs, durationMs, calls });
  };

  const runStageFn = async ({ raceId, stageIndex }) => {
    const race = raceById.get(raceId);
    if (!race) throw new Error(`ukendt løb ${raceId}`);
    const stageNumber = stageIndex + 1;
    const isFinal = stageNumber >= (race.stages || 1);
    const startMs = clock.now;
    const parts = [{ ms: profile.stageMs, calls: Math.round(profile.callsPerSecond * profile.stageMs / 1000) }];
    if (isFinal) {
      parts.push({ ms: profile.finalizeMs, calls: Math.round(profile.callsPerSecond * profile.finalizeMs / 1000) });
      if (race.squad === "senior" || profile.boardOnYouth) parts.push({ ms: profile.boardMs, calls: profile.boardCalls });
    }
    let calls = 0;
    for (const part of parts) {
      spreadCalls(minuteBuckets, clock.now, part.ms, part.calls);
      clock.now += part.ms;
      calls += part.calls;
    }
    race.stages_completed = stageNumber;
    if (isFinal) race.status = "completed";
    else if (race.status === "scheduled") race.status = "active";
    // Direkte i state: de rigtige skrivekald er en del af etapens modellerede kald.
    state.race_simulation_runs.push({
      id: `run-${state.race_simulation_runs.length + 1}`,
      race_id: raceId, stage_index: stageIndex, source: "scheduler",
      created_at: new Date(clock.now).toISOString(),
    });
    const exp = expectedByKey.get(`${raceId}:${stageNumber}`);
    stageRuns.push({
      raceId, stageNumber, squad: race.squad, final: isFinal,
      scheduledMs: exp?.scheduledMs ?? null, startMs, endMs: clock.now, calls,
      tickAt: currentTick?.at ?? null,
    });
    if (currentTick) {
      currentTick.stages++;
      if (isFinal) currentTick.finals++;
      currentTick.modelCalls += calls;
    }
  };

  const startTrainingDayClose = ({ stagesRan }) => {
    if (trainingCloseStarted || !stagesRan) return;
    const remaining = expected.filter((e) => (raceById.get(e.raceId)?.stages_completed ?? 0) < e.stageNumber);
    if (remaining.length) return;
    trainingCloseStarted = true;
    const per = profile.trainingClosePerTeam;
    emitJob("training_close", clock.now, per.ms * fixture.teamsTotal, per.calls * fixture.teamsTotal);
  };

  const dayStartMs = copenhagenMidnightUTC(new Date(copenhagenSlotMs(date, "12:00"))).getTime();
  const dayEndMs = copenhagenMidnightUTC(new Date(dayStartMs + 30 * 3600_000)).getTime();
  const lastTickMs = dayEndMs + 60 * 60 * 1000; // en times efterløb til sene etaper
  const ticks = [];
  let busyUntil = -Infinity;
  let skippedTicks = 0;
  const seenKeys = new Map();
  const logs = { emptyPoolSkips: 0, lines: 0 };

  const origLog = console.log;
  const origError = console.error;
  console.log = (...args) => {
    logs.lines++;
    if (String(args[0]).includes("pulje uden hold")) logs.emptyPoolSkips++;
  };
  console.error = (...args) => { logs.lines++; errors.push(String(args[0]).slice(0, 200)); };
  try {
    for (let at = firstTickAtOrAfter(dayStartMs); at <= lastTickMs; at += STAGE_TICK_PERIOD_MS) {
      if (at < busyUntil) { skippedTicks++; continue; } // overlap-guard (#2090)
      clock.now = at;
      currentTick = { at, sweepCalls: 0, sweepRows: 0, stages: 0, finals: 0, modelCalls: 0, durationMs: 0, cpuMs: 0, result: null };
      const wall0 = performance.now();
      let result;
      try {
        result = await runStageScheduler({
          supabase,
          now: new Date(at),
          isStageSchedulerEnabled,
          isRaceEngineV2Enabled,
          runStageFn,
          seenKeys,
          captureExceptionFn: (err) => { errors.push(String(err?.message ?? err).slice(0, 200)); },
          startTrainingDayClose,
        });
      } catch (err) {
        errors.push(`tick ${copenhagenHHMM(at)}: ${String(err?.message ?? err).slice(0, 200)}`);
        result = { ran: 0, errors: 1 };
      }
      currentTick.cpuMs = performance.now() - wall0;
      clock.now += currentTick.cpuMs;
      currentTick.durationMs = clock.now - at;
      currentTick.result = result;
      busyUntil = clock.now;
      if (currentTick.finals > 0) {
        emitJob("ranking_refresh", clock.now, profile.rankingRefresh.ms, profile.rankingRefresh.calls);
      }
      sweepCallsByTick.push(currentTick.sweepCalls);
      ticks.push(currentTick);
      currentTick = null;
    }
  } finally {
    console.log = origLog;
    console.error = origError;
  }

  // ── Målinger ──
  const ranKeys = new Set(stageRuns.map((r) => `${r.raceId}:${r.stageNumber}`));
  const missing = expected.filter((e) => !ranKeys.has(`${e.raceId}:${e.stageNumber}`));
  const missingBySquad = {};
  for (const m of missing) missingBySquad[m.squad] = (missingBySquad[m.squad] ?? 0) + 1;
  const expectedBySquad = {};
  for (const e of expected) expectedBySquad[e.squad] = (expectedBySquad[e.squad] ?? 0) + 1;

  let peakMinute = null;
  let peakCalls = 0;
  let totalCalls = 0;
  for (const [m, c] of minuteBuckets) {
    totalCalls += c;
    if (c > peakCalls) { peakCalls = c; peakMinute = m; }
  }
  const delays = stageRuns.filter((r) => r.scheduledMs != null).map((r) => r.endMs - r.scheduledMs).sort((a, b) => a - b);
  const busiest = ticks.reduce((a, t) => (t.durationMs > (a?.durationMs ?? -1) ? t : a), null);
  const sweepSorted = [...sweepCallsByTick].sort((a, b) => a - b);
  const sweepCallsTotal = sweepCallsByTick.reduce((a, b) => a + b, 0);

  const metrics = {
    scenario,
    date,
    profile: profile.label,
    pools: { senior: fixture.pools.filter((p) => p.squad === "senior").length, u23: youthGroups, junior: youthGroups },
    teams: fixture.teamsTotal,
    stagesExpected: expected.length,
    stagesExpectedBySquad: expectedBySquad,
    stagesRan: stageRuns.length,
    finalsRan: stageRuns.filter((r) => r.final).length,
    missing: missing.length,
    missingBySquad,
    ticksRun: ticks.length,
    ticksSkippedOverlap: skippedTicks,
    peakCallsPerMinute: peakCalls,
    peakMinute: peakMinute == null ? null : copenhagenHHMM(peakMinute * 60_000),
    totalCalls,
    sweepCallsTotal,
    sweepCallsPerTickMax: sweepSorted.at(-1) ?? 0,
    sweepCallsPerTickMedian: percentile(sweepSorted, 50),
    sweepRowsPerTickMax: Math.max(0, ...ticks.map((t) => t.sweepRows)),
    sweepMsMax: Math.round(Math.max(0, ...ticks.map((t) => t.sweepCalls * latencyMs + t.cpuMs))),
    maxRowsPerResponse,
    maxRowsTable,
    maxTickDurationMs: Math.round(busiest?.durationMs ?? 0),
    busiestTick: busiest ? {
      at: copenhagenHHMM(busiest.at), stages: busiest.stages, finals: busiest.finals,
      calls: busiest.sweepCalls + busiest.modelCalls,
    } : null,
    stageDelayMsP50: Math.round(percentile(delays, 50)),
    stageDelayMsP90: Math.round(percentile(delays, 90)),
    stageDelayMsMax: Math.round(delays.at(-1) ?? 0),
    concurrentJobs: concurrentJobs.map((j) => ({ kind: j.kind, at: copenhagenHHMM(j.startMs), durationMs: j.durationMs, calls: j.calls })),
    emptyPoolSkipLines: logs.emptyPoolSkips,
    errors: errors.length,
    errorSamples: errors.slice(0, 3),
    dailyStageCap: MAX_STAGES_PER_DAY,
  };

  const checks = [
    { id: "coverage", ok: missing.length === 0, value: `${stageRuns.length}/${expected.length}`, limit: "alle planlagte etaper i alle trupper", note: missing.length ? `mangler: ${JSON.stringify(missingBySquad)}` : "" },
    { id: "errors", ok: errors.length === 0, value: errors.length, limit: 0, note: errors[0] ?? "" },
    { id: "peak_calls_per_minute", ok: peakCalls <= limits.maxBackendCallsPerMinute, value: peakCalls, limit: limits.maxBackendCallsPerMinute, note: metrics.peakMinute ? `kl. ${metrics.peakMinute}` : "" },
    { id: "tick_duration", ok: metrics.maxTickDurationMs <= limits.maxTickDurationMs, value: metrics.maxTickDurationMs, limit: limits.maxTickDurationMs, note: metrics.busiestTick ? `tick kl. ${metrics.busiestTick.at}: ${metrics.busiestTick.stages} etaper, ${metrics.busiestTick.finals} afslutninger` : "" },
    { id: "ticks_skipped", ok: skippedTicks === 0, value: skippedTicks, limit: 0, note: "overlap-guard sprang ticks over" },
    { id: "stage_delay", ok: metrics.stageDelayMsMax <= limits.maxStageDelayMs, value: metrics.stageDelayMsMax, limit: limits.maxStageDelayMs, note: `p50 ${metrics.stageDelayMsP50} ms, p90 ${metrics.stageDelayMsP90} ms` },
    { id: "sweep_calls_per_tick", ok: metrics.sweepCallsPerTickMax <= limits.maxSweepCallsPerTick, value: metrics.sweepCallsPerTickMax, limit: limits.maxSweepCallsPerTick, note: `median ${metrics.sweepCallsPerTickMedian}, ${sweepCallsTotal} i døgnet` },
    { id: "rows_per_response", ok: maxRowsPerResponse <= limits.maxRowsPerResponse, value: maxRowsPerResponse, limit: limits.maxRowsPerResponse, note: maxRowsTable ? `største svar: ${maxRowsTable}` : "" },
  ];

  return { scenario, passed: checks.every((c) => c.ok), checks, metrics };
}

// ─── Rapport ──────────────────────────────────────────────────────────────────

function fmt(n) {
  return typeof n === "number" ? n.toLocaleString("da-DK") : String(n);
}

export function renderMarkdown(report) {
  const lines = [];
  lines.push(`# Løbsdags-dry-run (#5904): ${report.passed ? "PASS" : "FAIL"}`);
  lines.push("");
  lines.push(`Profil: ${report.profile} · dato ${report.date} · RTT ${report.latencyMs} ms · afsluttende andel ${report.finalShare}`);
  lines.push(`Reference: S4 løbsdag 1 faldt fra ca. ${fmt(COLLAPSE_CALLS_PER_MIN)} til ca. ${fmt(OUTAGE_CALLS_PER_MIN)} kald/min (#5893); browser-peak ${fmt(BROWSER_PEAK_CALLS_PER_MIN)} kald/min (#6275).`);
  for (const s of report.scenarios) {
    const m = s.metrics;
    lines.push("");
    lines.push(`## ${s.scenario}: ${s.passed ? "PASS" : "FAIL"}`);
    lines.push("");
    lines.push(`Puljer: senior ${m.pools.senior}, U23 ${m.pools.u23}, junior ${m.pools.junior} · hold ${fmt(m.teams)} · etaper ${m.stagesRan}/${m.stagesExpected} (${m.finalsRan} afslutninger) · ${m.ticksRun} ticks`);
    lines.push(`Travleste tick: ${m.busiestTick ? `kl. ${m.busiestTick.at}, ${m.busiestTick.stages} etaper, ${fmt(m.busiestTick.calls)} kald` : "ingen"} · kald i døgnet ${fmt(m.totalCalls)} (sweep ${fmt(m.sweepCallsTotal)})`);
    lines.push("");
    lines.push("| Check | Resultat | Værdi | Grænse | Note |");
    lines.push("|---|---|---|---|---|");
    for (const c of s.checks) {
      lines.push(`| ${c.id} | ${c.ok ? "ok" : "**FAIL**"} | ${fmt(c.value)} | ${fmt(c.limit)} | ${c.note} |`);
    }
  }
  lines.push("");
  lines.push("Etapeafviklingen er modelleret (COST_PROFILES); scheduler-sweepen er ægte kode målt mod en tællende in-memory DB. Erstatter ikke staging-testen (scripts/loadtest/race-day-sim.mjs).");
  return lines.join("\n");
}

export async function runLoadtest(options) {
  const profile = COST_PROFILES[options.profile];
  const scenarios = [];
  for (const scenario of options.scenarios) {
    scenarios.push(await simulateRaceDay({
      date: options.date,
      scenario,
      profile,
      latencyMs: options.latencyMs,
      youthGroups: options.youthGroups,
      teamsPerSeniorPool: options.teamsPerSeniorPool,
      finalShare: options.finalShare,
    }));
  }
  return {
    passed: scenarios.every((s) => s.passed),
    profile: profile.label,
    date: options.date,
    latencyMs: options.latencyMs,
    finalShare: options.finalShare,
    limits: DEFAULT_LIMITS,
    scenarios,
  };
}

async function main(argv) {
  const { errors, options } = parseArgs(argv);
  if (errors.length) {
    process.stderr.write(`${errors.join("\n")}\n${USAGE}\n`);
    return 2;
  }
  const report = await runLoadtest(options);
  const text = options.json ? JSON.stringify(report, null, 2) : renderMarkdown(report);
  if (options.out) writeFileSync(options.out, `${text}\n`);
  process.stdout.write(`${text}\n`);
  return report.passed ? 0 : 1;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main(process.argv.slice(2)).then((code) => { process.exitCode = code; }, (err) => {
    process.stderr.write(`loadtestRaceDay: ${err?.stack ?? err}\n`);
    process.exitCode = 1;
  });
}
