#!/usr/bin/env node
// READ-ONLY måle-script for #3372 (ejer-spørgsmål 6/8): bevarede backfillen
// rytterens PEAK-TALENT (bedste type-loft på tværs af alle 8 typer), eller
// nedgraderede den reelt talenter? Ejer-designintentionen: typen må gerne
// flytte sig (spredning), men "et stort talent skal fortsætte med at være et
// stort talent" — rytteren skal føles som den samme bagefter.
//
//   node scripts/measurePeakTalent3372.js [output.json]

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
  "C:/Users/Nicolai/AppData/Local/Temp/claude/C--Dev-CyclingZone/9e7f6053-4cce-4595-93fa-ef5fe13ed219/scratchpad/peak-talent-3372.json";
const OUT_PATH = process.argv[2] || DEFAULT_OUT;

const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

const AGE_BANDS = [
  { key: "17-18", test: (a) => a != null && a <= 18 },
  { key: "19-21", test: (a) => a != null && a >= 19 && a <= 21 },
  { key: "22-25", test: (a) => a != null && a >= 22 && a <= 25 },
  { key: "26+", test: (a) => a != null && a >= 26 },
  { key: "ukendt", test: (a) => a == null },
];
const ageBandOf = (age) => AGE_BANDS.find((b) => b.test(age))?.key ?? "ukendt";

function percentile(sorted, p) {
  if (!sorted.length) return null;
  const pos = (sorted.length - 1) * p;
  const base = Math.floor(pos);
  const rest = pos - base;
  return sorted[base + 1] !== undefined ? sorted[base] + rest * (sorted[base + 1] - sorted[base]) : sorted[base];
}

function stats(values) {
  const s = [...values].sort((a, b) => a - b);
  const n = s.length;
  const le = (t) => s.filter((v) => v <= t).length;
  return {
    n,
    median: percentile(s, 0.5),
    p10: percentile(s, 0.1),
    p90: percentile(s, 0.9),
    min: s[0] ?? null,
    max: s[n - 1] ?? null,
    pct_drop_ge_3: n ? Math.round((le(-3) / n) * 1000) / 10 : null,
    pct_drop_ge_5: n ? Math.round((le(-5) / n) * 1000) / 10 : null,
    pct_drop_ge_10: n ? Math.round((le(-10) / n) * 1000) / 10 : null,
  };
}

async function main() {
  console.log("=== #3372 peak-talent-bevarelse (READ-ONLY, prod) ===");
  const { data: season, error: seasonErr } = await supabase
    .from("seasons").select("number").eq("status", "active").maybeSingle();
  if (seasonErr) throw new Error(seasonErr.message);
  const seasonNumber = season?.number ?? 1;

  const snapshotRows = await fetchAllRows(() =>
    supabase.from("riders_type_backfill_snapshot_20260805").select("id, primary_type, secondary_type").order("id"));
  const snapshotById = new Map(snapshotRows.map((r) => [r.id, r]));

  const abilityCols = VISIBLE_ABILITIES.join(", ");
  const riderRows = await fetchAllRows(() =>
    supabase
      .from("rider_derived_abilities")
      .select(`rider_id, ${abilityCols}, riders!inner(id, team_id, is_retired, birthdate, potentiale, primary_type, secondary_type)`)
      .order("rider_id"));

  const perRider = [];
  for (const row of riderRows) {
    const r = row.riders;
    if (!r || r.team_id == null || r.is_retired) continue;
    const snap = snapshotById.get(r.id);
    if (!snap || !snap.primary_type || !r.primary_type) continue;

    const abilities = {};
    for (const a of VISIBLE_ABILITIES) abilities[a] = row[a];
    const age = ageForSeason(r.birthdate, seasonNumber);

    const capsOld = buildCapsForRider(abilities, { potentiale: r.potentiale, age }, snap.primary_type, snap.secondary_type);
    const capsNew = buildCapsForRider(abilities, { potentiale: r.potentiale, age }, r.primary_type, r.secondary_type);

    let peakOld = -Infinity, peakNew = -Infinity;
    for (const key of RIDER_TYPE_KEYS) {
      const o = ratingFromAbilities(capsOld, key);
      const nv = ratingFromAbilities(capsNew, key);
      if (o > peakOld) peakOld = o;
      if (nv > peakNew) peakNew = nv;
    }
    // "Identitets-loftet": loftet i den rolle spillet SIGER rytteren har
    // (gammel primær før, ny primær efter) — det tættest muligt på hvordan
    // rytteren "føles" i scout-rapporten.
    const identityOld = ratingFromAbilities(capsOld, snap.primary_type);
    const identityNew = ratingFromAbilities(capsNew, r.primary_type);

    perRider.push({
      id: r.id, age, band: ageBandOf(age), potentiale: r.potentiale,
      peakOld, peakNew, peakDelta: peakNew - peakOld,
      identityDelta: identityNew - identityOld,
      typeChanged: snap.primary_type !== r.primary_type || snap.secondary_type !== r.secondary_type,
    });
  }

  const out = { meta: { generatedAt: new Date().toISOString(), n: perRider.length, seasonNumber } };
  out.peakDelta_all = stats(perRider.map((x) => x.peakDelta));
  out.identityDelta_all = stats(perRider.map((x) => x.identityDelta));
  out.peakDelta_byBand = {};
  for (const b of AGE_BANDS) {
    const rows = perRider.filter((x) => x.band === b.key);
    if (rows.length) out.peakDelta_byBand[b.key] = stats(rows.map((x) => x.peakDelta));
  }
  // "Store talenter" = potentiale >= 6 (skalaen topper ~8) — ejerens case.
  const bigTalents = perRider.filter((x) => Number(x.potentiale) >= 6);
  out.peakDelta_bigTalents = stats(bigTalents.map((x) => x.peakDelta));
  out.identityDelta_bigTalents = stats(bigTalents.map((x) => x.identityDelta));
  out.worst20_peakDrop = [...perRider].sort((a, b) => a.peakDelta - b.peakDelta).slice(0, 20);

  writeFileSync(OUT_PATH, JSON.stringify(out, null, 2));
  const f = (s) => `median ${s.median?.toFixed(1)} · P10 ${s.p10?.toFixed(1)} · P90 ${s.p90?.toFixed(1)} · min ${s.min} · ≤−3: ${s.pct_drop_ge_3}% · ≤−5: ${s.pct_drop_ge_5}% · ≤−10: ${s.pct_drop_ge_10}%`;
  console.log(`n=${out.meta.n}`);
  console.log(`PEAK-delta (bedste type-loft, alle):      ${f(out.peakDelta_all)}`);
  console.log(`IDENTITETS-delta (primær-rollens loft):   ${f(out.identityDelta_all)}`);
  console.log(`PEAK-delta, store talenter (pot ≥6, n=${out.peakDelta_bigTalents.n}): ${f(out.peakDelta_bigTalents)}`);
  for (const [band, s] of Object.entries(out.peakDelta_byBand)) console.log(`  PEAK ${band}: ${f(s)}`);
  console.log(`Skrevet: ${OUT_PATH}`);
}

main().catch((e) => { console.error(e.message); process.exit(1); });
