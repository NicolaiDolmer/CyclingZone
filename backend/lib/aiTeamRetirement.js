// #4753 · AI-hold NEDLÆGGES i stedet for at hård-slettes.
//
// ROD-ÅRSAGEN denne fil fjerner: trim-stien (aiTeamGenerator.removeAiTeams /
// deleteAiTeamById) slettede `riders` og `teams`. Enhver tabel med en NO ACTION-FK
// mod dem kunne derfor blokere trimmen, og der er kommet en ny hver måned siden juli:
//   #2074 race_entries (DB-trigger) → #2389 race_results/uudbetalte præmier →
//   #4233 transfer_offers (rider_id + seller_team_id, begge NO ACTION).
// Hver gang blev symptomet fikset (spring kandidaten over, udskyd via
// pending_removal_at) og klassen efterladt. Måling 4/9: 4 af 15 puljer stod på 25
// hold, og 13 AI-hold var PERMANENT utrimbare fordi de var blokeret udelukkende af
// DØDE transfer_offers (withdrawn/accepted/rejected — de forsvinder aldrig af sig selv).
//
// LØSNINGEN: nedlæg holdet. Ingen DELETE. Så kan intet FK nogensinde blokere igen,
// og historikken (holdets navn, dets tilbud, dets resultater) bevares i stedet for at
// blive SET NULL'et væk.
//
// TILSTANDEN et nedlagt hold ender i:
//   teams:  retired_at = now, league_division_id = NULL, pending_removal_at = NULL
//   riders: is_retired = true, team_id = NULL  (+ listings lukket, åbne tilbud trukket,
//           fremtidige race_entries ryddet, ønskeliste-ejere notificeret)
//
// league_division_id = NULL ER pulje-exiten. Det er ikke en ny mekanik: præcis samme
// "frigiv pladsen"-skridt som managerParking.parkTeam (#4592), og #4183 gjorde
// `league_division_id = pool.id` til den kanoniske occupancy-nøgle. Alle pulje-tællere
// (generateAndAllocateAiTeams, reconcileAiTeamsForPool, aiTeamTrimHealSweep's
// budget-gate, audit-league-size-invariant.js) nøgler på den kolonne, så puljen falder
// til 24 i samme øjeblik.
//
// RYTTERNE pensioneres frem for at frigives som frie agenter. Det er valget der bevarer
// spillerens oplevelse uændret: i dag SLETTES de, altså forsvinder de fra
// rytterdatabasen/markedet/rankings — og præcis dét gør `is_retired = true` også, fordi
// hver eneste af de flader allerede filtrerer på feltet (/api/riders,
// riderEligibility.applyRiderEligibilityFilter, marketUtils.getTeamMarketState,
// squadEnforcement, auctionRules, riderProgressionEngine, marketValueSundaySweep m.fl.).
// Alternativet — frigiv ~20 ryttere pr. hold som frie agenter — ville lægge ~260 ryttere
// i markedet på én gang. Det er en produktbeslutning, ikke en bugfix. Tilstanden
// `{ is_retired: true, team_id: null }` er i øvrigt nøjagtigt den
// legacyRiderRetirement.js og retirementRelease.js (#2748) allerede lander på, så der
// opstår ingen ny semantik.
//
// GUARDS: de tre eksisterende blokeringer var alle FK-guards mod SLETNING. Under
// nedlæggelse skal hver enkelt begrundes på ny:
//   · inflight race_entries (#2074)  → BEHOLDES. Et hold midt i et etapeløb skal køre
//     løbet færdigt; feltet må ikke skifte under et kørende løb.
//   · uudbetalte præmier (#2389)     → BEHOLDES. Payout + standings-recalc læser holdet.
//   · LEVENDE transfer_offers        → BEHOLDES, men som spiller-hensyn: en manager står
//     midt i en forhandling, og hans modpart må ikke fordufte.
//   · DØDE transfer_offers           → BORTFALDER. Den ENESTE grund til at de blokerede
//     var DELETE'en. Der er ingen DELETE mere. Det er hele fixet for de 13 hold.
// "Levende" = ACTIVE_MARKET_STATUSES fra transferExecution.js/marketUtils.js
// (pending/countered/awaiting_confirmation) — samme delte definition, ikke en ny liste.

import { fetchAllRows } from "./supabasePagination.js";
import {
  closeTransferListingsForRiders,
  withdrawOpenTransferDealsForRiders,
} from "./marketUtils.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";
import { notifyAndClearWatchlistForRiders } from "./notificationService.js";

// Spejler ACTIVE_MARKET_STATUSES (transferExecution.js) og openStatuses
// (marketUtils.withdrawOpenTransferDealsForRiders). Ét begreb om "tilbuddet lever".
export const LIVE_OFFER_STATUSES = ["pending", "countered", "awaiting_confirmation"];

// Rytter-id-chunk for .in()-lister. Samme 100 som hård-slet-stien brugte: en lang
// in-liste sprænger gateway'ens URL-grænse (~16 KB, ramte 26/7 ved 24 hold).
const RIDER_CHUNK = 100;

/**
 * Har holdet LEVENDE transfer-tilbud (som køber-modpart på en af dets ryttere, eller
 * som sælger)? Kun disse udskyder en nedlæggelse — døde tilbud er irrelevante når
 * intet slettes.
 *
 * Bevidst IKKE en variant af teamHasBlockingTransferOffers (aiTeamGenerator.js):
 * dén funktion svarer på "kan denne række hård-slettes?" og skal blive ved med at
 * gøre præcis det så længe hård-slet-stien findes bag flaget. Denne svarer på et
 * andet spørgsmål — "er en spiller midt i noget med dette hold?".
 *
 * @param {object} supabase
 * @param {string} teamId
 * @returns {Promise<boolean>}
 */
