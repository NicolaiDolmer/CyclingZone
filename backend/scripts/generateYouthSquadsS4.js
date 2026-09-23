#!/usr/bin/env node
// #5518 · A6: engangs-generatoren til AI-holdenes U23-trup (+ N juniorer) ved S4-cutover.
//
// HVAD DEN GØR
// Pr. AKTIVT AI-hold føder den én U23-trup på 6-9 ryttere (sæsonalder 19-22 i
// målsæsonen, ejer-låst variant A 15/9 + 18/9, spec 2026-09-15 §10.4) og N
// juniorer (sæsonalder 16-18). N er et PÅKRÆVET argument uden default: antallet
// af AI-juniorer er et ejer-valg, og et default ville træffe det valg i stilhed.
//
// HVOR RYTTERNE KOMMER FRA (ingen ny generator, ingen kopi af en formel)
//   - Identitet (navn, nationalitet, potentiale, krop, to-delt anlæg, fødsels-
//     seed) kommer fra akademiets EGEN generator (`generateAcademyCandidates`,
//     own-priors). Navne dedupliceres mod HELE rytterbestanden.
//   - Alderen trækkes i truppens interval og fødslen gøres om med den alder:
//       U23    → `makeU23BirthMarker` + U23-båndet (markør-tier "u23")
//       junior → `makeYouthBirthMarker` + akademibåndet (markør-tier "youth")
//     Markøren persisteres i `archetype_draw.birth`, så `deriveForRiderIds` og
//     enhver senere heal-sweep reproducerer PRÆCIS dette træk (RIDER_GENERATION
//     §8b + §8b2). Akademibåndet og G5 røres ikke.
//   - Kontrakt og løn: samme sammensætning som start-truppens sti
//     (`computeFrozenSalary` på `current_production_value` efter derive,
//     `pickStarterContractLength`, `computeContractEndSeason`).
//   - `squad` og `is_academy` skrives SAMMEN i samme insert (YOUTH_RULES §2.1,
//     `is_academy` er afledt af `squad` i overgangsperioden).
//
// SPEJLINGS-GATEN (#2065-klassen, RIDER_GENERATION §8b "Gates enhver ny kaldsted
// skal respektere")
// Hver kandidat køres FØR insert gennem præcis den kæde `deriveForRiderIds`
// persisterer: fødsels-forgrening → caps → endelig type → base_value → løn-
// grundlag, på MÅLSÆSONENS alders-akse og med de samme model-objekter som derive
// bagefter får. Dry-run'ens tal ER derfor de tal der lander i DB'en. Et AI-hold i
// en tier med værdiloft (`aiValueCapForTier`) blokerer apply hvis en kandidat
// ligger over loftet. Efter apply læses base_value/type tilbage og sammenlignes
// med spejlingen; enhver afvigelse rapporteres og giver exit 1.
//
// ALDERS-AKSEN (#4876-lektien)
// `deriveForRiderIds` regner alder mod den AKTIVE sæson. Apply nægter derfor at
// køre medmindre målsæsonen ER den aktive sæson — ellers ville derive prissætte
// en rytter ét år yngre end gaten vurderede.
//
// IDEMPOTENT PR. TRUP: har et hold allerede en U23-født rytter (markør-tier
// "u23" — kun denne generator skriver den), fødes U23-truppen ikke igen; har det
// allerede juniorer, fødes juniorerne ikke igen. Juniorerne kan derfor fødes i en
// senere kørsel (fx `--juniors=N` når junior-kalenderen findes) uden at røre
// U23-truppen. Hvert holds kuld indsættes i ÉT insert, så et hold ikke kan stå
// halvt genereret.
//
// Usage:
//   node backend/scripts/generateYouthSquadsS4.js --juniors=N                 # dry-run (default), READ-ONLY
//   node backend/scripts/generateYouthSquadsS4.js --juniors=N --json
//   node backend/scripts/generateYouthSquadsS4.js --juniors=N --out=balance-internals/<fil>.md
//   node backend/scripts/generateYouthSquadsS4.js --juniors=N --apply --owner-go   # KRÆVER EJER-GO
//
// --apply skriver mod prod og er gated bag BEGGE flag. Kør ALDRIG --apply uden et
// eksplicit ejer-go på netop de tal dry-run'en har vist (feedback_explicit_go_per_prod_step).
// --out må kun pege ind i balance-internals/ (gitignoreret): rapporten har
// holdnavne og præcise balance-tal (hard rule 17).
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY (service-role). Læses fra backend/.env
// eller injiceres af `infisical run --env=prod -- node ...`.
// Exit: 0 = ok, 1 = spejlings-afvigelse efter apply, 2 = kald-/konfigurationsfejl.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { generateAcademyCandidates } from "../lib/academyGenerator.js";
import { ACADEMY } from "../lib/academyFlag.js";
import { makeRng, BIRTH_MODE_OWN_PRIORS } from "../lib/fictionalRiderGenerator.js";
import { deriveTeamSeed, aiValueCapForTier } from "../lib/starterSquadAllocator.js";
import {
  makeU23BirthMarker,
  makeYouthBirthMarker,
  deriveBirthAbilities,
  isBornFromPriors,
  U23_BIRTH_AGE_MIN,
  U23_BIRTH_AGE_MAX,
  U23_BIRTH_TIER,
} from "../lib/riderBirthPriors.js";
import { SQUAD_MAX_AGE, SQUAD_CAPS, isYouthSquad } from "../lib/squads.js";
import { ageForSeason, seasonReferenceYear } from "../lib/riderSeasonAge.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { resolveRiderTypes, RIDER_TYPES } from "../lib/riderTypes.js";
import { selectTypesBaseline } from "../lib/riderTypesBaselineSelect.js";
import { predictBaseValue } from "../lib/riderValuation.js";
import { currentProductionValue } from "../lib/riderCareerNpv.js";
import {
  computeFrozenSalary,
  pickStarterContractLength,
  computeContractEndSeason,
} from "../lib/contractSeed.js";
import {
  loadValuationModel,
  loadProductionValueModel,
  loadValuationModelById,
  DEFAULT_VALUATION_MODEL_ID,
} from "../lib/riderValuationModelSelect.js";
import { deriveForRiderIds } from "../lib/backfillCores.js";
import { fetchAllRows, fetchAllRowsChunkedIn } from "../lib/supabasePagination.js";
import { foldNameNordic } from "../lib/pcmRiderMatcher.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "..", "..");
const LIB = join(__dirname, "..", "lib");
dotenv.config({ path: join(REPO_ROOT, "backend", ".env"), quiet: true });

