#!/usr/bin/env node
// #5641 · A1 (delissue af #4592, ejer-beslutning 24/9): sammenlægning
// D4 → D3 ved sæsonskiftet S3→S4.
//
// Samme timing-problem og løsning som compressPyramidS3.js (#3901): flytningen
// skal ske EFTER "Afslut sæson" (S3 → 'completed'), men rangeringskilden
// (season_standings for S3) er kun sikker at læse mens listen fryses TÆT PÅ
// cutover. Løsning: dry-run (default) beregner og FRYSER fordelingen som JSON
// (docs/snapshots/4592/). --apply LÆSER kun den frosne, ejer-godkendte JSON —
// ingen live-genberegning ved selve flytningen.
//
// Rækkefølgen i drejebogen (spec-s4-struktur-2026-09-24.md, afsnit
// "Rækkefølgen ved skiftet"): "Afslut sæson" → DENNE sammenlægning (trin 2) →
// D4-puljerne E-H pensioneres (spor A2, IKKE denne fil) → AI-reconcile → S4-
// kalender → "Start næste sæson". Dette script udfører KUN trin 2.
//
// Default = DRY-RUN (read-only): printer fordelingen + skriver
// docs/snapshots/4592/dry-run-<dato>.json (input til --apply) og -<dato>.md
// (læsbar for ejeren).
//
// --apply --snapshot=<path> --owner-go (IKKE kørt af denne bølge-lane — ejer-
// gated cutover-dagen, som compressPyramidS3.js): kræver sæson 'completed',
// læser KUN den frosne liste, springer hold der allerede står i mål-puljen
// over (idempotent), skriver snapshot + restore-SQL, opdaterer
// teams.division/league_division_id, sender netto-notifikationer via
// notifyTeamOwner, kører reconcileAiTeamsForPool for alle puljer, verificerer.
//
//   node scripts/mergeD4IntoD3S4.js                                    # dry-run
//   node scripts/mergeD4IntoD3S4.js --season=<uuid>                    # anden kilde-sæson
//   node scripts/mergeD4IntoD3S4.js --apply --snapshot=<path> --owner-go  # EJER-GATED
//   railway run --service CyclingZone -- node scripts/mergeD4IntoD3S4.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

import { fetchAllRows } from "../lib/supabasePagination.js";
import { planD4Merge, isD4MergeEligible, MAX_MERGE_MANAGERS } from "../lib/d4MergeS4.js";
import { buildCountbackByTeam } from "../lib/pyramidCompression.js";
import { reconcileAiTeamsForPool } from "../lib/aiTeamGenerator.js";
import { notifyTeamOwner } from "../lib/notificationService.js";
import { repoRoot } from "./lib/repoRoot.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../.env"), quiet: true });

const arg = (n, d) => {
  const hit = process.argv.find((a) => a.startsWith(`--${n}=`));
  if (hit) return hit.split("=").slice(1).join("=");
  if (process.argv.includes(`--${n}`)) return true;
  return d;
};

const SEASON_ARG = arg("season", null);
const APPLY = !!arg("apply", false);
const SNAPSHOT_ARG = arg("snapshot", null);
const OWNER_GO = !!arg("owner-go", false);
const FORCE = !!arg("force", false);

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ SUPABASE_URL / SUPABASE_SERVICE_KEY mangler (kør via `railway run` eller backend/.env).");
  process.exit(1);
}
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

const pad = (s, w) => String(s ?? "").padEnd(w);
const nowStamp = () => new Date().toISOString();
const dateStamp = () => new Date().toISOString().slice(0, 10);

console.log(`\n${"═".repeat(84)}`);
console.log(`S3→S4 D4→D3 SAMMENLÆGNING (#5641/#4592 A1) ${APPLY ? "🔴 APPLY (skriver til prod)" : "🟢 DRY-RUN (read-only)"}`);
console.log("═".repeat(84));

if (APPLY && !SNAPSHOT_ARG) {
  console.error(`\n❌ --apply kræver --snapshot=<path til docs/snapshots/4592/dry-run-<dato>.json>. Fordelingen genberegnes IKKE ved selve flytningen — apply anvender KUN den frosne, ejer-godkendte liste.`);
  process.exit(1);
}
if (APPLY && !OWNER_GO) {
  console.error(`\n❌ --apply kræver --owner-go (eksplicit ejer-godkendelse pr. prod-skridt, se spec + hard rules) — ikke sat.`);
  process.exit(1);
}

