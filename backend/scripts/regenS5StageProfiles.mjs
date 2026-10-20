#!/usr/bin/env node
// backend/scripts/regenS5StageProfiles.mjs
//
// #6929 (spor L3 af #6857, løbsidentitet): regenerér S5's etapeprofiler PÅ STEDET med
// identitets-generatoren, uden at røre løbene. SSOT: docs/CALENDAR_RULES.md §7d og
// docs/superpowers/specs/2026-10-18-6857-loebsidentitet-teknisk-design.md §3.
//
// Hvorfor på stedet: S5-kalenderen er skrevet (løb, datoer, etape-tider). Alt spillerdata
// peger på races.id, og race_stage_profiles er nøglet på (race_id, stage_number). Samme antal
// rækker pr. løb giver derfor ingen brud; kun ruterne skiftes ud.
//
// DRY-RUN ER STANDARD. Dry-runnet læser gennem en klient der kaster ved enhver skrivning og:
//   1. læser S5's seniorløb, league_divisions.tier, race_pool (inkl. identitetsfelterne) og de
//      nuværende profiler;
//   2. bygger seed-løbene som tierCalendarMaterializer.seedRaceFor (+ identitetsfelterne) for
//      én repræsentativ pulje pr. division, genererer med makeS5TierProfileGenerator pr.
//      division (realisme-gen-træk og finale-kvoter som materializeren) og fan-out'er samme
//      parcours til divisionens øvrige puljer;
//   3. kører benchmark-gaten (1-4), dæknings-gulvene (§5) og de fail-closed invarianter;
//   4. skriver en offentlig rapport (kvalitativ, docs/snapshots/6857/), en privat rapport med
//      tal (balance-internals/, hard rule 17), backup.sql/restore.sql og, med --routes-out,
//      de foreslåede ruter i testportens format cz-race-routes/v1 (#6909).
//
// --apply (ejer-go pr. prod-skridt) kræver --season 5 --confirm-season-upcoming
// --backup-table=backup_6857_race_stage_profiles_YYYYMMDD --plan-hash=<dry-runnets hash>.
// Efter 25/10 (dansk dato) kræves også --allow-active. Apply genlæser alt, kræver samme
// plan-hash (intet har flyttet sig siden dry-runnet), at backup-tabellen dækker hver række der
// slettes, skriver pr. løb (DELETE + INSERT, højst 200 rækker pr. batch) og post-verificerer:
// count(profiler) = sum(stages), hver række = planen, kryds-pulje-divergens 0 (også via
// checkStageProfileSeedDivergence.js --season 5) og venter calendar-cachens TTL ud.
// Idempotent: løb hvis rækker allerede er planen, springes over. Deterministisk: samme input
// giver samme plan-hash.
//
//   infisical run --env=prod --silent -- node backend/scripts/regenS5StageProfiles.mjs \
//     [--routes-out=balance-internals/6857/<dato>/routes] [--private-dir=...] [--motor-bench=<fil>]
//
// Exit: 0 = grøn · 1 = blokerende fund (dry-run) eller fejlet post-verify · 2 = brugsfejl.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import { balanceFinaleQuotas, toStageProfileRow } from "../lib/raceStageProfileGenerator.js";
import { makeS5TierProfileGenerator } from "../lib/s5TierTerrainQuota.js";
import { resolveTierDraw } from "../lib/raceRouteRealismDraw.js";
import {
  computeTierCoverageStats, detectCoverageViolations, detectTerrainBandViolations,
  TIER_TERRAIN_FAMILY_MIN, TIER_TERRAIN_FAMILY_MAX, TIER_MOUNTAIN_FREE_STAGE_RACE_MIN, TIER_ONE_DAY_SHARE_MIN, CLASS_STAGE_LENGTH_BAND,
} from "../lib/tierCalendarGuarantees.js";
import { computeUniformTierStats, detectUniformTierViolations, TIER_UNIFORM_TOLERANCE_PP } from "../lib/calendarCompositionTargets.js";
import {
  evaluateS5BenchmarkGate, formatS5BenchmarkReport, loadS5Benchmark, loadMotorGapFile, DEFAULT_MOTOR_STUB_PATH,
} from "../lib/s5BenchmarkGate.js";
import { TIER_IDENTITY_DISTRIBUTION, RACE_IDENTITY_TYPES } from "../lib/raceIdentityTypes.js";
import { GRAND_TOUR_MIN_STAGES } from "../lib/tierRaceSelection.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { onlySeniorSquadRows } from "../lib/squads.js";
import { validateSeed } from "./applyRaceIdentity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..");

// ── Konstanter ────────────────────────────────────────────────────────────────────────

export const TARGET_SEASON_NUMBER = 5;
/** Sæsonskiftet til S5 (dansk dato). Fra denne dag kræves --allow-active (ejer-go). */
export const CUTOVER_DATE_CPH = "2026-10-25";
export const WRITE_BATCH_ROWS = 200;
/** Skal matche CACHE_TTL.calendar i backend/routes/api.js (låst af testen). */
export const CALENDAR_CACHE_TTL_MS = 60_000;
export const CALENDAR_CACHE_MARGIN_MS = 5_000;
export const BACKUP_TABLE_PATTERN = /^backup_6857_race_stage_profiles_\d{8}$/;
export const ROUTES_FORMAT = "cz-race-routes/v1";
export const PUBLIC_DIR_DEFAULT = join(REPO_ROOT, "docs", "snapshots", "6857");

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const SEASON_COLUMNS = "id, number, status";
export const DIVISION_COLUMNS = "id, tier, pool_index, squad, retired_at";
export const RACE_COLUMNS = "id, name, race_type, race_class, stages, stages_completed, status, pool_race_id, league_division_id, game_day_start, engine_rules_revision, squad";
export const CATALOG_COLUMNS = "id, external_id, name, race_class, race_type, stages, terrain_archetype, race_identity_type, signature, authored_route";
/** race_stage_profiles' kolonner (database/schema-snapshot.json). */
export const PROFILE_COLUMNS = Object.freeze([
  "id", "race_id", "stage_number", "profile_type", "finale_type", "demand_vector", "generator_version", "is_manual",
  "generated_at", "distance_km", "elevation_gain_m", "climbs", "sprints", "sectors", "segments", "weather", "elevation_profile",
]);
/** Indholdet der sammenlignes (idempotens, post-verify): alt undtagen række-id og tidsstempel. */
export const PROFILE_CONTENT_COLUMNS = Object.freeze(PROFILE_COLUMNS.filter((c) => !["id", "generated_at"].includes(c)));

const TIME_TRIAL_TYPES = new Set(["itt", "itt_hilly", "ttt"]);

// ── Små rene hjælpere ─────────────────────────────────────────────────────────────────

