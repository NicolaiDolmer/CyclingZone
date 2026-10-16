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
// #6668 (ejer 15/10 på #6667) — AI-ungdommen løftes til menneskeholdenes niveau:
//   --match-human-level   nye kuld får et mål-niveau pr. alder fra menneske-
//                         holdenes ungdom (se "Niveau-matchning" nedenfor)
//   --lift-existing       løfter OGSÅ de AI-ungdomsryttere der allerede findes
//                         (ny fødsels-markør + derive; navn, kontrakt og løn
//                         urørt). Indebærer --match-human-level.
//   S5-kørslen:  --juniors=0 --season=5 --lift-existing --out=balance-internals/<fil>.md
//   Apply som før: kun med --apply --owner-go, og kun når målsæsonen er aktiv.
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
  makeBirthMarker,
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

  // #6668: --lift-existing løfter de AI-ungdomsryttere der allerede findes, og
  // indebærer --match-human-level (nye kuld matches også mod menneske-fordelingen).
  const flag = (name) => {
    const v = get(name);
    if (v !== undefined && v !== true) throw new Error(`--${name} tager ingen værdi`);
    return v === true;
  };
  const liftExisting = flag("lift-existing");
  const matchHumanLevel = flag("match-human-level") || liftExisting;

  return { juniors, apply, ownerGo, json: get("json") === true, season, seed: seed >>> 0, out, matchHumanLevel, liftExisting };
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
  // Typen kommer fra resolveRiderTypes (identitets-kilden, #3588) — samme kald som derive.
  const { primary, secondary } = resolveRiderTypes(draw, caps, selectTypesBaseline(age, TYPES_BASELINE, YOUTH_TYPES_BASELINE));
  // rider-type-write-ok: prissætnings-input i hukommelsen (spejler derive), aldrig persisteret herfra.
  const valueRider = { ...row, primary_type: primary.key, age };
  const base_value = predictBaseValue(valueRider, abilities, valuationModel);
  const current_production_value = currentProductionValue(valueRider, abilities, productionValuationModel);
  return {
    age,
    abilities,
    // rider-type-write-ok: gatens forventning (rapport + post-verify); typen persisteres af deriveForRiderIds.
    primary_type: primary.key,
    // rider-type-write-ok: samme — kun til rapporten, aldrig skrevet til riders herfra.
    secondary_type: secondary.key,
    base_value,
    current_production_value,
    salary: computeFrozenSalary({ current_production_value }),
  };
}

// ── Niveau-matchning mod menneskeholdenes ungdom (#6668, ejer 15/10 på #6667) ─
//
// HVORFOR: S4's AI-ungdom blev født i akademiets/U23-båndet (lave evner), mens
// menneskeholdenes ungdom også rummer trænede akademiryttere og rigtige unge
// ryttere managerne selv har flyttet ned. Felterne blev mest AI, og menneske-
// holdene vandt næsten alt. Ejer-beslutning 15/10: AI-ungdommen løftes til SAMME
// niveaufordeling som menneskeholdenes ungdom, PR. ALDER.
//
// HVORDAN (ingen ny formel, intet nyt bånd): niveauet er rytterens bedste synlige
// evne (`bestAbility`, samme mål som rapporten altid har brugt). For hver alder
// læses menneskeholdenes ungdoms-fordeling (empirisk, fra prod ved kørslen). Hver
// AI-rytter får et mål-niveau fra den fordeling, og fødslen vælges blandt de
// fødsels-markører spillet allerede kender — truppens eget bånd (youth/u23) og
// voksen-tiers (`makeBirthMarker`) — over et lille, deterministisk sæt af
// fødsels-seeds. Den markør hvis reproducerede evner ligger tættest på målet
// vinder. Markøren persisteres som altid, så `deriveForRiderIds` og enhver
// heal-sweep reproducerer PRÆCIS det valgte træk (RIDER_GENERATION §8b).
//
// For få menneske-ryttere på en alder (fx de 16-årige før sæsonens første
// intake) → ingen løft: truppens eget bånd, uændret.
/** Færre menneske-ryttere end dette på en alder = ingen fordeling at matche. */
export const LEVEL_MATCH_MIN_SAMPLES = 20;
/** Fødsels-seeds pr. opskrift i søgningen (deterministiske). */
export const LEVEL_MATCH_SEED_TRIES = 12;
/** Voksen-tiers søgningen må vælge ud over truppens eget bånd (laveste først). */
export const LEVEL_MATCH_ADULT_TIERS = Object.freeze(["domestique", "solid", "star", "superstar"]);
const LEVEL_OFFSET = 6668;

