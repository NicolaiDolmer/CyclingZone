#!/usr/bin/env node
// #5518 · C1: måling af felt-gaten for ungdomsløb (READ-ONLY).
//
// DEN LÅSTE REGEL (ejer 2/9, YOUTH_RULES §2.3, addendum-scorecard C1):
// "Hvert ungdomsløb skal have et køreligt felt via AI-fyld i 100 % af
// simulerede løbsdage ved nuværende population. Fejler den, skæres antal
// divisioner, aldrig antallet af løb til nul." Startformen er seniorens 1/2/4/8.
//
// HVAD SCRIPTET MÅLER
// For hver pyramideform (1/2/4/8, 1/2/4, 1/2, 1) og hver løbsdag i en sæson:
// hvor mange hold kan stille op i puljens ungdomsløb, og hvor stort bliver
// feltet? Et hold stiller op når det har mindst `MIN_RACE_ENTRIES` raske
// ryttere i truppen (raceAutopick.js, ejer 27/8, gælder alle løb), og det
// stiller med højst løbsklassens feltstørrelse (`selectionSizeForRace`, læst af
// selve ungdomskataloget i `race_pool`).
//
// Populationen i målsæsonen (default S4), på SSOT'ens alders-akse:
//   - menneskeholdenes ungdomsryttere (squad/is_academy) med sæsonalder i
//     truppens interval — en rytter der er vokset ud (Graduation Day) tælles ikke
//   - AI-holdenes A6-trup, beregnet af SAMME plan-funktion som generatoren
//     (backend/scripts/generateYouthSquadsS4.js), så målingen og en senere apply
//     umuligt kan se to forskellige kuld
//   - truppens loft (`SQUAD_CAPS`) respekteres
// Scenarie "upper" lægger menneskeholdenes 19-22-årige SENIORER oveni (hvis
// managerne selv flyttede dem ned, spillerens eget valg, YOUTH_RULES §2.2) —
// en øvre grænse, ikke en prognose.
//
// PULJETILKNYTNING
//   mirror      spec 2026-09-15 §6.1: holdets ungdomspulje spejler seniorpuljen;
//               har ungdomspyramiden færre tiers, lægges de nederste tiers
//               sammen i deres forældre-pulje (pool j på tier t → pool j>>1 på t-1)
//   ai-balanced hvad-hvis: menneskehold spejler, men AI-holdenes ungdomstrup
//               placeres i den pulje der har færrest startende hold (grådigt).
//               Viser om færre skæringer er mulige hvis AI-trupperne fordeles
//               efter behov i stedet for at følge seniorpuljen.
//
// LØBSDAGE
// 140 løbsdage (ejer 15/9, samme mål som senior); hver pulje tælles som om den
// har et løb hver løbsdag (værste tilfælde — U23 kører 1-2 løb om ugen).
// Tilgængelighed pr. dag: med `--unavailable` > 0 er hver rytter utilgængelig
// med den sandsynlighed pr. løbsdag (deterministisk, seedet). 0 = "nuværende
// population" som gaten er låst til; de øvrige niveauer er stress-tests.
//
// "KØRELIGT FELT" har intet tal i SSOT'en. Scriptet afgør derfor ikke selv en
// tærskel: det rapporterer det mindste felt pr. form og om gaten holder ved en
// række gulve (startende hold), og ejeren tager stilling på det grundlag.
//
// OUTPUT: KUN til balance-internals/ (gitignoreret, hard rule 17): præcise
// feltstørrelser pr. pulje er balance-tal. Stdout viser kun bestået/fejlet pr. form.
//
// Usage (fra backend/):
//   infisical run --env=prod --silent -- node scripts/measureYouthFieldGate.mjs --juniors=N
//   ... --squad=u23|junior|both   (default u23; junior kræver --juniors)
//   ... --out=../balance-internals/<fil>.md
//   ... --season=5 --gap-season=4   # benchmark af gab (default: sæsonen før målsæsonen)
//   ... --no-benchmark              # kun felt-gaten
//
// #6668: AI-holdenes EKSISTERENDE ungdom tælles med (efter S4-cutover har de deres
// trupper; planen giver kun nye kuld til hold uden trup, samme idempotens som
// generatoren), og rapporten får en benchmark af gab: gap10 pr. terræn i ungdoms-
// løbene mod senior og mod Grand Tour-referencen, og niveau-gabet menneske vs. AI
// (i dag og efter løftet) med seniorernes bånd ved siden af.
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Kun SELECT — scriptet har ingen skrivesti.
// Exit: 0 = rapport skrevet, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { loadS5Benchmark } from "../lib/s5BenchmarkGate.js";
// Samme evne-liste som generatorens niveau-mål (bestAbility over de synlige evner).
import { VISIBLE_ABILITIES as LEVEL_ABILITIES } from "../lib/abilityDerivation.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { ACADEMY } from "../lib/academyFlag.js";
import { SQUAD_MAX_AGE, SQUAD_CAPS, isYouthSquad, squadForSeasonAge } from "../lib/squads.js";
import { MIN_RACE_ENTRIES, selectionSizeForRace } from "../lib/raceAutopick.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { hashStringToSeed } from "../lib/starterSquadAllocator.js";
import {
  loadValuationModel,
  loadProductionValueModel,
  loadValuationModelById,
  DEFAULT_VALUATION_MODEL_ID,
} from "../lib/riderValuationModelSelect.js";
import {
  planYouthSquads,
  planYouthLift,
  loadActiveAiTeams,
  loadPopulation,
  loadLevelInputs,
  buildHumanLevelProfile,
  assertBalanceInternalsPath,
  DEFAULT_TARGET_SEASON,
  DEFAULT_SEED,
} from "./generateYouthSquadsS4.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

