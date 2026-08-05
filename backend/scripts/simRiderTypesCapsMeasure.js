#!/usr/bin/env node
// READ-ONLY måle-harness for #3325 (type = potentiale). Ingen mutation.
//
// Sammenligner ryttertype-fordelingen FØR (nuværende persisteret primary_type,
// klassificeret mod LIVE rider_derived_abilities) og EFTER (klassificeret mod
// ability_caps med en ny caps-fittet baseline) over HELE populationen, opdelt
// på aldersgrupper. Understøtter alternative vægt/guard-varianter via CANDIDATES
// nedenfor, så en kollaps-fix kan måles før den skrives ind i riderTypes.js.
//
//   node scripts/simRiderTypesCapsMeasure.js
//   node scripts/simRiderTypesCapsMeasure.js --sample   # + 10 stikprøve-ryttere

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { readFileSync } from "node:fs";
import { fetchAllRows } from "../lib/supabasePagination.js";
import { ABILITY_KEYS, RIDER_TYPES, RIDER_TYPE_KEYS, GUARDS, scoreRiderType } from "../lib/riderTypes.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });
// Den FAKTISKE baseline der bliver committet (fittet af fitRiderTypesBaseline.js
// --caps, ekskl. retired) — kandidat 6/FINAL bruger DENNE, ikke et ad-hoc inline-fit,
// så PR-tallene matcher 1:1 hvad der ryger i produktion.
const SHIPPED_BASELINE = JSON.parse(readFileSync(join(__dirname, "../lib/riderTypesBaseline.json"), "utf8"));

const SHOW_SAMPLE = process.argv.includes("--sample");
const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