/** Niveau-målet: bedste synlige evne. */
export const levelOf = (abilities) => bestAbility(abilities);

/**
 * Menneskeholdenes ungdoms-niveau pr. alder i målsæsonen. Ren funktion.
 * @param {Array<{birthdate:string, level:number}>} rows  menneskeholdenes ungdomsryttere
 * @param {{season:number, minSamples?:number}} opts
 * @returns {Map<number, number[]>} alder → sorterede niveauer (kun aldre med nok ryttere)
 */
export function buildHumanLevelProfile(rows, { season, minSamples = LEVEL_MATCH_MIN_SAMPLES }) {
  const byAge = new Map();
  for (const r of rows || []) {
    const age = ageForSeason(r.birthdate, season);
    const level = Number(r.level);
    if (!Number.isFinite(age) || !Number.isFinite(level)) continue;
    if (!byAge.has(age)) byAge.set(age, []);
    byAge.get(age).push(level);
  }
  const out = new Map();
  for (const [age, xs] of [...byAge].sort((a, b) => a[0] - b[0])) {
    if (xs.length >= minSamples) out.set(age, xs.slice().sort((a, b) => a - b));
  }
  return out;
}

/** Kvantil u∈[0,1) af en sorteret liste (nærmeste rang). null hvis listen mangler. */
export function levelQuantile(sorted, u) {
  if (!sorted?.length) return null;
  const i = Math.min(sorted.length - 1, Math.max(0, Math.floor(u * sorted.length)));
  return sorted[i];
}

/** Truppens eget fødsels-bånd for en alder (samme valg som planen altid har truffet). */
function nativeMarker(seed, age) {
  return age >= U23_BIRTH_AGE_MIN && age <= U23_BIRTH_AGE_MAX
    ? makeU23BirthMarker({ seed, age })
    : makeYouthBirthMarker({ seed, age });
}

/** Seed nr. k i søgningen. k = 0 er rytterens egen fødsels-seed (ingen ændring). */
function triedSeed(seed, k) {
  return k === 0 ? seed >>> 0 : deriveTeamSeed((seed + LEVEL_OFFSET) >>> 0, `level-${k}`);
}

/**
 * Vælg den fødsels-markør hvis reproducerede niveau ligger tættest på målet.
 * Ren + deterministisk. Kandidaterne er sorteret efter afstand (tie → truppens
 * eget bånd før voksen-tiers, lavere seed-nr. først), så kalderen kan gå videre
 * til næste kandidat hvis den bedste fx ligger over holdets værdiloft.
 *
 * @param {object} args
 * @param {object} args.row     payload-række (archetype_draw.primary/secondary, potentiale, birthdate)
 * @param {number} args.seed    rytterens fødsels-seed
 * @param {number} args.age     fødsels-alderen (= sæsonalder i målsæsonen)
 * @param {number|null} args.target  mål-niveau; null = truppens eget bånd, uændret
 * @returns {Array<{birth:object, level:number, distance:number}>}
 */
export function rankBirthCandidates({ row, seed, age, target, tries = LEVEL_MATCH_SEED_TRIES }) {
  const native = nativeMarker(seed, age);
  const levelFor = (birth) => levelOf(deriveBirthAbilities(
    { ...row, archetype_draw: { primary: row.archetype_draw.primary, secondary: row.archetype_draw.secondary ?? null, birth } },
    { age, classifierWeightsByType: CLASSIFIER_WEIGHTS_BY_TYPE },
  ));
  if (target == null) return [{ birth: native, level: levelFor(native), distance: 0 }];
  const out = [];
  for (let k = 0; k < tries; k++) {
    const s = triedSeed(seed, k);
    // Mellem truppens bånd (lavt loft) og voksen-tierne er der et hul: bedste
    // evne for en domestique ligger sjældent lavt. Den kapslede domestique (loftet
    // følger rytteren gennem enhver re-derive, `makeBirthMarker` cap) dækker hullet;
    // den står efter de ukapslede, så et ukapslet ramt mål altid foretrækkes.
    const recipes = [
      nativeMarker(s, age),
      ...LEVEL_MATCH_ADULT_TIERS.map((tier) => makeBirthMarker({ tier, seed: s, age })),
      makeBirthMarker({ tier: LEVEL_MATCH_ADULT_TIERS[0], seed: s, age, cap: target }),
    ];
    recipes.forEach((birth, r) => {
      const level = levelFor(birth);
      out.push({ birth, level, distance: Math.abs(level - target), order: k * recipes.length + r });
    });
  }
  out.sort((a, b) => (a.distance - b.distance) || (a.order - b.order));
  return out.map(({ birth, level, distance }) => ({ birth, level, distance }));
}

