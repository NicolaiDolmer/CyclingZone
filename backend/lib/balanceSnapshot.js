// Balance-snapshot (#1197) — deterministisk "tal-screenshot" af spilbalancen.
//
// Samme idé som core-smoke-screenshots, bare for tal: en fast-seeded, 100%
// in-memory kørsel af hele balance-kæden (generator → abilities → typer →
// værdimodel → race-motor → progression) kogt ned til ét JSON-objekt uden
// timestamps. Baseline committes (backend/scripts/baselines/); ved balance-PR'er
// regenereres snapshottet og diffes mod baseline — diffen ER reviewet
// ("denne ændring flytter median-climber-værdi +12%").
//
// Kæden KØRER de rene motor-funktioner uændret (raceSimulator.js m.fl. røres
// ikke). Runner-CLI: backend/scripts/balanceBaseline.js. Harness-standard: #1144.
//
// Determinisme-regler for snapshottet:
//   - fast seed + fast population (generateFictionalRiders er fuldt seeded)
//   - ingen timestamps, ingen Intl/locale-formatering
//   - alle objekt-nøgler sorteret, alle flydende tal afrundet til fast præcision

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { generateFictionalRiders, makeRng } from "./fictionalRiderGenerator.js";
import { deriveAbilities, VISIBLE_ABILITIES } from "./abilityDerivation.js";
import { computeRiderTypes, RIDER_TYPES } from "./riderTypes.js";
import { predictBaseValue, riderOverall } from "./riderValuation.js";
import { DEMAND_VECTORS } from "./raceStageProfileGenerator.js";
import { simulateStage, stableSeed, NOISE_SD_SCALE } from "./raceSimulator.js";
import { buildRaceResults } from "./raceRunner.js";
import { buildCaps, developRiderSeason } from "./riderProgression.js";
import { abilityRankSensitivity } from "./raceSensitivity.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

export const SNAPSHOT_FORMAT_VERSION = 1;

// Defaults matcher race:gate/simulateSeasonDryRun (seed 2026, 800 ryttere) så
// baseline-tallene er direkte sammenlignelige med kalibrerings-cockpittet.
export const BALANCE_SNAPSHOT_DEFAULTS = Object.freeze({
  seed: 2026,
  count: 800,
  races: 300,
  fieldSize: 140,
  gtField: 176,
  seasons: 6,
  referenceYear: 2026,
});

const TERRAINS = ["flat", "rolling", "hilly", "mountain", "high_mountain", "itt", "cobbles", "classic"];

// Samme GT-skabelon som simulateSeasonDryRun.js (21 etaper).
const GT_TEMPLATE = [
  "flat", "flat", "hilly", "rolling", "itt",
  "flat", "hilly", "mountain", "high_mountain", "flat",
  "rolling", "mountain", "hilly", "flat", "itt",
  "mountain", "high_mountain", "mountain", "high_mountain", "hilly",
  "flat",
];

// ── Determinisme-hjælpere ────────────────────────────────────────────────────
const round = (n, d = 0) => {
  if (n == null || !Number.isFinite(Number(n))) return null;
  const f = 10 ** d;
  return Math.round(Number(n) * f) / f;
};
// Stabil nøgle-sortering uden localeCompare (ICU-afhængig).
const sortKeys = (obj) =>
  Object.fromEntries(Object.entries(obj).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));

function percentile(sortedAsc, p) {
  if (!sortedAsc.length) return null;
  return sortedAsc[Math.min(sortedAsc.length - 1, Math.floor(p * sortedAsc.length))];
}
const sortedNums = (arr) => arr.filter((v) => v != null && Number.isFinite(Number(v))).map(Number).sort((a, b) => a - b);

function percentiles(values, spec, d = 0) {
  const s = sortedNums(values);
  const out = {};
  for (const [label, p] of spec) out[label] = round(percentile(s, p), d);
  out.max = s.length ? round(s[s.length - 1], d) : null;
  return out;
}

function sampleField(rng, pool, n) {
  const idx = pool.map((_, i) => i);
  const take = Math.min(n, idx.length);
  for (let i = 0; i < take; i++) {
    const j = i + Math.floor(rng() * (idx.length - i));
    [idx[i], idx[j]] = [idx[j], idx[i]];
  }
  return idx.slice(0, take).map((i) => pool[i]);
}

