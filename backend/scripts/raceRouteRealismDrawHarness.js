#!/usr/bin/env node
// backend/scripts/raceRouteRealismDrawHarness.js
// #3347-harness: mål hvor ofte realisme-gaten (#2755/#2769) fejler PÅ REN TILFÆLDIGHED,
// og hvor meget det deterministiske re-draw (raceRouteRealismDraw.js) fjerner.
//
// Metode: samme katalog, N forskellige syntetiske season_id'er ("sæson-varianter").
// Hver variant regenererer hele kalenderen in-memory og scores af scoreSeason.
// 100 % read-only og DB-fri i default-tilstand — kalender-snapshottet ligger i
// lib/__fixtures__/seasonTierCalendarSnapshot.json, så tallene kan reproduceres
// uden Supabase-adgang.
//
//   node scripts/raceRouteRealismDrawHarness.js                  # 3000 varianter, før/efter
//   node scripts/raceRouteRealismDrawHarness.js --variants 500   # hurtigere kørsel
//   node scripts/raceRouteRealismDrawHarness.js --catalog        # KAN kataloget levere båndene? (#3347 retning 1)
//   node scripts/raceRouteRealismDrawHarness.js --refresh        # gen-snapshot fixturen fra DB (read-only SELECT)
//   node scripts/raceRouteRealismDrawHarness.js --season 2       # rapportér den ÆGTE sæsons træk
//
// "FØR" = attempt 0 for alle tiers (adfærden før #3347).
// "EFTER" = resolveSeasonDraw (op til MAX_REALISM_DRAW_ATTEMPTS deterministiske gen-træk).

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { generateRaceStageProfiles } from "../lib/raceStageProfileGenerator.js";
import { scoreSeason } from "../lib/raceRouteRealismMetrics.js";
import { resolveSeasonDraw, MAX_REALISM_DRAW_ATTEMPTS } from "../lib/raceRouteRealismDraw.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Delt fixture: også testernes kalender-snapshot (lib/raceRouteRealismDraw.test.js), så
// harness-tallene og regressions-testene beviseligt beskriver SAMME kalender.
const FIXTURE = join(__dirname, "..", "lib", "__fixtures__", "seasonTierCalendarSnapshot.json");

const argIdx = (flag) => process.argv.indexOf(flag);
const argNum = (flag, fallback) => (argIdx(flag) >= 0 ? Number(process.argv[argIdx(flag) + 1]) : fallback);

export function loadSnapshot(path = FIXTURE) {
  return JSON.parse(readFileSync(path, "utf8"));
}

/** Ét "sæson-træk": tier-entries med seedRaces bundet til ét season_id. */
export function tierSeedRacesFor(snapshot, seasonId) {
  return snapshot.tiers.map((t) => ({
    tier: t.tier,
    seedRaces: t.races.map((r) => ({ ...r, id: r.external_id, season_id: seasonId })),
  }));
}

/** FØR-stien: attempt 0 for alle tiers (præcis adfærden før #3347). */
export function scoreFirstDraw(tierSeedRaces, generateProfiles = generateRaceStageProfiles) {
  return scoreSeason(tierSeedRaces.map(({ tier, seedRaces }) => ({
    tier,
    races: seedRaces.map((r) => ({
      name: r.name, race_type: r.race_type, terrain_archetype: r.terrain_archetype,
      stages: generateProfiles(r),
    })),
  })));
}

/** EFTER-stien: deterministisk re-draw pr. tier. */
export function scoreResolvedDraw(tierSeedRaces, opts = {}) {
  const draws = resolveSeasonDraw({ tierSeedRaces, ...opts });
  return { summary: scoreSeason(draws.map((d) => d.entry)), draws };
}