// ─── 1 · Kilde-sæson (S3) ─────────────────────────────────────────────────────

let season;
if (SEASON_ARG) {
  const { data, error } = await supabase.from("seasons").select("id, number, status").eq("id", SEASON_ARG).maybeSingle();
  if (error || !data) { console.error(`❌ Kunne ikke læse sæson ${SEASON_ARG}: ${error?.message || "ikke fundet"}`); process.exit(1); }
  season = data;
} else if (APPLY) {
  // Apply uden --season: brug snapshottets egen kilde-sæson (samme mønster som
  // compressPyramidS3.js — undgår at gætte "den aktive sæson" i vinduet lige
  // efter "Afslut sæson", hvor der kortvarigt ikke findes nogen aktiv sæson).
  const snap = JSON.parse(readFileSync(SNAPSHOT_ARG, "utf8"));
  const { data, error } = await supabase.from("seasons").select("id, number, status").eq("id", snap.source_season.id).maybeSingle();
  if (error || !data) { console.error(`❌ Kunne ikke læse snapshottets kilde-sæson ${snap.source_season?.id}: ${error?.message || "ikke fundet"}`); process.exit(1); }
  season = data;
} else {
  const { data, error } = await supabase.from("seasons").select("id, number, status")
    .order("number", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) { console.error(`❌ Ingen sæson fundet (${error?.message || "0 rækker"}) — angiv --season=<uuid> eksplicit.`); process.exit(1); }
  season = data;
}
console.log(`Kilde-sæson: #${season.number} (status='${season.status}', id=${season.id})`);

// Apply-guard: flytningen må kun ske EFTER "Afslut sæson" (season.status =
// 'completed'), aldrig mens sæsonen stadig er 'active' — ville rive hold ud af
// igangværende S3-løb midt i deres pulje (mirror af compressPyramid*.js).
if (APPLY && season.status !== "completed" && !FORCE) {
  console.error(`\n❌ --apply kræver at sæson #${season.number} er 'completed' ("Afslut sæson" først). Brug --force hvis du ved hvad du gør.`);
  process.exit(1);
}

// ─── 2 · APPLY: brug det frosne, ejer-godkendte snapshot — INGEN live-genberegning ──

