#!/usr/bin/env node
// READ-ONLY måle-script for #3372.
//
// Kvantificerer hvor meget ryttertype-backfillen 5/8 (#3325 — type udledes nu af
// EVNE-LOFT/ability_caps i stedet for nuværende evner, og de otte typers vægte/
// guards blev samtidig rekalibreret) flyttede spillernes SYNLIGE potentiale:
//   (a) ability_caps pr. evne (buildCapsForRider — samme funktion motoren bruger)
//   (b) scout-rapportens type-loft pr. af de 8 typer (ratingFromAbilities, det tal
//       buildTypeCeilingBands viser som "loft" for en type i UI'en)
//
// Metode: for hver human-ejet, ikke-pensioneret rytter der findes i backfill-
// snapshottet (riders_type_backfill_snapshot_20260805 — GAMLE typer, taget FØR
// #3325), genberegnes buildCapsForRider() to gange — én gang med de gamle typer,
// én gang med de nuværende (riders.primary_type/secondary_type) — med SAMME
// abilities/potentiale/alder. Deltaet mellem de to caps-sæt ER backfillens rene
// effekt, isoleret fra al anden drift (sæson-progression, træning osv. er
// identisk i begge grene fordi input er identisk).
//
// INGEN DB-mutation. INGEN skrivning uden for scratchpad + denne fil selv.
//
//   node scripts/measureCapsShift3372.js [output.json]

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeFileSync } from "node:fs";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { buildCapsForRider } from "../lib/riderProgression.js";
import { ratingFromAbilities } from "../lib/scoutingReport.js";
import { RIDER_TYPE_KEYS } from "../lib/riderTypes.js";
import { VISIBLE_ABILITIES } from "../lib/abilityDerivation.js";
import { ageForSeason } from "../lib/riderSeasonAge.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const DEFAULT_OUT =
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/9e7f6053-4cce-4595-93fa-ef5fe13ed219/scratchpad/caps-shift-3372.json";
const OUT_PATH = process.argv[2] || DEFAULT_OUT;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const AGE_BANDS = [
  { key: "17-18", test: (a) => a != null && a <= 18 },
  { key: "19-21", test: (a) => a != null && a >= 19 && a <= 21 },
  { key: "22-25", test: (a) => a != null && a >= 22 && a <= 25 },
  { key: "26+", test: (a) => a != null && a >= 26 },
  { key: "ukendt", test: (a) => a == null },
];

function ageBandOf(age) {
  return AGE_BANDS.find((b) => b.test(age))?.key ?? "ukendt";
}

function sortedNums(arr) {
  return [...arr].sort((a, b) => a - b);
}

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  if (sorted[base + 1] !== undefined) return sorted[base] + rest * (sorted[base + 1] - sorted[base]);
  return sorted[base];
}

function median(sorted) {
  return percentile(sorted, 0.5);
}

function distStats(values) {
  const sorted = sortedNums(values);
  const n = sorted.length;
  const ge = (t) => sorted.filter((v) => v >= t).length;
  return {
    n,
    median: n ? Math.round(median(sorted) * 100) / 100 : null,
    p90: n ? Math.round(percentile(sorted, 0.9) * 100) / 100 : null,
    max: n ? sorted[n - 1] : null,
    min: n ? sorted[0] : null,
    pct_ge_5: n ? Math.round((ge(5) / n) * 1000) / 10 : null,
    pct_ge_10: n ? Math.round((ge(10) / n) * 1000) / 10 : null,
    pct_ge_20: n ? Math.round((ge(20) / n) * 1000) / 10 : null,
  };
}

