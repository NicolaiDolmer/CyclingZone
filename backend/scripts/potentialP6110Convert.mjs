// #6110 / #8521: omregning stjerner (riders.potentiale, 1-6) -> potentiale P (1-99).
//
// Spec: docs/superpowers/specs/2026-11-20-6110-potentiale-p-og-udvikling-g3a-design.md §2.
// Selve omregningen er backend/lib/potentialP6110.js (ren funktion).
//
// STANDARD = DRY-RUN. Scriptet læser riders + rider_derived_abilities (kun SELECT) og
// skriver én privat rapport lokalt: fordelingen af P, median/p90/p99, antal >= 80 og
// >= 90, og hvor mange der blev hævet til deres rating. Ingen rating ændres nogensinde.
//
// Ejervalg 21/11: unge ryttere (potentialP6110.YOUNG_AGE_LIMIT) der står over deres nye P,
// får toppen af det "Forventet niveau", spilleren ser i dag: prognose-båndet for primær
// type fra buildTypePrognosisBands, med maxLevel, rytterens eget hold som seed og
// standard-scout (samme kald som ruterne). Rapporten tæller dem for sig (liftedToPrognosis).
// Alder = sæson-alder i den aktive sæson.
//
// --apply skriver riders.base_talent og riders.talent_ceiling (samme tal = P) og kræver
// --owner-go (ejerens ordrette go, efter han har set dry-run-rapporten). Apply nægter at
// skrive, hvis rapporten har rang-brud. Kolonnerne findes allerede
// (database/2026-11-04-6110-potential-estimates.sql), så der er ingen migration.
//
// Kør (dry-run):
//   PARAMS=<privat params.json> infisical run --env=prod -- \
//     node backend/scripts/potentialP6110Convert.mjs
// Kør (offline mod et dump med id, potentiale, primary_type, secondary_type,
// best_role_rating og evt. birthdate, team_id og abilities pr. rytter; SEASON_NUMBER
// giver alderen, ellers behandles ingen som ung):
//   ROWS_FILE=<dump.json> [SEASON_NUMBER=<n>] PARAMS=<privat params.json> node backend/scripts/potentialP6110Convert.mjs
//
// PARAMS: de private tal (se PotentialPParams i potentialP6110.js). Filen kan VÆRE
// params-objektet eller have det under nøglen "potentialP". Ingen standardværdier.
//
// Output (kun til OUT_DIR, som SKAL ligge under balance-internals/, hard rule 17;
// standard er <repo>/balance-internals/6110):
//   potential-p-convert-<tidsstempel>.json   fuld rapport inkl. pr. rytter
//   potential-p-convert-<tidsstempel>.md     kort læsbar oversigt
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

import {
  STAR_STEPS, YOUNG_AGE_LIMIT, convertStarsToP, findRankViolations, isYoungForP, summarizeP, validatePotentialPParams,
} from "../lib/potentialP6110.js";
import { bestRoleForAbilities } from "../lib/riderBestRoleCache.js";
import { REGISTRY_ABILITY_KEYS } from "../lib/abilityRegistry.js";
import { buildTypePrognosisBands } from "../lib/scoutingReport.js";
import { SCOUTING_CONFIG } from "../lib/scouting.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";

const REPO_ROOT = path.resolve(import.meta.dirname, "../..");
const PRIVATE_DIR_NAME = "balance-internals";
const APPLY_CONCURRENCY = 20;

// ── Rene hjælpere (testes i potentialP6110Convert.test.mjs) ─────────────────

/** OUT_DIR skal ligge under en balance-internals-mappe; ellers kaster den. */
export function resolveOutDir(outDirEnv, repoRoot = REPO_ROOT) {
  const dir = path.resolve(outDirEnv || path.join(repoRoot, PRIVATE_DIR_NAME, "6110"));
  if (!dir.split(/[\\/]+/).includes(PRIVATE_DIR_NAME)) {
    throw new Error(`OUT_DIR must be under ${PRIVATE_DIR_NAME}/ (hard rule 17), got: ${dir}`);
  }
  return dir;
}

/** Læser de private params og afviser dem straks, hvis de ikke er gyldige. */
export function parseParams(json) {
  const params = json && typeof json === "object" && json.potentialP ? json.potentialP : json;
  return validatePotentialPParams(params);
}

/**
 * Argumenterne. --apply uden --owner-go afvises, så en skrivning aldrig sker ved et uheld.
 * @param {string[]} argv
 */
