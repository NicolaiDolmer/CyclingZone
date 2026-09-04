// #4634 (+ #4098) — SIMULERING af loft-varianter. READ-ONLY, ingen writes,
// ingen --live-gren. Skrevet til beslutningsgrundlaget i
// docs/audits/4634-cap-varianter-2026-09-04.md.
//
// Baggrund: ejeren skrev 2/9 i Discord #dansk-strategi at "Begraensninger er
// tiltaenkt - Haarde (laaste) begraensninger er ikke", og pegede paa to konkrete
// steder: bund-loftet ved dobbelt svaghed (ROLE_CLASS_TAG.svaghed) og
// GC-rytterens punch-loft. Dette script maaler hvad de foreslaaede aendringer
// faktisk ville gore ved den population der staar i prod lige nu.
//
// Scriptet aendrer INTET i produktionsstierne. Det genbruger de eksisterende
// modeller uaendret:
//   - buildYouthCaps + taperedAbsoluteCap (riderProgression.js) via en lokal
//     kopi af buildCapsForRider's sammensaetning, saa en VARIANT-cfg kan sendes
//     ind uden at roere den frosne YOUTH_PROGRESSION_CONFIG.
//   - dailyAbilityDelta (dailyTraining.js) som udviklings-model — samme funktion
//     motoren kalder hver dag. Ingen ny kurve opfundet her.
//   - predictBaseValueV4 (riderCareerNpv.js) som vaerdi-model.
//
// Brug:
//   node backend/scripts/simulate-4634-cap-variants.js
//   node backend/scripts/simulate-4634-cap-variants.js --json > out.json
//
// Kraever SUPABASE_URL + SUPABASE_SERVICE_KEY (backend/.env, som de oevrige
// dry-run-scripts). Laeser kun; skriver aldrig.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import {
  YOUTH_PROGRESSION_CONFIG,
  ROLE_CLASS_RATE,
  buildYouthCaps,
  taperedAbsoluteCap,
  peakAgeForType,
  abilityRoleClass,
} from "../lib/riderProgression.js";
import { dailyAbilityDelta } from "../lib/dailyTraining.js";
import { TRAINING_FOCUSES, smartDefaultFocus } from "../lib/training.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";
import { predictBaseValueV4 } from "../lib/riderCareerNpv.js";
import { applyTypeDampening } from "../lib/riderValuationTypeDampening.js";
import { CAPS_SHAPING_WEIGHTS } from "../lib/weights/capsShapingWeights.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const VALUATION_MODEL_PATH = join(__dirname, "../lib/riderValuationModelV4.json");

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

// ── Loft-sammensaetningen, identisk med buildCapsForRider ────────────────────
// buildCapsForRider tager ikke en cfg-parameter (den laeser den frosne
// YOUTH_PROGRESSION_CONFIG). Varianterne skal netop dreje paa den config, saa
// sammensaetningen gentages her — ÉN linje, samme raekkefoelge, samme afrunding.
// Roeres buildCapsForRider, skal denne foelge med (den er kun til analyse).
function capsForVariant(rider, cfg) {
  const absolute = buildYouthCaps(rider.potentiale, rider.primary_type, rider.secondary_type, cfg);
  const peakAge = peakAgeForType(rider.primary_type);
  const caps = {};
  for (const ability of VISIBLE_ABILITIES) {
    caps[ability] = clamp(Math.round(taperedAbsoluteCap(absolute[ability] ?? 0, rider.age, peakAge)), 0, 99);
  }
  return caps;
}

// Variant-config: samme objekt-form som YOUTH_PROGRESSION_CONFIG, med et andet
// svaghed-tag. Alt andet uaendret.
function cfgWithWeaknessTag(tag) {
  return Object.freeze({
    ...YOUTH_PROGRESSION_CONFIG,
    roleTags: Object.freeze({ ...YOUTH_PROGRESSION_CONFIG.roleTags, svaghed: tag }),
  });
}

