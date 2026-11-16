// #8081: små rene regler for de tre designudgaver af akademisiden.
//
// Udgaverne vises KUN bag URL-parameteren ?design8081=a|b|c. Uden parameter
// renderer AcademyPage præcis som før.

export type DesignVariant = "a" | "b" | "c";
export type SquadKey = "senior" | "u23" | "junior";
export type SquadCountsAll = Partial<Record<SquadKey, number | null>>;
export type AgeShare = "many" | "some" | "few";

export const DESIGN_8081_VARIANTS: readonly DesignVariant[] = Object.freeze(["a", "b", "c"]);
export const DESIGN_8081_TABS: readonly string[] = Object.freeze(["intake", "talents", "ledger", "profile"]);

/** "a" | "b" | "c" | null ud fra location.search. */
export function readDesign8081Variant(search: string | null | undefined): DesignVariant | null {
  try {
    const v = String(new URLSearchParams(search ?? "").get("design8081") ?? "").trim().toLowerCase();
    return (DESIGN_8081_VARIANTS as readonly string[]).includes(v) ? (v as DesignVariant) : null;
  } catch {
    return null;
  }
}

/** Startfane til billederne (?tab8081=ledger); ukendt = optaget. */
export function readDesign8081Tab(search: string | null | undefined): string {
  try {
    const v = String(new URLSearchParams(search ?? "").get("tab8081") ?? "").trim();
    return DESIGN_8081_TABS.includes(v) ? v : "intake";
  } catch {
    return "intake";
  }
}

// #7932 (ejer 9/11): trupgrænserne, vist som midlertidige indtil U23/junior er
// udgivet. Kun visning i designet; de gældende grænser er uændrede.
export const DESIGN_SQUAD_LIMITS: Readonly<Record<SquadKey | "total", number>> = Object.freeze({
  senior: 30, u23: 30, junior: 30, total: 60,
});

const JUNIOR_MAX_AGE = 18;
const U23_MAX_AGE = 22;

/**
 * #7932: et hentet talent går direkte på den yngste trup der har plads, som han
 * er ung nok til (junior fyldt -> U23 -> senior). null = ingen plads nogen steder.
 */
export function designLandingSquad(
  age: number | null | undefined,
  counts: SquadCountsAll | null | undefined,
  limits: Readonly<Record<SquadKey | "total", number>> = DESIGN_SQUAD_LIMITS,
): SquadKey | null {
  const n = (k: SquadKey) => Number(counts?.[k]) || 0;
  const total = n("senior") + n("u23") + n("junior");
  if (total >= limits.total) return null;
  const order: SquadKey[] = [];
  if (age == null || age <= JUNIOR_MAX_AGE) order.push("junior");
  if (age == null || age <= U23_MAX_AGE) order.push("u23");
  order.push("senior");
  return order.find((squad) => n(squad) < limits[squad]) ?? null;
}

// #6944 (skitse B i PR #8185, anbefalet): ét fokus-valg. Blandet er standard;
// en valgt alder fylder mest, de andre dukker stadig op, bare sjældnere.
// Fordelingen vises kun med ord (mange / nogle / få), aldrig med tal.
export const AGE_FOCUS_OPTIONS: readonly string[] = Object.freeze(["mixed", "16", "17", "18", "19"]);
const AGES = [16, 17, 18, 19];
const MIXED_SHARE: Record<number, AgeShare> = { 16: "many", 17: "some", 18: "some", 19: "few" };

/** [{ age, share, squad }] for et fokus-valg. */
export function ageFocusDistribution(focus: string): { age: number; share: AgeShare; squad: "junior" | "u23" }[] {
  return AGES.map((age) => {
    let share: AgeShare = MIXED_SHARE[age] ?? "few";
    if (focus !== "mixed" && AGE_FOCUS_OPTIONS.includes(focus)) {
      share = String(age) === focus ? "many" : "few";
    }
    return { age, share, squad: age <= JUNIOR_MAX_AGE ? "junior" : "u23" };
  });
}