/**
 * Første kandidat der kan stå på holdet (under værdiloftet). Spejler derive for
 * hver kandidat der prøves. Ligger alle over loftet, returneres den bedste med
 * `overValueCap: true`, så apply-gaten blokerer som før.
 */
function chooseBirth({ payload, candidates, valueCap, mirrorOpts, idHint }) {
  let first = null;
  for (const c of candidates) {
    const draw = { primary: payload.archetype_draw.primary, secondary: payload.archetype_draw.secondary ?? null, birth: c.birth };
    const mirror = mirrorDerive({ ...payload, archetype_draw: draw, id: idHint }, mirrorOpts);
    const over = valueCap != null && mirror.base_value != null && mirror.base_value > valueCap;
    const pick = { draw, mirror, level: c.level, overValueCap: over };
    if (!first) first = pick;
    if (!over) return pick;
  }
  return first;
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
  levelProfile = null,
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
    // Egen strøm til mål-niveauet (#4180-princippet): uden --match-human-level
    // trækkes den aldrig, og kuldet er bit for bit som før.
    const levelRng = levelProfile ? makeRng(deriveTeamSeed((base + LEVEL_OFFSET) >>> 0, team.id)) : null;
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
      const mirrorOpts = { seasonNumber: targetSeason, valuationModel, productionValuationModel };
      if (levelRng) {
        // Rækkefølgen i strømmen følger kuldets rækkefølge: ét træk pr. rytter.
        const target = levelQuantile(levelProfile.get(age), levelRng());
        const ranked = rankBirthCandidates({ row: payload, seed: birthSeed, age, target });
        const pick = chooseBirth({ payload, candidates: ranked, valueCap, mirrorOpts, idHint: `plan-${team.id}-${i}` });
        payload.archetype_draw = pick.draw;
        return { teamId: team.id, squad, age, payload, mirror: pick.mirror, overValueCap: pick.overValueCap, target };
      }
      const mirror = mirrorDerive({ ...payload, id: `plan-${team.id}-${i}` }, mirrorOpts);
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

/**
 * Løft af de AI-ungdomsryttere der ALLEREDE står i trupperne (#6668). Ren funktion.
 *
 * Samme matchning som et nyt kuld, men målet er STRATIFICERET pr. alder: AI-
 * rytterne sorteres efter nuværende niveau og får hver sin kvantil af menneske-
 * fordelingen ((i + ½)/n). Rangordenen bevares (den bedste AI-junior forbliver den
 * bedste), og fordelingen rammes uden lodtræknings-støj. Rytteren BEHOLDER navn,
 * kontrakt, løn og anlæg; kun fødsels-markøren skiftes og derive gentages.
 *
 * Løftet sænker aldrig: ligger den bedste kandidat under rytterens nuværende
 * niveau, står han uændret. Ryttere der er vokset ud af ungdommen i målsæsonen
 * (Graduation Day), og ryttere uden en ungdoms-/U23-markør, røres ikke.
 *
 * @param {object} args
 * @param {Array<{id:string, team_id:string, birthdate:string, potentiale:number,
 *   archetype_draw:object, squad:string, level?:number}>} args.riders
 *   AI-holdenes ungdomsryttere; `level` = nuværende niveau (DB), ellers reproduceres det.
 * @param {Map<string,{tier:number,name?:string}>} args.teamsById
 * @param {number} args.targetSeason
 * @param {Map<number,number[]>} args.levelProfile  fra buildHumanLevelProfile
 */
export function planYouthLift({ riders, teamsById, targetSeason, levelProfile, valuationModel, productionValuationModel, rankCandidates = rankBirthCandidates }) {
  if (!(levelProfile instanceof Map)) throw new Error("planYouthLift: levelProfile er påkrævet");
  const mirrorOpts = { seasonNumber: targetSeason, valuationModel, productionValuationModel };
  const eligible = [];
  const skipped = { graduated: 0, noMarker: 0, noTeam: 0 };
  for (const r of riders || []) {
    const team = teamsById.get(r.team_id);
    if (!team) { skipped.noTeam++; continue; }
    const tier = r.archetype_draw?.birth?.tier;
    // Generatorens egne ryttere kendes på truppen: et tidligere løft kan have skiftet markørens tier.
    const generatorBorn = r.squad === "u23" || r.squad === "junior" || tier === "youth" || tier === U23_BIRTH_TIER;
    if (!isBornFromPriors(r) || !generatorBorn) { skipped.noMarker++; continue; }
    const age = ageForSeason(r.birthdate, targetSeason);
    if (!Number.isInteger(age) || age < JUNIOR_AGE_MIN || age > U23_BIRTH_AGE_MAX) { skipped.graduated++; continue; }
    const level = Number.isFinite(Number(r.level))
      ? Number(r.level)
      : levelOf(deriveBirthAbilities(r, { age, classifierWeightsByType: CLASSIFIER_WEIGHTS_BY_TYPE }));
    eligible.push({ rider: r, team, age, level });
  }

  const rows = [];
  const byAge = new Map();
  for (const e of eligible) {
    if (!byAge.has(e.age)) byAge.set(e.age, []);
    byAge.get(e.age).push(e);
  }
  for (const [age, list] of [...byAge].sort((a, b) => a[0] - b[0])) {
    list.sort((a, b) => (a.level - b.level) || String(a.rider.id).localeCompare(String(b.rider.id)));
    const profile = levelProfile.get(age);
    // Rangordenen bevares EFTER kandidatvalget: hver rytters nye niveau må ikke ligge
    // under den foregående (svagere) rytters nye niveau, selv om to nærmeste-kandidat-
    // søgninger rammer deres stigende mål forskelligt. `floor` er løbende maksimum.
    let floor = -Infinity;
    list.forEach((e, i) => {
      const target = levelQuantile(profile, (i + 0.5) / list.length);
      const base = { riderId: e.rider.id, teamId: e.rider.team_id, squad: e.rider.squad, age, before: e.level, target };
      const needsFloor = floor > e.level;
      if (target == null || (target <= e.level && !needsFloor)) {
        rows.push({ ...base, after: e.level, changed: false, overValueCap: false });
        floor = Math.max(floor, e.level);
        return;
      }
      const ranked = rankCandidates({
        row: e.rider, seed: Number(e.rider.archetype_draw.birth.seed), age, target: Math.max(target, floor),
      }).filter((c) => c.level >= floor);
      const pick = chooseBirth({
        payload: e.rider,
        candidates: ranked,
        valueCap: aiValueCapForTier(e.team.tier),
        mirrorOpts,
        idHint: e.rider.id,
      });
      if (needsFloor && !pick) {
        // Ingen kandidat når gulvet: rytteren ville stå under en svagere rytters nye niveau.
        // Det er ikke et gyldigt løft; marker rækken, så apply blokerer (aldrig stille brud på rangordenen).
        rows.push({ ...base, after: e.level, changed: false, overValueCap: false, rankFloorUnmet: true });
        return;
      }
      if (!pick || pick.level <= e.level) {
        rows.push({ ...base, after: e.level, changed: false, overValueCap: false });
        floor = Math.max(floor, e.level);
        return;
      }
      floor = Math.max(floor, pick.level);
      rows.push({
        ...base,
        after: pick.level,
        changed: true,
        overValueCap: pick.overValueCap,
        // Kun fødsels-markøren skiftes; resten af archetype_draw bevares.
        archetype_draw: { ...e.rider.archetype_draw, birth: pick.draw.birth },
        previousBirth: e.rider.archetype_draw.birth,
        mirror: pick.mirror,
      });
    });
  }
  return {
    targetSeason,
    rows,
    skipped,
    totals: {
      riders: rows.length,
      changed: rows.filter((r) => r.changed).length,
      overValueCap: rows.filter((r) => r.overValueCap).length,
      rankFloorUnmet: rows.filter((r) => r.rankFloorUnmet).length,
    },
  };
}

/**
 * Niveau-fordeling pr. trup og alder: menneske vs. AI før vs. AI efter. Ren.
 * @returns {Array<{squad:string, age:number, human:object, aiBefore:object, aiAfter:object}>}
 */
export function summarizeLevels({ humanProfile, lift, newRows = [] }) {
  const ages = new Set([...(humanProfile?.keys() ?? []), ...lift.rows.map((r) => r.age), ...newRows.map((r) => r.age)]);
  return [...ages].sort((a, b) => a - b).map((age) => {
    const liftRows = lift.rows.filter((r) => r.age === age);
    const fresh = newRows.filter((r) => r.age === age).map((r) => levelOf(r.mirror.abilities));
    return {
      age,
      human: describe(humanProfile?.get(age) ?? []),
      aiBefore: describe(liftRows.map((r) => r.before)),
      aiAfter: describe([...liftRows.map((r) => r.after), ...fresh]),
    };
  });
}

// ── Rapport (tal til balance-internals, aldrig til repoet) ───────────────────
const q = (xs, p) => {
  const s = xs.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.max(0, Math.ceil(p * s.length) - 1))];
};
const bestAbility = (a) => Math.max(...VISIBLE_ABILITIES.map((k) => Number(a?.[k])).filter(Number.isFinite));
function describe(xs) {
  const f = xs.filter(Number.isFinite);
  const mean = f.length ? f.reduce((s, x) => s + x, 0) / f.length : null;
  return { n: f.length, mean, p10: q(xs, 0.1), median: q(xs, 0.5), p90: q(xs, 0.9), max: q(xs, 1) };
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

/**
 * Idempotens-grundlag pr. AI-hold. U23-truppen kendes på `squad === "u23"` ELLER
 * U23-markøren: `--lift-existing`/`--match-human-level` kan skifte markørens tier til
 * en voksen-tier, så markøren alene må ikke afgøre om holdet har en U23-trup (#6668).
 */
export function summarizeExistingByTeam(aiRiders) {
  const existingByTeam = new Map();
  for (const r of aiRiders) {
    const e = existingByTeam.get(r.team_id) ?? { u23Born: false, juniors: 0 };
    if (r.squad === "u23" || r.archetype_draw?.birth?.tier === U23_BIRTH_TIER) e.u23Born = true;
    if (r.squad === "junior") e.juniors++;
    existingByTeam.set(r.team_id, e);
  }
  return existingByTeam;
}

export async function loadPopulation(supabase, aiTeamIds) {
  // schema-columns-ok: riders.squad findes i prod (database/2026-09-15-4619-riders-squad.sql,
  // #4619, verificeret 23/9 i information_schema); schema-snapshot.json er ikke gen-dumpet siden.
  const riders = await fetchAllRows(() => supabase.from("riders")
    .select("id, firstname, lastname, team_id, is_academy, squad, is_retired, archetype_draw")
    .order("id"));
  const aiSet = new Set(aiTeamIds);
  const active = riders.filter((r) => r.is_retired !== true);
  const aiRiders = active.filter((r) => r.team_id && aiSet.has(r.team_id));
  // Idempotens pr. trup. AI-hold får intet akademi-intake (runAcademyIntake er
  // kun for menneskehold), så en junior på et AI-hold stammer fra denne generator.
  const existingByTeam = summarizeExistingByTeam(aiRiders);
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
 *
 * `onInserted(ids)` kaldes straks efter HVERT holds insert, så kalderen kan
 * skrive rollback-listen løbende. Fejler et senere trin (et andet holds insert,
 * derive, kontrakter), findes de allerede indsatte id'er stadig på disk — ellers
 * ville en genkørsel se holdet som genereret (idempotensen) og aldrig give dets
 * ryttere derive eller kontrakt.
 */
export async function applyPlan(supabase, plan, {
  valuationModel,
  productionValuationModel,
  derive = deriveForRiderIds,
  log = console.log,
  onInserted = () => {},
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
      const batch = payload.slice(i, i + INSERT_BATCH);
      const { data, error } = await supabase.from("riders").insert(batch).select("id");
      if (error) throw new Error(`insert (hold ${teamId}): ${error.message}`);
      // Ét id pr. række, ellers ville en indsat rytter falde uden for derive,
      // kontrakt, rollback-liste og post-verify — tavst.
      if (!Array.isArray(data) || data.length !== batch.length) {
        throw new Error(`insert (hold ${teamId}): forventede ${batch.length} id'er, fik ${Array.isArray(data) ? data.length : "intet"}`);
      }
      data.forEach((row, k) => insertedByPlanIndex.set(idxs[i + k], row.id));
      onInserted(data.map((row) => row.id));
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
      // rider-type-write-ok: afvigelses-rapport (læst tilbage efter derive), skrives aldrig til riders.
      mismatches.push({ id, expected: { base_value: m.base_value, primary_type: m.primary_type }, got: p ?? null });
    }
  }
  return { inserted: ids, mismatches };
}

/** Niveau (bedste synlige evne) pr. rytter-id, læst af rider_derived_abilities. */
async function loadLevels(supabase, ids) {
  if (!ids.length) return new Map();
  const rows = await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("rider_derived_abilities")
    .select(["rider_id", ...VISIBLE_ABILITIES].join(", "))
    .in("rider_id", chunk)
    .order("rider_id"));
  return new Map(rows.map((r) => [r.rider_id, levelOf(r)]));
}