/** "YYYY-MM-DD" i Europe/Copenhagen. `now` injiceres altid (hard rule 16). */
export function copenhagenDate(now) {
  const d = now instanceof Date ? now : new Date(now);
  if (Number.isNaN(d.getTime())) throw new Error("copenhagenDate: ugyldigt tidspunkt");
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Copenhagen", year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/** JSON med sorterede nøgler, så hash og sammenligning ikke afhænger af nøgle-rækkefølge. */
export function canonicalJson(value) {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map((v) => canonicalJson(v)).join(",")}]`;
  const keys = Object.keys(value).filter((k) => value[k] !== undefined).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/** Én profilrækkes sammenligningsindhold (manglende kolonne = null). */
export function profileContent(row) {
  return Object.fromEntries(PROFILE_CONTENT_COLUMNS.map((c) => [c, row?.[c] ?? null]));
}

function compareIds(a, b) {
  const na = Number(a);
  const nb = Number(b);
  if (Number.isFinite(na) && Number.isFinite(nb) && String(na) === String(a) && String(nb) === String(b)) return na - nb;
  return String(a).localeCompare(String(b));
}

function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

const byStage = (a, b) => Number(a.stage_number) - Number(b.stage_number);

/** Kast hvis stien ikke ligger i en `balance-internals`-mappe (hard rule 17: tal og vægte er private). */
export function assertPrivatePath(path, label) {
  const parts = resolve(path).split(sep).map((p) => p.toLowerCase());
  if (!parts.includes("balance-internals")) {
    throw new Error(`${label} skal ligge i en balance-internals-mappe (hard rule 17): ${path}`);
  }
  return resolve(path);
}

// ── Argumenter ────────────────────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(["season", "routes-out", "private-dir", "public-dir", "backup-table", "plan-hash", "motor-bench", "label", "identity-file"]);
const BOOL_FLAGS = new Set(["apply", "confirm-season-upcoming", "allow-active", "skip-cache-wait"]);

/**
 * @param {string[]} argv  process.argv.slice(2)
 */
export function parseArgs(argv = []) {
  const o = {
    apply: false, season: null, confirmSeasonUpcoming: false, allowActive: false, skipCacheWait: false,
    routesOut: null, privateDir: null, publicDir: null, backupTable: null, planHash: null, motorBench: null, label: null, identityFile: null,
  };
  const camel = (s) => s.replace(/-([a-z])/g, (_, c) => c.toUpperCase());
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) throw new Error(`ukendt argument "${arg}"`);
    const eq = arg.indexOf("=");
    const name = eq >= 0 ? arg.slice(2, eq) : arg.slice(2);
    if (BOOL_FLAGS.has(name)) {
      if (eq >= 0) throw new Error(`--${name} tager ingen værdi`);
      o[camel(name)] = true;
      continue;
    }
    if (!VALUE_FLAGS.has(name)) throw new Error(`ukendt flag --${name}`);
    let value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value == null || value === "" || value.startsWith("--")) throw new Error(`--${name} kræver en værdi`);
    o[camel(name)] = value;
  }
  if (o.season != null) {
    const n = Number(o.season);
    if (!Number.isInteger(n)) throw new Error(`--season "${o.season}" er ikke et heltal`);
    o.season = n;
  }
  if (o.season != null && o.season !== TARGET_SEASON_NUMBER) {
    throw new Error(`scriptet regenererer kun sæson ${TARGET_SEASON_NUMBER} (fik --season ${o.season})`);
  }
  if (o.apply && o.identityFile) {
    throw new Error("--identity-file er kun til dry-run: apply bruger prod's race_pool, så identiteten skal være anvendt dér først (applyRaceIdentity.js)");
  }
  if (o.apply) {
    if (o.season !== TARGET_SEASON_NUMBER) throw new Error(`--apply kræver eksplicit --season ${TARGET_SEASON_NUMBER}`);
    if (!o.confirmSeasonUpcoming) throw new Error("--apply kræver --confirm-season-upcoming");
    if (!o.backupTable || !BACKUP_TABLE_PATTERN.test(o.backupTable)) {
      throw new Error("--apply kræver --backup-table=backup_6857_race_stage_profiles_YYYYMMDD (oprettet med dry-runnets backup.sql)");
    }
    if (!o.planHash || !/^[0-9a-f]{64}$/.test(o.planHash)) throw new Error("--apply kræver --plan-hash=<dry-runnets plan-hash>");
  } else {
    for (const f of ["backupTable", "planHash"]) if (o[f]) throw new Error(`--${f === "backupTable" ? "backup-table" : "plan-hash"} hører kun til --apply`);
  }
  if (o.season == null) o.season = TARGET_SEASON_NUMBER;
  return o;
}

// ── Læsning (I/O bag et lille interface, så logikken kan testes med fakes) ─────────────

const WRITE_METHODS = new Set(["insert", "update", "upsert", "delete"]);

/** Klient der kaster ved enhver skrivning: dry-runnet kan ikke skrive, heller ikke ved en fejl. */
export function createReadOnlyClient(supabase) {
  return {
    from(table) {
      const builder = supabase.from(table);
      return new Proxy(builder, {
        get(target, prop) {
          if (typeof prop === "string" && WRITE_METHODS.has(prop)) {
            return () => { throw new Error(`dry-run: ${prop} på ${table} er blokeret`); };
          }
          const value = target[prop];
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    },
    rpc() { throw new Error("dry-run: rpc er blokeret"); },
  };
}

/** Supabase-udgaven af scriptets database-interface. */
export function createSupabaseRegenDb(supabase) {
  const must = (label, { data, error }) => {
    if (error) throw new Error(`${label}: ${error.message}`);
    return data;
  };
  return {
    async seasonByNumber(number) {
      return must("seasons", await supabase.from("seasons").select(SEASON_COLUMNS).eq("number", number).maybeSingle());
    },
    async divisions() {
      return fetchAllRows(() => supabase.from("league_divisions").select(DIVISION_COLUMNS).order("id"));
    },
    async racesOfSeason(seasonId) {
      // Kun seniorløbene (#5517): ungdomsløb har deres egen kalender og røres ikke her.
      return onlySeniorSquadRows(await fetchAllRows(() => supabase.from("races").select(RACE_COLUMNS).eq("season_id", seasonId).order("id")));
    },
    async catalogRows(ids) {
      return fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("race_pool").select(CATALOG_COLUMNS).in("id", chunk).order("id"));
    },
    async profilesOf(raceIds) {
      return fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_profiles").select(PROFILE_COLUMNS.join(", ")).in("race_id", chunk).order("id"));
    },
    async scheduleOf(raceIds) {
      return fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_schedule").select("race_id, stage_number, scheduled_at").in("race_id", chunk).order("race_id").order("stage_number"));
    },
    async claimsOf(raceIds) {
      return fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_claims").select("race_id, stage_index").in("race_id", chunk).order("race_id").order("stage_index"));
    },
    async backupIds(table, ids) {
      if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`ugyldigt backup-navn: ${table}`);
      const rows = await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from(table).select("id").in("id", chunk).order("id"));
      return new Set(rows.map((r) => r.id));
    },
    async deleteProfiles(raceIds) {
      must("race_stage_profiles delete", await supabase.from("race_stage_profiles").delete().in("race_id", raceIds));
    },
    async insertProfiles(rows) {
      must("race_stage_profiles insert", await supabase.from("race_stage_profiles").insert(rows));
    },
  };
}

/**
 * Alt planen og invarianterne bygger på, læst i én omgang.
 * @param {ReturnType<typeof createSupabaseRegenDb>} db
 */
export async function loadRegenInput(db, seasonNumber = TARGET_SEASON_NUMBER) {
  const season = await db.seasonByNumber(seasonNumber);
  if (!season) throw new Error(`sæson ${seasonNumber} findes ikke`);
  const divisions = await db.divisions();
  const races = await db.racesOfSeason(season.id);
  const raceIds = races.map((r) => r.id);
  const poolIds = [...new Set(races.map((r) => r.pool_race_id).filter((x) => x != null))].sort(compareIds);
  const catalog = poolIds.length ? await db.catalogRows(poolIds) : [];
  const profiles = raceIds.length ? await db.profilesOf(raceIds) : [];
  const claims = raceIds.length ? await db.claimsOf(raceIds) : [];
  // Kun til rapporten (GT-optakterne): hvornår hvert løb starter og slutter.
  const schedule = raceIds.length && typeof db.scheduleOf === "function" ? await db.scheduleOf(raceIds) : [];
  return { season, divisions, races, catalog, profiles, claims, schedule };
}

/**
 * Dry-run med en identitets-fil (database/seed/race_identity.json) lagt oven på prod's race_pool
 * i hukommelsen, så tørkørslen kan vise typerne før applyRaceIdentity.js --apply har skrevet dem.
 * Samme validering og samme krav til løbstypen som applyRaceIdentity (L1). Rører ikke databasen.
 *
 * @returns {{ catalog: object[], entries: number, applied: number }}
 */
export function overlayIdentity(catalog, document) {
  const entries = validateSeed(document);
  const byExternal = new Map(entries.map((e) => [e.external_id, e]));
  let applied = 0;
  const out = catalog.map((row) => {
    const e = byExternal.get(row.external_id);
    if (!e) return row;
    if (e.race_identity_type !== null && row.race_type !== "stage_race") throw new Error(`${e.external_id}: race_identity_type kræver stage_race`);
    if (e.signature !== null && row.race_type !== "stage_race") throw new Error(`${e.external_id}: signature kræver stage_race`);
    if (e.authored_route !== null && (row.race_type !== "single" || row.race_class !== "Monuments")) throw new Error(`${e.external_id}: authored_route kræver et Monuments-endagsløb`);
    applied += 1;
    return { ...row, race_identity_type: e.race_identity_type, signature: e.signature, authored_route: e.authored_route };
  });
  return { catalog: out, entries: entries.length, applied };
}

// ── Planen (ren) ──────────────────────────────────────────────────────────────────────

/**
 * Seed-løbet for én planlagt løbsrække. Samme form som tierCalendarMaterializer.seedRaceFor
 * (id = katalog-id, så alle puljer i divisionen deler parcours) + #6857's identitetsfelter fra
 * race_pool, som identitets-generatoren (L2) læser. Som materializeren tages kun de felter med
 * der er sat, så et løb uden identitet giver præcis samme seed-løb som før #6857.
 */
export const RACE_IDENTITY_FIELDS = Object.freeze(["race_identity_type", "signature", "authored_route"]);
export function seedRaceFor(race, cat, seasonId, seasonVariant = 0) {
  const identity = {};
  for (const k of RACE_IDENTITY_FIELDS) if (cat?.[k] != null) identity[k] = cat[k];
  return {
    id: race.pool_race_id, name: cat?.name ?? race.name ?? null, race_type: race.race_type, stages: race.stages,
    external_id: cat?.external_id ?? null,
    terrain_archetype: cat?.terrain_archetype ?? null,
    race_class: race.race_class ?? cat?.race_class ?? null,
    season_id: seasonId, season_variant: seasonVariant,
    ...identity,
  };
}

/** Standard-generatoren: divisionens S5-kvote-generator (samme som materializerens skrivesti). */
export function defaultGeneratorFactory({ tier, seedRaces, log = () => {} }) {
  return makeS5TierProfileGenerator({
    tier, seedRaces,
    onAllocate: (a) => { if (a.changes) log(`  division ${a.tier}: terræn-kvoten ændrede ${a.changes} filler-etaper (variant ${a.variant})`); },
  });
}

/** Benchmark-gaten med de rigtige input (benchmarken + motor-filen). */
export function makeGateEvaluator({ benchmark, motor }) {
  return (races) => evaluateS5BenchmarkGate({ races, benchmark, motor });
}

export const DEFAULT_GUARANTEES = Object.freeze({
  oneDayShareMin: TIER_ONE_DAY_SHARE_MIN,
  terrainFamilyMin: TIER_TERRAIN_FAMILY_MIN,
  terrainFamilyMax: TIER_TERRAIN_FAMILY_MAX,
  mountainFreeMin: TIER_MOUNTAIN_FREE_STAGE_RACE_MIN,
  uniformTolerancePp: TIER_UNIFORM_TOLERANCE_PP,
  classStageLengthBand: CLASS_STAGE_LENGTH_BAND,
});

// identityTypeByPoolRaceId: L2 (#6928) hæver bjergfri-gulvet til antallet af løb med en
// bjergfri type og melder hvert typet løb der bryder løftet. Før L2 ignoreres argumentet.
function coverageFor(tier, raceRows, profilesByPoolRaceId, guarantees, identityTypeByPoolRaceId) {
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId, classStageLengthBand: guarantees.classStageLengthBand, identityTypeByPoolRaceId });
  const violations = [
    ...detectCoverageViolations({
      tier, stats, oneDayShareMin: guarantees.oneDayShareMin, terrainFamilyMin: guarantees.terrainFamilyMin,
      mountainFreeMin: guarantees.mountainFreeMin,
    }),
    ...detectTerrainBandViolations({ tier, stats, terrainFamilyMin: guarantees.terrainFamilyMin, terrainFamilyMax: guarantees.terrainFamilyMax }),
  ];
  const uniform = computeUniformTierStats(raceRows.map((r) => ({ stages: profilesByPoolRaceId.get(r.pool_race_id) ?? [] })));
  const uniformCheck = detectUniformTierViolations({ stats: uniform, label: `division ${tier}`, tolerancePp: guarantees.uniformTolerancePp });
  return { stats, violations, uniform, uniformRows: uniformCheck.rows, uniformViolations: uniformCheck.violations };
}

/**
 * Byg hele planen: profiler pr. løb (alle puljer), dækning før/efter, benchmark-gaten før/efter
 * og plan-hashen. Ren givet sine injicerede afhængigheder.
 *
 * @param {Awaited<ReturnType<typeof loadRegenInput>>} input
 * @param {{ generatorFactory?: Function, drawResolver?: Function, evaluateGate: Function,
 *   guarantees?: typeof DEFAULT_GUARANTEES, log?: Function }} deps
 */
export function buildRegenPlan(input, {
  generatorFactory = defaultGeneratorFactory, drawResolver = resolveTierDraw, evaluateGate,
  guarantees = DEFAULT_GUARANTEES, log = () => {},
} = {}) {
  if (typeof evaluateGate !== "function") throw new Error("buildRegenPlan: evaluateGate mangler");
  const { season, divisions, races, catalog, profiles } = input;
  const planErrors = [];
  const tierByDivision = new Map(divisions.map((d) => [d.id, d.tier]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const currentByRace = groupBy(profiles, "race_id");
  for (const rows of currentByRace.values()) rows.sort(byStage);

  for (const r of races) {
    if (!tierByDivision.has(r.league_division_id)) planErrors.push(`løb ${r.id}: pulje ${r.league_division_id} findes ikke i league_divisions`);
    if (r.pool_race_id == null) planErrors.push(`løb ${r.id}: mangler pool_race_id`);
    else if (!catalogById.has(r.pool_race_id)) planErrors.push(`løb ${r.id}: katalog-løbet ${r.pool_race_id} findes ikke i race_pool`);
  }

  const racesByTier = groupBy(races.filter((r) => tierByDivision.has(r.league_division_id) && catalogById.has(r.pool_race_id)), (r) => tierByDivision.get(r.league_division_id));
  const tiers = [];
  const rowsByRaceId = new Map();
  for (const tier of [...racesByTier.keys()].sort((a, b) => a - b)) {
    const pools = groupBy(racesByTier.get(tier), "league_division_id");
    const poolIds = [...pools.keys()].sort(compareIds);
    const signatureOf = (rs) => rs.map((r) => `${r.pool_race_id}:${r.stages}:${r.race_type}`).sort().join("|");
    const repPoolId = poolIds[0];
    const repRaces = pools.get(repPoolId).slice().sort((a, b) => (Number(a.game_day_start ?? Infinity) - Number(b.game_day_start ?? Infinity)) || compareIds(a.pool_race_id, b.pool_race_id));
    const repSignature = signatureOf(repRaces);
    for (const pid of poolIds.slice(1)) {
      if (signatureOf(pools.get(pid)) !== repSignature) planErrors.push(`division ${tier}: pulje ${pid} har ikke samme løbssæt som pulje ${repPoolId} (#2276)`);
    }
    const dupPool = repRaces.length !== new Set(repRaces.map((r) => r.pool_race_id)).size;
    if (dupPool) planErrors.push(`division ${tier}: samme katalog-løb to gange i pulje ${repPoolId}`);

    const seedRaces = repRaces.map((r) => seedRaceFor(r, catalogById.get(r.pool_race_id), season.id, 0));
    const generate = generatorFactory({ tier, seedRaces, log });
    const draw = drawResolver({ tier, seedRaces, generateProfiles: generate });
    const seasonVariant = Number(draw?.attempt) || 0;
    if (seasonVariant > 0) log(`  division ${tier}: kanonisk træk brød realisme-båndene → gen-træk ${seasonVariant} (#3347)`);
    if (draw?.exhausted) log(`  ⚠ division ${tier}: alle gen-træk brød realisme-båndene — det kanoniske træk bruges`);
    const generated = seedRaces.map((sr) => generate({ ...sr, season_variant: seasonVariant }));
    const balanced = balanceFinaleQuotas(generated);
    const afterByPool = new Map(repRaces.map((r, i) => [r.pool_race_id, balanced[i]]));
    const beforeByPool = new Map(repRaces.map((r) => [r.pool_race_id, currentByRace.get(r.id) ?? []]));

    for (const pid of poolIds) {
      for (const race of pools.get(pid)) {
        const planned = afterByPool.get(race.pool_race_id);
        if (!planned) { planErrors.push(`løb ${race.id}: ingen planlagt profil (division ${tier})`); continue; }
        rowsByRaceId.set(race.id, planned.map((p) => toStageProfileRow(race.id, p)));
      }
    }

    const raceRows = repRaces.map((r) => ({ pool_race_id: r.pool_race_id, race_type: r.race_type, stages: r.stages, race_class: r.race_class }));
    const identityTypes = new Map(repRaces.map((r) => [r.pool_race_id, catalogById.get(r.pool_race_id)?.race_identity_type ?? null]));
    tiers.push({
      tier, poolIds, repPoolId, seasonVariant,
      draw: { attempt: seasonVariant, exhausted: Boolean(draw?.exhausted), firstDrawFailures: draw?.firstDrawFailures ?? [] },
      repRaces, seedRaces, raceRows,
      before: { profilesByPoolRaceId: beforeByPool, coverage: coverageFor(tier, raceRows, beforeByPool, guarantees, identityTypes) },
      after: { profilesByPoolRaceId: afterByPool, coverage: coverageFor(tier, raceRows, afterByPool, guarantees, identityTypes) },
    });
  }

  const gateRaces = (side) => tiers.flatMap((t) => t.repRaces.map((r) => ({
    pool_race_id: r.pool_race_id, name: r.name, race_type: r.race_type, race_class: r.race_class ?? null,
    terrain_archetype: catalogById.get(r.pool_race_id)?.terrain_archetype ?? null,
    stages: t[side].profilesByPoolRaceId.get(r.pool_race_id) ?? [],
  })));
  const gate = { before: evaluateGate(gateRaces("before")), after: evaluateGate(gateRaces("after")) };

  const allRows = [...rowsByRaceId.entries()].sort((a, b) => compareIds(a[0], b[0])).flatMap(([, rows]) => rows);
  const planHash = sha256(canonicalJson(allRows.map(profileContent)));
  return { seasonId: season.id, tiers, rowsByRaceId, gate, planErrors, planHash, rowCount: allRows.length };
}

