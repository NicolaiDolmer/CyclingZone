#!/usr/bin/env node
// backend/scripts/s5FlatStageA2_2757.js
//
// #2757 A2 (ejer-beslutning 24/10): de S5-etapeløb der ingen flad etape har, får én. Placeringen
// varierer fra løb til løb (deterministisk pr. løb), på en bakket/kuperet etape, aldrig på
// signatur-etapen (#6857) og aldrig ved en topankomst. Etapen bliver en rigtig flad etape: ny
// rute (distance, højdemeter, stigninger, spurter, segmenter, vejr, højdeprofil) fra samme
// generator-funktioner som rutegeneratoren selv bruger (raceStageProfileGenerator.chooseA2FlatStage
// + buildA2FlatStage), så skrevne S5-ruter og fremtidige kalendere følger samme regel.
//
// DRY-RUN ER STANDARD (kun SELECT, klienten kaster ved enhver skrivning). Dry-runnet:
//   1. læser S5's seniorløb, divisioner, race_pool (identitet/signatur), etapeprofiler,
//      race_stage_schedule og race_stage_claims (eller et snapshot med --input, se nedenfor);
//   2. vælger etapen og bygger den nye flade etape for hvert etapeløb uden flad etape;
//   3. kører gaterne: terræn-dækning (§5-gulve, rolling-båndet, §6b) før/efter pr. division,
//      placerings-gaterne (calendarPlacementGates: monument i GT, mindste-overlap, GT-start),
//      benchmark-gatens etape-tjek på hver ny etape og CI-gaten calendarInvariantsCiGate4123;
//   4. skriver en før/efter-rapport (md + json), ét PNG-billede af alle løbene, backup.sql og
//      restore.sql til balance-internals/2757-a2/ (gitignoreret, hard rule 17).
//
// --apply (FØRST efter ejerens godkendelse af billedet) kræver --apply --owner-go
// --backup-table=backup_2757_race_stage_profiles_YYYYMMDD --plan-hash=<dry-runnets hash>. Apply
// genlæser prod, kræver samme plan-hash, at backup-tabellen (med RLS) dækker hver etape-plads der
// skrives, og at ingen af løbene er startet. Den opdaterer kun den valgte etape pr. løb (UPDATE på
// (race_id, stage_number), samme række-id) og post-verificerer. Idempotent: en etape der allerede
// er planen, springes over.
//
//   infisical run --env=prod --silent -- node backend/scripts/s5FlatStageA2_2757.js [--out=...]
//   node backend/scripts/s5FlatStageA2_2757.js --input=balance-internals/2757-a2/input.json
//
// --input: et read-only snapshot (format cz-2757-a2-input/v1) i stedet for prod, til når prod kun
// kan læses med SELECT uden for scriptet. Snapshottet må være kompakt: et løb kan bære
// `profile_types` ("flat,hilly,...") i stedet for profilrækker, `route` (nøgle i `routes`, de
// detaljerede rækker for en rute der deles af divisionens puljer) og `game_days` + `first_date`
// i stedet for race_stage_schedule. Apply læser altid prod selv.
//
// Exit: 0 = grøn · 1 = blokerende fund eller fejlet post-verify · 2 = brugsfejl.

import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

import {
  chooseA2FlatStage, buildA2FlatStage, flatStagePositionBucket, A2_FLAT_POSITION_WEIGHTS, toStageProfileRow,
} from "../lib/raceStageProfileGenerator.js";
import {
  computeTierCoverageStats, detectCoverageViolations, detectTerrainBandViolations,
} from "../lib/tierCalendarGuarantees.js";
import { computeUniformTierStats, detectUniformTierViolations } from "../lib/calendarCompositionTargets.js";
import {
  detectMonumentsInsideGrandTours, computeGameDayOverlap, detectMinOverlapViolations, listGrandTourStarts,
  detectGrandTourEarlyStartViolations, TIER_OVERLAP_MIN,
} from "../lib/calendarPlacementGates.js";
import { checkStage } from "../lib/s5BenchmarkGate.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { onlySeniorSquadRows } from "../lib/squads.js";
import {
  createReadOnlyClient, canonicalJson, copenhagenDate, assertPrivatePath, seedRaceFor, DEFAULT_GUARANTEES,
} from "./regenS5StageProfiles.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, "..", "..");

export const TARGET_SEASON_NUMBER = 5;
export const INPUT_FORMAT = "cz-2757-a2-input/v1";
export const BACKUP_TABLE_PATTERN = /^backup_2757_race_stage_profiles_\d{8}$/;
export const DEFAULT_OUT_DIR = join(REPO_ROOT, "balance-internals", "2757-a2");
export const CI_GATE_TEST = join(REPO_ROOT, "backend", "lib", "calendarInvariantsCiGate4123.test.js");
/** Kolonnerne A2 skriver på den valgte etape (række-id, race_id, stage_number og is_manual røres ikke). */
export const A2_WRITE_COLUMNS = Object.freeze([
  "profile_type", "finale_type", "demand_vector", "generator_version", "distance_km", "elevation_gain_m",
  "climbs", "sprints", "sectors", "segments", "weather", "elevation_profile",
]);
export const RACE_COLUMNS = "id, name, race_type, race_class, stages, stages_completed, status, pool_race_id, league_division_id, engine_rules_revision, squad";
export const CATALOG_COLUMNS = "id, external_id, name, race_class, race_type, terrain_archetype, race_identity_type, signature";
export const PROFILE_READ_COLUMNS = "id, race_id, stage_number, profile_type, finale_type, distance_km, elevation_gain_m, climbs, sprints, sectors, generator_version, is_manual";
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const sha256 = (text) => createHash("sha256").update(text).digest("hex");
const byStage = (a, b) => Number(a.stage_number) - Number(b.stage_number);
function groupBy(rows, key) {
  const out = new Map();
  for (const r of rows) {
    const k = typeof key === "function" ? key(r) : r[key];
    if (!out.has(k)) out.set(k, []);
    out.get(k).push(r);
  }
  return out;
}

