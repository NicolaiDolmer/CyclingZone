// Relaunch-orchestrator (#1103) — komponerer hele relaunch-sekvensen til en frisk,
// uafhængig sæson 1. Dry-run-default. Den ÆGTE prod-relaunch er hård-gatet på
// #1101 base_value-cutover (se assertRelaunchProdGuard + CLI).
//
// Sekvens (apply): retire legacy → fuld beta-reset → fiktiv population → backfill-kæde
// (physiology+abilities → typer → base_value SHADOW) → startholds → frisk sæson 1
// (sæson 0 → transition 0→1) → founder-badges.
//
// VIGTIGT om dry-run: en destruktiv sekvens kan ikke simuleres trofast uden writes
// (hvert trin afhænger af forrige trins writes). Dry-run = per-trin "ville-gøre"-preview
// mod NUVÆRENDE DB + ingen writes. Den ægte verifikation er en RIGTIG kørsel mod en
// disposabel preview-branch (ikke prod). Derfor springes reset + sæson-transition over
// i dry-run (de kræver hhv. destruktion og en sæson-0-row der først findes efter apply).

import { fetchAllRows } from "./supabasePagination.js";
import { foldNameNordic } from "./pcmRiderMatcher.js";
import { generateLaunchPopulation, LAUNCH_POPULATION } from "./fictionalLaunchPopulation.js";
import { toInsertPayload } from "./fictionalRiderGenerator.js";
import { retireLegacyRiders } from "./legacyRiderRetirement.js";
import { runFullBetaReset, getBetaManagerTeams, allocateLeaguePools } from "./betaResetService.js";
import { generateAndAllocateAiTeams, clearAllAiTeams } from "./aiTeamGenerator.js";
import { runPhysiologyBackfill, runRiderTypesBackfill, runBaseValueBackfill } from "./backfillCores.js";
import { runStarterSquadAllocation } from "./starterSquadAllocator.js";
import { runContractSeed } from "./contractSeed.js";
import { runAcademyIntake } from "./academyIntake.js";
import { isAcademyEnabled } from "./academyFlag.js";
import { grantFounderBadges } from "./founderBadge.js";
import { transitionToNextSeason, computeSeasonUuid } from "./seasonTransition.js";
import { startSequentialNegotiation } from "./boardSequentialNegotiation.js";

const INSERT_BATCH = 500;
export const RELAUNCH_CONFIRM_TOKEN = "RELAUNCH SEASON 1";
export const RELAUNCH_PROD_PROJECT_REF = "ghwvkxzhsbbltzfnuhhz";

// Prod-detektion (#1198 rel-M2): DNS/hostnames er case-insensitive, så
// https://GHWVKXZHSBBLTZFNUHHZ.supabase.co rammer prod selvom en case-sensitiv
// substring-match siger "non-prod" — og dermed ville HELE den lagdelte prod-guard
// (--target-prod + typed confirm + cutover-ack) blive omgået af en casing-/
// copy-paste-fejl i .env. Normalisér ALTID før sammenligning.
export function isProdSupabaseUrl(url, ref = RELAUNCH_PROD_PROJECT_REF) {
  return String(url || "").toLowerCase().includes(String(ref).toLowerCase());
}

// Generér + indsæt den låste launch-population (pcm_id null), navne-unikke mod DB.
export async function generateAndInsertPopulation(supabase, { dryRun = true } = {}) {
  const existing = await fetchAllRows(() => supabase.from("riders").select("firstname, lastname").order("id"));
  const folded = new Set(existing.map((r) => foldNameNordic(`${r.firstname} ${r.lastname}`)));
  const { riders } = generateLaunchPopulation(folded);
  const payload = toInsertPayload(riders);
  for (const r of payload) {
    if (r.pcm_id !== null) throw new Error("pre-flight: payload med pcm_id !== null — afbryder.");
  }
  if (dryRun) return { generated: payload.length, inserted: 0, dryRun: true };
  let inserted = 0;
  for (let i = 0; i < payload.length; i += INSERT_BATCH) {
    const batch = payload.slice(i, i + INSERT_BATCH);
    const { error } = await supabase.from("riders").insert(batch);
    if (error) throw new Error(`population insert ved ${i}: ${error.message}`);
    inserted += batch.length;
  }
  return { generated: payload.length, inserted };
}

