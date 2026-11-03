// #7566 · Endagsløbets etiketter på løbssiden. Et endagsløb har ingen etaper,
// så toppen gentager ikke typen ("ENKELTDAG · ENKELTDAG"), og Udgåede skriver
// ikke "Etape 1" foran årsagen. Etapeløb er uændrede.

/** Skal linjen ved siden af typemærket vise antal etaper? Kun for etapeløb. */
export function showsStageCount(raceType: string | null | undefined): boolean {
  return raceType === "stage_race";
}

/** Skal en udgået rytter have "Etape N · " foran årsagen? Kun i samlet visning af et etapeløb. */
export function showsDnfStagePrefix(scopeType: string, raceType: string | null | undefined): boolean {
  return scopeType !== "stage" && raceType === "stage_race";
}