// ── Argumenter ────────────────────────────────────────────────────────────────────────

const VALUE_FLAGS = new Set(["season", "input", "out", "backup-table", "plan-hash", "playwright"]);
const BOOL_FLAGS = new Set(["apply", "owner-go", "no-png", "no-ci-gate"]);

/** @param {string[]} argv process.argv.slice(2) */
export function parseArgs(argv = []) {
  const o = { apply: false, ownerGo: false, noPng: false, noCiGate: false, season: TARGET_SEASON_NUMBER, input: null, out: null, backupTable: null, planHash: null, playwright: null };
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
    const value = eq >= 0 ? arg.slice(eq + 1) : argv[++i];
    if (value == null || value === "" || value.startsWith("--")) throw new Error(`--${name} kræver en værdi`);
    o[camel(name)] = value;
  }
  const n = Number(o.season);
  if (!Number.isInteger(n) || n !== TARGET_SEASON_NUMBER) throw new Error(`scriptet gælder kun sæson ${TARGET_SEASON_NUMBER} (fik ${o.season})`);
  o.season = n;
  if (o.apply) {
    if (!o.ownerGo) throw new Error("--apply kræver --owner-go (ejerens godkendelse af før/efter-billedet)");
    if (o.input) throw new Error("--apply læser altid prod selv; --input er kun til dry-run");
    if (!o.backupTable || !BACKUP_TABLE_PATTERN.test(o.backupTable)) throw new Error("--apply kræver --backup-table=backup_2757_race_stage_profiles_YYYYMMDD (oprettet med dry-runnets backup.sql)");
    if (!o.planHash || !/^[0-9a-f]{64}$/.test(o.planHash)) throw new Error("--apply kræver --plan-hash=<dry-runnets plan-hash>");
  } else {
    if (o.ownerGo) throw new Error("--owner-go hører kun til --apply");
    if (o.backupTable || o.planHash) throw new Error("--backup-table/--plan-hash hører kun til --apply");
  }
  return o;
}

// ── Læsning ───────────────────────────────────────────────────────────────────────────

/** Supabase-udgaven af scriptets database-interface (læsning + apply's to skrivninger). */
export function createSupabaseA2Db(supabase) {
  const must = (label, { data, error }) => {
    if (error) throw new Error(`${label}: ${error.message}`);
    return data;
  };
  return {
    async seasonByNumber(number) {
      return must("seasons", await supabase.from("seasons").select("id, number, status").eq("number", number).maybeSingle());
    },
    async divisions() {
      return fetchAllRows(() => supabase.from("league_divisions").select("id, tier, pool_index, squad, retired_at").order("id"));
    },
    async racesOfSeason(seasonId) {
      return onlySeniorSquadRows(await fetchAllRows(() => supabase.from("races").select(RACE_COLUMNS).eq("season_id", seasonId).order("id")));
    },
    async catalogRows(ids) {
      return fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("race_pool").select(CATALOG_COLUMNS).in("id", chunk).order("id"));
    },
    async profilesOf(raceIds) {
      return fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_profiles").select(PROFILE_READ_COLUMNS).in("race_id", chunk).order("id"));
    },
    async fullProfilesOf(raceIds) {
      return fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_profiles").select(`id, race_id, stage_number, is_manual, ${A2_WRITE_COLUMNS.join(", ")}`).in("race_id", chunk).order("id"));
    },
    async scheduleOf(raceIds) {
      return fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_schedule").select("race_id, stage_number, scheduled_at, game_day").in("race_id", chunk).order("race_id").order("stage_number"));
    },
    async claimsOf(raceIds) {
      return fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_claims").select("race_id, stage_index").in("race_id", chunk).order("race_id").order("stage_index"));
    },
    async backupSlots(table, raceIds) {
      if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`ugyldigt backup-navn: ${table}`);
      const rows = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from(table).select("race_id, stage_number").in("race_id", chunk).order("race_id").order("stage_number"));
      return new Set(rows.map((r) => `${r.race_id}|${r.stage_number}`));
    },
    async updateStage(raceId, stageNumber, content) {
      const rows = must("race_stage_profiles update", await supabase.from("race_stage_profiles").update(content).eq("race_id", raceId).eq("stage_number", stageNumber).select("id"));
      if (!Array.isArray(rows) || rows.length !== 1) throw new Error(`update ramte ${rows?.length ?? 0} rækker for ${raceId} etape ${stageNumber} (forventet 1)`);
    },
  };
}

/** Alt planen bygger på, læst i én omgang (kun SELECT). */
export async function loadA2Input(db, seasonNumber = TARGET_SEASON_NUMBER) {
  const season = await db.seasonByNumber(seasonNumber);
  if (!season) throw new Error(`sæson ${seasonNumber} findes ikke`);
  const divisions = await db.divisions();
  const races = await db.racesOfSeason(season.id);
  const raceIds = races.map((r) => r.id);
  const poolIds = [...new Set(races.map((r) => r.pool_race_id).filter((x) => x != null))].sort();
  const catalog = poolIds.length ? await db.catalogRows(poolIds) : [];
  const profiles = raceIds.length ? await db.profilesOf(raceIds) : [];
  const schedule = raceIds.length ? await db.scheduleOf(raceIds) : [];
  const claims = raceIds.length ? await db.claimsOf(raceIds) : [];
  return { source: "prod (SELECT)", season, divisions, races, catalog, profiles, schedule, claims };
}

