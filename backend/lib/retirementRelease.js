// backend/lib/retirementRelease.js
// #2748 · Pension → fri trup-plads ved sæsonskifte.
//
// Ejer-beslutning 23/7: en pensioneret rytter forlader truppen AUTOMATISK, præcis
// som en rytter med udløbet kontrakt gør det (#2744-B, contractExpiryRelease.js).
// Manageren skal ikke selv opdage og frigive ham.
//
// HULLET DETTE LUKKER: riderProgressionEngine.developRidersForSeason satte kun
// `is_retired = true` (riderPatch, via apply_rider_development-RPC'en) og rørte
// ALDRIG team_id. Rytteren blev dermed hængende på holdet for evigt — usynlig for
// løbsudtagelse (riderEligibility.applyRiderEligibilityFilter ekskluderer
// is_retired), men fuldt tællende i alt der måler TRUP-STØRRELSE:
//   · squadEnforcement.getSquadSnapshot   (min/max-håndhævelse, tvangssalg)
//   · marketUtils.getTeamMarketState      (cap-spærre ved køb/handel/auktion)
//   · DashboardPage/TeamPage/AuctionsPage (managerens egen trup-visning)
// Resultatet ville være permanent dødvægt: en plads af MAX_SQUAD_SIZE=30 optaget
// af en rytter der aldrig kan køre et løb igen — og som payroll ville trække løn
// for hver sæson (loadHumanSeasonEndTeams filtrerer heller ikke is_retired).
//
// Pension har ALDRIG fyret i prod før (S1 → S2, 2026-07-27 er første gang), så
// der er nul historisk skade at rydde op i — men fra og med det skifte ville de
// hobe sig op sæson for sæson.
//
// HVORFOR DETTE ER DEN SEMANTIK #2748 ALLEREDE ER BYGGET PÅ: squadRiskGuard.js
// (#2748-A) klassificerer en pensionsmoden rytter som en der "forlader holdet AF
// SIG SELV ved næste transition" og spærrer salg der ville efterlade truppen for
// tynd. Uden denne frigivelse ville den spærre bygge på en afgang der aldrig sker.
// Samme retning som den eksisterende præcedens i legacyRiderRetirement.js, der
// pensionerer med `{ is_retired: true, team_id: null }`.
//
// IDEMPOTENS / SELV-HELING: forespørgslen er tilstands-baseret (is_retired = true
// AND team_id IS NOT NULL), ikke sæson-baseret. En frigjort rytter har team_id =
// null og findes derfor aldrig igen — og en kørsel der blev afbrudt midtvejs
// samler selv resten op ved næste transition. Det fanger også ryttere pensioneret
// ad andre veje end sæson-motoren (admin-endpointet i routes/api.js sætter
// ligeledes kun is_retired).
//
// FORSKEL FRA #2744-B (bevidst): contractExpiryRelease udskyder ryttere der er
// midt i et AKTIVT fleretape-løb (#2617/#1995). Det gør denne fase IKKE — og det
// er ikke en forglemmelse: `is_retired = true` er allerede skrevet af
// progressions-motoren FØR vi kommer hertil, og raceEntriesLoader/riderEligibility
// filtrerer på præcis det felt ved oplæsning. Rytteren er altså ude af løbet
// uanset hvad vi gør med team_id; at udskyde ville kun forsinke plads-frigivelsen
// uden at redde en eneste startplads. clearFutureRaceEntriesSafe rører i øvrigt
// kun endnu-ikke-startede løb (status='scheduled' AND stages_completed=0), så et
// igangværende etapeløbs historik er urørt.

import { fetchAllRows } from "./supabasePagination.js";
import {
  closeTransferListingsForRiders,
  withdrawOpenTransferDealsForRiders,
} from "./marketUtils.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";
import { captureException } from "./sentry.js";