// ── rapport-hjælpere ─────────────────────────────────────────────────────────
function tally() {
  const c = new Map();
  return {
    bump: (k) => c.set(k, (c.get(k) || 0) + 1),
    rows: (n) => [...c.entries()].sort().map(([k, v]) => `  ${k.padEnd(34)} ${String(v).padStart(5)}  ${((v / n) * 100).toFixed(2)} %`),
    get: (k) => c.get(k) || 0,
  };
}
const failKind = (f) => {
  const tierPart = f.match(/^tier (\d+): /)?.[1] ?? "?";
  if (f.includes("GT ")) return `tier ${tierPart}: GT-bånd`;
  const band = f.replace(/^tier \d+: /, "").split(" ")[0];
  return `tier ${tierPart}: ${band}`;
};

function summarize(label, n, t, seasonFails) {
  const lines = [`\n── ${label} (N=${n} sæson-varianter) ──`];
  lines.push(`  ${"SÆSONER MED MINDST ÉT BÅNDBRUD".padEnd(34)} ${String(seasonFails).padStart(5)}  ${((seasonFails / n) * 100).toFixed(2)} %`);
  lines.push(...t.rows(n));
  return lines.join("\n");
}

// ── CLI ──────────────────────────────────────────────────────────────────────
const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (isMain) {
  if (process.argv.includes("--refresh")) {
    await refreshFixture();
  } else if (process.argv.includes("--catalog")) {
    reportCatalogCapacity(argNum("--variants", 3000), argNum("--tier", 3));
  } else if (argIdx("--season") >= 0) {
    await reportLiveSeason(argNum("--season", 2));
  } else {
    runSweep(argNum("--variants", 3000));
  }
}

function runSweep(n) {
  const snapshot = loadSnapshot();
  const raceCount = snapshot.tiers.reduce((s, t) => s + t.races.length, 0);
  console.log(`\n=== #3347 re-draw-harness — ${raceCount} løb fordelt på ${snapshot.tiers.length} tiers (${snapshot.source}) ===`);
  console.log(`Maks. re-draw-forsøg pr. tier: ${MAX_REALISM_DRAW_ATTEMPTS}`);

  const before = tally();
  const after = tally();
  let beforeSeasonFails = 0;
  let afterSeasonFails = 0;
  const attemptHist = new Map();
  const tier3 = { summit: [], mdown: [] };

  for (let i = 0; i < n; i++) {
    const tierSeedRaces = tierSeedRacesFor(snapshot, `synthetic-season-${i}`);

    const pre = scoreFirstDraw(tierSeedRaces);
    if (pre.failures.length) beforeSeasonFails++;
    for (const f of new Set(pre.failures.map(failKind))) before.bump(f);
    const t3 = pre.tiers.find((t) => t.tier === 3);
    if (t3) { tier3.summit.push(t3.score.summit_finishes); tier3.mdown.push(t3.score.mdown_pct); }

    const { summary: post, draws } = scoreResolvedDraw(tierSeedRaces);
    if (post.failures.length) afterSeasonFails++;
    for (const f of new Set(post.failures.map(failKind))) after.bump(f);
    for (const d of draws) attemptHist.set(d.attempt, (attemptHist.get(d.attempt) || 0) + 1);
  }

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
  console.log(`\nTier 3-fordeling ved det kanoniske træk (attempt 0):`);
  console.log(`  summit-finaler : middel ${mean(tier3.summit).toFixed(2)} · sd ${sd(tier3.summit).toFixed(2)} · min ${Math.min(...tier3.summit)} · max ${Math.max(...tier3.summit)}   [bånd ≥ 8]`);
  console.log(`  M-Down         : middel ${mean(tier3.mdown).toFixed(2)} % · sd ${sd(tier3.mdown).toFixed(2)} · min ${Math.min(...tier3.mdown)} % · max ${Math.max(...tier3.mdown)} %   [bånd ≤ 55 %]`);

  console.log(summarize("FØR — ét træk pr. sæson (adfærd før #3347)", n, before, beforeSeasonFails));
  console.log(summarize("EFTER — deterministisk re-draw pr. tier (#3347)", n, after, afterSeasonFails));

  const totalDraws = [...attemptHist.values()].reduce((s, x) => s + x, 0);
  console.log(`\nValgt attempt pr. tier-træk (${totalDraws} træk i alt):`);
  for (const [a, v] of [...attemptHist.entries()].sort((x, y) => x[0] - y[0])) {
    console.log(`  attempt ${String(a).padStart(2)}: ${String(v).padStart(6)}  ${((v / totalDraws) * 100).toFixed(2)} %`);
  }
}