// ── Konstanter (struktur, ikke balance) ─────────────────────────────────────
/** Sæsonen truppen fødes til. Scriptets navn er S4; flaget findes til test/replay. */
export const DEFAULT_TARGET_SEASON = 4;
/** Basis-seed for engangs-kuldet. Deterministisk: samme seed + samme hold = samme ryttere. */
export const DEFAULT_SEED = 5518;
/**
 * U23-truppens størrelse pr. AI-hold. EJER-LÅST 15/9 (spec §10.4, svar A):
 * "generér en U23-trup på 6-9 ryttere (19-22 år) til alle AI-hold ved cutover".
 * Strukturtal (trupstørrelse), står også ordret i YOUTH_RULES §2.1.
 */
export const U23_SQUAD_SIZE = Object.freeze({ min: 6, max: 9 });
/** Juniortruppens aldersinterval: akademiets nedre grænse → juniortruppens øvre. */
export const JUNIOR_AGE_MIN = ACADEMY.MIN_AGE;
export const JUNIOR_AGE_MAX = SQUAD_MAX_AGE.junior;

// Seed-offsets pr. understrøm (#4180-princippet: et domæne der kan ændres
// uafhængigt har sin egen strøm). Identitet, alder/størrelse og kontrakt deler
// ikke tilstand, så en ændring i fx kontrakt-reglen ikke flytter én eneste rytter.
const IDENTITY_OFFSET = 0;
const SHAPE_OFFSET = 1;
const CONTRACT_OFFSET = 2894; // samme offset-idé som start-truppens kontrakt-rng

const INSERT_BATCH = 500;
const WRITE_CONCURRENCY = 25;

// Klassifikator-vægte + type-baselines indlæses PRÆCIS som deriveForRiderIds gør
// (backfillCores.js) — spejlingen må ikke læse en anden fil end derive'en.
const CLASSIFIER_WEIGHTS_BY_TYPE = Object.freeze(
  Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights])),
);
const readLibJson = (f) => JSON.parse(readFileSync(join(LIB, f), "utf8"));
const TYPES_BASELINE = readLibJson("riderTypesBaseline.json");
const YOUTH_TYPES_BASELINE = readLibJson("riderTypesBaselineYouth.json");

// ── Argumenter ───────────────────────────────────────────────────────────────
/**
 * @param {string[]} argv
 * @returns {{juniors:number, apply:boolean, ownerGo:boolean, json:boolean, season:number, seed:number, out:string|null}}
 * @throws {Error} ved manglende/ugyldige argumenter (kalderen giver exit 2)
 */
