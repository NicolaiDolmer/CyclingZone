// Taktik-ordrer v1 (race engine v4, #4030/#4246) — I/O-laget for TacticsCard.
//
// Kortet var indtil nu en attrap: al I/O gik i en hukommelses-mock uden netværk,
// så ejeren ikke kunne teste den rigtige kæde på preview (audit-fund 5/9).
// Denne fil taler nu med det endpoint der har været live hele tiden:
//
//   GET  /api/races/:raceId/team-orders            → alle etapers ordrer + lås-meta
//                                                    + rollernes standardordre
//   PUT  /api/races/:raceId/team-orders/:stage     → gem ÉN etapes overlay
//
// Kontrakten er backend/lib/engine/v4/ai/teamOrderContract.ts. To ting der
// bider hvis man glemmer dem:
//   · `race_role` må ALDRIG sendes (ejer 27/8) — endpointet svarer 400
//     `team_orders_role_not_allowed`. Rollen sættes i holdudtagelsen.
//   · Ukendte felter afvises også. Send præcis rider_id/effort/try_break/leadout.

import { authHeaders } from "./supabase.js"; // #4348: kanonisk kopi
import { defaultTeamOrder, mergeOrderWithRoster } from "./tacticsPlan.js";

const API = import.meta.env.VITE_API_URL;

/** Kun de fire kontraktfelter — se filens hoved-kommentar. */
function toContractRider(rider) {
  return {
    rider_id: rider.rider_id,
    effort: rider.effort,
    try_break: rider.try_break === true,
    leadout: rider.leadout === true,
  };
}

/**
 * Hent holdets ordre for ÉN etape + den kontekst kortet skal vise.
 *
 * Returnerer altid en komplet ordre for de udtagne ryttere: har holdet ikke
 * gemt noget for etapen, ER rollernes standardordre svaret (T4 — passivitet
 * straffes aldrig).
 */
export async function fetchTacticsCard({ raceId, stage }) {
  const headers = await authHeaders({ json: false }); // ren GET, ingen body
  if (!headers) return null;
  // TacticsCard.load() fanger og saetter fejl-tilstanden (kortet viser "kunne
  // ikke hente" + en proev igen-knap). Fejlen skal boble hertil, ikke svelges
  // her — et tomt kort ville ligne "ingen taktik sat".
  const res = await fetch(`${API}/api/races/${raceId}/team-orders`, { headers }); // catch-ok: TacticsCard.load()
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `team_orders_fetch_failed_${res.status}`);
  }
  const body = await res.json();
  const riders = body.riders ?? [];
  const riderIds = riders.map((r) => r.rider_id);
  const savedForStage = (body.orders ?? []).find((o) => o.stage_number === stage) ?? null;
  const stageMeta = (body.stages ?? []).find((s) => s.stage_number === stage) ?? null;

  return {
    order: mergeOrderWithRoster(
      savedForStage ?? defaultTeamOrder(riderIds),
      riderIds,
      body.default_order ?? null,
    ),
    defaultOrder: body.default_order ?? null,
    riders,
    effortKeys: body.valid_efforts ?? null,
    locksAt: stageMeta?.scheduled_at ?? null,
    locked: stageMeta?.locked === true || body.race_completed === true,
    hasSavedOrder: savedForStage != null,
  };
}

/** Gem ÉN etapes overlay. Kaster med serverens fejlkode, så kortet kan vise den. */
export async function saveTacticsCard({ raceId, stage, order }) {
  const headers = await authHeaders();
  if (!headers) throw new Error("not_authenticated");
  // TacticsCard.handleSave() fanger, rydder loading-tilstanden og viser
  // gem-fejlen ved knappen.
  const res = await fetch(`${API}/api/races/${raceId}/team-orders/${stage}`, { // catch-ok: TacticsCard.handleSave()
    method: "PUT",
    headers,
    body: JSON.stringify({
      breakaway_stance: order.breakaway_stance,
      riders: (order.riders ?? []).map(toContractRider),
    }),
  });
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `team_orders_save_failed_${res.status}`);
  }
  return { ok: true };
}
