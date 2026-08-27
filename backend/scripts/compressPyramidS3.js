#!/usr/bin/env node
// #3901 · Pyramide-komprimering S2→S3, D1-INKLUDERET (ejer-låst 18/8, KS3).
//
// S1→S2 (scripts/compressPyramid.js, #2851) rørte bevidst ikke Division 1 —
// D1 var 100% AI. S2→S3 gentager samme globale komprimering, men denne gang
// INKLUSIVE D1: ejer-beslutning 18/8 (dokumenteret på #3901) siger eksplicit
// "gentag den globale komprimering S2->S3 INKLUSIVE D1. Rangliste = den
// synlige globale rangliste (standings?tab=global)."
//
// TO forskelle fra compressPyramid.js, begge ejer-krævede:
//
//   1. RANGERINGSKILDE: global_rank_mv (samme matview som
//      frontend/src/hooks/useGlobalRank.js læser til cyclingzone.org/
//      standings?tab=global) i stedet for den afsluttede sæsons
//      season_standings.total_points. global_points = bankede point fra
//      TIDLIGERE sæsoner (halveret ved hvert skifte) + denne sæsons live
//      season_standings.total_points — IKKE det samme tal som S1→S2 brugte.
//      Countback-kæden (#3036) ligger stadig oveni som sekundær, deterministisk
//      tiebreak (se rankTeamsByGlobalRank i pyramidCompression.js) — den
//      ÆNDRER ikke hvad spillerne ser (global_rank bevares i output), den
//      afgør kun VORES pulje-fordeling når to hold reelt er lige.
//   2. D1 INKLUDERET: distributeCompression({ d1Capacity: 24, ... }) — top 24
//      rangerede hold flytter til D1's ene pulje. AI-holdene der sad der viger
//      (reconcileAiTeamsForPool efterregulerer til POOL_TARGET_SIZE=0 AI når
//      puljen har 24 ægte hold — uændret mekanik fra #1688).
//
// ⚠️⚠️ TIMING — TO MODSATRETTEDE KRAV, LØST VIA FROSSET SNAPSHOT ⚠️⚠️
// (a) DIVISIONS-FLYTNINGEN skal ske EFTER "Afslut sæson" (S2 → 'completed'),
//     PRÆCIS som S1→S2 — at flytte hold mens S2 stadig kører ville rive dem ud
//     af deres igangværende puljes resterende løb.
// (b) RANGERINGSKILDEN (global_rank_mv) kan KUN beregne korrekt season_points
//     mens sæsonen er 'active' — dens season_points-CTE slår op på
//     status='active' (database/2026-08-03-...-global-rank-humans-only.sql:
//     67-69). Er sæsonen allerede 'completed', findes ingen aktiv sæson, og
//     season_points falder STILLE til 0 for alle (COALESCE-fallback, ingen
//     fejl) — en fordeling genberegnet i det vindue ville være forkert uden at
//     sige det.
// LØSNING: dry-run (denne fil, default-mode) beregner og FRYSER fordelingen
// som JSON, kørt MENS S2 stadig er 'active' — gerne gentaget helt op til
// sidste S2-løb (samme "listen skal regenereres efter sidste løb"-mønster som
// S1→S2's drejebog). --apply LÆSER den frosne, ejer-godkendte JSON
// (--snapshot=<path>, obligatorisk — ingen stille auto-pick) og skriver KUN
// teams.division/league_division_id ud fra den — ingen live-genberegning af
// ranglisten ved selve flytningen. --apply kræver desuden at sæsonen ER
// 'completed' (mirror af compressPyramid.js's guard), så flytningen kan ALDRIG
// ramme en stadig-aktiv sæson ved en fejl.
//
// Default = DRY-RUN (read-only): printer den navngivne top-24 → D1-liste,
// pulje-fordelinger for D2/D3/D4, AI-hold der viger/fyldes, og tie-situationer
// ved cutlines (24/25, 72/73, 168/169) hvor global_rank_mv's egen RANK() ville
// dele rang. Skriver desuden docs/snapshots/3901/dry-run-<dato>.json +
// -<dato>.md — SIDSTNÆVNTE JSON er input til --apply.
//
// --apply muterer (KØRES IKKE AF Claude — ejer-gated cutover-dagen 23/8):
// snapshot → teams-UPDATEs → NETTO-notifikationer → reconcileAiTeamsForPool
// pr. pulje → verifikation. Idempotent re-run: samme frosne snapshot
// genanvendt giver 0 nye UPDATEs anden gang.
//
//   node scripts/compressPyramidS3.js                          # dry-run
//   node scripts/compressPyramidS3.js --season=<uuid>           # anden kilde-sæson
//   node scripts/compressPyramidS3.js --apply --snapshot=<path> # EJER-GATED, se ovenfor
//   railway run --service CyclingZone -- node scripts/compressPyramidS3.js

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { mkdirSync, writeFileSync, readFileSync } from "node:fs";