function keyAbilityOf(demand) {
  return Object.entries(demand)
    .filter(([k]) => k !== "randomness")
    .sort((a, b) => b[1] - a[1])[0][0];
}

const WEIGHTS_BY_TYPE = Object.fromEntries(RIDER_TYPES.map((t) => [t.key, t.weights]));

function signatureAvg(abilities, type) {
  const w = WEIGHTS_BY_TYPE[type] || {};
  const sig = Object.keys(w).filter((k) => w[k] > 0);
  if (!sig.length) return null;
  return sig.reduce((s, k) => s + (Number(abilities?.[k]) || 0), 0) / sig.length;
}

const abilitySum = (abilities) =>
  VISIBLE_ABILITIES.reduce((s, k) => s + (Number(abilities?.[k]) || 0), 0);

// ── Snapshot-builder ─────────────────────────────────────────────────────────
/**
 * Byg det deterministiske balance-snapshot. Rører INGEN DB — alt er in-memory.
 * Samme options → bit-identisk output (forudsat uændrede balance-konstanter).
 */
export function buildBalanceSnapshot(options = {}) {
  const opts = { ...BALANCE_SNAPSHOT_DEFAULTS, ...options };
  const { seed, count, races, fieldSize, gtField, seasons, referenceYear } = opts;

  const baseline = JSON.parse(readFileSync(join(__dirname, "riderTypesBaseline.json"), "utf8"));
  const model = JSON.parse(readFileSync(join(__dirname, "riderValuationModel.json"), "utf8"));

  // 1. Population: hele værdi-kæden (som prod-backfills + dry-run-cockpittet).
  const { riders: raw } = generateFictionalRiders({ count, seed, referenceYear });
  const field = raw.map((r, i) => {
    const id = `r${i}`;
    const abilities = deriveAbilities({}, { ...r, id }, { asOfYear: referenceYear });
    const derived = computeRiderTypes(abilities, baseline).primary?.key ?? "?";
    const birthYear = Number(String(r.birthdate).slice(0, 4));
    return {
      id,
      name: `${r.firstname} ${r.lastname}`,
      bornAs: r._meta?.archetype ?? "?",
      derived,
      potentiale: r.potentiale,
      startAge: Number.isFinite(birthYear) ? referenceYear - birthYear : null,
      is_u25: !!r.is_u25,
      overall: riderOverall(abilities),
      baseValue: predictBaseValue({ primary_type: derived }, abilities, model),
      abilities,
    };
  });
  const byId = new Map(field.map((r) => [r.id, r]));

  const typeMix = {};
  for (const r of field) typeMix[r.derived] = (typeMix[r.derived] || 0) + 1;

  const pctSpec = [["p10", 0.10], ["p25", 0.25], ["p50", 0.50], ["p75", 0.75], ["p90", 0.90], ["p99", 0.99]];
  const baseValueByType = {};
  for (const type of Object.keys(typeMix)) {
    const vals = field.filter((r) => r.derived === type).map((r) => r.baseValue);
    baseValueByType[type] = {
      n: vals.filter((v) => v != null).length,
      p50: round(percentile(sortedNums(vals), 0.50)),
      p90: round(percentile(sortedNums(vals), 0.90)),
      max: round(sortedNums(vals).at(-1)),
    };
  }

  const population = {
    n: field.length,
    typeMix: sortKeys(typeMix),
    overall: percentiles(field.map((r) => r.overall), pctSpec),
    baseValue: percentiles(field.map((r) => r.baseValue), pctSpec),
    baseValueByType: sortKeys(baseValueByType),
  };

  // 2. Race-motor: per-terræn vinder-fordelinger (motor-funktionerne KØRES uændret).
  const fieldMedianAbility = (key) =>
    percentile(sortedNums(field.map((r) => r.abilities[key])), 0.5);

  const terrains = {};
  for (const terrain of TERRAINS) {
    const demand = DEMAND_VECTORS[terrain];
    const keyAb = keyAbilityOf(demand);
    const rng = makeRng(stableSeed(`dryrun:${seed}:${terrain}`));
    const winnersBornAs = {};
    const winnersDerived = {};
    const winners = new Set();
    let strongestWon = 0;
    let overallRankSum = 0;
    let winnerKeySum = 0;

    for (let i = 0; i < races; i++) {
      const sample = sampleField(rng, field, fieldSize);
      const entrants = sample.map((r) => ({ rider_id: r.id, team_id: r.id, abilities: r.abilities }));
      const { ranked } = simulateStage({
        entrants,
        stageProfile: { profile_type: terrain, demand_vector: demand },
        seed: stableSeed(`${terrain}:${i}`),
      });
      const w = byId.get(ranked[0].rider_id);
      winnersBornAs[w.bornAs] = (winnersBornAs[w.bornAs] || 0) + 1;
      winnersDerived[w.derived] = (winnersDerived[w.derived] || 0) + 1;
      winners.add(w.id);
      winnerKeySum += w.abilities[keyAb];
      const byOverall = [...sample].sort((a, b) => b.overall - a.overall);
      const rank = byOverall.findIndex((r) => r.id === w.id) + 1;
      overallRankSum += rank;
      if (rank === 1) strongestWon++;
    }
    terrains[terrain] = {
      keyAbility: keyAb,
      races,
      winnerKeyAvg: round(winnerKeySum / races),
      fieldMedianKey: round(fieldMedianAbility(keyAb)),
      distinctWinners: winners.size,
      strongestWonPct: round((100 * strongestWon) / races, 1),
      avgWinnerStrengthRank: round(overallRankSum / races, 1),
      winnersBornAs: sortKeys(winnersBornAs),
      winnersDerived: sortKeys(winnersDerived),
    };
  }

  // Udbruds-andel af bjergsejre (rapport-metrik fra dry-run-cockpittet).
  const mt = ["mountain", "high_mountain"].map((t) => terrains[t]);
  const breakawayWins = mt.reduce(
    (s, tr) => s + (tr.winnersBornAs.baroudeur || 0) + (tr.winnersBornAs.fighter || 0), 0);
  const mtTotal = mt.reduce((s, tr) => s + tr.races, 0);

  // 3. Grand Tour: 21 etaper gennem buildRaceResults (samme emission som prod).
  const gtRng = makeRng(stableSeed(`dryrun:${seed}:gt`));
  const gtRiders = sampleField(gtRng, field, gtField).sort((a, b) => b.overall - a.overall);
  const nTeams = Math.ceil(gtRiders.length / 8);
  const gtEntrants = gtRiders.map((r, i) => {
    const roundNo = Math.floor(i / nTeams);
    const pos = i % nTeams;
    const teamIdx = roundNo % 2 === 0 ? pos : nTeams - 1 - pos;
    return { rider_id: r.id, team_id: `t${teamIdx}`, rider_name: r.name, is_u25: r.is_u25, abilities: r.abilities };
  });
  const gtStages = GT_TEMPLATE.map((profile_type, i) => ({
    stage_number: i + 1,
    profile_type,
    demand_vector: DEMAND_VECTORS[profile_type],
  }));
  const { resultRows } = buildRaceResults({
    race: { id: "gt-dry", race_type: "stage_race" },
    stages: gtStages,
    entrants: gtEntrants,
    pointsLookup: {},
  });
  const finalStage = GT_TEMPLATE.length;
  const rowsOf = (type) => resultRows
    .filter((x) => x.result_type === type && x.stage_number === finalStage)
    .sort((a, b) => a.rank - b.rank);
  const riderRef = (row) => {
    const r = byId.get(row.rider_id);
    return { rank: row.rank, name: r.name, bornAs: r.bornAs, derived: r.derived, ...(row.finish_time ? { time: row.finish_time } : {}) };
  };
  const grandTour = {
    gcTop10: rowsOf("gc").slice(0, 10).map(riderRef),
    jerseys: {
      mountain: rowsOf("mountain").slice(0, 1).map(riderRef)[0] ?? null,
      points: rowsOf("points").slice(0, 1).map(riderRef)[0] ?? null,
      young: rowsOf("young").slice(0, 1).map(riderRef)[0] ?? null,
    },
  };

  const race = {
    terrains: sortKeys(terrains),
    breakawayMountainSharePct: round((100 * breakawayWins) / mtTotal, 1),
    grandTour,
  };

  // Evne-liveness (#1122): committet ⌀rank-gevinst pr. probe → ENHVER fremtidig
  // ændring der dræber en evne dukker op som en diff. Samme probe-matrix som
  // dry-run-cockpittets sektion E (delmængde for determinisme/hastighed).
  const SENS_PROBES = [
    { ability: "sprint", terrain: "flat", mode: "neutral" },
    { ability: "climbing", terrain: "mountain", mode: "neutral" },
    { ability: "flat", terrain: "rolling", mode: "neutral" },
    { ability: "tempo", terrain: "mountain", mode: "neutral" },
    { ability: "aggression", terrain: "flat", mode: "breakaway" },
    { ability: "descending", terrain: "mountain", mode: "finale", finaleType: "descent" },
  ];
  const sensField = field.map((r) => ({ id: r.id, overall: r.overall, abilities: r.abilities }));
  const abilitySensitivity = {};
  for (const p of SENS_PROBES) {
    abilitySensitivity[`${p.ability}@${p.terrain}`] = round(
      abilityRankSensitivity({
        field: sensField, profileType: p.terrain, demandVector: DEMAND_VECTORS[p.terrain],
        ability: p.ability, finaleType: p.finaleType ?? null,
        samples: 120, fieldSize: 80, seed,
      }), 2);
  }
  race.abilitySensitivity = sortKeys(abilitySensitivity);

  // 4. Progression: N sæsoner passiv udvikling på samme population (deterministisk
  //    FNV-seeded støj i riderProgression.js — KØRES uændret).
  const pop = field
    .filter((r) => r.potentiale != null && r.startAge != null && r.startAge >= 17 && r.startAge <= 42)
    .map((r) => ({
      id: r.id,
      type: r.derived,
      potentiale: Number(r.potentiale),
      startAge: r.startAge,
      retired: false,
      abilities: Object.fromEntries(VISIBLE_ABILITIES.filter((k) => r.abilities[k] != null).map((k) => [k, Number(r.abilities[k])])),
      caps: buildCaps(r.abilities, r.derived, r.potentiale),
      baseValue0: r.baseValue,
    }));

  const retiredPerSeason = [];
  let u25Deltas = [];
  for (let s = 1; s <= seasons; s++) {
    const u25Before = [];
    const u25Ref = [];
    for (const p of pop) {
      if (p.retired) continue;
      if (p.startAge + (s - 1) < 25) {
        u25Before.push(abilitySum(p.abilities));
        u25Ref.push(p);
      }
    }
    let retiredThisSeason = 0;
    for (const p of pop) {
      if (p.retired) continue;
      const res = developRiderSeason(
        { id: p.id, primary_type: p.type, potentiale: p.potentiale, age: p.startAge + s },
        p.abilities, p.caps, s);
      p.abilities = { ...p.abilities, ...res.next };
      if (res.retirement.retire) {
        p.retired = true;
        retiredThisSeason++;
      }
    }
    retiredPerSeason.push(retiredThisSeason);
    u25Deltas = u25Deltas.concat(u25Ref.map((p, i) => abilitySum(p.abilities) - u25Before[i]));
  }

  const youngGrowth = [];
  for (const p of pop) {
    if (p.startAge <= 23 && p.potentiale >= 4 && p.baseValue0 > 0) {
      const bvNow = predictBaseValue({ primary_type: p.type }, p.abilities, model);
      if (bvNow) youngGrowth.push(bvNow / p.baseValue0);
    }
  }
  const sigAfter = pop.filter((p) => !p.retired).map((p) => signatureAvg(p.abilities, p.type));
  const triSpec = [["p10", 0.10], ["p50", 0.50], ["p90", 0.90]];

  const progression = {
    seasons,
    simulatedRiders: pop.length,
    retiredPerSeason,
    u25AbilitySumDeltaPerSeason: percentiles(u25Deltas, triSpec, 1),
    youngTalentValueMultiplier: { n: youngGrowth.length, ...percentiles(youngGrowth, triSpec, 2) },
    signatureAvgAfterSim: percentiles(sigAfter, [["p50", 0.50], ["p90", 0.90], ["p99", 0.99]]),
  };

  return {
    formatVersion: SNAPSHOT_FORMAT_VERSION,
    meta: {
      seed, count, races, fieldSize, gtField, seasons, referenceYear,
      noiseSdScale: NOISE_SD_SCALE,
      valuationModelVersion: model.version ?? null,
      valuationModelFittedAt: model.fitted_at ?? null,
    },
    population,
    race,
    progression,
  };
}

