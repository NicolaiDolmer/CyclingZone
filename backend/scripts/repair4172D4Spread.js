#!/usr/bin/env node
// Reparation #4172: alle 48 Division 4-hold sidder i pulje A og B — de skal spredes
// over alle 8 D4-puljer, "præcist ligesom sidste sæson" (ejer-krav 24/8).
//
// ROD-ÅRSAG (rettes separat, se #4172): pyramidCompression.js's distributeCompression
// har `d4PoolCount = 2` og gør `slice(0, d4PoolCount)` på tier 4-puljerne. Alt under D3
// snake-fordeles derfor over KUN pulje A/B; C-H får per definition ingenting. Defaulten
// stammer fra #2851 (S1→S2) og blev arvet uændret af compressPyramidS3.js (#3901).
// S2 endte alligevel spredt, fordi nye spillere undervejs aktiverede de sovende puljer
// via #2149 — spredningen dér var en bivirkning af tilgang, ikke af komprimeringen.
//
// MÅLTILSTAND (ejer-godkendt 24/8):
//   • 46 rigtige D4-hold snake-fordeles efter global_rank_mv over puljerne 8-15 → 5/5/6/6/6/6/6/6
//   • S3's auto-filled D4-entries slettes og genopbygges af raceEntryGeneratorSweep
//   • de managere der skifter pulje får in-app besked (samme type som normal reseed)
//   • AI-fyld til POOL_TARGET_SIZE=24 (#1688-politik) — VALGFRIT, se --skip-ai
//
// --skip-ai (ejer-beslutning 24/8): AI-fyldet ville føde 3.456 nye ryttere (144 hold
// à 24) timer før S3's første løbsdag, og generalprøven viste at netop den fase er
// den skrøbelige. Uden AI-fyld skabes INGEN nye ryttere: puljerne får kun de ægte
// hold, løbene bliver afviklelige, og transition-gaten 20/9 er reddet. Felterne er
// tynde (6 hold pr. pulje mod S2's 8-10) indtil AI-fyldet køres separat bagefter.
//
// KØR ALDRIG --live mod prod uden ejer-godkendelse — ejeren skal have set dry-run-outputtet
// og godkendt PRÆCIS dette skridt (hard rule: ejer ser live-tilstand før destruktive ops).
//   node scripts/repair4172D4Spread.js                     → dry-run, rører intet
//   node scripts/repair4172D4Spread.js --live --skip-ai    → flyt + entry-reset + beskeder
//   node scripts/repair4172D4Spread.js --live              → ovenstående + AI-fyld til 24
//
// SCHEDULER-FLAG: slås FRA under kørslen og genoprettes BEVIDST IKKE af scriptet.
// At gen-tænde et live spiller-vendt system er ejer-only (memory: no-autonomous-resume).
// Scriptet printer den nøjagtige kommando ejeren selv kører bagefter.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { writeFileSync, mkdirSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { reconcileAiTeamsForPool } from "../lib/aiTeamGenerator.js";
import { notifyTeamOwner } from "../lib/notificationService.js";
import { STAGE_SCHEDULER_FLAG_KEY } from "../lib/stageSchedulerFlag.js";
import { POOL_TARGET_SIZE } from "../lib/economyConstants.js";
import { fetchAllRows } from "../lib/supabasePagination.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "..", ".env") });

const D4_TIER = 4;

const log = (...a) => console.log(...a);

/**
 * Snake-fordeling: hold i rangorden lægges frem og tilbage over puljerne, så hver
 * pulje får et jævnt udsnit af feltet i stedet for et sammenhængende rang-bånd.
 * Samme retning/determinisme som pyramidCompression.snakeAssign.
 */
export function snakeSpread(rankedTeamIds, poolIds) {
  const n = poolIds.length;
  if (!n) throw new Error("snakeSpread: ingen puljer");
  return rankedTeamIds.map((teamId, i) => {
    const row = Math.floor(i / n);
    const idx = row % 2 === 0 ? i % n : n - 1 - (i % n);
    return { teamId, poolId: poolIds[idx] };
  });
}