export async function teamHasLiveTransferOffers(supabase, teamId) {
  const { data: asSeller, error: sellerErr } = await supabase
    .from("transfer_offers")
    .select("id")
    .eq("seller_team_id", teamId)
    .in("status", LIVE_OFFER_STATUSES)
    .limit(1);
  if (sellerErr) throw new Error(`AI-retire (live transfer_offers seller for ${teamId}): ${sellerErr.message}`);
  if ((asSeller || []).length > 0) return true;

  const riderIds = await fetchTeamRiderIds(supabase, teamId);
  if (!riderIds.length) return false;

  for (let i = 0; i < riderIds.length; i += RIDER_CHUNK) {
    const chunk = riderIds.slice(i, i + RIDER_CHUNK);
    const { data: offers, error: offerErr } = await supabase
      .from("transfer_offers")
      .select("id")
      .in("rider_id", chunk)
      .in("status", LIVE_OFFER_STATUSES)
      .limit(1);
    if (offerErr) throw new Error(`AI-retire (live transfer_offers riders for ${teamId}): ${offerErr.message}`);
    if ((offers || []).length > 0) return true;
  }
  return false;
}

// Pagineret: en trunkeret liste ville misse præcis den rytter der betyder noget
// (samme disciplin som #2389/#4233).
async function fetchTeamRiderIds(supabase, teamId) {
  const rows = await fetchAllRows(() => supabase
    .from("riders")
    .select("id, firstname, lastname")
    .eq("team_id", teamId)
    .order("id", { ascending: true }));
  return (rows || []).map((r) => r.id);
}

async function fetchTeamRiders(supabase, teamId) {
  return fetchAllRows(() => supabase
    .from("riders")
    .select("id, firstname, lastname")
    .eq("team_id", teamId)
    .order("id", { ascending: true }));
}

/**
 * Nedlæg ÉT AI-hold. Ingen DELETE på hverken `teams` eller `riders`.
 *
 * Rækkefølgen er ikke tilfældig: rytterne læses FØR team_id nulstilles (ellers kan
 * de ikke findes igen), og holdet markeres SIDST — så en afbrudt kørsel efterlader et
 * hold der stadig ligger i puljen og bliver forsøgt igen, i stedet for et hold der er
 * ude af puljen med halvt sin trup intakt. Idempotent: en genkørsel finder 0 ryttere
 * tilbage på holdet og skriver den samme slut-tilstand igen.
 *
 * @param {object} supabase
 * @param {string} teamId
 * @param {{ now?: Date }} [opts]
 * @returns {Promise<{ retired: boolean, ridersRetired: number }>}
 */
export async function retireAiTeam(supabase, teamId, { now = new Date() } = {}) {
  const riders = await fetchTeamRiders(supabase, teamId);
  const riderIds = riders.map((r) => r.id);

  // 1) Rytterne pensioneres + forlader truppen. Chunket som hård-slet-stien var:
  //    én update over hele truppen er stadig ét statement pr. chunk, langt under
  //    authenticator-rollens statement_timeout=8s (cutover-fixet 23/8).
  for (let i = 0; i < riderIds.length; i += RIDER_CHUNK) {
    const chunk = riderIds.slice(i, i + RIDER_CHUNK);
    const { error } = await supabase
      .from("riders")
      .update({ is_retired: true, team_id: null, pending_team_id: null })
      .in("id", chunk);
    if (error) throw new Error(`AI-retire (rider retire for ${teamId}): ${error.message}`);
  }

  // 2) Markeds-/løbs-oprydning pr. rytter — samme kæde som retirementRelease.js
  //    (#2748) kører når en rytter pensioneres af alder. Uden den ville et tilbud
  //    oprettet før nedlæggelsen kunne accepteres bagefter (#1748/#1906).
  for (const rider of riders) {
    await clearFutureRaceEntriesSafe({ supabase, riderId: rider.id, label: "ai_team_retirement" });
  }
  for (let i = 0; i < riderIds.length; i += RIDER_CHUNK) {
    const chunk = riderIds.slice(i, i + RIDER_CHUNK);
    await closeTransferListingsForRiders(supabase, chunk, "withdrawn");
    await withdrawOpenTransferDealsForRiders(supabase, chunk);
  }

  // 3) #2524: ønskeliste-ejere skal have besked. Rytteren SLETTES ikke længere, men
  //    han forlader spillet lige så endeligt set fra en watcher — samme besked.
  if (riders.length) {
    await notifyAndClearWatchlistForRiders({ supabase, riders });
  }

  // 4) Holdet forlader puljen. pending_removal_at ryddes: markøren betyder "burde
  //    trimmes, men er udskudt", og holdet ER nu trimmet — en efterladt markør ville
  //    gøre holdet til kandidat i aiTeamTrimHealSweep for evigt.
  const { error: teamErr } = await supabase
    .from("teams")
    .update({
      retired_at: now.toISOString(),
      league_division_id: null,
      pending_removal_at: null,
    })
    .eq("id", teamId);
  if (teamErr) throw new Error(`AI-retire (team row for ${teamId}): ${teamErr.message}`);

  return { retired: true, ridersRetired: riderIds.length };
}
