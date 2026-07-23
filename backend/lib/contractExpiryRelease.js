// backend/lib/contractExpiryRelease.js
// #2744 · Rytterkontrakt-udløb → fri-agent ved sæsonskifte.
//
// Ejer-beslutning 23/7 (valg B, #2744): ryttere hvis kontrakt er udløbet frigives
// til fri-agent-poolen VED sæsonskiftet, i stedet for at blive på holdet med en
// kontrakt ingen håndhæver (det hul #2744 dokumenterede: contract_end_season blev
// aflæst af emitContractExpiringNotifications, men intet frigav rytteren).
//
// Dette er den FØRSTE gang mekanikken nogensinde kører (S1 → S2, 2026-07-27):
// 196 ejede ryttere har contract_end_season=1 i prod (verificeret 23/7 — 1 på et
// menneskehold, 195 på AI-hold).
//
// contract_end_season = sidste AKTIVE sæson for kontrakten (contractSeed.js,
// computeContractEndSeason). En rytter er moden til frigivelse når sæsonen der
// netop er afsluttet (seasonNumber-param = fromSeason.number) er >= hans
// contract_end_season. `<=` (IKKE `=`) så en overset kørsel selv-heler ved næste
// transition i stedet for at bære en udløbet kontrakt videre for evigt.
//
// Samme diskriminator som resten af markeds-motoren (#1308): akademiryttere
// tæller ikke mod senior-cap og har ikke kontraktfelter fra contractSeed — filteret
// holdes alligevel eksplicit (match UI'ets filter, [[feedback_match_ui_filter_for_capacity_logic]]).
//
// #2617/#1995-parræl: en rytter midt i et AKTIVT fleretape-løb kan ikke parkeres
// her (at gå til team_id=null har ingen pending-repræsentation — samme
// begrænsning som squadEnforcement.executeAutoSale er dokumenteret med). Deltaget
// rytter beholder sin (stadig udløbne) contract_end_season og fanges af den NÆSTE
// kørsel af denne funktion (idempotent `<=`-forespørgsel, ikke `=`).

import { fetchAllRows } from "./supabasePagination.js";
import { closeTransferListingsForRiders } from "./marketUtils.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";
import { getRidersInActiveStageRace } from "./stageRaceTransferDefer.js";
import { notifyUser as defaultNotifyUser } from "./notificationService.js";

export const CONTRACT_EXPIRED_RELEASE_TYPE = "contract_expired_release";

/**
 * #2744 · Byg payloaden for "kontrakten udløb, rytteren er nu fri agent"
 * -notifikationen. EN-first fallback (#1068); locale-aware rendering via
 * metadata-koderne (notif.contractExpiredRelease.*, #666-mønster).
 */
export function buildContractExpiredReleaseNotification({ riderName, riderId, seasonNumber }) {
  return {
    type: CONTRACT_EXPIRED_RELEASE_TYPE,
    title: "Rider released: contract expired",
    message: `${riderName}'s contract expired at the end of season ${seasonNumber}. He is now a free agent.`,
    relatedId: riderId ?? null,
    metadata: {
      riderId: riderId ?? null,
      titleCode: "notif.contractExpiredRelease.title",
      titleParams: {},
      messageCode: "notif.contractExpiredRelease.message",
      messageParams: { rider: riderName, season: seasonNumber },
    },
  };
}

async function defaultFetchExpiredContractRiders({ supabase, seasonNumber }) {
  return fetchAllRows(() =>
    supabase
      .from("riders")
      .select("id, firstname, lastname, team_id, contract_end_season, team:team_id!inner(user_id, is_ai, is_frozen)")
      .not("team_id", "is", null)
      .eq("is_academy", false)
      .lte("contract_end_season", seasonNumber)
      .order("id")
  );
}

/**
 * #2744-B · Frigør ryttere hvis kontrakt er udløbet ved den netop afsluttede sæson.
 * Kaldes fra seasonTransition.js som en ny, isoleret fase (parallelt med
 * sponsor_contracts_renewal) — en fejl her må ALDRIG vælte resten af transitionen
 * (samme disciplin som de øvrige additive faser).
 *
 * Idempotent: en frigjort rytter får contract_end_season=null, så en re-run
 * (samme sæson) finder ham ikke igen. `<=` selv-heler en evt. tidligere overset
 * kørsel.
 *
 * @param {object} args
 * @param {object} args.supabase
 * @param {number} args.seasonNumber — den AFSLUTTEDE sæsons nummer (fromSeason.number)
 * @param {Function} [args.notify] — injicerbar (test)
 * @param {Function} [args.fetchExpiredContractRiders] — injicerbar (test)
 * @returns {Promise<{candidates:number, released:number, deferredByRacing:number, notified:number, notifyFailed:number}>}
 */
export async function releaseExpiredContractRiders({
  supabase,
  seasonNumber,
  notify = defaultNotifyUser,
  fetchExpiredContractRiders = defaultFetchExpiredContractRiders,
}) {
  const stats = { candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0 };
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!Number.isFinite(seasonNumber)) return stats;

  const candidates = await fetchExpiredContractRiders({ supabase, seasonNumber });
  stats.candidates = candidates.length;
  if (!candidates.length) return stats;

  const racingIds = new Set(
    await getRidersInActiveStageRace(supabase, candidates.map((r) => r.id))
  );
  const toRelease = candidates.filter((r) => !racingIds.has(r.id));
  stats.deferredByRacing = candidates.length - toRelease.length;

  for (const rider of toRelease) {
    // Concurrency-guard: kun frigør hvis rytteren stadig er på det hold vi læste
    // (en parallel handel kan i teorien have flyttet ham imellem).
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
    if (error) throw new Error(`releaseExpiredContractRiders(${rider.id}): ${error.message}`);
    if (!released || released.length === 0) continue;

    // #1906/#776/#822 forward-guards — samme mønster som squadEnforcement.executeAutoSale.
    await clearFutureRaceEntriesSafe({ supabase, riderId: rider.id, label: "contract_expiry_release" });
    await closeTransferListingsForRiders(supabase, [rider.id], "withdrawn");
    stats.released += 1;

    const ownerUserId = rider.team?.user_id;
    const isHumanOwned = Boolean(ownerUserId) && rider.team?.is_ai === false && rider.team?.is_frozen === false;
    if (isHumanOwned) {
      const riderName = `${rider.firstname ?? ""} ${rider.lastname ?? ""}`.trim();
      const payload = buildContractExpiredReleaseNotification({
        riderName, riderId: rider.id, seasonNumber,
      });
      try {
        const res = await notify({ supabase, userId: ownerUserId, ...payload });
        if (res?.delivered) stats.notified += 1;
      } catch (err) {
        stats.notifyFailed += 1;
        console.error(`  ❌ contract-expired-release-notifikation fejlede (rytter ${rider.id}):`, err?.message || err);
      }
    }
  }

  return stats;
}
