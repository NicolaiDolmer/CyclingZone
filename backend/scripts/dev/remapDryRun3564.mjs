// #3564 leverance 4a — trin 1 kvantil-remap (1-6 -> 1-99), OFFLINE DRY-RUN.
//
// Kilde: docs/superpowers/specs/2026-08-09-3564-progressionskaede-samlet-design.md
// §6 trin 1 + §8 beslutning 1 (A-pakken, ejer 9/8, tillæg: potentiale-overskuddet
// udlignes ved migrationen).
//
// LÆSER KUN de daterede snapshot-JSON-filer i denne mappe (riders.json,
// teams.json). INGEN DB-forbindelse, INGEN writes. Deterministisk (FNV-1a
// tiebreak via riderProgression.seededUnit — samme funktion prod bruger).
//
// Kør: SNAP_DIR=<sti-til-dateret-snapshot> node scripts/dev/remapDryRun3564.mjs
// (snapshot laves med scripts/dev/snapshot-3564-progression-chain.mjs — SAMME
// dato-stemplede mappe skal bruges her, aldrig levende DB.)

import { readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import path from "node:path";

const SNAP_DIR = process.env.SNAP_DIR || process.argv[2];
if (!SNAP_DIR) {
  console.error("Brug: SNAP_DIR=<dateret snapshot-mappe> node scripts/dev/remapDryRun3564.mjs");
  process.exit(1);
}
const BACKEND_LIB = path.join(import.meta.dirname, "../../lib");

// ── Dynamisk import af prod-koden vi genbruger (ingen egen hash/loft-logik) ──
const { POTENTIALE_TIERS, POTENTIALE_DECAY } = await import(pathToFileURL(`${BACKEND_LIB}/academyGenerator.js`).href);
const { seededUnit, buildCapsForRider } = await import(pathToFileURL(`${BACKEND_LIB}/riderProgression.js`).href);
const { predictBaseValueV4 } = await import(pathToFileURL(`${BACKEND_LIB}/riderCareerNpv.js`).href);
const riderValuationModelV4 = JSON.parse(readFileSync(`${BACKEND_LIB}/riderValuationModelV4.json`, "utf8"));

const riders = JSON.parse(readFileSync(`${SNAP_DIR}/riders.json`, "utf8"));
const teams = JSON.parse(readFileSync(`${SNAP_DIR}/teams.json`, "utf8"));

const teamById = new Map(teams.map((t) => [t.team_id, t]));

// ── 1) Målfordeling: træk-geometrien oversat til 1-99 ───────────────────────
// tier k (k=0..10) center v_k = round(1 + k*9.8), masse spredt uniformt over
// [v_k-4.9, v_k+4.9] klippet til [1,99]. Vægt pr. tier = POTENTIALE_DECAY^k
// (samme geometri som drawPotentiale — ikke gentunet her).
const K = POTENTIALE_TIERS.length; // 11
const centers = POTENTIALE_TIERS.map((_, k) => Math.round(1 + k * 9.8));
const weightsRaw = POTENTIALE_TIERS.map((_, k) => POTENTIALE_DECAY ** k);
const weightSum = weightsRaw.reduce((a, b) => a + b, 0);
const weights = weightsRaw.map((w) => w / weightSum);
const intervals = centers.map((c) => [Math.max(1, c - 4.9), Math.min(99, c + 4.9)]);

// potentiale (1-6, continuous) -> "tier center på 1-99-skalaen" (ANKER, ikke
// spredt) — bruges til manager-diffens "hvad ville uændret placering have
// været" reference. Lineær inversion af v_k=1+9.8k, k=(pot-1)/0.5*... se §6.
function potentialeToCenter99(pot) {
  const p = Math.max(1, Math.min(6, Number(pot)));
  const k = (p - 1) / 0.5; // 0..10 (kan være brøk for evt. off-grid værdier)
  return 1 + k * 9.8;
}

// 1-99 (evt. brøk) -> potentiale-ækvivalent på 1-6-skalaen (nøjagtig invers af
// centerformlen). Bruges til at fodre v4-modellen (buildCapsForRider /
// predictBaseValueV4), som er skrevet mod 1-6-skalaen og allerede lineært
// interpolerer kontinuert (youthLoftForPotential/youthRateForPotential).
function pot99ToTierEquivalent(v) {
  const x = Math.max(1, Math.min(99, Number(v)));
  return Math.max(1, Math.min(6, 1 + (x - 1) / 19.6));
}

// Tæt numerisk tæthed/CDF af mål-mixturen (opløsning 0.02 point, 1..99).
const STEP = 0.02;
const N_STEPS = Math.round((99 - 1) / STEP) + 1;
const xs = new Array(N_STEPS);
const density = new Array(N_STEPS).fill(0);
for (let i = 0; i < N_STEPS; i++) xs[i] = 1 + i * STEP;
for (let k = 0; k < K; k++) {
  const [lo, hi] = intervals[k];
  const w = hi - lo;
  if (w <= 0) continue;
  const dens = weights[k] / w;
  const i0 = Math.max(0, Math.ceil((lo - 1) / STEP));
  const i1 = Math.min(N_STEPS - 1, Math.floor((hi - 1) / STEP));
  for (let i = i0; i <= i1; i++) density[i] += dens;
}
const cdf = new Array(N_STEPS);
{
  let acc = 0;
  for (let i = 0; i < N_STEPS; i++) {
    acc += density[i] * STEP;
    cdf[i] = acc;
  }
  const total = cdf[N_STEPS - 1];
  for (let i = 0; i < N_STEPS; i++) cdf[i] /= total; // normalisér til [0,1]
}

// F(x): andel af målmassen <= x (bruges til bånd-fordeling af MÅLET).
function targetCdfAt(x) {
  const xc = Math.max(1, Math.min(99, x));
  const idx = Math.min(N_STEPS - 1, Math.max(0, Math.round((xc - 1) / STEP)));
  return cdf[idx];
}

// F_inv(q): binær søgning i den monotont voksende cdf-array.
function inverseCdf(q) {
  const qc = Math.max(0, Math.min(1, q));
  let lo = 0, hi = N_STEPS - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (cdf[mid] < qc) lo = mid + 1; else hi = mid;
  }
  return xs[lo];
}

