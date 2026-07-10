// Reparation #2251: fjern de fejl-materialiserede Grand Tours (≥15 etaper) fra
// Division 4-puljerne og re-materialisér resten af tier 4-kalenderen med den rettede
// selection/dedup (GT'er kun i tier 1), afkortet til de-facto sæson-slut, så alle
// divisioner stadig slutter samme dag.
//
// Rod-årsag: reconcilePoolCalendarOnActivation overskrev kvote-tabellen med kun tier 4's
// kvote → tier 1-3 valgte intet i plan-genberegningen → cross-tier dedup tom → tier 4
// fik leftover-GT'er (prestige-først). Se issue #2251 + postmortem i .claude/learnings/.
//
// KØR ALDRIG mod prod uden ejer-godkendelse — ejeren skal have set live-tilstanden
// (dry-run-output) og godkendt PRÆCIS dette skridt.
//   node scripts/repair2251Tier4GrandTours.js            → dry-run: viser live state + plan
//   node scripts/repair2251Tier4GrandTours.js --live     → backup (JSON) + delete + re-materialisér
//
// Kendt begrænsning (accepteret): nye løb får friske game_day-nøgler fra pakkeren (0-baserede
// for den nye horisont). Igangværende gamle løb (fx Tour du Léman, gd 0-5) kan derfor
// false-binde et par ryttere mod nye løb i nogle dage — lille blast radius, selv-korrigerende
// når de gamle løb er færdige.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { writeFileSync, mkdirSync } from "fs";
import { materializeTierCalendars } from "../lib/tierCalendarMaterializer.js";
import { TIER_GAME_DAY_QUOTA } from "../lib/tierRaceSelection.js";
import { TIER_DENSITY } from "../lib/tierCalendarMaterializer.js";

const GT_MIN_STAGES = 15;
const CHILD_TABLES = [
  "race_results",
  "race_simulation_runs",
  "race_entries",
  "race_stage_schedule",
  "race_stage_profiles",
  "race_withdrawals",
];

