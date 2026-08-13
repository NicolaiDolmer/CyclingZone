#!/usr/bin/env node
//
// ⚠ FROSSET 2026-08-14 (#3666). KØR IKKE UDEN AT LÆSE DETTE FØRST.
//
// Scriptet importerer `ratingFromAbilities`, og den funktion betyder ikke længere
// det samme. Før var rating et anker-normaliseret tal på 1-99; nu er den det
// vægtede snit af rollens evner. Alle rating-deltaer scriptet PRINTER er derfor i
// en anden enhed end da tallene blev læst og godkendt — prod-medianen faldt fra
// 59 til 13 ved omlægningen, så et delta der dengang var lille kan i dag se stort
// ud og omvendt.
//
// Selve mutationen (hvis scriptet har en) rører lofter/evner, ikke rating, og er
// dermed uændret. Det er RAPPORTEN der ikke længere kan sammenlignes med den der
// blev godkendt. Skal arbejdet gøres om, så re-kalibrer tærskler og forventede
// tal mod den nye skala FØRST.
//
// Slicen er lukket; scriptet er bevaret som historik, ikke som værktøj.
// #3570 fase 2 — SAMLET reparations-dry-run for de eksisterende UNGE ryttere.
// Ejer-beslutning: ÉN kørsel (ikke to), ny label + gen-formede lofter i samme pas,
// INGEN mutation (læser et DATERET snapshot, skriver kun til scratchpad).
//
// ── ALDERS-KONVENTIONEN (rettet 2026-08-10, natbølge spor A1) ───────────────────
// Den oprindelige udgave brugte snapshottets `age`-kolonne råt. I 9/8-snapshottet
// var den WALL-CLOCK-alder, mens HELE produktionskæden regner i SÆSON-alder
// (`ageForSeason(birthdate, seasonNumber)`, backend/lib/riderSeasonAge.js — SSOT):
//
//   • dailyTrainingEngine.js:280   alder til caps-taperen
//   • riderValueRefresh.js:147     alder til selectTypesBaseline + v4-værdien
//   • backfillCores.js trin 4+5    samme to steder
//
// Konsekvensen af wall-clock var målbar: 481 af de 2.356 "unge" i 9/8-snapshottet
// er 22+ i sæson-alder og klassificeres derfor i produktion mod VOKSEN-baselinen.
// Reparationen ville have givet dem en ungdoms-baseline-label som produktionens
// næste natte-sweep straks ville skrive om igen — 272 ryttere (143 menneske-ejede)
// reklassificeret TO gange, heraf 97 der ruller rouleur → baroudeur. Se
// negativ-testen (--dual-age-report) for de konkrete rytterskæbner.
//
// Alderen hentes nu UDELUKKENDE fra `ageForSeason()`, og sæsonnummeret læses fra
// snapshottets `meta.json` (`activeSeasonNumber`) — intet hårdkodet årstal, ingen
// lokal kopi af formlen.
//
// ── KALDFORMEN TIL buildCapsForRider (rettet samme sted) ───────────────────────
// Produktionen (dailyTrainingEngine.js:314) kalder MED alder:
//   buildCapsForRider(abilities, { ...rider, age }, primary, secondary)
// Alderen bruges kun af `taperedAbsoluteCap`, som først bider EFTER peakAge. Den
// oprindelige udgave udelod alderen; det er en reel defekt for voksne (målt på
// 10/8-snapshottet: 3.054 af 3.060 ryttere på 29+ får HØJERE lofter uden alder),
// men for reparations-populationen (sæson-alder < 22) er effekten præcis 0 —
// ingen ung er forbi peakAge. Vi bruger alligevel produktionens kaldform, så
// dry-runnet og produktionen ikke kan divergere når populationen ændrer sig.
// `--caps-age omit` gengiver den gamle kaldform (kun til måling).
//
// For hver rytter:
//   (a) NY LABEL = resolveRiderTypes(archetype_draw, EKSISTERENDE ability_caps,
//                    selectTypesBaseline(SÆSON-alder, adult, youth))
//   (b) GEN-FORMEDE LOFTER = buildCapsForRider(NUVÆRENDE abilities,
//                    { potentiale, age: SÆSON-alder }, nyPrimær, nySekundær)
//
// Brug:
//   node scripts/dev/repairYouth3570Phase2DryRun.mjs                  # 10/8-snapshot, sæson-alder
//   node scripts/dev/repairYouth3570Phase2DryRun.mjs --dual-age-report
//   node scripts/dev/repairYouth3570Phase2DryRun.mjs --legacy-youth <fil> --season 2 \
//        --age-mode wallclock --caps-age omit --population wallclock-youth   # 9/8-reproduktion
//
// Flag:
//   --snapshot-dir <dir>   mappe med riders_full.json + meta.json (default: 10/8-snapshottet)
//   --legacy-youth <fil>   bagudkompatibilitet: det gamle youth_16_21_full.json (intet meta.json)
//   --season <n>           sæsonnummer — KUN lovligt sammen med --legacy-youth
//   --age-mode season|wallclock   default season. wallclock = den GAMLE, defekte konvention
//   --caps-age prod|omit   default prod (= dailyTrainingEngine.js:314)
//   --population season-youth|wallclock-youth|all   default season-youth
//   --dual-age-report      kør begge alders-konventioner side om side (negativ-test)
//   --ignore-draw          brug computeRiderTypes i stedet for resolveRiderTypes (pre-#3588)
//   --out-dir <dir>
//
// ── IDENTITETS-KILDEN (rettet 2026-08-10, samme spor) ──────────────────────────
// Efter #3588 er `resolveRiderTypes(archetype_draw, caps, baseline)` identitets-
// kilden begge steder typen persisteres (backfillCores.js trin 4 + riderValueRefresh.js).
// Den oprindelige udgave kaldte `computeRiderTypes` direkte og ville derfor OVERSKRIVE
// det trukne anlæg for de ryttere der allerede HAR et. Målt på 10/8-snapshottet:
// 2 af de 6 draw-bærere (begge unge frie agenter) ville have fået deres anlæg
// omskrevet — puncheur→brostensrytter og rouleur→tt. Bagudkompatibelt: uden draw er
// resolveRiderTypes bit-identisk med computeRiderTypes (verificeret 0 afvigelser på
// alle 8.199 ryttere).

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { VISIBLE_ABILITIES } from "../../lib/abilityDerivation.js";
import { buildCapsForRider, buildYouthCaps } from "../../lib/riderProgression.js";
import { computeRiderTypes, resolveRiderTypes, RIDER_TYPE_KEYS } from "../../lib/riderTypes.js";
import { selectTypesBaseline, YOUTH_BASELINE_AGE_THRESHOLD } from "../../lib/riderTypesBaselineSelect.js";
import { ageForSeason } from "../../lib/riderSeasonAge.js";
import { ratingFromAbilities } from "../../lib/scoutingReport.js";
import { predictBaseValue } from "../../lib/riderValuation.js";
import { gateI1CapsWithinPotentialLoft } from "./lib/progressionGates3564.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── Argumenter ────────────────────────────────────────────────────────────────
const DEFAULT_SNAPSHOT_DIR =
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/e7903e78-1056-44a8-88db-107b33d8c05d/scratchpad/night-3570/snap-2026-08-10";

