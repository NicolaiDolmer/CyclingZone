// #4213 — ÉN definition af "denne rytter er lovet væk i et levende akademitilbud".
//
// ROD-ÅRSAG (verificeret mod prod 29/8)
//   Akademi-intake-kandidater fødes som FRIE AGENTER: academyGenerator.js sætter
//   `team_id: null` OG `is_academy: false` (linje 152) — de bliver først
//   akademiryttere når manageren siger ja. Det er bevidst, men det gør dem
//   umulige at skelne fra en almindelig fri agent på rytter-rækken alene. Den
//   ENESTE markør er en `academy_intake`-række med status 'offered'.
//
//   Derfor blev de høstet af #4172's free-agent-fill 24/8 12:15-12:18 UTC:
//   2.532 frie ryttere blev fordelt på 127 nye AI-hold, heraf 1.543 med en
//   akademi-intake-række (bevis: docs/snapshots/4172/d4-freeagent-fill-*.json,
//   squadSize 20, valueCeiling 100.000). 274 af dem står stadig som levende
//   tilbud til 162 menneskehold på ryttere der nu ejes af et AI-hold.
//
//   Det er ikke et uheld ved den ene kørsel: akademikandidater er systematisk de
//   BILLIGSTE frie agenter i spillet (målt 29/8: median 4.925 mod 37.956 for
//   almindelige frie agenter, 8x). Enhver "tag de billigste frie agenter"-rutine
//   rammer dem derfor FØRST, ikke tilfældigt. squadEnforcement's auto-køb sorterer
//   netop `market_value` stigende — og minimum-6-gulvet gik live 28/8 (#4301/#4295),
//   så den sti er varm nu.
//
// HVORFOR EN DELT HELPER OG IKKE ET FILTER PR. KALDSTED
//   Samme lektie som riderEligibility.js (#1800/#1742): et filter der skal gentages
//   forfalder. Skrivevejen der forvoldte skaden her var oven i købet et ad-hoc-script
//   der ALDRIG blev committet, så et kode-filter alene kan ikke være hele værnet —
//   se database/2026-08-29-4213-academy-offer-ownership-guard.sql for DB-laget, som
//   fanger enhver skrivevej inkl. fremtidig ad-hoc SQL. Denne fil er kode-laget:
//   den gør at de LOVLIGE stier lader være i stedet for at ramme triggeren.

import { fetchAllRows } from "./supabasePagination.js";

/**
 * Rytter-id'er der lige nu har et LEVENDE akademitilbud ude ('offered').
 *
 * Returnerer en Map<riderId, offeredTeamId> — ikke bare et Set — fordi kaldere
 * skal kunne skelne "lovet væk til ET ANDET hold" (ulovligt at overtage) fra
 * "lovet væk til netop dette hold" (præcis dét signeringen gør, og som derfor
 * skal være tilladt). Uden den skelnen ville et Set blokere signeringen selv.
 *
 * @param {object} supabase
 * @returns {Promise<Map<string, string>>} riderId → holdet tilbuddet gik til
 */
export async function fetchLiveAcademyOffers(supabase) {
  if (!supabase?.from) throw new Error("Supabase client required");
  const rows = await fetchAllRows(() =>
    supabase
      .from("academy_intake")
      .select("rider_id, team_id")
      .eq("status", "offered")
      .order("rider_id"));
  const byRider = new Map();
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
 * @param {Map<string,string>} liveOffers fra fetchLiveAcademyOffers
 * @param {string} riderId
 * @param {string|null} teamId holdet der vil overtage rytteren
 */
export function mayTeamAcquireRider(liveOffers, riderId, teamId) {
  if (!liveOffers?.has?.(riderId)) return true;
  return liveOffers.get(riderId) === teamId;
}

/**
 * Frafiltrér kandidater der er lovet væk i et levende akademitilbud til et andet
 * hold. Bevarer rækkefølgen (kaldere sorterer typisk på pris før filtrering).
 *
 * @param {Array<{id: string}>} riders
 * @param {Map<string,string>} liveOffers
 * @param {string|null} acquiringTeamId holdet der vil købe; null = ingen må overtage
 * @returns {{kept: Array, blocked: Array}}
 */
export function filterOutPromisedAcademyRiders(riders, liveOffers, acquiringTeamId = null) {
  const kept = [];
  const blocked = [];
  for (const rider of riders || []) {
    if (mayTeamAcquireRider(liveOffers, rider?.id, acquiringTeamId)) kept.push(rider);
    else blocked.push(rider);
  }
  return { kept, blocked };
}