// ── 2) Aldersbånd ────────────────────────────────────────────────────────────
const AGE_BANDS = [
  { key: "16-17", lo: 16, hi: 17 },
  { key: "18-19", lo: 18, hi: 19 },
  { key: "20-21", lo: 20, hi: 21 },
  { key: "22-25", lo: 22, hi: 25 },
  { key: "26-30", lo: 26, hi: 30 },
  { key: "31+", lo: 31, hi: 999 },
];
function bandOf(age) {
  return AGE_BANDS.find((b) => age >= b.lo && age <= b.hi)?.key ?? "31+";
}

// ── 3) Stratificeret rang-bevarende kvantil-remap ──────────────────────────
const remapById = new Map(); // id -> { newPot99, oldPot, band }
for (const band of AGE_BANDS) {
  const group = riders.filter((r) => bandOf(r.age) === band.key);
  const sorted = [...group].sort((a, b) => {
    if (a.potentiale !== b.potentiale) return a.potentiale - b.potentiale;
    return seededUnit(a.id) - seededUnit(b.id);
  });
  const n = sorted.length;
  sorted.forEach((r, rank) => {
    const q = (rank + 0.5) / n;
    const xReal = inverseCdf(q);
    const newPot99 = Math.max(1, Math.min(99, Math.round(xReal)));
    remapById.set(r.id, { newPot99, oldPot: r.potentiale, band: band.key });
  });
}

