// backend/lib/engine/v4/mechanics/breakawayInterest7160P2.ts
// #7160 valg A2 (ejer 25/10 runde 2, KUN s5_profiles_v3, SLUKKET): P2's snor gaelder ikke paa
// bjerg, naar udbruddet er ufarligt for klassementet.
//
// #6804 P2 (breakawayV3_6804.ts) lofter lad-gaa-fasen ved det feltet tolererer (mellemzonen med
// jagt-interesse, ellers den oevre zone) og giver de interesserede hold automatisk jagt-arbejde.
// Paa en bjergetape i et etapeloeb med klassement slaas P2 fra for ET udbrud, naar det er
// ufarligt for hvert klassementshold i jagtgruppen. "Ufarligt" og "klassementshold" er #7176's
// definition (breakawayInterest7160.ts): holdets bedst placerede rytter i jagtgruppen er i
// klassementets top, og hver udbryder staar i klassementet langt nok efter netop ham. Er
// udbruddet farligt for bare ét af de hold (en udbryder taet paa, eller uden plads i
// klassementet), gaelder P2 som foer.
//
// Hvad der IKKE roeres: klassementsreaktionerne, ordrer, P6-snoren og de aeldre lad-gaa-lofter
// (inkl. det de bremsende hold tolererer) virker som foer; kun P2's loft og P2's automatiske
// jagt-arbejde falder bort for udbruddet. Ingen ny tilfaeldighed.
//
// REN: ingen IO, ingen rng. Uden #7176's hold (reglen gaelder ikke) er svaret false, saa P2 er
// byte-identisk med foer (alle aeldre revisioner og v3 uden for bjerg).

import type { Entrant, GcContext } from "../types.ts";
import { gcRiderGapByTeam } from "./breakawayInterest7160.ts";

/**
 * Slaas P2 fra for dette udbrud? Ja kun naar #7176 har fundet klassementshold for hvem udbruddet
 * er ufarligt (`harmlessGcTeams`, noeglerne fra s5V3MountainLetGoInterestScale), og HVERT
 * klassementshold i jagtgruppen er blandt dem. undefined/tom = false (P2 identisk).
 */
export function s5V3P2OffForHarmlessBreak(input: {
  harmlessGcTeams: ReadonlyMap<string, number> | undefined;
  chaseGroupRiderIds: readonly string[];
  entrants: Readonly<Record<string, Entrant>>;
  gcContext: GcContext | null | undefined;
}): boolean {
  const harmless = input.harmlessGcTeams;
  if (!harmless || harmless.size === 0 || !input.gcContext) return false;
  const gcTeams = gcRiderGapByTeam({ chaseGroupRiderIds: input.chaseGroupRiderIds, entrants: input.entrants, gcContext: input.gcContext });
  if (gcTeams.size === 0) return false;
  for (const teamId of gcTeams.keys()) if (!harmless.has(teamId)) return false;
  return true;
}
