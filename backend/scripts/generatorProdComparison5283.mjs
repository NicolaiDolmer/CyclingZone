#!/usr/bin/env node
// #5283 punkt 2 · Ryttergeneratoren SIDE OM SIDE med ægte prod-ryttere.
//
// Ejer-krav 15/9: før U23-trupperne fødes til AI-holdene (A6, #5518) skal
// ejeren kunne SE at generatoren giver fornuftige ryttere. Den synlige rapport
// (`generatorVisibleTest5283.js`) kører uden DB og kan derfor ikke vise det
// ene sammenligningsgrundlag der tæller: rigtige ryttere på samme alder og type.
// Det gør dette script.
//
// HVAD DET GØR (read-only)
//   1. Planlægger AI-holdenes U23-trupper PRÆCIS som A6's dry-run gør:
//      samme loaders (`loadActiveAiTeams`, `loadPopulation`), samme
//      `planYouthSquads` (U23-båndet, variant A), samme modeller og seed. En
//      rytter i tabellen er derfor den rytter A6 --apply ville indsætte.
//   2. Vælger 3 af holdene spredt over tierne og tager deres U23-trup.
//   3. Henter 10 tilfældige (seedet) eksisterende, ikke-pensionerede
//      prod-ryttere hvis sæson-alder og primary_type matcher en genereret
//      rytter, fra `riders` + `rider_derived_abilities`.
//   4. Skriver ÉN tabel side om side: navn, alder, type, synlige evner, loft
//      (ability_caps), rating pr. rolle og base_value.
//
// HVAD DET ALDRIG GØR
//   - Ingen writes: ingen insert/update/upsert/delete og intet rpc-kald. Testen
//     beviser det mod en fixture-klient der registrerer hvert kald.
//   - Ingen ændring af generatoren. Planen er A6's egen, kaldt uændret.
//   - Tabellen har præcise balance-tal og holdnavne → den skrives KUN til
//     balance-internals/ (gitignoreret, hard rule 17), aldrig til stdout, en
//     PR-body eller en issue-kommentar. Stdout får kun antal og filnavn.
//
// ALDERS-AKSEN
// Generatorens alder er sæson-alderen i MÅLSÆSONEN (den sæson truppen fødes
// til). En prod-rytters evner er hans evner NU, så han matches på sæson-alderen
// i den AKTIVE sæson (`riderSeasonAge.ageForSeason`). Ved cutover er de to
// sæsoner den samme; før cutover ville målsæsonens akse sammenligne en
// nyfødt 22-årig med en rytter der er 21 i dag og endnu ikke har fået et års
// progression. Rapportens hoved skriver begge sæsoner ud.
//
// Usage:
//   node backend/scripts/generatorProdComparison5283.mjs
//   node backend/scripts/generatorProdComparison5283.mjs --seed=5518 --season=4 --juniors=0
//   node backend/scripts/generatorProdComparison5283.mjs --out=balance-internals/<fil>.md
//   infisical run --env=prod --silent -- node backend/scripts/generatorProdComparison5283.mjs
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY. Læses fra backend/.env eller
// injiceres af `infisical run --env=prod -- node ...`.
// Exit: 0 = ok, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  planYouthSquads,
  assertBalanceInternalsPath,
  loadActiveAiTeams,
  loadPopulation,
  DEFAULT_SEED,
  DEFAULT_TARGET_SEASON,
} from "./generateYouthSquadsS4.js";
import { makeRng } from "../lib/fictionalRiderGenerator.js";
import { U23_BIRTH_TIER } from "../lib/riderBirthPriors.js";
import { ageForSeason, seasonReferenceYear } from "../lib/riderSeasonAge.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { DISPLAY_RECIPE_KEYS, ratingForRole } from "../lib/weights/displayRecipes.js";
import { SQUAD_CAPS } from "../lib/squads.js";
import {
  loadValuationModel,
  loadProductionValueModel,
  loadValuationModelById,
  DEFAULT_VALUATION_MODEL_ID,
} from "../lib/riderValuationModelSelect.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

// ── Konstanter (struktur, ikke balance) ─────────────────────────────────────
/** Antal AI-holds U23-trupper i tabellen (issue #5283 punkt 1). */
export const TEAM_COUNT = 3;
/** Antal eksisterende prod-ryttere side om side med dem (issue #5283 punkt 2). */
export const PROD_SAMPLE_SIZE = 10;
// Egen seed-strøm til prod-udvalget, så valget af prod-ryttere aldrig deler
// tilstand med generatorens strømme (#4180-princippet).
const PROD_SAMPLE_OFFSET = 0x5283;