/**
 * Et --input-snapshot udfoldet til loadA2Input's form. Fail-closed på format og referencer.
 * @param {any} doc
 */
export function expandSnapshot(doc) {
  if (doc?.format !== INPUT_FORMAT) throw new Error(`--input skal have format "${INPUT_FORMAT}"`);
  for (const k of ["season", "divisions", "races", "catalog"]) if (doc[k] == null) throw new Error(`--input mangler "${k}"`);
  const routes = doc.routes ?? {};
  const profiles = [...(doc.profiles ?? [])];
  const schedule = [...(doc.schedule ?? [])];
  const races = doc.races.map((r) => {
    const { profile_types: types, route, game_days: gameDays, first_date: firstDate, ...race } = r;
    if (route != null) {
      const rows = routes[route];
      if (!Array.isArray(rows)) throw new Error(`løb ${race.id}: ruten "${route}" findes ikke i routes`);
      for (const row of rows) profiles.push({ ...row, race_id: race.id });
    } else if (typeof types === "string") {
      types.split(",").forEach((t, i) => profiles.push({ race_id: race.id, stage_number: i + 1, profile_type: t.trim(), finale_type: null }));
    }
    if (Array.isArray(gameDays)) {
      gameDays.forEach((gd, i) => schedule.push({ race_id: race.id, stage_number: i + 1, game_day: gd, scheduled_at: i === 0 ? firstDate ?? null : null }));
    }
    return race;
  });
  for (const r of races) {
    const n = profiles.filter((p) => p.race_id === r.id).length;
    if (n && n !== Number(r.stages)) throw new Error(`løb ${r.id}: ${n} profiler, men stages = ${r.stages}`);
  }
  return {
    source: `snapshot ${doc.label ?? ""}`.trim(), season: doc.season, divisions: doc.divisions, races, catalog: doc.catalog,
    profiles, schedule, claims: doc.claims ?? [],
  };
}

// ── Planen ────────────────────────────────────────────────────────────────────────────

/** Indholdet A2 skriver (og sammenligner) for én etape. */
export function writeContent(row) {
  return Object.fromEntries(A2_WRITE_COLUMNS.map((c) => [c, row?.[c] ?? null]));
}

/**
 * Hvert S5-etapeløb uden flad etape: den valgte etape og den nye flade etape.
 * @param {Awaited<ReturnType<typeof loadA2Input>>} input
 */
export function buildA2Plan(input) {
  const { season, divisions, races, catalog, profiles } = input;
  const planErrors = [];
  const tierByDivision = new Map(divisions.map((d) => [d.id, d.tier]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const profilesByRace = groupBy(profiles, "race_id");
  for (const rows of profilesByRace.values()) rows.sort(byStage);

  const items = [];
  const unresolved = [];
  const byRoute = new Map();
  for (const race of races.filter((r) => r.race_type === "stage_race")) {
    const rows = profilesByRace.get(race.id) ?? [];
    if (!rows.length) { planErrors.push(`løb ${race.id} (${race.name}): ingen etapeprofiler`); continue; }
    if (rows.some((p) => p.profile_type === "flat")) continue;
    const cat = catalogById.get(race.pool_race_id);
    if (!cat) { planErrors.push(`løb ${race.id} (${race.name}): katalog-løbet ${race.pool_race_id} mangler`); continue; }
    const seed = seedRaceFor(race, cat, season.id, 0);
    const pick = chooseA2FlatStage(seed, rows);
    const tier = tierByDivision.get(race.league_division_id) ?? null;
    if (pick.stageNumber == null) { unresolved.push({ race_id: race.id, name: race.name, tier, reason: pick.reason }); continue; }
    const old = rows[pick.stageNumber - 1];
    const stage = buildA2FlatStage(seed, pick.stageNumber, { generatorVersion: old.generator_version ?? undefined });
    const content = writeContent(toStageProfileRow(race.id, stage));
    const item = {
      race_id: race.id, name: race.name, tier, league_division_id: race.league_division_id, pool_race_id: race.pool_race_id,
      stages: rows.length, stage_number: pick.stageNumber, candidates: pick.candidates,
      bucket: flatStagePositionBucket(pick.stageNumber - 1, rows.length),
      before: rows.map((p) => ({ stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, distance_km: p.distance_km ?? null, elevation_gain_m: p.elevation_gain_m ?? null })),
      old: { profile_type: old.profile_type, finale_type: old.finale_type, distance_km: old.distance_km ?? null, elevation_gain_m: old.elevation_gain_m ?? null, climbs: (old.climbs ?? []).length },
      content,
      benchmark: checkStage({ ...content, stage_number: pick.stageNumber }).violations,
    };
    // Divisionens puljer kører samme parcours (#2276): samme katalog-løb skal få samme etape.
    const key = `${tier}:${race.pool_race_id}`;
    const fp = sha256(canonicalJson({ stage: item.stage_number, content }));
    if (byRoute.has(key) && byRoute.get(key) !== fp) planErrors.push(`${race.name} (D${tier}): puljerne får ikke samme flade etape`);
    byRoute.set(key, fp);
    items.push(item);
  }
  items.sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name) || (a.league_division_id - b.league_division_id) || a.race_id.localeCompare(b.race_id));
  const planHash = sha256(canonicalJson(items.map((it) => ({ race_id: it.race_id, stage_number: it.stage_number, content: it.content }))));
  return { seasonId: season.id, items, unresolved, planErrors, planHash, routes: byRoute.size };
}