// ── Guard-varianter (kandidat B er den der forventes at løse gc-kollapset) ────
function guardedOutV0(a) {
  const out = new Set();
  if (ABILITY_KEYS.filter((k) => ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"].includes(k)).some((k) => num(a[k]) >= GUARDS.highSpeciality)) out.add("rouleur");
  if (num(a.sprint) > num(a.cobblestone)) out.add("brostensrytter");
  const isGc = num(a.climbing) >= GUARDS.gcClimbing && num(a.time_trial) >= GUARDS.gcTimeTrial && num(a.recovery) >= GUARDS.gcRecovery && num(a.punch) <= num(a.time_trial);
  if (!isGc) out.add("gc");
  return out;
}

function classify(abilities, weightsByType, baseline, guardFn = guardedOutV0) {
  const out = guardFn(abilities);
  let scored = RIDER_TYPES.filter((t) => !out.has(t.key)).map((t) => ({ key: t.key, score: scoreRiderType(abilities, weightsByType[t.key], baseline) }));
  if (scored.length < 2) scored = RIDER_TYPES.map((t) => ({ key: t.key, score: scoreRiderType(abilities, weightsByType[t.key], baseline) }));
  scored.sort((a, b) => b.score - a.score);
  return { primary: scored[0].key, secondary: scored[1].key };
}

// ── Percentil-hjælper: find percentilen af `value` i `arr`, og find den værdi i
// `arr2` der ligger på SAMME percentil. Bruges til at rekalibrere absolutte
// GUARD-tærskler (0-99-enheder) fra live-ability-rummet til caps-rummet — de to
// rum har forskellig fordeling (caps har fx meget lavere recovery-spredning),
// så et uændret tal betyder en helt anden selektivitet.
function percentileOfValue(arr, value) {
  const s = [...arr].sort((a, b) => a - b);
  let i = 0;
  while (i < s.length && s[i] < value) i++;
  return i / (s.length || 1);
}
function valueAtPercentile(arr, p) {
  const s = [...arr].sort((a, b) => a - b);
  const idx = Math.min(s.length - 1, Math.max(0, Math.round(p * (s.length - 1))));
  return s[idx];
}

function fitBaseline(rows, keyFn) {
  const mean = {}, std = {};
  for (const a of ABILITY_KEYS) {
    const vals = rows.map((r) => Number(keyFn(r)[a])).filter((v) => Number.isFinite(v));
    const m = vals.reduce((x, y) => x + y, 0) / (vals.length || 1);
    const variance = vals.reduce((x, y) => x + (y - m) ** 2, 0) / (vals.length || 1);
    mean[a] = m;
    std[a] = Math.sqrt(variance) || 1;
  }
  return { mean, std };
}

async function fetchAll() {
  const { data: season, error: seasonErr } = await supabase.from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(seasonErr.message);
  const seasonNumber = season?.number ?? 1;

  const rows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ability_caps, ${ABILITY_KEYS.join(", ")}, riders!inner(id, firstname, lastname, birthdate, is_retired, primary_type, secondary_type)`)
      .order("rider_id"));
  const out = rows.map((r) => ({
    rider_id: r.rider_id,
    live: Object.fromEntries(ABILITY_KEYS.map((k) => [k, r[k]])),
    caps: r.ability_caps || {},
    name: `${r.riders.firstname} ${r.riders.lastname}`,
    is_retired: r.riders.is_retired,
    age: ageForSeason(r.riders.birthdate, seasonNumber),
    oldPrimary: r.riders.primary_type,
    oldSecondary: r.riders.secondary_type,
  }));
  return { rows: out, seasonNumber };
}

function ageGroup(age) {
  if (age == null) return "ukendt";
  if (age <= 21) return "≤21 (U22)";
  if (age <= 25) return "22-25";
  return "≥26 (senior)";
}

function distTable(label, rows, typeOf) {
  const dist = Object.fromEntries(RIDER_TYPE_KEYS.map((k) => [k, 0]));
  for (const r of rows) dist[typeOf(r)] = (dist[typeOf(r)] || 0) + 1;
  const n = rows.length;
  console.log(`\n--- ${label} (n=${n}) ---`);
  for (const k of RIDER_TYPE_KEYS) {
    const c = dist[k] || 0;
    console.log(`  ${k.padEnd(15)} ${String(c).padStart(5)} (${((c / (n || 1)) * 100).toFixed(1).padStart(5)}%)`);
  }
  return dist;
}

async function main() {
  console.log("=== #3325 caps-migration måling (READ-ONLY, prod) ===");
  const { rows, seasonNumber } = await fetchAll();
  console.log(`Sæson ${seasonNumber} · ${rows.length} ryttere (rider_derived_abilities inner join, inkl. retired)`);

  const active = rows.filter((r) => !r.is_retired);
  const groups = {
    "ALLE (inkl. retired)": rows,
    "≤21 (U22)": rows.filter((r) => ageGroup(r.age) === "≤21 (U22)"),
    "22-25": rows.filter((r) => ageGroup(r.age) === "22-25"),
    "≥26 (senior)": rows.filter((r) => ageGroup(r.age) === "≥26 (senior)"),
  };

  // ── FØR: nuværende persisterede primary_type (klassificeret mod LIVE abilities) ──
  console.log("\n\n########## FØR (nuværende primary_type, live-abilities-klassifikator) ##########");
  for (const [label, grp] of Object.entries(groups)) distTable(label, grp, (r) => r.oldPrimary || "?");

  // ── EFTER kandidat 1: caps som input, ORIGINALE vægte/guards, caps-fittet baseline ──
  const weightsByType = Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights]));
  const capsBaseline = fitBaseline(rows, (r) => r.caps);
  console.log("\n\nCaps-baseline (mean/std, fittet over hele populationen):");
  for (const a of ABILITY_KEYS) console.log(`  ${a.padEnd(13)} mean=${capsBaseline.mean[a].toFixed(1).padStart(6)}  std=${capsBaseline.std[a].toFixed(1).padStart(6)}`);

  const newTypeOf = new Map();
  for (const r of rows) newTypeOf.set(r.rider_id, classify(r.caps, weightsByType, capsBaseline));

  console.log("\n\n########## EFTER kandidat 1: caps + originale vægte/guards ##########");
  for (const [label, grp] of Object.entries(groups)) distTable(label, grp, (r) => newTypeOf.get(r.rider_id).primary);

  // ── Kandidat 2: guards rekalibreret til caps-rummet (samme percentil-selektivitet
  // som de originale absolutte tærskler havde i LIVE-rummet) + climber/puncheur-
  // overlap fjernet (de deler ikke længere hinandens speciale-evne som positiv). ──
  const liveArr = (k) => rows.map((r) => num(r.live[k]));
  const capsArr = (k) => rows.map((r) => num(r.caps[k]));
  const specLiveArr = rows.flatMap((r) => ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"].map((k) => num(r.live[k])));
  const specCapsArr = rows.flatMap((r) => ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"].map((k) => num(r.caps[k])));

  const pHighSpec = percentileOfValue(specLiveArr, GUARDS.highSpeciality);
  const pGcClimb = percentileOfValue(liveArr("climbing"), GUARDS.gcClimbing);
  const pGcTt = percentileOfValue(liveArr("time_trial"), GUARDS.gcTimeTrial);
  const pGcRec = percentileOfValue(liveArr("recovery"), GUARDS.gcRecovery);

  const GUARDS_CAPS = {
    highSpeciality: valueAtPercentile(specCapsArr, pHighSpec),
    gcClimbing: valueAtPercentile(capsArr("climbing"), pGcClimb),
    gcTimeTrial: valueAtPercentile(capsArr("time_trial"), pGcTt),
    gcRecovery: valueAtPercentile(capsArr("recovery"), pGcRec),
  };
  console.log("\n\nGuard-rekalibrering (samme percentil i caps-rummet som originalen havde i live-rummet):");
  console.log(`  highSpeciality: live=${GUARDS.highSpeciality} (p${(pHighSpec * 100).toFixed(0)}) → caps=${GUARDS_CAPS.highSpeciality} `);
  console.log(`  gcClimbing:     live=${GUARDS.gcClimbing} (p${(pGcClimb * 100).toFixed(0)}) → caps=${GUARDS_CAPS.gcClimbing}`);
  console.log(`  gcTimeTrial:    live=${GUARDS.gcTimeTrial} (p${(pGcTt * 100).toFixed(0)}) → caps=${GUARDS_CAPS.gcTimeTrial}`);
  console.log(`  gcRecovery:     live=${GUARDS.gcRecovery} (p${(pGcRec * 100).toFixed(0)}) → caps=${GUARDS_CAPS.gcRecovery}`);

  function guardedOutCaps(a) {
    const out = new Set();
    if (["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"].some((k) => num(a[k]) >= GUARDS_CAPS.highSpeciality)) out.add("rouleur");
    if (num(a.sprint) > num(a.cobblestone)) out.add("brostensrytter");
    const isGc = num(a.climbing) >= GUARDS_CAPS.gcClimbing && num(a.time_trial) >= GUARDS_CAPS.gcTimeTrial && num(a.recovery) >= GUARDS_CAPS.gcRecovery && num(a.punch) <= num(a.time_trial);
    if (!isGc) out.add("gc");
    return out;
  }

  // climber/puncheur ikke længere hinandens sekundære speciale (fjerner den delte
  // positive vægt — hverken belønning ELLER straf — så den ene ikke automatisk
  // vinder ved middel klatring/punch, uden at gøre dem til hinandens modsætning).
  const weightsByTypeV2 = {
    ...weightsByType,
    climber: { climbing: 3, tempo: 2, endurance: 1, sprint: -2, acceleration: -1, flat: -1 },
    puncheur: { punch: 3, tempo: 2, endurance: 1, time_trial: -1, sprint: -1 },
  };

  const newTypeOfV2 = new Map();
  for (const r of rows) newTypeOfV2.set(r.rider_id, classify(r.caps, weightsByTypeV2, capsBaseline, guardedOutCaps));

  console.log("\n\n########## EFTER kandidat 2: caps + rekalibrerede guards + climber/puncheur cross-term=0 ##########");
  for (const [label, grp] of Object.entries(groups)) distTable(label, grp, (r) => newTypeOfV2.get(r.rider_id).primary);

  // ── Kandidat 3: gc-AND-gate er matematisk næsten-tom uanset skalering (4
  // uafhængige ~97-99-percentil-betingelser SAMTIDIG ≈ produktet af sandsynlig-
  // hederne ≈ 0). Søg det laveste percentil-niveau (fælles for alle 3 tærskler)
  // der løfter gc op mod scorecardets ~3%-gulv, og find samme for rouleurs
  // highSpeciality (som omvendt er FOR let at ramme under caps → for restriktiv
  // eksklusion af rouleur). punch<=time_trial bevares (adskiller stadig punch-
  // tunge puncheurs/baroudeurs fra ægte etaperyttere).
  console.log("\n\n########## Kandidat 3: percentil-søgning for gc-gate + rouleur-gate ##########");
  function gcRateAtPercentile(p) {
    const th = {
      climbing: valueAtPercentile(capsArr("climbing"), p),
      time_trial: valueAtPercentile(capsArr("time_trial"), p),
      recovery: valueAtPercentile(capsArr("recovery"), p),
    };
    const n = rows.filter((r) => num(r.caps.climbing) >= th.climbing && num(r.caps.time_trial) >= th.time_trial && num(r.caps.recovery) >= th.recovery && num(r.caps.punch) <= num(r.caps.time_trial)).length;
    return { th, pct: (n / rows.length) * 100 };
  }
  for (const p of [0.97, 0.9, 0.85, 0.8, 0.75, 0.7, 0.65, 0.6]) {
    const { th, pct } = gcRateAtPercentile(p);
    console.log(`  gc-gate p${(p * 100).toFixed(0)}: climbing≥${th.climbing.toFixed(0)} time_trial≥${th.time_trial.toFixed(0)} recovery≥${th.recovery.toFixed(0)} (+punch≤tt) → ${pct.toFixed(2)}% af populationen kvalificerer FØR kontrast-scoren afgør gc vs. resten`);
  }
  function rouleurExcludedAtPercentile(p) {
    const th = valueAtPercentile(specCapsArr, p);
    const n = rows.filter((r) => ["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"].some((k) => num(r.caps[k]) >= th)).length;
    return { th, pct: (n / rows.length) * 100 };
  }
  for (const p of [0.95, 0.9, 0.85, 0.8, 0.75, 0.7]) {
    const { th, pct } = rouleurExcludedAtPercentile(p);
    console.log(`  rouleur-guard p${(p * 100).toFixed(0)}: highSpeciality≥${th.toFixed(0)} → ${pct.toFixed(1)}% udelukkes fra rouleur (resten ER kandidater, men skal stadig vinde kontrast-scoren)`);
  }

  // ── Kandidat 5: climber/tt's negative vægte trimmet (de "vandt gratis" på at
  // straffe evner der er strukturelt lave for STORE dele af populationen under
  // caps — sprint/acceleration/flat er kun positive for 1-3 af 8 typer, så en
  // negativ vægt dér er reelt en "ikke-sprinter-bonus", ikke et ægte kontrast-
  // signal) + gc-gate løsnet til ~p70-caps-niveau + climber/puncheur cross-term=0.
  console.log("\n\n########## Kandidat 5: trimmede negative vægte + løsnet gc-gate ##########");
  const weightsByTypeV5 = {
    ...weightsByTypeV2,
    climber: { climbing: 3, tempo: 2, punch: 1, endurance: 1, sprint: -1 },
    // tt's climbing:-2-straf BEVARES uændret (#1122: uden den vinder tt over gc
    // for komplette etapeløbsryttere — netop den konkurrence gc-gaten isolerer).
    tt: { time_trial: 3, climbing: -2, sprint: -1, punch: -1 },
  };
  const GUARDS_V5 = { ...GUARDS_CAPS, gcClimbing: 54, gcTimeTrial: 54, gcRecovery: 29 };
  function guardedOutV5(a) {
    const out = new Set();
    if (["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"].some((k) => num(a[k]) >= GUARDS_V5.highSpeciality)) out.add("rouleur");
    if (num(a.sprint) > num(a.cobblestone)) out.add("brostensrytter");
    const isGc = num(a.climbing) >= GUARDS_V5.gcClimbing && num(a.time_trial) >= GUARDS_V5.gcTimeTrial && num(a.recovery) >= GUARDS_V5.gcRecovery && num(a.punch) <= num(a.time_trial);
    if (!isGc) out.add("gc");
    return out;
  }
  const newTypeOfV5 = new Map();
  for (const r of rows) newTypeOfV5.set(r.rider_id, classify(r.caps, weightsByTypeV5, capsBaseline, guardedOutV5));
  for (const [label, grp] of Object.entries(groups)) distTable(label, grp, (r) => newTypeOfV5.get(r.rider_id).primary);

  // ── Kandidat 6: rouleur/brostensrytter opjusteret (endnu under 3%-gulvet) +
  // gc-gaten løsnet yderligere (p65-caps-niveau).
  console.log("\n\n########## Kandidat 6: rouleur/brostensrytter opjusteret + gc-gate p65 ##########");
  const weightsByTypeV6 = {
    ...weightsByTypeV5,
    rouleur: { flat: 4, endurance: 1, climbing: -1, sprint: -1 },
    brostensrytter: { cobblestone: 6, flat: 2, endurance: 1, punch: 1, climbing: -1 },
  };
  console.log(`  (highSpeciality caps-tærskel brugt: ${GUARDS_CAPS.highSpeciality})`);
  const GUARDS_V6 = { ...GUARDS_V5, gcClimbing: 53, gcTimeTrial: 53, gcRecovery: 27 };
  function guardedOutV6(a) {
    const out = new Set();
    if (["climbing", "tempo", "punch", "cobblestone", "time_trial", "sprint"].some((k) => num(a[k]) >= GUARDS_V6.highSpeciality)) out.add("rouleur");
    if (num(a.sprint) > num(a.cobblestone)) out.add("brostensrytter");
    const isGc = num(a.climbing) >= GUARDS_V6.gcClimbing && num(a.time_trial) >= GUARDS_V6.gcTimeTrial && num(a.recovery) >= GUARDS_V6.gcRecovery && num(a.punch) <= num(a.time_trial);
    if (!isGc) out.add("gc");
    return out;
  }
  const newTypeOfV6 = new Map();
  for (const r of rows) newTypeOfV6.set(r.rider_id, classify(r.caps, weightsByTypeV6, SHIPPED_BASELINE, guardedOutV6));
  for (const [label, grp] of Object.entries(groups)) distTable(label, grp, (r) => newTypeOfV6.get(r.rider_id).primary);

  const gcGatePassed = rows.filter((r) => !guardedOutV5(r.caps).has("gc"));
  const gcWon = rows.filter((r) => newTypeOfV5.get(r.rider_id).primary === "gc" || newTypeOfV5.get(r.rider_id).secondary === "gc");
  console.log(`\n  DIAGNOSE gc: ${gcGatePassed.length} (${(gcGatePassed.length / rows.length * 100).toFixed(1)}%) består gc-gaten · ${gcWon.length} lander som primær/sekundær gc (vinder kontrast-scoren blandt de gate-passerede)`);
  if (gcGatePassed.length) {
    const sample = gcGatePassed.slice(0, 3);
    for (const r of sample) {
      const scores = RIDER_TYPES.map((t) => ({ key: t.key, score: scoreRiderType(r.caps, weightsByTypeV5[t.key], capsBaseline) })).sort((a, b) => b.score - a.score);
      console.log(`    ${r.name}: caps climb=${r.caps.climbing} tt=${r.caps.time_trial} rec=${r.caps.recovery} punch=${r.caps.punch} → top3 scores: ${scores.slice(0, 3).map((s) => `${s.key}=${s.score.toFixed(2)}`).join(", ")}`);
    }
  }

  console.log("\n\n########## FINAL (kandidat 6, som skrives ind i riderTypes.js) ##########");
  console.log(`Vægte: ${JSON.stringify(weightsByTypeV6)}`);
  console.log(`Guards: ${JSON.stringify(GUARDS_V6)}`);
  for (const [label, grp] of Object.entries(groups)) distTable(`FINAL — ${label}`, grp, (r) => newTypeOfV6.get(r.rider_id).primary);
  console.log("\nSekundær-type-fordeling (FINAL, hele populationen):");
  distTable("FINAL secondary — ALLE", rows, (r) => newTypeOfV6.get(r.rider_id).secondary);

  if (SHOW_SAMPLE) {
    console.log("\n\n########## Stikprøve: ryttere hvor FØR ≠ EFTER (FINAL) ##########");
    const changed = active.filter((r) => r.oldPrimary !== newTypeOfV6.get(r.rider_id).primary);
    console.log(`${changed.length}/${active.length} aktive ryttere skifter primary_type (${((changed.length / active.length) * 100).toFixed(1)}%)`);
    for (const r of changed.slice(0, 25)) {
      const nt = newTypeOfV6.get(r.rider_id);
      console.log(`\n${r.name} (${r.rider_id}) alder ${r.age}`);
      console.log(`  FØR:  ${r.oldPrimary} / ${r.oldSecondary}`);
      console.log(`  EFTER: ${nt.primary} / ${nt.secondary}`);
      console.log(`  live: ${ABILITY_KEYS.map((k) => `${k}=${r.live[k]}`).join(" ")}`);
      console.log(`  caps: ${ABILITY_KEYS.map((k) => `${k}=${r.caps[k]}`).join(" ")}`);
    }
  }
}

main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1); });