// ── Diff ─────────────────────────────────────────────────────────────────────
/** Flad snapshot til path → leaf-value map (deterministisk rækkefølge). */
export function flattenSnapshot(value, prefix = "", out = new Map()) {
  if (value !== null && typeof value === "object") {
    if (Array.isArray(value)) {
      if (!value.length) out.set(prefix, "[]");
      value.forEach((v, i) => flattenSnapshot(v, `${prefix}[${i}]`, out));
    } else {
      const keys = Object.keys(value);
      if (!keys.length) out.set(prefix, "{}");
      for (const k of keys) flattenSnapshot(value[k], prefix ? `${prefix}.${k}` : k, out);
    }
  } else {
    out.set(prefix, value);
  }
  return out;
}

/**
 * Diff to snapshots. Tom liste = identiske (determinisme betyder at ENHVER
 * forskel er en reel balance-ændring, ikke støj).
 * @returns {Array<{path, kind: "changed"|"added"|"removed", before, after}>}
 */
export function diffSnapshots(baselineSnap, currentSnap) {
  const a = flattenSnapshot(baselineSnap);
  const b = flattenSnapshot(currentSnap);
  const diffs = [];
  for (const [path, before] of a) {
    if (!b.has(path)) diffs.push({ path, kind: "removed", before, after: null });
    else if (!Object.is(b.get(path), before)) diffs.push({ path, kind: "changed", before, after: b.get(path) });
  }
  for (const [path, after] of b) {
    if (!a.has(path)) diffs.push({ path, kind: "added", before: null, after });
  }
  return diffs;
}