/**
 * #6668: menneskeholdenes ungdom (aktive, ikke-parkerede managerhold; trup u23/
 * junior) og AI-holdenes nuværende ungdomsryttere, med niveau. Kun SELECT.
 */
export async function loadLevelInputs(supabase, aiTeamIds) {
  // schema-columns-ok: riders.squad og teams.parked_at/retired_at findes i prod (#4619, A2 #5517).
  const [teams, riders] = await Promise.all([
    fetchAllRows(() => supabase.from("teams")
      .select("id, is_ai, is_bank, is_frozen, is_test_account, parked_at, retired_at")
      .order("id")),
    fetchAllRows(() => supabase.from("riders")
      .select("id, team_id, birthdate, potentiale, squad, is_retired, archetype_draw, generation_tag")
      .in("squad", ["u23", "junior"])
      .order("id")),
  ]);
  const humanTeams = new Set(teams
    .filter((t) => t.is_ai !== true && !t.is_bank && !t.is_frozen && !t.is_test_account && !t.parked_at && !t.retired_at)
    .map((t) => t.id));
  const aiSet = new Set(aiTeamIds);
  const active = riders.filter((r) => r.is_retired !== true && r.team_id);
  const human = active.filter((r) => humanTeams.has(r.team_id));
  const ai = active.filter((r) => aiSet.has(r.team_id));
  const levels = await loadLevels(supabase, [...human, ...ai].map((r) => r.id));
  return {
    humanRows: human.filter((r) => levels.has(r.id)).map((r) => ({ birthdate: r.birthdate, level: levels.get(r.id) })),
    aiRiders: ai.map((r) => ({ ...r, level: levels.get(r.id) })),
  };
}