export function parseArgs(argv) {
  const apply = argv.includes("--apply");
  const ownerGo = argv.includes("--owner-go");
  const unknown = argv.filter((a) => a.startsWith("--") && a !== "--apply" && a !== "--owner-go");
  if (unknown.length) throw new Error(`Unknown argument(s): ${unknown.join(", ")}`);
  if (apply && !ownerGo) throw new Error("--apply requires --owner-go (the owner's explicit go after reading the dry-run report)");
  return { apply, ownerGo };
}

/**
 * Rytterens rating for bedste type lige nu: regnet af de afledte evner (samme regel som
 * skønnet, potentialEstimateRead.currentRating), ellers den gemte best_role_rating.
 */
export function currentRating(rider, abilities) {
  const live = abilities
    ? bestRoleForAbilities(abilities, { primaryType: rider.primary_type, secondaryType: rider.secondary_type }).best_role_rating
    : null;
  return live ?? rider.best_role_rating ?? null;
}

/**
 * Toppen af det "Forventet niveau", ejeren af rytteren ser i dag: prognose-båndets top
 * for primær type. Samme kald som ruterne bruger for egne ryttere (maxLevel, holdet som
 * seed), men med standard-scout. null når det ikke kan regnes (ingen evner, type,
 * alder eller stjerner).
 * @param {Record<string, any>} rider  riders-række (id, potentiale, primary_type, secondary_type, team_id)
 * @param {Record<string, any>|null|undefined} abilities
 * @param {{ age: number|null, developmentXp?: unknown }} ctx
 * @returns {number|null}
 */
export function prognosisTop(rider, abilities, { age, developmentXp = null }) {
  if (!abilities || !rider.primary_type || age == null || rider.potentiale == null) return null;
  const bands = buildTypePrognosisBands({
    nowAbilities: abilities, age,
    primaryType: rider.primary_type, secondaryType: rider.secondary_type,
    potentiale: rider.potentiale,
    level: SCOUTING_CONFIG.maxLevel, riderId: rider.id, teamId: rider.team_id ?? null,
    developmentXp,
  });
  const band = bands.find((b) => b.key === rider.primary_type);
  return band && band.progHi != null ? band.progHi : null;
}

/**
 * Selve dry-runnet som ren funktion: omregner og opsummerer. Rører hverken DB eller filer.
 * @param {Array<Record<string, any>>} rows  riders-rækker
 * @param {Map<string, Record<string, any>>} abilitiesById  rider_derived_abilities pr. rytter
 * @param {unknown} params
 * @param {{ asOf: Date, source: string, seasonNumber?: number|null, developmentXp?: unknown }} ctx
 *   seasonNumber: aktiv sæson (giver alderen; null = ingen behandles som ung).
 *   developmentXp: XP-params som prognosen bruger i dag (null = prognosen som før).
 */
export function buildReport(rows, abilitiesById, params, { asOf, source, seasonNumber = null, developmentXp = null }) {
  let missingPotentiale = 0;
  const inputs = [];
  for (const r of rows) {
    if (r.potentiale == null) { missingPotentiale++; continue; }
    const abilities = abilitiesById.get(r.id);
    const age = Number.isFinite(seasonNumber) ? ageForSeason(r.birthdate, seasonNumber) : null;
    // Prognosen regnes kun for unge: kun de kan bruge den.
    const prognosisHi = isYoungForP(age) ? prognosisTop(r, abilities, { age, developmentXp }) : null;
    inputs.push({ id: r.id, potentiale: Number(r.potentiale), rating: currentRating(r, abilities), age, prognosisHi });
  }
  const { byId, skipped } = convertStarsToP(inputs, params);
  const rankViolations = findRankViolations(byId);
  const converted = [...byId.entries()].map(([id, v]) => ({ id, ...v }));

  const perStars = {};
  for (const step of STAR_STEPS) {
    const vals = converted.filter((v) => v.stars === step);
    if (!vals.length) continue;
    perStars[String(step)] = {
      ...summarizeP(vals.map((v) => v.p)),
      lifted: vals.filter((v) => v.lifted).length,
      liftedToPrognosis: vals.filter((v) => v.liftedToPrognosis).length,
    };
  }
  // Ryttere hvis P allerede er udfyldt og afviger, så en gentaget apply kan ses.
  const existing = new Map(rows.map((r) => [r.id, r]));
  const changes = converted.filter((v) => {
    const row = existing.get(v.id);
    return row?.base_talent !== v.p || row?.talent_ceiling !== v.p;
  }).length;

  return {
    kind: "potential-p-convert",
    issue: "#8521",
    measuredAt: asOf.toISOString(),
    source,
    writes: "none",
    seasonNumber: Number.isFinite(seasonNumber) ? seasonNumber : null,
    youngAgeLimit: YOUNG_AGE_LIMIT,
    prognosisUsesDevelopmentXp: Boolean(developmentXp),
    counts: {
      rowsRead: rows.length,
      missingPotentiale,
      converted: byId.size,
      skipped: skipped.length,
      // Hævet til ratingen (28+, ukendt alder, eller ung uden prognose).
      liftedToRating: converted.filter((v) => v.lifted && !v.liftedToPrognosis).length,
      // Ejervalg 21/11: unge hævet til toppen af dagens forventede niveau.
      liftedToPrognosis: converted.filter((v) => v.liftedToPrognosis).length,
      // Heraf unge, der kun fik ratingen, fordi prognosen ikke kunne regnes.
      youngLiftedWithoutPrognosis: converted.filter((v) => v.lifted && !v.liftedToPrognosis && isYoungForP(v.age)).length,
      withoutRating: converted.filter((v) => v.rating == null).length,
      withoutAge: converted.filter((v) => v.age == null).length,
      wouldChange: changes,
    },
    rankViolations: rankViolations.length,
    distribution: summarizeP(converted.map((v) => v.p)),
    distributionBeforeLift: summarizeP(converted.map((v) => v.pBase)),
    perStars,
    riders: converted.map((v) => ({
      id: v.id, stars: v.stars, rating: v.rating, age: v.age, prognosisHi: v.prognosisHi,
      pBase: v.pBase, p: v.p, lifted: v.lifted, liftedToPrognosis: v.liftedToPrognosis,
    })),
    skippedRiders: skipped,
  };
}