import { fetchAllRows } from "../lib/supabasePagination.js";
import {
  rankTeamsByGlobalRank,
  distributeCompression,
  summarizeMovements,
  buildCountbackByTeam,
} from "../lib/pyramidCompression.js";
import { SEASON_END_SKIP_MOVEMENT_FLAG_KEY } from "../lib/seasonEndMovementFlag.js";
import { targetAiCountForPool, reconcileAiTeamsForPool } from "../lib/aiTeamGenerator.js";
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
const FORCE = !!arg("force", false);
const D1_CAPACITY = Number(arg("d1", 24));
const D2_CAPACITY = Number(arg("d2", 48));
const D3_CAPACITY = Number(arg("d3", 96));
// #4172: ingen default paa 2 - udelades flaget, fordeler distributeCompression over ALLE
// D4-puljer (S3 blev startet med 2 og efterlod pulje C-H tomme med 156 uafviklelige loeb).
const D4_POOL_COUNT_ARG = arg("d4pools", null);
const D4_POOL_COUNT = D4_POOL_COUNT_ARG == null ? null : Number(D4_POOL_COUNT_ARG);

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
console.log(`S2→S3 PYRAMIDE-KOMPRIMERING MED D1 (#3901) ${APPLY ? "🔴 APPLY (skriver til prod)" : "🟢 DRY-RUN (read-only)"}`);
console.log("═".repeat(84));

if (APPLY && !SNAPSHOT_ARG) {
  console.error(`\n❌ --apply kræver --snapshot=<path til docs/snapshots/3901/dry-run-<dato>.json>. Ranglisten genberegnes IKKE ved selve flytningen (global_rank_mv er ugyldig når sæsonen ikke længere er 'active', se filhovedets timing-note) — apply anvender KUN den frosne, ejer-godkendte liste.`);
  process.exit(1);
}

// ─── 1 · Kilde-sæson ─────────────────────────────────────────────────────────

let season;
if (SEASON_ARG) {
  const { data, error } = await supabase.from("seasons").select("id, number, status").eq("id", SEASON_ARG).maybeSingle();
  if (error || !data) { console.error(`❌ Kunne ikke læse sæson ${SEASON_ARG}: ${error?.message || "ikke fundet"}`); process.exit(1); }
  season = data;
} else if (APPLY) {
  // Apply uden --season: brug snapshottets egen kilde-sæson (undgår at gætte
  // "den aktive sæson", som pr. definition ofte er forkert lige efter "Afslut
  // sæson" — der er kortvarigt INGEN aktiv sæson, se filhovedet).
  const snap = JSON.parse(readFileSync(SNAPSHOT_ARG, "utf8"));
  const { data, error } = await supabase.from("seasons").select("id, number, status").eq("id", snap.source_season.id).maybeSingle();
  if (error || !data) { console.error(`❌ Kunne ikke læse snapshottets kilde-sæson ${snap.source_season.id}: ${error?.message || "ikke fundet"}`); process.exit(1); }
  season = data;
} else {
  const { data, error } = await supabase.from("seasons").select("id, number, status").eq("status", "active").order("number", { ascending: false }).limit(1).maybeSingle();
  if (error || !data) { console.error(`❌ Ingen aktiv sæson fundet (${error?.message || "0 rækker"}) — angiv --season=<uuid> eksplicit.`); process.exit(1); }
  season = data;
}
console.log(`Kilde-sæson: #${season.number} (status='${season.status}', id=${season.id})`);