/** Profilerne efter planen (til gaterne og billedet). */
export function profilesAfter(input, plan) {
  const swap = new Map(plan.items.map((it) => [`${it.race_id}|${it.stage_number}`, it.content]));
  return input.profiles.map((p) => {
    const c = swap.get(`${p.race_id}|${p.stage_number}`);
    return c ? { ...p, ...c } : p;
  });
}

// ── Gaterne ───────────────────────────────────────────────────────────────────────────

/** Repræsentativ pulje pr. division (laveste id): puljerne deler kalender (#2276). */
export function representativeRaces(input) {
  const tierByDivision = new Map(input.divisions.map((d) => [d.id, d.tier]));
  const byTier = groupBy(input.races.filter((r) => tierByDivision.has(r.league_division_id)), (r) => tierByDivision.get(r.league_division_id));
  const out = new Map();
  for (const [tier, races] of byTier) {
    const rep = Math.min(...races.map((r) => Number(r.league_division_id)));
    out.set(tier, races.filter((r) => Number(r.league_division_id) === rep));
  }
  return new Map([...out.entries()].sort((a, b) => a[0] - b[0]));
}

/** §5-gulve, rolling-båndet og §6b for én division (samme gates som #6929's regen). */
export function coverageFor(tier, races, profiles, catalogById, guarantees = DEFAULT_GUARANTEES) {
  const byRace = groupBy(profiles, "race_id");
  const raceRows = races.map((r) => ({ pool_race_id: r.pool_race_id, race_type: r.race_type, stages: r.stages, race_class: r.race_class }));
  const profilesByPool = new Map(races.map((r) => [r.pool_race_id, (byRace.get(r.id) ?? []).slice().sort(byStage)]));
  const identity = new Map(races.map((r) => [r.pool_race_id, catalogById.get(r.pool_race_id)?.race_identity_type ?? null]));
  const stats = computeTierCoverageStats({ raceRows, profilesByPoolRaceId: profilesByPool, classStageLengthBand: guarantees.classStageLengthBand, identityTypeByPoolRaceId: identity });
  const violations = [
    ...detectCoverageViolations({ tier, stats, oneDayShareMin: guarantees.oneDayShareMin, terrainFamilyMin: guarantees.terrainFamilyMin, mountainFreeMin: guarantees.mountainFreeMin }),
    ...detectTerrainBandViolations({ tier, stats, terrainFamilyMin: guarantees.terrainFamilyMin, terrainFamilyMax: guarantees.terrainFamilyMax }),
  ];
  const uniform = computeUniformTierStats(raceRows.map((r) => ({ stages: profilesByPool.get(r.pool_race_id) ?? [] })));
  const uniformCheck = detectUniformTierViolations({ stats: uniform, label: `division ${tier}`, tolerancePp: guarantees.uniformTolerancePp });
  return { familyCounts: stats.familyCounts, mountainFreeStageRaces: stats.mountainFreeStageRaces, violations, uniformViolations: uniformCheck.violations };
}

/** calendarPlacementGates på divisionens planlagte kalender (A2 rører ingen datoer). */
export function placementFor(tier, races, schedule) {
  const poolOf = new Map(races.map((r) => [r.id, r.pool_race_id]));
  const stageRows = schedule.filter((s) => poolOf.has(s.race_id)).map((s) => ({ ...s, pool_race_id: poolOf.get(s.race_id) }));
  if (!stageRows.length) return { evaluated: false, violations: [] };
  const raceRows = races.map((r) => ({ pool_race_id: r.pool_race_id, race_type: r.race_type, stages: r.stages, race_class: r.race_class, name: r.name }));
  const overlap = computeGameDayOverlap({ stageRows, overlapMin: TIER_OVERLAP_MIN[tier] ?? null });
  const starts = listGrandTourStarts({ raceRows, stageRows });
  const dates = stageRows.map((s) => (s.scheduled_at == null ? null : String(s.scheduled_at).slice(0, 10))).filter(Boolean).sort();
  const violations = [
    ...detectMonumentsInsideGrandTours({ tier, raceRows, stageRows }),
    ...detectMinOverlapViolations({ tier, overlap }),
    ...detectGrandTourEarlyStartViolations({ tier, grandTourStarts: starts, seasonFirstDay: dates[0] ?? null }),
  ];
  return { evaluated: true, violations };
}

/** Placeringen af flade etaper i alle S5-etapeløb (én pr. division og katalog-løb). */
export function flatPositionDistribution(input, profiles) {
  const reps = representativeRaces(input);
  const byRace = groupBy(profiles, "race_id");
  const counts = Object.fromEntries(Object.keys(A2_FLAT_POSITION_WEIGHTS).map((k) => [k, 0]));
  for (const races of reps.values()) {
    for (const r of races.filter((x) => x.race_type === "stage_race")) {
      const rows = (byRace.get(r.id) ?? []).slice().sort(byStage);
      rows.forEach((p, i) => { if (p.profile_type === "flat") counts[flatStagePositionBucket(i, rows.length)] += 1; });
    }
  }
  return counts;
}

/** CI-gaten #4123 (kalender-invarianterne på generatorens output) som child-proces. */
export function runCiGate(file = CI_GATE_TEST) {
  const res = spawnSync(process.execPath, ["--test", file], { encoding: "utf8", cwd: REPO_ROOT });
  const text = `${res.stdout ?? ""}${res.stderr ?? ""}`;
  const num = (label) => Number((text.match(new RegExp(`ℹ ${label} (\\d+)`)) ?? [])[1] ?? Number.NaN);
  return { ok: res.status === 0, pass: num("pass"), fail: num("fail"), skipped: num("skipped") };
}