if (APPLY) {
  const snap = JSON.parse(readFileSync(SNAPSHOT_ARG, "utf8"));
  if (snap.source_season?.id !== season.id) {
    console.error(`❌ Snapshottets kilde-sæson (${snap.source_season?.id}) matcher ikke sæson #${season.number} (${season.id}) — forkert fil? Brug --force for at overstyre.`);
    if (!FORCE) process.exit(1);
  }
  console.log(`\n📄 Anvender frosset snapshot: ${SNAPSHOT_ARG} (genereret ${snap.generated_at})`);

  const assignments = snap.assignments;
  // Idempotent: kun hold der reelt skal flytte pulje udføres — allerede-
  // korrekte hold ('unchanged'-movement fra planD4Merge) springes over.
  const changes = assignments.filter((a) => a.movement !== "unchanged");
  console.log(`🔴 APPLY: ${changes.length} hold skal flyttes (${assignments.length - changes.length} står allerede rigtigt — idempotent re-run giver 0 her).`);

  const { data: pools, error: poolErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index");
  if (poolErr) { console.error(`❌ league_divisions: ${poolErr.message}`); process.exit(1); }
  const poolLabel = new Map(pools.map((p) => [p.id, p.label ?? `T${p.tier}#${p.pool_index}`]));
  const d3PoolIds = new Set(pools.filter((p) => p.tier === 3).map((p) => p.id));

  const allTeamsBefore = await fetchAllRows(() =>
    supabase.from("teams").select("id, name, division, league_division_id").order("id"));

  const snapDirApply = join(__dirname, "snapshots");
  mkdirSync(snapDirApply, { recursive: true });
  const applyStamp = nowStamp().replace(/[:.]/g, "-");
  const preState = allTeamsBefore.map((t) => ({ id: t.id, name: t.name, division: t.division, league_division_id: t.league_division_id }));
  const snapPath = join(snapDirApply, `merge-d4-s4-${applyStamp}.json`);
  writeFileSync(snapPath, JSON.stringify({ from_season: season.id, taken_at: applyStamp, source_snapshot: SNAPSHOT_ARG, teams: preState }, null, 2));
  const restoreSql = preState.map((t) =>
    `update teams set division=${t.division ?? "null"}, league_division_id=${t.league_division_id ? `'${t.league_division_id}'` : "null"} where id='${t.id}';`,
  ).join("\n");
  const restorePath = join(snapDirApply, `merge-d4-s4-${applyStamp}-restore.sql`);
  writeFileSync(restorePath, `-- #5641/#4592 rollback: genskriv divisions-tilstand som FØR D4→D3-sammenlægningen (${applyStamp})\nbegin;\n${restoreSql}\ncommit;\n`);
  console.log(`  📸 Snapshot: ${snapPath}\n  📸 Restore-SQL: ${restorePath}`);

  let updated = 0, skipped = 0;
  const currentById = new Map(allTeamsBefore.map((t) => [t.id, t]));
  for (const a of changes) {
    const current = currentById.get(a.teamId);
    if (current && current.league_division_id === a.toPoolId) {
      skipped += 1; // allerede rykket siden snapshottet blev frosset — idempotent no-op
      continue;
    }
    const { error } = await supabase.from("teams")
      .update({ division: 3, league_division_id: a.toPoolId })
      .eq("id", a.teamId);
    if (error) {
      console.error(`❌ UPDATE fejlede for ${a.name} (${a.teamId}): ${error.message} — STOP. Rollback: ${restorePath}`);
      process.exit(1);
    }
    updated += 1;
  }
  console.log(`  ✅ ${updated} hold flyttet (${skipped} sprunget over — allerede rykket siden snapshottet).`);

  let notified = 0, notifyFailed = 0;
  for (const a of changes.filter((x) => x.movement === "promoted")) {
    try {
      await notifyTeamOwner({
        supabase,
        teamId: a.teamId,
        type: "board_update",
        title: "Promoted! 🎉",
        message: `Congratulations! Your team moves up to Division 3.`,
        relatedId: season.id,
        metadata: { titleCode: "notif.divisionPromoted.title", titleParams: {}, messageCode: "notif.divisionPromoted.message", messageParams: { division: 3 } },
      });
      notified += 1;
    } catch (err) {
      notifyFailed += 1;
      console.error(`  ⚠️ notifikation fejlede for ${a.name}: ${err?.message || err}`);
    }
  }
  console.log(`  🔔 ${notified} notifikationer sendt til D4→D3-oprykkere (${notifyFailed} fejlede — fortsætter, notifikationer er additive).`);

  for (const p of pools) {
    await reconcileAiTeamsForPool({ supabase, poolId: p.id });
  }
  console.log(`  🤖 reconcileAiTeamsForPool kørt for ${pools.length} puljer.`);

  const after = await fetchAllRows(() =>
    supabase.from("teams").select("id, division, league_division_id").order("id"));
  const afterById = new Map(after.map((t) => [t.id, t]));
  let wrong = 0;
  for (const a of assignments) {
    const t = afterById.get(a.teamId);
    if (!t || t.division !== 3 || t.league_division_id !== a.toPoolId) {
      wrong += 1;
      console.error(`  ❌ ${a.name}: forventet D3/${a.toPoolId}, fandt D${t?.division}/${t?.league_division_id}`);
    }
  }
  const fillByPool = new Map();
  for (const t of after) {
    if (t.league_division_id && d3PoolIds.has(t.league_division_id)) {
      fillByPool.set(t.league_division_id, (fillByPool.get(t.league_division_id) || 0) + 1);
    }
  }
  console.log(`\n── VERIFIKATION ──`);
  console.log(`  Placeringer korrekte: ${assignments.length - wrong}/${assignments.length}`);
  for (const p of pools.filter((x) => x.tier === 3)) {
    console.log(`  D3 ${pad(poolLabel.get(p.id), 12)} ${String(fillByPool.get(p.id) || 0).padStart(2)} hold`);
  }
  if (wrong > 0) {
    console.error(`\n❌ ${wrong} fejlplaceringer — undersøg FØR spor A2/A3. Rollback: ${restorePath}`);
    process.exit(1);
  }
  console.log(`\n✅ Sammenlægning gennemført og verificeret. NÆSTE SKRIDT: spor A2 (D4-puljerne E-H pensioneres), derefter AI-reconcile + S4-kalender.`);
  process.exit(0);
}

// ─── 3 · DRY-RUN: læs D3+D4-hold, planlæg, skriv frossen snapshot ────────────

const allTeams = await fetchAllRows(() =>
  supabase.from("teams")
    .select("id, name, division, league_division_id, is_ai, is_frozen, is_test_account, is_bank, parked_at")
    .order("id"));

const eligible = allTeams.filter(isD4MergeEligible);
const d3d4Total = allTeams.filter((t) => t.division === 3 || t.division === 4).length;

const standings = await fetchAllRows(() =>
  supabase.from("season_standings")
    .select("team_id, division, league_division_id, total_points, stage_wins, gc_wins")
    .eq("season_id", season.id)
    .order("team_id"));

const countbackRows = await fetchAllRows(() =>
  supabase.from("race_results")
    .select("team_id, result_type, rank, races!inner(season_id)")
    .eq("races.season_id", season.id)
    .not("team_id", "is", null)
    .order("id"));
const countback = buildCountbackByTeam(countbackRows);

const { data: pools, error: poolErr } = await supabase
  .from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index");
if (poolErr) { console.error(`❌ league_divisions: ${poolErr.message}`); process.exit(1); }
const poolLabel = new Map(pools.map((p) => [p.id, p.label ?? `T${p.tier}#${p.pool_index}`]));
const d3Pools = pools.filter((p) => p.tier === 3);

console.log(`Hold i D3+D4 (total, inkl. AI/parkeret/frosset/test): ${d3d4Total} · eligible til sammenlægning: ${eligible.length}/${MAX_MERGE_MANAGERS} · D3-puljer: ${d3Pools.length}`);

const parkedInD3D4 = allTeams.filter((t) => (t.division === 3 || t.division === 4) && t.parked_at != null).length;
const aiInD3D4 = allTeams.filter((t) => (t.division === 3 || t.division === 4) && t.is_ai === true).length;
if (parkedInD3D4) console.log(`ℹ️  ${parkedInD3D4} parkeret hold i D3/D4 udelukket (hentes kun tilbage via comeback-flowet, spor A4).`);
console.log(`ℹ️  ${aiInD3D4} AI-hold i D3/D4 udelukket (fylder D4 A-D, spor A2 — ikke denne sammenlægning).`);

let plan;
try {
  plan = planD4Merge({ teams: eligible, standings, countback, d3Pools });
} catch (err) {
  console.error(`❌ ${err.message}`);
  process.exit(1);
}
const { assignments, byPool } = plan;

const missing = assignments.filter((a) => a.totalPoints === 0 && !standings.some((s) => s.team_id === a.teamId));
if (missing.length) {
  console.warn(`⚠️  ${missing.length} eligible hold uden season_standings-række for S3 (rangeret som 0 point): ${missing.map((m) => m.name).join(", ")}`);
}

const promoted = assignments.filter((a) => a.movement === "promoted");
const poolMoves = assignments.filter((a) => a.movement === "pool-move");
const unchanged = assignments.filter((a) => a.movement === "unchanged");

console.log(`\n── D4→D3-OPRYKKERE + D3-PULJESKIFT (rank · hold · S3-point · fra → til) ──`);
for (const a of assignments) {
  const tag = { promoted: "⬆ D4→D3", "pool-move": "↔ pulje", unchanged: "  =    " }[a.movement];
  console.log(`  ${String(a.rank).padStart(3)}  ${pad(a.name, 28)} ${String(a.totalPoints).padStart(6)}p  D${a.fromTier ?? "?"}/${pad(poolLabel.get(a.fromPoolId) ?? "—", 10)} → D3/${pad(poolLabel.get(a.toPoolId), 10)} ${tag}`);
}
console.log(`\n  Netto: ${promoted.length} D4→D3-oprykkere · ${poolMoves.length} pulje-skift inden for D3 · ${unchanged.length} uændret`);

console.log(`\n── PULJE-FYLD D3 EFTER SAMMENLÆGNING ──`);
for (const p of d3Pools) {
  const n = byPool.get(p.id) || 0;
  const flag = n > 24 ? "  ⚠️ OVER 24" : "";
  console.log(`  D3 ${pad(poolLabel.get(p.id), 12)} ${String(n).padStart(2)} ægte${flag}`);
}
const over = [...byPool.entries()].filter(([, n]) => n > 24);
if (over.length) {
  console.error(`❌ ${over.length} D3-pulje(r) med over 24 ægte hold — fordelings-fejl, afbryder.`);
  process.exit(1);
}
const points = assignments.map((a) => a.totalPoints);
const pointSpread = points.length ? `${Math.min(...points)}–${Math.max(...points)}` : "—";
console.log(`\n  Point-spænd blandt de sammenlagte hold: ${pointSpread}`);

// ─── 4 · Skriv dry-run-snapshot (input til senere --apply) ───────────────────

const snapshot = {
  issue: 5641,
  parent_issue: 4592,
  generated_at: nowStamp(),
  mode: "dry-run",
  source_season: { id: season.id, number: season.number, status: season.status },
  ranking_source: "season_standings.total_points for S3 + #3036-countback secondary tiebreak (rankTeamsGlobally)",
  eligible_count: eligible.length,
  max_merge_managers: MAX_MERGE_MANAGERS,
  d3_pool_ids: d3Pools.map((p) => p.id),
  assignments,
  movement_summary: { promoted: promoted.length, poolMoves: poolMoves.length, unchanged: unchanged.length },
  pool_fill: [...byPool.entries()].map(([poolId, count]) => ({ poolId, label: poolLabel.get(poolId), realManagerCount: count })),
  point_spread: pointSpread,
};

const snapDir = join(repoRoot(), "docs", "snapshots", "4592");
mkdirSync(snapDir, { recursive: true });
const stamp = dateStamp();
const jsonPath = join(snapDir, `d4-merge-dry-run-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2));

const mdLines = [];
mdLines.push(`# S3→S4 D4→D3 sammenlægning — dry-run ${stamp} (#5641/#4592 A1)`);
mdLines.push("");
mdLines.push(`Kilde-sæson: #${season.number} (status='${season.status}'). Rangeringskilde: S3 season_standings.total_points, sekundær tiebreak = #3036-countback (rankTeamsGlobally).`);
mdLines.push("");
mdLines.push(`**⚠️ Denne JSON er input til \`--apply --snapshot=${jsonPath} --owner-go\`.** Regenerér listen så tæt på cutover som muligt (efter "Afslut sæson" er kørt) — apply anvender PRÆCIS denne fordeling.`);
mdLines.push("");
mdLines.push(`## Managere pr. D3-pulje (før → efter)`);
mdLines.push("");
mdLines.push(`| Pulje | Efter |`);
mdLines.push(`|---|---|`);
for (const p of d3Pools) mdLines.push(`| ${poolLabel.get(p.id)} | ${byPool.get(p.id) || 0} |`);
mdLines.push("");
mdLines.push(`## Netto-bevægelse`);
mdLines.push(`- D4→D3-oprykkere: ${promoted.length} · Pulje-skift inden for D3: ${poolMoves.length} · Uændret: ${unchanged.length}`);
mdLines.push(`- Point-spænd: ${pointSpread}`);
mdLines.push("");
mdLines.push(`## Drejebogs-instruktion (IKKE udført af dette script)`);
mdLines.push(`1. Klik "Afslut sæson" → sæson #${season.number} bliver 'completed'.`);
mdLines.push(`2. Kør \`node scripts/mergeD4IntoD3S4.js --apply --snapshot=${jsonPath} --owner-go\` (eller en senere, friskere dry-run-JSON — regenerér og få ny godkendelse hvis der er gået tid siden denne fil blev skrevet).`);
mdLines.push(`3. Spor A2: D4-puljerne E-H pensioneres (separat script, ikke bygget i #5641).`);
mdLines.push(`4. AI-reconcile alle puljer, derefter S4-kalenderen (spor A3).`);
const mdPath = join(snapDir, `d4-merge-dry-run-${stamp}.md`);
writeFileSync(mdPath, mdLines.join("\n") + "\n");

console.log(`\n📄 Snapshot skrevet: ${jsonPath}`);
console.log(`📄 Opsummering skrevet: ${mdPath}`);
console.log(`\n🟢 Dry-run færdig — ingen writes.`);
process.exit(0);