// #3347 retning 1: er båndene kalibreret mod tierens FAKTISKE katalog-sammensætning?
// Måler LOFTET (hver bjerg-familie-etape = potentiel summit) mod det båndet kræver, og
// hvor stor en del af loftet finale-trækket i praksis konverterer. Er loftet < båndet, er
// båndet forkert; er loftet komfortabelt over, er det spredningen — ikke kalibreringen.
function reportCatalogCapacity(n, tier) {
  const snapshot = loadSnapshot();
  const t = snapshot.tiers.find((x) => x.tier === tier);
  if (!t) throw new Error(`tier ${tier} findes ikke i snapshottet`);
  const MOUNTAIN = new Set(["mountain", "high_mountain"]);
  const byArchetype = new Map();
  const ceilingRun = [], summitRun = [], mdownRun = [];

  for (let i = 0; i < n; i++) {
    const seasonId = `synthetic-season-${i}`;
    let ceiling = 0, summit = 0, mdown = 0;
    for (const r of t.races) {
      const stages = generateRaceStageProfiles({ ...r, id: r.external_id, season_id: seasonId });
      const mtn = stages.filter((s) => MOUNTAIN.has(s.profile_type));
      const sum = mtn.filter((s) => s.finale_type === "long_climb").length;
      ceiling += mtn.length; summit += sum; mdown += mtn.filter((s) => s.finale_type === "descent").length;
      const key = `${r.terrain_archetype ?? "(ingen)"} [${r.race_type === "stage_race" ? `${r.stages} et.` : "endagsløb"}]`;
      const acc = byArchetype.get(key) || { races: 0, ceiling: 0, summit: 0 };
      acc.ceiling += mtn.length; acc.summit += sum; byArchetype.set(key, acc);
    }
    ceilingRun.push(ceiling); summitRun.push(summit); mdownRun.push(ceiling ? (mdown / ceiling) * 100 : 0);
  }
  for (const r of t.races) {
    const key = `${r.terrain_archetype ?? "(ingen)"} [${r.race_type === "stage_race" ? `${r.stages} et.` : "endagsløb"}]`;
    byArchetype.get(key).races += 1;
  }

  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  const sd = (a) => { const m = mean(a); return Math.sqrt(a.reduce((s, x) => s + (x - m) ** 2, 0) / a.length); };
  console.log(`\n=== Katalog-kapacitet, tier ${tier} (${t.races.length} løb · N=${n} træk) ===`);
  console.log(`Loft (bjerg-familie-etaper i alt — teoretisk max summits): middel ${mean(ceilingRun).toFixed(2)} · min ${Math.min(...ceilingRun)}`);
  console.log(`Faktiske summits:  middel ${mean(summitRun).toFixed(2)} · sd ${sd(summitRun).toFixed(2)} · min ${Math.min(...summitRun)} · max ${Math.max(...summitRun)}`);
  console.log(`M-Down:            middel ${mean(mdownRun).toFixed(2)} % · sd ${sd(mdownRun).toFixed(2)}`);
  console.log(`\nBidrag pr. arketype (middel pr. sæson):`);
  console.log(`  ${"arketype".padEnd(34)} ${"løb".padStart(4)} ${"loft".padStart(7)} ${"summits".padStart(8)}`);
  for (const [k, v] of [...byArchetype].sort((a, b) => b[1].summit - a[1].summit)) {
    console.log(`  ${k.padEnd(34)} ${String(v.races).padStart(4)} ${(v.ceiling / n).toFixed(2).padStart(7)} ${(v.summit / n).toFixed(2).padStart(8)}`);
  }
}

