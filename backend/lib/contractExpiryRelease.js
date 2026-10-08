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
//
// #5864 (rod-årsag, ejer-beslutning 28/9 valg B + 6/10): forespørgslen hentede
// kun SENIORTRUPPEN (applySeniorSquadFilter), så udløbne U23-, junior- og
// akademiryttere blev aldrig frigivet ved S2→S3 eller S3→S4. Normalvejen henter
// nu også ungdomstrupperne på MENNESKEHOLD (samme ejendomsfilter). AI-holdenes
// ungdom er bevidst uden for: Phase 5b-2 (aiContractAutoRenewal.js) fornyer kun
// senior, så en AI-ungdomstrup ville ellers blive tømt uden en manager der kan
// forlænge. Frigivne akademiryttere får is_academy=false i SAMME update (squad
// bevares), samme form som en fri ungdomsrytter fra academyGenerator; det var
// tidligere et separat efter-trin i enforce5864ExpiredContracts.mjs (PR #6198).

import { fetchAllRows } from "./supabasePagination.js";
import { applySeniorSquadFilter } from "./squads.js";
import { closeTransferListingsForRiders } from "./marketUtils.js";
import { clearFutureRaceEntriesSafe } from "./raceEntryCleanup.js";
import { getRidersInActiveStageRace } from "./stageRaceTransferDefer.js";
import { notifyUser as defaultNotifyUser } from "./notificationService.js";
import { captureException } from "./sentry.js";

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

const EXPIRED_RIDER_SELECT =
  "id, firstname, lastname, team_id, squad, is_academy, contract_end_season, team:team_id!inner(user_id, is_ai, is_frozen, is_bank, is_test_account)";

/** Seniortruppen på alle gameplay-hold (menneske + AI). Uændret siden #2744-B/#2847. */
export async function fetchExpiredSeniorContractRiders({ supabase, seasonNumber }) {
  return fetchAllRows(() =>
    applySeniorSquadFilter(
      supabase
        .from("riders")
        // #2847 · ejendomsfilter (is_bank/is_frozen/is_test_account) — samme
        // diskriminator som aiContractAutoRenewal.js' defaultFetchExpiringAiContractRiders.
        // Uden den ville frigivelsen også ramme ryttere ejet af ikke-gameplay-hold
        // (harmløst i dag: 0 sådanne rækker med contract_end_season=1 i prod 23/7,
        // men uindskrænket for fremtidige sæsoners kørsler).
        .select(EXPIRED_RIDER_SELECT)
        .not("team_id", "is", null)
    )
      .lte("contract_end_season", seasonNumber)
      .eq("team.is_bank", false)
      .eq("team.is_frozen", false)
      .eq("team.is_test_account", false)
      .order("id")
  );
}

/**
 * #5864 · Ungdomstrupperne (u23/junior og akademiet) på MENNESKEHOLD: præcis
 * komplementet til applySeniorSquadFilter (squad != senior ELLER is_academy),
 * samme ejendomsfilter, kun is_ai=false (se fil-headeren for hvorfor AI er ude).
 */
export async function fetchExpiredYouthContractRiders({ supabase, seasonNumber }) {
  return fetchAllRows(() =>
    supabase
      .from("riders")
      .select(EXPIRED_RIDER_SELECT)
      .not("team_id", "is", null)
      .or("squad.neq.senior,is_academy.eq.true")
      .eq("is_retired", false)
      .lte("contract_end_season", seasonNumber)
      .eq("team.is_ai", false)
      .eq("team.is_bank", false)
      .eq("team.is_frozen", false)
      .eq("team.is_test_account", false)
      .order("id")
  );
}

/** Senior + ungdom, deduplikeret på id (de to filtre er disjunkte, men vær robust). */
export async function defaultFetchExpiredContractRiders({ supabase, seasonNumber }) {
  const [senior, youth] = await Promise.all([
    fetchExpiredSeniorContractRiders({ supabase, seasonNumber }),
    fetchExpiredYouthContractRiders({ supabase, seasonNumber }),
  ]);
  const byId = new Map();
  for (const r of [...senior, ...youth]) if (!byId.has(r.id)) byId.set(r.id, r);
  return [...byId.values()].sort((a, b) => String(a.id).localeCompare(String(b.id)));
}