// Rang-bevarelse-egenskab (kontrol, ikke kun antagelse): for hvert aldersbånd,
// gå gennem sorted rækkefølge og verificér newPot er ikke-faldende.
const rankViolations = [];
for (const band of AGE_BANDS) {
  const group = riders.filter((r) => bandOf(r.age) === band.key)
    .sort((a, b) => (a.potentiale - b.potentiale) || (seededUnit(a.id) - seededUnit(b.id)));
  for (let i = 1; i < group.length; i++) {
    const prev = remapById.get(group[i - 1].id).newPot99;
    const cur = remapById.get(group[i].id).newPot99;
    if (cur < prev) rankViolations.push({ band: band.key, prevId: group[i - 1].id, curId: group[i].id, prev, cur });
  }
}

// ── 4) Fordelingsrapport FØR/EFTER pr. aldersbånd (10-punkts-bånd) ──────────
const TEN_BANDS = [[1, 10], [11, 20], [21, 30], [31, 40], [41, 50], [51, 60], [61, 70], [71, 80], [81, 90], [91, 99]];
function tenBandKey(v) {
  for (const [lo, hi] of TEN_BANDS) if (v >= lo && v <= hi) return `${lo}-${hi}`;
  return "?";
}
function targetShareInBand(lo, hi) {
  return targetCdfAt(hi) - targetCdfAt(lo - 1e-9);
}

const distributionReport = {};
for (const band of AGE_BANDS) {
  const group = riders.filter((r) => bandOf(r.age) === band.key);
  const n = group.length;
  const afterCounts = Object.fromEntries(TEN_BANDS.map(([lo, hi]) => [`${lo}-${hi}`, 0]));
  let after90 = 0, after74 = 0;
  for (const r of group) {
    const np = remapById.get(r.id).newPot99;
    afterCounts[tenBandKey(np)]++;
    if (np >= 90) after90++;
    if (np >= 74) after74++;
  }
  const gateRows = TEN_BANDS.map(([lo, hi]) => {
    const key = `${lo}-${hi}`;
    const actualPct = n ? (100 * afterCounts[key]) / n : 0;
    const targetPct = 100 * targetShareInBand(lo, hi);
    return { band: key, actualPct: round2(actualPct), targetPct: round2(targetPct), ppDiff: round2(actualPct - targetPct), withinTolerance: Math.abs(actualPct - targetPct) <= 2 };
  });
  const targetGe90 = 100 * (1 - targetCdfAt(89.999999));
  const targetGe74 = 100 * (1 - targetCdfAt(73.999999));
  distributionReport[band.key] = {
    n,
    afterCounts,
    gateRows,
    allBandsWithinTolerance: gateRows.every((g) => g.withinTolerance),
    share_ge90_pct: round2(n ? (100 * after90) / n : 0),
    target_ge90_pct: round2(targetGe90),
    share_ge74_pct: round2(n ? (100 * after74) / n : 0),
    target_ge74_pct: round2(targetGe74),
  };
}

function round2(x) { return Math.round(x * 100) / 100; }

// ── 5) Stock-gate: pot>=90 global (før: tier6-andel, geometri: forventet andel) ──
const totalN = riders.length;
const oldTier6Count = riders.filter((r) => r.potentiale === 6).length;
const newGe90Count = riders.filter((r) => remapById.get(r.id).newPot99 >= 90).length;
const expectedGe90Share = 1 - targetCdfAt(89.999999); // fra samme mål-CDF
const expectedGe90Count = expectedGe90Share * totalN;

// ── 6) Manager-diff ──────────────────────────────────────────────────────────
function ownerLabel(r) {
  if (r.owner_kind === "human") return "human";
  if (r.owner_kind === "ai") return "ai";
  return "free";
}