/** Pyramideformerne C1 måler (spec §6.1: start 1/2/4/8, skæres nedefra). */
export const PYRAMID_FORMS = Object.freeze([
  Object.freeze([1, 2, 4, 8]),
  Object.freeze([1, 2, 4]),
  Object.freeze([1, 2]),
  Object.freeze([1]),
]);
/** Løbsdage pr. sæson (ejer 15/9: 140 i alle divisioner, samme mål for alle trupper). */
export const RACE_DAYS = 140;
/** Gulve (startende hold) gaten vises ved. Ikke en beslutning — se topkommentaren. */
export const MIN_TEAM_FLOORS = Object.freeze([2, 4, 6, 8, 12]);
export const DEFAULT_UNAVAILABLE = Object.freeze([0, 0.05, 0.1, 0.15]);
/** Løbsberettiget fra sæsonalder 16 (YOUTH_RULES §2.1, ejer 24/9 #5645: hele juniortruppen 16-18 må køre). Deles med akademiets mindstealder. */
export const JUNIOR_RACE_MIN_AGE = ACADEMY.MIN_AGE;
const SEED = 0x5518c1;

// ── Rene funktioner ──────────────────────────────────────────────────────────
/**
 * Ungdomspuljen et hold havner i for en given form, ved spejling af seniorpuljen.
 * @param {{tier:number, pool_index:number}} senior
 * @param {readonly number[]} form  antal puljer pr. tier, fx [1,2,4]
 * @returns {{tier:number, pool_index:number}}
 */
export function mirrorPool(senior, form) {
  const k = form.length;
  if (senior.tier <= k) return { tier: senior.tier, pool_index: senior.pool_index };
  return { tier: k, pool_index: senior.pool_index >> (senior.tier - k) };
}

export const poolKey = (p) => `${p.tier}:${p.pool_index}`;

/** Alle puljer i en form. */
export function poolsOfForm(form) {
  return form.flatMap((n, i) => Array.from({ length: n }, (_, j) => ({ tier: i + 1, pool_index: j })));
}

/**
 * Hvor mange ryttere pr. hold er i truppen ved målsæsonen? Ren funktion.
 *
 * @param {object} args
 * @param {Array} args.riders   { id, team_id, birthdate, squad, is_academy, is_retired }
 * @param {Set<string>} args.humanTeamIds
 * @param {"u23"|"junior"} args.squad
 * @param {number} args.season
 * @param {boolean} [args.includeHumanSeniors]  scenarie "upper"
 * @returns {Map<string, string[]>} team_id → rider-id'er (løbsberettigede)
 */
export function youthRosterByTeam({ riders, humanTeamIds, squad, season, includeHumanSeniors = false }) {
  const minAge = squad === "junior" ? JUNIOR_RACE_MIN_AGE : SQUAD_MAX_AGE.junior + 1;
  const maxAge = SQUAD_MAX_AGE[squad];
  const out = new Map();
  for (const r of riders) {
    if (r.is_retired === true || !r.team_id || !humanTeamIds.has(r.team_id)) continue;
    const age = ageForSeason(r.birthdate, season);
    if (!Number.isFinite(age) || age < minAge || age > maxAge) continue;
    const youth = r.is_academy === true || isYouthSquad(r.squad);
    if (!youth && !(includeHumanSeniors && squadForSeasonAge(age) === squad)) continue;
    if (!out.has(r.team_id)) out.set(r.team_id, []);
    out.get(r.team_id).push(r.id);
  }
  // Truppens loft: flere end loftet kan ikke stå i truppen.
  for (const [teamId, ids] of out) out.set(teamId, ids.slice(0, SQUAD_CAPS[squad]));
  return out;
}