async function main() {
  console.log("=== #3372 caps-shift måling (READ-ONLY, prod) ===");

  const { data: season, error: seasonErr } = await supabase
    .from("seasons")
    .select("number")
    .eq("status", "active")
    .maybeSingle();
  if (seasonErr) throw new Error(seasonErr.message);
  const seasonNumber = season?.number ?? 1;
  console.log(`Aktiv sæson: ${seasonNumber}`);

  console.log("Henter snapshot (gamle typer, riders_type_backfill_snapshot_20260805)...");
  const snapshotRows = await fetchAllRows(() =>
    supabase.from("riders_type_backfill_snapshot_20260805").select("id, primary_type, secondary_type").order("id"));
  const snapshotById = new Map(snapshotRows.map((r) => [r.id, r]));
  console.log(`Snapshot: ${snapshotRows.length} ryttere`);

  console.log("Henter rider_derived_abilities + riders (nye typer, alder, potentiale)...");
  const abilityCols = VISIBLE_ABILITIES.join(", ");
  const riderRows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(
        `rider_id, ability_caps, ${abilityCols}, riders!inner(id, team_id, is_retired, birthdate, potentiale, primary_type, secondary_type)`
      )
      .order("rider_id")
  );
  console.log(`rider_derived_abilities rækker: ${riderRows.length}`);

  // ── Filtrér: human-ejet (team_id IS NOT NULL), ikke-pensioneret, findes i snapshot ──
  const candidates = [];
  for (const row of riderRows) {
    const r = row.riders;
    if (!r || r.team_id == null || r.is_retired) continue;
    const snap = snapshotById.get(r.id);
    if (!snap) continue;
    if (!snap.primary_type || !r.primary_type) continue;
    candidates.push({ row, r, snap });
  }
  console.log(`Kandidater (human-ejet, ikke-retired, i snapshot, begge typer sat): ${candidates.length}`);

  // ── Pr.-rytter beregning ──
  const perRider = [];
  let sanityChecked = 0;
  let sanityMatchesNew = 0;
  let sanityMatchesOld = 0;
  let sanityMatchesNeither = 0;

  for (const { row, r, snap } of candidates) {
    const abilities = {};
    for (const a of VISIBLE_ABILITIES) abilities[a] = row[a];

    const age = ageForSeason(r.birthdate, seasonNumber);
    const potentiale = r.potentiale;

    const oldPrimary = snap.primary_type;
    const oldSecondary = snap.secondary_type;
    const newPrimary = r.primary_type;
    const newSecondary = r.secondary_type;

    const capsOld = buildCapsForRider(abilities, { potentiale, age }, oldPrimary, oldSecondary);
    const capsNew = buildCapsForRider(abilities, { potentiale, age }, newPrimary, newSecondary);

    let maxAbilityDelta = 0;
    for (const a of VISIBLE_ABILITIES) {
      const d = Math.abs((capsNew[a] ?? 0) - (capsOld[a] ?? 0));
      if (d > maxAbilityDelta) maxAbilityDelta = d;
    }

    const typeDeltas = RIDER_TYPE_KEYS.map((key) => {
      const ratingOld = ratingFromAbilities(capsOld, key);
      const ratingNew = ratingFromAbilities(capsNew, key);
      return { key, ratingOld, ratingNew, delta: ratingNew - ratingOld };
    });

    let maxPositive = typeDeltas[0];
    let maxNegative = typeDeltas[0];
    for (const td of typeDeltas) {
      if (td.delta > maxPositive.delta) maxPositive = td;
      if (td.delta < maxNegative.delta) maxNegative = td;
    }

    perRider.push({
      id: r.id,
      age,
      potentiale,
      oldPrimary,
      oldSecondary,
      newPrimary,
      newSecondary,
      typeChanged: oldPrimary !== newPrimary || oldSecondary !== newSecondary,
      maxAbilityDelta,
      typeDeltas,
      maxPositiveType: { key: maxPositive.key, delta: maxPositive.delta, ratingOld: maxPositive.ratingOld, ratingNew: maxPositive.ratingNew },
      maxNegativeType: { key: maxNegative.key, delta: maxNegative.delta, ratingOld: maxNegative.ratingOld, ratingNew: maxNegative.ratingNew },
    });

    // ── Sanity: sammenlign GEMT ability_caps mod caps_new/caps_old ──
    const stored = row.ability_caps;
    if (stored && typeof stored === "object") {
      sanityChecked++;
      const matchesNew = VISIBLE_ABILITIES.every((a) => Number(stored[a]) === Number(capsNew[a]));
      const matchesOld = VISIBLE_ABILITIES.every((a) => Number(stored[a]) === Number(capsOld[a]));
      if (matchesNew && matchesOld) {
        // caps_old === caps_new for denne rytter (typeskift havde ingen effekt på
        // caps) — tæller som "matcher begge", ikke en selvstændig kategori.
        sanityMatchesNew++;
        sanityMatchesOld++;
      } else if (matchesNew) sanityMatchesNew++;
      else if (matchesOld) sanityMatchesOld++;
      else sanityMatchesNeither++;
    }
  }

  // ── Aggregér ──
  const overallMaxDelta = distStats(perRider.map((p) => p.maxAbilityDelta));
  const overallMaxPositiveTypeDelta = distStats(perRider.map((p) => p.maxPositiveType.delta));
  const overallMaxNegativeTypeDeltaAbs = distStats(perRider.map((p) => Math.abs(p.maxNegativeType.delta)));

  const byAgeBand = {};
  for (const band of AGE_BANDS) {
    const rows = perRider.filter((p) => ageBandOf(p.age) === band.key);
    if (!rows.length) continue;
    byAgeBand[band.key] = {
      maxAbilityDelta: distStats(rows.map((p) => p.maxAbilityDelta)),
      maxPositiveTypeDelta: distStats(rows.map((p) => p.maxPositiveType.delta)),
      maxNegativeTypeDeltaAbs: distStats(rows.map((p) => Math.abs(p.maxNegativeType.delta))),
    };
  }

  const top10Negative = [...perRider]
    .sort((a, b) => a.maxNegativeType.delta - b.maxNegativeType.delta)
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      age: p.age,
      oldPrimary: p.oldPrimary,
      oldSecondary: p.oldSecondary,
      newPrimary: p.newPrimary,
      newSecondary: p.newSecondary,
      maxAbilityDelta: p.maxAbilityDelta,
      worstType: p.maxNegativeType.key,
      typeDelta: p.maxNegativeType.delta,
      ratingOld: p.maxNegativeType.ratingOld,
      ratingNew: p.maxNegativeType.ratingNew,
    }));

  const top10Positive = [...perRider]
    .sort((a, b) => b.maxPositiveType.delta - a.maxPositiveType.delta)
    .slice(0, 10)
    .map((p) => ({
      id: p.id,
      age: p.age,
      oldPrimary: p.oldPrimary,
      oldSecondary: p.oldSecondary,
      newPrimary: p.newPrimary,
      newSecondary: p.newSecondary,
      maxAbilityDelta: p.maxAbilityDelta,
      bestType: p.maxPositiveType.key,
      typeDelta: p.maxPositiveType.delta,
      ratingOld: p.maxPositiveType.ratingOld,
      ratingNew: p.maxPositiveType.ratingNew,
    }));

  const typeChangedCount = perRider.filter((p) => p.typeChanged).length;

  const result = {
    meta: {
      generatedAt: new Date().toISOString(),
      seasonNumber,
      snapshotTable: "riders_type_backfill_snapshot_20260805",
      candidateCount: candidates.length,
      typeChangedCount,
      typeChangedPct: Math.round((typeChangedCount / (perRider.length || 1)) * 1000) / 10,
    },
    aggregate: {
      maxAbilityCapDelta: overallMaxDelta,
      maxPositiveTypeCeilingDelta: overallMaxPositiveTypeDelta,
      maxNegativeTypeCeilingDeltaAbs: overallMaxNegativeTypeDeltaAbs,
    },
    byAgeBand,
    top10WorstNegativeTypeShift: top10Negative,
    top10BestPositiveTypeShift: top10Positive,
    sanityCheck: {
      checked: sanityChecked,
      matchesCapsNew: sanityMatchesNew,
      matchesCapsNewPct: sanityChecked ? Math.round((sanityMatchesNew / sanityChecked) * 1000) / 10 : null,
      matchesCapsOld: sanityMatchesOld,
      matchesCapsOldPct: sanityChecked ? Math.round((sanityMatchesOld / sanityChecked) * 1000) / 10 : null,
      matchesNeither: sanityMatchesNeither,
      matchesNeitherPct: sanityChecked ? Math.round((sanityMatchesNeither / sanityChecked) * 1000) / 10 : null,
    },
  };

  writeFileSync(OUT_PATH, JSON.stringify(result, null, 2), "utf8");
  console.log(`\nSkrev resultat til ${OUT_PATH}`);

  console.log("\n=== AGGREGAT: max |cap-delta| pr. rytter (over alle 15 synlige evner) ===");
  console.log(overallMaxDelta);
  console.log("\n=== AGGREGAT: max POSITIVT type-loft-skift (ratingFromAbilities delta) ===");
  console.log(overallMaxPositiveTypeDelta);
  console.log("\n=== AGGREGAT: max NEGATIVT type-loft-skift, absolut ===");
  console.log(overallMaxNegativeTypeDeltaAbs);
  console.log("\n=== Pr. aldersbånd ===");
  for (const [band, stats] of Object.entries(byAgeBand)) {
    console.log(`\n-- ${band} (n=${stats.maxAbilityDelta.n}) --`);
    console.log(`  maxAbilityDelta:        median=${stats.maxAbilityDelta.median} p90=${stats.maxAbilityDelta.p90} max=${stats.maxAbilityDelta.max}`);
    console.log(`  maxPositiveTypeDelta:   median=${stats.maxPositiveTypeDelta.median} p90=${stats.maxPositiveTypeDelta.p90} max=${stats.maxPositiveTypeDelta.max}`);
    console.log(`  maxNegativeTypeDeltaAbs:median=${stats.maxNegativeTypeDeltaAbs.median} p90=${stats.maxNegativeTypeDeltaAbs.p90} max=${stats.maxNegativeTypeDeltaAbs.max}`);
  }

  console.log(`\n=== Type ændret (primary ELLER secondary): ${typeChangedCount}/${perRider.length} (${result.meta.typeChangedPct}%) ===`);

  console.log("\n=== TOP 10 VÆRST RAMTE (største negative type-loft-skift) ===");
  for (const p of top10Negative) {
    console.log(
      `  ${p.id} alder=${p.age} ${p.oldPrimary}/${p.oldSecondary} → ${p.newPrimary}/${p.newSecondary} · ${p.worstType} loft ${p.ratingOld}→${p.ratingNew} (Δ${p.typeDelta}) · maxAbilityDelta=${p.maxAbilityDelta}`
    );
  }

  console.log("\n=== TOP 10 STØRST POSITIVE (største positive type-loft-skift) ===");
  for (const p of top10Positive) {
    console.log(
      `  ${p.id} alder=${p.age} ${p.oldPrimary}/${p.oldSecondary} → ${p.newPrimary}/${p.newSecondary} · ${p.bestType} loft ${p.ratingOld}→${p.ratingNew} (Δ+${p.typeDelta}) · maxAbilityDelta=${p.maxAbilityDelta}`
    );
  }

  console.log("\n=== SANITY CHECK: gemt ability_caps vs. genberegnet ===");
  console.log(result.sanityCheck);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
