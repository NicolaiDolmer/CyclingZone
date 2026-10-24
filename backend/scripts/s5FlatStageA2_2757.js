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
// Rækkefølge-variation (ejer 24/10, "Ja, test + varier i dag"): en S5-rute med fast stigende
// skabelon (stageOrderVariationGate.isAscendingOrder) får FØRST en ny rækkefølge af DE SAMME
// etaper (samme indhold, kun nyt etapenummer; generatorens chooseStageOrderVariation), og
// derefter lægges A2's flade etape ovenpå. Rækkefølge-gaten (variation på tværs af S5's ruter,
// private bånd i balance-internals/2757-a2/order-variation-bands.json) skal være grøn efter.
// I prod skrives det som indholdet på hver plads (samme række-id, samme stage_number-plads),
// så kalenderens datoer pr. etapenummer er uændrede.
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
// --backup-table=backup_2757_race_stage_profiles_YYYYMMDD --plan-hash=<dry-runnets hash> [--plan-file=
// <dry-runnets a2-dry-run.json>]. Apply bruger den GODKENDTE plan fra filen (bygger den aldrig om),
// kræver at hashen passer, at dry-runnets gater var grønne, at løbene stadig ikke er startet (læst
// fra prod nu), at backup-tabellen (med RLS) dækker hver etape-plads, og at hver etape enten stadig
// er dry-runnets etape eller allerede planen (ellers skrives intet). Den opdaterer kun den valgte
// etape pr. løb (UPDATE på (race_id, stage_number), samme række-id) og post-verificerer.
// Idempotent og genoptagelig: samme kommando igen springer de skrevne etaper over.
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
  generateRaceStageProfiles, chooseA2FlatStage, buildA2FlatStage, flatStagePositionBucket, A2_FLAT_POSITION_WEIGHTS, toStageProfileRow,
  chooseStageOrderVariation, applyStageOrder,
} from "../lib/raceStageProfileGenerator.js";
import {
  measureOrderVariation, detectOrderVariationViolations, assertOrderVariationBands, isAscendingOrder,
} from "../lib/stageOrderVariationGate.js";
import { GRAND_TOUR_MIN_STAGES } from "../lib/grandTourRestDays.js";
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
/** Billedet før/efter (ét PNG af alle ruter der ændres). */
export const IMAGE_NAME = "s5-raekkefoelge-flad-etape";
export const DEFAULT_ORDER_BANDS = join(DEFAULT_OUT_DIR, "order-variation-bands.json");
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

const VALUE_FLAGS = new Set(["season", "input", "out", "backup-table", "plan-hash", "plan-file", "playwright", "order-bands"]);
const BOOL_FLAGS = new Set(["apply", "owner-go", "no-png", "no-ci-gate"]);

/** @param {string[]} argv process.argv.slice(2) */
export function parseArgs(argv = []) {
  const o = { apply: false, ownerGo: false, noPng: false, noCiGate: false, season: TARGET_SEASON_NUMBER, input: null, out: null, backupTable: null, planHash: null, planFile: null, playwright: null, orderBands: null };
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
    if (o.backupTable || o.planHash || o.planFile) throw new Error("--backup-table/--plan-hash/--plan-file hører kun til --apply");
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
    // Managernes planer pr. etapenummer (etaperoller og holdordrer): en etape der skifter indhold,
    // må ikke have en plan lagt efter den gamle etape.
    async stagePlansOf(raceIds) {
      const roles = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_stage_roles").select("race_id, stage_number").in("race_id", chunk).order("race_id").order("stage_number"));
      const orders = await fetchAllRowsChunkedIn(raceIds, (chunk) => supabase.from("race_team_orders").select("race_id, stage_number").in("race_id", chunk).order("race_id").order("stage_number"));
      return [...roles.map((r) => ({ ...r, kind: "race_stage_roles" })), ...orders.map((r) => ({ ...r, kind: "race_team_orders" }))];
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
  // Hele etaperækken (vejr, segmenter, højdeprofil) for etapeløbene: indholdet en ny rækkefølge
  // flytter, og grundlaget for old_content_hash pr. plads.
  const stageRaceIds = races.filter((r) => r.race_type === "stage_race").map((r) => r.id);
  const fullProfiles = stageRaceIds.length ? await db.fullProfilesOf(stageRaceIds) : [];
  const stagePlans = stageRaceIds.length && db.stagePlansOf ? await db.stagePlansOf(stageRaceIds) : [];
  return { source: "prod (SELECT)", season, divisions, races, catalog, profiles, fullProfiles, schedule, claims, stagePlans };
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
    profiles, fullProfiles: doc.full_profiles ?? [], schedule, claims: doc.claims ?? [], stagePlans: doc.stage_plans ?? [],
  };
}

// ── Planen ────────────────────────────────────────────────────────────────────────────

/** Indholdet A2 skriver (og sammenligner) for én etape. */
export function writeContent(row) {
  return Object.fromEntries(A2_WRITE_COLUMNS.map((c) => [c, row?.[c] ?? null]));
}

export const MAX_SEASON_VARIANT = 5;

/**
 * Divisionens sæson-variant (#3347's gen-træk) for et skrevet løb: den variant hvor generatoren
 * giver præcis de skrevne ruter (distance + højdemeter) på etaper med samme type og afslutning.
 * Ruterne seedes på variant-aksen, så den flade etape bygges på samme akse som resten af løbet.
 * null = ingen variant passer (rapporteres; der bygges på variant 0).
 * @param {any} seed seedRaceFor-formen @param {any[]} rows de skrevne etaper
 */