// ── Invarianter (fail-closed) ─────────────────────────────────────────────────────────

/**
 * @returns {{ ok: boolean, violations: string[], checks: Array<{ name: string, ok: boolean, detail: string }> }}
 */
export function checkInvariants({ input, plan, now, allowActive = false, seasonNumber = TARGET_SEASON_NUMBER }) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });
  const { season, races, profiles, claims } = input;

  add("sæsonen er S5", season?.number === seasonNumber, `sæson ${season?.number}`);
  const statusOk = season?.status === "upcoming" || (allowActive && season?.status === "active");
  add("sæsonen er upcoming (active kun med --allow-active)", statusOk, `status ${season?.status}`);
  const today = copenhagenDate(now);
  add(`før ${CUTOVER_DATE_CPH}, ellers --allow-active (ejer-go)`, today < CUTOVER_DATE_CPH || allowActive, `dansk dato ${today}`);

  const raceIds = new Set(races.map((r) => r.id));
  const planIds = new Set(plan.rowsByRaceId.keys());
  const missing = [...raceIds].filter((id) => !planIds.has(id));
  const extra = [...planIds].filter((id) => !raceIds.has(id));
  add("samme races.id-sæt", missing.length === 0 && extra.length === 0, `${missing.length} uden plan, ${extra.length} ukendte`);

  const badStages = races.filter((r) => {
    const rows = plan.rowsByRaceId.get(r.id);
    if (!rows) return false;
    const n = Number(r.stages);
    return rows.length !== n || rows.some((row, i) => row.stage_number !== i + 1);
  });
  add("samme stages pr. løb (1..n uden huller)", badStages.length === 0, `${badStages.length} løb afviger`);

  const started = races.filter((r) => Number(r.stages_completed ?? Number.NaN) !== 0);
  add("stages_completed = 0", started.length === 0, `${started.length} løb`);
  add("0 claims (race_stage_claims)", claims.length === 0, `${claims.length} claims`);
  const bound = races.filter((r) => r.engine_rules_revision != null);
  add("engine_rules_revision IS NULL", bound.length === 0, `${bound.length} løb bundet`);
  const manual = profiles.filter((p) => p.is_manual === true);
  add("ingen is_manual-profiler", manual.length === 0, `${manual.length} rækker`);
  add("planen kunne bygges", plan.planErrors.length === 0, plan.planErrors.slice(0, 5).join(" · "));
  add("benchmark-gaten (1-4) grøn", plan.gate.after.green, `${plan.gate.after.blocking.length} brud`);
  const coverage = plan.tiers.flatMap((t) => t.after.coverage.violations);
  add("§5-gulve, bjergfrie etapeløb og rolling-bånd", coverage.length === 0, `${coverage.length} brud`);
  const uniform = plan.tiers.flatMap((t) => t.after.coverage.uniformViolations);
  add("§6b brosten/ITT/højbjerg pr. division", uniform.length === 0, `${uniform.length} brud`);

  const violations = checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
  return { ok: violations.length === 0, violations, checks };
}