/** Standard-filnavn i balance-internals/ — seed og sæson står i navnet. */
export const defaultOutFile = ({ season, seed }) =>
  `5283-generator-prod-comparison-s${season}-seed${seed}.md`;

// ── Argumenter ───────────────────────────────────────────────────────────────
const KNOWN_FLAGS = new Set(["seed", "season", "juniors", "out"]);

/**
 * @param {string[]} argv
 * @param {{root?: string, cwd?: string}} [paths]
 * @returns {{seed:number, season:number, juniors:number, out:string}}
 * @throws {Error} ved ukendte/ugyldige argumenter (kalderen giver exit 2)
 */
export function parseArgs(argv, { root = REPO_ROOT, cwd = process.cwd() } = {}) {
  const values = new Map();
  for (const arg of argv) {
    const m = /^--([a-z-]+)(?:=(.*))?$/.exec(arg);
    if (!m) throw new Error(`ukendt argument ${JSON.stringify(arg)}`);
    // Scriptet er read-only uden undtagelse: der findes intet --apply at give.
    if (!KNOWN_FLAGS.has(m[1])) {
      throw new Error(`ukendt flag --${m[1]} (scriptet er read-only; gyldige: ${[...KNOWN_FLAGS].map((f) => `--${f}`).join(", ")})`);
    }
    values.set(m[1], m[2] ?? true);
  }
  const intArg = (name, fallback) => {
    if (!values.has(name)) return fallback;
    const raw = values.get(name);
    if (raw === true || !/^\d+$/.test(String(raw))) {
      throw new Error(`--${name} skal være et helt tal ≥ 0 (fik ${JSON.stringify(raw)})`);
    }
    return Number(raw);
  };

  const seed = intArg("seed", DEFAULT_SEED) >>> 0;
  const season = intArg("season", DEFAULT_TARGET_SEASON);
  if (season < 1) throw new Error(`--season skal være ≥ 1 (fik ${season})`);
  // Juniorerne vises ikke, men de er med i planen hvis ejeren vil spejle en
  // A6-kørsel med --juniors=N: navne-dedupliceringen deles på tværs af holdene.
  const juniors = intArg("juniors", 0);
  if (juniors > SQUAD_CAPS.junior) {
    throw new Error(`--juniors skal ligge i [0,${SQUAD_CAPS.junior}] (fik ${juniors})`);
  }

  let out;
  if (values.has("out")) {
    const raw = values.get("out");
    if (raw === true || raw === "") throw new Error("--out kræver en sti");
    out = assertBalanceInternalsPath(raw, { root, cwd });
  } else {
    out = assertBalanceInternalsPath(join(root, "balance-internals", defaultOutFile({ season, seed })), { root, cwd });
  }
  return { seed, season, juniors, out };
}

// ── Holdvalg (ren) ───────────────────────────────────────────────────────────
/**
 * Vælg `n` hold med en U23-trup i planen, spredt over tierne (øverste, midterste,
 * nederste), så værdiloftets virkning pr. tier kan ses. Inden for en tier vælges
 * holdet med laveste id; er der færre tiers end `n`, fyldes op i (tier, id)-orden.
 * Deterministisk og uafhængig af listens rækkefølge.
 *
 * @param {Array<{teamId:string, tier:number, u23:number}>} perTeam  plan.perTeam
 * @param {number} [n]
 */
export function pickComparisonTeams(perTeam, n = TEAM_COUNT) {
  const eligible = perTeam
    .filter((t) => t.u23 > 0)
    .slice()
    .sort((a, b) => a.tier - b.tier || String(a.teamId).localeCompare(String(b.teamId)));
  const tiers = [...new Set(eligible.map((t) => t.tier))];
  const wantTiers = tiers.length <= n || n < 2
    ? tiers.slice(0, n)
    : [...new Set(Array.from({ length: n }, (_, i) => tiers[Math.round((i * (tiers.length - 1)) / (n - 1))]))];
  const picked = [];
  for (const tier of wantTiers) picked.push(eligible.find((t) => t.tier === tier));
  for (const t of eligible) {
    if (picked.length >= n) break;
    if (!picked.includes(t)) picked.push(t);
  }
  return picked
    .sort((a, b) => a.tier - b.tier || String(a.teamId).localeCompare(String(b.teamId)))
    .map((t, i) => ({ ...t, alias: `Hold ${String.fromCharCode(65 + i)}` }));
}