const perManager = new Map(); // team_id -> agg
function managerBucket(teamId) {
  if (!perManager.has(teamId)) {
    const team = teamById.get(teamId);
    perManager.set(teamId, {
      team_id: teamId,
      team_name: team?.name ?? "(ukendt hold)",
      manager_display_name: team?.manager_display_name ?? null,
      is_ai: team?.is_ai ?? null,
      division: team?.division ?? null,
      n: 0, downgraded: 0, upgraded: 0, unchanged: 0,
      biggestSingleDowngrade: null,
      valueDeltaSum: 0,
    });
  }
  return perManager.get(teamId);
}

const allDiffRows = [];
for (const r of riders) {
  const { newPot99, oldPot } = remapById.get(r.id);
  const oldCenter99 = potentialeToCenter99(oldPot);
  const delta = newPot99 - oldCenter99;
  const row = {
    id: r.id,
    name: `${r.firstname} ${r.lastname}`,
    age: r.age,
    owner: ownerLabel(r),
    team_id: r.team_id,
    oldPot,
    oldCenter99: round2(oldCenter99),
    newPot99,
    delta: round2(delta),
  };
  allDiffRows.push(row);

  if (r.team_id) {
    const b = managerBucket(r.team_id);
    b.n++;
    if (delta < -0.01) b.downgraded++;
    else if (delta > 0.01) b.upgraded++;
    else b.unchanged++;
    if (!b.biggestSingleDowngrade || delta < b.biggestSingleDowngrade.delta) {
      b.biggestSingleDowngrade = { name: row.name, age: row.age, oldPot, oldCenter99: row.oldCenter99, newPot99, delta: row.delta };
    }
  }
}

const top20Losers = [...allDiffRows].sort((a, b) => a.delta - b.delta).slice(0, 20)
  .map((r) => ({ ...r, team_name: teamById.get(r.team_id)?.name ?? (r.team_id ? "(ukendt hold)" : "(ingen — fri agent)"), manager_display_name: teamById.get(r.team_id)?.manager_display_name ?? null }));

// Ejede vs. frie vs. AI — separat rapport
const byOwner = { human: { n: 0, downgraded: 0, upgraded: 0, unchanged: 0 }, ai: { n: 0, downgraded: 0, upgraded: 0, unchanged: 0 }, free: { n: 0, downgraded: 0, upgraded: 0, unchanged: 0 } };
for (const row of allDiffRows) {
  const o = byOwner[row.owner];
  o.n++;
  if (row.delta < -0.01) o.downgraded++;
  else if (row.delta > 0.01) o.upgraded++;
  else o.unchanged++;
}

// pot5-6 old vs new-owned-count sanity (spejler summary.json's afvigelse#2)
const pot56OldOwned = riders.filter((r) => r.potentiale >= 4.5 && r.owner_kind === "human").length;

// ── 7) Værdi-effekt (v4, offline) ────────────────────────────────────────────
// Metode: samme mønster som backend/scripts/academyOverflowPotentialeConversionDryRun.js
// — NUVÆRENDE evner (abilities) holdes FAST, kun potentiale-feltet varieres
// (gammelt 1-6-tal vs. det nye 1-99-tals tier-ækvivalent tilbageregnet til 1-6
// via pot99ToTierEquivalent, den EKSAKTE invers af centerformlen i trin 1).
// BEGRÆNSNING (dokumenteret, ikke skjult): snapshottets abilities-objekt
// indeholder kun de 10 FYSISKE evner (climbing..durability) — de 5 skjulte
// nøgler (tactics, positioning, cobblestone, descending, aggression) mangler.
// riderOverall/outputScore i riderValuation.js springer manglende nøgler over
// (Number.isFinite-guard) og regner middel/vægtet-middel over de tilgængelige
// — værdierne er derfor en TILNÆRMELSE af absolut base_value, men eftersom
// abilities er IDENTISKE i old- og new-beregningen, er DELTAET (den eneste
// størrelse der rapporteres nedenfor) langt mindre følsomt for denne mangel
// end det absolutte niveau ville være.
let valueOldSum = 0, valueNewSum = 0, valueComputed = 0, valueSkipped = 0;
const valueTop20Deltas = [];
for (const r of riders) {
  const { newPot99, oldPot } = remapById.get(r.id);
  const newTierEq = pot99ToTierEquivalent(newPot99);
  const ctx = (pot) => ({ primary_type: r.primary_type, potentiale: pot, age: r.age });
  const oldVal = predictBaseValueV4(ctx(oldPot), r.abilities, riderValuationModelV4);
  const newVal = predictBaseValueV4(ctx(newTierEq), r.abilities, riderValuationModelV4);
  if (oldVal == null || newVal == null) { valueSkipped++; continue; }
  valueComputed++;
  valueOldSum += oldVal;
  valueNewSum += newVal;
  const b = r.team_id ? managerBucket(r.team_id) : null;
  if (b) b.valueDeltaSum += (newVal - oldVal);
  valueTop20Deltas.push({ id: r.id, name: `${r.firstname} ${r.lastname}`, owner: ownerLabel(r), oldPot, newPot99, oldVal, newVal, delta: newVal - oldVal });
}
valueTop20Deltas.sort((a, b) => a.delta - b.delta);
const valueTop20Losers = valueTop20Deltas.slice(0, 20);
const valueTop20Gainers = [...valueTop20Deltas].sort((a, b) => b.delta - a.delta).slice(0, 20);