export function detectSeasonVariant(seed, rows, maxVariant = MAX_SEASON_VARIANT) {
  for (let v = 0; v <= maxVariant; v++) {
    let gen;
    // De skrevne S5-ruter er bygget før A2 og før rækkefølge-variationen (#2757).
    try { gen = generateRaceStageProfiles({ ...seed, season_variant: v }, { profileModel: "s5", a2FlatStage: false, orderVariation: false }); } catch { continue; }
    let same = 0;
    let differ = 0;
    rows.forEach((r, i) => {
      const p = gen[i];
      if (!p || p.profile_type !== r.profile_type || p.finale_type !== r.finale_type || r.distance_km == null) return;
      if (Number(p.distance_km) === Number(r.distance_km) && Number(p.elevation_gain_m) === Number(r.elevation_gain_m)) same += 1;
      else differ += 1;
    });
    if (same > 0 && differ === 0) return v;
  }
  return null;
}

/** Grand Tour efter samme kriterier som generatoren (rækkefølge-variationen rører dem ikke). */
export function isGrandTourRace(race) {
  return race?.race_class === "TourFrance" || race?.race_class === "GiroVuelta" || Number(race?.stages) >= GRAND_TOUR_MIN_STAGES;
}

/**
 * Hvert S5-etapeløb der ændres: (1) en rute med fast stigende skabelon får en ny rækkefølge af
 * de samme etaper (chooseStageOrderVariation), (2) et løb uden flad etape får A2's flade etape
 * ovenpå. Planen er pr. løb en liste af skrivninger pr. plads (etapenummer): det nye indhold og
 * hashen af pladsens nuværende indhold. En plads hvis indhold ikke ændres, skrives ikke.
 * @param {Awaited<ReturnType<typeof loadA2Input>>} input
 */
export function buildA2Plan(input, { orderVariation = true } = {}) {
  const { season, divisions, races, catalog, profiles } = input;
  const planErrors = [];
  const tierByDivision = new Map(divisions.map((d) => [d.id, d.tier]));
  const catalogById = new Map(catalog.map((c) => [c.id, c]));
  const profilesByRace = groupBy(profiles, "race_id");
  for (const rows of profilesByRace.values()) rows.sort(byStage);
  const fullByKey = new Map((input.fullProfiles ?? []).map((r) => [`${r.race_id}|${r.stage_number}`, r]));
  const fullRow = (row) => fullByKey.get(`${row.race_id}|${row.stage_number}`) ?? row;

  const items = [];
  const unresolved = [];
  const byRoute = new Map();
  for (const race of races.filter((r) => r.race_type === "stage_race")) {
    const rows = profilesByRace.get(race.id) ?? [];
    if (!rows.length) { planErrors.push(`løb ${race.id} (${race.name}): ingen etapeprofiler`); continue; }
    const cat = catalogById.get(race.pool_race_id);
    const hasFlat = rows.some((p) => p.profile_type === "flat");
    if (!cat) { if (!hasFlat) planErrors.push(`løb ${race.id} (${race.name}): katalog-løbet ${race.pool_race_id} mangler`); continue; }
    const seed0 = seedRaceFor(race, cat, season.id, 0);
    const tier = tierByDivision.get(race.league_division_id) ?? null;
    if (hasFlat && (!orderVariation || !isAscendingOrder(rows.map((p) => p.profile_type)))) continue;
    const detected = detectSeasonVariant(seed0, rows);
    const seed = { ...seed0, season_variant: detected ?? 0 };
    // Samme seed som generatoren (løbets sæson-variant), så puljerne og generatoren giver samme rækkefølge.
    const variation = orderVariation ? chooseStageOrderVariation(seed, rows) : { order: null, fixed: [] };
    if (!variation.order && hasFlat) continue;
    const ordered = variation.order ? applyStageOrder(rows, variation.order) : rows;
    const pick = hasFlat ? { stageNumber: null, candidates: [], reason: "has_flat" } : chooseA2FlatStage(seed, ordered);
    if (!hasFlat && pick.stageNumber == null) unresolved.push({ race_id: race.id, name: race.name, tier, reason: pick.reason });
    if (!variation.order && pick.stageNumber == null) continue;
    const old = pick.stageNumber == null ? null : ordered[pick.stageNumber - 1];
    const flat = pick.stageNumber == null ? null
      : writeContent(toStageProfileRow(race.id, buildA2FlatStage(seed, pick.stageNumber, { generatorVersion: fullRow(old).generator_version ?? undefined })));
    const writes = [];
    rows.forEach((cur, i) => {
      const slot = i + 1;
      const source = variation.order ? variation.order[i] : slot;
      const content = slot === pick.stageNumber ? flat : writeContent(fullRow(rows[source - 1]));
      const current = writeContent(fullRow(cur));
      if (canonicalJson(content) === canonicalJson(current)) return;
      // Codex P2 (#7156): hele pladsens nuværende indhold gemmes som hash, så apply nægter at skrive
      // over en etape der er ændret siden dry-run, også i stigninger, spurter, vejr og segmenter.
      writes.push({ stage_number: slot, source_stage_number: slot === pick.stageNumber ? null : source, content, old_content_hash: sha256(canonicalJson(current)) });
    });
    // En flyttet etape skal have hele sin række (vejr, segmenter, højdeprofil) med, ellers flyttes kun en del.
    const partial = writes.filter((w) => w.source_stage_number != null && w.content.segments == null && w.content.elevation_profile == null);
    if (partial.length) planErrors.push(`${race.name} (D${tier}): de fulde etaperækker mangler for ${partial.length} flyttede etaper`);
    const after = ordered.map((p) => (p.stage_number === pick.stageNumber ? { ...p, profile_type: "flat", finale_type: flat.finale_type } : p));
    const item = {
      race_id: race.id, name: race.name, tier, league_division_id: race.league_division_id, pool_race_id: race.pool_race_id,
      stages: rows.length, season_variant: seed.season_variant, variant_detected: detected != null,
      order: variation.order, order_fixed: variation.fixed,
      stage_number: pick.stageNumber, candidates: pick.candidates,
      bucket: pick.stageNumber == null ? null : flatStagePositionBucket(pick.stageNumber - 1, rows.length),
      before: rows.map((p) => ({ stage_number: p.stage_number, profile_type: p.profile_type, finale_type: p.finale_type, distance_km: p.distance_km ?? null, elevation_gain_m: p.elevation_gain_m ?? null })),
      after: after.map((p, i) => ({ stage_number: i + 1, profile_type: p.profile_type, finale_type: p.finale_type, from_stage: variation.order ? variation.order[i] : i + 1 })),
      old: old == null ? null : { profile_type: old.profile_type, finale_type: old.finale_type, distance_km: old.distance_km ?? null, elevation_gain_m: old.elevation_gain_m ?? null, climbs: (old.climbs ?? []).length, from_stage: variation.order ? variation.order[pick.stageNumber - 1] : pick.stageNumber },
      content: flat,
      writes,
      benchmark: flat ? checkStage({ ...flat, stage_number: pick.stageNumber }).violations : [],
    };
    // Divisionens puljer kører samme parcours (#2276): samme katalog-løb skal få samme rute.
    const key = `${tier}:${race.pool_race_id}`;
    const fp = sha256(canonicalJson({ order: item.order, stage: item.stage_number, writes: writes.map((w) => ({ s: w.stage_number, c: w.content })) }));
    if (byRoute.has(key) && byRoute.get(key) !== fp) planErrors.push(`${race.name} (D${tier}): puljerne får ikke samme rute`);
    byRoute.set(key, fp);
    items.push(item);
  }
  items.sort((a, b) => (a.tier - b.tier) || a.name.localeCompare(b.name) || (a.league_division_id - b.league_division_id) || a.race_id.localeCompare(b.race_id));
  const planHash = planHashOf(items);
  return { seasonId: season.id, items, unresolved, planErrors, planHash, routes: byRoute.size };
}

