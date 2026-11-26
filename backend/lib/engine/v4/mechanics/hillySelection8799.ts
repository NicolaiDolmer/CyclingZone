// backend/lib/engine/v4/mechanics/hillySelection8799.ts
// #8799 (KUN s5_profiles_v3 + kontakten hilly_selection_8799, SLUKKET): én kontakt for to dele,
// som ejeren valgte 26/11 og vil taende sammen foer S6's foerste loeb:
//   - selektionen i dalen paa kuperet og mellembjerg (#7645, jagt med aarsag + forsvar;
//     mechanics/timeModel.ts valleySelectionTempo7645), og
//   - afslutningen paa kuperet og boelget efter dagens haardhed (#8189, udbruddet faar sin chance
//     + reduceret spurt; mechanics/hillyFinish8189.ts).
// Hver del tjekker selv sine etaper; kontakten afgoer kun om de er taendt. Der findes ingen
// halv tilstand: begge eller ingen.
//
// Broen saetter feltet kun for et loeb, der blev stemplet til kontakten ved sin foerste etape
// (hillySelection8799Flag.js), saa et loeb koeres faerdigt med de regler, det startede med.

import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";
import type { StageInput } from "../types.ts";

/** Kontakten: kun s5_profiles_v3 (og senere) OG et eksplicit true paa StageInput. */
export function hillySelection8799On(input: Pick<StageInput, "rules_revision" | "hilly_selection_8799">): boolean {
  return input.hilly_selection_8799 === true && isS5ProfilesV3OrLater(input.rules_revision);
}