/**
 * Placér hold i puljer for én form.
 * @param {Array<{id:string, tier:number, pool_index:number, is_ai:boolean}>} teams
 * @param {Map<string, string[]>} rosters
 * @param {readonly number[]} form
 * @param {"mirror"|"ai-balanced"} mapping
 * @returns {Map<string, string[]>} poolKey → team_id'er (kun hold med en trup)
 */
export function assignPools(teams, rosters, form, mapping) {
  const pools = new Map(poolsOfForm(form).map((p) => [poolKey(p), []]));
  const withRoster = teams.filter((t) => (rosters.get(t.id)?.length ?? 0) > 0);
  const starters = (key) => pools.get(key).filter((id) => (rosters.get(id)?.length ?? 0) >= MIN_RACE_ENTRIES).length;
  const aiLater = [];
  for (const t of withRoster) {
    if (mapping === "ai-balanced" && t.is_ai) { aiLater.push(t); continue; }
    pools.get(poolKey(mirrorPool(t, form))).push(t.id);
  }
  // Grådigt: største AI-trup først i den pulje der har færrest startende hold.
  aiLater.sort((a, b) => (rosters.get(b.id).length - rosters.get(a.id).length) || String(a.id).localeCompare(String(b.id)));
  const order = [...pools.keys()];
  for (const t of aiLater) {
    const target = order.reduce((best, key) => (starters(key) < starters(best) ? key : best), order[0]);
    pools.get(target).push(t.id);
  }
  return pools;
}

/**
 * Simulér løbsdagene for én form. Ren + deterministisk.
 * @returns {{perPool: Array<{pool:string, teams:number, minStarters:number, maxStarters:number, minRiders:number, maxRiders:number}>, minStarters:number, minRiders:number, maxRiders:number}}
 */
export function simulateForm({ pools, rosters, raceDays = RACE_DAYS, unavailable = 0, fieldMax, seed = SEED }) {
  const perPool = [];
  for (const [pool, teamIds] of pools) {
    let minStarters = Infinity, maxStarters = 0, minRiders = Infinity, maxRiders = 0;
    for (let day = 0; day < raceDays; day++) {
      let starters = 0, riders = 0;
      for (const teamId of teamIds) {
        const ids = rosters.get(teamId) ?? [];
        let available = ids.length;
        if (unavailable > 0) {
          available = 0;
          for (const id of ids) {
            const rng = makeRng((seed ^ hashStringToSeed(`${id}:${day}`)) >>> 0);
            if (rng() >= unavailable) available++;
          }
        }
        if (available >= MIN_RACE_ENTRIES) {
          starters++;
          riders += Math.min(available, fieldMax);
        }
      }
      minStarters = Math.min(minStarters, starters); maxStarters = Math.max(maxStarters, starters);
      minRiders = Math.min(minRiders, riders); maxRiders = Math.max(maxRiders, riders);
    }
    perPool.push({ pool, teams: teamIds.length, minStarters, maxStarters, minRiders, maxRiders });
  }
  return {
    perPool,
    minStarters: Math.min(...perPool.map((p) => p.minStarters)),
    minRiders: Math.min(...perPool.map((p) => p.minRiders)),
    maxRiders: Math.max(...perPool.map((p) => p.maxRiders)),
  };
}

/** Holder gaten ved et gulv? 100 % af (pulje, løbsdag) skal have mindst `floor` startende hold. */
export const gatePasses = (result, floor) => result.minStarters >= floor;

// ── #6668: benchmark af ungdomsfelternes gab ─────────────────────────────────
// Ejer 15/10 (#6667): felterne måles mod virkelige gab, FØR kalenderen skrives.
// To mål, begge read-only og kun til balance-internals/:
//   1) TIDS-gab: gap10 (tid fra vinder til nr. 10) i en afviklet sæsons ungdomsløb
//      pr. terræn, mod seniorløbene i samme sæson og mod den virkelige reference
//      (Grand Tour-etaper 2021-2025, backend/lib/__fixtures__/s5Benchmark…json,
//      samme kilde som S5-benchmark-gaten). Etapeløb måles på etaperne, endagsløb
//      på slutresultatet.
//   2) NIVEAU-gab: bedste synlige evne pr. trup for menneskeholdenes ungdom, AI-
//      ungdommen i dag, AI-ungdommen efter #6668-løftet, og seniorerne som bånd.
/** Benchmarkens terræn-navne → spillets profile_type. Holdtidskørsel er udeladt. */
export const BENCHMARK_TERRAIN_TO_PROFILE = Object.freeze({
  flad: "flat",
  boelget: "rolling",
  kuperet: "hilly",
  mellembjerg: "medium_mountain",
  bjerg: "mountain",
  hojbjerg: "high_mountain",
  itt: "itt",
});