/** Planens skrivninger som pladser (én pr. race_id + etapenummer), med løbets felter. */
export function planSlots(plan) {
  return plan.items.flatMap((it) => (it.writes ?? []).map((w) => ({
    race_id: it.race_id, name: it.name, tier: it.tier, stage_number: w.stage_number, source_stage_number: w.source_stage_number,
    content: w.content, old_content_hash: w.old_content_hash,
  })));
}

/** Profilerne efter planen (til gaterne og billedet). */
export function profilesAfter(input, plan) {
  const swap = new Map(planSlots(plan).map((s) => [`${s.race_id}|${s.stage_number}`, s.content]));
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

/** Et bruds regel uden dets tal (to brud på samme regel med forskellige tal er samme brud). */
export function violationKey(text) {
  return String(text).replace(/\d+(?:[.,]\d+)?/g, "#");
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

/**
 * S5's ruter til rækkefølge-gaten: én pr. division og katalog-løb (repræsentativ pulje), Grand
 * Tours udeladt. Samme katalog-løb med samme rækkefølge i flere divisioner er én rute.
 * @returns {Array<{ key: string, name: string, tiers: number[], types: string[] }>}
 */
export function orderRoutes(input, profiles) {
  const byRace = groupBy(profiles, "race_id");
  const out = new Map();
  for (const [tier, races] of representativeRaces(input)) {
    for (const r of races.filter((x) => x.race_type === "stage_race" && !isGrandTourRace(x))) {
      const types = (byRace.get(r.id) ?? []).slice().sort(byStage).map((p) => p.profile_type);
      if (types.length < 2) continue;
      const key = `${r.pool_race_id}|${types.join(",")}`;
      if (!out.has(key)) out.set(key, { key, name: r.name, tiers: [], types });
      out.get(key).tiers.push(tier);
    }
  }
  return [...out.values()];
}

/** Rækkefølge-gaten før og efter planen. @param {any} bands  de private bånd */
export function orderVariationFor(input, plan, bands) {
  const before = measureOrderVariation(orderRoutes(input, input.profiles), { minRoutesPerStageCount: bands.minRoutesPerStageCount });
  const after = measureOrderVariation(orderRoutes(input, profilesAfter(input, plan)), { minRoutesPerStageCount: bands.minRoutesPerStageCount });
  // A2 alene (uden ny rækkefølge): sammenligningen for placerings-fordelingen, fordi A2 selv ændrer
  // sammensætningen (flere flade etaper); variationen må ikke trække fordelingen længere væk.
  const a2Only = measureOrderVariation(orderRoutes(input, profilesAfter(input, buildA2Plan(input, { orderVariation: false }))), { minRoutesPerStageCount: bands.minRoutesPerStageCount });
  return {
    before, after, a2Only,
    violationsBefore: detectOrderVariationViolations(before, bands),
    violationsAfter: detectOrderVariationViolations(after, bands),
  };
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
 * løbstilstand (startet, claims, bundet motor-revision, håndredigerede rækker, managerplaner på
 * de ændrede etaper) og rækkefølge-gaten efter planen (#2757; kræver de private bånd).
 */
export function evaluateGates({ input, plan, ciGate = null, orderBands }) {
  assertOrderVariationBands(orderBands);
  const catalogById = new Map(input.catalog.map((c) => [c.id, c]));
  const after = profilesAfter(input, plan);
  const tiers = [];
  for (const [tier, races] of representativeRaces(input)) {
    const before = coverageFor(tier, races, input.profiles, catalogById);
    const aft = coverageFor(tier, races, after, catalogById);
    // Et brud der fandtes før A2, er samme brud efter, selv om tallet i teksten flytter sig (fx et gulv
    // der stadig er brudt med en etape mere eller mindre). Nyt = en regel der først brydes efter A2.
    const known = new Set([...before.violations, ...before.uniformViolations].map(violationKey));
    const added = [...aft.violations, ...aft.uniformViolations].filter((v) => !known.has(violationKey(v)));
    tiers.push({ tier, before, after: aft, newViolations: added, placement: placementFor(tier, races, input.schedule ?? []) });
  }
  const affectedIds = new Set(plan.items.map((it) => it.race_id));
  const affectedRaces = input.races.filter((r) => affectedIds.has(r.id));
  const checks = [];
  const add = (name, ok, detail = "") => checks.push({ name, ok: Boolean(ok), detail });
  add("sæsonen er S5", input.season?.number === TARGET_SEASON_NUMBER, `sæson ${input.season?.number}`);
  add("planen kunne bygges", plan.planErrors.length === 0, plan.planErrors.slice(0, 5).join(" · "));
  add("alle etapeløb uden flad etape har en lovlig etape", plan.unresolved.length === 0, plan.unresolved.map((u) => `${u.name} (${u.reason})`).join(" · "));
  // Rapporteres (blokerer ikke): uden fundet variant bygges etapen på variant 0, stadig en gyldig flad etape.
  const noVariant = plan.items.filter((it) => !it.variant_detected);
  add("løbenes sæson-variant genskabt af generatoren (rutens seed-akse)", true, noVariant.length ? `ikke fundet for ${noVariant.length} løb (bygget på variant 0): ${[...new Set(noVariant.map((it) => it.name))].join(", ")}` : `fundet for alle ${plan.items.length} løb`);
  const bench = plan.items.filter((it) => it.benchmark.length);
  add("benchmark-gatens etape-tjek på hver ny flad etape", bench.length === 0, bench.map((it) => `${it.name} e${it.stage_number}: ${it.benchmark.join("; ")}`).join(" · "));
  const added = tiers.flatMap((t) => t.newViolations);
  add("ingen nye brud på §5-gulve, rolling-båndet eller §6b", added.length === 0, added.join(" · "));
  // #2757 rækkefølge-variationen: samme etaper (multisæt pr. løb), og gaten grøn efter planen.
  const sameStages = plan.items.filter((it) => it.order).every((it) => {
    const types = (xs) => xs.map((p) => p.profile_type).sort().join(",");
    const flatFix = (xs) => xs.map((p) => (it.stage_number != null && p.stage_number === it.stage_number ? { ...p, profile_type: it.old.profile_type } : p));
    return types(flatFix(it.after)) === types(it.before);
  });
  add("ny rækkefølge bruger de samme etaper (kun nyt etapenummer)", sameStages);
  const order = orderVariationFor(input, plan, orderBands);
  add("rækkefølge-gaten (variation på tværs af S5's ruter) efter planen", order.violationsAfter.length === 0,
    order.violationsAfter.length ? order.violationsAfter.join(" · ") : `${order.violationsBefore.length} brud før, 0 efter`);
  add("ny rækkefølge trækker ikke etapetyperne pr. placering længere fra rigtige etapeløb end A2 alene", order.after.positionDistance <= order.a2Only.positionDistance + 1e-9,
    `før ${order.before.positionDistance.toFixed(3)} · A2 alene ${order.a2Only.positionDistance.toFixed(3)} · efter ${order.after.positionDistance.toFixed(3)}`);
  const stillTemplate = order.after.ascendingKeys.length;
  add("ruter der stadig har fast stigende rækkefølge (ingen lovlig ny rækkefølge; rapporteres)", true, `${stillTemplate} ruter`);
  const changedSlots = new Set(planSlots(plan).map((s) => `${s.race_id}|${s.stage_number}`));
  const plans = (input.stagePlans ?? []).filter((p) => changedSlots.has(`${p.race_id}|${p.stage_number}`));
  add("ingen etaperoller eller holdordrer på de ændrede etaper", plans.length === 0, `${plans.length} rækker`);
  // A2 rører ingen datoer, så placerings-gaterne er ens før og efter: de rapporteres, men et brud
  // her er kalenderens (fandtes før A2) og blokerer ikke A2.
  const placement = tiers.flatMap((t) => t.placement.violations);
  const evaluated = tiers.filter((t) => t.placement.evaluated).length;
  add("placerings-gaterne (calendarPlacementGates), uændrede af A2", true,
    placement.length ? `${placement.length} brud fandtes før A2: ${placement.join(" · ")}` : `grønne, ${evaluated} divisioner tjekket`);
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
    ok: violations.length === 0, violations, checks, tiers, order,
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

/**
 * Hver plan-plads mod databasen lige nu: `done` = allerede planen, `toWrite` = stadig præcis det
 * indhold dry-runnet så (old_content_hash over hele pladsens indhold), `drift` = hverken eller
 * (ændret siden). Pladserne vurderes hver for sig, så en afbrudt ny rækkefølge kan genoptages.
 */
export function diffAgainstCurrent(plan, currentRows) {
  const cur = new Map(currentRows.map((r) => [`${r.race_id}|${r.stage_number}`, r]));
  const toWrite = [];
  const done = [];
  const drift = [];
  for (const slot of planSlots(plan)) {
    const row = cur.get(`${slot.race_id}|${slot.stage_number}`);
    const now = row ? canonicalJson(writeContent(row)) : null;
    if (now != null && now === canonicalJson(slot.content)) done.push(slot);
    else if (now != null && sha256(now) === slot.old_content_hash) toWrite.push(slot);
    else drift.push(slot);
  }
  return { toWrite, done, drift };
}

/** Plan-hashen over planens skrivninger (race_id, plads, nyt indhold, hash af det gamle indhold). */
export function planHashOf(items) {
  return sha256(canonicalJson(items.map((it) => ({
    race_id: it.race_id,
    writes: (it.writes ?? []).map((w) => ({ stage_number: w.stage_number, content: w.content, old_content_hash: w.old_content_hash })),
  }))));
}

/**
 * Den godkendte plan fra dry-runnets a2-dry-run.json. Apply bygger ALDRIG planen om fra prod:
 * efter en delvis kørsel har løbene allerede en flad etape, og en genberegnet plan ville se
 * anderledes ud. Hashen over etaperne skal være præcis den ejeren godkendte.
 * @param {any} doc  a2-dry-run.json @param {string} expectedHash
 */
export function approvedPlanFrom(doc, expectedHash) {
  const items = doc?.plan?.items;
  if (!Array.isArray(items) || !items.length) throw new Error("plan-filen har ingen etaper");
  if (items.some((it) => !Array.isArray(it.writes) || it.writes.some((w) => !/^[0-9a-f]{64}$/.test(String(w.old_content_hash))))) {
    throw new Error("plan-filen mangler skrivninger med old_content_hash pr. plads. Intet skrevet.");
  }
  const hash = planHashOf(items);
  if (hash !== expectedHash || doc.planHash !== expectedHash) throw new Error(`plan-filens hash er ${hash}, ikke ${expectedHash}. Intet skrevet.`);
  return { ...doc.plan, items, planHash: hash };
}

/** Løbstilstanden for planens løb, læst fra prod lige før apply (tom liste = grøn). */
export function liveStateViolations(input, plan) {
  const ids = new Set(plan.items.map((it) => it.race_id));
  const races = input.races.filter((r) => ids.has(r.id));
  const out = [];
  if (input.season?.number !== TARGET_SEASON_NUMBER) out.push(`sæsonen er ${input.season?.number}, ikke ${TARGET_SEASON_NUMBER}`);
  if (races.length !== ids.size) out.push(`${ids.size - races.length} af planens løb findes ikke i S5`);
  const started = races.filter((r) => Number(r.stages_completed ?? 0) !== 0);
  if (started.length) out.push(`${started.length} løb er startet`);
  const claims = (input.claims ?? []).filter((c) => ids.has(c.race_id));
  if (claims.length) out.push(`${claims.length} claims på løbene`);
  const bound = races.filter((r) => r.engine_rules_revision != null);
  if (bound.length) out.push(`${bound.length} løb er bundet til en motor-revision`);
  const manual = input.profiles.filter((p) => ids.has(p.race_id) && p.is_manual === true);
  if (manual.length) out.push(`${manual.length} håndredigerede profiler`);
  const changed = new Set(planSlots(plan).map((s) => `${s.race_id}|${s.stage_number}`));
  const plans = (input.stagePlans ?? []).filter((p) => changed.has(`${p.race_id}|${p.stage_number}`));
  if (plans.length) out.push(`${plans.length} etaperoller/holdordrer på de ændrede etaper`);
  return out;
}

/** UPDATE pr. plads; backuppen skal dække hver plads først, og ingen plads må have flyttet sig. */
export async function applyPlan({ db, plan, backupTable, log = () => {} }) {
  const ids = [...new Set(plan.items.map((it) => it.race_id))];
  const current = ids.length ? await db.fullProfilesOf(ids) : [];
  const { toWrite, done, drift } = diffAgainstCurrent(plan, current);
  if (drift.length) throw new Error(`${drift.length} etaper er hverken dry-runnets etape eller planen (ændret siden): ${drift.map((s) => `${s.name} e${s.stage_number}`).join(", ")}. Intet skrevet.`);
  if (done.length) log(`${done.length} etaper er allerede planen (springes over)`);
  if (!toWrite.length) return { written: 0, skipped: done.length };
  const covered = await db.backupSlots(backupTable, [...new Set(toWrite.map((s) => s.race_id))]);
  const missing = toWrite.filter((s) => !covered.has(`${s.race_id}|${s.stage_number}`));
  if (missing.length) throw new Error(`backuppen ${backupTable} mangler ${missing.length} af ${toWrite.length} etape-pladser. Kør backup.sql først. Intet skrevet.`);
  for (const s of toWrite) {
    await db.updateStage(s.race_id, s.stage_number, s.content);
    log(`  ✓ ${s.name} (D${s.tier}) etape ${s.stage_number}: ${s.source_stage_number == null ? `ny flad etape (${s.content.profile_type})` : `etapen fra plads ${s.source_stage_number}`}`);
  }
  return { written: toWrite.length, skipped: done.length };
}

/** Post-verify: hver plads er planen, og hvert løb har nu en flad etape. */
export async function postVerify({ db, plan }) {
  const ids = [...new Set(plan.items.map((it) => it.race_id))];
  const rows = ids.length ? await db.fullProfilesOf(ids) : [];
  // Codex P2 (#7156): både ikke-skrevne (toWrite) og afvigende (drift) pladser er fejl. En flad
  // etape med forkert distance eller forkerte stigninger er ikke den godkendte etape.
  const { toWrite, drift } = diffAgainstCurrent(plan, rows);
  const mismatched = toWrite.length + drift.length;
  const byRace = groupBy(rows, "race_id");
  const noFlat = ids.filter((id) => !(byRace.get(id) ?? []).some((r) => r.profile_type === "flat"));
  return { ok: mismatched === 0 && noFlat.length === 0, mismatched, noFlat: noFlat.length };
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

/**
 * Planens løb samlet pr. rute (division + katalog-løb): puljerne kører samme rute (#2276), så
 * billedet og rapporten viser hver rute én gang med antal puljer.
 */
export function planRoutes(plan) {
  const out = new Map();
  for (const it of plan.items) {
    const key = `${it.tier}:${it.pool_race_id}`;
    if (!out.has(key)) out.set(key, { key, item: it, pools: [] });
    out.get(key).pools.push(it.league_division_id);
  }
  return [...out.values()];
}

/** Hvad der sker med en rute, i ord. */
function changeLabel(it) {
  const parts = [];
  if (it.order) parts.push("ny rækkefølge");
  if (it.stage_number != null) parts.push(`flad etape ${it.stage_number}`);
  return parts.join(" + ");
}

/** Billedet: hver rute der ændres (puljerne samlet), etaperne før og efter, farvekodet efter etapetype. */
export function renderA2Html({ plan, gates, generatedAt }) {
  const routes = planRoutes(plan);
  const cell = (p, cls = "") => `<td class="st${cls}" style="background:${TYPE_COLORS[p.profile_type] ?? "#ced4da"}" title="${esc(p.profile_type)} / ${esc(p.finale_type)}">${p.stage_number}</td>`;
  const maxStages = Math.max(1, ...plan.items.map((it) => it.stages));
  const pad = (n) => "<td class=\"pad\"></td>".repeat(Math.max(0, maxStages - n));
  const rows = routes.map(({ item: it, pools }) => {
    const sub = `D${it.tier} · ${pools.length} ${pools.length === 1 ? "pulje" : "puljer"} · ${esc(changeLabel(it))}`;
    const after = (it.after ?? it.before).map((p) => cell(p, p.stage_number === it.stage_number ? " ch" : (p.from_stage ?? p.stage_number) !== p.stage_number ? " mv" : ""));
    return `<tr><td class="name" rowspan="2">${esc(it.name)}<div class="sub">${sub}</div></td><td class="lbl">Før</td>${it.before.map((p) => cell(p)).join("")}${pad(it.stages)}</tr>`
      + `<tr class="aft"><td class="lbl">Efter</td>${after.join("")}${pad(it.stages)}</tr>`;
  }).join("\n");
  const used = [...new Set(plan.items.flatMap((it) => it.before.map((p) => p.profile_type)).concat("flat"))];
  const legend = used.map((t) => `<span class="lg"><i style="background:${TYPE_COLORS[t] ?? "#ced4da"}"></i>${esc(TYPE_LABELS[t] ?? t)}</span>`).join("");
  const gateLine = gates ? `${mark(gates.ok)} gaterne ${gates.ok ? "grønne" : "røde"} · ${gates.checks.filter((c) => c.ok).length}/${gates.checks.length} tjek` : "";
  const reordered = routes.filter((r) => r.item.order).length;
  const flats = routes.filter((r) => r.item.stage_number != null).length;
  return `<!doctype html><html lang="da"><head><meta charset="utf-8"><title>S5 ruter: rækkefølge og flad etape</title><style>
body{font-family:Segoe UI,Arial,sans-serif;margin:24px;color:#212529;background:#fff}
h1{font-size:20px;margin:0 0 4px}p.meta{margin:0 0 10px;color:#495057;font-size:13px}
table{border-collapse:separate;border-spacing:3px}td{font-size:12px}
td.name{font-weight:600;padding:4px 10px 4px 0;vertical-align:middle;border-top:1px solid #dee2e6;min-width:250px}
td.name .sub{font-weight:400;color:#6c757d;font-size:11px}
td.lbl{color:#6c757d;padding-right:6px;font-size:11px}
td.st{width:30px;height:20px;text-align:center;color:#fff;font-weight:600;border-radius:4px;font-variant-numeric:tabular-nums;text-shadow:0 0 2px rgba(0,0,0,.45)}
td.st.ch{outline:3px solid #212529;outline-offset:-1px}td.st.mv{outline:2px dashed #212529;outline-offset:-1px}td.pad{width:30px}
.lg{display:inline-flex;align-items:center;margin-right:14px;font-size:12px}.lg i{display:inline-block;width:14px;height:14px;border-radius:3px;margin-right:5px}
.k{display:inline-block;width:14px;height:12px;border-radius:3px;background:#adb5bd;margin:0 5px -2px 0}
</style></head><body>
<h1>#2757: S5-etapeløbenes rækkefølge og flade etape, før og efter</h1>
<p class="meta">${routes.length} ruter (${plan.items.length} løb med puljerne) · ${reordered} får ny rækkefølge af de samme etaper · ${flats} får en flad etape · ${esc(gateLine)} · plan-hash ${plan.planHash.slice(0, 12)} · ${esc(generatedAt)}</p>
<p class="meta"><span class="k" style="outline:3px solid #212529"></span>ny flad etape <span class="k" style="outline:2px dashed #212529;margin-left:12px"></span>samme etape, ny plads · tallet er etapenummeret</p>
<p class="meta">${legend}</p>
<table>${rows}</table>
</body></html>`;
}

/** Den private markdown-rapport (navne og tal, hard rule 17). */
export function renderA2Markdown({ input, plan, gates, generatedAt }) {
  const routes = planRoutes(plan);
  const lines = [];
  lines.push(`# #2757: rækkefølge-variation + A2 flad etape i S5-etapeløbene (dry-run)`, "");
  lines.push(`Kilde: ${input.source} · genereret ${generatedAt} · plan-hash \`${plan.planHash}\``, "");
  lines.push(`**${routes.length} ruter** (${plan.items.length} løb med puljerne): ${routes.filter((r) => r.item.order).length} får ny rækkefølge af de samme etaper, ${routes.filter((r) => r.item.stage_number != null).length} får én flad etape. ${plan.unresolved.length} løb uden lovlig flad etape. ${planSlots(plan).length} etape-pladser skrives.`, "");
  lines.push("## Gaterne", "");
  for (const c of gates.checks) lines.push(`- ${mark(c.ok)} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  if (gates.order) {
    const o = gates.order;
    const pct = (x) => `${(100 * x).toFixed(0)} %`;
    lines.push("", "## Rækkefølge-gaten (S5's ruter uden Grand Tours), før → efter", "");
    lines.push("| Mål | før | efter |", "|---|---|---|");
    lines.push(`| ruter | ${o.before.routes} | ${o.after.routes} |`);
    lines.push(`| fast stigende rækkefølge | ${o.before.ascending} (${pct(o.before.ascendingShare)}) | ${o.after.ascending} (${pct(o.after.ascendingShare)}) |`);
    lines.push(`| forskellige rækkefølger | ${o.before.distinct} (${pct(o.before.distinctShare)}) | ${o.after.distinct} (${pct(o.after.distinctShare)}) |`);
    lines.push(`| afstand til rigtige etapeløb pr. placering | ${o.before.positionDistance.toFixed(3)} | ${o.after.positionDistance.toFixed(3)} |`);
    for (const s of o.after.byStageCount) {
      const b = o.before.byStageCount.find((x) => x.stages === s.stages);
      lines.push(`| ${s.stages} etaper: flest ens | ${b ? `${b.maxIdentical}/${b.routes}` : "-"} | ${s.maxIdentical}/${s.routes} |`);
    }
    lines.push("", `Brud før: ${o.violationsBefore.length ? o.violationsBefore.join(" · ") : "ingen"}`, "", `Brud efter: ${o.violationsAfter.length ? o.violationsAfter.join(" · ") : "ingen"}`);
    if (o.after.ascendingKeys.length) lines.push("", `Stadig fast stigende (ingen lovlig ny rækkefølge uden at flytte finale, tidskørsel, signatur eller kongeetape): ${o.after.ascendingKeys.length} ruter`);
  }
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
  if (known.length) { lines.push("", "Brud der fandtes før (uændrede, blokerer ikke):", ""); for (const v of known) lines.push(`- ${v}`); }
  lines.push("", "## Placering af flade etaper i S5-etapeløbene (én pr. division og løb)", "");
  lines.push("| Placering | virkeligheden (en-uges WT 2024-26) | S5 før | S5 efter |", "|---|---|---|---|");
  const rw = gates.positions.realWorld;
  const tot = (o) => Object.values(o).reduce((s, x) => s + x, 0) || 1;
  for (const k of Object.keys(rw)) {
    const pct = (o) => `${o[k]} (${((100 * o[k]) / tot(o)).toFixed(0)} %)`;
    lines.push(`| ${k} | ${pct(rw)} | ${pct(gates.positions.before)} | ${pct(gates.positions.after)} |`);
  }
  lines.push("", "## Ruterne", "", "| Løb | Div | Puljer | Før | Efter | Ændring | Flad etape (km, hm, stigninger, afslutning) | Variant |", "|---|---|---|---|---|---|---|---|");
  for (const { item: it, pools } of routes) {
    const seq = (xs) => xs.map((p) => p.profile_type).join(" · ");
    const c = it.content;
    const flat = c ? `${it.stage_number}/${it.stages} (${it.bucket}): ${c.distance_km} km, ${c.elevation_gain_m} hm, ${(c.climbs ?? []).length} stign., ${c.finale_type}; erstatter ${it.old.profile_type}` : "-";
    lines.push(`| ${it.name} | D${it.tier} | ${pools.length} | ${seq(it.before)} | ${seq(it.after ?? it.before)} | ${changeLabel(it)}${it.order ? ` (rækkefølge ${it.order.join(",")})` : ""} | ${flat} | ${it.season_variant}${it.variant_detected ? "" : " (ikke fundet)"} |`);
  }
  if (plan.unresolved.length) { lines.push("", "## Uden lovlig flad etape", ""); for (const u of plan.unresolved) lines.push(`- ${u.name} (D${u.tier}): ${u.reason}`); }
  lines.push("", "Rækkefølgen vælges deterministisk pr. katalog-løb (generatorens chooseStageOrderVariation): finale, tidskørsler, signatur og kongeetape står fast, resten flyttes væk fra den faste stigende skabelon, vægtet efter etapetypernes placering i rigtige en-uges-løb. Den flade etape vælges derefter (chooseA2FlatStage) og bygges af buildA2FlatStage på løbets egen sæson-variant.");
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

  log(`=== #2757 rækkefølge + A2 flad etape i S5 — ${opts.apply ? "APPLY" : "DRY-RUN (read-only)"} ===`);
  const db = raw ? createSupabaseA2Db(opts.apply ? raw : createReadOnlyClient(raw)) : null;
  const input = opts.input ? expandSnapshot(JSON.parse(readFileSync(resolve(opts.input), "utf8"))) : await loadA2Input(db, opts.season);
  log(`Kilde: ${input.source} · ${input.races.length} seniorløb · ${input.profiles.length} profilrækker`);

  if (opts.apply) {
    // ── APPLY: den godkendte plan (dry-runnets fil), aldrig en genberegnet ──
    const planFile = resolve(opts.planFile ?? join(outDir, "a2-dry-run.json"));
    const doc = JSON.parse(readFileSync(planFile, "utf8"));
    if (doc?.gates?.ok !== true) throw new Error(`dry-runnets gater var ikke grønne (${planFile}). Intet skrevet.`);
    const plan = approvedPlanFrom(doc, opts.planHash);
    log(`Godkendt plan: ${plan.items.length} løb, ${planSlots(plan).length} etape-pladser fra ${planFile}`);
    const state = liveStateViolations(input, plan);
    if (state.length) throw new Error(`løbstilstanden er ændret: ${state.join(" · ")}. Intet skrevet.`);
    const res = await applyPlan({ db, plan, backupTable: opts.backupTable, log });
    log(`Skrevet: ${res.written} etaper · allerede planen: ${res.skipped}`);
    const verify = await postVerify({ db, plan });
    log(`${mark(verify.ok)} post-verify: ${verify.mismatched} etaper afviger fra planen, ${verify.noFlat} løb uden flad etape`);
    if (!verify.ok) {
      console.error(`❌ post-verify fejlede. Kør samme kommando igen (den genoptager), eller rul tilbage med restore.sql (ejer-gated).`);
      process.exitCode = 1;
    }
    return;
  }

  // De private rækkefølge-bånd (hard rule 17); mangler de, kører dry-runnet ikke (fail-closed).
  const bandsFile = resolve(opts.orderBands ?? DEFAULT_ORDER_BANDS);
  if (!existsSync(bandsFile)) {
    console.error(`❌ rækkefølge-båndene mangler: ${bandsFile} (privat fil i balance-internals/2757-a2/, eller --order-bands=<sti>)`);
    process.exit(2);
  }
  const orderBands = assertOrderVariationBands(JSON.parse(readFileSync(bandsFile, "utf8")));
  const plan = buildA2Plan(input);
  const ciGate = opts.noCiGate ? null : runCiGate();
  const gates = evaluateGates({ input, plan, ciGate, orderBands });
  for (const c of gates.checks) log(`${mark(c.ok)} ${c.name}${c.detail ? ` (${c.detail})` : ""}`);
  log(`Plan: ${plan.items.length} løb (${plan.routes} ruter), ${planSlots(plan).length} etape-pladser · plan-hash ${plan.planHash}`);

  mkdirSync(outDir, { recursive: true });
  const table = `backup_2757_race_stage_profiles_${day.replace(/-/g, "")}`;
  const planPath = join(outDir, "a2-dry-run.json");
  writeFileSync(join(outDir, "a2-dry-run.md"), renderA2Markdown({ input, plan, gates, generatedAt }), "utf8");
  writeFileSync(planPath, `${JSON.stringify({ generatedAt, source: input.source, planHash: plan.planHash, gates, plan }, null, 2)}\n`, "utf8");
  if (plan.items.length) {
    writeFileSync(join(outDir, "backup.sql"), buildBackupSql(table, planSlots(plan)), "utf8");
    writeFileSync(join(outDir, "restore.sql"), buildRestoreSql(table, planSlots(plan)), "utf8");
  }
  const html = renderA2Html({ plan, gates, generatedAt });
  writeFileSync(join(outDir, `${IMAGE_NAME}.html`), html, "utf8");
  if (!opts.noPng) {
    const pw = opts.playwright ?? join(REPO_ROOT, "frontend", "node_modules", "@playwright", "test", "index.mjs");
    const why = await renderPng(html, join(outDir, `${IMAGE_NAME}.png`), pw);
    log(why ? `⚠ PNG ikke lavet: ${why}` : `Billede: ${join(outDir, `${IMAGE_NAME}.png`)}`);
  }
  log(`Rapport: ${join(outDir, "a2-dry-run.md")}`);
  log(`Apply (KUN efter ejerens godkendelse af billedet; kør backup.sql først):`);
  log(`  infisical run --env=prod --silent -- node backend/scripts/s5FlatStageA2_2757.js --apply --owner-go --backup-table=${table} --plan-hash=${plan.planHash} --plan-file=${planPath}`);
  process.exitCode = gates.ok ? 0 : 1;
}

const invokedDirectly = process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href;
if (invokedDirectly) {
  main().catch((err) => {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  });
}