/**
 * Felterne der nulstilles når en rytter går til fri-agent-poolen. En akademirytter
 * får desuden is_academy=false (#5864): en fri agent med is_academy=true findes
 * ikke i spillet; `squad` bevares, så han stadig er en ungdomsrytter.
 */
export function buildContractReleasePatch(rider) {
  return {
    team_id: null,
    pending_team_id: null,
    salary: null,
    contract_length: null,
    contract_end_season: null,
    acquired_at: null,
    ...(rider?.is_academy === true ? { is_academy: false } : {}),
  };
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
 * @returns {Promise<{candidates:number, released:number, deferredByRacing:number, notified:number, notifyFailed:number, failed:number, youthNormalized:number}>}
 *   youthNormalized = frigivne akademiryttere der fik is_academy=false (#5864).
 *
 * Partial-failure-observability: hver rytters frigivelse er isoleret i sit eget
 * try/catch (samme disciplin som notifikations-loopet nedenfor) — én rytters
 * DB-fejl (fx transient netværks-hikke midt i 196 rækker) stopper IKKE resten af
 * loopet og taber IKKE de allerede-committede frigivelser. Hvis funktionen alligevel
 * kaster (før-loop-fejl: manglende supabase, fetchExpiredContractRiders eller
 * getRidersInActiveStageRace), hænges de INDTIL DA akkumulerede stats på
 * `err.partialStats`, så kalderen (seasonTransition.js) kan logge hvor langt
 * kørslen nåede FØR den fejlede — ikke kun fejlbeskeden.
 */
export async function releaseExpiredContractRiders({
  supabase,
  seasonNumber,
  notify = defaultNotifyUser,
  fetchExpiredContractRiders = defaultFetchExpiredContractRiders,
}) {
  const stats = { candidates: 0, released: 0, deferredByRacing: 0, notified: 0, notifyFailed: 0, failed: 0, youthNormalized: 0 };
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!Number.isFinite(seasonNumber)) return stats;

  let candidates;
  try {
    candidates = await fetchExpiredContractRiders({ supabase, seasonNumber });
  } catch (err) {
    err.partialStats = { ...stats };
    throw err;
  }
  stats.candidates = candidates.length;
  if (!candidates.length) return stats;

  let racingIds;
  try {
    racingIds = new Set(await getRidersInActiveStageRace(supabase, candidates.map((r) => r.id)));
  } catch (err) {
    err.partialStats = { ...stats };
    throw err;
  }
  const toRelease = candidates.filter((r) => !racingIds.has(r.id));
  stats.deferredByRacing = candidates.length - toRelease.length;

  for (const rider of toRelease) {
    try {
      // Concurrency-guard: kun frigør hvis rytteren stadig er på det hold vi læste
      // (en parallel handel kan i teorien have flyttet ham imellem).
      const patch = buildContractReleasePatch(rider);
      const { data: released, error } = await supabase
        .from("riders")
        .update(patch)
        .eq("id", rider.id)
        .eq("team_id", rider.team_id)
        // #5864 (CodeRabbit): også akademiflaget skal være det vi læste, ellers kan
        // en samtidig akademi-degradering give en fri agent med is_academy=true.
        .eq("is_academy", rider.is_academy === true)
        .select("id");
      if (error) throw new Error(`releaseExpiredContractRiders(${rider.id}): ${error.message}`);
      if (!released || released.length === 0) continue;

      // #1906/#776/#822 forward-guards — samme mønster som squadEnforcement.executeAutoSale.
      await clearFutureRaceEntriesSafe({ supabase, riderId: rider.id, label: "contract_expiry_release" });
      await closeTransferListingsForRiders(supabase, [rider.id], "withdrawn");
      stats.released += 1;
      if (patch.is_academy === false) stats.youthNormalized += 1;

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
          captureException(err, { tags: { flow: "notifications", stage: "contract-expired-release" }, riderId: rider.id });
        }
      }
    } catch (err) {
      // Rytterens EGEN frigivelse fejlede (DB-update/race-entry-oprydning/listing-luk).
      // Isoleret: resten af loopet (og de allerede-frigivne foran den) fortsætter
      // uændret — samme disciplin som notifikations-catchen ovenfor.
      stats.failed += 1;
      console.error(`  ❌ contract-expiry-release fejlede for rytter ${rider.id}:`, err?.message || err);
      captureException(err, { tags: { flow: "season-transition", stage: "contract-expiry-release" }, riderId: rider.id });
    }
  }

  return stats;
}