// ── Den genererede side (ren) ────────────────────────────────────────────────
/**
 * Loftet (ability_caps) en genereret rytter får af `deriveForRiderIds`: samme
 * `buildCapsForRider`-kald, samme input (evnerne fra spejlingen, potentiale,
 * sæson-alder og det trukne anlæg). Testen holder det op mod det derive'en
 * faktisk persisterer.
 */
export function generatedCaps(row) {
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) {
    if (row.mirror.abilities[k] != null) baseline[k] = Number(row.mirror.abilities[k]);
  }
  const draw = row.payload.archetype_draw;
  return buildCapsForRider(baseline, { potentiale: row.payload.potentiale, age: row.age }, draw.primary, draw.secondary || null);
}

/** Planens U23-ryttere for de valgte hold, i holdenes rækkefølge. */
export function generatedRows(plan, teams) {
  const out = [];
  for (const team of teams) {
    for (const row of plan.rows.filter((r) => r.teamId === team.teamId && r.squad === "u23")) {
      out.push({
        source: `${team.alias} (tier ${team.tier})`,
        name: `${row.payload.firstname} ${row.payload.lastname}`,
        age: row.age,
        // rider-type-write-ok: rapport-felt fra spejlingen, persisteres aldrig herfra.
        primary_type: row.mirror.primary_type,
        secondary_type: row.mirror.secondary_type,
        potentiale: row.payload.potentiale,
        abilities: row.mirror.abilities,
        caps: generatedCaps(row),
        base_value: row.mirror.base_value,
        overValueCap: row.overValueCap,
      });
    }
  }
  return out;
}

// ── Prod-udvalget (ren) ──────────────────────────────────────────────────────
const pairKey = (age, type) => `${age}|${type}`;
const byId = (a, b) => String(a.id).localeCompare(String(b.id));

function seededShuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/**
 * Er rytteren en prod-rytter der må stå i sammenligningen? Ikke pensioneret, og
 * ikke født af A6 selv (fødsels-tier "u23"): efter en apply skal tabellen stadig
 * sammenligne med de ryttere der fandtes FØR generatoren.
 */
export function isComparableProdRider(rider) {
  return rider.is_retired !== true && rider.archetype_draw?.birth?.tier !== U23_BIRTH_TIER;
}

/**
 * Prod-ryttere hvis (sæson-alder, primary_type) er et par der findes blandt de
 * genererede. Ren filtrering — bruges både til at afgrænse evne-opslaget og af
 * udvalget selv.
 */
export function candidateProdRiders(riders, generated, ageSeason) {
  const wanted = new Set(generated.map((g) => pairKey(g.age, g.primary_type)));
  return riders.filter((r) =>
    isComparableProdRider(r) && wanted.has(pairKey(ageForSeason(r.birthdate, ageSeason), r.primary_type)));
}

/**
 * Vælg `size` tilfældige (seedede) prod-ryttere der matcher de genererede på
 * sæson-alder OG primary_type. Parrene tages på skift, flest genererede først,
 * så de 10 dækker så mange af truppernes (alder, type)-par som muligt i stedet
 * for 10 kopier af det hyppigste. En rytter uden evne-række kan ikke vises og
 * springes over. Deterministisk: samme input + seed = samme udvalg, uanset
 * rækkefølgen rytterne kommer i.
 *
 * @returns {{picks: Array<{rider:object, age:number}>, pairs: Array<{age:number, type:string, generated:number, pool:number, picked:number}>}}
 */
export function pickProdSample({ riders, abilityByRider, generated, ageSeason, seed, size = PROD_SAMPLE_SIZE }) {
  const wanted = new Map();
  for (const g of generated) {
    const k = pairKey(g.age, g.primary_type);
    const e = wanted.get(k) ?? { age: g.age, type: g.primary_type, generated: 0 };
    e.generated++;
    wanted.set(k, e);
  }
  const pools = new Map();
  for (const r of candidateProdRiders([...riders].sort(byId), generated, ageSeason)) {
    if (!abilityByRider.has(r.id)) continue;
    const k = pairKey(ageForSeason(r.birthdate, ageSeason), r.primary_type);
    if (!pools.has(k)) pools.set(k, []);
    pools.get(k).push(r);
  }
  const keys = [...wanted.keys()].sort((a, b) => wanted.get(b).generated - wanted.get(a).generated || a.localeCompare(b));
  const rng = makeRng(((seed >>> 0) + PROD_SAMPLE_OFFSET) >>> 0);
  const queues = new Map(keys.map((k) => [k, seededShuffle(pools.get(k) ?? [], rng)]));
  const pickedByKey = new Map();
  const picks = [];
  while (picks.length < size) {
    let took = false;
    for (const k of keys) {
      if (picks.length >= size) break;
      const next = queues.get(k).shift();
      if (!next) continue;
      picks.push({ rider: next, age: wanted.get(k).age });
      pickedByKey.set(k, (pickedByKey.get(k) ?? 0) + 1);
      took = true;
    }
    if (!took) break;
  }
  return {
    picks,
    pairs: keys.map((k) => ({ ...wanted.get(k), pool: pools.get(k)?.length ?? 0, picked: pickedByKey.get(k) ?? 0 })),
  };
}