async function reportLiveSeason(seasonNumber) {
  const { snapshot } = await snapshotFromDb(seasonNumber);
  const seasonId = snapshot.seasonId;
  const tierSeedRaces = tierSeedRacesFor(snapshot, seasonId);
  const pre = scoreFirstDraw(tierSeedRaces);
  const { summary: post, draws } = scoreResolvedDraw(tierSeedRaces);
  console.log(`\n=== Sæson ${seasonNumber} (${seasonId}) — ægte season_id ===`);
  console.log(`FØR  : ${pre.verdict} · ${pre.failures.length} båndbrud`);
  for (const f of pre.failures) console.log(`   · ${f}`);
  console.log(`EFTER: ${post.verdict} · ${post.failures.length} båndbrud`);
  for (const f of post.failures) console.log(`   · ${f}`);
  console.log(`Valgt attempt pr. tier: ${draws.map((d) => `tier ${d.tier}=${d.attempt}${d.exhausted ? " (UDTØMT)" : ""}`).join(" · ")}`);
}

/** --refresh: gen-snapshot fixturen fra live-DB. Kun SELECT — skriver intet i DB. */
async function refreshFixture() {
  const { snapshot } = await snapshotFromDb(argNum("--season", 2));
  writeFileSync(FIXTURE, `${JSON.stringify(snapshot, null, 2)}\n`);
  console.log(`Fixture opdateret: ${FIXTURE}`);
  for (const t of snapshot.tiers) console.log(`  tier ${t.tier}: ${t.races.length} løb`);
}

async function snapshotFromDb(seasonNumber) {
  const [{ createClient }, dotenv, { fetchAllRows }] = await Promise.all([
    import("@supabase/supabase-js"), import("dotenv"), import("../lib/supabasePagination.js"),
  ]);
  dotenv.default.config({ path: join(__dirname, "..", ".env"), quiet: true });
  const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
  if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) throw new Error("SUPABASE_URL / SUPABASE_SERVICE_KEY mangler i backend/.env");
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

  const { data: season, error } = await supabase.from("seasons").select("id, number").eq("number", seasonNumber).single();
  if (error || !season) throw new Error(`Sæson ${seasonNumber} ikke fundet: ${error?.message}`);

  const divisions = await fetchAllRows(() => supabase.from("league_divisions").select("id, tier").order("id"));
  const tierByDiv = new Map(divisions.map((d) => [d.id, d.tier]));
  const onePoolByTier = new Map();
  for (const d of [...divisions].sort((a, b) => a.id - b.id)) if (!onePoolByTier.has(d.tier)) onePoolByTier.set(d.tier, d.id);
  const samplePools = new Set(onePoolByTier.values());

  const catalog = await fetchAllRows(() => supabase.from("race_pool").select("id, external_id, terrain_archetype").order("id"));
  const metaByPool = new Map(catalog.map((c) => [c.id, c]));
  const races = await fetchAllRows(() =>
    supabase.from("races").select("id, name, race_type, stages, pool_race_id, league_division_id").eq("season_id", season.id).order("id"));

  const byTier = new Map();
  for (const r of races) {
    if (!samplePools.has(r.league_division_id)) continue;
    const tier = tierByDiv.get(r.league_division_id);
    const meta = metaByPool.get(r.pool_race_id) || {};
    if (!byTier.has(tier)) byTier.set(tier, []);
    byTier.get(tier).push({
      name: r.name, external_id: meta.external_id ?? null, race_type: r.race_type,
      stages: r.stages, terrain_archetype: meta.terrain_archetype ?? null,
    });
  }
  const snapshot = {
    source: `sæson ${seasonNumber} (live race_pool + races), én repræsentativ pulje pr. tier — snapshot via raceRouteRealismDrawHarness.js --refresh`,
    seasonNumber, seasonId: season.id,
    tiers: [...byTier.keys()].sort((a, b) => a - b).map((tier) => ({ tier, races: byTier.get(tier) })),
  };
  return { snapshot };
}
