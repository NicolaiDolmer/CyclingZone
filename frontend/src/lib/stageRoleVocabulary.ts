// #7326 (T1 i #7322): ét fælles, typet rollevokabular for de flader der VISER
// en rytters løbsrolle. Før havde holdoversigten (RaceTeamTab) og efter-etape-
// oversigten (StageOrdersRecap) hver sin lokale liste med de fem gamle roller,
// så delt kaptajn (#5981/#7239) og luksushjælper (#5982) blev vist som hjælper
// eller slet ikke.
//
// Samme sæt som backendens VALID_RACE_ROLES (backend/lib/raceRoles.js) og
// taktikfanens SELECTABLE_ROLES (stageRoleMatrixLogic.js); stageRoleVocabulary
// .test.ts holder de tre lister ens. Hvilke roller der må VÆLGES i et konkret
// løb, bestemmer serverens feature-/revisionsgate stadig; denne fil handler kun
// om at vise den rolle der faktisk står på rytteren.
//
// Mappings er Record<StageRole, ...>, så compileren kræver en værdi for hver
// rolle: tilføjes en ny rolle til STAGE_ROLES, fejler typecheck indtil alle
// visninger kender den. En ukendt værdi giver null, aldrig en anden gyldig rolle.

export const STAGE_ROLES = Object.freeze([
  "captain",
  "co_captain",
  "sprint_captain",
  "hunter",
  "free_role",
  "luxury_helper",
  "helper",
] as const);

export type StageRole = (typeof STAGE_ROLES)[number];

const ROLE_SET: ReadonlySet<string> = new Set(STAGE_ROLES);

export function isStageRole(value: unknown): value is StageRole {
  return typeof value === "string" && ROLE_SET.has(value);
}

// i18n-nøgle (races-namespace) for rollens navn. Eksisterende oversættelser i
// tacticsOrders.roleLabel; ingen nye tekster.
const ROLE_LABEL_KEY: Readonly<Record<StageRole, string>> = Object.freeze({
  captain: "tacticsOrders.roleLabel.captain",
  co_captain: "tacticsOrders.roleLabel.co_captain",
  sprint_captain: "tacticsOrders.roleLabel.sprint_captain",
  hunter: "tacticsOrders.roleLabel.hunter",
  free_role: "tacticsOrders.roleLabel.free_role",
  luxury_helper: "tacticsOrders.roleLabel.luxury_helper",
  helper: "tacticsOrders.roleLabel.helper",
});

/** i18n-nøglen for rollens navn, eller null for en ukendt/manglende værdi. */
export function roleLabelKey(role: unknown): string | null {
  return isStageRole(role) ? ROLE_LABEL_KEY[role] : null;
}

// Visningsrækkefølge i rollelister: kaptajnerne først, hjælperne sidst. Den
// delte kaptajn står lige efter kaptajnen, luksushjælperen lige før hjælperen.
const ROLE_RANK: Readonly<Record<StageRole, number>> = Object.freeze({
  captain: 0,
  co_captain: 1,
  sprint_captain: 2,
  hunter: 3,
  free_role: 4,
  luxury_helper: 5,
  helper: 6,
});

/** Sorteringsnøgle; ukendt/manglende rolle lægges efter alle kendte. */
export function roleRank(role: unknown): number {
  return isStageRole(role) ? ROLE_RANK[role] : STAGE_ROLES.length;
}
