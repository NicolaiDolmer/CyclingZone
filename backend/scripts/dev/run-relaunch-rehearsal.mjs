#!/usr/bin/env node
// Rehearsal-runner (#1191) — kører den ÆGTE relaunch-orchestrator (#1103) mod en
// DISPOSABEL Supabase-branch og verificerer alle acceptance-tjek + rollback —
// inkl. #1447 anon-RLS-synlighed (fiktive ryttere skal være synlige for ikke-admins).
//
// KØRES KUN mod branch-projektet (ref starter IKKE med prod-ref). Scriptet
// nægter at køre hvis isProdSupabaseUrl(SUPABASE_URL) er true (#1103-guard).
//
// Brug:
//   1. Sæt SUPABASE_URL + SUPABASE_SERVICE_KEY + SUPABASE_ANON_KEY i backend/.env
//      til BRANCHEN (anon-nøglen kræves til #1447 RLS-sti-tjekket).
//   2. node scripts/dev/run-relaunch-rehearsal.mjs
//
// Output: dry-run-summary, apply-summary, acceptance-tabel (PASS/FAIL), rollback-tjek.

import { createClient } from "@supabase/supabase-js";
import dotenv from "dotenv";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { runRelaunchSeason1, isProdSupabaseUrl } from "../../lib/relaunchOrchestrator.js";
import { reactivateLegacyRiders, retireLegacyRiders } from "../../lib/legacyRiderRetirement.js";
import { runFullBetaReset } from "../../lib/betaResetService.js";
import { runAcademyIntake } from "../../lib/academyIntake.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";

const START_DATE = "2026-06-20";
const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: join(__dirname, "../../.env"), quiet: true });

const { SUPABASE_URL, SUPABASE_SERVICE_KEY } = process.env;
if (!SUPABASE_URL || !SUPABASE_SERVICE_KEY) {
  console.error("❌ Mangler SUPABASE_URL / SUPABASE_SERVICE_KEY i backend/.env");
  process.exit(1);
}
if (isProdSupabaseUrl(SUPABASE_URL)) {
  console.error("❌ SUPABASE_URL peger på PROD. Rehearsal nægter. Sæt branchen.");
  process.exit(1);
}
const maskedRef = (SUPABASE_URL.match(/https?:\/\/([a-z0-9]+)\./)?.[1] || "ukendt")
  .replace(/^(.{4}).*(.{4})$/, "$1…$2");
console.log(`▶ Target (maskeret ref): ${maskedRef} — non-prod bekræftet.\n`);

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

async function countRiders(filter) {
  let q = supabase.from("riders").select("id", { count: "exact", head: true });
  for (const [fn, ...args] of filter) q = q[fn](...args);
  const { count, error } = await q;
  if (error) throw new Error(error.message);
  return count ?? 0;
}