function parseArgs(argv) {
  const o = {
    snapshotDir: null, legacyYouth: null, season: null,
    ageMode: "season", capsAge: "prod", population: "season-youth",
    dualAgeReport: false, ignoreDraw: false, outDir: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === "--snapshot-dir") o.snapshotDir = next();
    else if (a === "--legacy-youth") o.legacyYouth = next();
    else if (a === "--season") o.season = Number(next());
    else if (a === "--age-mode") o.ageMode = next();
    else if (a === "--caps-age") o.capsAge = next();
    else if (a === "--population") o.population = next();
    else if (a === "--dual-age-report") o.dualAgeReport = true;
    else if (a === "--ignore-draw") o.ignoreDraw = true;
    else if (a === "--out-dir") o.outDir = next();
    else throw new Error(`Ukendt argument: ${a}`);
  }
  if (!["season", "wallclock"].includes(o.ageMode)) throw new Error(`--age-mode skal være season|wallclock`);
  if (!["prod", "omit"].includes(o.capsAge)) throw new Error(`--caps-age skal være prod|omit`);
  if (!["season-youth", "wallclock-youth", "all"].includes(o.population)) throw new Error(`--population ugyldig`);
  if (o.legacyYouth && o.snapshotDir) throw new Error("Vælg ÉN kilde: --snapshot-dir ELLER --legacy-youth");
  if (!o.legacyYouth && o.season != null) throw new Error("--season er kun lovlig sammen med --legacy-youth (ellers læses den af meta.json)");
  if (!o.legacyYouth) o.snapshotDir ??= DEFAULT_SNAPSHOT_DIR;
  return o;
}
const args = parseArgs(process.argv.slice(2));

// ── Indlæsning ────────────────────────────────────────────────────────────────
let riders, seasonNumber, snapshotLabel, snapshotTakenAt, legacyMode;
if (args.legacyYouth) {
  legacyMode = true;
  riders = JSON.parse(readFileSync(args.legacyYouth, "utf8"));
  // Bagudkompatibilitet: det gamle youth-snapshot har intet meta.json. Sæsonnummeret
  // SKAL derfor gives eksplicit — men kun i denne sti, og aldrig hårdkodet.
  const sidecar = join(dirname(args.legacyYouth), "meta.json");
  if (Number.isFinite(args.season)) seasonNumber = args.season;
  else if (existsSync(sidecar)) seasonNumber = JSON.parse(readFileSync(sidecar, "utf8")).activeSeasonNumber;
  else if (args.ageMode === "season") throw new Error("--legacy-youth uden meta.json kræver --season <n> når --age-mode=season");
  snapshotLabel = args.legacyYouth;
  snapshotTakenAt = null;
} else {
  legacyMode = false;
  const meta = JSON.parse(readFileSync(join(args.snapshotDir, "meta.json"), "utf8"));
  seasonNumber = meta.activeSeasonNumber;
  if (!Number.isFinite(seasonNumber)) throw new Error("meta.json mangler activeSeasonNumber");
  riders = JSON.parse(readFileSync(join(args.snapshotDir, "riders_full.json"), "utf8"));
  snapshotLabel = args.snapshotDir;
  snapshotTakenAt = meta.takenAt ?? null;
}