/** "+m:ss" / "+h:mm:ss" / "0:00" → sekunder; alt andet → null. */
export function finishTimeSeconds(t) {
  if (t == null) return null;
  const m = /^\+?(\d+(?::\d{1,2}){0,2})$/.exec(String(t).trim());
  if (!m) return null;
  return m[1].split(":").reduce((s, x) => s * 60 + Number(x), 0);
}

const quartiles = (xs) => {
  const s = xs.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return { n: 0, p25: null, median: null, p75: null };
  const at = (p) => {
    const i = (s.length - 1) * p;
    const lo = Math.floor(i);
    const hi = Math.ceil(i);
    return s[lo] + (s[hi] - s[lo]) * (i - lo);
  };
  return { n: s.length, p25: at(0.25), median: at(0.5), p75: at(0.75) };
};

/** n, gns, median, p90, max for en liste niveauer. Ren. */
export function describeLevels(xs) {
  const s = (xs || []).filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return { n: 0, mean: null, median: null, p90: null, max: null };
  const at = (p) => s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
  return { n: s.length, mean: s.reduce((a, b) => a + b, 0) / s.length, median: at(0.5), p90: at(0.9), max: s[s.length - 1] };
}

/**
 * gap10 pr. (trup, terræn) for en sæsons resultater. Ren.
 * @param {Array<{squad:string|null, profile_type:string|null, finish_time:string}>} rows
 *        én række pr. målt løb/etape: resultatet for nr. 10
 * @returns {Map<string, Map<string, {n,p25,median,p75}>>} trup → terræn → kvartiler
 */
export function gap10BySquadTerrain(rows) {
  const acc = new Map();
  for (const r of rows || []) {
    const sec = finishTimeSeconds(r.finish_time);
    if (sec == null || !r.profile_type) continue;
    const squad = r.squad || "senior";
    if (!acc.has(squad)) acc.set(squad, new Map());
    const byT = acc.get(squad);
    if (!byT.has(r.profile_type)) byT.set(r.profile_type, []);
    byT.get(r.profile_type).push(sec);
  }
  return new Map([...acc].map(([sq, byT]) => [sq, new Map([...byT].map(([t, xs]) => [t, quartiles(xs)]))]));
}

/** Den virkelige reference pr. terræn (benchmark-filens gap10). Ren. */
export function benchmarkGapByTerrain(benchmark) {
  const by = new Map();
  for (const r of benchmark || []) {
    const t = BENCHMARK_TERRAIN_TO_PROFILE[r?.terrain];
    if (!t || r.gap10_s == null || !Number.isFinite(Number(r.gap10_s))) continue;
    if (!by.has(t)) by.set(t, []);
    by.get(t).push(Number(r.gap10_s));
  }
  return new Map([...by].map(([t, xs]) => [t, quartiles(xs)]));
}

/**
 * Dom pr. (trup, terræn): ungdommens median mod referencens kvartil-interval.
 * "inside" / "above" (for store gab) / "below" (for små gab). Ren.
 */
export function gapVerdict(median, ref) {
  if (median == null || !ref || ref.p25 == null) return null;
  if (median > ref.p75) return "above";
  if (median < ref.p25) return "below";
  return "inside";
}

// ── I/O ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const get = (name) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    const eq = hit.indexOf("=");
    return eq === -1 ? true : hit.slice(eq + 1);
  };
  // Samme strenge heltals-parsing som generatorens parseArgs: et bart `--juniors`
  // (true → 1) eller `--juniors=` ("" → 0) må aldrig blive til et antal ejeren
  // ikke har valgt.
  const intArg = (name, raw) => {
    if (raw === true || raw === "" || !/^-?\d+$/.test(String(raw))) {
      throw new Error(`--${name} skal være et helt tal (fik ${JSON.stringify(raw)})`);
    }
    return Number(raw);
  };
  const squadArg = get("squad") ?? "u23";
  if (!["u23", "junior", "both"].includes(squadArg)) throw new Error(`--squad skal være u23, junior eller both (fik ${squadArg})`);
  const juniorsRaw = get("juniors");
  const juniors = juniorsRaw === undefined ? null : intArg("juniors", juniorsRaw);
  if (juniors !== null && (juniors < 0 || juniors > SQUAD_CAPS.junior)) {
    throw new Error(`--juniors skal være et helt tal i [0,${SQUAD_CAPS.junior}]`);
  }
  if (squadArg !== "u23" && juniors === null) {
    throw new Error("junior-målingen kræver --juniors=N (antal AI-juniorer pr. hold er et ejer-valg, intet default)");
  }
  const season = get("season") === undefined ? DEFAULT_TARGET_SEASON : intArg("season", get("season"));
  if (season < 1) throw new Error(`--season skal være ≥ 1 (fik ${season})`);
  const unavailable = get("unavailable") === undefined
    ? [...DEFAULT_UNAVAILABLE]
    : String(get("unavailable")).split(",").map(Number);
  if (unavailable.some((p) => !(p >= 0 && p < 1))) throw new Error("--unavailable skal være tal i [0,1)");
  const stamp = new Date().toISOString().slice(0, 10);
  const out = assertBalanceInternalsPath(
    get("out") && get("out") !== true ? get("out") : join(REPO_ROOT, "balance-internals", `5518-c1-field-gate-${stamp}.md`),
  );
  // #6668: benchmark af gab er default; tids-gabet måles på den seneste afviklede
  // sæson før målsæsonen, medmindre --gap-season vælger en anden.
  const benchmark = get("no-benchmark") !== true;
  const gapSeason = get("gap-season") === undefined ? season - 1 : intArg("gap-season", get("gap-season"));
  if (gapSeason < 1) throw new Error(`--gap-season skal være ≥ 1 (fik ${gapSeason})`);
  return { squads: squadArg === "both" ? ["u23", "junior"] : [squadArg], juniors: juniors ?? 0, season, unavailable, out, benchmark, gapSeason };
}