// ── Markdown-rendering ───────────────────────────────────────────────────────
const fmtVal = (v) => (v == null ? "—" : typeof v === "number" ? String(v) : `\`${v}\``);

/** Markdown-resumé af et snapshot (committes ved siden af baseline-JSON). */
export function renderSnapshotMarkdown(snap) {
  const L = [];
  const m = snap.meta;
  L.push("# Balance-baseline — deterministisk snapshot (#1197)");
  L.push("");
  L.push(`> Genereret af \`node backend/scripts/balanceBaseline.js --write\` · seed ${m.seed} · ${m.count} ryttere · ${m.races} løb/terræn · ${m.seasons} progression-sæsoner · noise ${m.noiseSdScale} · værdimodel v${m.valuationModelVersion} (${m.valuationModelFittedAt})`);
  L.push(">");
  L.push("> Ændrer en PR balance-følsomme filer, regenereres snapshottet og diffes mod denne baseline — diffen er reviewet. Bump: `npm run balance:baseline` (i `backend/`) + commit.");
  L.push("");

  L.push("## Population");
  L.push("");
  L.push(`${snap.population.n} ryttere · overall p50 ${snap.population.overall.p50} (p90 ${snap.population.overall.p90}, max ${snap.population.overall.max}) · base_value p50 ${snap.population.baseValue.p50} (p99 ${snap.population.baseValue.p99}, max ${snap.population.baseValue.max})`);
  L.push("");
  L.push("| Type | Antal | base_value p50 | p90 | max |");
  L.push("|---|--:|--:|--:|--:|");
  for (const [type, n] of Object.entries(snap.population.typeMix)) {
    const v = snap.population.baseValueByType[type] ?? {};
    L.push(`| ${type} | ${n} | ${fmtVal(v.p50)} | ${fmtVal(v.p90)} | ${fmtVal(v.max)} |`);
  }
  L.push("");

  L.push("## Race-motor (vinder-fordeling pr. terræn)");
  L.push("");
  L.push("| Terræn | Nøgle-evne | Vinder ⌀ vs median | Distinkte | Stærkeste vandt | Top-vindertyper (født-som) |");
  L.push("|---|---|---|--:|--:|---|");
  for (const [terrain, tr] of Object.entries(snap.race.terrains)) {
    const top = Object.entries(tr.winnersBornAs).sort((x, y) => y[1] - x[1]).slice(0, 3)
      .map(([t, n]) => `${t} ${Math.round((100 * n) / tr.races)}%`).join(", ");
    L.push(`| ${terrain} | ${tr.keyAbility} | ${tr.winnerKeyAvg} vs ${tr.fieldMedianKey} | ${tr.distinctWinners}/${tr.races} | ${tr.strongestWonPct}% | ${top} |`);
  }
  L.push("");
  L.push(`Udbruds-andel af bjergsejre: ${snap.race.breakawayMountainSharePct}%`);
  L.push("");
  L.push("### Evne-liveness (⌀rank-gevinst pr. probe)");
  L.push("");
  L.push("| Probe | ⌀rank-gevinst |");
  L.push("|---|--:|");
  for (const [probe, gain] of Object.entries(snap.race.abilitySensitivity || {})) {
    L.push(`| ${probe} | ${fmtVal(gain)} |`);
  }
  L.push("");
  L.push("### Grand Tour (21 etaper)");
  L.push("");
  L.push("| # | Rytter | Født-som | Afledt | Tid |");
  L.push("|--:|---|---|---|---|");
  for (const g of snap.race.grandTour.gcTop10) {
    L.push(`| ${g.rank} | ${g.name} | ${g.bornAs} | ${g.derived} | ${g.time ?? ""} |`);
  }
  const j = snap.race.grandTour.jerseys;
  L.push("");
  L.push(`Trøjer: 🟢 ${j.points?.name ?? "—"} (${j.points?.bornAs ?? "?"}) · ⛰️ ${j.mountain?.name ?? "—"} (${j.mountain?.bornAs ?? "?"}) · ⚪ ${j.young?.name ?? "—"}`);
  L.push("");

  L.push("## Progression");
  L.push("");
  const p = snap.progression;
  L.push(`${p.simulatedRiders} simulerede ryttere over ${p.seasons} sæsoner · pension/sæson: ${p.retiredPerSeason.join(", ")}`);
  L.push("");
  L.push("| Metrik | p10 | p50 | p90 |");
  L.push("|---|--:|--:|--:|");
  L.push(`| U25 ability-sum-delta/sæson | ${fmtVal(p.u25AbilitySumDeltaPerSeason.p10)} | ${fmtVal(p.u25AbilitySumDeltaPerSeason.p50)} | ${fmtVal(p.u25AbilitySumDeltaPerSeason.p90)} |`);
  L.push(`| Ungt talent base_value ×mult (n=${p.youngTalentValueMultiplier.n}) | ${fmtVal(p.youngTalentValueMultiplier.p10)} | ${fmtVal(p.youngTalentValueMultiplier.p50)} | ${fmtVal(p.youngTalentValueMultiplier.p90)} |`);
  L.push(`| Signatur-snit efter sim | — | ${fmtVal(p.signatureAvgAfterSim.p50)} | ${fmtVal(p.signatureAvgAfterSim.p90)} (p99 ${fmtVal(p.signatureAvgAfterSim.p99)}, max ${fmtVal(p.signatureAvgAfterSim.max)}) |`);
  L.push("");
  return L.join("\n") + "\n";
}