// ── Diff, backup, apply og post-verify ────────────────────────────────────────────────

/** Hvilke løb skal skrives? Et løb hvis rækker allerede er planen, springes over (idempotent). */
export function diffAgainstCurrent(plan, profiles) {
  const currentByRace = groupBy(profiles, "race_id");
  const racesToWrite = [];
  const unchanged = [];
  for (const [raceId, planned] of [...plan.rowsByRaceId.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
    const current = (currentByRace.get(raceId) ?? []).slice().sort(byStage);
    const same = current.length === planned.length
      && canonicalJson(current.map(profileContent)) === canonicalJson(planned.map(profileContent));
    (same ? unchanged : racesToWrite).push(raceId);
  }
  return { racesToWrite, unchanged };
}

function assertUuid(value, label) {
  if (!UUID_RE.test(String(value))) throw new Error(`${label} er ikke et uuid: ${value}`);
}

/** backup.sql: kopi af S5-seniorløbenes nuværende profiler. Idempotent. */
export function buildBackupSql(table, seasonId) {
  if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`ugyldigt backup-navn: ${table}`);
  assertUuid(seasonId, "seasonId");
  return `-- #6857/#6929 backup af S5's etapeprofiler FØR regen. Idempotent.
-- data-api-access: {"table":"public.${table}","roles":{"anon":[],"authenticated":[],"service_role":["SELECT"]},"reason":"Backend-only ops backup; regenS5StageProfiles --apply reads it to prove coverage"}
begin;
create table if not exists public.${table} as
  select *, now() as snapshot_at from public.race_stage_profiles where false;
alter table public.${table} enable row level security;
-- RLS erstatter ikke grants (docs/DATA_API_GRANTS.md): kun service_role må læse.
revoke all on table public.${table} from public, anon, authenticated, service_role;
grant select on table public.${table} to service_role;
-- Nøglet på etape-pladsen, ikke på række-id: apply giver nye id'er, og en genkørsel af denne fil
-- efter (en del af) apply må aldrig lægge den nye generation ved siden af originalen.
create unique index if not exists ${table}_slot on public.${table}(race_id, stage_number);
insert into public.${table}
  select p.*, now() from public.race_stage_profiles p
   where p.race_id in (select r.id from public.races r
                        where r.season_id = '${seasonId}' and (r.squad is null or r.squad = 'senior'))
on conflict (race_id, stage_number) do nothing;
commit;
notify pgrst, 'reload schema';
-- Verificér: select count(*) from public.${table}; (skal være = antal nuværende S5-profiler)
`;
}

/** restore.sql: rul regen tilbage fra backuppen. Ejer-gated. */
export function buildRestoreSql(table) {
  if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`ugyldigt backup-navn: ${table}`);
  const cols = PROFILE_COLUMNS.join(", ");
  return `-- #6857/#6929 restore af S5's etapeprofiler fra ${table}. Ejer-gated.
begin;
delete from public.race_stage_profiles
 where race_id in (select distinct race_id from public.${table});
insert into public.race_stage_profiles (${cols})
  select ${cols} from public.${table};
commit;
`;
}

/** Kast hvis backup-tabellen ikke dækker hver række apply sletter. */
export async function assertBackupCovers(db, table, ids) {
  if (!ids.length) return;
  let covered;
  try {
    covered = await db.backupIds(table, ids);
  } catch (err) {
    throw new Error(`backup-tabellen ${table} kan ikke læses (${err.message}). Kør backup.sql først. Intet skrevet.`, { cause: err });
  }
  const missing = ids.filter((id) => !covered.has(id));
  if (missing.length) throw new Error(`backuppen mangler ${missing.length} af ${ids.length} rækker. Kør backup.sql igen. Intet skrevet.`);
}

/** Løbene i batches: hele løb, højst `maxRows` rækker pr. batch. */
export function batchRaces(raceIds, rowsByRaceId, maxRows = WRITE_BATCH_ROWS) {
  const batches = [];
  let cur = { raceIds: [], rows: [] };
  for (const id of raceIds) {
    const rows = rowsByRaceId.get(id) ?? [];
    if (rows.length > maxRows) throw new Error(`løb ${id} har ${rows.length} rækker, over batch-loftet ${maxRows}`);
    if (cur.rows.length + rows.length > maxRows && cur.raceIds.length) { batches.push(cur); cur = { raceIds: [], rows: [] }; }
    cur.raceIds.push(id);
    cur.rows.push(...rows);
  }
  if (cur.raceIds.length) batches.push(cur);
  return batches;
}