async function loadInputs(supabase) {
  const [teams, pools, riders, catalog] = await Promise.all([
    fetchAllRows(() => supabase.from("teams")
      .select("id, is_ai, is_bank, is_frozen, is_test_account, league_division_id, pending_removal_at, retired_at, parked_at")
      .order("id")),
    fetchAllRows(() => supabase.from("league_divisions").select("id, tier, pool_index").order("id")),
    // schema-columns-ok: riders.squad findes i prod (#4619, verificeret 23/9 i
    // information_schema); schema-snapshot.json er ikke gen-dumpet siden.
    fetchAllRows(() => supabase.from("riders")
      .select("id, team_id, birthdate, squad, is_academy, is_retired")
      .not("team_id", "is", null)
      .order("id")),
    // schema-columns-ok: race_pool.squad findes i prod (U23-/juniorkataloget,
    // verificeret 23/9 i information_schema); snapshottet er ældre end kolonnen.
    fetchAllRows(() => supabase.from("race_pool").select("race_class, squad").order("id")),
  ]);
  const poolById = new Map(pools.map((p) => [p.id, p]));
  const active = teams
    .filter((t) => !t.is_bank && !t.is_test_account && !t.is_frozen)
    .filter((t) => !t.pending_removal_at && !t.retired_at && !t.parked_at)
    .filter((t) => poolById.has(t.league_division_id))
    .map((t) => {
      // Kun tier/pool_index fra puljen — puljens eget `id` må ikke overskrive holdets.
      const { tier, pool_index } = poolById.get(t.league_division_id);
      return { id: t.id, is_ai: t.is_ai === true, tier, pool_index };
    });
  return { teams: active, riders, catalog };
}

function fieldMaxForSquad(catalog, squad) {
  const classes = [...new Set(catalog.filter((r) => r.squad === squad).map((r) => r.race_class))];
  if (!classes.length) return { max: selectionSizeForRace(null).max, classes: [] };
  return { max: Math.max(...classes.map((c) => selectionSizeForRace({ race_class: c }).max)), classes };
}

function renderBenchmark(bench) {
  if (!bench) return [];
  const L = ["", `## Benchmark af gab (#6668) - gap10 i S${bench.gapSeason}, sekunder`, ""];
  L.push("Median (p25-p75, n) pr. terræn. Reference = Grand Tour-etaper 2021-2025 (seniorer, virkelige). Dom = ungdommens median mod referencens kvartil-interval.", "");
  const terrains = [...new Set([...bench.ref.keys(), ...[...bench.gaps.values()].flatMap((m) => [...m.keys()])])].sort();
  const cell = (q) => (q && q.n ? `${Math.round(q.median)} (${Math.round(q.p25)}-${Math.round(q.p75)}, ${q.n})` : "-");
  L.push("| terræn | reference | senior | U23 | junior | dom U23 | dom junior |", "|---|---|---|---|---|---|---|");
  for (const t of terrains) {
    const ref = bench.ref.get(t);
    const g = (sq) => bench.gaps.get(sq)?.get(t);
    L.push(`| ${t} | ${cell(ref)} | ${cell(g("senior"))} | ${cell(g("u23"))} | ${cell(g("junior"))} | ${gapVerdict(g("u23")?.median ?? null, ref) ?? "-"} | ${gapVerdict(g("junior")?.median ?? null, ref) ?? "-"} |`);
  }
  if (bench.levels) {
    L.push("", "### Niveau-gab (bedste synlige evne) pr. trup", "");
    L.push("| trup | gruppe | n | gns | median | p90 | max |", "|---|---|---:|---:|---:|---:|---:|");
    for (const row of bench.levels) {
      const d = row.stats;
      L.push(`| ${row.squad} | ${row.group} | ${d.n} | ${d.mean == null ? "-" : d.mean.toFixed(1)} | ${d.median ?? "-"} | ${d.p90 ?? "-"} | ${d.max ?? "-"} |`);
    }
  }
  return L;
}