const OUT_DIR = args.outDir
  ?? "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/e7903e78-1056-44a8-88db-107b33d8c05d/scratchpad/night-3570/A1-alder/out";
mkdirSync(OUT_DIR, { recursive: true });

const adultBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaseline.json"), "utf8"));
const youthBaseline = JSON.parse(readFileSync(join(__dirname, "../../lib/riderTypesBaselineYouth.json"), "utf8"));
const v4Model = JSON.parse(readFileSync(join(__dirname, "../../lib/riderValuationModelV4.json"), "utf8"));

// ── Alder ─────────────────────────────────────────────────────────────────────
// SÆSON-alder: udelukkende via repoets SSOT. Ingen lokal formel her.
const seasonAgeOf = (r) => ageForSeason(r.birthdate, seasonNumber);
// WALL-CLOCK: kun til negativ-testen/den bagudkompatible reproduktion. 10/8-snapshottet
// har den i `age_wallclock`; det gamle youth-snapshot har den i `age`.
const wallclockAgeOf = (r) => (r.age_wallclock != null ? Number(r.age_wallclock) : (legacyMode ? Number(r.age) : null));
const ageOf = (r) => (args.ageMode === "season" ? seasonAgeOf(r) : wallclockAgeOf(r));

// ── Population ────────────────────────────────────────────────────────────────
const isYouthSeason = (r) => { const a = seasonAgeOf(r); return a != null && a < YOUTH_BASELINE_AGE_THRESHOLD; };
const isYouthWallclock = (r) => { const a = wallclockAgeOf(r); return a != null && a < YOUTH_BASELINE_AGE_THRESHOLD; };
const populationFilter =
  args.population === "season-youth" ? isYouthSeason
  : args.population === "wallclock-youth" ? isYouthWallclock
  : () => true;

const pop = riders.filter(populationFilter);

// Hvem falder ud/ind når populationen defineres på sæson-alder i stedet for wall-clock?
const wallYouthIds = new Set(riders.filter(isYouthWallclock).map((r) => r.rider_id));
const seasonYouthIds = new Set(riders.filter(isYouthSeason).map((r) => r.rider_id));
const droppedByAgeFix = riders.filter((r) => wallYouthIds.has(r.rider_id) && !seasonYouthIds.has(r.rider_id));
const addedByAgeFix = riders.filter((r) => seasonYouthIds.has(r.rider_id) && !wallYouthIds.has(r.rider_id));

// ── Hjælpere ──────────────────────────────────────────────────────────────────
const PHYSICAL = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability"];
const TECHNICAL = ["descending", "cobblestone", "positioning"];
const MENTAL = ["aggression", "tactics"];
const CATEGORY_OF = Object.fromEntries([
  ...PHYSICAL.map((a) => [a, "physical"]),
  ...TECHNICAL.map((a) => [a, "technical"]),
  ...MENTAL.map((a) => [a, "mental"]),
]);

const median = (vals) => {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
};
const p90 = (vals) => {
  const s = vals.filter(Number.isFinite).sort((a, b) => a - b);
  if (!s.length) return null;
  return s[Math.min(s.length - 1, Math.ceil(0.9 * s.length) - 1)];
};
const max = (vals) => { const s = vals.filter(Number.isFinite); return s.length ? Math.max(...s) : null; };

const abilitiesOf = (r) => {
  const o = {};
  for (const k of VISIBLE_ABILITIES) if (r.abilities?.[k] != null) o[k] = Number(r.abilities[k]);
  return o;
};

// Byg caps med den kaldform produktionen bruger (eller den gamle, alders-løse).
function capsArg(r, age) {
  return args.capsAge === "prod" ? { potentiale: r.potentiale, age } : { potentiale: r.potentiale };
}

// ── Kernen: én record pr. rytter ──────────────────────────────────────────────
const records = [];
let floorViolationCount = 0;
const floorViolationExamples = [];