// ── Skriv output ─────────────────────────────────────────────────────────────
const out = {
  generated_at: new Date().toISOString(),
  snapshot_measured_at_utc: "2026-08-09T12:50:47.470Z",
  method_note: "Offline dry-run mod dateret snapshot (ingen DB-writes/queries). Kvantil-remap 1-6->1-99, stratificeret pr. aldersbånd, rang-bevarende (verificeret pr. bånd, se rank_violations).",
  target_geometry: {
    tiers: POTENTIALE_TIERS,
    decay: POTENTIALE_DECAY,
    centers_99scale: centers,
    weights_normalized: weights.map(round2),
  },
  rank_violations_count: rankViolations.length,
  rank_violations_sample: rankViolations.slice(0, 5),
  distribution_by_age_band: distributionReport,
  stock_gate: {
    old_tier6_count: oldTier6Count,
    old_tier6_share_pct: round2((100 * oldTier6Count) / totalN),
    new_ge90_count: newGe90Count,
    new_ge90_share_pct: round2((100 * newGe90Count) / totalN),
    expected_ge90_share_pct_from_geometry: round2(100 * expectedGe90Share),
    expected_ge90_count_from_geometry: round2(expectedGe90Count),
  },
  owner_diff: byOwner,
  pot56_owned_sanity_check: {
    old_pot_ge_4_5_owned: pot56OldOwned,
    note: "Reference: summary.json facit_crosscheck_9_8.pot6_owned_facit=224 vs målt 166 — kendt afvigelse, IKKE denne remaps ansvar (se afvigelse-rapportering i agent-svar).",
  },
  manager_diff: [...perManager.values()].sort((a, b) => b.downgraded - a.downgraded),
  top20_losers_rank: top20Losers,
  value_effect_v4: {
    method: "predictBaseValueV4 (riderCareerNpv.js) med fast abilities, kun potentiale varieret. Model: riderValuationModelV4.json (fitted_at 2026-07-18). LIMITATION: snapshot mangler 5 skjulte evne-nøgler (tactics/positioning/cobblestone/descending/aggression) — absolut niveau er tilnærmet, delta er robust (identiske abilities old/new).",
    riders_computed: valueComputed,
    riders_skipped_no_abilities: valueSkipped,
    old_value_sum: Math.round(valueOldSum),
    new_value_sum: Math.round(valueNewSum),
    delta_sum: Math.round(valueNewSum - valueOldSum),
    delta_pct: round2(100 * (valueNewSum - valueOldSum) / valueOldSum),
    top20_losers: valueTop20Losers,
    top20_gainers: valueTop20Gainers,
  },
  fictional_preview_finding: "IKKE udført som direkte før/efter-sammenligning. backend/scripts/previewFictionalPopulation.js genererer den fiktive LAUNCH-population (fictionalRiderGenerator.js, egen LAUNCH_POPULATION-tier-fordeling) — den kalder ALDRIG drawPotentiale/academyGenerator og læser ikke riders.potentiale. Den er derfor AFKOBLET fra akademiets 1-6->1-99-remap og kan ikke bruges til at sammenligne 'nuvaerende traek vs 1-99-traek' for DENNE migration uden at bygge en ny bro mellem de to generator-stier (ude af scope for denne dry-run). Desuden bekræftet (spec §3): admin-preview-fladen kører v3-modellen, ikke live-v4 — selv hvis broen fandtes ville sammenligningen være misvisende uden v4-ombygning af scriptet.",
};