const MAX_DIFF_ROWS = 200;

/** Markdown-rapport af en diff (vises i PR/CI step summary). */
export function renderDiffMarkdown(diffs) {
  const L = [];
  L.push("## Balance-baseline-diff (#1197)");
  L.push("");
  if (!diffs.length) {
    L.push("✅ Tom diff — balance-snapshottet matcher den committede baseline.");
    L.push("");
    return L.join("\n");
  }
  L.push(`⚠️ ${diffs.length} afvigelse(r) fra committet baseline. Diffen ER reviewet — er skiftet tilsigtet, bump baselinen i samme PR: \`npm run balance:baseline\` (i \`backend/\`) + commit \`backend/scripts/baselines/\`.`);
  L.push("");
  L.push("| Sti | Baseline | Ny | Δ |");
  L.push("|---|--:|--:|--:|");
  for (const d of diffs.slice(0, MAX_DIFF_ROWS)) {
    let delta = d.kind;
    if (d.kind === "changed" && typeof d.before === "number" && typeof d.after === "number") {
      const abs = round(d.after - d.before, 2);
      delta = d.before !== 0 ? `${abs > 0 ? "+" : ""}${abs} (${round((100 * (d.after - d.before)) / Math.abs(d.before), 1)}%)` : `${abs > 0 ? "+" : ""}${abs}`;
    }
    L.push(`| \`${d.path}\` | ${fmtVal(d.before)} | ${fmtVal(d.after)} | ${delta} |`);
  }
  if (diffs.length > MAX_DIFF_ROWS) L.push(`| … | | | +${diffs.length - MAX_DIFF_ROWS} rækker |`);
  L.push("");
  return L.join("\n");
}