export function parseArgs(argv) {
  const get = (name) => {
    const hit = argv.find((a) => a === `--${name}` || a.startsWith(`--${name}=`));
    if (!hit) return undefined;
    const eq = hit.indexOf("=");
    return eq === -1 ? true : hit.slice(eq + 1);
  };
  const intArg = (name, raw) => {
    if (raw === true || raw === undefined || raw === "" || !/^-?\d+$/.test(String(raw))) {
      throw new Error(`--${name} skal være et helt tal (fik ${JSON.stringify(raw)})`);
    }
    return Number(raw);
  };

  const juniorsRaw = get("juniors");
  if (juniorsRaw === undefined) {
    throw new Error(
      "--juniors=N er PÅKRÆVET og har bevidst intet default: antal AI-juniorer pr. AI-hold er et ejer-valg (#5518).",
    );
  }
  const juniors = intArg("juniors", juniorsRaw);
  if (juniors < 0 || juniors > SQUAD_CAPS.junior) {
    throw new Error(`--juniors skal ligge i [0,${SQUAD_CAPS.junior}] (juniortruppens loft) — fik ${juniors}`);
  }

  const apply = get("apply") === true;
  const ownerGo = get("owner-go") === true;
  if (apply && !ownerGo) {
    throw new Error("--apply kræver OGSÅ --owner-go. Kør dry-run først og få ejerens go på netop de tal.");
  }
  if (apply && get("dry-run") === true) {
    throw new Error("--apply og --dry-run udelukker hinanden.");
  }

  const seasonRaw = get("season");
  const season = seasonRaw === undefined ? DEFAULT_TARGET_SEASON : intArg("season", seasonRaw);
  if (season < 1) throw new Error(`--season skal være ≥ 1 (fik ${season})`);
  const seedRaw = get("seed");
  const seed = seedRaw === undefined ? DEFAULT_SEED : intArg("seed", seedRaw);

  const outRaw = get("out");
  let out = null;
  if (outRaw !== undefined) {
    if (outRaw === true || outRaw === "") throw new Error("--out kræver en sti");
    out = assertBalanceInternalsPath(outRaw);
  }

  return { juniors, apply, ownerGo, json: get("json") === true, season, seed: seed >>> 0, out };
}

/**
 * Rapporten har holdnavne og præcise balance-tal → den må KUN skrives ind i
 * balance-internals/ (gitignoreret, hard rule 17). Alt andet afvises.
 * Stien tolkes relativt til arbejdsmappen (som enhver anden CLI-sti).
 * @param {string} p
 * @returns {string} absolut sti
 */
export function assertBalanceInternalsPath(p, { root = REPO_ROOT, cwd = process.cwd() } = {}) {
  const abs = resolve(cwd, p);
  const rel = relative(join(root, "balance-internals"), abs);
  if (rel === "" || rel.startsWith("..") || rel.split(sep)[0] === ".." || resolve(abs) === resolve(root, "balance-internals")) {
    throw new Error(`--out skal pege på en fil inde i balance-internals/ (fik ${p})`);
  }
  return abs;
}

// ── Spejlingen af deriveForRiderIds (#2065) ──────────────────────────────────
/**
 * Kør ÉN payload-række gennem præcis den kæde `deriveForRiderIds` persisterer,
 * på målsæsonens alders-akse. Ren funktion.
 *
 * Kendt, ufarlig forskel: `hidden_potential` hasher rytterens DB-id, som først
 * findes efter insert. Den indgår hverken i caps, type, base_value eller
 * løngrundlag, så gaten vurderer stadig præcis den rytter der lander.
 *
 * @param {object} row   payload-række (med `archetype_draw.birth`) + et id
 * @param {object} opts
 * @param {number} opts.seasonNumber
 * @param {object} opts.valuationModel
 * @param {object} opts.productionValuationModel
 */
export function mirrorDerive(row, { seasonNumber, valuationModel, productionValuationModel }) {
  if (!isBornFromPriors(row)) {
    throw new Error(`mirrorDerive: rytter ${row?.id} mangler fødsels-markør — generatoren skal altid skrive én`);
  }
  const age = ageForSeason(row.birthdate, seasonNumber);
  const abilities = deriveBirthAbilities(row, { age, classifierWeightsByType: CLASSIFIER_WEIGHTS_BY_TYPE });
  const draw = row.archetype_draw;
  const baseline = {};
  for (const k of VISIBLE_ABILITIES) if (abilities[k] != null) baseline[k] = Number(abilities[k]);
  const caps = buildCapsForRider(baseline, { potentiale: row.potentiale, age }, draw.primary, draw.secondary || null);
  // rider-type-write-ok: spejling i hukommelsen — typen persisteres af deriveForRiderIds, ikke her.
  const { primary, secondary } = resolveRiderTypes(draw, caps, selectTypesBaseline(age, TYPES_BASELINE, YOUTH_TYPES_BASELINE));
  const valueRider = { ...row, primary_type: primary.key, age };
  const base_value = predictBaseValue(valueRider, abilities, valuationModel);
  const current_production_value = currentProductionValue(valueRider, abilities, productionValuationModel);
  return {
    age,
    abilities,
    primary_type: primary.key,
    secondary_type: secondary.key,
    base_value,
    current_production_value,
    salary: computeFrozenSalary({ current_production_value }),
  };
}