/** DELETE + INSERT pr. batch. En fejl midt i stopper; en genkørsel samler op (idempotent). */
export async function applyPlan({ db, plan, racesToWrite, log = () => {}, clock = () => new Date() }) {
  let rowsWritten = 0;
  let lastWriteAt = null;
  const batches = batchRaces(racesToWrite, plan.rowsByRaceId);
  for (const [i, b] of batches.entries()) {
    await db.deleteProfiles(b.raceIds);
    await db.insertProfiles(b.rows);
    rowsWritten += b.rows.length;
    lastWriteAt = clock();
    log(`  batch ${i + 1}/${batches.length}: ${b.raceIds.length} løb · ${b.rows.length} rækker`);
  }
  return { racesWritten: racesToWrite.length, rowsWritten, batches: batches.length, lastWriteAt };
}

/** Kryds-pulje-divergens pr. division: (katalog-løb, etape)-slots hvor puljerne har forskellig rute. */
export function crossPoolDivergence(races, tierByDivision, profilesByRaceId) {
  const routeKey = (p) => `${p.profile_type}|${p.finale_type ?? ""}`;
  const byTier = new Map();
  for (const r of races) {
    const tier = tierByDivision.get(r.league_division_id);
    if (tier == null) continue;
    if (!byTier.has(tier)) byTier.set(tier, new Map());
    const byPool = byTier.get(tier);
    if (!byPool.has(r.pool_race_id)) byPool.set(r.pool_race_id, new Map());
    const stages = byPool.get(r.pool_race_id);
    for (const p of profilesByRaceId.get(r.id) ?? []) {
      if (!stages.has(p.stage_number)) stages.set(p.stage_number, new Set());
      stages.get(p.stage_number).add(routeKey(p));
    }
  }
  const out = new Map();
  for (const [tier, byPool] of byTier) {
    let slots = 0;
    let diverging = 0;
    for (const stages of byPool.values()) for (const set of stages.values()) { slots += 1; if (set.size > 1) diverging += 1; }
    out.set(tier, { slots, diverging });
  }
  return out;
}

/** Læs checkStageProfileSeedDivergence.js' tabel: summen af "divergerende FØR" (= DB nu). */
export function parseDivergenceScriptOutput(text) {
  let total = 0;
  let rows = 0;
  for (const line of String(text).split(/\r?\n/)) {
    const m = line.match(/^Div\s+(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)\s*\|\s*(\d+)/);
    if (!m) continue;
    rows += 1;
    total += Number(m[4]);
  }
  return rows ? { rows, divergingNow: total } : null;
}

/**
 * Post-verify efter apply. Læser alt igen.
 * @returns {Promise<{ ok: boolean, checks: Array<{name:string, ok:boolean, detail:string}> }>}
 */
export async function postVerify({ db, plan, races, divisions, runDivergenceScript = null }) {
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });
  const rows = await db.profilesOf(races.map((r) => r.id));
  const expected = races.reduce((s, r) => s + Number(r.stages || 0), 0);
  add("count(profiler) = sum(stages)", rows.length === expected, `${rows.length} / ${expected}`);
  const { racesToWrite } = diffAgainstCurrent(plan, rows);
  add("hver række = planen", racesToWrite.length === 0, `${racesToWrite.length} løb afviger`);
  const byRace = groupBy(rows, "race_id");
  const div = crossPoolDivergence(races, new Map(divisions.map((d) => [d.id, d.tier])), byRace);
  const diverging = [...div.values()].reduce((s, d) => s + d.diverging, 0);
  add("kryds-pulje-divergens 0", diverging === 0, `${diverging} slots`);
  if (runDivergenceScript) {
    const parsed = parseDivergenceScriptOutput(runDivergenceScript());
    add("checkStageProfileSeedDivergence.js --season 5: 0 divergerende", parsed != null && parsed.divergingNow === 0,
      parsed ? `${parsed.divergingNow} slots over ${parsed.rows} divisioner` : "output kunne ikke læses");
  }
  return { ok: checks.every((c) => c.ok), checks };
}

/** calendar-cachen er pr. proces med TTL; ingen skrivning kan rydde den udefra, så vi venter den ud. */
export async function waitForCalendarCache({ lastWriteAt, clock = () => new Date(), sleep = (ms) => new Promise((r) => setTimeout(r, ms)) }) {
  if (!lastWriteAt) return { waitedMs: 0, emptyAt: null };
  const emptyAt = new Date(lastWriteAt.getTime() + CALENDAR_CACHE_TTL_MS + CALENDAR_CACHE_MARGIN_MS);
  const waitMs = Math.max(0, emptyAt.getTime() - clock().getTime());
  if (waitMs > 0) await sleep(waitMs);
  return { waitedMs: waitMs, emptyAt };
}

// ── Testportens rute-format (#6909) ───────────────────────────────────────────────────

/** Én fil pr. løb i alle puljer: præcis de rækker --apply ville skrive. */
export function buildRoutesFiles({ plan, seasonNumber = TARGET_SEASON_NUMBER, label, generatedAt }) {
  const manifest = { format: ROUTES_FORMAT, label: label ?? `S${seasonNumber} identitet, tørkørsel ${generatedAt.slice(0, 10)}`, season: seasonNumber, generated_at: generatedAt };
  const files = new Map();
  for (const [raceId, rows] of [...plan.rowsByRaceId.entries()].sort((a, b) => compareIds(a[0], b[0]))) {
    files.set(`${raceId}.json`, { format: ROUTES_FORMAT, race_id: raceId, stages: rows.length, profiles: rows });
  }
  return { manifest, files };
}