for (const r of pop) {
  const oldPrimary = r.primary_type;
  const oldSecondary = r.secondary_type;
  const oldCaps = r.ability_caps;
  const age = ageOf(r);
  const currentAbilities = abilitiesOf(r);

  const rowModel = selectTypesBaseline(age, adultBaseline, youthBaseline);
  // Identitets-kilden (#3588): et persisteret archetype_draw VINDER over klassifikatoren.
  const newTypes = args.ignoreDraw
    ? computeRiderTypes(oldCaps, rowModel)
    : resolveRiderTypes(r.archetype_draw, oldCaps, rowModel);
  const newPrimary = newTypes.primary.key;
  const newSecondary = newTypes.secondary.key;

  const newCaps = buildCapsForRider(currentAbilities, capsArg(r, age), newPrimary, newSecondary);

  // Spiller-beskyttelse: må ALDRIG sænke cap under nuværende evne.
  // NB (brief §4): buildCapsForRider returnerer clamp(max(tapered, current),0,99),
  // så denne port KAN ikke fejle — den er en identitet, ikke evidens. Den ÆRLIGE
  // måling er `reduction*` nedenfor (loft sænket ift. de PERSISTEREDE caps).
  const floorBreaks = [];
  for (const a of VISIBLE_ABILITIES) {
    if (newCaps[a] < currentAbilities[a]) floorBreaks.push({ ability: a, cap: newCaps[a], current: currentAbilities[a] });
  }
  if (floorBreaks.length > 0) {
    floorViolationCount++;
    if (floorViolationExamples.length < 10) {
      floorViolationExamples.push({ rider_id: r.rider_id, name: `${r.firstname} ${r.lastname}`, floorBreaks });
    }
  }

  const youthCapsForGate = buildYouthCaps(r.potentiale, newPrimary, newSecondary);

  const ceilOldForOldType = ratingFromAbilities(oldCaps, oldPrimary);
  const ceilNewForNewType = ratingFromAbilities(newCaps, newPrimary);
  const ceilNewForOldType = ratingFromAbilities(newCaps, oldPrimary);

  // Kontrafaktisk værdi: HVIS valuation_type senere synkes til den nye type.
  // age SKAL være sæson-alder her — v4 er alders-følsom (riderValueRefresh.js:147).
  const cfRider = { ...r, valuation_type: newPrimary, age, potentiale: r.potentiale };
  const cfBaseValue = predictBaseValue(cfRider, currentAbilities, v4Model);

  records.push({
    rider_id: r.rider_id,
    name: `${r.firstname} ${r.lastname}`,
    age,
    ageSeason: seasonAgeOf(r),
    ageWallclock: wallclockAgeOf(r),
    potentiale: r.potentiale,
    owner_kind: r.owner_kind,
    manager: r.manager_display_name,
    is_academy: r.is_academy,
    oldPrimary, oldSecondary, newPrimary, newSecondary,
    typeChanged: oldPrimary !== newPrimary,
    baselineUsed: age != null && age < YOUTH_BASELINE_AGE_THRESHOLD ? "youth" : "adult",
    oldCaps, newCaps,
    capDelta: Object.fromEntries(VISIBLE_ABILITIES.map((a) => [a, newCaps[a] - (oldCaps?.[a] ?? 0)])),
    floorBreaks,
    caps: newCaps,
    youthCaps: youthCapsForGate,
    ceilOldForOldType, ceilNewForNewType, ceilNewForOldType,
    actualBaseValue: r.base_value,
    actualMarketValue: r.market_value,
    valuationType: r.valuation_type,
    counterfactualBaseValue: cfBaseValue,
  });
}

// ── Type-skift-matrix ─────────────────────────────────────────────────────────
function buildMatrix(recs) {
  const m = {};
  for (const t of RIDER_TYPE_KEYS) m[t] = Object.fromEntries(RIDER_TYPE_KEYS.map((t2) => [t2, 0]));
  for (const r of recs) {
    if (!m[r.oldPrimary]) m[r.oldPrimary] = Object.fromEntries(RIDER_TYPE_KEYS.map((t2) => [t2, 0]));
    m[r.oldPrimary][r.newPrimary] = (m[r.oldPrimary][r.newPrimary] || 0) + 1;
  }
  return m;
}
const matrixTotal = buildMatrix(records);
const matrixHuman = buildMatrix(records.filter((r) => r.owner_kind === "human"));

function shareDist(recs, field) {
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, 0]));
  for (const r of recs) dist[r[field]] = (dist[r[field]] || 0) + 1;
  const n = recs.length || 1;
  return Object.fromEntries(RIDER_TYPE_KEYS.map((t) => [t, { n: dist[t], pct: (dist[t] / n) * 100 }]));
}
const distBeforeTotal = shareDist(records, "oldPrimary");
const distAfterTotal = shareDist(records, "newPrimary");
const humanRecs = records.filter((r) => r.owner_kind === "human");
const distBeforeHuman = shareDist(humanRecs, "oldPrimary");
const distAfterHuman = shareDist(humanRecs, "newPrimary");

// ── Caps-diff pr. evne + kategori ─────────────────────────────────────────────
const perAbilityDiff = {};
for (const a of VISIBLE_ABILITIES) {
  const deltas = records.map((r) => r.capDelta[a]);
  const increases = deltas.filter((d) => d > 0);
  const decreases = deltas.filter((d) => d < 0).map((d) => -d);
  perAbilityDiff[a] = {
    category: CATEGORY_OF[a],
    nIncreased: increases.length, nDecreased: decreases.length,
    nUnchanged: deltas.length - increases.length - decreases.length,
    increaseMedian: median(increases), increaseP90: p90(increases), increaseMax: max(increases),
    decreaseMedian: median(decreases), decreaseP90: p90(decreases), decreaseMax: max(decreases),
  };
}
const perCategoryDiff = {};
for (const cat of ["physical", "technical", "mental"]) {
  const abilities = VISIBLE_ABILITIES.filter((a) => CATEGORY_OF[a] === cat);
  const allDeltas = [];
  for (const r of records) for (const a of abilities) allDeltas.push(r.capDelta[a]);
  const increases = allDeltas.filter((d) => d > 0);
  const decreases = allDeltas.filter((d) => d < 0).map((d) => -d);
  perCategoryDiff[cat] = {
    nIncreased: increases.length, nDecreased: decreases.length,
    increaseMedian: median(increases), increaseP90: p90(increases), increaseMax: max(increases),
    decreaseMedian: median(decreases), decreaseP90: p90(decreases), decreaseMax: max(decreases),
  };
}