/** Grund til at et løft ikke må anvendes (null = ok). Tjekkes FØR applyPlan skriver nye kuld (#6668). */
export function liftBlockedReason(lift) {
  if (lift?.totals?.rankFloorUnmet > 0) {
    return `STOP: ${lift.totals.rankFloorUnmet} løft kan ikke bevare rangordenen (ingen kandidat når gulvet) — apply blokeret før første skrivning (#6668).`;
  }
  if (!lift || !(lift.totals?.overValueCap > 0)) return null;
  return `STOP: ${lift.totals.overValueCap} løft over AI-holdets værdiloft — apply blokeret før første skrivning (#2065, #6668).`;
}

/**
 * Apply af løftet: restore-fil FØR første skrivning → ny fødsels-markør pr. rytter
 * → deriveForRiderIds med SAMME modeller som spejlingen → post-verify. Kontrakt og
 * løn røres ikke (løn er frosset ved signering, #1309).
 */
export async function applyLift(supabase, lift, {
  valuationModel,
  productionValuationModel,
  derive = deriveForRiderIds,
  log = console.log,
  writeRestore = () => {},
} = {}) {
  if (lift.totals.overValueCap > 0) {
    throw new Error(`STOP: ${lift.totals.overValueCap} løft over AI-holdets værdiloft — apply blokeret (#2065)`);
  }
  if (lift.totals.rankFloorUnmet > 0) {
    throw new Error(`STOP: ${lift.totals.rankFloorUnmet} løft kan ikke bevare rangordenen — apply blokeret (#6668)`);
  }
  const changed = lift.rows.filter((r) => r.changed);
  writeRestore(changed.map((r) => ({ id: r.riderId, birth: r.previousBirth })));
  for (let i = 0; i < changed.length; i += WRITE_CONCURRENCY) {
    await Promise.all(changed.slice(i, i + WRITE_CONCURRENCY).map((r) =>
      supabase.from("riders").update({ archetype_draw: r.archetype_draw }).eq("id", r.riderId).then(({ error }) => {
        if (error) throw new Error(`løft ${r.riderId}: ${error.message}`);
      })));
  }
  log(`  fødsels-markører skiftet: ${changed.length}`);
  const ids = changed.map((r) => r.riderId);
  if (!ids.length) return { lifted: [], mismatches: [] };
  await derive(supabase, ids, { dryRun: false, valuationModel, productionValuationModel });
  const persisted = await fetchAllRowsChunkedIn(ids, (chunk) => supabase.from("riders")
    .select("id, base_value, primary_type")
    .in("id", chunk)
    .order("id"));
  const byId = new Map(persisted.map((r) => [r.id, r]));
  const mismatches = [];
  for (const r of changed) {
    const p = byId.get(r.riderId);
    if (!p || p.base_value !== r.mirror.base_value || p.primary_type !== r.mirror.primary_type) {
      // rider-type-write-ok: afvigelses-rapport (læst tilbage efter derive), skrives aldrig til riders.
      mismatches.push({ id: r.riderId, expected: { base_value: r.mirror.base_value, primary_type: r.mirror.primary_type }, got: p ?? null });
    }
  }
  return { lifted: ids, mismatches };
}