/**
 * Alle gaterne. Blokerende: planfejl, en ny etape med benchmark-brud, et NYT dækningsbrud
 * (brud der fandtes før A2, står i rapporten men blokerer ikke A2), placerings-brud, CI-gaten,
 * og løbstilstand (startet, claims, bundet motor-revision, håndredigerede rækker).
 */
export function evaluateGates({ input, plan, ciGate = null }) {
  const catalogById = new Map(input.catalog.map((c) => [c.id, c]));
  const after = profilesAfter(input, plan);
  const tiers = [];
  for (const [tier, races] of representativeRaces(input)) {
    const before = coverageFor(tier, races, input.profiles, catalogById);
    const aft = coverageFor(tier, races, after, catalogById);
    const known = new Set([...before.violations, ...before.uniformViolations]);
    const added = [...aft.violations, ...aft.uniformViolations].filter((v) => !known.has(v));
    tiers.push({ tier, before, after: aft, newViolations: added, placement: placementFor(tier, races, input.schedule ?? []) });
  }
  const affectedIds = new Set(plan.items.map((it) => it.race_id));
  const affectedRaces = input.races.filter((r) => affectedIds.has(r.id));
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });
  add("sæsonen er S5", input.season?.number === TARGET_SEASON_NUMBER, `sæson ${input.season?.number}`);
  add("planen kunne bygges", plan.planErrors.length === 0, plan.planErrors.slice(0, 5).join(" · "));
  add("alle etapeløb uden flad etape har en lovlig etape", plan.unresolved.length === 0, plan.unresolved.map((u) => `${u.name} (${u.reason})`).join(" · "));
  const bench = plan.items.filter((it) => it.benchmark.length);
  add("benchmark-gatens etape-tjek på hver ny flad etape", bench.length === 0, bench.map((it) => `${it.name} e${it.stage_number}: ${it.benchmark.join("; ")}`).join(" · "));
  const added = tiers.flatMap((t) => t.newViolations);
  add("ingen nye brud på §5-gulve, rolling-båndet eller §6b", added.length === 0, added.join(" · "));
  const placement = tiers.flatMap((t) => t.placement.violations);
  add("placerings-gaterne (calendarPlacementGates) grønne", placement.length === 0, placement.join(" · ") || `${tiers.filter((t) => t.placement.evaluated).length} divisioner tjekket`);
  if (ciGate) add("CI-gaten calendarInvariantsCiGate4123", ciGate.ok, `${ciGate.pass} pass, ${ciGate.fail} fail, ${ciGate.skipped} skip`);
  const started = affectedRaces.filter((r) => Number(r.stages_completed ?? 0) !== 0);
  add("ingen af løbene er startet (stages_completed = 0)", started.length === 0, `${started.length} løb`);
  const claims = (input.claims ?? []).filter((c) => affectedIds.has(c.race_id));
  add("0 claims på løbene (race_stage_claims)", claims.length === 0, `${claims.length} claims`);
  const bound = affectedRaces.filter((r) => r.engine_rules_revision != null);
  add("engine_rules_revision IS NULL på løbene", bound.length === 0, `${bound.length} løb bundet`);
  const manual = input.profiles.filter((p) => affectedIds.has(p.race_id) && p.is_manual === true);
  add("ingen håndredigerede (is_manual) profiler på løbene", manual.length === 0, `${manual.length} rækker`);
  const violations = checks.filter((c) => !c.ok).map((c) => `${c.name}: ${c.detail}`);
  return {
    ok: violations.length === 0, violations, checks, tiers,
    positions: { before: flatPositionDistribution(input, input.profiles), after: flatPositionDistribution(input, after), realWorld: { ...A2_FLAT_POSITION_WEIGHTS } },
  };
}

// ── Backup, restore og apply ──────────────────────────────────────────────────────────

function assertUuid(value, label) {
  if (!UUID_RE.test(String(value))) throw new Error(`${label} er ikke et uuid: ${value}`);
}
function slotList(items) {
  return items.map((it) => {
    assertUuid(it.race_id, "race_id");
    if (!Number.isInteger(it.stage_number) || it.stage_number < 1) throw new Error(`ugyldigt etapenummer ${it.stage_number}`);
    return `('${it.race_id}'::uuid, ${it.stage_number})`;
  }).join(",\n    ");
}

/** backup.sql: kopi af de etape-pladser A2 skriver, i en tabel med RLS. Idempotent. */
export function buildBackupSql(table, items) {
  if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`ugyldigt backup-navn: ${table}`);
  if (!items.length) throw new Error("ingen etaper at tage backup af");
  return `-- #2757 A2: backup af de etape-pladser A2 skriver, FØR apply. Idempotent.
-- data-api-access: {"table":"public.${table}","roles":{"anon":[],"authenticated":[],"service_role":["SELECT"]},"reason":"Backend-only ops backup; s5FlatStageA2_2757 --apply reads it to prove coverage"}
begin;
create table if not exists public.${table} as
  select *, now() as snapshot_at from public.race_stage_profiles where false;
alter table public.${table} enable row level security;
-- RLS erstatter ikke grants (docs/DATA_API_GRANTS.md): kun service_role må læse.
revoke all on table public.${table} from public, anon, authenticated, service_role;
grant select on table public.${table} to service_role;
create unique index if not exists ${table}_slot on public.${table}(race_id, stage_number);
insert into public.${table}
  select p.*, now() from public.race_stage_profiles p
   where (p.race_id, p.stage_number) in (
    ${slotList(items)}
   )
on conflict (race_id, stage_number) do nothing;
commit;
notify pgrst, 'reload schema';
-- Verificér: select count(*) from public.${table}; (skal være ${items.length})
`;
}