// ── Planen (ren) ─────────────────────────────────────────────────────────────
/**
 * Byg HELE kuldet for en liste AI-hold. Ren funktion uden I/O: dry-run og apply
 * kan umuligt vælge forskellige ryttere (læring 3/9).
 *
 * @param {object} args
 * @param {Array<{id:string, name?:string, tier:number}>} args.teams  aktive AI-hold
 * @param {number} args.juniorsPerTeam
 * @param {number} args.targetSeason
 * @param {number} [args.seed]
 * @param {Set<string>} [args.existingNames]  foldNameNordic-sæt (kopieres, muteres ikke)
 * @param {object} args.valuationModel
 * @param {object} args.productionValuationModel
 * @param {Map<string, {u23Born?:boolean, juniors?:number}>} [args.existingByTeam]
 *        hvad holdet ALLEREDE har: en U23-født trup (markør-tier "u23") og/eller
 *        juniorer. Idempotensen er PR. TRUP, så juniorerne kan fødes i en senere
 *        kørsel (fx når junior-kalenderen findes) uden at U23-truppen fødes igen.
 */
export function planYouthSquads({
  teams,
  juniorsPerTeam,
  targetSeason,
  seed = DEFAULT_SEED,
  existingNames = new Set(),
  valuationModel,
  productionValuationModel,
  existingByTeam = new Map(),
}) {
  if (!Number.isInteger(juniorsPerTeam) || juniorsPerTeam < 0) {
    throw new Error("planYouthSquads: juniorsPerTeam er påkrævet (helt tal ≥ 0)");
  }
  if (!Number.isInteger(targetSeason) || targetSeason < 1) {
    throw new Error("planYouthSquads: targetSeason er påkrævet");
  }
  const referenceYear = seasonReferenceYear(targetSeason);
  const names = new Set(existingNames);
  const base = seed >>> 0;
  // Sortér på id: rækkefølgen på listen fra DB'en må ikke flytte hvem der får hvilket navn.
  const ordered = [...teams].sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const perTeam = [];
  const rows = [];
  const skipped = [];
  for (const team of ordered) {
    const existing = existingByTeam.get(team.id) ?? {};
    const skipU23 = existing.u23Born === true;
    const skipJuniors = Number(existing.juniors) > 0;
    const shapeRng = makeRng(deriveTeamSeed((base + SHAPE_OFFSET) >>> 0, team.id));
    // Størrelsen trækkes ALTID (også når truppen springes over), så U23-truppens
    // størrelse for et hold er den samme i dry-run, apply og en gentaget kørsel.
    const drawnU23 = U23_SQUAD_SIZE.min + Math.floor(shapeRng() * (U23_SQUAD_SIZE.max - U23_SQUAD_SIZE.min + 1));
    const u23Count = skipU23 ? 0 : drawnU23;
    const juniorCount = skipJuniors ? 0 : juniorsPerTeam;
    const count = u23Count + juniorCount;
    if (skipU23 || skipJuniors) {
      skipped.push({ teamId: team.id, name: team.name ?? team.id, tier: team.tier, u23: skipU23, juniors: skipJuniors });
    }
    if (count === 0) continue;

    const candidates = generateAcademyCandidates({
      rng: makeRng(deriveTeamSeed((base + IDENTITY_OFFSET) >>> 0, team.id)),
      referenceYear,
      existingNames: names,
      countOverride: count,
      mode: BIRTH_MODE_OWN_PRIORS,
    });

    const valueCap = aiValueCapForTier(team.tier);
    const teamRows = candidates.map((c, i) => {
      const squad = i < u23Count ? "u23" : "junior";
      const [lo, hi] = squad === "u23" ? [U23_BIRTH_AGE_MIN, U23_BIRTH_AGE_MAX] : [JUNIOR_AGE_MIN, JUNIOR_AGE_MAX];
      const age = lo + Math.floor(shapeRng() * (hi - lo + 1));
      const birthSeed = c.archetypeDraw?.birth?.seed;
      if (!Number.isInteger(birthSeed)) {
        throw new Error("planYouthSquads: akademi-generatoren leverede ingen fødsels-seed (own-priors-stien forventet)");
      }
      const birth = squad === "u23"
        ? makeU23BirthMarker({ seed: birthSeed, age })
        : makeYouthBirthMarker({ seed: birthSeed, age });
      const birthdate = `${referenceYear - age}-06-15`;
      if (ageForSeason(birthdate, targetSeason) !== age) {
        throw new Error(`planYouthSquads: alders-aksen er brudt (${birthdate} → ${ageForSeason(birthdate, targetSeason)} ≠ ${age})`);
      }
      const payload = {
        ...c.rider,
        birthdate,
        team_id: team.id,
        squad,
        is_academy: isYouthSquad(squad),
        generation_tag: `s${targetSeason}`,
        archetype_draw: { primary: c.archetypeDraw.primary, secondary: c.archetypeDraw.secondary, birth },
      };
      const mirror = mirrorDerive(
        { ...payload, id: `plan-${team.id}-${i}` },
        { seasonNumber: targetSeason, valuationModel, productionValuationModel },
      );
      const overValueCap = valueCap != null && mirror.base_value != null && mirror.base_value > valueCap;
      return { teamId: team.id, squad, age, payload, mirror, overValueCap };
    });

    for (const r of teamRows) names.add(foldNameNordic(`${r.payload.firstname} ${r.payload.lastname}`));
    rows.push(...teamRows);
    perTeam.push({
      teamId: team.id,
      name: team.name ?? team.id,
      tier: team.tier,
      u23: u23Count,
      junior: juniorCount,
      valueCap,
      overValueCap: teamRows.filter((r) => r.overValueCap).length,
    });
  }

  return {
    targetSeason,
    referenceYear,
    juniorsPerTeam,
    seed: base,
    perTeam,
    rows,
    skipped,
    totals: {
      teams: perTeam.length,
      u23: rows.filter((r) => r.squad === "u23").length,
      junior: rows.filter((r) => r.squad === "junior").length,
      riders: rows.length,
      overValueCap: rows.filter((r) => r.overValueCap).length,
    },
  };
}

