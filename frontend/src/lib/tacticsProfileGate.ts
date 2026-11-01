// #7317 (ejer 28/10, D6): vej-ordrer paa tidskoersel.
//
// Paa enkeltstart (itt), bakket enkeltstart (itt_hilly) og holdtidskoersel (ttt) kaerer
// motoren ingen udbruds-, tog- eller angrebsordrer (V4-dispatch sender ikke input.orders
// videre). Fladen skjuler dem derfor dér, og serveren afviser dem (samme kontrakt:
// backend/lib/raceTeamOrdersApi.js, `isTimeTrialProfile`). Indsatsen er et separat input
// og beroeres IKKE. Gemte ordrer paa aeldre etaper roeres ikke her — kun en ny gem fra
// fladen paa en tidskoerselsetape skriver dem uden vej-felter.

const TIME_TRIAL_PROFILES: ReadonlySet<string> = new Set(["itt", "itt_hilly", "ttt"]);

export type TeamOrderLike = {
  breakaway_stance?: string;
  riders?: Array<Record<string, unknown>>;
  [key: string]: unknown;
};

/** Er etapen en tidskoersel (enkeltstart, bakket enkeltstart eller holdtidskoersel)? */
export function isTimeTrialStage(profileType: unknown): boolean {
  return typeof profileType === "string" && TIME_TRIAL_PROFILES.has(profileType);
}

/** Er udbruds-/tog-/angrebsvalg tilgaengelige paa etapen? Falsk paa alle tidskoersler. */
export function roadOrdersAvailable(profileType: unknown): boolean {
  return !isTimeTrialStage(profileType);
}

/**
 * Ordren uden vej-felter: neutral holdholdning, ingen udbrud, intet tog. Indsats og
 * rytter-id'er passerer uaendret. Ren; samme objekt tilbage paa en vej-etape.
 */
export function withoutRoadOrders<T extends TeamOrderLike>(order: T, profileType: unknown): T {
  if (roadOrdersAvailable(profileType) || !order) return order;
  return {
    ...order,
    breakaway_stance: "neutral",
    riders: (order.riders ?? []).map((r) => ({ ...r, try_break: false, leadout: false })),
  };
}
