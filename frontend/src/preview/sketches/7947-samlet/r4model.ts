// #7947 retning 4 (samlet efter kravspec #8301): den rene model bag skitsen.
// Ingen React, saa node --test kan koere den. Intet her er produktkode.
//
// Kravspecens resolver (§3) i lille format: hvert af datoens fem felter faar
// et pas OG en kilde. Hoejeste vinder:
//   1. etape (laast) / koert
//   2. manuelt felt paa datoen
//   3. hurtigvalg (quick select) paa datoen: type + indsats
//   4. rytterens program / 5. gruppe / 6. holdrytme / 7. standard efter type
// Traethedsreglen anvendes bagefter og markeres som sin egen kilde (K2.5).
// Et valg paa en dato gaelder KUN den dato (K5); en uroert dato foelger programmet.

import type { Session } from "./model.ts";

export type Effort = "let" | "mellem" | "hard";
export type RestKind = "rest" | "recovery";
export type Quick =
  | { kind: "effort"; effort: Effort; type: RiderType }
  | { kind: "rest"; rest: RestKind };

export type RiderType =
  | "Klatrer" | "Sprinter" | "Brostensrytter" | "Puncheur" | "Enkeltstartsrytter" | "Rouleur" | "Allround";

export const RIDER_TYPES: RiderType[] = [
  "Klatrer", "Sprinter", "Brostensrytter", "Puncheur", "Enkeltstartsrytter", "Rouleur", "Allround",
];

export type BaseSource = "program" | "group" | "team" | "default";
export type FieldSource = BaseSource | "stage" | "done" | "manual" | "quick" | "rule";

export type R4Field =
  | { kind: "stage"; label: string; source: "stage" }
  | { kind: "train"; session: Session; source: FieldSource; done?: boolean };

// Typens katalog pr. indsats (kravspec §7 spm. 3, anbefaling: standardprogrammet
// for typen, filtreret paa indsats). Fem pladser; serveren fylder de AABNE felter
// i raekkefoelge og springer etaper over.
const HARD: Record<RiderType, [Session, Session]> = {
  Klatrer: ["vo2max_climb", "threshold"],
  Sprinter: ["sprint", "vo2max"],
  Brostensrytter: ["cobbled_sectors", "threshold"],
  Puncheur: ["vo2max_punch", "attack_repeats"],
  Enkeltstartsrytter: ["threshold", "vo2max"],
  Rouleur: ["echelon_drills", "threshold"],
  Allround: ["vo2max", "threshold"],
};
const LIGHT_SKILL: Record<RiderType, Session> = {
  Klatrer: "technique", Sprinter: "technique", Brostensrytter: "technique", Puncheur: "loebslaere",
  Enkeltstartsrytter: "aero", Rouleur: "loebslaere", Allround: "technique",
};

export function quickPattern(q: Quick): Session[] {
  if (q.kind === "rest") return Array(5).fill(q.rest);
  const [h1, h2] = HARD[q.type];
  const skill = LIGHT_SKILL[q.type];
  if (q.effort === "hard") return [h1, h2, h1, "tempo", "recovery"];
  if (q.effort === "mellem") return ["tempo", h1, "tempo", "endurance", skill];
  return ["endurance", skill, "endurance", "endurance", "recovery"];
}

/**
 * Datoens fem felter. `base` er programmets/rytmens felter for datoen (allerede
 * med etaper). Hurtigvalget laegges paa de aabne felter i raekkefoelge; et
 * manuelt felt vinder over begge. Etaper og koerte felter roeres aldrig.
 */
export function resolveDate(
  base: readonly R4Field[],
  quick: Quick | null,
  manual: Readonly<Record<number, Session>>,
): R4Field[] {
  const pattern = quick ? quickPattern(quick) : null;
  let next = 0;
  return base.map((field, i) => {
    if (field.kind === "stage" || field.done) return field;
    if (manual[i] !== undefined) return { kind: "train", session: manual[i], source: "manual" };
    if (pattern) {
      const session = pattern[next] ?? pattern[pattern.length - 1];
      next += 1;
      return { kind: "train", session, source: "quick" };
    }
    return field;
  });
}

/** Har datoen noget, der kun gaelder den dato (hurtigvalg eller manuelt felt)? */
export function hasDateOverride(quick: Quick | null, manual: Readonly<Record<number, Session>>): boolean {
  return quick !== null || Object.keys(manual).length > 0;
}

export const SOURCE_WORD: Record<FieldSource, string> = {
  stage: "Etape",
  done: "Kørt",
  manual: "Manuel",
  quick: "Hurtigvalg",
  program: "Program",
  group: "Gruppe",
  team: "Holdrytme",
  default: "Standard",
  rule: "Træthed",
};