async function defaultFetchRetiredOwnedRiders({ supabase }) {
  // Bemærk: INGEN is_academy-filtrering her (modsat contractExpiryRelease, hvor den
  // markerer "har ingen kontraktfelter"). Pension er ubetinget — en pensioneret
  // rytter er dødvægt uanset hvilken trup-liste han står på. I praksis kan en
  // akademirytter ikke nå pensionsvinduet (windowStartAge=36 vs. graduering ved 21),
  // så filteret ville alligevel være en no-op; at udelade det gør fasen robust hvis
  // en akademirytter nogensinde pensioneres ad en anden vej.
  return fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, firstname, lastname, team_id")
      .eq("is_retired", true)
      .not("team_id", "is", null)
      .order("id")
  );
}

/**
 * #2748 · Frigiv alle pensionerede ryttere der stadig står på et hold.
 *
 * Kaldes fra seasonTransition.js som en isoleret fase EFTER rytterudviklingen
 * (som er der pensioneringen sættes) — en fejl her må ALDRIG vælte resten af
 * transitionen, samme disciplin som contract_expiry_release/global_rank_decay.
 *
 * Notifikation sendes IKKE herfra: riderProgressionEngine udsender allerede
 * `rider_retired` til ejeren i samme transition, læst på team_id FØR denne fase
 * nulstiller det. En ekstra besked her ville dublere den. Ryttere som fasen
 * selv-heler (pensioneret ad anden vej, fx admin-endpointet) får derfor ingen
 * besked — bevidst, da den oprindelige handling ejer sin egen kommunikation.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {Function} [args.fetchRetiredOwnedRiders] — injicerbar (test)
 * @returns {Promise<{candidates:number, released:number, failed:number}>}
 *
 * Partial-failure-observability spejler contractExpiryRelease: hver rytter er
 * isoleret i sit eget try/catch, og kaster funktionen før loopet, hænges de indtil
 * da akkumulerede stats på `err.partialStats`.
 */
export async function releaseRetiredRiders({
  supabase,
  fetchRetiredOwnedRiders = defaultFetchRetiredOwnedRiders,
}) {
  const stats = { candidates: 0, released: 0, failed: 0 };
  if (!supabase?.from) throw new Error("Supabase client required");

  let candidates;
  try {
    candidates = await fetchRetiredOwnedRiders({ supabase });
  } catch (err) {
    err.partialStats = { ...stats };
    throw err;
  }
  stats.candidates = candidates.length;
  if (!candidates.length) return stats;

  for (const rider of candidates) {
    try {
      // Concurrency-guard: frigiv kun hvis rytteren stadig står på det hold vi læste.
      const { data: released, error } = await supabase
        .from("riders")
        .update({
          team_id: null,
          pending_team_id: null,
          salary: null,
          contract_length: null,
          contract_end_season: null,
          acquired_at: null,
        })
        .eq("id", rider.id)
        .eq("team_id", rider.team_id)
        .select("id");
      if (error) throw new Error(`releaseRetiredRiders(${rider.id}): ${error.message}`);
      if (!released || released.length === 0) continue;

      // #1906 ghost-guard + #776/#822 zombie-listing-guard. Modsat #2744-B trækker vi
      // OGSÅ åbne transfer-/swap-tilbud tilbage: en pensioneret rytter må ikke kunne
      // købes videre via et tilbud oprettet før pensionen (oprettelses-gaterne i
      // routes/api.js afviser retirede ryttere, men gen-tjekker ikke ved accept).
      await clearFutureRaceEntriesSafe({ supabase, riderId: rider.id, label: "retirement_release" });
      await closeTransferListingsForRiders(supabase, [rider.id], "withdrawn");
      await withdrawOpenTransferDealsForRiders(supabase, [rider.id]);
      stats.released += 1;
    } catch (err) {
      stats.failed += 1;
      console.error(`  ❌ retirement-release fejlede for rytter ${rider.id}:`, err?.message || err);
      captureException(err, { tags: { flow: "season-transition", stage: "retirement-release" }, riderId: rider.id });
    }
  }

  return stats;
}
