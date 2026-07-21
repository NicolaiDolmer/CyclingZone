// #2701 bud-gate (frontend UX-spejl af backend getAuctionBidRoomBlock).
// En ung rytter (ungdomsauktion) er egnet til BÅDE senior-truppen OG akademiet, så
// buddet blokeres kun når begge er fulde. Ved gevinst går rytteren senior-først,
// akademi-fallback — det bruges til destinations-hintet.
//
// Frontend er KUN en UX-pre-check: backend-endpointet (POST /auctions/:id/bid) er
// den autoritative gate (afviser med errorCode no_eligible_room_bid / squad_full_bid),
// inkl. multi-auktions-pladsreservation som denne coarse count-baserede check bevidst
// ikke replikerer. Vi deaktiverer derfor kun ved "bogstaveligt fuld" (count >= cap)
// for at undgå at over-blokere; reservations-edge-cases fanges af backend-fejlen.

export const SENIOR_CAP = 30; // squad_limits.max, alle divisioner (backend MARKET_SQUAD_LIMITS)
export const ACADEMY_CAP = 8; // ACADEMY.SLOTS (backend academyFlag.js)

// Returnerer { blocked, reason?, destination? }:
//   blocked=true  → deaktivér bud-knap + vis forklaring (reason: "both_full" | "senior_full").
//   blocked=false → byd tilladt. For youth sættes destination ("senior" | "academy")
//                   så UI kan vise hvor rytteren lander (senior-først).
// seniorCount/academyCount kan være null (endnu ikke hentet) → behandles som "ikke fuld".
export function computeBidRoom({ isYouth, seniorCount, academyCount }) {
  const seniorFull = Number.isFinite(seniorCount) && seniorCount >= SENIOR_CAP;
  const academyFull = Number.isFinite(academyCount) && academyCount >= ACADEMY_CAP;

  if (!isYouth) {
    return seniorFull ? { blocked: true, reason: "senior_full" } : { blocked: false };
  }

  if (seniorFull && academyFull) {
    return { blocked: true, reason: "both_full" };
  }
  return { blocked: false, destination: seniorFull ? "academy" : "senior" };
}