// ── 8) Strukturelt fund: stock-vs-flow-effekten pr. gammel-tier og pr. aldersbånd ──
// Er nedjusteringen koncentreret om "overskuddet" (pot 5-6, spec §6) eller
// rammer den HELE bestanden? Kritisk for verdikten.
const downgradeByOldTier = {};
for (const t of POTENTIALE_TIERS) downgradeByOldTier[t] = { n: 0, downgraded: 0 };
const downgradeByAgeBand = {};
for (const b of AGE_BANDS) downgradeByAgeBand[b.key] = { n: 0, downgraded: 0, meanDelta: 0 };
for (const row of allDiffRows) {
  const tb = downgradeByOldTier[row.oldPot];
  if (tb) { tb.n++; if (row.delta < -0.01) tb.downgraded++; }
}
// (aldersbånd allerede kendt via remapById, brug det i stedet for genopslag)
for (const r of riders) {
  const { newPot99, oldPot, band } = remapById.get(r.id);
  const oldCenter99 = potentialeToCenter99(oldPot);
  const delta = newPot99 - oldCenter99;
  const bb = downgradeByAgeBand[band];
  bb.n++;
  bb.meanDelta += delta;
  if (delta < -0.01) bb.downgraded++;
}
for (const band of AGE_BANDS) downgradeByAgeBand[band.key].meanDelta = round2(downgradeByAgeBand[band.key].meanDelta / downgradeByAgeBand[band.key].n);

out.structural_finding_stock_vs_flow = {
  note: "Rangbevarende kvantil-remap pr. aldersbånd mod SAMME mål-CDF (den enkelt-kuld draw-geometri) betyder at hele bestandens fordeling i hvert aldersbånd presses til at matche et FRISKT kulds fordeling — ikke kun 'overskuddet' i toppen (pot 5-6). Da bestanden (især ældre aldersbånd) har akkumuleret langt mere masse i tier 2-4 end et friskt kuld ville (survivorship, jf. spec §3), rammer nedjusteringen BREDT, ikke kun toppen.",
  downgrade_share_by_old_tier: Object.fromEntries(Object.entries(downgradeByOldTier).map(([t, v]) => [t, { n: v.n, downgraded: v.downgraded, downgraded_pct: v.n ? round2(100 * v.downgraded / v.n) : 0 }])),
  downgrade_share_by_age_band: Object.fromEntries(Object.entries(downgradeByAgeBand).map(([b, v]) => [b, { n: v.n, downgraded: v.downgraded, downgraded_pct: round2(100 * v.downgraded / v.n), mean_delta_99scale: v.meanDelta }])),
};

writeFileSync(`${SNAP_DIR}/remap-dryrun-result.json`, JSON.stringify(out, null, 2));
console.log("Skrev remap-dryrun-result.json");
console.log("rank_violations:", rankViolations.length);
console.log("stock_gate:", out.stock_gate);
console.log("value_effect_v4 (sum/delta):", out.value_effect_v4.old_value_sum, out.value_effect_v4.new_value_sum, out.value_effect_v4.delta_sum, out.value_effect_v4.delta_pct + "%");
