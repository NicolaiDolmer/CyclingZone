// #2701 bud-gate (frontend UX-spejl af backend getAuctionBidRoomBlock).
// En ung rytter (ungdomsauktion) er egnet til BÅDE senior-truppen OG akademiet, så
// buddet blokeres kun når begge er fulde. Ved gevinst går rytteren senior-først,
// akademi-fallback — det bruges til destinations-hintet.
//
// #5568: akademi-delen tæller pr. MÅL-trup (U23 / junior) mod loftet i
// squadCaps.ts, præcis som finalize_academy_acquisition gør siden #5547. Før
// sammenlignede vi ALLE akademiryttere med et fladt loft på 8, så et hold med 8
// akademiryttere fik bud-knappen spærret, selv om rytterens trup havde plads.
//
// Frontend er KUN en UX-pre-check: backend-endpointet (POST /auctions/:id/bid) er
// den autoritative gate (afviser med errorCode no_eligible_room_bid / squad_full_bid),
// inkl. multi-auktions-pladsreservation som denne coarse count-baserede check bevidst
// ikke replikerer. Vi deaktiverer derfor kun ved "bogstaveligt fuld" (count >= cap)
// for at undgå at over-blokere; reservations-edge-cases fanges af backend-fejlen.

import { academyTargetSquad, isSquadFull, SQUAD_CAPS } from "./squadCaps.ts";

export const SENIOR_CAP = 30; // squad_limits.max, alle divisioner (backend MARKET_SQUAD_LIMITS)

// Returnerer { blocked, reason?, destination?, academySquad?, academyMax? }:
//   blocked=true  → deaktivér bud-knap + vis forklaring (reason: "both_full" | "senior_full").
//   blocked=false → byd tilladt. For youth sættes destination ("senior" | "academy")
//                   så UI kan vise hvor rytteren lander (senior-først).
//   academySquad  → ungdomstruppen rytteren lander i ved akademi-fallback
//                   ("u23" | "junior"), null hvis sæsonen endnu ikke er hentet.
// seniorCount/academySquadCounts kan være null (endnu ikke hentet) → "ikke fuld".
export function computeBidRoom({ isYouth, seniorCount, academySquadCounts = null, birthdate = null, seasonYear = null }) {
  const seniorFull = Number.isFinite(seniorCount) && seniorCount >= SENIOR_CAP;

  if (!isYouth) {
    return seniorFull ? { blocked: true, reason: "senior_full" } : { blocked: false };
  }

  const academySquad = academyTargetSquad(birthdate, seasonYear);
  const academyMax = academySquad ? SQUAD_CAPS[academySquad] : null;
  const academyFull = isSquadFull(academySquad, academySquadCounts);

  if (seniorFull && academyFull) {
    return { blocked: true, reason: "both_full", academySquad, academyMax };
  }
  return { blocked: false, destination: seniorFull ? "academy" : "senior", academySquad, academyMax };
}