/** Prod-rytterens række i samme form som de genererede. */
export function prodRow({ rider, age }, derived) {
  const abilities = {};
  for (const k of VISIBLE_ABILITIES) abilities[k] = derived?.[k] ?? null;
  return {
    source: "Prod",
    name: `${rider.firstname} ${rider.lastname}`,
    age,
    primary_type: rider.primary_type,
    secondary_type: rider.secondary_type,
    potentiale: rider.potentiale,
    abilities,
    caps: derived?.ability_caps ?? null,
    base_value: rider.base_value,
    overValueCap: false,
  };
}

// ── Rendering (ren) ──────────────────────────────────────────────────────────
const dash = "–";
const num = (v) => (v == null || !Number.isFinite(Number(v)) ? dash : String(Math.round(Number(v))));
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? dash : Math.round(Number(v)).toLocaleString("da-DK"));
const pot = (v) => (v == null || !Number.isFinite(Number(v)) ? dash : Number(v).toLocaleString("da-DK", { maximumFractionDigits: 1 }));

function table(header, rows) {
  return [
    `| ${header.join(" | ")} |`,
    `|${header.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
  ].join("\n");
}

/** Én række: evne-celler er `nu/loft`, rolle-celler er `rating/loft-rating`. */
function comparisonCells(row, index) {
  const caps = row.caps ?? {};
  return [
    String(index + 1),
    row.source,
    row.overValueCap ? `${row.name} (over værdiloft)` : row.name,
    num(row.age),
    `${row.primary_type ?? dash} / ${row.secondary_type ?? dash}`,
    pot(row.potentiale),
    ...VISIBLE_ABILITIES.map((k) => `${num(row.abilities?.[k])}/${num(caps[k])}`),
    ...DISPLAY_RECIPE_KEYS.map((k) => `${num(ratingForRole(row.abilities ?? {}, k))}/${num(ratingForRole(caps, k))}`),
    money(row.base_value),
  ];
}

export function renderComparison({ seed, targetSeason, ageSeason, juniors, teams, generated, prod, pairs, candidates }) {
  const header = [
    "#", "Kilde", "Navn", "Alder", "Type (primær / sekundær)", "Pot.",
    ...VISIBLE_ABILITIES,
    ...DISPLAY_RECIPE_KEYS.map((k) => `rolle ${k}`),
    "base_value",
  ];
  const lines = [];
  lines.push(`# #5283 - ryttergeneratoren side om side med prod (read-only)`, "");
  lines.push("PRIVAT (balance-internals/, hard rule 17). Genereret af backend/scripts/generatorProdComparison5283.mjs.", "");
  lines.push(`- Generator: A6-planen (\`planYouthSquads\`, U23-fødselsbåndet, variant A) · seed ${seed} · målsæson S${targetSeason} (referenceår ${seasonReferenceYear(targetSeason)}) · juniorer pr. hold i planen: ${juniors}`);
  lines.push(`- Alder: genererede = sæson-alder i S${targetSeason}; prod = sæson-alder i S${ageSeason} (den aktive sæson, dér hvor deres evner gælder)`);
  lines.push(`- Hold: ${teams.map((t) => `${t.alias} = ${t.name} (tier ${t.tier}, U23 ${t.u23}, over værdiloft ${t.overValueCap})`).join(" · ") || dash}`);
  lines.push(`- Prod-udvalg: ${prod.length} af ${candidates} mulige (ikke-pensioneret, samme sæson-alder og primary_type som en genereret rytter; A6-fødte ryttere udeladt; kun ryttere med en evne-række)`);
  lines.push("- Celler: evne = `nu/loft` (ability_caps) · rolle = `rating/loft-rating` (`ratingForRole` på evner og på lofter) · Pot. = potentiale", "");
  lines.push("## Side om side", "");
  lines.push(table(header, [...generated, ...prod].map((row, i) => comparisonCells(row, i))), "");
  lines.push("## Matchning (sæson-alder × primary_type)", "");
  lines.push(table(
    ["Alder", "Type", "Genereret", "Prod-pulje", "Udvalgt"],
    pairs.map((p) => [String(p.age), p.type, String(p.generated), String(p.pool), String(p.picked)]),
  ), "");
  return lines.join("\n");
}

// ── I/O (kun læsning) ────────────────────────────────────────────────────────
async function fetchActiveSeasonNumber(supabase) {
  const { data, error } = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`aktiv sæson: ${error.message}`);
  return Number.isFinite(data?.number) ? data.number : null;
}