function render({ args, results, meta, bench = null }) {
  const L = [];
  L.push(`# #5518 C1 - felt-gate for ungdomsløb (S${args.season})`, "");
  L.push("PRIVAT (balance-internals/, hard rule 17). Genereret af backend/scripts/measureYouthFieldGate.mjs (read-only).", "");
  L.push(`- Løbsdage: ${RACE_DAYS} · startgulv pr. hold: ${MIN_RACE_ENTRIES} · AI-juniorer pr. hold: ${args.juniors}`);
  L.push(`- Aktive hold: ${meta.teams} (AI ${meta.aiTeams})`, "");
  for (const squad of args.squads) {
    const m = meta.bySquad[squad];
    L.push(`## ${squad === "u23" ? "U23" : "Junior"}`, "");
    L.push(`- Feltstørrelse pr. hold (katalogets klasser ${m.classes.join(", ") || "-"}): ${m.fieldMax}`);
    L.push(`- Hold med trup ≥ ${MIN_RACE_ENTRIES}: menneske ${m.humanStarters.base} (upper ${m.humanStarters.upper}) · AI ${m.aiStarters}`);
    L.push(`- Ryttere i trupperne: menneske ${m.humanRiders.base} (upper ${m.humanRiders.upper}) · AI ${m.aiRiders}`, "");
    L.push(`| scenarie | puljer | form | utilgæng. | min. startende hold | min. felt | max. felt | ${MIN_TEAM_FLOORS.map((f) => `≥${f}`).join(" | ")} |`);
    L.push(`|---|---|---|---:|---:|---:|---:|${MIN_TEAM_FLOORS.map(() => "---").join("|")}|`);
    for (const r of results.filter((x) => x.squad === squad)) {
      L.push(`| ${r.scenario} | ${r.mapping} | ${r.form.join("/")} | ${r.unavailable} | ${r.result.minStarters} | ${r.result.minRiders} | ${r.result.maxRiders} | ${MIN_TEAM_FLOORS.map((f) => (gatePasses(r.result, f) ? "ok" : "FEJL")).join(" | ")} |`);
    }
    L.push("");
    L.push("### Pr. pulje (base, utilgængelighed 0)", "");
    for (const r of results.filter((x) => x.squad === squad && x.scenario === "base" && x.unavailable === 0)) {
      L.push(`**${r.mapping} ${r.form.join("/")}:** ${r.result.perPool.map((p) => `${p.pool}=${p.minStarters}h/${p.minRiders}r`).join(" · ")}`, "");
    }
  }
  L.push(...renderBenchmark(bench));
  return L.join("\n");
}

/** gap10-rækker (nr. 10) for en sæson: etaper for etapeløb, slutresultat for endagsløb. Kun SELECT. */
async function loadGapRows(supabase, seasonNumber) {
  const { data: season, error } = await supabase.from("seasons").select("id").eq("number", seasonNumber).maybeSingle();
  if (error) throw new Error(`sæson ${seasonNumber}: ${error.message}`);
  if (!season) return [];
  // schema-columns-ok: races.squad findes i prod (U23-/juniorløb, #5517), verificeret 15/10 i information_schema.
  const races = await fetchAllRows(() => supabase.from("races").select("id, squad, race_type").eq("season_id", season.id).order("id"));
  const byId = new Map(races.map((r) => [r.id, r]));
  const ids = races.map((r) => r.id);
  if (!ids.length) return [];
  const [results, profiles] = await Promise.all([
    fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("race_results")
      .select("race_id, stage_number, result_type, finish_time")
      .in("race_id", chunk).eq("rank", 10).in("result_type", ["stage", "gc"])
      .order("race_id").order("stage_number").order("result_type")),
    fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("race_stage_profiles")
      .select("race_id, stage_number, profile_type")
      .in("race_id", chunk)
      .order("race_id").order("stage_number")),
  ]);
  const profileOf = new Map(profiles.map((p) => [`${p.race_id}:${p.stage_number}`, p.profile_type]));
  return results
    .filter((r) => {
      const race = byId.get(r.race_id);
      // Etapeløb: etaperne. Endagsløb: slutresultatet (der er ingen etape-række).
      return race && (race.race_type === "stage_race" ? r.result_type === "stage" : r.result_type === "gc");
    })
    .map((r) => ({ squad: byId.get(r.race_id).squad, profile_type: profileOf.get(`${r.race_id}:${r.stage_number}`) ?? null, finish_time: r.finish_time }));
}