// ── Store spillervendte udsving ───────────────────────────────────────────────
const BIG_SWING_THRESHOLD = 20;
const bigSwings = [];
for (const r of records) {
  for (const a of VISIBLE_ABILITIES) {
    const d = r.capDelta[a];
    if (Math.abs(d) >= BIG_SWING_THRESHOLD) {
      bigSwings.push({ rider_id: r.rider_id, name: r.name, manager: r.manager, owner_kind: r.owner_kind, ability: a, old: r.oldCaps?.[a], new: r.newCaps[a], delta: d });
    }
  }
}
bigSwings.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

// ── Loft-reduktion ift. de PERSISTEREDE caps (den ærlige beskyttelses-måling) ──
let ridersWithAnyReduction = 0;
const reductionMagnitudesPerRider = [];
let ridersWithAnyReductionHuman = 0;
const reductionMagnitudesHuman = [];
for (const r of records) {
  const reductions = VISIBLE_ABILITIES.map((a) => -r.capDelta[a]).filter((d) => d > 0);
  if (reductions.length) {
    ridersWithAnyReduction++;
    reductionMagnitudesPerRider.push(Math.max(...reductions));
    if (r.owner_kind === "human") { ridersWithAnyReductionHuman++; reductionMagnitudesHuman.push(Math.max(...reductions)); }
  }
}

// ── I1-gate ───────────────────────────────────────────────────────────────────
const i1 = gateI1CapsWithinPotentialLoft(records.map((r) => ({ id: r.rider_id, potentiale: r.potentiale, caps: r.caps, youthCaps: r.youthCaps })));

// ── Værdi ─────────────────────────────────────────────────────────────────────
const cfDeltas = records
  .filter((r) => r.counterfactualBaseValue != null && r.actualBaseValue != null && r.actualBaseValue !== 0)
  .map((r) => ({ ...r, delta: r.counterfactualBaseValue - r.actualBaseValue, deltaPct: (r.counterfactualBaseValue - r.actualBaseValue) / r.actualBaseValue * 100 }));
const cfDeltaAbsPct = cfDeltas.map((r) => Math.abs(r.deltaPct));
const cfTypeChangedOnly = cfDeltas.filter((r) => r.typeChanged);
const cfBig = cfDeltas.filter((r) => Math.abs(r.deltaPct) >= 20).sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct));
const sum = (xs) => xs.reduce((a, b) => a + b, 0);
const t4TotalActual = sum(cfDeltas.map((r) => r.actualBaseValue));
const t4TotalCf = sum(cfDeltas.map((r) => r.counterfactualBaseValue));

// ── Pr. manager ───────────────────────────────────────────────────────────────
const byManager = new Map();
for (const r of humanRecs) {
  const key = r.manager || "(ukendt)";
  if (!byManager.has(key)) byManager.set(key, { manager: key, riders: 0, typeChanged: 0, anyCapMoved: 0, anyCapReduced: 0, bigSwings: 0 });
  const m = byManager.get(key);
  m.riders++;
  if (r.typeChanged) m.typeChanged++;
  if (VISIBLE_ABILITIES.some((a) => r.capDelta[a] !== 0)) m.anyCapMoved++;
  if (VISIBLE_ABILITIES.some((a) => r.capDelta[a] < 0)) m.anyCapReduced++;
  m.bigSwings += VISIBLE_ABILITIES.filter((a) => Math.abs(r.capDelta[a]) >= BIG_SWING_THRESHOLD).length;
}
const managerRows = [...byManager.values()].sort((a, b) => b.typeChanged - a.typeChanged || b.riders - a.riders);

// ── Rating-visning ────────────────────────────────────────────────────────────
const ceilShiftsForUnchangedType = records.filter((r) => !r.typeChanged).map((r) => r.ceilNewForOldType - r.ceilOldForOldType);
const ceilShiftAbs = ceilShiftsForUnchangedType.map(Math.abs);
const ratingDrops = records.map((r) => r.ceilOldForOldType - r.ceilNewForNewType).filter((d) => d > 0);

