// backend/lib/engine/v4/mechanics/breakawayInterest7160P2.ts
// #7160 valg A (ejer 25/10, KUN s5_profiles_v3, SLUKKET): "ufarligt udbrud != interesse".
//
// #6804 P2 (breakawayV3_6804.ts) lader et udbrud vokse til den oevre zone, kun naar INGEN hold
// har jagt-interesse (positiv etapeinteresse eller et positivt ordre-/klassementssignal).
// Paa en bjergetape i et etapeloeb med klassement taeller etapeinteressen fra et
// klassementshold, for hvem udbruddet er ufarligt, ikke laengere som interesse i det loft.
// "Ufarligt" og "klassementshold" er #7176's definition (breakawayInterest7160.ts,
// s5V3MountainLetGoInterestScale): holdets bedst placerede rytter i jagtgruppen er i
// klassementets top, og hver udbryder staar i klassementet langt nok efter ham. Noeglerne i
// den mappe er netop de hold.
//
// Hvad der IKKE roeres: holdets positive signal (ordre "jag", klassementsreaktion) taeller
// stadig i P2, saa et farligt udbrud og en jagtordre jages som foer. Lukkekraften
// (netto-jagtfordelen) er uaendret; kun hvilke hold P2 regner som interesserede (loftet og den
// automatiske jagts arbejde) flytter sig.
//
// REN: ingen IO, ingen rng. Uden hold (reglen gaelder ikke) returneres samme map, saa P2 er
// byte-identisk med foer (alle aeldre revisioner og v3 uden for bjerg).

/**
 * Etapeinteressen P2 maa regne med: `interestByTeam` uden de klassementshold for hvem udbruddet
 * er ufarligt (`harmlessGcTeams`, noeglerne fra s5V3MountainLetGoInterestScale). undefined/tom =
 * samme map (identisk).
 */
export function s5V3P2CountedStageInterest(
  interestByTeam: ReadonlyMap<string, number>,
  harmlessGcTeams: ReadonlyMap<string, number> | undefined,
): ReadonlyMap<string, number> {
  if (!harmlessGcTeams || harmlessGcTeams.size === 0) return interestByTeam;
  return new Map([...interestByTeam].filter(([teamId]) => !harmlessGcTeams.has(teamId)));
}
