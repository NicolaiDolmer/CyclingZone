// #6710 (plan-PR 1 i #5833): trupsidens "Afventer oprykning" + handlingen "Ryk op".
//
// Default-kæden (academyGraduation.defaultResolveGraduate) sætter en rytter til
// at vente, når mål-truppen er fuld (riders.promotion_pending_to/_since). Her
// bor de to HTTP-indgange, trupsiden bruger:
//   GET  /api/team/promotion-pending      → hvem venter, og er der plads nu
//   POST /api/riders/:id/promote-pending  → ryk én ventende rytter op
//
// "Ryk op" er IKKE en ny flytte-implementation: den kalder moveRider() med
// rytterens mål-trup, så loft, kontrakt, auktions- og etapeløbs-reglerne er
// præcis dem "Move squad"-dialogen allerede bruger. Bagefter ryddes ventefelterne,
// og grad-rækken rettes fra 'expired' til 'promoted'.
//
// Bor i sin egen fil, fordi academyTransfer.js importerer academyGraduation.js —
// moveRider herind i academyGraduation.js ville lave en cyklisk import.
//
// Alt er bag promotion_pending_enabled. Flag off → listen er tom, og "Ryk op"
// svarer 409, uden at de nye kolonner læses (de findes først efter migrationen).

import { moveRider, moveSquadErrorStatus } from "./academyTransfer.js";
import {
  hasRoomInTargetSquad,
  isPromotionPendingActive,
  isPromotionPendingEnabled,
  restampSoldGraduation,
  PROMOTION_PENDING_GRAD_STATUS,
} from "./academyGraduation.js";
import { ageForSeason } from "./riderSeasonAge.js";

// schema-columns-ok: promotion_pending_* tilfoejes af database/2026-10-16-6710-promotion-pending.sql
// (#6710). Laeses kun bag promotion_pending_enabled, som flippes efter migrationen.
const PENDING_RIDER_SELECT = "id, team_id, firstname, lastname, birthdate, squad, is_academy, promotion_pending_to, promotion_pending_since";

/**
 * Holdets ryttere der venter på oprykning, med om mål-truppen har plads nu.
 *
 * @param {any} supabase
 * @param {{teamId:string, seasonNumber:number, roomCheck?:typeof hasRoomInTargetSquad}} args
 * @returns {Promise<{riders:Array<{id:string, firstname:string, lastname:string, from:string|null, to:string, since:string|null, canPromote:boolean}>, room:Record<string, boolean>}>}
 */
export async function listPendingPromotions(supabase, {
  teamId, seasonNumber, roomCheck = hasRoomInTargetSquad,
} = /** @type {any} */ ({})) {
  if (!supabase?.from) throw new Error("Supabase client required");
  if (!teamId) throw new Error("listPendingPromotions: teamId required");

  // schema-columns-ok: se PENDING_RIDER_SELECT ovenfor (#6710).
  // pagination-safe: ét holds ryttere (trup-lofterne holder det langt under 1000).
  const { data, error } = await supabase.from("riders")
    .select(PENDING_RIDER_SELECT)
    .eq("team_id", teamId)
    .eq("is_retired", false)
    .not("promotion_pending_to", "is", null)
    .order("promotion_pending_since", { ascending: true });
  if (error) throw new Error(`listPendingPromotions: ${error.message}`);

  const waiting = (data ?? []).filter((r) => isPromotionPendingActive(r, ageForSeason(r.birthdate, seasonNumber)));
  const targets = [...new Set(waiting.map((r) => r.promotion_pending_to))];
  /** @type {Record<string, boolean>} */
  const room = {};
  for (const target of targets) {
    room[target] = await roomCheck(supabase, { teamId, targetSquad: target });
  }

  return {
    room,
    riders: waiting.map((r) => ({
      id: r.id,
      firstname: r.firstname,
      lastname: r.lastname,
      from: r.squad ?? null,
      to: r.promotion_pending_to,
      since: r.promotion_pending_since ?? null,
      canPromote: room[r.promotion_pending_to] === true,
    })),
  };
}

/**
 * "Ryk op": flyt én ventende rytter til hans mål-trup.
 *
 * @param {any} supabase
 * @param {{teamId:string, riderId:string, seasonNumber:number, now?:Date,
 *   move?:typeof moveRider, moveDeps?:Record<string, any>}} args
 * @throws 'rider_not_found' | 'not_owned' | 'not_pending' + moveRider's koder (fx 'squad_full')
 */