// Genindsæt sæson 0 (deterministisk UUID, active) så transition 0→1 har en fromSeason.
export async function seedSeasonZero(supabase, { startDate, dryRun = true } = {}) {
  const seasonId = computeSeasonUuid(0);
  if (dryRun) return { seasonId, dryRun: true };
  const { error } = await supabase.from("seasons").insert({
    id: seasonId,
    number: 0,
    status: "active",
    start_date: startDate,
    end_date: null,
  });
  if (error) throw new Error(`seedSeasonZero: ${error.message}`);
  return { seasonId };
}

const DEFAULT_DEPS = {
  retireLegacyRiders,
  runFullBetaReset,
  generateAndInsertPopulation,
  runPhysiologyBackfill,
  runRiderTypesBackfill,
  runBaseValueBackfill,
  runStarterSquadAllocation,
  allocateLeaguePools,
  clearAllAiTeams,
  generateAndAllocateAiTeams,
  seedSeasonZero,
  transitionToNextSeason,
  startSequentialNegotiation,
  runAcademyIntake,
  runContractSeed,
  grantFounderBadges,
  getBetaManagerTeams,
};

export async function runRelaunchSeason1(supabase, {
  dryRun = true,
  startDate,
  seed = LAUNCH_POPULATION.seed,
  deps = {},
} = {}) {
  const d = { ...DEFAULT_DEPS, ...deps };
  const summary = { dryRun, startDate, seed };

  // 1. Pensionér legacy-ryttere (pcm_id IS NOT NULL).
  summary.retireLegacy = await d.retireLegacyRiders(supabase, { dryRun });

  // 2. Fuld game-state reset (springes i dry-run — destruktivt, kan ikke simuleres).
  summary.reset = dryRun
    ? { skipped: "dryRun" }
    : await d.runFullBetaReset(supabase, { clearTransactions: true });

  // 3. Fiktiv population (pcm_id null), navne-unik mod DB.
  summary.population = await d.generateAndInsertPopulation(supabase, { dryRun });

  // 4. Backfill-kæde: physiology+abilities → typer → base_value (SHADOW).
  summary.backfills = {
    physiology: await d.runPhysiologyBackfill(supabase, { dryRun }),
    types: await d.runRiderTypesBackfill(supabase, { dryRun }),
    baseValue: await d.runBaseValueBackfill(supabase, { dryRun }),
  };

  // 5. Startholds fra den fiktive pool.
  summary.allocation = await d.runStarterSquadAllocation(supabase, { dryRun, seed });

  // 5.5 #1608 Task 6 · pulje-spredende liga-allokering: placér alle ægte-manager-hold i
  // bunden (tier 4) + spred dem på de 8 div-4-puljer (race-levedygtighed). Kører EFTER
  // trup-allokering og FØR sæson-transitionen, så standings/race-grupperingen er sat når
  // sæson 1 åbner. runFullBetaReset (apply, trin 2) kalder også allocateLeaguePools, men
  // det er et idempotent re-run mod den FRISKE population her — pulje-fyldningen tælles
  // fra DB hver gang, så et gentaget kald giver samme jævne fordeling.
  // Springes i dry-run (kræver writes — kan ikke simuleres trofast, jf. reset/transition).
  summary.leaguePools = dryRun
    ? { skipped: "dryRun" }
    : await d.allocateLeaguePools(supabase);

  // 5.6 #1688 · AI-fyld. FØRST ryd alle pre-eksisterende AI-hold: reset'en bevarer is_ai-
  // hold, og generateAndAllocateAiTeams top-up'er/reconciler kun i puljer — så et phantom
  // AI-hold (fx prod's "AI" i div 1 med 0 ryttere) ville ellers overleve relaunchen som et
  // tomt felt-medlem. clear → regenerér hele AI-feltet validt. Derefter fyld per frosset
  // politik (tier 1/2 altid; tier 3/4 kun hvor en ægte manager bor — med managere i div 3
  // forbliver div 4 tom). Kører EFTER allocateLeaguePools (managerne er placeret, så tier-3-
  // politikken ser dem) og FØR sæson-transitionen. Springes i dry-run (kræver writes).
  if (dryRun) {
    summary.aiTeams = { skipped: "dryRun" };
  } else {
    summary.aiTeamsCleared = await d.clearAllAiTeams(supabase);
    summary.aiTeams = await d.generateAndAllocateAiTeams({ supabase, seed });
  }

  // 6. Frisk sæson 1 (sæson 0 → transition 0→1). Springes i dry-run (kræver sæson-0-row).
  if (dryRun) {
    summary.season = { dryRun: true, plan: "insert sæson 0 (active) → transitionToNextSeason 0→1" };
  } else {
    // dryRun: false SKAL være eksplicit — seedSeasonZero defaulter til dry-run,
    // og uden insert fejler transitionen på den deterministiske sæson-0-UUID
    // (fundet i rehearsal #1191, 11/6).
    const s0 = await d.seedSeasonZero(supabase, { startDate, dryRun: false });
    summary.season = await d.transitionToNextSeason({ supabase, fromSeasonId: s0.seasonId, transitionAt: startDate });
  }

  // 6.2 #1680 · Bestyrelse låst OP fra start i sæson 1 (ejer-direktiv 2026-06-21).
  // transitionToNextSeason oprettede sæson-1-vinduet med DB-default 'locked' (baseline-
  // observation), så managere ville ikke kunne forhandle planer før sæson 2. Vi flipper
  // det til 'pending_5yr' via den eksisterende, testede unlock-primitiv
  // (startSequentialNegotiation = slet baseline-rows + sæt vindue pending_5yr), så
  // sæson-2-onboarding-flowet (5yr → 3yr → 1yr) er åbent fra dag 1 i sæson 1.
  //
  // SPONSOR-NEUTRALITET (verificeret): sæson-1-sponsoren betales i processSeasonStart
  // UNDER transitionen ovenfor — FØR denne oplåsning og før nogen plan kan forhandles —
  // og board-modifieren udregnes dér fra completed boards (baseline=1.0 / ingen → 1.0).
  // En plan signeret i sæson 1 påvirker derfor først sæson-2-sponsoren (præcis som den
  // eksisterende sæson-2-onboarding); oplåsningen rykker kun forhandlings-vinduet én
  // sæson frem og indfører INGEN ny modifier-interaktion. Med renown-sponsor (#1663) er
  // payouten desuden capped på guaranteed_base × MAX_BOARD_MODIFIER, så board-modifier +
  // renown ikke kan dobbelt-tælle. Springes i dry-run (kræver sæson-1-vinduet fra apply).
  if (dryRun) {
    summary.boardUnlock = { skipped: "dryRun", plan: "startSequentialNegotiation → window pending_5yr" };
  } else {
    summary.boardUnlock = await d.startSequentialNegotiation({ supabase });
  }

  // 6.4 Akademi-intake: kandidat-kuld pr. menneske-hold (efter sæson-transition,
  // så aktiv sæson = 1). No-op når academy_enabled=false.
  summary.academy = (await isAcademyEnabled(supabase))
    ? await d.runAcademyIntake(supabase, { dryRun, seed })
    : { skipped: "academy_enabled=false" };

  // 6.5 Kontrakt-seed: frossen løn + længde + udløb på ejede ryttere.
  // Kører efter sæson-transition så aktiv sæson-number (= 1) er kendt.
  // I dry-run previewer den mod nuværende DB (ingen writes).
  summary.contracts = await d.runContractSeed(supabase, { dryRun, seed });

  // 7. Founder-badges (grant sikrer også def'en; overlever fremtidige resets).
  const teams = await d.getBetaManagerTeams(supabase);
  const managerUserIds = teams.map((t) => t.user_id).filter(Boolean);
  summary.founderBadge = await d.grantFounderBadges(supabase, { dryRun, managerUserIds });

  return summary;
}

// Lagdelt prod-opt-in (testbar, brugt af CLI). Dry-run-default; prod kræver
// eksplicit --target-prod + typed confirm + #1101-cutover-ack.
export function assertRelaunchProdGuard({ apply, isProd, targetProd, confirm, cutoverAck } = {}) {
  if (!apply) return { proceed: false, reason: "dry-run (no --apply)" };
  if (!isProd) return { proceed: true, target: "non-prod" };
  if (!targetProd) throw new Error("Prod-env detekteret. Nægter --apply uden eksplicit --target-prod.");
  if (confirm !== RELAUNCH_CONFIRM_TOKEN) throw new Error(`Prod-apply kræver --confirm "${RELAUNCH_CONFIRM_TOKEN}".`);
  if (cutoverAck !== "true") {
    throw new Error("Blokeret: #1101 base_value-cutover ikke kvitteret (sæt RELAUNCH_1101_CUTOVER_ACK=true først).");
  }
  return { proceed: true, target: "PROD" };
}