// ── "Straf ALDRIG styrke": fordel effekten over potentiale + base_value-decil ──
function bandStats(keyFn) {
  const bands = new Map();
  for (const r of records) {
    const k = keyFn(r);
    if (!bands.has(k)) bands.set(k, { band: k, n: 0, typeChanged: 0, anyReduction: 0, reductions: [], cfPct: [] });
    const b = bands.get(k);
    b.n++;
    if (r.typeChanged) b.typeChanged++;
    const red = VISIBLE_ABILITIES.map((a) => -r.capDelta[a]).filter((d) => d > 0);
    if (red.length) { b.anyReduction++; b.reductions.push(Math.max(...red)); }
    if (r.counterfactualBaseValue != null && r.actualBaseValue) b.cfPct.push((r.counterfactualBaseValue - r.actualBaseValue) / r.actualBaseValue * 100);
  }
  return [...bands.values()].map((b) => ({
    band: b.band, n: b.n,
    typeChangedPct: (b.typeChanged / b.n) * 100,
    anyReductionPct: (b.anyReduction / b.n) * 100,
    reductionMedian: median(b.reductions), reductionP90: p90(b.reductions),
    cfPctMedian: median(b.cfPct),
  })).sort((a, b) => String(a.band).localeCompare(String(b.band), "da"));
}
const sortedByValue = records.filter((r) => Number.isFinite(r.actualBaseValue)).sort((a, b) => a.actualBaseValue - b.actualBaseValue);
const decileOf = new Map();
sortedByValue.forEach((r, i) => decileOf.set(r.rider_id, `D${String(Math.min(9, Math.floor((i / sortedByValue.length) * 10)) + 1).padStart(2, "0")}`));
const strengthFairness = {
  byPotentialBand: bandStats((r) => {
    const p = Number(r.potentiale);
    return !Number.isFinite(p) ? "ukendt" : p < 2 ? "1,0-1,9" : p < 3 ? "2,0-2,9" : p < 4 ? "3,0-3,9" : p < 5 ? "4,0-4,9" : "5,0-6,0";
  }),
  byBaseValueDecile: bandStats((r) => decileOf.get(r.rider_id) ?? "ukendt"),
};

// ── Negativ-test: begge alders-konventioner side om side ──────────────────────
// (a) FEJLER på den kendte historiske defekt: wall-clock-konventionen giver de
//     ryttere der er 22+ i sæson-alder en UNGDOMS-baseline-label som produktionen
//     straks skriver om igen.
// (b) BESTÅR på den sunde reference: sæson-alders-konventionen giver netop de
//     ryttere den samme label som produktionen selv ville udlede (0 omskrivninger).
let dualAge = null;
if (args.dualAgeReport) {
  const wallYouth = riders.filter(isYouthWallclock);
  const mismatched = wallYouth.filter((r) => !isYouthSeason(r)); // 22+ i sæson-alder
  const rows = [];
  let doubleReclass = 0, doubleReclassHuman = 0, rouleurToBaroudeur = 0;
  let doubleReclassRepairedCaps = 0, doubleReclassRepairedCapsHuman = 0, rouleurToBaroudeurRepairedCaps = 0;
  for (const r of mismatched) {
    const ab = abilitiesOf(r);
    const sAge = seasonAgeOf(r), wAge = wallclockAgeOf(r);
    // Wall-clock-konvention (defekten): ungdoms-baseline.
    const tW = computeRiderTypes(r.ability_caps, selectTypesBaseline(wAge, adultBaseline, youthBaseline));
    const capsW = buildCapsForRider(ab, { potentiale: r.potentiale, age: wAge }, tW.primary.key, tW.secondary.key);
    // Sæson-alders-konvention (rettelsen) = præcis det produktionen selv gør.
    const tS = computeRiderTypes(r.ability_caps, selectTypesBaseline(sAge, adultBaseline, youthBaseline));
    const capsS = buildCapsForRider(ab, { potentiale: r.potentiale, age: sAge }, tS.primary.key, tS.secondary.key);
    // Produktionens NÆSTE sweep efter reparationen (voksen-baseline, sæson-alder):
    //   variant A = mod de caps reparationen læste (kritikerens metode)
    //   variant B = mod de caps reparationen SKREV (den fysisk korrekte kæde)
    const prodA = computeRiderTypes(r.ability_caps, selectTypesBaseline(sAge, adultBaseline, youthBaseline)).primary.key;
    const prodB = computeRiderTypes(capsW, selectTypesBaseline(sAge, adultBaseline, youthBaseline)).primary.key;
    if (tW.primary.key !== prodA) {
      doubleReclass++;
      if (r.owner_kind === "human") doubleReclassHuman++;
      if (tW.primary.key === "rouleur" && prodA === "baroudeur") rouleurToBaroudeur++;
    }
    if (tW.primary.key !== prodB) {
      doubleReclassRepairedCaps++;
      if (r.owner_kind === "human") doubleReclassRepairedCapsHuman++;
      if (tW.primary.key === "rouleur" && prodB === "baroudeur") rouleurToBaroudeurRepairedCaps++;
    }
    const maxCapW = Math.max(...VISIBLE_ABILITIES.map((a) => capsW[a]));
    const maxCapS = Math.max(...VISIBLE_ABILITIES.map((a) => capsS[a]));
    rows.push({
      rider_id: r.rider_id, name: `${r.firstname} ${r.lastname}`,
      owner_kind: r.owner_kind, manager: r.manager_display_name,
      birthdate: r.birthdate, ageSeason: sAge, ageWallclock: wAge, potentiale: r.potentiale,
      persistedPrimary: r.primary_type,
      wallclock: { baseline: "youth", primary: tW.primary.key, secondary: tW.secondary.key, maxCap: maxCapW, caps: capsW },
      season: { baseline: "adult", primary: tS.primary.key, secondary: tS.secondary.key, maxCap: maxCapS, caps: capsS },
      typeDiffers: tW.primary.key !== tS.primary.key,
      maxCapDiff: maxCapW - maxCapS,
      prodRewriteTypeA: prodA, prodRewriteTypeB: prodB,
    });
  }
  const typeDiffers = rows.filter((x) => x.typeDiffers);
  const flow = {};
  for (const x of typeDiffers) {
    const k = `${x.wallclock.primary}→${x.season.primary}`;
    flow[k] = (flow[k] || 0) + 1;
  }
  dualAge = {
    wallclockYouthCount: wallYouth.length,
    seasonYouthCount: riders.filter(isYouthSeason).length,
    mismatchedCount: mismatched.length,
    mismatchedHuman: mismatched.filter((r) => r.owner_kind === "human").length,
    typeDiffersCount: typeDiffers.length,
    typeDiffersHuman: typeDiffers.filter((x) => x.owner_kind === "human").length,
    flowWallclockToSeason: Object.fromEntries(Object.entries(flow).sort((a, b) => b[1] - a[1])),
    doubleReclass_variantA_oldCaps: { total: doubleReclass, human: doubleReclassHuman, rouleurToBaroudeur },
    doubleReclass_variantB_repairedCaps: { total: doubleReclassRepairedCaps, human: doubleReclassRepairedCapsHuman, rouleurToBaroudeur: rouleurToBaroudeurRepairedCaps },
    examples: rows.filter((x) => x.typeDiffers).slice(0, 25),
    rows,
  };
}