// Apply-guard: mirror af compressPyramid.js — flytningen må kun ske EFTER
// "Afslut sæson" (season.status='completed'), ALDRIG mens sæsonen er 'active'
// (ville rive hold ud af igangværende S2-løb midt i deres pulje).
if (APPLY && season.status !== "completed" && !FORCE) {
  console.error(`\n❌ --apply kræver at sæson #${season.number} er 'completed' ("Afslut sæson" først). At flytte hold mens sæsonen stadig er 'active' ville forstyrre igangværende S2-løb. Brug --force hvis du ved hvad du gør.`);
  process.exit(1);
}

const { data: flagRow } = await supabase
  .from("app_config").select("value").eq("key", SEASON_END_SKIP_MOVEMENT_FLAG_KEY).maybeSingle();
const flagOn = flagRow?.value === true || flagRow?.value === "on";
console.log(`Motor-flag ${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}: '${flagOn ? "on" : "off"}'`);
if (APPLY && !flagOn) {
  console.error(`\n❌ --apply kræver ${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}='on' (sættes FØR "Afslut sæson" — motorens egen op/nedrykning skal springes over, denne komprimering ER flytningen). Sæt flaget og kør "Afslut sæson" om igen-flowet, ELLER — hvis "Afslut sæson" allerede kørte med flaget off — undersøg om motoren allerede har flyttet hold FØR du fortsætter.`);
  process.exit(1);
}
if (!APPLY && !flagOn) {
  console.log(`ℹ️  Flaget står 'off' — helt normalt for en dry-run kørt i god tid før cutover. Skal sættes 'on' FØR selve "Afslut sæson" (se drejebogs-instruktion i bunden af dette output).`);
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
  const { promoted, relegated } = summarizeMovements(assignments);
  const changes = assignments.filter((a) => a.toTier !== a.fromTier || a.toPoolId !== a.fromPoolId);
  console.log(`🔴 APPLY: ${changes.length} hold skal flyttes (${assignments.length - changes.length} står rigtigt — idempotent re-run giver 0 her).`);

  const { data: pools, error: poolErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label").order("tier").order("pool_index");
  if (poolErr) { console.error(`❌ league_divisions: ${poolErr.message}`); process.exit(1); }
  const poolLabel = new Map(pools.map((p) => [p.id, p.label ?? `T${p.tier}#${p.pool_index}`]));
  const byPoolFromSnapshot = new Map();
  for (const a of assignments) byPoolFromSnapshot.set(a.toPoolId, (byPoolFromSnapshot.get(a.toPoolId) || 0) + 1);

  const allTeamsBefore = await fetchAllRows(() =>
    supabase.from("teams").select("id, name, division, league_division_id").order("id"));

  const snapDirApply = join(__dirname, "snapshots");
  mkdirSync(snapDirApply, { recursive: true });
  const applyStamp = nowStamp().replace(/[:.]/g, "-");
  const preState = allTeamsBefore.map((t) => ({ id: t.id, name: t.name, division: t.division, league_division_id: t.league_division_id }));
  const snapPath = join(snapDirApply, `compress-pyramid-s3-${applyStamp}.json`);
  writeFileSync(snapPath, JSON.stringify({ from_season: season.id, taken_at: applyStamp, source_snapshot: SNAPSHOT_ARG, teams: preState }, null, 2));
  const restoreSql = preState.map((t) =>
    `update teams set division=${t.division ?? "null"}, league_division_id=${t.league_division_id ? `'${t.league_division_id}'` : "null"} where id='${t.id}';`,
  ).join("\n");
  const restorePath = join(snapDirApply, `compress-pyramid-s3-${applyStamp}-restore.sql`);
  writeFileSync(restorePath, `-- #3901 rollback: genskriv divisions-tilstand som FØR S2→S3-komprimeringen (${applyStamp})\nbegin;\n${restoreSql}\ncommit;\n`);
  console.log(`  📸 Snapshot: ${snapPath}\n  📸 Restore-SQL: ${restorePath}`);

  let updated = 0;
  for (const a of changes) {
    const { error } = await supabase.from("teams")
      .update({ division: a.toTier, league_division_id: a.toPoolId })
      .eq("id", a.teamId);
    if (error) {
      console.error(`❌ UPDATE fejlede for ${a.name} (${a.teamId}): ${error.message} — STOP. Rollback: ${restorePath}`);
      process.exit(1);
    }
    updated += 1;
  }
  console.log(`  ✅ ${updated} hold flyttet.`);

  let notified = 0, notifyFailed = 0;
  for (const a of [...promoted, ...relegated]) {
    const isUp = a.movement === "promoted";
    try {
      await notifyTeamOwner({
        supabase,
        teamId: a.teamId,
        type: "board_update",
        title: isUp ? "Promoted! 🎉" : "Relegation",
        message: isUp
          ? `Congratulations! Your team moves up to Division ${a.toTier}.`
          : `Your team drops to Division ${a.toTier}.`,
        relatedId: season.id,
        metadata: isUp
          ? { titleCode: "notif.divisionPromoted.title", titleParams: {}, messageCode: "notif.divisionPromoted.message", messageParams: { division: a.toTier } }
          : { titleCode: "notif.divisionRelegated.title", titleParams: {}, messageCode: "notif.divisionRelegated.message", messageParams: { division: a.toTier } },
      });
      notified += 1;
    } catch (err) {
      notifyFailed += 1;
      console.error(`  ⚠️ notifikation fejlede for ${a.name}: ${err?.message || err}`);
    }
  }
  console.log(`  🔔 ${notified} netto-notifikationer sendt (${notifyFailed} fejlede — fortsætter, notifikationer er additive).`);

  for (const p of pools) {
    await reconcileAiTeamsForPool({ supabase, poolId: p.id });
  }
  console.log(`  🤖 reconcileAiTeamsForPool kørt for ${pools.length} puljer (inkl. D1).`);

  const after = await fetchAllRows(() =>
    supabase.from("teams").select("id, division, league_division_id").order("id"));
  let wrong = 0;
  const afterById = new Map(after.map((t) => [t.id, t]));
  for (const a of assignments) {
    const t = afterById.get(a.teamId);
    if (!t || t.division !== a.toTier || t.league_division_id !== a.toPoolId) {
      wrong += 1;
      console.error(`  ❌ ${a.name}: forventet D${a.toTier}/${a.toPoolId}, fandt D${t?.division}/${t?.league_division_id}`);
    }
  }
  const fillByPool = new Map();
  for (const t of after) {
    if (!t.league_division_id) continue;
    fillByPool.set(t.league_division_id, (fillByPool.get(t.league_division_id) || 0) + 1);
  }
  console.log(`\n── VERIFIKATION ──`);
  console.log(`  Placeringer korrekte: ${assignments.length - wrong}/${assignments.length}`);
  for (const p of pools) {
    const total = fillByPool.get(p.id) || 0;
    const humans = byPoolFromSnapshot.get(p.id) || 0;
    const flag = humans > 0 && total !== 24 ? "  ⚠️ ikke 24" : "";
    if (total > 0) console.log(`  D${p.tier} ${pad(poolLabel.get(p.id), 12)} ${String(total).padStart(2)} hold (${humans} ægte)${flag}`);
  }
  if (wrong > 0) {
    console.error(`\n❌ ${wrong} fejlplaceringer — undersøg FØR transitionen. Rollback: ${restorePath}`);
    process.exit(1);
  }
  console.log(`\n✅ Komprimering gennemført og verificeret. NÆSTE SKRIDT: kør transitionen, og sæt ${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}='off' EFTER — ikke før.`);
  process.exit(0);
}

// ─── 3 · DRY-RUN: live rangering + fordeling (kun læsning) ──────────────────

const allTeams = await fetchAllRows(() =>
  supabase.from("teams")
    .select("id, name, division, league_division_id, is_ai, is_frozen, is_test_account, is_bank")
    .order("id"));

const managerTeams = allTeams.filter((t) =>
  t.is_ai !== true && t.is_bank !== true && t.is_frozen !== true && t.is_test_account !== true);

// Samme kilde som frontend/src/hooks/useGlobalRank.js (cyclingzone.org/
// standings?tab=global) — ÉN forespørgsel, samme kolonner, samme order().
const globalRankRows = await fetchAllRows(() =>
  supabase.from("global_rank_mv").select("*")
    .order("global_rank", { ascending: true, nullsFirst: false }));

// #3036-countback, scopet til kilde-sæsonens race_results (samme mønster som
// compressPyramid.js) — sekundær tiebreak oveni global_points, se filhoved.
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

console.log(`Managerhold: ${managerTeams.length} af ${allTeams.length} · global_rank_mv-rækker: ${globalRankRows.length} · countback-rækker: ${countbackRows.length} · puljer: ${pools.length}`);

const ranked = rankTeamsByGlobalRank({ teams: managerTeams, globalRankRows, countback });
const { assignments, byPool } = distributeCompression(ranked, pools, {
  d1Capacity: D1_CAPACITY, d2Capacity: D2_CAPACITY, d3Capacity: D3_CAPACITY, d4PoolCount: D4_POOL_COUNT,
});
const { promoted, relegated, poolMoves, unchanged } = summarizeMovements(assignments);

const missing = ranked.filter((r) => r.missingGlobalRank);
if (missing.length) {
  console.warn(`⚠️  ${missing.length} managerhold uden global_rank_mv-række (rangeret som 0 point): ${missing.map((m) => m.name).join(", ")}`);
}
const inactive = ranked.filter((r) => !r.missingGlobalRank && !r.activeRecent);
if (inactive.length) {
  console.warn(`⚠️  ${inactive.length} managerhold er 'inaktive' i UI'et (skjult på /standings?tab=global, active_recent=false) men BEHOLDES i komprimeringen (alle managerhold skal have en plads): ${inactive.map((m) => `${m.name} (${m.globalPoints}p, rank ${m.rank})`).join(", ")}`);
}

console.log(`\n── NAVNGIVEN TOP ${D1_CAPACITY} → DIVISION 1 (ejer-godkendelse) ──`);
for (const a of assignments.filter((x) => x.toTier === 1)) {
  console.log(`  ${String(a.rank).padStart(3)}  ${pad(a.name, 28)} ${String(a.globalPoints).padStart(8)} gp  synlig rang ${pad(a.visibleGlobalRank ?? "—", 4)}  D${a.fromTier ?? "?"}/${pad(poolLabel.get(a.fromPoolId) ?? "—", 10)} → D1  ${a.movement === "promoted" ? "⬆ OP" : a.movement}`);
}

console.log(`\n── PULJE-FORDELING D2/D3/D4 (rank · hold · global point · fra → til) ──`);
for (const a of assignments.filter((x) => x.toTier !== 1)) {
  const tag = { promoted: "⬆ OP ", relegated: "⬇ NED", "pool-move": "↔ pul", unchanged: "  =  " }[a.movement];
  console.log(`  ${String(a.rank).padStart(3)}  ${pad(a.name, 28)} ${String(a.globalPoints).padStart(8)} gp  D${a.fromTier ?? "?"}/${pad(poolLabel.get(a.fromPoolId) ?? "—", 10)} → D${a.toTier}/${pad(poolLabel.get(a.toPoolId), 10)} ${tag}`);
}
console.log(`\n  Netto: ${promoted.length} op · ${relegated.length} ned · ${poolMoves.length} pulje-skift (samme division) · ${unchanged.length} uændret`);

// ─── 4 · Cutline- og tie-kontekst ────────────────────────────────────────────
// En "tie-situation" ved en cutline = de to hold på hver side af grænsen har
// SAMME visibleGlobalRank (global_rank_mv's egen RANK() ville have vist dem
// delt) — det er her countback-tiebreaken (#3036) reelt afgør noget spilleren
// kunne opfatte som vilkårligt uden forklaringen.
const cutlines = [D1_CAPACITY, D1_CAPACITY + D2_CAPACITY, D1_CAPACITY + D2_CAPACITY + D3_CAPACITY];
console.log(`\n── CUTLINE-KONTEKST + TIE-SITUATIONER ──`);
const cutlineReport = [];
for (const line of cutlines) {
  const inSide = assignments.find((a) => a.rank === line);
  const outSide = assignments.find((a) => a.rank === line + 1);
  if (!inSide || !outSide) continue;
  const pointsTied = inSide.globalPoints === outSide.globalPoints;
  const visibleRankTied = inSide.visibleGlobalRank != null && inSide.visibleGlobalRank === outSide.visibleGlobalRank;
  const entry = {
    cutline: line,
    inSide: { name: inSide.name, globalPoints: inSide.globalPoints, visibleGlobalRank: inSide.visibleGlobalRank },
    outSide: { name: outSide.name, globalPoints: outSide.globalPoints, visibleGlobalRank: outSide.visibleGlobalRank },
    marginPoints: inSide.globalPoints - outSide.globalPoints,
    pointsTied,
    visibleRankTied,
  };
  cutlineReport.push(entry);
  const tieTag = visibleRankTied ? "  ⚠️ TIE — afgjort af #3036-countback, ikke synlig rang" : "";
  console.log(`  Cutline ${line}: ${inSide.name} (${inSide.globalPoints} gp, rang ${inSide.visibleGlobalRank ?? "—"}) vs ${outSide.name} (${outSide.globalPoints} gp, rang ${outSide.visibleGlobalRank ?? "—"}) — margin ${entry.marginPoints} gp${tieTag}`);
}
// Alle øvrige steder i feltet hvor global_points er identiske (uanset cutline) —
// ren informativ optælling, ikke kun ved grænserne.
const allTiedGroups = new Map();
for (const a of ranked) {
  if (!allTiedGroups.has(a.globalPoints)) allTiedGroups.set(a.globalPoints, []);
  allTiedGroups.get(a.globalPoints).push(a.name);
}
const tiedPointGroups = [...allTiedGroups.entries()].filter(([, names]) => names.length > 1);
console.log(`  I alt ${tiedPointGroups.length} pointgruppe(r) med 2+ hold på samme global_points i hele feltet (afgjort af countback/navn/id).`);

// ─── 5 · AI-hold der viger/fyldes (target vs. nu, POOL_TARGET_SIZE-mekanikken) ──

console.log(`\n── AI-FYLD (target efter flytning vs. AI-hold i puljen NU — reconcileAiTeamsForPool udfører dette ved --apply) ──`);
const currentAiByPool = new Map();
for (const t of allTeams) {
  if (t.is_ai === true && t.league_division_id) {
    currentAiByPool.set(t.league_division_id, (currentAiByPool.get(t.league_division_id) || 0) + 1);
  }
}
let totalAiRemoved = 0, totalAiCreated = 0;
const aiReport = [];
const d1PoolId = pools.find((p) => p.tier === 1)?.id;
for (const p of pools) {
  const realManagerCount = byPool.get(p.id) || 0;
  const targetAi = targetAiCountForPool(p.tier, realManagerCount);
  const currentAi = currentAiByPool.get(p.id) || 0;
  const delta = targetAi - currentAi;
  if (delta !== 0) {
    if (delta < 0) totalAiRemoved += -delta; else totalAiCreated += delta;
  }
  if (p.tier === 1 || currentAi > 0 || targetAi > 0 || realManagerCount > 0) {
    aiReport.push({ poolId: p.id, label: poolLabel.get(p.id), tier: p.tier, realManagerCount, currentAi, targetAi, delta });
    if (delta !== 0 || p.tier === 1) {
      console.log(`  D${p.tier} ${pad(poolLabel.get(p.id), 14)} ægte ${String(realManagerCount).padStart(2)} · AI nu ${String(currentAi).padStart(2)} → target ${String(targetAi).padStart(2)}  ${delta === 0 ? "(uændret)" : delta < 0 ? `(−${-delta} viger)` : `(+${delta} fyldes)`}`);
    }
  }
}
console.log(`\n  I alt: ${totalAiRemoved} AI-hold viger (heraf ${currentAiByPool.get(d1PoolId) || 0} fra D1, når alle 24 pladser fyldes af ægte hold) · ${totalAiCreated} AI-hold skal genereres andetsteds.`);

const over = [...byPool.entries()].filter(([, n]) => n > 24);
if (over.length) {
  console.error(`❌ ${over.length} pulje(r) med over 24 ægte hold — fordelings-fejl, afbryder.`);
  process.exit(1);
}

// ─── 6 · Skriv dry-run-snapshot (input til senere --apply) ──────────────────

const snapshot = {
  issue: 3901,
  generated_at: nowStamp(),
  mode: "dry-run",
  source_season: { id: season.id, number: season.number, status: season.status },
  ranking_source: "global_rank_mv (cyclingzone.org/standings?tab=global) + #3036-countback secondary tiebreak",
  capacities: { d1: D1_CAPACITY, d2: D2_CAPACITY, d3: D3_CAPACITY, d4_pool_count: D4_POOL_COUNT },
  season_end_skip_division_movement_flag: flagOn ? "on" : "off",
  manager_team_count: managerTeams.length,
  missing_global_rank: missing.map((m) => ({ teamId: m.teamId, name: m.name })),
  inactive_but_placed: inactive.map((m) => ({ teamId: m.teamId, name: m.name, globalPoints: m.globalPoints, rank: m.rank })),
  top24_to_d1: assignments.filter((a) => a.toTier === 1).map((a) => ({
    rank: a.rank, teamId: a.teamId, name: a.name, globalPoints: a.globalPoints,
    visibleGlobalRank: a.visibleGlobalRank, fromTier: a.fromTier, movement: a.movement,
  })),
  assignments: assignments.map((a) => ({
    rank: a.rank, teamId: a.teamId, name: a.name, globalPoints: a.globalPoints,
    visibleGlobalRank: a.visibleGlobalRank, activeRecent: a.activeRecent,
    fromTier: a.fromTier, fromPoolId: a.fromPoolId, toTier: a.toTier, toPoolId: a.toPoolId,
    movement: a.movement,
  })),
  movement_summary: { promoted: promoted.length, relegated: relegated.length, poolMoves: poolMoves.length, unchanged: unchanged.length },
  pool_fill: [...byPool.entries()].map(([poolId, count]) => ({ poolId, label: poolLabel.get(poolId), realManagerCount: count })),
  cutlines: cutlineReport,
  tied_point_groups_total: tiedPointGroups.length,
  ai_reconcile_forecast: aiReport,
  ai_totals: { totalAiRemoved, totalAiCreated },
};

// #4274: ankret på git-toplevel, ikke __dirname — se lib/repoRoot.mjs.
const snapDir = join(repoRoot(), "docs", "snapshots", "3901");
mkdirSync(snapDir, { recursive: true });
const stamp = dateStamp();
const jsonPath = join(snapDir, `dry-run-${stamp}.json`);
writeFileSync(jsonPath, JSON.stringify(snapshot, null, 2));

const mdLines = [];
mdLines.push(`# S2→S3 pyramide-komprimering med D1 — dry-run ${stamp} (#3901)`);
mdLines.push("");
mdLines.push(`Kilde-sæson: #${season.number} (status='${season.status}'). Rangeringskilde: den synlige globale rangliste (\`global_rank_mv\`, cyclingzone.org/standings?tab=global), sekundær tiebreak = #3036-countback. Motor-flag \`${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}\` = '${flagOn ? "on" : "off"}' på genereringstidspunktet.`);
mdLines.push("");
mdLines.push(`**⚠️ Denne JSON er input til \`--apply --snapshot=${jsonPath}\`.** Regenerér listen så tæt på cutover som muligt (helst efter sidste S2-løb, mens sæsonen stadig er 'active') — apply anvender PRÆCIS denne fordeling, uden at genberegne ranglisten.`);
mdLines.push("");
mdLines.push(`## Top ${D1_CAPACITY} → Division 1`);
mdLines.push("");
mdLines.push(`| Rank | Hold | Global point | Synlig rang | Fra |`);
mdLines.push(`|---|---|---|---|---|`);
for (const a of assignments.filter((x) => x.toTier === 1)) {
  mdLines.push(`| ${a.rank} | ${a.name} | ${a.globalPoints} | ${a.visibleGlobalRank ?? "—"} | D${a.fromTier ?? "?"} |`);
}
mdLines.push("");
mdLines.push(`## Netto-bevægelse`);
mdLines.push(`- Op: ${promoted.length} · Ned: ${relegated.length} · Pulje-skift (samme division): ${poolMoves.length} · Uændret: ${unchanged.length}`);
mdLines.push("");
mdLines.push(`## Cutlines`);
mdLines.push("");
mdLines.push(`| Cutline | Inde | Ude | Margin (gp) | Tie (synlig rang delt)? |`);
mdLines.push(`|---|---|---|---|---|`);
for (const c of cutlineReport) {
  mdLines.push(`| ${c.cutline} | ${c.inSide.name} (${c.inSide.globalPoints}gp) | ${c.outSide.name} (${c.outSide.globalPoints}gp) | ${c.marginPoints} | ${c.visibleRankTied ? "⚠️ JA — afgjort af countback" : "Nej"} |`);
}
mdLines.push("");
mdLines.push(`${tiedPointGroups.length} pointgruppe(r) med 2+ hold på samme global_points i hele feltet (i alt, ikke kun ved cutlines).`);
mdLines.push("");
mdLines.push(`## AI-hold`);
mdLines.push(`${totalAiRemoved} AI-hold viger i alt (POOL_TARGET_SIZE-mekanikken, #1688) · ${totalAiCreated} AI-hold skal genereres andetsteds (udføres af \`reconcileAiTeamsForPool\` ved --apply, ikke af dette dry-run).`);
mdLines.push("");
mdLines.push(`## Drejebogs-instruktion (IKKE udført af dette script)`);
mdLines.push(`1. Sæt \`${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}\` = \`'on'\` i \`app_config\` — FØR "Afslut sæson" klikkes for sæson #${season.number}.`);
mdLines.push(`2. Klik "Afslut sæson" → sæson #${season.number} bliver 'completed'.`);
mdLines.push(`3. Kør \`node scripts/compressPyramidS3.js --apply --snapshot=${jsonPath}\` (eller en senere, friskere dry-run-JSON — regenerér og få ny godkendelse hvis der er gået lang tid/flere løb siden denne fil blev skrevet).`);
mdLines.push(`4. Kør transitionen som normalt.`);
mdLines.push(`5. Sæt \`${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}\` = \`'off'\` EFTER hele transitionen — S3 skal køre motorens løbende op/nedrykningsregler igen (#2164).`);
const mdPath = join(snapDir, `dry-run-${stamp}.md`);
writeFileSync(mdPath, mdLines.join("\n") + "\n");

console.log(`\n📄 Snapshot skrevet: ${jsonPath}`);
console.log(`📄 Opsummering skrevet: ${mdPath}`);

console.log(`\n🟢 Dry-run færdig — ingen writes.`);
console.log(`\nDREJEBOG:`);
console.log(`  1. Sæt ${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}='on' i app_config — FØR "Afslut sæson".`);
console.log(`  2. Klik "Afslut sæson" (sæson #${season.number} → 'completed').`);
console.log(`  3. Kør denne komprimering med --apply --snapshot=${jsonPath} (regenerér FØRST hvis der er gået tid/flere løb — se cutline-note).`);
console.log(`  4. Kør transitionen.`);
console.log(`  5. Sæt ${SEASON_END_SKIP_MOVEMENT_FLAG_KEY}='off' EFTER transitionen (#2164).`);
process.exit(0);