async function loadState(supabase) {
  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id, number, status").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  if (!season) throw new Error("ingen aktiv sæson");

  const { data: pools, error: pErr } = await supabase
    .from("league_divisions").select("id, tier, pool_index, label").eq("tier", D4_TIER);
  if (pErr) throw new Error(`league_divisions: ${pErr.message}`);
  const poolIds = (pools || []).sort((a, b) => a.pool_index - b.pool_index).map((p) => p.id);
  if (poolIds.length < 2) throw new Error(`forventede >=2 D4-puljer, fandt ${poolIds.length}`);

  const { data: teams, error: tErr } = await supabase
    .from("teams").select("id, name, is_ai, is_bank, is_frozen, league_division_id")
    .in("league_division_id", poolIds);
  if (tErr) throw new Error(`teams: ${tErr.message}`);
  const inD4 = (teams || []).filter((t) => !t.is_bank);

  // global_rank_mv er humans-only (#3901's rangeringskilde, samme som standings?tab=global).
  // Pagineret: matviewen vokser med spillertallet og ville stille toppe ved 1000.
  const ranks = await fetchAllRows(() => supabase
    .from("global_rank_mv").select("team_id, global_rank").order("team_id"));
  const rankByTeam = new Map((ranks || []).map((r) => [r.team_id, r.global_rank]));

  return { season, pools, poolIds, inD4, rankByTeam };
}