// ── PORT: baseline-paritet mod produktionen ───────────────────────────────────
// Kriteriet: vælger dry-runnet SAMME type-baseline som produktionen (som altid
// bruger selectTypesBaseline(ageForSeason(...))) for hver rytter i populationen?
// Porten er ikke en identitet — den sammenligner to uafhængige alders-kilder.
function baselineParityGate(popRiders, ageFn) {
  let mismatches = 0; const ex = [];
  for (const r of popRiders) {
    const mine = selectTypesBaseline(ageFn(r), adultBaseline, youthBaseline) === youthBaseline ? "youth" : "adult";
    const prod = selectTypesBaseline(seasonAgeOf(r), adultBaseline, youthBaseline) === youthBaseline ? "youth" : "adult";
    if (mine !== prod) {
      mismatches++;
      if (ex.length < 5) ex.push({ rider_id: r.rider_id, name: `${r.firstname} ${r.lastname}`, ageSeason: seasonAgeOf(r), ageWallclock: wallclockAgeOf(r), mine, prod });
    }
  }
  return { n: popRiders.length, mismatches, pass: mismatches === 0, examples: ex };
}
const baselineParity = {
  thisRun: baselineParityGate(pop, ageOf),
  negativeControl_wallclockYouthPopWithWallclockAge: baselineParityGate(riders.filter(isYouthWallclock), wallclockAgeOf),
  positiveControl_seasonYouthPopWithSeasonAge: baselineParityGate(riders.filter(isYouthSeason), seasonAgeOf),
};

// ── Caps-kaldform: mål effekten af BEGGE former på populationen ───────────────
const capsCallForm = (() => {
  let differs = 0, maxDelta = 0, raisedPoints = 0;
  const byBand = {};
  const recById = new Map(records.map((x) => [x.rider_id, x]));
  for (const r of pop) {
    const ab = abilitiesOf(r);
    const a = seasonAgeOf(r);
    const rec = recById.get(r.rider_id);
    const p = rec?.newPrimary ?? r.primary_type, s = rec?.newSecondary ?? r.secondary_type;
    const withAge = buildCapsForRider(ab, { potentiale: r.potentiale, age: a }, p, s);
    const noAge = buildCapsForRider(ab, { potentiale: r.potentiale, age: null }, p, s);
    let md = 0, raised = 0;
    for (const k of VISIBLE_ABILITIES) { const d = noAge[k] - withAge[k]; if (d !== 0) { md = Math.max(md, Math.abs(d)); raised += Math.max(0, d); } }
    const band = a == null ? "ukendt" : a < 22 ? "<22" : a <= 28 ? "22-28" : a <= 32 ? "29-32" : "33+";
    byBand[band] ??= { n: 0, differs: 0, maxDelta: 0 };
    byBand[band].n++;
    if (md > 0) { byBand[band].differs++; byBand[band].maxDelta = Math.max(byBand[band].maxDelta, md); differs++; maxDelta = Math.max(maxDelta, md); raisedPoints += raised; }
  }
  // Samme måling over HELE snapshottet (kritikerens 29+-fund).
  const whole = {};
  for (const r of riders) {
    const ab = abilitiesOf(r);
    const a = seasonAgeOf(r);
    const withAge = buildCapsForRider(ab, { potentiale: r.potentiale, age: a }, r.primary_type, r.secondary_type);
    const noAge = buildCapsForRider(ab, { potentiale: r.potentiale, age: null }, r.primary_type, r.secondary_type);
    let md = 0;
    for (const k of VISIBLE_ABILITIES) md = Math.max(md, Math.abs(noAge[k] - withAge[k]));
    const band = a == null ? "ukendt" : a < 22 ? "<22" : a <= 28 ? "22-28" : a <= 32 ? "29-32" : "33+";
    whole[band] ??= { n: 0, differs: 0, maxDelta: 0 };
    whole[band].n++;
    if (md > 0) { whole[band].differs++; whole[band].maxDelta = Math.max(whole[band].maxDelta, md); }
  }
  return { populationDiffers: differs, populationN: pop.length, populationMaxDelta: maxDelta, populationRaisedPoints: raisedPoints, byBandInPopulation: byBand, byBandWholeSnapshot: whole };
})();