async function fetchAll(supabase, table, apply) {
  const out = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const q = apply(supabase.from(table).select("*")).range(from, from + PAGE - 1);
    const { data, error } = await q;
    if (error) throw new Error(`${table}: ${error.message}`);
    out.push(...(data || []));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export async function repairTier4GrandTours({ supabase, now = new Date(), dryRun = true, log = console.log }) {
  const { data: season, error: sErr } = await supabase
    .from("seasons").select("id, start_date").eq("status", "active").maybeSingle();
  if (sErr) throw new Error(`seasons: ${sErr.message}`);
  if (!season) throw new Error("ingen aktiv sæson");

  const { data: divisions, error: dErr } = await supabase
    .from("league_divisions").select("id, tier").eq("tier", 4);
  if (dErr) throw new Error(`league_divisions: ${dErr.message}`);
  const tier4PoolIds = (divisions || []).map((d) => d.id);
  if (!tier4PoolIds.length) throw new Error("ingen tier 4-puljer");

  const { data: gtRaces, error: rErr } = await supabase
    .from("races")
    .select("id, name, status, stages, stages_completed, scheduled_for, league_division_id")
    .eq("season_id", season.id)
    .in("league_division_id", tier4PoolIds)
    .gte("stages", GT_MIN_STAGES);
  if (rErr) throw new Error(`races: ${rErr.message}`);

  log(`\n── Live-tilstand: ${gtRaces.length} Grand Tour-instans(er) i tier 4 (puljer ${tier4PoolIds.join(",")}) ──`);
  for (const r of gtRaces) {
    const [{ count: entries }, { count: results }] = await Promise.all([
      supabase.from("race_entries").select("*", { count: "exact", head: true }).eq("race_id", r.id),
      supabase.from("race_results").select("*", { count: "exact", head: true }).eq("race_id", r.id),
    ]);
    log(`  pulje ${r.league_division_id} · ${r.name} · ${r.status} · etaper ${r.stages_completed}/${r.stages} · entries ${entries} · results ${results} · ${r.id}`);
  }
  if (!gtRaces.length) { log("intet at reparere"); return { deleted: 0 }; }

  // De-facto sæson-slut (ALLE divisioner slutter samme dag — ejer-krav): sidste
  // planlagte etape i sæsonen EFTER at GT-etaperne (som slettes) er trukket fra.
  const gtIds = new Set(gtRaces.map((r) => r.id));
  const seasonRaces = await fetchAll(supabase, "races", (q) => q.eq("season_id", season.id));
  const keepIds = seasonRaces.map((r) => r.id).filter((id) => !gtIds.has(id));
  let maxAt = null;
  for (let i = 0; i < keepIds.length; i += 200) {
    const { data: sched, error } = await supabase
      .from("race_stage_schedule").select("scheduled_at").in("race_id", keepIds.slice(i, i + 200));
    if (error) throw new Error(`race_stage_schedule (horisont): ${error.message}`);
    for (const s of sched || []) {
      const t = Date.parse(s.scheduled_at);
      if (Number.isFinite(t) && (maxAt == null || t > maxAt)) maxAt = t;
    }
  }
  if (maxAt == null) throw new Error("kunne ikke bestemme sæson-slut");
  const from = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
  const end = new Date(maxAt);
  const endDayUtc = Date.UTC(end.getUTCFullYear(), end.getUTCMonth(), end.getUTCDate());
  const realDays = Math.floor((endDayUtc - from.getTime()) / 86_400_000);
  log(`\nRe-materialiserings-horisont: ${from.toISOString().slice(0, 10)} → ${end.toISOString().slice(0, 10)} (${realDays} dage, kvote ${TIER_DENSITY[4] * realDays})`);
  if (realDays < 1) throw new Error("sæsonen er ved at slutte — ingen re-materialisering");

  if (dryRun) {
    log("\nDRY-RUN — ingen writes. Kør med --live EFTER ejer-godkendelse.");
    const summary = await materializeTierCalendars({
      supabase, seasonId: season.id, seasonStartDate: season.start_date, from,
      tiers: [4], dryRun: true, realDays,
      quotas: { ...TIER_GAME_DAY_QUOTA, 4: TIER_DENSITY[4] * realDays },
      log,
    });
    return { deleted: 0, dryRun: true, plan: summary.tiers };
  }

  // 1) Backup (JSON, timestampet) — alle berørte rækker før sletning.
  const backup = { generated_at: now.toISOString(), season_id: season.id, races: gtRaces, children: {} };
  const ids = [...gtIds];
  for (const table of CHILD_TABLES) {
    backup.children[table] = [];
    for (let i = 0; i < ids.length; i += 100) {
      backup.children[table].push(...await fetchAll(supabase, table, (q) => q.in("race_id", ids.slice(i, i + 100))));
    }
  }
  const backupDir = join(dirname(fileURLToPath(import.meta.url)), "backups");
  mkdirSync(backupDir, { recursive: true });
  const backupPath = join(backupDir, `repair-2251-tier4-gts-${now.toISOString().replace(/[:.]/g, "-")}.json`);
  writeFileSync(backupPath, JSON.stringify(backup));
  log(`backup skrevet: ${backupPath}`);

  // 2) Slet børn → løb.
  for (const table of CHILD_TABLES) {
    const { error } = await supabase.from(table).delete().in("race_id", ids);
    if (error) throw new Error(`delete ${table}: ${error.message}`);
    log(`  slettet ${backup.children[table].length} rækker fra ${table}`);
  }
  const { error: delErr } = await supabase.from("races").delete().in("id", ids);
  if (delErr) throw new Error(`delete races: ${delErr.message}`);
  log(`  slettet ${ids.length} løb`);

  // 3) Re-materialisér tier 4 (rettet kode: GT-gate + dedup) frem til fælles sæson-slut.
  const summary = await materializeTierCalendars({
    supabase, seasonId: season.id, seasonStartDate: season.start_date, from,
    tiers: [4], dryRun: false, realDays,
    quotas: { ...TIER_GAME_DAY_QUOTA, 4: TIER_DENSITY[4] * realDays },
    log,
  });
  log(`\nre-materialiseret: +${summary.racesInserted} løb, ${summary.stageSchedules} etape-tider`);
  return { deleted: ids.length, backupPath, ...summary };
}

if (process.argv[1] && process.argv[1].endsWith("repair2251Tier4GrandTours.js")) {
  const __envdir = dirname(fileURLToPath(import.meta.url));
  dotenv.config({ path: join(__envdir, "../.env"), quiet: true });   // backend/.env
  dotenv.config({ path: join(__envdir, "../../.env"), quiet: true }); // repo-root fallback
  const dryRun = !process.argv.includes("--live");
  const supabase = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  repairTier4GrandTours({ supabase, dryRun })
    .then((res) => { console.log("\nfærdig:", JSON.stringify({ deleted: res.deleted, dryRun: !!res.dryRun })); })
    .catch((err) => { console.error("FEJL:", err.message); process.exit(1); });
}