async function loadSeniorLevels(supabase, seasonNumber) {
  const riders = await fetchAllRows(() => supabase.from("riders")
    .select("id, birthdate, squad, is_retired, team_id")
    .eq("squad", "senior").not("team_id", "is", null)
    .order("id"));
  const young = riders.filter((r) => r.is_retired !== true && ageForSeason(r.birthdate, seasonNumber) >= SQUAD_MAX_AGE.u23 + 1
    && ageForSeason(r.birthdate, seasonNumber) <= SQUAD_MAX_AGE.u23 + 3);
  const rows = await fetchAllRowsChunkedIn(young.map((r) => r.id), (chunk) => supabase.from("rider_derived_abilities")
    .select(["rider_id", ...LEVEL_ABILITIES].join(", ")).in("rider_id", chunk).order("rider_id"));
  return rows.map((r) => Math.max(...LEVEL_ABILITIES.map((k) => Number(r[k])).filter(Number.isFinite)));
}

/**
 * #6668: de modeller app_config VÆLGER lige nu, præcis som generatoren (og derive'en)
 * henter dem. Løftets kandidatvalg afhænger af værdiloftet, så en hårdkodet model
 * ville vælge andre kandidater end apply og give en forkert "AI efter løft"-fordeling.
 * Fail-safe (v4) ligger i loaderne; loaderne kan injiceres til test.
 */
export async function loadLiveValuationModels(supabase, loaders = {}) {
  const loadValuation = loaders.loadValuationModel ?? loadValuationModel;
  const loadProduction = loaders.loadProductionValueModel ?? loadProductionValueModel;
  const fallback = loaders.loadValuationModelById ?? loadValuationModelById;
  const valuationModel = await loadValuation(supabase) ?? fallback(DEFAULT_VALUATION_MODEL_ID);
  const productionValuationModel = await loadProduction(supabase);
  return { valuationModel, productionValuationModel };
}