// GC-varianten aendrer ikke et tag, men en VAEGT: `gc` har i dag ingen
// punch-post i CAPS_SHAPING_WEIGHTS, saa punch bliver `andenRolle` (55) — eller
// `svaghed` (25) hvis sekundaertypen er negativ om punch (tt). Varianten
// modelleres som et GULV paa GC-rytterens punch-loft, ikke som en vaegt-aendring,
// fordi et gulv ikke kan saenke nogens loft (samme invariant som haandvaerks-
// gulvet i abilityRoleClass).
function applyGcPunchFloor(caps, rider, floorTag) {
  if (rider.primary_type !== "gc") return caps;
  const peakAge = peakAgeForType(rider.primary_type);
  const floored = clamp(Math.round(taperedAbsoluteCap(floorTag, rider.age, peakAge)), 0, 99);
  if (floored <= caps.punch) return caps;
  return { ...caps, punch: floored };
}

// ── Udviklings-modellen ──────────────────────────────────────────────────────
// Neutral drift: rytterens smart-default-fokus paa normal intensitet, ingen
// manager-bonus, ingen staff/facilitet, ingen dagsstoej (noise=1), kondition 1.
// Det er den konservative bund: hvad der sker hvis manageren ikke goer noget
// saerligt.
//
// Dedikeret: hoerd intensitet paa det fokus der indeholder den paagaeldende
// evne. Det er loftet for hvad en manager KAN faa ud af aendringen paa den ene
// evne. De to tal spaender beslutningen ind.
function focusContaining(ability) {
  for (const [focus, abilities] of Object.entries(TRAINING_FOCUSES)) {
    if (abilities.includes(ability)) return focus;
  }
  return null;
}

// Ét udviklings-forloeb for ÉN evne over N dage. Bruger produktionens
// dailyAbilityDelta uaendret; akkumulerer delta i en progress-bar praecis som
// applyDailyTick goer (hele point naar baren passerer 1).
function simulateAbility({ rider, ability, cap, days, program, softKnee = null }) {
  let current = Number(rider.abilities[ability] ?? 0);
  let bar = 0;
  for (let d = 0; d < days; d++) {
    // Blodt loft (variant B): over tag'et fortsaetter vaeksten, men raten
    // ganges med softKnee.factor. Under tag'et er den uaendret.
    let effCap = cap;
    let softMult = 1;
    if (softKnee && current >= softKnee.tag) {
      effCap = softKnee.ceiling;
      softMult = softKnee.factor;
    }
    const delta = dailyAbilityDelta({
      ability,
      current,
      cap: effCap,
      age: rider.age,
      program,
      conditionMult: 1,
      bonus: false,
      noise: 1,
      potentiale: rider.potentiale,
      primaryType: rider.primary_type,
      secondaryType: rider.secondary_type,
    }) * softMult;
    if (delta <= 0) continue;
    bar += delta;
    while (bar >= 1 && current < Math.min(99, effCap)) {
      bar -= 1;
      current += 1;
    }
  }
  return current;
}

// ── Varianterne ──────────────────────────────────────────────────────────────
export function buildVariants() {
  return [
    { key: "baseline", label: "I dag (svaghed-tag 25)", cfg: YOUTH_PROGRESSION_CONFIG, gcPunchFloor: null, soft: null },
    { key: "A35", label: "A1: bund-loft 25 -> 35", cfg: cfgWithWeaknessTag(35), gcPunchFloor: null, soft: null },
    { key: "A40", label: "A2: bund-loft 25 -> 40", cfg: cfgWithWeaknessTag(40), gcPunchFloor: null, soft: null },
    { key: "A45", label: "A3: bund-loft 25 -> 45", cfg: cfgWithWeaknessTag(45), gcPunchFloor: null, soft: null },
    // B: taget bliver blodt. Loftet staar stadig paa 25 (det er der spillerens
    // "done" og prognosen laeser), men vaeksten stopper ikke — den fortsaetter
    // med 10 % af raten op til andenRolle-tag'et. Robsterens forslag, ordret
    // ("traen videre over loftet, bare 10x langsommere").
    { key: "B", label: "B: blodt loft (10 % rate over 25, til 55)", cfg: YOUTH_PROGRESSION_CONFIG, gcPunchFloor: null,
      soft: { tag: 25, ceiling: 55, factor: 0.10 } },
    { key: "C55", label: "C1: GC punch-gulv 55 (fjerner tt-nedgraderingen)", cfg: YOUTH_PROGRESSION_CONFIG, gcPunchFloor: 55, soft: null },
    { key: "C80", label: "C2: GC punch-gulv 80 (punch = sekundaer for GC)", cfg: YOUTH_PROGRESSION_CONFIG, gcPunchFloor: 80, soft: null },
  ];
}

