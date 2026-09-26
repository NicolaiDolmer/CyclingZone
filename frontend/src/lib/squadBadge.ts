// #5763: trup-badge til træningstabellen (desktop + mobil) — spiller 25/9
// rapporterede at ACAD-badget forsvandt med den nye træningsoversigt, og
// ejeren lovede et erstatnings-badge. Afgøres UDELUKKENDE af rytterens
// squad-felt (riders.squad, se backend/lib/squads.js), ALDRIG af alder alene
// — en rytter der er flyttet op på seniortruppen (#5750 Move squad) mister
// badget med det samme, uanset hvor ung han er.
//
// Nøglen her matcher RiderBadges' BADGE_DEFS + rider.json badges.label.<key>
// (u23 genbruger det eksisterende aldersbaserede u23-badges label "U23" —
// samme tekst, anden kilde; junior er nyt, label "JR", EN/DA identiske).
//
// Ren .ts uden React-import, så node --test kan loade den.

export type SquadBadgeKey = "u23" | "junior";

export function squadBadgeKey(squad: string | null | undefined): SquadBadgeKey | null {
  if (squad === "u23") return "u23";
  if (squad === "junior") return "junior";
  return null;
}