async function main() {
  let args;
  try {
    args = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_KEY;
  if (!url || !key) {
    console.error("SUPABASE_URL + SUPABASE_SERVICE_KEY mangler (backend/.env eller infisical run --env=prod).");
    process.exit(2);
  }
  const supabase = createClient(url, key, { auth: { persistSession: false } });
  const { teams, riders, catalog } = await loadInputs(supabase);

  // A6-kuldet fra SAMME plan-funktion som generatoren. Navnene er ligegyldige
  // her (tomt navne-sæt), antal og alder er det der tæller — og de afhænger
  // kun af seed + hold-id, ikke af navnene.
  const { valuationModel, productionValuationModel } = await loadLiveValuationModels(supabase);
  const aiTeams = await loadActiveAiTeams(supabase);
  // #6668: hold der allerede HAR en trup (efter S4-cutover) får ikke et nyt kuld
  // i planen — samme idempotens som generatoren. Deres eksisterende ryttere tælles
  // i stedet nedenfor, så målingen ser trupperne som de faktisk står.
  const population = await loadPopulation(supabase, aiTeams.map((t) => t.id));
  const plan = planYouthSquads({
    teams: aiTeams, juniorsPerTeam: args.juniors, targetSeason: args.season, seed: DEFAULT_SEED,
    valuationModel, productionValuationModel,
    existingByTeam: population.existingByTeam,
  });

  const humanTeamIds = new Set(teams.filter((t) => !t.is_ai).map((t) => t.id));
  const aiTeamIds = new Set(teams.filter((t) => t.is_ai).map((t) => t.id));
  const results = [];
  const meta = { teams: teams.length, aiTeams: teams.filter((t) => t.is_ai).length, bySquad: {} };

  for (const squad of args.squads) {
    // AI-holdenes eksisterende ungdom (målsæsonens alder, truppens loft) + et evt. nyt kuld.
    const aiRoster = youthRosterByTeam({ riders, humanTeamIds: aiTeamIds, squad, season: args.season });
    for (const r of plan.rows) {
      if (r.squad !== squad || (squad === "junior" && r.age < JUNIOR_RACE_MIN_AGE)) continue;
      if (!aiRoster.has(r.teamId)) aiRoster.set(r.teamId, []);
      aiRoster.get(r.teamId).push(`${r.teamId}#${aiRoster.get(r.teamId).length}`);
    }
    const { max: fieldMax, classes } = fieldMaxForSquad(catalog, squad);
    const scenarios = {
      base: youthRosterByTeam({ riders, humanTeamIds, squad, season: args.season }),
      upper: youthRosterByTeam({ riders, humanTeamIds, squad, season: args.season, includeHumanSeniors: true }),
    };
    const count = (m, pred) => [...m.values()].filter(pred).length;
    const sum = (m) => [...m.values()].reduce((s, v) => s + v.length, 0);
    meta.bySquad[squad] = {
      fieldMax, classes,
      humanStarters: { base: count(scenarios.base, (v) => v.length >= MIN_RACE_ENTRIES), upper: count(scenarios.upper, (v) => v.length >= MIN_RACE_ENTRIES) },
      humanRiders: { base: sum(scenarios.base), upper: sum(scenarios.upper) },
      aiStarters: count(aiRoster, (v) => v.length >= MIN_RACE_ENTRIES),
      aiRiders: sum(aiRoster),
    };
    for (const [scenario, human] of Object.entries(scenarios)) {
      const rosters = new Map([...human, ...aiRoster]);
      for (const mapping of ["mirror", "ai-balanced"]) {
        for (const form of PYRAMID_FORMS) {
          const pools = assignPools(teams, rosters, form, mapping);
          for (const unavailable of args.unavailable) {
            const result = simulateForm({ pools, rosters, unavailable, fieldMax });
            results.push({ squad, scenario, mapping, form, unavailable, result });
          }
        }
      }
    }
  }

  let bench = null;
  if (args.benchmark) {
    const gaps = gap10BySquadTerrain(await loadGapRows(supabase, args.gapSeason));
    const ref = benchmarkGapByTerrain(loadS5Benchmark());
    // Niveau-gabet: menneske vs. AI i dag vs. AI efter #6668-løftet, og seniorernes bånd.
    const levelInputs = await loadLevelInputs(supabase, aiTeams.map((t) => t.id));
    const profile = buildHumanLevelProfile(levelInputs.humanRows, { season: args.season });
    const lift = planYouthLift({
      riders: levelInputs.aiRiders,
      teamsById: new Map(aiTeams.map((t) => [t.id, t])),
      targetSeason: args.season,
      levelProfile: profile,
      valuationModel,
      productionValuationModel,
    });
    const inSquad = (squad, age) => age != null && age <= SQUAD_MAX_AGE[squad]
      && age >= (squad === "junior" ? JUNIOR_RACE_MIN_AGE : SQUAD_MAX_AGE.junior + 1);
    const levels = [];
    for (const squad of ["u23", "junior"]) {
      const human = levelInputs.humanRows.filter((r) => inSquad(squad, ageForSeason(r.birthdate, args.season))).map((r) => r.level);
      const liftRows = lift.rows.filter((r) => inSquad(squad, r.age));
      levels.push(
        { squad, group: "menneske", stats: describeLevels(human) },
        { squad, group: "AI i dag", stats: describeLevels(liftRows.map((r) => r.before)) },
        { squad, group: "AI efter løft", stats: describeLevels(liftRows.map((r) => r.after)) },
      );
    }
    levels.push({ squad: "senior", group: `${SQUAD_MAX_AGE.u23 + 1}-${SQUAD_MAX_AGE.u23 + 3} år`, stats: describeLevels(await loadSeniorLevels(supabase, args.season)) });
    bench = { gapSeason: args.gapSeason, gaps, ref, levels };
  }

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, render({ args, results, meta, bench }));

  // Stdout: kun bestået/fejlet (ingen tal) — tallene står i den private rapport.
  console.log(`\n#5518 C1 felt-gate (S${args.season}, read-only) - rapport: ${relative(REPO_ROOT, args.out)}`);
  for (const r of results.filter((x) => x.scenario === "base" && x.unavailable === 0)) {
    const passes = MIN_TEAM_FLOORS.filter((f) => gatePasses(r.result, f));
    console.log(`  ${r.squad.padEnd(6)} ${r.mapping.padEnd(11)} ${r.form.join("/").padEnd(8)} ${passes.length ? `holder ved gulv op til ${Math.max(...passes)} hold` : "FEJLER ved alle gulve"}`);
  }
  if (bench) {
    // Kun domme (ingen tal) på stdout.
    for (const squad of ["u23", "junior"]) {
      const verdicts = [...(bench.gaps.get(squad) ?? new Map())]
        .map(([t, q]) => `${t}=${gapVerdict(q.median, bench.ref.get(t)) ?? "ingen reference"}`);
      console.log(`  gab ${squad.padEnd(6)} (S${bench.gapSeason}): ${verdicts.join(" · ") || "ingen målte løb"}`);
    }
  }
  console.log("");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(2);
  });
}