export function writeRoutesDir(dir, routes) {
  const out = assertPrivatePath(dir, "--routes-out");
  mkdirSync(out, { recursive: true });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(routes.manifest, null, 2)}\n`, "utf8");
  for (const [name, body] of routes.files) writeFileSync(join(out, name), `${JSON.stringify(body)}\n`, "utf8");
  return out;
}

// ── Rapporten ─────────────────────────────────────────────────────────────────────────

const pct = (n, d) => (d > 0 ? (100 * n) / d : 0);
const fmtPct = (x) => `${x.toFixed(1)} %`;
const mark = (ok) => (ok ? "✅" : "❌");

function terrainCounts(raceRows, profilesByPoolRaceId) {
  const c = { stages: 0, cobbles: 0, gravel: 0, itt: 0, high_mountain: 0 };
  for (const r of raceRows) {
    for (const p of profilesByPoolRaceId.get(r.pool_race_id) ?? []) {
      c.stages += 1;
      if (p.profile_type === "cobbles") c.cobbles += 1;
      else if (p.profile_type === "gravel") c.gravel += 1;
      else if (TIME_TRIAL_TYPES.has(p.profile_type)) c.itt += 1;
      else if (p.profile_type === "high_mountain") c.high_mountain += 1;
    }
  }
  return c;
}

const isShortStageRace = (r) => r.race_type === "stage_race" && Number(r.stages) < GRAND_TOUR_MIN_STAGES;
const isGrandTour = (r) => r.race_type === "stage_race" && Number(r.stages) >= GRAND_TOUR_MIN_STAGES;

/** Etapeløb pr. identitetstype mod ejerens tabel A. */
export function identityTable(tier, repRaces, catalogById) {
  const want = TIER_IDENTITY_DISTRIBUTION[tier] ?? {};
  const got = Object.fromEntries([...RACE_IDENTITY_TYPES, "untyped"].map((t) => [t, 0]));
  for (const r of repRaces.filter(isShortStageRace)) {
    const t = catalogById.get(r.pool_race_id)?.race_identity_type ?? null;
    got[t && RACE_IDENTITY_TYPES.includes(t) ? t : "untyped"] += 1;
  }
  const rows = RACE_IDENTITY_TYPES.map((t) => ({ type: t, want: want[t] ?? 0, got: got[t], ok: (want[t] ?? 0) === got[t] }));
  return { rows, untyped: got.untyped, ok: rows.every((x) => x.ok) && got.untyped === 0 };
}

/**
 * D1 (spec §2): hver Grand Tour skal have et klatreløb (GT-optakt) blandt de korte etapeløb der
 * SLUTTER lige før den. Start og slut er første og sidste etapes scheduled_at
 * (race_stage_schedule); ved lige slutning tæller et hvilket som helst af dem.
 *
 * @param {Map<string, {start: number, end: number}>} spanByRaceId  races.id → tidsrum (ms)
 */
export function gtPreludes(repRaces, catalogById, spanByRaceId = new Map()) {
  const start = (r) => spanByRaceId.get(r.id)?.start ?? Number.NaN;
  const end = (r) => spanByRaceId.get(r.id)?.end ?? Number.NaN;
  return repRaces.filter(isGrandTour).sort((a, b) => start(a) - start(b)).map((gt) => {
    const before = repRaces.filter((r) => isShortStageRace(r) && end(r) < start(gt));
    const lastEnd = before.length ? Math.max(...before.map(end)) : null;
    const nearest = before.filter((r) => end(r) === lastEnd).sort((a, b) => compareIds(a.pool_race_id, b.pool_race_id));
    const typeOf = (r) => catalogById.get(r.pool_race_id)?.race_identity_type ?? null;
    const hit = nearest.find((r) => typeOf(r) === "climbers_gt_prelude") ?? nearest[0] ?? null;
    const type = hit ? typeOf(hit) : null;
    return { gt: gt.name, prelude: hit?.name ?? null, type, ok: type === "climbers_gt_prelude" };
  });
}

function monumentRoute(profile) {
  if (!profile) return null;
  const climbs = Array.isArray(profile.climbs) ? profile.climbs : [];
  const sectors = Array.isArray(profile.sectors) ? profile.sectors : [];
  const last = climbs.slice().sort((a, b) => Number(a.crest_km) - Number(b.crest_km)).at(-1) ?? null;
  return {
    distance_km: profile.distance_km ?? null, elevation_gain_m: profile.elevation_gain_m ?? null,
    sectors: sectors.length, sector_km: Number(sectors.reduce((s, x) => s + Number(x.length_km || 0), 0).toFixed(1)),
    last_top: last ? { name: last.name, category: last.category, km_to_finish: Number((Number(profile.distance_km) - Number(last.crest_km)).toFixed(1)) } : null,
  };
}

/** Følger den genererede rute den håndskrevne (authored_route)? */
export function matchesAuthored(profile, authored) {
  if (!authored || !profile) return null;
  // Hvert forfattet felt skal stå uændret i ruten; kun afledte felter (segments, weather,
  // elevation_profile, demand_vector, generator_version) og felter generatoren lægger til ses bort fra.
  const sameItems = (got, want) => Array.isArray(got) && Array.isArray(want) && got.length === want.length
    && want.every((w, i) => Object.keys(w).every((k) => canonicalJson(got[i]?.[k]) === canonicalJson(w[k])));
  return ["profile_type", "finale_type", "distance_km", "elevation_gain_m"].every((k) => profile[k] === authored[k])
    && ["climbs", "sprints", "sectors"].every((k) => sameItems(profile[k] ?? [], authored[k] ?? []));
}

// Terrænets hårdhed til "queen": kongeetapen er en etape af løbets hårdeste terræn (spec §5).
const TERRAIN_RANK = Object.freeze({ rolling: 1, hilly: 2, medium_mountain: 3, mountain: 4, high_mountain: 5 });

function targetStages(hint, profiles) {
  const n = profiles.length;
  if (hint === "first") return [1];
  if (hint === "last") return [n];
  if (hint === "queen") {
    const rank = (p) => TERRAIN_RANK[p.profile_type] ?? 0;
    const top = Math.max(0, ...profiles.map(rank));
    return profiles.filter((p) => rank(p) === top).map((p) => p.stage_number);
  }
  return profiles.map((p) => p.stage_number);
}

/** Matcher etapen featuren, inkl. dens forfattede egenskaber? */
function featureHolds(f, p) {
  if (f.kind === "climb" || f.kind === "summit_finish") {
    return (p.climbs ?? []).some((c) => c.name === f.name && c.category === f.category && c.length_km === f.length_km
      && c.avg_gradient === f.avg_gradient && Boolean(c.summit_finish) === (f.kind === "summit_finish" || Boolean(f.summit_finish)));
  }
  if (f.kind === "itt" || f.kind === "prologue") return p.profile_type === (f.band === "hilly" ? "itt_hilly" : "itt");
  if (f.kind === "sector") return (p.sectors ?? []).some((x) => x.name === f.name && x.kind === f.surface && x.length_km === f.length_km);
  return false;
}

/** Er hver signatur-feature låst i den genererede rute? */
export function signaturePins(race, signature, profiles) {
  const features = Array.isArray(signature?.features) ? signature.features : [];
  return features.map((f) => {
    const stages = targetStages(f.stage_hint, profiles);
    const hit = profiles.find((p) => stages.includes(p.stage_number) && featureHolds(f, p));
    return { race: race.name, kind: f.kind, name: f.name ?? null, stage_hint: f.stage_hint, pinned: Boolean(hit), stage: hit?.stage_number ?? null };
  });
}

/**
 * Rapporten pr. division. `full` har tal og navne (privat); `public` er kvalitativ (✅/❌ og
 * antal fra ejerens tabel A), så den kan committes.
 */
export function buildReport({ input, plan, invariants, diff, generatedAt, gateLines = [], identitySource = "race_pool (prod)" }) {
  const catalogById = new Map(input.catalog.map((c) => [c.id, c]));
  const spanByRaceId = new Map();
  for (const st of input.schedule ?? []) {
    const ms = Date.parse(st.scheduled_at);
    if (!Number.isFinite(ms)) continue;
    const cur = spanByRaceId.get(st.race_id);
    spanByRaceId.set(st.race_id, cur ? { start: Math.min(cur.start, ms), end: Math.max(cur.end, ms) } : { start: ms, end: ms });
  }
  const divisions = plan.tiers.map((t) => {
    const raceRows = t.raceRows;
    const tb = terrainCounts(raceRows, t.before.profilesByPoolRaceId);
    const ta = terrainCounts(raceRows, t.after.profilesByPoolRaceId);
    const stageRaces = t.repRaces.filter((r) => r.race_type === "stage_race");
    const monuments = t.repRaces.filter((r) => r.race_class === "Monuments").map((r) => {
      const authored = catalogById.get(r.pool_race_id)?.authored_route ?? null;
      const after = (t.after.profilesByPoolRaceId.get(r.pool_race_id) ?? [])[0];
      return {
        name: r.name, authored: authored != null, matchesAuthored: matchesAuthored(after, authored),
        before: monumentRoute((t.before.profilesByPoolRaceId.get(r.pool_race_id) ?? [])[0]), after: monumentRoute(after),
      };
    });
    const pins = stageRaces.flatMap((r) => {
      const sig = catalogById.get(r.pool_race_id)?.signature ?? null;
      return sig ? signaturePins(r, sig, t.after.profilesByPoolRaceId.get(r.pool_race_id) ?? []) : [];
    });
    return {
      tier: t.tier, pools: t.poolIds.length, races: t.repRaces.length, stageRaces: stageRaces.length,
      seasonVariant: t.seasonVariant, drawExhausted: t.draw.exhausted,
      identity: identityTable(t.tier, t.repRaces, catalogById),
      gtPreludes: t.tier === 1 ? gtPreludes(t.repRaces, catalogById, spanByRaceId) : [],
      terrain: { before: tb, after: ta },
      uniform: { before: t.before.coverage.uniformRows, after: t.after.coverage.uniformRows },
      mountainFree: {
        before: t.before.coverage.stats.mountainFreeStageRaces, after: t.after.coverage.stats.mountainFreeStageRaces,
        // L2 (#6928): gulvet hæves til antallet af løb med en bjergfri type (tabel A).
        min: TIER_MOUNTAIN_FREE_STAGE_RACE_MIN[t.tier] == null ? null : Math.max(TIER_MOUNTAIN_FREE_STAGE_RACE_MIN[t.tier], t.after.coverage.stats.identityMountainFreeExpected ?? 0),
        broken: t.after.coverage.stats.identityMountainFreeBroken ?? [],
      },
      floors: {
        familyAfter: t.after.coverage.stats.familyCounts, familyBefore: t.before.coverage.stats.familyCounts,
        min: TIER_TERRAIN_FAMILY_MIN[t.tier] ?? {}, max: TIER_TERRAIN_FAMILY_MAX[t.tier] ?? {},
        violationsBefore: t.before.coverage.violations, violationsAfter: t.after.coverage.violations,
      },
      monuments, pins,
    };
  });
  const gatePart = (g) => ({
    green: g.green, blocking: g.blocking.length,
    parts: Object.fromEntries(["stages", "grandTours", "season", "motor"].map((k) => [k, { green: k === "motor" ? g.parts.motor.status !== "red" : g.parts[k].green, stub: k === "motor" ? Boolean(g.parts.motor.stub) : undefined, violations: (g.parts[k].violations ?? []).length }])),
  });
  const full = {
    issue: "#6929 (#6857 L3)", generatedAt, identitySource, season: input.season.number, planHash: plan.planHash, rowCount: plan.rowCount,
    races: input.races.length, racesToWrite: diff.racesToWrite.length, unchanged: diff.unchanged.length,
    invariants, gate: { before: gatePart(plan.gate.before), after: gatePart(plan.gate.after), afterBlocking: plan.gate.after.blocking },
    divisions,
  };

  const publicJson = {
    issue: full.issue, generatedAt, identitySource, season: full.season, planHash: full.planHash, races: full.races,
    racesToWrite: full.racesToWrite, invariants: invariants.checks.map(({ name, ok }) => ({ name, ok })),
    gate: { before: { green: full.gate.before.green, parts: Object.fromEntries(Object.entries(full.gate.before.parts).map(([k, v]) => [k, v.green])) },
      after: { green: full.gate.after.green, parts: Object.fromEntries(Object.entries(full.gate.after.parts).map(([k, v]) => [k, v.green])) } },
    divisions: divisions.map((d) => ({
      tier: d.tier, pools: d.pools,
      identity: { ok: d.identity.ok, untyped: d.identity.untyped, rows: d.identity.rows },
      gtPreludesOk: d.gtPreludes.every((g) => g.ok),
      uniformAfterOk: d.uniform.after.map((u) => ({ category: u.category, pass: u.pass })),
      mountainFreeOk: d.mountainFree.min == null || d.mountainFree.after >= d.mountainFree.min,
      floorsOk: d.floors.violationsAfter.length === 0,
      monuments: { count: d.monuments.length, authored: d.monuments.filter((m) => m.authored).length, followAuthored: d.monuments.filter((m) => m.matchesAuthored === true).length },
      pins: { features: d.pins.length, pinned: d.pins.filter((p) => p.pinned).length },
    })),
  };

  return { full, public: publicJson, fullMarkdown: fullMarkdown(full, gateLines), publicMarkdown: publicMarkdown(publicJson) };
}

function fullMarkdown(r, gateLines) {
  const L = [];
  L.push(`# #6929 tørkørsel: S5-etapeprofiler med løbsidentitet (PRIVAT, hard rule 17)`, "");
  L.push(`Genereret ${r.generatedAt} · sæson ${r.season} · ${r.races} løb · ${r.rowCount} profilrækker · ${r.racesToWrite} løb ændres, ${r.unchanged} uændrede`);
  L.push(`Plan-hash: \`${r.planHash}\` · identitet fra ${r.identitySource}`, "");
  L.push("## Invarianter (fail-closed)", "");
  for (const c of r.invariants.checks) L.push(`- ${mark(c.ok)} ${c.name} (${c.detail})`);
  L.push("", "## Benchmark-gaten (1-4), før → efter", "");
  for (const k of ["stages", "grandTours", "season", "motor"]) {
    const b = r.gate.before.parts[k];
    const a = r.gate.after.parts[k];
    L.push(`- (${k}) ${mark(b.green)} ${b.violations} brud → ${mark(a.green)} ${a.violations} brud${a.stub ? " (motor-stub, blokerer ikke)" : ""}`);
  }
  if (gateLines.length) L.push("", "```", ...gateLines, "```");
  for (const d of r.divisions) {
    L.push("", `## Division ${d.tier} (${d.pools} puljer, ${d.races} løb, ${d.stageRaces} etapeløb, gen-træk ${d.seasonVariant}${d.drawExhausted ? ", UDTØMT" : ""})`, "");
    L.push(`### Etapeløb pr. type mod tabel A ${mark(d.identity.ok)}`, "", "| Type | Tabel A | Tildelt |", "|---|---:|---:|");
    for (const x of d.identity.rows) L.push(`| ${x.type} | ${x.want} | ${x.got} ${x.ok ? "" : "❌"} |`);
    L.push(`| uden type | 0 | ${d.identity.untyped} ${d.identity.untyped ? "❌" : ""} |`);
    if (d.gtPreludes.length) {
      L.push("", "GT-optakter:");
      for (const g of d.gtPreludes) L.push(`- ${mark(g.ok)} ${g.gt}: nærmeste korte etapeløb før = ${g.prelude ?? "-"} (${g.type ?? "uden type"})`);
    }
    const tb = d.terrain.before;
    const ta = d.terrain.after;
    L.push("", "### Brosten / ITT / højbjerg (etaper), før → efter", "", "| | Før | Efter |", "|---|---:|---:|");
    for (const k of ["cobbles", "gravel", "itt", "high_mountain"]) L.push(`| ${k} | ${tb[k]} (${fmtPct(pct(tb[k], tb.stages))}) | ${ta[k]} (${fmtPct(pct(ta[k], ta.stages))}) |`);
    L.push(`| etaper i alt | ${tb.stages} | ${ta.stages} |`);
    L.push("", "§6b-målene (brosten inkl. grus, ITT, højbjerg):");
    for (const u of d.uniform.after) {
      const b = d.uniform.before.find((x) => x.category === u.category);
      L.push(`- ${mark(u.pass)} ${u.category}: ${fmtPct(b?.actual ?? 0)} → ${fmtPct(u.actual)} (mål ${fmtPct(u.target)} ±${u.tolerance} pp)`);
    }
    L.push("", `### Bjergfrie etapeløb: ${d.mountainFree.before} → ${d.mountainFree.after} (gulv ${d.mountainFree.min ?? "-"}) ${mark(d.mountainFree.min == null || d.mountainFree.after >= d.mountainFree.min)}`);
    for (const b of d.mountainFree.broken) L.push(`- ❌ bjergfri type med bjerg-etape: ${b}`);
    L.push("", `### §5-gulve ${mark(d.floors.violationsAfter.length === 0)}`, "", "| Familie | Gulv | Loft | Før | Efter |", "|---|---:|---:|---:|---:|");
    for (const f of Object.keys(d.floors.familyAfter)) L.push(`| ${f} | ${d.floors.min[f] ?? "-"} | ${d.floors.max[f] ?? "-"} | ${d.floors.familyBefore[f] ?? 0} | ${d.floors.familyAfter[f] ?? 0} |`);
    for (const v of d.floors.violationsAfter) L.push(`- ❌ ${v}`);
    if (d.monuments.length) {
      L.push("", "### Monument-ruter", "", "| Løb | Håndskrevet | Følger den | Km før → efter | Hm før → efter | Sektorer (km) efter | Sidste top efter |", "|---|---|---|---|---|---|---|");
      for (const m of d.monuments) {
        const a = m.after ?? {};
        const b = m.before ?? {};
        const top = a.last_top ? `${a.last_top.name} (kat. ${a.last_top.category}, ${a.last_top.km_to_finish} km før mål)` : "-";
        L.push(`| ${m.name} | ${m.authored ? "ja" : "nej"} | ${m.matchesAuthored == null ? "-" : mark(m.matchesAuthored)} | ${b.distance_km ?? "-"} → ${a.distance_km ?? "-"} | ${b.elevation_gain_m ?? "-"} → ${a.elevation_gain_m ?? "-"} | ${a.sectors ?? 0} (${a.sector_km ?? 0}) | ${top} |`);
      }
    }
    if (d.pins.length) {
      L.push("", "### Signatur-pins", "");
      for (const p of d.pins) L.push(`- ${mark(p.pinned)} ${p.race}: ${p.kind}${p.name ? ` "${p.name}"` : ""} (${p.stage_hint})${p.stage ? ` → etape ${p.stage}` : ""}`);
    }
  }
  return `${L.join("\n")}\n`;
}