// ── Rapport (tal til balance-internals, aldrig til repoet) ───────────────────
const q = (xs, p) => {
  const s = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const bestAbility = (a) => Math.max(...VISIBLE_ABILITIES.map((k) => Number(a?.[k])).filter(Number.isFinite));
function describe(xs) {
  return { n: xs.filter(Number.isFinite).length, p10: q(xs, 0.1), median: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) };
}

/**
 * Sammenfat planen + belastnings-billedet. Ren funktion.
 * @param {object} plan  fra planYouthSquads
 * @param {object} [load]  { activeRiders, aiSeniorRiders, aiTeamsWithYouth }
 */
export function summarizePlan(plan, load = {}) {
  const bySquad = (squad) => plan.rows.filter((r) => r.squad === squad);
  const stats = (rows) => ({
    count: rows.length,
    base_value: describe(rows.map((r) => r.mirror.base_value)),
    salary: describe(rows.map((r) => r.mirror.salary)),
    best_ability: describe(rows.map((r) => bestAbility(r.mirror.abilities))),
    ages: Object.fromEntries(
      [...new Set(rows.map((r) => r.age))].sort((a, b) => a - b).map((a) => [a, rows.filter((r) => r.age === a).length]),
    ),
    types: Object.fromEntries(
      [...new Set(rows.map((r) => r.mirror.primary_type))].sort().map((t) => [t, rows.filter((r) => r.mirror.primary_type === t).length]),
    ),
  });
  const activeRiders = Number(load.activeRiders) || null;
  return {
    targetSeason: plan.targetSeason,
    juniorsPerTeam: plan.juniorsPerTeam,
    totals: plan.totals,
    skippedTeams: plan.skipped.length,
    u23: stats(bySquad("u23")),
    junior: stats(bySquad("junior")),
    load: {
      activeRiders,
      aiSeniorRiders: load.aiSeniorRiders ?? null,
      newRiders: plan.totals.riders,
      growthPct: activeRiders ? (100 * plan.totals.riders) / activeRiders : null,
      aiTeamsWithYouthAlready: load.aiTeamsWithYouth ?? null,
      aiSeniorBestAbility: load.aiSeniorBestAbility ?? null,
    },
    perTier: Object.fromEntries(
      [...new Set(plan.perTeam.map((t) => t.tier))].sort().map((tier) => {
        const ts = plan.perTeam.filter((t) => t.tier === tier);
        return [tier, { teams: ts.length, u23: ts.reduce((s, t) => s + t.u23, 0), junior: ts.reduce((s, t) => s + t.junior, 0) }];
      }),
    ),
  };
}