// Hvor mange sÃ¦soner (28 dage) skal der til fÃ¸r en frigivet evne har vundet
// mindst 1 helt point? MÃ¥lt med dedikeret hÃ¥rd trÃ¦ning — altsÃ¥ det bedste en
// manager kan gÃ¸re. `null` = ikke naaet inden for `maxSeasons`.
export function seasonsToFirstPoint({ rider, ability, cap, softKnee = null, maxSeasons = 12 }) {
  const start = Number(rider.abilities[ability] ?? 0);
  const focus = focusContaining(ability);
  const program = focus ? { focus, intensity: "hard" } : { focus: smartDefaultFocus(rider.primary_type), intensity: "hard" };
  for (let s = 1; s <= maxSeasons; s++) {
    const v = simulateAbility({ rider, ability, cap, days: 28 * s, program, softKnee });
    if (v > start) return s;
  }
  return null;
}

// ── Ren beregning (DB injiceres) ─────────────────────────────────────────────
export function computeVariantScorecard({ riders, days, model, log = () => {} }) {
  const variants = buildVariants();
  const baselineCaps = new Map();
  for (const r of riders) baselineCaps.set(r.id, capsForVariant(r, YOUTH_PROGRESSION_CONFIG));

  const out = [];
  for (const v of variants) {
    let freedRiders = 0;
    let freedFields = 0;
    let raisedFields = 0;
    const gainsNeutral = [];
    const gainsDedicated = [];
    let sumGainNeutral = 0;
    let sumGainDedicated = 0;
    const valueDeltas = [];
    let gcPunchRaised = 0;
    let stillLocked = 0;
    let gain5y = 0;
    const seasonsToPoint = [];
    const freedByAge = {};
    const stillLockedByAge = {};

    for (const r of riders) {
      const base = baselineCaps.get(r.id);
      let caps = capsForVariant(r, v.cfg);
      if (v.gcPunchFloor) caps = applyGcPunchFloor(caps, r, v.gcPunchFloor);

      const neutralProgram = { focus: smartDefaultFocus(r.primary_type), intensity: "normal" };
      const afterNeutral = { ...r.abilities };
      const afterDedicated = { ...r.abilities };
      let riderFreed = false;

      for (const ability of VISIBLE_ABILITIES) {
        const cur = Number(r.abilities[ability] ?? 0);
        const capBase = base[ability] ?? 0;
        const capNew = caps[ability] ?? 0;
        const lockedBefore = cur >= capBase;
        const softApplies = v.soft && capBase <= v.soft.tag + 2;
        const raised = capNew > capBase;
        if (raised) raisedFields++;
        if (raised && r.primary_type === "gc" && ability === "punch") gcPunchRaised++;
        if (lockedBefore && (raised || softApplies)) {
          freedFields++;
          riderFreed = true;
        }
        if (!raised && !softApplies) continue;

        const softKnee = softApplies ? v.soft : null;
        const nNeutral = simulateAbility({ rider: r, ability, cap: capNew, days, program: neutralProgram, softKnee });
        afterNeutral[ability] = nNeutral;
        const focus = focusContaining(ability);
        const dedicatedProgram = focus ? { focus, intensity: "hard" } : neutralProgram;
        const nDed = simulateAbility({ rider: r, ability, cap: capNew, days, program: dedicatedProgram, softKnee });
        afterDedicated[ability] = nDed;

        const baseNeutral = simulateAbility({ rider: r, ability, cap: capBase, days, program: neutralProgram });
        const baseDed = simulateAbility({ rider: r, ability, cap: capBase, days, program: dedicatedProgram });
        sumGainNeutral += nNeutral - baseNeutral;
        sumGainDedicated += nDed - baseDed;
        if (nNeutral - baseNeutral > 0) gainsNeutral.push(nNeutral - baseNeutral);
        if (nDed - baseDed > 0) gainsDedicated.push(nDed - baseDed);

        // Fem sÃ¦soner (140 dage) med dedikeret hÃ¥rd trÃ¦ning: hvad er den
        // LANGE effekt, som ejeren mÃ¥ler pÃ¥ nÃ¥r "gamle ryttere er rullet ud"?
        const long5 = simulateAbility({ rider: r, ability, cap: capNew, days: 140, program: dedicatedProgram, softKnee });
        const long5base = simulateAbility({ rider: r, ability, cap: capBase, days: 140, program: dedicatedProgram });
        gain5y += long5 - long5base;

        if (lockedBefore) {
          const grp = r.age <= 23 ? "u24" : r.age <= 28 ? "24-28" : "29+";
          freedByAge[grp] = (freedByAge[grp] ?? 0) + 1;
          const s = seasonsToFirstPoint({ rider: r, ability, cap: capNew, softKnee });
          if (s == null) {
            stillLocked++;
            stillLockedByAge[grp] = (stillLockedByAge[grp] ?? 0) + 1;
          } else seasonsToPoint.push(s);
        }
      }

      if (riderFreed) freedRiders++;

      if (v.key !== "baseline" && model) {
        const vBefore = predictBaseValueV4({ ...r, age: r.age }, r.abilities, model);
        const vAfter = predictBaseValueV4({ ...r, age: r.age }, afterDedicated, model);
        if (Number.isFinite(vBefore) && Number.isFinite(vAfter) && vBefore > 0) {
          valueDeltas.push({ before: vBefore, after: vAfter, pct: (vAfter - vBefore) / vBefore });
        }
      }
    }

    out.push({
      key: v.key,
      label: v.label,
      freedRiders,
      freedFields,
      raisedFields,
      gcPunchRaised,
      sumGainNeutral: Math.round(sumGainNeutral),
      sumGainDedicated: Math.round(sumGainDedicated),
      medianGainNeutral: median(gainsNeutral),
      medianGainDedicated: median(gainsDedicated),
      maxGainDedicated: gainsDedicated.length ? Math.max(...gainsDedicated) : 0,
      ridersWithAnyGainNeutral: gainsNeutral.length,
      ridersWithAnyGainDedicated: gainsDedicated.length,
      medianValuePct: median(valueDeltas.map((d) => d.pct)),
      p90ValuePct: percentile(valueDeltas.map((d) => d.pct), 0.9),
      maxValuePct: valueDeltas.length ? Math.max(...valueDeltas.map((d) => d.pct)) : 0,
      valuesMoved: valueDeltas.filter((d) => Math.abs(d.pct) > 0.0001).length,
      valuePopulation: valueDeltas.length,
      gain5y: Math.round(gain5y),
      stillLockedAfter12Seasons: stillLocked,
      medianSeasonsToFirstPoint: median(seasonsToPoint),
      seasonsToPointSample: seasonsToPoint.length,
      freedByAge,
      stillLockedByAge,
    });
    log(`  ${v.label}: ${freedRiders} ryttere frigivet, ${freedFields} evne-felter`);
  }
  return { days, riders: riders.length, variants: out };
}