function publicMarkdown(r) {
  const L = [];
  L.push(`# #6929 tørkørsel: S5-etapeprofiler med løbsidentitet (offentlig udgave)`, "");
  L.push("Kvalitativ udgave (hard rule 17): kun domme og ejerens tabel A. Tallene, løbsnavnene og ruterne ligger i den private rapport i `balance-internals/6857/`.", "");
  L.push(`Genereret ${r.generatedAt} · sæson ${r.season} · ${r.races} løb · ${r.racesToWrite} løb ville blive skrevet om · plan-hash \`${r.planHash.slice(0, 12)}…\` · identitet fra ${r.identitySource}`, "");
  L.push("## Invarianter", "");
  for (const c of r.invariants) L.push(`- ${mark(c.ok)} ${c.name}`);
  L.push("", "## Benchmark-gaten (1-4)", "", "| Del | Før | Efter |", "|---|---|---|");
  for (const k of ["stages", "grandTours", "season", "motor"]) L.push(`| ${k} | ${mark(r.gate.before.parts[k])} | ${mark(r.gate.after.parts[k])} |`);
  L.push("", "## Pr. division", "", "| Div | Tabel A | GT-optakter | Brosten/ITT/højbjerg (§6b) | Bjergfrie etapeløb | §5-gulve | Monumenter håndskrevet | Signatur-pins |", "|---|---|---|---|---|---|---|---|");
  for (const d of r.divisions) {
    const uni = d.uniformAfterOk.map((u) => `${u.category} ${mark(u.pass)}`).join(" · ");
    L.push(`| D${d.tier} | ${mark(d.identity.ok)} | ${d.tier === 1 ? mark(d.gtPreludesOk) : "-"} | ${uni} | ${mark(d.mountainFreeOk)} | ${mark(d.floorsOk)} | ${d.monuments.followAuthored}/${d.monuments.count} | ${d.pins.pinned}/${d.pins.features} |`);
  }
  L.push("", "### Tabel A (ejer 18/10) mod tildelt", "");
  for (const d of r.divisions) L.push(`- D${d.tier}: ${d.identity.rows.map((x) => `${x.type} ${x.got}/${x.want}`).join(" · ")}${d.identity.untyped ? ` · uden type ${d.identity.untyped}` : ""}`);
  return `${L.join("\n")}\n`;
}