export function renderMarkdown(report) {
  const c = report.counts;
  const d = report.distribution;
  const lines = [
    "# Omregning stjerner -> potentiale P (1-99) (#8521)",
    "",
    `- Målt: ${report.measuredAt} (kilde: ${report.source})`,
    `- Skrivninger: ${report.writes}`,
    `- Læst: ${c.rowsRead} · omregnet: ${c.converted} · sprunget over: ${c.skipped} · uden stjerner: ${c.missingPotentiale}`,
    `- Hævet til rating: ${c.liftedToRating} · uden rating: ${c.withoutRating} · ville ændre: ${c.wouldChange}`,
    `- Unge (under ${report.youngAgeLimit}) hævet til toppen af forventet niveau: ${c.liftedToPrognosis} · unge hævet til rating (ingen prognose): ${c.youngLiftedWithoutPrognosis} · uden alder: ${c.withoutAge}`,
    `- Sæson: ${report.seasonNumber ?? "ukendt"} · prognose med XP-model: ${report.prognosisUsesDevelopmentXp ? "ja" : "nej"}`,
    `- Rang-brud: ${report.rankViolations} (krav 0)`,
    "",
    "## Fordeling (P efter hævning)",
    "",
    `- n ${d.n} · median ${d.median} · p90 ${d.p90} · p99 ${d.p99} · >= 80: ${d.atOrAbove80} · >= 90: ${d.atOrAbove90}`,
    "",
    "| P | antal |",
    "|---|---|",
    ...Object.entries(d.histogram).map(([k, v]) => `| ${k} | ${v} |`),
    "",
    "## Pr. stjernetrin",
    "",
    "| stjerner | n | median | p90 | p99 | >= 80 | >= 90 | hævet | heraf til prognose |",
    "|---|---|---|---|---|---|---|---|---|",
    ...Object.entries(report.perStars).map(([s, q]) => `| ${s} | ${q.n} | ${q.median} | ${q.p90} | ${q.p99} | ${q.atOrAbove80} | ${q.atOrAbove90} | ${q.lifted} | ${q.liftedToPrognosis} |`),
  ];
  return lines.join("\n") + "\n";
}

/**
 * Skriver base_talent + talent_ceiling for rytterne i rapporten. Kun ryttere hvis tal
 * afviger fra det gemte, så en gentaget apply er en no-op. Rører intet andet felt.
 * @param {{ from(table: string): any }} sb
 */
