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
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Kun SELECT — scriptet har ingen skrivesti.
// Exit: 0 = rapport skrevet, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { SQUAD_MAX_AGE, SQUAD_CAPS, isYouthSquad, squadForSeasonAge } from "../lib/squads.js";
import { MIN_RACE_ENTRIES, selectionSizeForRace } from "../lib/raceAutopick.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { hashStringToSeed } from "../lib/starterSquadAllocator.js";
import { loadValuationModelById, DEFAULT_VALUATION_MODEL_ID } from "../lib/riderValuationModelSelect.js";
import {
  planYouthSquads,
  loadActiveAiTeams,
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
/** Løbsberettiget fra sæsonalder 17 (YOUTH_RULES §2.1: 16-årige træner, kører ikke). */
export const JUNIOR_RACE_MIN_AGE = 17;
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

// ── I/O ──────────────────────────────────────────────────────────────────────
function parseArgs(argv) {
  const get = (name) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    const eq = hit.indexOf("=");
    return eq === -1 ? true : hit.slice(eq + 1);
  };
  const squadArg = get("squad") ?? "u23";
  if (!["u23", "junior", "both"].includes(squadArg)) throw new Error(`--squad skal være u23, junior eller both (fik ${squadArg})`);
  const juniorsRaw = get("juniors");
  const juniors = juniorsRaw === undefined ? null : Number(juniorsRaw);
  if (juniors !== null && (!Number.isInteger(juniors) || juniors < 0 || juniors > SQUAD_CAPS.junior)) {
    throw new Error(`--juniors skal være et helt tal i [0,${SQUAD_CAPS.junior}]`);
  }
  if (squadArg !== "u23" && juniors === null) {
    throw new Error("junior-målingen kræver --juniors=N (antal AI-juniorer pr. hold er et ejer-valg, intet default)");
  }
  const season = get("season") === undefined ? DEFAULT_TARGET_SEASON : Number(get("season"));
  const unavailable = get("unavailable") === undefined
    ? [...DEFAULT_UNAVAILABLE]
    : String(get("unavailable")).split(",").map(Number);
  if (unavailable.some((p) => !(p >= 0 && p < 1))) throw new Error("--unavailable skal være tal i [0,1)");
  const stamp = new Date().toISOString().slice(0, 10);
  const out = assertBalanceInternalsPath(
    get("out") && get("out") !== true ? get("out") : join(REPO_ROOT, "balance-internals", `5518-c1-field-gate-${stamp}.md`),
  );
  return { squads: squadArg === "both" ? ["u23", "junior"] : [squadArg], juniors: juniors ?? 0, season, unavailable, out };
}

async function loadInputs(supabase) {
  const [teams, pools, riders, catalog] = await Promise.all([
    fetchAllRows(() => supabase.from("teams")
      .select("id, is_ai, is_bank, is_frozen, is_test_account, league_division_id, pending_removal_at, retired_at, parked_at")
      .order("id")),
    fetchAllRows(() => supabase.from("league_divisions").select("id, tier, pool_index").order("id")),
    fetchAllRows(() => supabase.from("riders")
      .select("id, team_id, birthdate, squad, is_academy, is_retired")
      .not("team_id", "is", null)
      .order("id")),
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

function render({ args, results, meta }) {
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
  return L.join("\n");
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
  const model = loadValuationModelById(DEFAULT_VALUATION_MODEL_ID);
  const aiTeams = await loadActiveAiTeams(supabase);
  const plan = planYouthSquads({
    teams: aiTeams, juniorsPerTeam: args.juniors, targetSeason: args.season, seed: DEFAULT_SEED,
    valuationModel: model, productionValuationModel: model,
  });

  const humanTeamIds = new Set(teams.filter((t) => !t.is_ai).map((t) => t.id));
  const results = [];
  const meta = { teams: teams.length, aiTeams: teams.filter((t) => t.is_ai).length, bySquad: {} };

  for (const squad of args.squads) {
    const aiRoster = new Map();
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

  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, render({ args, results, meta }));

  // Stdout: kun bestået/fejlet (ingen tal) — tallene står i den private rapport.
  console.log(`\n#5518 C1 felt-gate (S${args.season}, read-only) - rapport: ${relative(REPO_ROOT, args.out)}`);
  for (const r of results.filter((x) => x.scenario === "base" && x.unavailable === 0)) {
    const passes = MIN_TEAM_FLOORS.filter((f) => gatePasses(r.result, f));
    console.log(`  ${r.squad.padEnd(6)} ${r.mapping.padEnd(11)} ${r.form.join("/").padEnd(8)} ${passes.length ? `holder ved gulv op til ${Math.max(...passes)} hold` : "FEJLER ved alle gulve"}`);
  }
  console.log("");
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(2);
  });
}