/**
 * Hele sammenligningen. Læser kun; returnerer markdown + et resumé med antal
 * (ingen balance-tal), som main() må skrive til stdout.
 */
export async function runComparison(supabase, { seed = DEFAULT_SEED, season = DEFAULT_TARGET_SEASON, juniors = 0 } = {}) {
  // Modellerne vælges som A6's main() gør: app_config først, fail-safe i loaderen.
  const valuationModel = await loadValuationModel(supabase) ?? loadValuationModelById(DEFAULT_VALUATION_MODEL_ID);
  const productionValuationModel = await loadProductionValueModel(supabase);

  const aiTeams = await loadActiveAiTeams(supabase);
  const population = await loadPopulation(supabase, aiTeams.map((t) => t.id));
  // HELE A6-planen, ikke kun de 3 hold: navne-dedupliceringen deles på tværs af
  // holdene, så et delkuld kunne få andre navne (og dermed andre træk) end apply.
  const plan = planYouthSquads({
    teams: aiTeams,
    juniorsPerTeam: juniors,
    targetSeason: season,
    seed,
    existingNames: population.existingNames,
    valuationModel,
    productionValuationModel,
    existingByTeam: population.existingByTeam,
  });
  const teams = pickComparisonTeams(plan.perTeam);
  const generated = generatedRows(plan, teams);

  const ageSeason = (await fetchActiveSeasonNumber(supabase)) ?? season;
  const riders = await fetchAllRows(() => supabase.from("riders")
    .select("id, firstname, lastname, birthdate, primary_type, secondary_type, potentiale, base_value, is_retired, archetype_draw")
    .order("id"));
  const candidates = candidateProdRiders(riders, generated, ageSeason);
  const derivedRows = await fetchAllRowsChunkedIn(candidates.map((r) => r.id), (chunk) => supabase.from("rider_derived_abilities")
    .select(["rider_id", ...VISIBLE_ABILITIES, "ability_caps"].join(", "))
    .in("rider_id", chunk)
    .order("rider_id"));
  const abilityByRider = new Map(derivedRows.map((d) => [d.rider_id, d]));

  const sample = pickProdSample({ riders: candidates, abilityByRider, generated, ageSeason, seed });
  const prod = sample.picks.map((p) => prodRow(p, abilityByRider.get(p.rider.id)));
  const withAbilities = candidates.filter((r) => abilityByRider.has(r.id)).length;

  return {
    markdown: renderComparison({
      seed, targetSeason: season, ageSeason, juniors, teams, generated, prod, pairs: sample.pairs, candidates: withAbilities,
    }),
    summary: {
      targetSeason: season,
      ageSeason,
      seed,
      teams: teams.length,
      generated: generated.length,
      prod: prod.length,
      prodCandidates: withAbilities,
      pairs: sample.pairs.length,
      pairsWithoutProd: sample.pairs.filter((p) => p.pool === 0).length,
    },
  };
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
  const { markdown, summary } = await runComparison(supabase, args);
  mkdirSync(dirname(args.out), { recursive: true });
  writeFileSync(args.out, markdown);
  // Kun antal og filnavn: tabellens tal og navne hører til balance-internals/.
  console.log("");
  console.log(`#5283 - generatoren side om side med prod (READ-ONLY, S${summary.targetSeason}, seed ${summary.seed})`);
  console.log(`  hold: ${summary.teams} · genererede U23-ryttere: ${summary.generated} · prod-ryttere: ${summary.prod} af ${summary.prodCandidates} mulige`);
  console.log(`  alder/type-par: ${summary.pairs} (uden prod-match: ${summary.pairsWithoutProd}) · prod-alder målt i S${summary.ageSeason}`);
  console.log(`  tabel skrevet: ${relative(REPO_ROOT, args.out)}`);
  console.log("");
}

// Kun når filen køres direkte — testen importerer de rene funktioner.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(2);
  });
}