/** restore.sql: læg de backede etaper tilbage på samme plads (samme række-id). Ejer-gated. */
export function buildRestoreSql(table, items) {
  if (!BACKUP_TABLE_PATTERN.test(table)) throw new Error(`ugyldigt backup-navn: ${table}`);
  const set = A2_WRITE_COLUMNS.map((c) => `${c} = b.${c}`).join(",\n       ");
  return `-- #2757 A2: restore af de etaper A2 skrev, fra ${table}. Ejer-gated.
begin;
update public.race_stage_profiles p
   set ${set}
  from public.${table} b
 where p.race_id = b.race_id and p.stage_number = b.stage_number
   and (p.race_id, p.stage_number) in (
    ${slotList(items)}
   );
commit;
`;
}

/** Hvilke etaper skal skrives? En etape der allerede er planen, springes over (idempotent). */
export function diffAgainstCurrent(plan, currentRows) {
  const cur = new Map(currentRows.map((r) => [`${r.race_id}|${r.stage_number}`, r]));
  const toWrite = [];
  const done = [];
  for (const it of plan.items) {
    const row = cur.get(`${it.race_id}|${it.stage_number}`);
    if (row && canonicalJson(writeContent(row)) === canonicalJson(it.content)) done.push(it);
    else toWrite.push(it);
  }
  return { toWrite, done };
}

/** UPDATE pr. etape; backuppen skal dække hver plads først. */
export async function applyPlan({ db, plan, backupTable, log = () => {} }) {
  const ids = [...new Set(plan.items.map((it) => it.race_id))];
  const current = ids.length ? await db.fullProfilesOf(ids) : [];
  const { toWrite, done } = diffAgainstCurrent(plan, current);
  if (done.length) log(`${done.length} etaper er allerede planen (springes over)`);
  if (!toWrite.length) return { written: 0, skipped: done.length };
  const covered = await db.backupSlots(backupTable, [...new Set(toWrite.map((it) => it.race_id))]);
  const missing = toWrite.filter((it) => !covered.has(`${it.race_id}|${it.stage_number}`));
  if (missing.length) throw new Error(`backuppen ${backupTable} mangler ${missing.length} af ${toWrite.length} etape-pladser. Kør backup.sql først. Intet skrevet.`);
  for (const it of toWrite) {
    await db.updateStage(it.race_id, it.stage_number, it.content);
    log(`  ✓ ${it.name} (D${it.tier}) etape ${it.stage_number}: ${it.old.profile_type} → flat`);
  }
  return { written: toWrite.length, skipped: done.length };
}

/** Post-verify: hver plads er planen, og hvert løb har nu en flad etape. */
export async function postVerify({ db, plan }) {
  const ids = [...new Set(plan.items.map((it) => it.race_id))];
  const rows = ids.length ? await db.fullProfilesOf(ids) : [];
  const { toWrite } = diffAgainstCurrent(plan, rows);
  const byRace = groupBy(rows, "race_id");
  const noFlat = ids.filter((id) => !(byRace.get(id) ?? []).some((r) => r.profile_type === "flat"));
  return { ok: toWrite.length === 0 && noFlat.length === 0, mismatched: toWrite.length, noFlat: noFlat.length };
}

// ── Rapport og billede ────────────────────────────────────────────────────────────────