export async function repairD4Spread({ supabase, dryRun = true, skipAi = false } = {}) {
  const { season, pools, poolIds, inD4, rankByTeam } = await loadState(supabase);
  const labelByPool = new Map(pools.map((p) => [p.id, p.label]));

  const real = inD4.filter((t) => !t.is_ai);
  const ai = inD4.filter((t) => t.is_ai);

  // Rangorden: global_rank stigende. Hold uden rang (should not happen for reelle
  // managere) lægges bagest deterministisk på id, så to kørsler giver samme plan.
  const ranked = [...real].sort((a, b) => {
    const ra = rankByTeam.get(a.id) ?? Number.MAX_SAFE_INTEGER;
    const rb = rankByTeam.get(b.id) ?? Number.MAX_SAFE_INTEGER;
    return ra === rb ? String(a.id).localeCompare(String(b.id)) : ra - rb;
  });

  const spread = snakeSpread(ranked.map((t) => t.id), poolIds);
  const targetByTeam = new Map(spread.map((s) => [s.teamId, s.poolId]));
  const moves = ranked
    .filter((t) => targetByTeam.get(t.id) !== t.league_division_id)
    .map((t) => ({
      teamId: t.id, name: t.name,
      fromPoolId: t.league_division_id, toPoolId: targetByTeam.get(t.id),
      rank: rankByTeam.get(t.id) ?? null,
    }));

  const perPool = poolIds.map((pid) => {
    const realCount = spread.filter((s) => s.poolId === pid).length;
    const aiNow = ai.filter((t) => t.league_division_id === pid).length;
    return {
      poolId: pid, label: labelByPool.get(pid), real: realCount, aiNow,
      aiTarget: realCount > 0 ? Math.max(0, POOL_TARGET_SIZE - realCount) : 0,
    };
  });

  // Entries der skal nulstilles: KUN auto-filled i endnu ikke afviklede løb.
  // Manager-satte lineups (is_auto_filled=false) røres aldrig.
  // PAGINERET: et naivt .select() topper stille ved 1000 rækker (docs i
  // supabasePagination.js). Dry-run mod prod 24/8 rapporterede 1000 i stedet for
  // de faktiske 4.982 — uden paginering ville --live kun rydde en femtedel og
  // efterlade resten som ghost-entries i de forkerte puljers løb.
  const d4TeamIds = inD4.map((t) => t.id);
  const entries = await fetchAllRows(() => supabase
    .from("race_entries")
    .select("race_id, rider_id, team_id, is_auto_filled, races!inner(season_id, status, stages_completed)")
    .in("team_id", d4TeamIds)
    .eq("is_auto_filled", true)
    .eq("races.season_id", season.id)
    .eq("races.status", "scheduled")
    .eq("races.stages_completed", 0)
    .order("race_id").order("rider_id"));

  const plan = {
    seasonNumber: season.number,
    pools: perPool,
    realTeams: real.length,
    aiTeamsNow: ai.length,
    aiToCreate: perPool.reduce((s, p) => s + Math.max(0, p.aiTarget - p.aiNow), 0),
    moves: moves.length,
    entriesToClear: entries.length,
    racesTouched: new Set(entries.map((e) => e.race_id)).size,
  };

  log(`\n── #4172 · D4-spredning · sæson ${season.number}${skipAi ? " · UDEN AI-fyld (--skip-ai)" : ""} ──`);
  log(`rigtige hold: ${plan.realTeams} · AI nu: ${plan.aiTeamsNow} · AI der oprettes: ${skipAi ? "0 (sprunget over)" : plan.aiToCreate}`);
  log(`hold der flytter pulje: ${plan.moves}`);
  log(`auto-entries der ryddes: ${plan.entriesToClear} i ${plan.racesTouched} løb\n`);
  for (const p of perPool) {
    const aiCol = skipAi
      ? `AI ${String(p.aiNow).padStart(2)} (uændret)`
      : `AI ${String(p.aiNow).padStart(2)} → ${String(p.aiTarget).padStart(2)}`;
    log(`  ${String(p.label).padEnd(18)} rigtige ${String(p.real).padStart(2)} · ${aiCol} · felt ${String(p.real + (skipAi ? p.aiNow : p.aiTarget)).padStart(2)} hold`);
  }

  if (dryRun) {
    log("\nDRY-RUN — intet skrevet. Kør med --live efter ejer-GO.\n");
    return { ...plan, dryRun: true };
  }

  // ── backup FØR enhver mutation ──
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const backupDir = join(__dirname, "..", "..", "docs", "snapshots", "4172");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `d4-spread-backup-${stamp}.json`);
  writeFileSync(backupPath, JSON.stringify({
    takenAt: new Date().toISOString(), seasonId: season.id,
    teams: inD4.map((t) => ({ id: t.id, name: t.name, is_ai: t.is_ai, league_division_id: t.league_division_id })),
    entries: entries.map((e) => ({ race_id: e.race_id, rider_id: e.rider_id, team_id: e.team_id })),
  }, null, 2));
  log(`backup skrevet: ${backupPath}`);

  // ── scheduler-flag FRA under kørslen ──
  const { data: flagRow, error: fErr } = await supabase
    .from("app_config").select("value").eq("key", STAGE_SCHEDULER_FLAG_KEY).maybeSingle();
  if (fErr) throw new Error(`app_config: ${fErr.message}`);
  const flagBefore = flagRow?.value ?? null;
  const { error: offErr } = await supabase.from("app_config")
    .upsert({ key: STAGE_SCHEDULER_FLAG_KEY, value: "off" }, { onConflict: "key" });
  if (offErr) throw new Error(`app_config upsert: ${offErr.message}`);
  log(`scheduler-flag sat 'off' (var: ${JSON.stringify(flagBefore)})`);

  // ── 1. ryd auto-entries FØR flytningen, så sweepen aldrig ser et halvflyttet felt ──
  let cleared = 0;
  const byRace = new Map();
  for (const e of entries) {
    if (!byRace.has(e.race_id)) byRace.set(e.race_id, []);
    byRace.get(e.race_id).push(e.team_id);
  }
  for (const [raceId, teamIds] of byRace) {
    const { error } = await supabase.from("race_entries")
      .delete().eq("race_id", raceId).eq("is_auto_filled", true).in("team_id", [...new Set(teamIds)]);
    if (error) throw new Error(`slet entries (løb ${raceId}): ${error.message}`);
    cleared += teamIds.length;
  }
  log(`ryddede ${cleared} auto-entries i ${byRace.size} løb`);

  // ── 2. flyt hold + besked i SAMME iteration ──
  //
  // Beskeden sendes lige efter holdets egen flytning, ikke i et separat loop til
  // sidst. Årsag: `moves` udledes af "nuværende pulje != mål-pulje", så ved en
  // gentagelse efter et midtvejs-nedbrud ville listen være tom, og de allerede
  // flyttede hold ville aldrig få besked. Koblet sådan her er et flyttet hold
  // altid også et notificeret hold.
  let notified = 0;
  for (const m of moves) {
    const { error } = await supabase.from("teams")
      .update({ league_division_id: m.toPoolId }).eq("id", m.teamId);
    if (error) throw new Error(`flyt hold ${m.teamId}: ${error.message}`);
    try {
      await notifyTeamOwner({
        supabase, teamId: m.teamId, type: "board_update",
        title: "New pool for the new season",
        message: `Your team has been moved to ${labelByPool.get(m.toPoolId)} so Division 4 is spread evenly across all pools.`,
        metadata: { titleCode: "notif.poolReseeded.title", messageCode: "notif.poolReseeded.message", messageParams: { pool: labelByPool.get(m.toPoolId) } },
      });
      notified++;
    } catch (err) {
      // Best-effort: en tabt besked må ikke rulle reparationen tilbage.
      console.error(`  ❌ besked fejlede for hold ${m.teamId}: ${err?.message || err}`);
    }
  }
  log(`flyttede ${moves.length} hold · sendte ${notified} beskeder`);

  // ── 3. AI-fyld pr. pulje (idempotent, frossen #1688-politik) ──
  //
  // Generalprøven 24/8 døde tavst midt i denne fase (9 af 146 hold, ingen DB-fejl).
  // reconcileAiTeamsForPool er idempotent, så en fejl i ÉN pulje må ikke afbryde de
  // øvrige: vi fanger pr. pulje, logger den fulde fejl med stack, og fortsætter.
  // Kørslen kan derefter gentages og tager kun det der mangler.
  const aiReport = [];
  const aiErrors = [];
  if (skipAi) {
    log(`\n⏭  AI-fyld SPRUNGET OVER (--skip-ai).`);
    log(`    Puljerne har kun de ægte hold. Løbene KAN afvikles, men felterne er`);
    log(`    tynde indtil AI-fyldet køres separat (kør scriptet igen uden --skip-ai).`);
  } else {
    for (const pid of poolIds) {
      const label = labelByPool.get(pid);
      try {
        const res = await reconcileAiTeamsForPool({ supabase, poolId: pid });
        aiReport.push({ poolId: pid, label, created: res.created, removed: res.removed });
        log(`  ${String(label).padEnd(18)} AI +${res.created} / -${res.removed}`);
      } catch (err) {
        aiErrors.push({ poolId: pid, label, error: err?.message || String(err) });
        log(`  ${String(label).padEnd(18)} ❌ ${err?.message || err}`);
        if (err?.stack) log(String(err.stack).split("\n").slice(0, 6).map((l) => `      ${l}`).join("\n"));
      }
    }
    if (aiErrors.length) {
      log(`\n⚠️  ${aiErrors.length}/${poolIds.length} puljer fejlede i AI-fyld — kør scriptet igen (idempotent).`);
    }
  }

  log(`\n⚠️  scheduler-flag står 'off'. Gen-tænding er ejer-only — kør selv:`);
  log(`    update app_config set value = '${flagBefore ?? "on"}' where key = '${STAGE_SCHEDULER_FLAG_KEY}';\n`);

  return { ...plan, dryRun: false, cleared, notified, aiReport, backupPath, flagBefore };
}

if (process.argv[1] && process.argv[1].endsWith("repair4172D4Spread.js")) {
  const dryRun = !process.argv.includes("--live");
  const skipAi = process.argv.includes("--skip-ai");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  repairD4Spread({ supabase, dryRun, skipAi })
    .then((r) => log("færdig:", JSON.stringify({ dryRun: !!r.dryRun, skipAi, moves: r.moves, aiToCreate: skipAi ? 0 : r.aiToCreate })))
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
