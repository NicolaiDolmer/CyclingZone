// #8614: delte loebsmotor-scenarier til kontakten ai_team_frozen_state_8614.
//
// Bruges af aiTeamFrozenState8614.test.js OG af golden-generatoren, der koerer SAMME scenarie mod
// en frossen kopi af merge-base-koden (#7587). Scenariet faar motorfunktionen udefra, saa samme
// input kan koeres mod baade base og ny kode. Udfaldet er motorens egne skrivninger og hvad den
// laeste, ikke tal der er skrevet i haanden.
import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { ABILITY_KEYS } from "../raceSimulator.js";
import { DEMAND_VECTORS } from "../raceStageProfileGenerator.js";

export const AI_FROZEN_FLAG_READ = "app_config:ai_team_frozen_state_8614";

/** Fast klokke under scenariet, saa datoer i skrivningerne (fx injured_until) er de samme hver dag. */
const FIXED_NOW = Date.parse("2026-11-20T12:00:00Z");
async function atFixedNow(fn) {
  const RealDate = globalThis.Date;
  class FixedDate extends RealDate {
    constructor(...args) { if (args.length) super(...args); else super(FIXED_NOW); }
    static now() { return FIXED_NOW; }
  }
  globalThis.Date = FixedDate;
  try { return await fn(); } finally { globalThis.Date = RealDate; }
}

function abil(overrides = {}) {
  const a = {};
  for (const k of ABILITY_KEYS) a[k] = 50;
  return Object.assign(a, overrides);
}

/**
 * Supabase-fake der logger hver laesning (tabel, og for app_config noeglen) og hver skrivning.
 * `filterAware` afgoer om .eq()/.in() filtrerer de faste raekker; app_config filtreres altid paa key.
 */
function recordingClient({ canned, flags, filterAware }) {
  const reads = [];
  const writes = [];
  const rpcCalls = [];
  const appConfig = Object.entries(flags).map(([key, value]) => ({ key, value }));
  function from(table) {
    const preds = [];
    let key = null;
    const rowsFor = () => {
      const base = table === "app_config" ? appConfig : (canned[table] || []);
      return base.filter((r) => (table === "app_config" ? key === null || r.key === key : preds.every((p) => p(r))));
    };
    const label = () => (table === "app_config" ? `${table}:${key}` : table);
    const b = {
      select() { return b; },
      order() { return b; },
      or() { return b; },
      is() { return b; },
      not() { return b; },
      gte() { return b; },
      gt() { return b; },
      lt() { return b; },
      lte() { return b; },
      limit() { return b; },
      range() { return b; },
      eq(col, val) {
        if (col === "key") key = val;
        if (filterAware) preds.push((r) => r[col] === val);
        return b;
      },
      neq(col, val) { if (filterAware) preds.push((r) => r[col] !== val); return b; },
      in(col, vals) { if (filterAware) preds.push((r) => vals.includes(r[col])); return b; },
      maybeSingle() { reads.push(label()); return Promise.resolve({ data: rowsFor()[0] ?? null, error: null }); },
      single() { reads.push(label()); return Promise.resolve({ data: rowsFor()[0] ?? null, error: null }); },
      insert(rows) { writes.push({ table, op: "insert", rows }); return Promise.resolve({ data: null, error: null }); },
      upsert(rows) { writes.push({ table, op: "upsert", rows }); return Promise.resolve({ data: null, error: null }); },
      update(obj) {
        const w = { table, op: "update", obj, eqs: [] };
        writes.push(w);
        const u = {
          eq(c, v) { w.eqs.push([c, v]); return u; },
          in(c, v) { w.eqs.push([c, v]); return u; },
          select() { return Promise.resolve({ data: [{ id: (canned.races || [])[0]?.id ?? "row0" }], error: null }); },
          then(res, rej) { return Promise.resolve({ error: null }).then(res, rej); },
        };
        return u;
      },
      delete() {
        const w = { table, op: "delete", eqs: [], ins: [] };
        writes.push(w);
        const d = {
          eq(c, v) { w.eqs.push([c, v]); return d; },
          in(c, v) { w.ins.push([c, v]); return d; },
          then(res, rej) { return Promise.resolve({ error: null }).then(res, rej); },
        };
        return d;
      },
      then(resolve, reject) {
        reads.push(label());
        return Promise.resolve({ data: rowsFor(), error: null }).then(resolve, reject);
      },
    };
    return b;
  }
  function rpc(name, params) {
    rpcCalls.push({ name, params });
    return Promise.resolve({ data: null, error: null });
  }
  return { client: { from, rpc }, reads, writes, rpcCalls };
}

/** Tilfaeldige id'er (randomUUID til simuleringskoersler) erstattes i fast raekkefoelge: uuid-1, uuid-2 ... */
export function normalizeUuids(value) {
  const seen = new Map();
  const json = JSON.stringify(value).replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, (m) => {
    if (!seen.has(m)) seen.set(m, `uuid-${seen.size + 1}`);
    return seen.get(m);
  });
  return JSON.parse(json);
}

/**
 * #8808: motor-input-snapshottet gemmes gzip'et. De komprimerede bytes afhaenger af platformen
 * (gzip-headerens OS-felt og zlib-buildet), saa en golden fra Windows aldrig matcher Linux-CI.
 * Bytes erstattes af sha256 over det UDPAKKEDE indhold (platform-uafhaengigt, samme indhold),
 * og den komprimerede laengde fjernes. Alt andet i raekken (inkl. input_sha256) bevares.
 */
