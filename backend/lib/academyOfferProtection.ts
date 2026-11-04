// #4213: delt beskyttelse af ryttere med et levende akademitilbud.
// Intake-kandidater er frie agenter, indtil manageren accepterer dem. Derfor
// skal kandidatsøgning og automatisk signering også læse academy_intake;
// riders-rækken alene kan ikke skelne et levende tilbud fra en almindelig fri agent.
// Historiske interne målinger er bevaret privat i balance-internals/7583/.
// Supplerende SQL-guard:
// database/2026-08-29-4213-academy-offer-ownership-guard.sql.

import { fetchAllRows } from "./supabasePagination.js";
import type { SupabaseClient } from "@supabase/supabase-js";

type LiveOfferRow = { rider_id?: string | null; team_id?: string | null };
// Adskilte SDK-caches har nominelle buildertyper. Bevar klientgrænsen strukturel.
type LiveOfferClient = {
  from(table: "academy_intake"): { select: unknown };
};
type LiveOfferLookup = Pick<ReadonlyMap<unknown, string | null>, "has" | "get">;
type RiderCandidate = { id?: unknown };


/**
 * Rytter-id'er der lige nu har et LEVENDE akademitilbud ude ('offered').
 *
 * Returnerer en Map<riderId, offeredTeamId> — ikke bare et Set — fordi kaldere
 * skal kunne skelne "lovet væk til ET ANDET hold" (ulovligt at overtage) fra
 * "lovet væk til netop dette hold" (præcis dét signeringen gør, og som derfor
 * skal være tilladt). Uden den skelnen ville et Set blokere signeringen selv.
 *
 * @param supabase
 * @returns riderId → holdet tilbuddet gik til
 */
export async function fetchLiveAcademyOffers(supabase: LiveOfferClient | null | undefined): Promise<Map<string, string | null>> {
  if (!supabase?.from) throw new Error("Supabase client required");
  // Builderen beskrives med SDK'ens egen type; typeimporten fjernes ved runtime.
  const rows: Array<LiveOfferRow | null | undefined> = await fetchAllRows(() =>
    (supabase
      .from("academy_intake") as ReturnType<SupabaseClient["from"]>)
      .select("rider_id, team_id")
      .eq("status", "offered")
      .order("rider_id"));
  const byRider = new Map<string, string | null>();
  for (const row of rows) {
    if (row?.rider_id) byRider.set(row.rider_id, row.team_id ?? null);
  }
  return byRider;
}

/**
 * Rent predikat: må `teamId` overtage `riderId`?
 *
 * Falsk KUN når rytteren har et levende tilbud ude til et ANDET hold. Et tilbud
 * til holdet selv er signeringen, og fravær af tilbud er en almindelig fri agent.
 *
 * @param liveOffers fra fetchLiveAcademyOffers
 * @param riderId
 * @param teamId holdet der vil overtage rytteren
 */
export function mayTeamAcquireRider(
  liveOffers: LiveOfferLookup | null | undefined,
  riderId: unknown,
  teamId: string | null | undefined,
): boolean {
  if (!liveOffers?.has?.(riderId)) return true;
  return liveOffers.get(riderId) === teamId;
}

/**
 * Frafiltrér kandidater der er lovet væk i et levende akademitilbud til et andet
 * hold. Bevarer rækkefølgen (kaldere sorterer typisk på pris før filtrering).
 *
 * @param riders
 * @param liveOffers
 * @param acquiringTeamId holdet der vil købe; null = ingen må overtage
 */
export function filterOutPromisedAcademyRiders<T extends readonly (RiderCandidate | null | undefined)[] | null | undefined>(
  riders: T,
  liveOffers: LiveOfferLookup | null | undefined,
  acquiringTeamId: string | null = null,
) {
  const kept: NonNullable<T>[number][] = [];
  const blocked: NonNullable<T>[number][] = [];
  for (const rider of riders || []) {
    if (mayTeamAcquireRider(liveOffers, rider?.id, acquiringTeamId)) kept.push(rider);
    else blocked.push(rider);
  }
  return { kept, blocked };
}