const mark = (ok) => (ok ? "✅" : "❌");
const TYPE_COLORS = Object.freeze({
  flat: "#2f9e44", rolling: "#94d82d", hilly: "#fab005", medium_mountain: "#f76707", mountain: "#e03131",
  high_mountain: "#862e9c", itt: "#1c7ed6", itt_hilly: "#1864ab", ttt: "#4dabf7", cobbles: "#868e96", gravel: "#a9805b", classic: "#e599f7",
});
const TYPE_LABELS = Object.freeze({
  flat: "Flad", rolling: "Bakket", hilly: "Kuperet", medium_mountain: "Mellembjerg", mountain: "Bjerg", high_mountain: "Højbjerg",
  itt: "Enkeltstart", itt_hilly: "Kuperet enkeltstart", ttt: "Holdtidskørsel", cobbles: "Brosten", gravel: "Grus", classic: "Klassiker",
});
const esc = (s) => String(s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;" }[c]));

/** Billedet: alle løbene, etaperne før og efter, farvekodet efter etapetype. */
export function renderA2Html({ plan, gates, generatedAt }) {
  const poolIndex = new Map();
  for (const it of plan.items) {
    const key = `${it.tier}:${it.pool_race_id}`;
    if (!poolIndex.has(key)) poolIndex.set(key, []);
    if (!poolIndex.get(key).includes(it.league_division_id)) poolIndex.get(key).push(it.league_division_id);
  }
  const cell = (p, changed) => `<td class="st${changed ? " ch" : ""}" style="background:${TYPE_COLORS[p.profile_type] ?? "#ced4da"}" title="${esc(p.profile_type)} / ${esc(p.finale_type)}">${p.stage_number}</td>`;
  const maxStages = Math.max(1, ...plan.items.map((it) => it.stages));
  const pad = (n) => "<td class=\"pad\"></td>".repeat(Math.max(0, maxStages - n));
  const rows = plan.items.map((it) => {
    const pools = (poolIndex.get(`${it.tier}:${it.pool_race_id}`) ?? []).slice().sort((a, b) => a - b);
    const pool = pools.length > 1 ? ` · pulje ${pools.indexOf(it.league_division_id) + 1}/${pools.length}` : "";
    const after = it.before.map((p) => (p.stage_number === it.stage_number ? { ...p, profile_type: "flat", finale_type: it.content.finale_type } : p));
    return `<tr><td class="name" rowspan="2">${esc(it.name)}<div class="sub">D${it.tier}${pool} · etape ${it.stage_number} af ${it.stages}</div></td><td class="lbl">Før</td>${it.before.map((p) => cell(p, false)).join("")}${pad(it.stages)}</tr>`
      + `<tr class="aft"><td class="lbl">Efter</td>${after.map((p) => cell(p, p.stage_number === it.stage_number)).join("")}${pad(it.stages)}</tr>`;
  }).join("\n");
  const used = [...new Set(plan.items.flatMap((it) => it.before.map((p) => p.profile_type)).concat("flat"))];
  const legend = used.map((t) => `<span class="lg"><i style="background:${TYPE_COLORS[t] ?? "#ced4da"}"></i>${esc(TYPE_LABELS[t] ?? t)}</span>`).join("");
  const gateLine = gates ? `${mark(gates.ok)} gaterne ${gates.ok ? "grønne" : "røde"} · ${gates.checks.filter((c) => c.ok).length}/${gates.checks.length} tjek` : "";
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>A2 flad etape S5</title><style>
body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#212529;background:#fff}
h1{font-size:20px;margin:0 0 4px}p.meta{margin:0 0 14px;color:#495057;font-size:13px}
table{border-collapse:separate;border-spacing:3px}td{font-size:12px}
td.name{font-weight:600;padding:4px 10px 4px 0;vertical-align:middle;border-top:1px solid #dee2e6;min-width:230px}
td.name .sub{font-weight:400;color:#6c757d;font-size:11px}
td.lbl{color:#6c757d;padding-right:6px;font-size:11px}
td.st{width:30px;height:20px;text-align:center;color:#fff;font-weight:600;border-radius:4px;font-variant-numeric:tabular-nums;text-shadow:0 0 2px rgba(0,0,0,.45)}
td.st.ch{outline:3px solid #212529;outline-offset:-1px}td.pad{width:30px}
.lg{display:inline-flex;align-items:center;margin-right:14px;font-size:12px}.lg i{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:5px}
</style></head><body>
<h1>#2757 A2: én flad etape i S5-etapeløbene uden flad etape</h1>
<p class="meta">${plan.items.length} løb (${plan.routes} ruter) · den nye flade etape har sort kant · ${esc(gateLine)} · plan-hash ${plan.planHash.slice(0, 12)} · ${esc(generatedAt)}</p>
<p class="meta">${legend}</p>
<table>${rows}</table>
</body></html>`;
}

/** Den private markdown-rapport (navne og tal, hard rule 17). */
export function renderA2Markdown({ input, plan, gates, generatedAt }) {
  const lines = [];
  lines.push(`# #2757 A2: flad etape i S5-etapeløb uden flad etape (dry-run)`, "");
  lines.push(`Kilde: ${input.source} · genereret ${generatedAt} · plan-hash \`${plan.planHash}\``, "");
  lines.push(`**${plan.items.length} løb** (${plan.routes} ruter, puljerne deler parcours) får én flad etape. ${plan.unresolved.length} løb uden lovlig etape.`, "");
  lines.push("## Gaterne", "");
  for (const c of gates.checks) lines.push(`- ${mark(c.ok)} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  lines.push("", "## Dækning pr. division (repræsentativ pulje), før → efter", "");
  lines.push("| Division | flad | bakket | kuperet | bjerg | enkeltstart | brosten | bjergfri etapeløb | brud før | brud efter | nye brud | placering |");
  lines.push("|---|---|---|---|---|---|---|---|---|---|---|---|");
  for (const t of gates.tiers) {
    const f = (k) => `${t.before.familyCounts[k] ?? 0} → ${t.after.familyCounts[k] ?? 0}`;
    const nb = t.before.violations.length + t.before.uniformViolations.length;
    const na = t.after.violations.length + t.after.uniformViolations.length;
    lines.push(`| D${t.tier} | ${f("flat_sprint")} | ${f("rolling")} | ${f("hilly")} | ${f("mountain")} | ${f("itt")} | ${f("cobbles")} | ${t.before.mountainFreeStageRaces} → ${t.after.mountainFreeStageRaces} | ${nb} | ${na} | ${t.newViolations.length} | ${t.placement.evaluated ? mark(!t.placement.violations.length) : "ikke målt"} |`);
  }
  const known = gates.tiers.flatMap((t) => [...t.before.violations, ...t.before.uniformViolations]);
  if (known.length) { lines.push("", "Brud der fandtes før A2 (uændrede, blokerer ikke A2):", ""); for (const v of known) lines.push(`- ${v}`); }
  lines.push("", "## Placering af flade etaper i S5-etapeløbene (én pr. division og løb)", "");
  lines.push("| Placering | virkeligheden (en-uges WT 2024-26) | S5 før | S5 efter |", "|---|---|---|---|");
  const rw = gates.positions.realWorld;
  const tot = (o) => Object.values(o).reduce((s, x) => s + x, 0) || 1;
  for (const k of Object.keys(rw)) {
    const pct = (o) => `${o[k]} (${((100 * o[k]) / tot(o)).toFixed(0)} %)`;
    lines.push(`| ${k} | ${pct(rw)} | ${pct(gates.positions.before)} | ${pct(gates.positions.after)} |`);
  }
  lines.push("", "## Løbene", "", "| Løb | Div | Pulje | Etape | Før (type/afslutning, km, hm) | Efter (km, hm, stigninger, afslutning) | Kandidater |", "|---|---|---|---|---|---|---|");
  for (const it of plan.items) {
    const c = it.content;
    lines.push(`| ${it.name} | D${it.tier} | ${it.league_division_id} | ${it.stage_number}/${it.stages} (${it.bucket}) | ${it.old.profile_type}/${it.old.finale_type}, ${it.old.distance_km ?? "-"} km, ${it.old.elevation_gain_m ?? "-"} hm, ${it.old.climbs} stign. | flat, ${c.distance_km} km, ${c.elevation_gain_m} hm, ${(c.climbs ?? []).length} stign., ${c.finale_type} | ${it.candidates.join(", ")} |`);
  }
  if (plan.unresolved.length) { lines.push("", "## Uden lovlig etape", ""); for (const u of plan.unresolved) lines.push(`- ${u.name} (D${u.tier}): ${u.reason}`); }
  lines.push("", "Etapen vælges deterministisk pr. katalog-løb (generatorens chooseA2FlatStage), vægtet efter flade etapers placering i rigtige en-uges-løb. Ruten bygges af buildA2FlatStage (sæson-variant 0).");
  return `${lines.join("\n")}\n`;
}

/** PNG via Playwright (best-effort; samme mønster som motorTestport). */
export async function renderPng(html, file, playwrightIndex) {
  if (!existsSync(playwrightIndex)) return `Playwright findes ikke (${playwrightIndex}); brug --playwright=<sti til @playwright/test/index.mjs>`;
  const { chromium } = await import(pathToFileURL(playwrightIndex).href);
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage({ viewport: { width: 760, height: 600 }, deviceScaleFactor: 2 });
    await page.setContent(html);
    await page.screenshot({ path: file, fullPage: true });
  } finally {
    await browser.close();
  }
  return null;
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
  const log = (...a) => console.log(...a);
  const now = new Date(); // eneste urkilde
  const generatedAt = now.toISOString();
  const day = copenhagenDate(now);
  const outDir = assertPrivatePath(opts.out ?? DEFAULT_OUT_DIR, "--out");

  let raw = null;
  if (!opts.input || opts.apply) {
    const dotenv = await import("dotenv");
    dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
    const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
    if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
      console.error("❌ Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY (kør via infisical run --env=prod, eller dry-run med --input)");
      process.exit(2);
    }
    const { createClient } = await import("@supabase/supabase-js");
    raw = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY, { auth: { persistSession: false } });
  }

  log(`=== #2757 A2 flad etape i S5 — ${opts.apply ? "APPLY" : "DRY-RUN (read-only)"} ===`);
  const db = raw ? createSupabaseA2Db(opts.apply ? raw : createReadOnlyClient(raw)) : null;
  const input = opts.input ? expandSnapshot(JSON.parse(readFileSync(resolve(opts.input), "utf8"))) : await loadA2Input(db, opts.season);
  log(`Kilde: ${input.source} · ${input.races.length} seniorløb · ${input.profiles.length} profilrækker`);
  const plan = buildA2Plan(input);
  const ciGate = opts.noCiGate || opts.apply ? null : runCiGate();
  const gates = evaluateGates({ input, plan, ciGate });
  for (const c of gates.checks) log(`${mark(c.ok)} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  log(`Plan: ${plan.items.length} løb (${plan.routes} ruter) · plan-hash ${plan.planHash}`);

  if (!opts.apply) {
    mkdirSync(outDir, { recursive: true });
    const table = `backup_2757_race_stage_profiles_${day.replace(/-/g, "")}`;
    writeFileSync(join(outDir, "a2-dry-run.md"), renderA2Markdown({ input, plan, gates, generatedAt }), "utf8");
    writeFileSync(join(outDir, "a2-dry-run.json"), `${JSON.stringify({ generatedAt, source: input.source, planHash: plan.planHash, gates, plan }, null, 2)}\n`, "utf8");
    if (plan.items.length) {
      writeFileSync(join(outDir, "backup.sql"), buildBackupSql(table, plan.items), "utf8");
      writeFileSync(join(outDir, "restore.sql"), buildRestoreSql(table, plan.items), "utf8");
    }
    const html = renderA2Html({ plan, gates, generatedAt });
    writeFileSync(join(outDir, "a2-flad-etape.html"), html, "utf8");
    if (!opts.noPng) {
      const pw = opts.playwright ?? join(REPO_ROOT, "frontend", "node_modules", "@playwright", "test", "index.mjs");
      const why = await renderPng(html, join(outDir, "a2-flad-etape.png"), pw);
      log(why ? `⚠ PNG ikke lavet: ${why}` : `Billede: ${join(outDir, "a2-flad-etape.png")}`);
    }
    log(`Rapport: ${join(outDir, "a2-dry-run.md")}`);
    log(`Apply (KUN efter ejerens godkendelse af billedet; kør backup.sql først):`);
    log(`  infisical run --env=prod --silent -- node backend/scripts/s5FlatStageA2_2757.js --apply --owner-go --backup-table=${table} --plan-hash=${plan.planHash}`);
    process.exitCode = gates.ok ? 0 : 1;
    return;
  }

  // ── APPLY ──
  if (!gates.ok) throw new Error(`gaterne er røde, intet skrevet: ${gates.violations.join(" · ")}`);
  if (plan.planHash !== opts.planHash) throw new Error(`plan-hashen er ${plan.planHash}, ikke ${opts.planHash}: noget har flyttet sig siden dry-runnet. Kør dry-runnet igen. Intet skrevet.`);
  const res = await applyPlan({ db, plan, backupTable: opts.backupTable, log });
  log(`Skrevet: ${res.written} etaper · allerede planen: ${res.skipped}`);
  const verify = await postVerify({ db, plan });
  log(`${mark(verify.ok)} post-verify: ${verify.mismatched} etaper afviger fra planen, ${verify.noFlat} løb uden flad etape`);
  if (!verify.ok) {
    console.error(`❌ post-verify fejlede. Rul tilbage med restore.sql fra dry-runnet (ejer-gated).`);
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
