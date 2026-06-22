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
import { generateAndAllocateAiTeams } from "../../lib/aiTeamGenerator.js";
import { fetchAllRows } from "../../lib/supabasePagination.js";
import { INITIAL_BALANCE, POOL_TARGET_SIZE } from "../../lib/economyConstants.js";

const START_DATE = "2026-06-22"; // ejer-besluttet 2026-06-22
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
  // Anon ser via RLS (USING(true)) ALLE aktive pcm_id-null rækker — inkl. academy-
  // kandidaterne — så sammenlign mod fictionalActiveTotal (ikke fictionalMarket).
  const anonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
  if (!anonKey) {
    add("Fiktive synlige via anon (RLS-sti, ikke kun service-role)", false,
      "SUPABASE_ANON_KEY mangler i backend/.env — RLS-sti UVERIFICERET", `anon === ${fictionalActiveTotal}`);
  } else {
    const anonClient = createClient(SUPABASE_URL, anonKey);
    const { count: anonFictional, error: anonErr } = await anonClient.from("riders")
      .select("id", { count: "exact", head: true }).is("pcm_id", null).eq("is_retired", false);
    add("Fiktive synlige via anon (RLS-sti, ikke kun service-role)",
      !anonErr && anonFictional === fictionalActiveTotal && fictionalActiveTotal > 0,
      anonErr ? `anon-query fejl: ${anonErr.message}` : `anon=${anonFictional} vs service=${fictionalActiveTotal}`,
      `anon === service (${fictionalActiveTotal})`);
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

  // Sæson 1 aktiv (id medtages: board-tjekket nedenfor filtrerer transfer_windows på season_id)
  const { data: seasons } = await supabase.from("seasons").select("id, number, status").order("number");
  const s1 = (seasons || []).find((s) => s.number === 1);
  add("Sæson 1 aktiv", s1?.status === "active", `${s1?.number}/${s1?.status}`, "1/active");

  // Brugerkonti bevaret
  const { count: userCount } = await supabase.from("users").select("id", { count: "exact", head: true });
  add("Brugerkonti bevaret", userCount === 30, userCount, "30");

  // ── FORM-FRYS-FEATURES (#1608/#1690 · #1678 · #1680) ────────────────────────
  // 3 tjek tilføjet 2026-06-22: rehearsal-harnessen (18/6) testede ikke disse
  // forever-relaunch-features endnu. Verificeret mod faktisk skema/kode:
  // league_divisions (2026-06-21-league-divisions-pyramid.sql), teams.league_division_id
  // + teams.division (=tier), economyConstants.INITIAL_BALANCE,
  // transfer_windows.board_negotiation_state ('pending_5yr').

  // (a) Pyramide-allokering (#1608/#1690): 15 puljer (tier 1/2/4/8) + ALLE ægte-
  //     manager-hold i bunden (division/tier 4) med en tier-4-pulje-reference.
  const { data: poolRows } = await supabase.from("league_divisions").select("id, tier");
  const pools = poolRows || [];
  const tier4PoolIds = new Set(pools.filter((p) => p.tier === 4).map((p) => p.id));
  add("Pyramide: 15 league_divisions-puljer", pools.length === 15, pools.length, "15");

  const { data: managerTeamRows } = await supabase.from("teams")
    .select("league_division_id, division")
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false);
  const mgrTeams = managerTeamRows || [];
  const allBottomPlaced = mgrTeams.length > 0 && mgrTeams.every(
    (t) => t.league_division_id !== null && t.division === 4
  );
  const placedInDiv4 = mgrTeams.filter((t) => t.league_division_id !== null && t.division === 4).length;
  add("Pyramide: alle ægte-manager-hold i bunden (div 4 + pulje)", allBottomPlaced,
    `${placedInDiv4}/${mgrTeams.length} i div4+pulje`, `${mgrTeams.length}/${mgrTeams.length}`);

  const allPoolsTier4 = mgrTeams.length > 0 && mgrTeams.every((t) => tier4PoolIds.has(t.league_division_id));
  const tier4Used = mgrTeams.filter((t) => tier4PoolIds.has(t.league_division_id)).length;
  add("Pyramide: brugte puljer er tier-4-puljer", allPoolsTier4,
    `${tier4Used}/${mgrTeams.length} i tier-4-pulje`, `${mgrTeams.length}/${mgrTeams.length}`);

  // (b) Sæson-1-opstartsøkonomi (#1678): friske ægte-manager-hold beholder uberørt
  //     startkapital — sæson-1-sponsor er IKKE lagt oveni (economyEngine springer
  //     sponsor over når balance === INITIAL_BALANCE ved sæson 1). Balance-tjek er
  //     robust mod skemaet: finance_transactions har ingen reason_code-kolonne
  //     (FINANCE_REASON er metadata-only), så ledger-filtrering ville være skrøbelig.
  const { data: balanceRows } = await supabase.from("teams").select("balance")
    .eq("is_ai", false).eq("is_bank", false).eq("is_frozen", false).eq("is_test_account", false);
  const balances = (balanceRows || []).map((t) => Number(t.balance));
  const allInitialBalance = balances.length > 0 && balances.every((b) => b === INITIAL_BALANCE);
  const atInitial = balances.filter((b) => b === INITIAL_BALANCE).length;
  add("Opstart: ingen sæson-1-sponsor oveni startkapital (balance === INITIAL_BALANCE)",
    allInitialBalance, `${atInitial}/${balances.length} == ${INITIAL_BALANCE}`, `alle == ${INITIAL_BALANCE}`);

  // (c) Board låst OP (#1680): sæson-1-vinduet skal stå i 'pending_5yr' (ikke 'locked'),
  //     så sæson-2-onboarding-flowet (5yr→3yr→1yr) er åbent fra dag 1.
  const s1Season = (seasons || []).find((s) => s.number === 1);
  const { data: s1WindowRows } = s1Season
    ? await supabase.from("transfer_windows").select("board_negotiation_state").eq("season_id", s1Season.id)
    : { data: [] };
  const s1Windows = s1WindowRows || [];
  const boardUnlocked = s1Windows.length > 0 && s1Windows.every((w) => w.board_negotiation_state === "pending_5yr");
  add("Board låst OP i sæson 1 (window board_negotiation_state='pending_5yr')", boardUnlocked,
    s1Windows.length === 0 ? "intet sæson-1-vindue" : s1Windows.map((w) => w.board_negotiation_state).join(","),
    "pending_5yr");

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

  // ── AI-FYLD (#1688 · orchestrator-apply-trin 5.6) ───────────────────────────
  // AI-fyld blev wired ind som apply-trin 5.6 (generateAndAllocateAiTeams, #1701,
  // 2026-06-22) EFTER denne harness sidst blev rørt (#1698) — uden disse tjek var
  // HELE reset-kæden med AI-fyld end-to-end uverificeret (dry-run springer 5.6 over,
  // så koden kørte første gang reelt mod prod). Politik (frosset, #1688): tier 1/2
  // ALTID op til POOL_TARGET_SIZE (24); tier 3/4 KUN puljer med >=1 ægte manager.
  // Hvert AI-hold = 8-rytter-trup med fuld derive-hale (base_value +
  // rider_derived_abilities), is_ai=true, division=pool.tier, balance=INITIAL_BALANCE.
  // Unit-tests (aiTeamGenerator.test.js) dækker politik-logikken mod en DB-fri fake;
  // disse tjek beviser INTEGRATIONEN: at trin 5.6 kørte i den ægte orchestrator-apply
  // mod den ægte DB med den ægte squad-allokering (defaultAllocateSquadForTeam).
  const { data: aiPoolRows } = await supabase.from("league_divisions").select("id, tier");
  const aiPools = aiPoolRows || [];
  const { data: aiAllTeams } = await supabase.from("teams")
    .select("id, is_ai, is_bank, is_frozen, is_test_account, division, league_division_id, balance");
  const allTeamsArr = aiAllTeams || [];
  const isRealMgr = (t) => t.is_ai === false && !t.is_bank && !t.is_frozen && !t.is_test_account;
  const isAiTeamRow = (t) => t.is_ai === true;
  const poolTierById = new Map(aiPools.map((p) => [p.id, p.tier]));

  // (a) tier 1+2: ALTID fyldt til target (24). Managere bor i div 4, så feltet er ren AI.
  const t12Pools = aiPools.filter((p) => p.tier === 1 || p.tier === 2);
  const t12Filled = t12Pools.filter((p) =>
    allTeamsArr.filter((t) => t.league_division_id === p.id).length === POOL_TARGET_SIZE);
  add("AI-fyld: tier 1+2 puljer fyldt til target",
    t12Pools.length > 0 && t12Filled.length === t12Pools.length,
    `${t12Filled.length}/${t12Pools.length} == ${POOL_TARGET_SIZE}`, `alle == ${POOL_TARGET_SIZE}`);

  // (b) tier 3+4: fyldt til target KUN i puljer med >=1 ægte manager; ellers 0 AI.
  const t34Pools = aiPools.filter((p) => p.tier === 3 || p.tier === 4);
  const t34Ok = t34Pools.filter((p) => {
    const inPool = allTeamsArr.filter((t) => t.league_division_id === p.id);
    const mgrs = inPool.filter(isRealMgr).length;
    const ais = inPool.filter(isAiTeamRow).length;
    return mgrs >= 1 ? inPool.length === POOL_TARGET_SIZE : ais === 0;
  });
  add("AI-fyld: tier 3+4 fyldt kun hvor >=1 manager (ellers 0 AI)",
    t34Pools.length > 0 && t34Ok.length === t34Pools.length,
    `${t34Ok.length}/${t34Pools.length} følger politik`, `alle ${t34Pools.length}`);

  // (c) AI-hold-metadata: is_ai=true, division=pool.tier, pulje sat, balance=INITIAL_BALANCE.
  const aiTeams = allTeamsArr.filter(isAiTeamRow);
  const metaOk = aiTeams.filter((t) =>
    t.league_division_id != null
    && t.division === poolTierById.get(t.league_division_id)
    && Number(t.balance) === INITIAL_BALANCE);
  add("AI-fyld: AI-hold-metadata (division=tier + pulje + balance)",
    aiTeams.length > 0 && metaOk.length === aiTeams.length,
    `${metaOk.length}/${aiTeams.length} korrekte`, `alle ${aiTeams.length}`);

  // (d) 8-rytter-trup + data-hale. Fetch alle team-tilknyttede ryttere paginate'et og
  //     filtrér til AI i JS (undgår en kæmpe .in()-URL på hundredvis af id'er).
  const aiTeamIdSet = new Set(aiTeams.map((t) => t.id));
  const rosterRows = await fetchAllRows(() =>
    supabase.from("riders").select("id, team_id, base_value").not("team_id", "is", null).order("id"));
  const aiRiders = rosterRows.filter((r) => aiTeamIdSet.has(r.team_id));
  const aiRidersByTeam = {};
  for (const r of aiRiders) aiRidersByTeam[r.team_id] = (aiRidersByTeam[r.team_id] || 0) + 1;
  const aiSquadCounts = [...aiTeamIdSet].map((id) => aiRidersByTeam[id] || 0);
  const allSquads8 = aiSquadCounts.length > 0 && aiSquadCounts.every((c) => c === 8);
  add("AI-fyld: hvert AI-hold præcis 8 ryttere", allSquads8,
    `${aiSquadCounts.filter((c) => c === 8).length}/${aiSquadCounts.length} hold med 8`, "alle = 8");

  const aiNoBaseValue = aiRiders.filter((r) => r.base_value === null || r.base_value === undefined).length;
  add("AI-fyld: alle AI-ryttere har base_value (derive-hale)",
    aiRiders.length > 0 && aiNoBaseValue === 0,
    `${aiRiders.length - aiNoBaseValue}/${aiRiders.length} har base_value`, "0 mangler");

  const derivedAbilityRows = await fetchAllRows(() =>
    supabase.from("rider_derived_abilities").select("rider_id").order("rider_id"));
  const derivedSet = new Set(derivedAbilityRows.map((r) => r.rider_id));
  const aiMissingDerived = aiRiders.filter((r) => !derivedSet.has(r.id)).length;
  add("AI-fyld: alle AI-ryttere har rider_derived_abilities",
    aiRiders.length > 0 && aiMissingDerived === 0,
    `${aiMissingDerived} uden derived-abilities`, "0");

  // (e) Idempotent integration: et re-run mod den friske DB må hverken oprette eller
  //     fjerne hold (puljerne er allerede på target). Samme default-seed som apply.
  const reAi = await generateAndAllocateAiTeams({ supabase });
  add("AI-fyld idempotent (re-run = 0 created / 0 removed)",
    reAi.created === 0 && reAi.removed === 0,
    `created=${reAi.created} removed=${reAi.removed}`, "0/0");

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