export function normalizeCompressedSnapshots(value) {
  if (Array.isArray(value)) return value.map(normalizeCompressedSnapshots);
  if (!value || typeof value !== "object") return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (k === "input_gzip_b64" && typeof v === "string") {
      out[k] = `gunzip-sha256:${createHash("sha256").update(gunzipSync(Buffer.from(v, "base64"))).digest("hex")}`;
    } else if (k === "stored_bytes" && typeof value.input_gzip_b64 === "string") {
      out[k] = null;
    } else {
      out[k] = normalizeCompressedSnapshots(v);
    }
  }
  return out;
}

/** Hele normaliseringen af et motor-udfald foer hash: platform-uafhaengige snapshots + faste uuid'er. */
export function normalizeRaceOutcome(value) {
  return normalizeUuids(normalizeCompressedSnapshots(value));
}

/** Uden noeglen for denne kontakt: det eneste nye opslag kontakten maa koste. */
export function readsWithoutFrozenFlag(reads) {
  return reads.filter((r) => r !== AI_FROZEN_FLAG_READ);
}

// ── Scenarie 1: startfeltet (loadEntrantsForRace) ────────────────────────────
// To hold: H menneskehold, X AI-hold. Ryttere med og uden condition-raekke paa begge.
export async function runLoadEntrantsScenario({ loadEntrantsForRace, flags }) {
  const ids = [["h1", "H"], ["h2", "H"], ["x1", "X"], ["x2", "X"]];
  const canned = {
    race_entries: ids.map(([id, team], i) => ({ race_id: "race-8614", rider_id: id, team_id: team, race_role: i % 2 ? "captain" : null })),
    riders: ids.map(([id, team]) => ({ id, team_id: team, is_academy: false, is_retired: false, firstname: id, lastname: "R", is_u25: false })),
    rider_derived_abilities: ids.map(([id]) => ({ rider_id: id, ...abil() })),
    rider_condition: [
      { rider_id: "h1", form: 61, fatigue: 37, injured_until: null },
      { rider_id: "x1", form: 44, fatigue: 72, injured_until: null },
    ],
    teams: [{ id: "H", name: "Human CC", is_ai: false }, { id: "X", name: "Bot CC", is_ai: true }],
    race_withdrawals: [],
  };
  const rec = recordingClient({ canned, flags, filterAware: true });
  const entrants = await atFixedNow(() => loadEntrantsForRace({
    supabase: rec.client, race: { id: "race-8614", season_id: null }, allowAutofill: false, persist: false,
  }));
  return { entrants, reads: rec.reads, writes: rec.writes, rpcCalls: rec.rpcCalls };
}

// ── Scenarie 2: en etape med et styrt paa et AI-hold (simulateStageByIndex) ──
// Samme deterministiske styrt som raceRunnerIncidents.test.js (b2 styrter paa etape 2, race-id
// fundet ved udtoemmende scan). Hold B er her et AI-hold, saa skade-grenen og felt-grenen begge naas.
const ENTRANTS = [
  ["climber", "A", { climbing: 96, endurance: 92, recovery: 84, punch: 72 }, true],
  ["sprinter", "A", { sprint: 96, acceleration: 92, positioning: 88 }, false],
  ["a3", "A", { endurance: 60, climbing: 55 }, false],
  ["a4", "A", { sprint: 60, positioning: 58 }, false],
  ["b1", "B", { climbing: 70, endurance: 68 }, false],
  ["b2", "B", { sprint: 72, acceleration: 66 }, true],
  ["b3", "B", { punch: 64, climbing: 50 }, false],
  ["b4", "B", { endurance: 55, recovery: 52 }, false],
].map(([rider_id, team_id, overrides, is_u25]) => ({ rider_id, team_id, is_u25, abilities: abil(overrides) }));

const CRASH_RACE = { id: "race-crash-scan-9", race_type: "stage_race", race_class: "ProSeries", season_id: "s1", name: "Incident GP", stages: 3 };
const STAGES_3 = [
  { stage_number: 1, profile_type: "flat", demand_vector: DEMAND_VECTORS.flat },
  { stage_number: 2, profile_type: "mountain", demand_vector: DEMAND_VECTORS.mountain },
  { stage_number: 3, profile_type: "high_mountain", demand_vector: DEMAND_VECTORS.high_mountain },
];

export async function runCrashStageScenario({ simulateStageByIndex, flags }) {
  const canned = {
    race_stage_profiles: STAGES_3,
    race_entries: ENTRANTS.map((e) => ({ rider_id: e.rider_id, team_id: e.team_id })),
    riders: ENTRANTS.map((e) => ({ id: e.rider_id, team_id: e.team_id, firstname: e.rider_id, lastname: "", is_u25: e.is_u25 })),
    rider_derived_abilities: ENTRANTS.map((e) => ({ rider_id: e.rider_id, ...e.abilities })),
    race_points: [],
    races: [{ ...CRASH_RACE }],
    seasons: [{ id: CRASH_RACE.season_id, number: 2, status: "active", race_days_completed: 9, race_days_total: 60 }],
    teams: [{ id: "A", name: "Alpha CC", is_ai: false }, { id: "B", name: "Bravo CC", is_ai: true }],
  };
  const rec = recordingClient({ canned, flags, filterAware: false });
  let stageRows = null;
  await atFixedNow(() => simulateStageByIndex({
    supabase: rec.client,
    race: { ...CRASH_RACE },
    stageIndex: 1,
    recomputeRaceDays: async () => 12,
    processBoardWeekend: async () => ({}),
    applyFatigue: async () => ({ updated: 0 }),
    checkV3Enabled: async () => true,
    applyStageResult: async (_client, { resultRows }) => {
      stageRows = resultRows;
      return { lockWon: true, rowsImported: resultRows.length };
    },
  }));
  return { stageRows, reads: rec.reads, writes: rec.writes, rpcCalls: rec.rpcCalls };
}