// ── main ──────────────────────────────────────────────────────────────────────────────

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(2);
  }
  const dotenv = await import("dotenv");
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("❌ Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY (kør via infisical run --env=prod)");
    process.exit(2);
  }
  const { createClient } = await import("@supabase/supabase-js");
  const raw = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  const now = new Date();
  const generatedAt = now.toISOString();
  const day = copenhagenDate(now);
  const privateDir = assertPrivatePath(opts.privateDir ?? join(REPO_ROOT, "balance-internals", "6857", day), "--private-dir");
  const publicDir = resolve(opts.publicDir ?? PUBLIC_DIR_DEFAULT);
  const log = (...a) => console.log(...a);

  log(`=== #6929 regen af S5's etapeprofiler — ${opts.apply ? "APPLY" : "DRY-RUN (read-only)"} ===`);
  const db = createSupabaseRegenDb(opts.apply ? raw : createReadOnlyClient(raw));
  const input = await loadRegenInput(db, opts.season);
  log(`Sæson ${input.season.number} (${input.season.status}): ${input.races.length} seniorløb · ${input.profiles.length} profilrækker · ${input.claims.length} claims`);

  let identitySource = "race_pool (prod)";
  if (opts.identityFile) {
    const doc = JSON.parse(readFileSync(resolve(opts.identityFile), "utf8"));
    const overlay = overlayIdentity(input.catalog, doc);
    input.catalog = overlay.catalog;
    identitySource = `${opts.identityFile} lagt oven på race_pool (${overlay.applied} af ${overlay.entries} rækker ramte S5; IKKE anvendt i prod)`;
    log(`Identitet: ${identitySource}`);
  }
  const benchmark = loadS5Benchmark();
  const motor = loadMotorGapFile(opts.motorBench ?? DEFAULT_MOTOR_STUB_PATH);
  const plan = buildRegenPlan(input, { evaluateGate: makeGateEvaluator({ benchmark, motor }), log });
  const invariants = checkInvariants({ input, plan, now, allowActive: opts.allowActive, seasonNumber: opts.season });
  const diff = diffAgainstCurrent(plan, input.profiles);
  const gateLines = formatS5BenchmarkReport(plan.gate.after);
  for (const line of gateLines) log(line);
  for (const c of invariants.checks) log(`${mark(c.ok)} ${c.name} (${c.detail})`);
  log(`Plan: ${plan.rowCount} rækker · ${diff.racesToWrite.length} løb ændres · ${diff.unchanged.length} uændrede · plan-hash ${plan.planHash}`);

  mkdirSync(privateDir, { recursive: true });
  mkdirSync(publicDir, { recursive: true });

  if (!opts.apply) {
    const report = buildReport({ input, plan, invariants, diff, generatedAt, gateLines, identitySource });
    const stamp = generatedAt.replace(/[:.]/g, "-");
    writeFileSync(join(privateDir, `regen-dry-run-${stamp}.md`), report.fullMarkdown, "utf8");
    writeFileSync(join(privateDir, `regen-dry-run-${stamp}.json`), `${JSON.stringify(report.full, null, 2)}\n`, "utf8");
    const table = `backup_6857_race_stage_profiles_${day.replace(/-/g, "")}`;
    writeFileSync(join(privateDir, "backup.sql"), buildBackupSql(table, input.season.id), "utf8");
    writeFileSync(join(privateDir, "restore.sql"), buildRestoreSql(table), "utf8");
    writeFileSync(join(publicDir, `dry-run-${day}.md`), report.publicMarkdown, "utf8");
    writeFileSync(join(publicDir, `dry-run-${day}.json`), `${JSON.stringify(report.public, null, 2)}\n`, "utf8");
    if (opts.routesOut) {
      const out = writeRoutesDir(opts.routesOut, buildRoutesFiles({ plan, seasonNumber: opts.season, label: opts.label, generatedAt }));
      log(`Ruter (${ROUTES_FORMAT}): ${plan.rowsByRaceId.size} løb → ${out}`);
    }
    log(`Privat rapport + backup.sql/restore.sql: ${privateDir}`);
    log(`Offentlig rapport: ${join(publicDir, `dry-run-${day}.md`)}`);
    log(`Apply (ejer-go pr. skridt; kør backup.sql først):`);
    log(`  infisical run --env=prod --silent -- node backend/scripts/regenS5StageProfiles.mjs --apply --season 5 --confirm-season-upcoming --backup-table=${table} --plan-hash=${plan.planHash}${day >= CUTOVER_DATE_CPH ? " --allow-active" : ""}`);
    process.exitCode = invariants.ok ? 0 : 1;
    return;
  }

  // ── APPLY ──
  if (!invariants.ok) throw new Error(`invarianter brudt, intet skrevet: ${invariants.violations.join(" · ")}`);
  if (plan.planHash !== opts.planHash) throw new Error(`plan-hashen er ${plan.planHash}, ikke ${opts.planHash}: noget har flyttet sig siden dry-runnet. Kør dry-runnet igen. Intet skrevet.`);
  if (!diff.racesToWrite.length) log("Intet at skrive: alle løb har allerede planens rækker (idempotent).");
  const touched = new Set(diff.racesToWrite);
  const currentIds = input.profiles.filter((p) => touched.has(p.race_id)).map((p) => p.id);
  await assertBackupCovers(db, opts.backupTable, currentIds);
  const stamp = generatedAt.replace(/[:.]/g, "-");
  const snapshotRows = input.profiles.slice().sort((a, b) => compareIds(a.race_id, b.race_id) || byStage(a, b));
  writeFileSync(join(privateDir, `pre-apply-snapshot-${stamp}.json`), `${JSON.stringify({ takenAt: generatedAt, rows: snapshotRows })}\n`, "utf8");
  writeFileSync(join(publicDir, `pre-apply-${stamp}.json`), `${JSON.stringify({
    issue: "#6929", takenAt: generatedAt, season: input.season.number, races: input.races.length, rows: snapshotRows.length,
    rowsSha256: sha256(canonicalJson(snapshotRows)), backupTable: opts.backupTable, planHash: plan.planHash, racesToWrite: diff.racesToWrite.length,
  }, null, 2)}\n`, "utf8");
  const applied = await applyPlan({ db, plan, racesToWrite: diff.racesToWrite, log });
  log(`Skrevet: ${applied.racesWritten} løb · ${applied.rowsWritten} rækker · ${applied.batches} batches`);
  const verify = await postVerify({
    db, plan, races: input.races, divisions: input.divisions,
    runDivergenceScript: () => {
      const res = spawnSync(process.execPath, ["scripts/checkStageProfileSeedDivergence.js", "--season", String(opts.season)], { cwd: join(REPO_ROOT, "backend"), encoding: "utf8", env: process.env });
      return `${res.stdout ?? ""}\n${res.stderr ?? ""}`;
    },
  });
  for (const c of verify.checks) log(`${mark(c.ok)} post-verify: ${c.name} (${c.detail})`);
  if (!opts.skipCacheWait) {
    const cache = await waitForCalendarCache({ lastWriteAt: applied.lastWriteAt });
    log(`calendar-cachen (TTL ${CALENDAR_CACHE_TTL_MS / 1000} s) er tom${cache.emptyAt ? ` fra ${cache.emptyAt.toISOString()}` : ""}`);
  }
  if (!verify.ok) {
    console.error(`❌ post-verify fejlede. Rul tilbage med ${join(privateDir, "restore.sql")} (ejer-gated).`);
    process.exitCode = 1;
  }
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
