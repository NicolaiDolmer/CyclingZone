// #5145 — hvornår må en senior-rytter flyttes NED i akademiet?
//
// Grænsen er sæson-alder <= 21, IKKE U23 (<= 22). Akademi-opholdet slutter ved
// 22: backend/lib/academyFlag.js's ACADEMY.MAX_AGE = 21 og
// backend/lib/academyGraduation.js's GRADUATION.GRADUATE_AGE = 22 ("MAX_AGE 21 + 1").
// Indtil 13/9 brugte både RPC'en (database/2026-06-25-academy-promote-demote.sql)
// og de to frontend-knapper U23-grænsen, så en manager kunne flytte en 22-årig ned
// og efterlade ham som akademi-rytter OVER gradueringsalderen uden graduerings-
// vindue — tilstanden #5133 fandt i prod.
//
// Reglen bor her (ét sted) fordi den skal bruges to steder i UI'et:
// RiderManageActions (rytter-profilen) og TeamPage's RiderActionModal (holdsiden).
// Hardkodet 21 fremfor et import fra backend: frontend importerer ikke backend-
// moduler i runtime. Parret holdes ærligt af academyDemoteGate.test.ts, som
// importerer backendens ACADEMY.MAX_AGE og pinner den mod konstanten herunder —
// samme SSOT-paritets-mønster som academyPromoteContract.test.js.
import { ageForSeason } from "./riderAge.js";

// riderAge.js er (endnu) untypet JS (checkJs:false, jf. tsconfig.json) —
// birthdate-kontrakten derfra: en dato-streng ("YYYY-MM-DD"), et Date-objekt,
// eller null/undefined for "ukendt". seasonYear er sæsonens referenceår
// (useActiveSeasonYear/seasonReferenceYear) eller null/undefined hvis endnu
// ikke hentet.
type Birthdate = string | Date | null | undefined;
type SeasonYear = number | null | undefined;

// Sidste sæson-alder hvor nedrykning er tilladt. Spejler ACADEMY.MAX_AGE.
export const ACADEMY_DEMOTE_MAX_AGE = 21;

// Første sæson-alder hvor akademi-opholdet er slut. Spejler GRADUATION.GRADUATE_AGE
// og bruges til at skelne "for gammel til akademiet overhovedet" (23+, ingen
// forklaring nødvendig — rytteren har aldrig været i nærheden) fra "lige akkurat
// for gammel" (22, hvor manageren har brug for at vide hvorfor knappen er død).
export const ACADEMY_GRADUATE_AGE = 22;

// Må rytteren flyttes ned i akademiet, alders-mæssigt? Ukendt fødselsdato eller
// ukendt sæson-år → false (samme null-over-gæt-kontrakt som riderAge.js: en
// manglende alder må aldrig åbne en gate der er lukket i backend).
export function canDemoteToAcademy(birthdate: Birthdate, seasonYear: SeasonYear): boolean {
  const age = ageForSeason(birthdate, seasonYear);
  return age != null && age <= ACADEMY_DEMOTE_MAX_AGE;
}

// Er rytteren blokeret PRÆCIS af alders-gaten — dvs. lige fyldt gradueringsalderen
// (22)? Kun i det tilfælde er en forklaring meningsfuld ved knappen: en 25-årig
// senior har aldrig haft en nedryknings-knap at savne.
export function isDemoteBlockedByAge(birthdate: Birthdate, seasonYear: SeasonYear): boolean {
  const age = ageForSeason(birthdate, seasonYear);
  return age === ACADEMY_GRADUATE_AGE;
}
