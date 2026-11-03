// backend/lib/engine/v4/mechanics/queenStageGap7236.ts
// #7236 (KUN s5_profiles_v3 + kontakten queen_stage_gap_7236, SLUKKET): dronningeetaper.
//
// Paa en bjergetape med flere store stigninger og en kort nedkoersel til maal kom
// favoritterne for spredt over den sidste top: kraefterne fra dagens tidligere
// stigninger slog for haardt igennem paa den sidste, og nedkoerslen var for kort
// til at samle dem igen. Kontakten goer to ting:
//   1. Hullet over sidste top faar et loft, saa nr. 10 hoejst ligger i
//      topankomstens baand (climbSelection.ts, queenStageTopCap7236). Et loft, ikke
//      en flad reduktion: under loftet er alt uroert, og raekkefoelgen og de
//      indbyrdes forhold over toppen bevares, saa klatrerne beholder fordelen.
//   2. Grupperne paa nedkoerslen lukker lidt hurtigere og fra lidt laengere bag
//      (descentRegroup6486.ts, DESCENT_REGROUP_7236_TUNING).
// Begge dele kun paa bjerg/hoejfjeld uden topankomst og med kort vej fra sidste
// top til maal. Topankomster og lange nedkoersler er uroerte.
//
// Kontakten taendes kun naar kalderen eksplicit sender queenStageGap7236=true
// (broen; i dag kun maalingen/testporten). Uden kontakten er motoren bit-identisk
// for alle revisioner. Tal kun privat (balance-internals/7236/, hard rule 17).
//
// REN: ingen IO, ingen rng.
import type { StageInput } from "../types.ts";
import { isS5ProfilesV3OrLater } from "../../../raceEngineRulesRevision.ts";

/** Kontakten: kun s5_profiles_v3 (og senere) OG et eksplicit flag. Haandbyggede fixtures og aeldre revisioner: nej. */
export function queenStageGap7236On(input: Pick<StageInput, "rules_revision" | "queen_stage_gap_7236">): boolean {
  return input.queen_stage_gap_7236 === true && isS5ProfilesV3OrLater(input.rules_revision);
}