/** Privat rapport-udsnit for niveau-matchningen (balance-internals). */
export function renderLevelMarkdown(levels, lift) {
  const L = ["## Niveau pr. alder (bedste synlige evne, #6668)", ""];
  L.push(`Løft: ${lift.totals.changed} af ${lift.totals.riders} AI-ungdomsryttere ændres · over værdiloft: ${lift.totals.overValueCap} · sprunget over: ${JSON.stringify(lift.skipped)}`, "");
  L.push("| alder | menneske n | menneske gns/median/p90/max | AI før gns/median/p90/max | AI efter gns/median/p90/max |", "|---:|---:|---|---|---|");
  const d = (x) => (x.n ? `${x.mean.toFixed(1)} / ${fmt(x.median)} / ${fmt(x.p90)} / ${fmt(x.max)}` : "-");
  for (const l of levels) L.push(`| ${l.age} | ${l.human.n} | ${d(l.human)} | ${d(l.aiBefore)} | ${d(l.aiAfter)} |`);
  L.push("", "Matchningens præcision (løftede ryttere): gns. |efter − mål| pr. alder, og andel der står uændret fordi målet ikke ligger over nuværende niveau.", "");
  for (const age of [...new Set(lift.rows.map((r) => r.age))].sort((a, b) => a - b)) {
    const rows = lift.rows.filter((r) => r.age === age);
    const ch = rows.filter((r) => r.changed);
    const err = ch.length ? ch.reduce((s, r) => s + Math.abs(r.after - r.target), 0) / ch.length : null;
    L.push(`- ${age}: ${err == null ? "-" : err.toFixed(1)} · uændret ${rows.length - ch.length}/${rows.length}`);
  }
  L.push("");
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

  // Modellerne VÆLGES af app_config præcis som derive'en gør, og det SAMME objekt
  // sendes til både spejlingen og derive (#5443). Fail-safe v4 ligger i loaderen.
  const valuationModel = await loadValuationModel(supabase) ?? loadValuationModelById(DEFAULT_VALUATION_MODEL_ID);
  const productionValuationModel = await loadProductionValueModel(supabase);

  const teams = await loadActiveAiTeams(supabase);
  const population = await loadPopulation(supabase, teams.map((t) => t.id));
  // #6668: menneskeholdenes ungdoms-niveau pr. alder (målsæsonens alders-akse).
  const levelInputs = args.matchHumanLevel ? await loadLevelInputs(supabase, teams.map((t) => t.id)) : null;
  const levelProfile = levelInputs ? buildHumanLevelProfile(levelInputs.humanRows, { season: args.season }) : null;
  const plan = planYouthSquads({
    teams,
    juniorsPerTeam: args.juniors,
    targetSeason: args.season,
    seed: args.seed,
    existingNames: population.existingNames,
    valuationModel,
    productionValuationModel,
    existingByTeam: population.existingByTeam,
    levelProfile,
  });
  const lift = args.liftExisting
    ? planYouthLift({
      riders: levelInputs.aiRiders,
      teamsById: new Map(teams.map((t) => [t.id, t])),
      targetSeason: args.season,
      levelProfile,
      valuationModel,
      productionValuationModel,
    })
    : null;
  const levels = levelProfile
    ? summarizeLevels({ humanProfile: levelProfile, lift: lift ?? { rows: [] }, newRows: plan.rows })
    : null;
  const summary = summarizePlan(plan, {
    ...population.load,
    aiSeniorBestAbility: await loadAiSeniorBestAbility(supabase, population.aiSeniorIds),
  });

  if (args.json) {
    console.log(JSON.stringify({ ...summary, lift: lift?.totals ?? null, levels }, null, 2));
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
    if (levelProfile) {
      console.log(`  Niveau-match (#6668) ............. aldre med menneske-fordeling: ${[...levelProfile.keys()].join(", ") || "-"}`);
    }
    if (lift) {
      console.log(`  Løft af eksisterende AI-ungdom ... ${lift.totals.changed} af ${lift.totals.riders} (over værdiloft: ${lift.totals.overValueCap})`);
    }
    console.log("");
  }
  if (args.out) {
    mkdirSync(dirname(args.out), { recursive: true });
    writeFileSync(args.out, renderMarkdown(plan, summary) + (levels ? `\n${renderLevelMarkdown(levels, lift ?? { rows: [], totals: { riders: 0, changed: 0, overValueCap: 0 }, skipped: {} })}` : ""));
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

  // Afvis et ugyldigt løft FØR første skrivning: applyPlan indsætter og deriverer nye kuld, og et løft
  // der først afvises i applyLift ville efterlade prod halvt opdateret (en genkørsel springer så kuldene over).
  if (liftBlockedReason(lift)) {
    console.error(liftBlockedReason(lift));
    process.exit(1);
  }

  console.log("APPLY (--owner-go givet)");
  // Rollback-listen skrives LØBENDE (efter hvert holds insert) og en sidste gang
  // i finally, så en fejl midt i kørslen aldrig efterlader indsatte ryttere uden
  // spor. `complete: false` = kørslen stoppede undervejs: de listede ryttere kan
  // mangle derive og/eller kontrakt og skal rulles tilbage eller re-derives, før
  // en genkørsel (idempotensen springer holdene over).
  const rollbackPath = join(REPO_ROOT, "balance-internals", `5518-a6-inserted-s${plan.targetSeason}-${Date.now()}.json`);
  mkdirSync(dirname(rollbackPath), { recursive: true });
  const insertedSoFar = [];
  const persistRollback = (complete) =>
    writeFileSync(rollbackPath, JSON.stringify({ inserted: insertedSoFar, complete }, null, 2));
  let result = null;
  try {
    // Et S5-løb uden nye kuld (alle hold har deres trupper) har intet at indsætte.
    result = plan.totals.riders === 0
      ? { inserted: [], mismatches: [] }
      : await applyPlan(supabase, plan, {
        valuationModel,
        productionValuationModel,
        onInserted: (ids) => { insertedSoFar.push(...ids); persistRollback(false); },
      });
  } finally {
    persistRollback(result !== null);
    console.log(`  rollback-liste (rytter-id'er, complete=${result !== null}): ${relative(REPO_ROOT, rollbackPath)}`);
  }
  const { mismatches } = result;
  if (mismatches.length > 0) {
    console.error(`  SPEJLINGS-AFVIGELSE: ${mismatches.length} rytter(e) fik en anden base_value/type end gaten vurderede (#2065).`);
    process.exit(1);
  }
  if (lift) {
    const restorePath = join(REPO_ROOT, "balance-internals", `6668-lift-restore-s${plan.targetSeason}-${Date.now()}.json`);
    const liftResult = await applyLift(supabase, lift, {
      valuationModel,
      productionValuationModel,
      writeRestore: (rows) => {
        writeFileSync(restorePath, JSON.stringify({ restore: rows }, null, 2));
        console.log(`  restore-fil (gamle fødsels-markører): ${relative(REPO_ROOT, restorePath)}`);
      },
    });
    if (liftResult.mismatches.length > 0) {
      console.error(`  SPEJLINGS-AFVIGELSE (løft): ${liftResult.mismatches.length} rytter(e) (#2065).`);
      process.exit(1);
    }
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