function median(arr) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function percentile(arr, p) {
  if (!arr.length) return 0;
  const s = [...arr].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(s.length * p))];
}

// ── Data-load (read-only) ────────────────────────────────────────────────────
export async function loadManagerRiders(supabase, seasonNumber) {
  const teams = await fetchAllRows(() =>
    supabase.from("teams").select("id")
      .eq("is_ai", false).eq("is_bank", false).eq("is_test_account", false).order("id"));
  const teamIds = new Set(teams.map((t) => t.id));

  const riderRows = await fetchAllRows(() =>
    supabase.from("riders")
      .select("id, birthdate, potentiale, primary_type, secondary_type, valuation_type, team_id, is_retired")
      .eq("is_retired", false).not("team_id", "is", null).order("id"));

  const mine = riderRows.filter((r) => teamIds.has(r.team_id));
  const byId = new Map(mine.map((r) => [r.id, r]));

  const derived = await fetchAllRows(() =>
    supabase.from("rider_derived_abilities")
      .select(`rider_id, ability_caps, ${VISIBLE_ABILITIES.join(", ")}`).order("rider_id"));

  const riders = [];
  for (const d of derived) {
    const r = byId.get(d.rider_id);
    if (!r) continue;
    const age = ageForSeason(r.birthdate, seasonNumber);
    if (!Number.isFinite(age)) continue;
    const abilities = {};
    for (const a of VISIBLE_ABILITIES) abilities[a] = Number(d[a] ?? 0);
    riders.push({
      id: r.id,
      age,
      potentiale: r.potentiale,
      primary_type: r.primary_type,
      secondary_type: r.secondary_type,
      valuation_type: r.valuation_type,
      abilities,
      storedCaps: d.ability_caps || {},
    });
  }
  return riders;
}