async function main() {
  // ── DRY-RUN ────────────────────────────────────────────────────────────────
  console.log("=== DRY-RUN preview ===");
  const dry = await runRelaunchSeason1(supabase, { dryRun: true, startDate: START_DATE });
  console.log(JSON.stringify(dry, null, 2));

  // ── COHORT-ON-DAY-1 (#1308 beslutning ③, ejer-besluttet 17/6) ───────────────
  // Sæt academy_enabled='on' FØR apply så orchestrator-trin 6.4 genererer
  // kandidat-kuld ved seed. Rehearsal skal afspejle den besluttede prod-plan
  // (academy live på relaunch-dag 1). app_config.value er JSONB → 'on' lagres "on".
  await supabase.from("app_config").upsert(
    { key: "academy_enabled", value: "on" },
    { onConflict: "key" }
  );
  console.log("▶ academy_enabled='on' sat (cohort-on-day-1, #1308 ③)\n");

  // ── APPLY ────────────────────────────────────────────────────────────────
  console.log("\n=== APPLY (non-prod) ===");
  const applied = await runRelaunchSeason1(supabase, { dryRun: false, startDate: START_DATE });
  console.log(JSON.stringify(applied, null, 2));

  // ── ACCEPTANCE ─────────────────────────────────────────────────────────────
  console.log("\n=== ACCEPTANCE ===");
  const results = [];
  const add = (name, pass, actual, expected) => {
    results.push({ name, pass, actual, expected });
    console.log(`${pass ? "PASS" : "FAIL"} · ${name} · actual=${actual} · expected=${expected}`);
  };

  const legacyActive = await countRiders([["not", "pcm_id", "is", null], ["is", "is_retired", false]]);
  add("Ingen legacy aktive", legacyActive === 0, legacyActive, "0");

  // Academy-kandidater (academy_intake) er pcm_id-null + ikke-retiret, men hører
  // til private hold-tilbud — IKKE det åbne fiktive marked. Træk dem fra så
  // markeds-båndet (780-820) ikke falsk-fejler med cohort-on-day-1 (#1308).
  const intakeRiderRows = await fetchAllRows(() =>
    supabase.from("academy_intake").select("rider_id").order("rider_id")
  );
  const academyRiderIds = new Set(intakeRiderRows.map((r) => r.rider_id));
  const fictionalActiveTotal = await countRiders([["is", "pcm_id", null], ["is", "is_retired", false]]);
  const fictionalMarket = fictionalActiveTotal - academyRiderIds.size;
  add("~800 fiktive i markedet", fictionalMarket >= 780 && fictionalMarket <= 820,
    `${fictionalMarket} (total ${fictionalActiveTotal} − ${academyRiderIds.size} academy)`, "~800");

  // #1447: VERIFICÉR via ANON-nøgle (RLS-sti), ikke kun service-role. Tjekket ovenfor
  // tæller via service_role-klienten, der BYPASSER RLS — og var derfor blind for
  // #669-gaten ("Public read riders" USING (pcm_id IS NOT NULL OR is_admin())), der
  // skjuler pcm_id NULL fra ikke-admins. Efter relaunch er HELE bestanden pcm_id NULL,
  // så uden denne assertion kan markedet + eget hold være TOMT for rigtige brugere
  // mens rehearsal viser grønt. Kræver branchens anon-nøgle i backend/.env.
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) {
    add("Fiktive synlige via anon (RLS-sti, ikke kun service-role)", false,
      "SUPABASE_ANON_KEY mangler i backend/.env — RLS-sti UVERIFICERET", `anon === ${fictionalActive}`);
  } else {
    const anonClient = createClient(SUPABASE_URL, anonKey);
    const { count: anonFictional, error: anonErr } = await anonClient.from("riders")
      .select("id", { count: "exact", head: true }).is("pcm_id", null).eq("is_retired", false);
    add("Fiktive synlige via anon (RLS-sti, ikke kun service-role)",
      !anonErr && anonFictional === fictionalActive && fictionalActive > 0,
      anonErr ? `anon-query fejl: ${anonErr.message}` : `anon=${anonFictional} vs service=${fictionalActive}`,
      `anon === service (${fictionalActive})`);
  }

  // 8 ryttere pr. beta-manager
  const { data: betaTeams } = await supabase.from("teams").select("id")
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false);
  const teamIds = (betaTeams || []).map((t) => t.id);
  const roster = await fetchAllRows(() => supabase.from("riders").select("team_id").in("team_id", teamIds).order("id"));
  const byTeam = {};
  for (const r of roster) byTeam[r.team_id] = (byTeam[r.team_id] || 0) + 1;
  const counts = teamIds.map((id) => byTeam[id] || 0);
  const all8 = counts.length > 0 && counts.every((c) => c === 8);
  add("Hver beta-manager præcis 8 ryttere", all8, `[${counts.join(",")}]`, "alle = 8");

  // Ingen stjerne forhåndstildelt: top base_value-rytter har team_id IS NULL.
  // Ekskludér academy-kandidater (lav/NULL base_value, intake EFTER base_value-
  // backfill) så top-80-vinduet måler de RIGTIGE stjerner og ikke pollueres af
  // kuld-ryttere (#1308). nullsFirst:false holder NULL-base_value ude af toppen.
  const { data: topRidersRaw } = await supabase.from("riders").select("id, team_id, base_value")
    .is("pcm_id", null).eq("is_retired", false)
    .order("base_value", { ascending: false, nullsFirst: false })
    .limit(80 + academyRiderIds.size);
  const topRiders = (topRidersRaw || []).filter((r) => !academyRiderIds.has(r.id)).slice(0, 80);
  const assignedStars = topRiders.filter((r) => r.team_id !== null).length;
  add("Ingen stjerne forhåndstildelt (top 10%)", assignedStars === 0, `${assignedStars} af top80 tildelt`, "0");

  // Founder-badge tildelt alle beta-managers
  const { data: badgeRows } = await supabase.from("manager_achievements").select("user_id").eq("achievement_id", "founder_badge");
  const { data: betaUsers } = await supabase.from("teams").select("user_id")
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false);
  const eligible = new Set((betaUsers || []).map((t) => t.user_id).filter(Boolean));
  const haveBadge = new Set((badgeRows || []).map((r) => r.user_id));
  const allHave = [...eligible].every((u) => haveBadge.has(u)) && eligible.size > 0;
  add("Founder-badge tildelt alle beta-managers", allHave, `${haveBadge.size}/${eligible.size}`, "alle");

  // Sæson 1 aktiv
  const { data: seasons } = await supabase.from("seasons").select("number, status").order("number");
  const s1 = (seasons || []).find((s) => s.number === 1);
  add("Sæson 1 aktiv", s1?.status === "active", `${s1?.number}/${s1?.status}`, "1/active");

  // Brugerkonti bevaret
  const { count: userCount } = await supabase.from("users").select("id", { count: "exact", head: true });
  add("Brugerkonti bevaret", userCount === 30, userCount, "30");

  // Academy-kuld (#1308 ③ cohort-on-day-1): hvert menneske-hold skal have et kuld
  // på 3-5 offered-kandidater (academyGenerator INTAKE_MIN..MAX). teamIds er de
  // samme beta-manager-hold som academyIntake selv resolver (samme filter).
  const offeredRows = await fetchAllRows(() =>
    supabase.from("academy_intake").select("team_id, status").eq("status", "offered").order("team_id")
  );
  const offeredByTeam = {};
  for (const r of offeredRows) offeredByTeam[r.team_id] = (offeredByTeam[r.team_id] || 0) + 1;
  const cohortCounts = teamIds.map((id) => offeredByTeam[id] || 0);
  const allCohorts = cohortCounts.length > 0 && cohortCounts.every((c) => c >= 3 && c <= 5);
  add("Hvert hold har academy-kuld (3-5 offered)", allCohorts, `[${cohortCounts.join(",")}]`, "alle 3-5");

  // Academy-intake idempotent: en gentaget intake mod den seedede branch må IKKE
  // generere nye kuld (hold allerede i academy_intake springes over).
  const reIntake = await runAcademyIntake(supabase, { dryRun: false });
  add("Academy-intake idempotent (re-run = 0 nye)",
    reIntake.teams === 0 && reIntake.candidates === 0,
    `teams=${reIntake.teams} candidates=${reIntake.candidates}`, "0/0");

  // Founder-badge overlever en efterfølgende runFullBetaReset
  console.log("\n-- Kører efterfølgende runFullBetaReset (founder-badge survival-tjek) --");
  await runFullBetaReset(supabase, { clearTransactions: true });
  const { data: badgeAfter } = await supabase.from("manager_achievements").select("user_id").eq("achievement_id", "founder_badge");
  const survived = new Set((badgeAfter || []).map((r) => r.user_id));
  const allSurvived = [...eligible].every((u) => survived.has(u)) && eligible.size > 0;
  add("Founder-badge overlever runFullBetaReset", allSurvived, `${survived.size}/${eligible.size}`, "alle");

  // Rollback: reactivateLegacyRiders
  console.log("\n-- Rollback-tjek: reactivateLegacyRiders --");
  const beforeRollback = await countRiders([["not", "pcm_id", "is", null], ["is", "is_retired", false]]);
  const rb = await reactivateLegacyRiders(supabase, { dryRun: false });
  const afterRollback = await countRiders([["not", "pcm_id", "is", null], ["is", "is_retired", false]]);
  add("Rollback flipper legacy tilbage til aktiv", afterRollback > beforeRollback && afterRollback === 8994,
    `${beforeRollback} → ${afterRollback} (reactivated ${rb.reactivated})`, "8994");

  // Re-retire så DB efterlades i relaunch-tilstand (oprydning af rollback-tjek)
  await retireLegacyRiders(supabase, { dryRun: false });

  const passCount = results.filter((r) => r.pass).length;
  console.log(`\n=== RESULTAT: ${passCount}/${results.length} PASS ===`);
  process.exit(passCount === results.length ? 0 : 2);
}

main().catch((e) => { console.error("❌", e.stack || e.message); process.exit(1); });