// ── Output ────────────────────────────────────────────────────────────────────
const summary = {
  run: {
    snapshot: snapshotLabel, snapshotTakenAt, seasonNumber,
    ageMode: args.ageMode, capsAge: args.capsAge, population: args.population, ignoreDraw: args.ignoreDraw,
    youthThreshold: YOUTH_BASELINE_AGE_THRESHOLD,
    ridersInSnapshot: riders.length, ridersInPopulation: pop.length,
  },
  populationShift: {
    wallclockYouth: wallYouthIds.size,
    seasonYouth: seasonYouthIds.size,
    droppedByAgeFix: droppedByAgeFix.length,
    droppedByAgeFixHuman: droppedByAgeFix.filter((r) => r.owner_kind === "human").length,
    addedByAgeFix: addedByAgeFix.length,
    addedByAgeFixHuman: addedByAgeFix.filter((r) => r.owner_kind === "human").length,
    droppedAgeHistogramSeasonAge: droppedByAgeFix.reduce((a, r) => { const k = seasonAgeOf(r); a[k] = (a[k] || 0) + 1; return a; }, {}),
    ownerKindInPopulation: pop.reduce((a, r) => { a[r.owner_kind] = (a[r.owner_kind] || 0) + 1; return a; }, {}),
  },
  n: records.length,
  typeChangedTotal: records.filter((r) => r.typeChanged).length,
  typeChangedHuman: humanRecs.filter((r) => r.typeChanged).length,
  humanN: humanRecs.length,
  matrixTotal, matrixHuman,
  distBeforeTotal, distAfterTotal, distBeforeHuman, distAfterHuman,
  gcBefore: { total: distBeforeTotal.gc, human: distBeforeHuman.gc },
  gcAfter: { total: distAfterTotal.gc, human: distAfterHuman.gc },
  baroudeurBefore: { total: distBeforeTotal.baroudeur, human: distBeforeHuman.baroudeur },
  baroudeurAfter: { total: distAfterTotal.baroudeur, human: distAfterHuman.baroudeur },
  rouleurBefore: { total: distBeforeTotal.rouleur, human: distBeforeHuman.rouleur },
  rouleurAfter: { total: distAfterTotal.rouleur, human: distAfterHuman.rouleur },
  perAbilityDiff, perCategoryDiff,
  bigSwingCount: bigSwings.length,
  bigSwingRiderCount: new Set(bigSwings.map((s) => s.rider_id)).size,
  floorViolationCount, floorViolationExamples,
  floorGateNote: "Porten er en identitet (buildCapsForRider gulver på current) — 0 er ikke evidens. Se reduction*.",
  ridersWithAnyReduction,
  ridersWithAnyReductionPct: records.length ? (ridersWithAnyReduction / records.length) * 100 : null,
  reductionMedian: median(reductionMagnitudesPerRider),
  reductionP90: p90(reductionMagnitudesPerRider),
  reductionMax: max(reductionMagnitudesPerRider),
  ridersWithAnyReductionHuman,
  ridersWithAnyReductionHumanPct: humanRecs.length ? (ridersWithAnyReductionHuman / humanRecs.length) * 100 : null,
  reductionMedianHuman: median(reductionMagnitudesHuman),
  reductionP90Human: p90(reductionMagnitudesHuman),
  reductionMaxHuman: max(reductionMagnitudesHuman),
  i1,
  cfDeltaCount: cfDeltas.length,
  cfDeltaAbsPctMedian: median(cfDeltaAbsPct),
  cfDeltaAbsPctP90: p90(cfDeltaAbsPct),
  cfDeltaAbsPctMax: max(cfDeltaAbsPct),
  cfBigCount: cfBig.length,
  cfTypeChangedOnlyCount: cfTypeChangedOnly.length,
  t4TotalActual, t4TotalCf,
  t4TotalPct: t4TotalActual ? ((t4TotalCf - t4TotalActual) / t4TotalActual) * 100 : null,
  ceilShiftUnchangedTypeMedian: median(ceilShiftAbs),
  ceilShiftUnchangedTypeP90: p90(ceilShiftAbs),
  ceilShiftUnchangedTypeMax: max(ceilShiftAbs),
  ratingDropCount: ratingDrops.length,
  ratingDropMedian: median(ratingDrops), ratingDropP90: p90(ratingDrops), ratingDropMax: max(ratingDrops),
  strengthFairness,
  capsCallForm,
  baselineParity,
  managerRowsTop: managerRows.slice(0, 15),
  managerRowsCount: managerRows.length,
  dualAge: dualAge ? { ...dualAge, rows: undefined, examples: dualAge.examples.slice(0, 10) } : null,
};

writeFileSync(join(OUT_DIR, "reparations-dryrun.json"), JSON.stringify({ summary, bigSwingsTop50: bigSwings.slice(0, 50), cfBigTop30: cfBig.slice(0, 30), dualAgeRows: dualAge?.rows ?? null, records }, null, 2));

console.log(JSON.stringify(summary, null, 2));