// Kontrol: matcher vores genberegnede baseline-lofter dem der faktisk staar i
// prod? Uden dette tal er hele simuleringen ubevist.
export function baselineFidelity(riders) {
  let fields = 0;
  let matches = 0;
  for (const r of riders) {
    const caps = capsForVariant(r, YOUTH_PROGRESSION_CONFIG);
    for (const a of VISIBLE_ABILITIES) {
      if (r.storedCaps?.[a] == null) continue;
      fields++;
      if (Number(r.storedCaps[a]) === caps[a]) matches++;
    }
  }
  return { fields, matches, pct: fields ? matches / fields : 0 };
}

// Hvor mange (rytter, evne) staar paa bund-tag'et i dag, og hvor mange er laast?
export function bottomCapCensus(riders, weaknessTag = YOUTH_PROGRESSION_CONFIG.roleTags.svaghed) {
  const byAbility = new Map();
  const byType = new Map();
  let lockedFields = 0;
  const lockedRiders = new Set();
  for (const r of riders) {
    const caps = capsForVariant(r, YOUTH_PROGRESSION_CONFIG);
    for (const a of VISIBLE_ABILITIES) {
      const klasse = abilityRoleClass(r.primary_type, r.secondary_type, a);
      if (klasse !== "svaghed") continue;
      const locked = Number(r.abilities[a] ?? 0) >= caps[a];
      if (!locked) continue;
      lockedFields++;
      lockedRiders.add(r.id);
      byAbility.set(a, (byAbility.get(a) ?? 0) + 1);
      byType.set(r.primary_type, (byType.get(r.primary_type) ?? 0) + 1);
    }
  }
  return {
    weaknessTag,
    lockedFields,
    lockedRiders: lockedRiders.size,
    byAbility: Object.fromEntries([...byAbility].sort((a, b) => b[1] - a[1])),
    byType: Object.fromEntries([...byType].sort((a, b) => b[1] - a[1])),
  };
}