export async function applyReport(sb, report, rows, { log = console } = {}) {
  if (report.rankViolations > 0) throw new Error("Refusing to apply: the report has rank violations");
  const existing = new Map(rows.map((r) => [r.id, r]));
  const todo = report.riders.filter((v) => {
    const row = existing.get(v.id);
    return row?.base_talent !== v.p || row?.talent_ceiling !== v.p;
  });
  let written = 0;
  for (let i = 0; i < todo.length; i += APPLY_CONCURRENCY) {
    const batch = todo.slice(i, i + APPLY_CONCURRENCY);
    await Promise.all(batch.map(async (v) => {
      const { error } = await sb.from("riders").update({ base_talent: v.p, talent_ceiling: v.p }).eq("id", v.id);
      if (error) throw new Error(`riders ${v.id}: ${error.message}`);
      written++;
    }));
  }
  log.log?.(`Applied: ${written} riders written (base_talent + talent_ceiling).`);
  return { written };
}

// ── I/O (kun når scriptet køres direkte) ───────────────────────────────────

async function liveClient() {
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("Missing SUPABASE secrets (infisical run --env=prod), or use ROWS_FILE");
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
}

async function selectAll(sb, table, columns, filter = (q) => q, orderBy = "id") {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    // Stabil, unik sortering, ellers kan PostgREST-sider overlappe.
    const { data, error } = await filter(sb.from(table).select(columns)).order(orderBy, { ascending: true }).range(from, from + PAGE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

async function main() {
  const { apply } = parseArgs(process.argv.slice(2));
  const { PARAMS, ROWS_FILE, OUT_DIR, SEASON_NUMBER } = process.env;
  if (!PARAMS) {
    console.error("Usage: PARAMS=<private params.json> [ROWS_FILE=<dump.json> [SEASON_NUMBER=<n>]] [OUT_DIR=<balance-internals/...>] node backend/scripts/potentialP6110Convert.mjs [--apply --owner-go]");
    process.exit(1);
  }
  const outDir = resolveOutDir(OUT_DIR);
  const params = parseParams(JSON.parse(fs.readFileSync(PARAMS, "utf8")));
  const asOf = new Date();

  let rows;
  let abilitiesById;
  let source;
  let sb = null;
  let seasonNumber = null;
  let developmentXp = null;
  if (ROWS_FILE) {
    if (apply) throw new Error("--apply needs the live database, not ROWS_FILE");
    rows = JSON.parse(fs.readFileSync(ROWS_FILE, "utf8"));
    abilitiesById = new Map(rows.filter((r) => r.abilities).map((r) => [r.id, r.abilities]));
    seasonNumber = SEASON_NUMBER ? Number(SEASON_NUMBER) : null;
    source = `file ${path.basename(ROWS_FILE)}`;
  } else {
    sb = await liveClient();
    rows = await selectAll(sb, "riders",
      "id, potentiale, birthdate, team_id, primary_type, secondary_type, best_role_rating, base_talent, talent_ceiling",
      (q) => q.or("is_retired.is.null,is_retired.eq.false"));
    const abilityRows = await selectAll(sb, "rider_derived_abilities", `rider_id, ${REGISTRY_ABILITY_KEYS.join(", ")}`, (q) => q, "rider_id");
    abilitiesById = new Map(abilityRows.map((a) => [a.rider_id, a]));
    // Aktiv sæson, samme opslag (og fallback) som ruternes getActiveSeasonNumber.
    const { data: season, error: seasonErr } = await sb.from("seasons").select("number").eq("status", "active").maybeSingle();
    if (seasonErr) throw new Error(`seasons: ${seasonErr.message}`);
    seasonNumber = season?.number ?? 1;
    // XP-params som prognosen bruger i dag (null = prognosen som før), samme loader som ruterne.
    const { loadEstimateDevelopmentXp } = await import("../lib/potentialEstimateWriter.js");
    developmentXp = await loadEstimateDevelopmentXp(sb);
    source = "live SELECT riders + rider_derived_abilities + seasons";
  }

  const report = buildReport(rows, abilitiesById, params, { asOf, source, seasonNumber, developmentXp });
  if (apply) report.writes = "base_talent + talent_ceiling (--apply --owner-go)";
  fs.mkdirSync(outDir, { recursive: true });
  const stamp = asOf.toISOString().replace(/[:.]/g, "-");
  const jsonPath = path.join(outDir, `potential-p-convert-${stamp}.json`);
  const mdPath = path.join(outDir, `potential-p-convert-${stamp}.md`);
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2));
  fs.writeFileSync(mdPath, renderMarkdown(report));
  console.log(`Private report: ${jsonPath}`);
  console.log(`Private summary: ${mdPath}`);
  console.log(`Rank violations: ${report.rankViolations}.`);
  if (report.rankViolations > 0) process.exitCode = 2;

  if (apply && sb) {
    await applyReport(sb, report, rows);
  } else {
    console.log("Dry-run done (no database writes).");
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error(err?.stack || String(err));
    process.exit(1);
  });
}