export async function promotePendingRider(supabase, {
  teamId, riderId, seasonNumber, now = new Date(), move = moveRider, moveDeps = {},
} = /** @type {any} */ ({})) {
  if (!supabase?.from) throw new Error("Supabase client required");

  // schema-columns-ok: se PENDING_RIDER_SELECT ovenfor (#6710).
  const { data: rider, error } = await supabase.from("riders")
    .select(PENDING_RIDER_SELECT)
    .eq("id", riderId).maybeSingle();
  if (error) throw new Error(`promotePendingRider lookup: ${error.message}`);
  if (!rider) throw new Error("rider_not_found");
  if (rider.team_id !== teamId) throw new Error("not_owned");
  if (!isPromotionPendingActive(rider, ageForSeason(rider.birthdate, seasonNumber))) {
    throw new Error("not_pending");
  }

  const result = await move(supabase, {
    ...moveDeps, teamId, riderId, targetSquad: rider.promotion_pending_to, seasonNumber, now,
  });

  // Flytningen er gennemført; ventefelterne skal væk, ellers står han stadig på
  // listen. Fejler det, er isPromotionPendingActive alligevel false (han er nu i
  // mål-truppen), så en fejl her må ikke gøre en gennemført flytning til en 500.
  const { error: clearErr } = await supabase.from("riders")
    .update({ promotion_pending_to: null, promotion_pending_since: null })
    .eq("id", riderId).eq("team_id", teamId);
  if (clearErr) console.error(`promotePendingRider ${riderId}: clear pending fields failed — ${clearErr.message}`);

  await restampSoldGraduation(supabase, {
    teamId, riderId, now, status: "promoted", fromStatus: PROMOTION_PENDING_GRAD_STATUS,
  });

  return { ...result, riderId, promotedFromPending: true };
}

/**
 * HTTP-kontrakten for GET /api/team/promotion-pending.
 *
 * @returns {Promise<{status:number, body:Record<string, any>}>}
 */
export async function handleListPendingRequest(supabase, {
  teamId, seasonNumber, isEnabled = isPromotionPendingEnabled, list = listPendingPromotions,
} = /** @type {any} */ ({})) {
  if (!(await isEnabled(supabase))) {
    // Rollback-sikkert (Codex 16/10): slås flaget fra, efter at ryttere er
    // sat til at afvente, skal de stadig kunne ses og rykkes op. Før
    // migrationen findes kolonnerne ikke; så er listen bare tom.
    try {
      const out = await list(supabase, { teamId, seasonNumber });
      return { status: 200, body: { enabled: false, ...out } };
    } catch {
      return { status: 200, body: { enabled: false, riders: [], room: {} } };
    }
  }
  const out = await list(supabase, { teamId, seasonNumber });
  return { status: 200, body: { enabled: true, ...out } };
}

/**
 * HTTP-kontrakten for POST /api/riders/:id/promote-pending. Forventede
 * afvisninger → 4xx med errorCode; uventede fejl kastes (routen → 500 + Sentry).
 *
 * @returns {Promise<{status:number, body:Record<string, any>}>}
 */
export async function handlePromotePendingRequest(supabase, {
  teamId, riderId, seasonNumber, isEnabled = isPromotionPendingEnabled, promote = promotePendingRider,
} = /** @type {any} */ ({})) {
  // Ingen flag-port her (Codex 16/10): en rytter der allerede afventer, skal
  // kunne rykkes op, også efter at flaget er slået fra igen. promote() afviser
  // selv ryttere, der ikke afventer (not_pending).
  try {
    const result = await promote(supabase, { teamId, riderId, seasonNumber });
    return { status: 200, body: result };
  } catch (err) {
    const code = /** @type {any} */ (err)?.message ?? "";
    const status = code === "not_pending" ? 409 : moveSquadErrorStatus(code);
    if (status === null) {
      // Før migrationen (kolonnerne findes ikke) og flaget slukket: pæn 409.
      if (!(await isEnabled(supabase))) {
        return { status: 409, body: { error: "promotion_pending_disabled", errorCode: "promotion_pending_disabled" } };
      }
      throw err;
    }
    return { status, body: { error: code, errorCode: code } };
  }
}