// GC-punch-snittet: hvad er punch-loftet for GC-ryttere i dag, pr. sekundaertype?
export function gcPunchCensus(riders) {
  const rows = new Map();
  for (const r of riders) {
    if (r.primary_type !== "gc") continue;
    const key = r.secondary_type || "(ingen)";
    const caps = capsForVariant(r, YOUTH_PROGRESSION_CONFIG);
    const klasse = abilityRoleClass(r.primary_type, r.secondary_type, "punch");
    const row = rows.get(key) || { sec: key, riders: 0, klasse, sumCap: 0, locked: 0 };
    row.riders++;
    row.sumCap += caps.punch;
    if (Number(r.abilities.punch ?? 0) >= caps.punch) row.locked++;
    rows.set(key, row);
  }
  return [...rows.values()]
    .map((r) => ({ ...r, avgCap: Math.round((r.sumCap / r.riders) * 10) / 10 }))
    .sort((a, b) => b.riders - a.riders);
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function main() {
  dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
    console.error("FEJL: Mangler SUPABASE_URL eller SUPABASE_SERVICE_KEY");
    process.exit(1);
  }
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("number, start_date, end_date, race_days_total, race_days_completed")
    .eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(`season lookup: ${seasonErr.message}`);
  if (!season) throw new Error("ingen aktiv saeson");

  const daysLeft = Math.max(0, Number(season.race_days_total) - Number(season.race_days_completed));
  console.log(`=== #4634 loft-varianter (READ-ONLY) ===`);
  console.log(`Saeson ${season.number}, ${season.start_date} -> ${season.end_date}, ${daysLeft} dage tilbage`);

  const riders = await loadManagerRiders(supabase, season.number);
  console.log(`Ryttere paa manager-hold: ${riders.length}`);

  const fid = baselineFidelity(riders);
  console.log(`Baseline-troskab mod prod: ${(fid.pct * 100).toFixed(2)} % (${fid.matches}/${fid.fields} felter)`);

  const census = bottomCapCensus(riders);
  console.log(`\nPaa bund-loftet i dag: ${census.lockedRiders} ryttere, ${census.lockedFields} evne-felter`);
  console.log(`  pr. evne: ${JSON.stringify(census.byAbility)}`);
  console.log(`  pr. type: ${JSON.stringify(census.byType)}`);

  console.log(`\nGC-rytternes punch-loft i dag:`);
  for (const row of gcPunchCensus(riders)) {
    console.log(`  sek=${row.sec.padEnd(16)} n=${String(row.riders).padStart(4)}  klasse=${row.klasse.padEnd(11)} gns.loft=${row.avgCap}  laast=${row.locked}`);
  }

  const model = applyTypeDampening(JSON.parse(readFileSync(VALUATION_MODEL_PATH, "utf8")));
  console.log(`\nSimulerer ${daysLeft} dage af S${season.number}...`);
  const scorecard = computeVariantScorecard({ riders, days: daysLeft, model, log: () => {} });

  console.log(`\n${"variant".padEnd(46)} ${"frigivet".padStart(9)} ${"felter".padStart(7)} ${"loft hÃ¦vet".padStart(11)} ${"sum+ neutral".padStart(13)} ${"sum+ dedik.".padStart(12)} ${"median vaerdi".padStart(14)}`);
  for (const v of scorecard.variants) {
    console.log(
      `${v.label.padEnd(46)} ${String(v.freedRiders).padStart(9)} ${String(v.freedFields).padStart(7)} ` +
      `${String(v.raisedFields).padStart(11)} ${String(v.sumGainNeutral).padStart(13)} ${String(v.sumGainDedicated).padStart(12)} ` +
      `${(v.medianValuePct * 100).toFixed(2).padStart(13)}%`,
    );
  }

  console.log(`\n${"variant".padEnd(46)} ${"5 saes. dedik.".padStart(14)} ${"median saes. til +1".padStart(20)} ${"stadig laast".padStart(13)}`);
  for (const v of scorecard.variants) {
    console.log(
      `${v.label.padEnd(46)} ${String(v.gain5y).padStart(14)} ${String(v.medianSeasonsToFirstPoint).padStart(20)} ${String(v.stillLockedAfter12Seasons).padStart(13)}`,
    );
  }

  console.log(`
${"variant".padEnd(46)}  frigivne felter pr. alder -> stadig laast pr. alder`);
  for (const v of scorecard.variants) {
    if (v.key === "baseline") continue;
    console.log(`${v.label.padEnd(46)}  ${JSON.stringify(v.freedByAge)} -> ${JSON.stringify(v.stillLockedByAge)}`);
  }

  if (process.argv.includes("--json")) {
    console.log("\n" + JSON.stringify({ season: season.number, daysLeft, fidelity: fid, census, gcPunch: gcPunchCensus(riders), scorecard }, null, 2));
  }
  console.log("\nDRY-RUN: ingen writes. Varianterne er ikke anvendt nogen steder.");
}

if (process.argv[1] && process.argv[1].endsWith("simulate-4634-cap-variants.js")) {
  main().then(() => process.exit(0)).catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}

export { capsForVariant, cfgWithWeaknessTag, applyGcPunchFloor, simulateAbility, CAPS_SHAPING_WEIGHTS, ROLE_CLASS_RATE };