const fmt = (n) => (n == null ? "-" : Math.round(n).toLocaleString("da-DK"));

export function renderMarkdown(plan, summary) {
  const lines = [];
  lines.push(`# #5518 A6 - AI-ungdomstrupper, dry-run (S${plan.targetSeason})`, "");
  lines.push("PRIVAT (balance-internals/, hard rule 17). Genereret af backend/scripts/generateYouthSquadsS4.js.", "");
  lines.push(`- Juniorer pr. AI-hold (ejer-valg, argument): ${plan.juniorsPerTeam}`);
  lines.push(`- Seed: ${plan.seed} · referenceår ${plan.referenceYear}`);
  lines.push(`- AI-hold: ${summary.totals.teams} (hold med en trup der allerede findes: ${summary.skippedTeams})`);
  lines.push(`- Nye ryttere: ${summary.totals.riders} (U23 ${summary.totals.u23} · junior ${summary.totals.junior})`);
  lines.push(`- Over værdiloft (blokerer apply): ${summary.totals.overValueCap}`, "");
  lines.push("## Belastning", "");
  lines.push(`- Aktive ryttere i dag: ${fmt(summary.load.activeRiders)} · AI-seniorer: ${fmt(summary.load.aiSeniorRiders)}`);
  const pct = summary.load.growthPct == null
    ? "-"
    : summary.load.growthPct.toLocaleString("da-DK", { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  lines.push(`- Vækst: +${fmt(summary.load.newRiders)} ryttere (${pct} %)`);
  lines.push(`- AI-hold der allerede har ungdomsryttere: ${summary.load.aiTeamsWithYouthAlready ?? "-"}`, "");
  for (const squad of ["u23", "junior"]) {
    const s = summary[squad];
    lines.push(`## ${squad === "u23" ? "U23" : "Junior"} (${s.count})`, "");
    lines.push("| mål | p10 | median | p90 | max |", "|---|---:|---:|---:|---:|");
    for (const [label, d] of [["base_value", s.base_value], ["løn", s.salary], ["bedste evne", s.best_ability]]) {
      lines.push(`| ${label} | ${fmt(d.p10)} | ${fmt(d.median)} | ${fmt(d.p90)} | ${fmt(d.max)} |`);
    }
    if (squad === "u23" && summary.load.aiSeniorBestAbility) {
      const d = summary.load.aiSeniorBestAbility;
      lines.push(`| AI-seniorers bedste evne (i dag) | ${fmt(d.p10)} | ${fmt(d.median)} | ${fmt(d.p90)} | ${fmt(d.max)} |`);
    }
    lines.push("", `Aldre: ${JSON.stringify(s.ages)}`, "", `Typer: ${JSON.stringify(s.types)}`, "");
  }
  lines.push("## Pr. hold", "", "| hold | tier | U23 | junior | over loft |", "|---|---:|---:|---:|---:|");
  for (const t of plan.perTeam) lines.push(`| ${t.name} | ${t.tier} | ${t.u23} | ${t.junior} | ${t.overValueCap} |`);
  lines.push("");
  return lines.join("\n");
}

// ── I/O ──────────────────────────────────────────────────────────────────────
/** Aktive AI-hold: samme diskriminator som AI-fyldet + ikke på vej ud af spillet. */
export async function loadActiveAiTeams(supabase) {
  const [teams, pools] = await Promise.all([
    fetchAllRows(() => supabase.from("teams")
      .select("id, name, is_ai, is_bank, is_frozen, is_test_account, league_division_id, pending_removal_at, retired_at, parked_at")
      .eq("is_ai", true)
      .order("id")),
    fetchAllRows(() => supabase.from("league_divisions").select("id, tier, pool_index").order("id")),
  ]);
  const tierByPool = new Map(pools.map((p) => [p.id, p.tier]));
  return teams
    .filter((t) => t.is_ai === true && !t.is_bank && !t.is_frozen && !t.is_test_account)
    .filter((t) => t.league_division_id && tierByPool.has(t.league_division_id))
    .filter((t) => !t.pending_removal_at && !t.retired_at && !t.parked_at)
    .map((t) => ({ id: t.id, name: t.name, tier: tierByPool.get(t.league_division_id) }));
}

async function loadPopulation(supabase, aiTeamIds) {
  const riders = await fetchAllRows(() => supabase.from("riders")
    .select("id, firstname, lastname, team_id, is_academy, squad, is_retired, archetype_draw")
    .order("id"));
  const aiSet = new Set(aiTeamIds);
  const active = riders.filter((r) => r.is_retired !== true);
  const aiRiders = active.filter((r) => r.team_id && aiSet.has(r.team_id));
  // Idempotens pr. trup. AI-hold får intet akademi-intake (runAcademyIntake er
  // kun for menneskehold), så en junior på et AI-hold stammer fra denne generator.
  const existingByTeam = new Map();
  for (const r of aiRiders) {
    const e = existingByTeam.get(r.team_id) ?? { u23Born: false, juniors: 0 };
    if (r.archetype_draw?.birth?.tier === U23_BIRTH_TIER) e.u23Born = true;
    if (r.squad === "junior") e.juniors++;
    existingByTeam.set(r.team_id, e);
  }
  const aiTeamsWithYouth = new Set(aiRiders.filter((r) => r.is_academy === true || isYouthSquad(r.squad)).map((r) => r.team_id));
  const aiSeniorIds = aiRiders.filter((r) => r.is_academy !== true && !isYouthSquad(r.squad)).map((r) => r.id);
  return {
    existingNames: new Set(riders.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`))),
    existingByTeam,
    load: {
      activeRiders: active.length,
      aiSeniorRiders: aiSeniorIds.length,
      aiTeamsWithYouth: aiTeamsWithYouth.size,
    },
    aiSeniorIds,
  };
}

async function loadAiSeniorBestAbility(supabase, ids) {
  if (!ids.length) return null;
  const rows = await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("rider_derived_abilities")
    .select(["rider_id", ...VISIBLE_ABILITIES].join(", "))
    .in("rider_id", chunk)
    .order("rider_id"));
  return describe(rows.map(bestAbility));
}

async function fetchActiveSeason(supabase) {
  const { data, error } = await supabase.from("seasons").select("id, number").eq("status", "active").maybeSingle();
  if (error) throw new Error(`aktiv sæson: ${error.message}`);
  return data ?? null;
}

/**
 * Apply: insert pr. hold → deriveForRiderIds (samme modeller som spejlingen) →
 * kontrakt-felter → post-verify mod spejlingen. Returnerer afvigelserne.
 */
export async function applyPlan(supabase, plan, {
  valuationModel,
  productionValuationModel,
  derive = deriveForRiderIds,
  log = console.log,
} = {}) {
  if (plan.totals.overValueCap > 0) {
    throw new Error(`STOP: ${plan.totals.overValueCap} kandidat(er) over AI-holdets værdiloft — apply blokeret (#2065)`);
  }
  const insertedByPlanIndex = new Map();
  const byTeam = new Map();
  plan.rows.forEach((r, idx) => {
    if (!byTeam.has(r.teamId)) byTeam.set(r.teamId, []);
    byTeam.get(r.teamId).push(idx);
  });

  // 1) Ét insert pr. hold (≤ 19 rækker): et hold står aldrig halvt genereret.
  for (const [teamId, idxs] of byTeam) {
    const payload = idxs.map((i) => plan.rows[i].payload);
    for (let i = 0; i < payload.length; i += INSERT_BATCH) {
      const { data, error } = await supabase.from("riders").insert(payload.slice(i, i + INSERT_BATCH)).select("id");
      if (error) throw new Error(`insert (hold ${teamId}): ${error.message}`);
      (data || []).forEach((row, k) => insertedByPlanIndex.set(idxs[i + k], row.id));
    }
  }
  const ids = [...insertedByPlanIndex.values()];
  log(`  indsat: ${ids.length} ryttere`);

  // 2) Data-hale-garanti med SAMME model-objekter som spejlingen (#5443/#2065).
  await derive(supabase, ids, { dryRun: false, valuationModel, productionValuationModel });

  // 3) Læs tilbage: base_value/type/løngrundlag som derive faktisk persisterede.
  const persisted = await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("riders")
    .select("id, team_id, base_value, primary_type, current_production_value")
    .in("id", chunk)
    .order("id"));
  const byId = new Map(persisted.map((r) => [r.id, r]));

  // 4) Kontrakt + løn: start-truppens sammensætning, én kontrakt-rng pr. hold.
  const pairs = [];
  for (const [teamId, idxs] of byTeam) {
    const contractRng = makeRng(deriveTeamSeed((plan.seed + CONTRACT_OFFSET) >>> 0, teamId));
    for (const i of idxs) {
      const id = insertedByPlanIndex.get(i);
      const length = pickStarterContractLength(contractRng);
      pairs.push({
        id,
        salary: computeFrozenSalary({ current_production_value: byId.get(id)?.current_production_value }),
        contract_length: length,
        contract_end_season: computeContractEndSeason(plan.targetSeason, length),
      });
    }
  }
  for (let i = 0; i < pairs.length; i += WRITE_CONCURRENCY) {
    await Promise.all(pairs.slice(i, i + WRITE_CONCURRENCY).map(({ id, ...patch }) =>
      supabase.from("riders").update(patch).eq("id", id).then(({ error }) => {
        if (error) throw new Error(`kontrakt ${id}: ${error.message}`);
      })));
  }
  log(`  kontrakter skrevet: ${pairs.length}`);

  // 5) Post-verify: spejlingen SKAL ramme det derive persisterede.
  const mismatches = [];
  for (const [i, id] of insertedByPlanIndex) {
    const m = plan.rows[i].mirror;
    const p = byId.get(id);
    if (!p || p.base_value !== m.base_value || p.primary_type !== m.primary_type) {
      mismatches.push({ id, expected: { base_value: m.base_value, primary_type: m.primary_type }, got: p ?? null });
    }
  }
  return { inserted: ids, mismatches };
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

  // Modellerne VÆLGES af app_config præcis som derive'en gør, og det SAMME objekt
  // sendes til både spejlingen og derive (#5443). Fail-safe v4 ligger i loaderen.
  const valuationModel = await loadValuationModel(supabase) ?? loadValuationModelById(DEFAULT_VALUATION_MODEL_ID);
  const productionValuationModel = await loadProductionValueModel(supabase);

  const teams = await loadActiveAiTeams(supabase);
  const population = await loadPopulation(supabase, teams.map((t) => t.id));
  const plan = planYouthSquads({
    teams,
    juniorsPerTeam: args.juniors,
    targetSeason: args.season,
    seed: args.seed,
    existingNames: population.existingNames,
    valuationModel,
    productionValuationModel,
    existingByTeam: population.existingByTeam,
  });
  const summary = summarizePlan(plan, {
    ...population.load,
    aiSeniorBestAbility: await loadAiSeniorBestAbility(supabase, population.aiSeniorIds),
  });

  if (args.json) {
    console.log(JSON.stringify(summary, null, 2));
  } else {
    console.log("");
    console.log(`#5518 A6 - AI-ungdomstrupper til S${plan.targetSeason} (${args.apply ? "APPLY" : "DRY-RUN, read-only"})`);
    console.log("=".repeat(64));
    console.log(`  AI-hold .......................... ${summary.totals.teams}  (med eksisterende trup: ${summary.skippedTeams})`);
    console.log(`  U23-ryttere ...................... ${summary.totals.u23}`);
    console.log(`  Juniorer (${args.juniors} pr. hold) ............ ${summary.totals.junior}`);
    console.log(`  Over værdiloft (blokerer apply) .. ${summary.totals.overValueCap}`);
    console.log(`  Bestand i dag / vækst ............ ${summary.load.activeRiders} / +${summary.totals.riders}`);
    console.log(`  Pr. tier: ${JSON.stringify(summary.perTier)}`);
    console.log("");
  }
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, renderMarkdown(plan, summary));
    console.log(`  rapport skrevet: ${relative(REPO_ROOT, args.out)}`);
  }

  if (!args.apply) {
    if (!args.json) console.log("DRY-RUN (read-only). Intet skrevet. Apply ved cutover: --apply --owner-go\n");
    process.exit(0);
  }

  const season = await fetchActiveSeason(supabase);
  if (!season || season.number !== plan.targetSeason) {
    console.error(`STOP: målsæsonen er S${plan.targetSeason}, men den aktive sæson er ${season ? `S${season.number}` : "ingen"}. `
      + "deriveForRiderIds regner alder mod den AKTIVE sæson (#4876) — kør apply når målsæsonen er aktiv.");
    process.exit(2);
  }

  console.log("APPLY (--owner-go givet)");
  const { inserted, mismatches } = await applyPlan(supabase, plan, { valuationModel, productionValuationModel });
  const rollbackPath = join(REPO_ROOT, "balance-internals", `5518-a6-inserted-s${plan.targetSeason}-${Date.now()}.json`);
  mkdirSync(dirname(rollbackPath), { recursive: true });
  writeFileSync(rollbackPath, JSON.stringify({ inserted }, null, 2));
  console.log(`  rollback-liste (rytter-id'er): ${relative(REPO_ROOT, rollbackPath)}`);
  if (mismatches.length > 0) {
    console.error(`  SPEJLINGS-AFVIGELSE: ${mismatches.length} rytter(e) fik en anden base_value/type end gaten vurderede (#2065).`);
    process.exit(1);
  }
  console.log("  spejlings-gate: 0 afvigelser");
  process.exit(0);
}

// Kun når filen køres direkte — testen importerer de rene funktioner.
if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  main().catch((err) => {
    console.error(err?.message || err);
    process.exit(2);
  });
}
