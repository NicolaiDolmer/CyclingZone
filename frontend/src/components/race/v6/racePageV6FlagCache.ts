// #7865 (punkt 7) · Den sidst kendte værdi af kontakten race_page_v6 i browseren.
// Ren hjælper uden imports, så den kan prøves uden React og uden netværk.
// Bruges kun til første billede; serverens svar vinder altid bagefter. Værdien
// gemmes med kontoens id, så en anden konto i samme browser ikke arver den.

export const RACE_PAGE_V6_LAST_KEY = "cz_race_page_v6_last";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface RememberedRacePageV6 {
  userId: string | null;
  on: boolean;
}

const NOTHING: RememberedRacePageV6 = Object.freeze({ userId: null, on: false });

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // catch-ok: blokeret lager = ingen husket værdi = gammel side straks
  }
}

/** Den sidst kendte værdi; alt andet end en gyldig husket "til" er slukket. */
export function readLastRacePageV6(storage: StorageLike | null = defaultStorage()): RememberedRacePageV6 {
  try {
    const raw = storage?.getItem(RACE_PAGE_V6_LAST_KEY);
    if (!raw) return NOTHING;
    const parsed = JSON.parse(raw) as { userId?: unknown; on?: unknown } | null;
    if (!parsed || typeof parsed.userId !== "string" || parsed.on !== true) return NOTHING;
    return { userId: parsed.userId, on: true };
  } catch {
    return NOTHING; // catch-ok: ulæseligt lager = slukket = som i dag
  }
}

export function writeLastRacePageV6(value: RememberedRacePageV6, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(RACE_PAGE_V6_LAST_KEY, JSON.stringify({ userId: value.userId, on: value.userId != null && value.on }));
  } catch {
    /* catch-ok: kan værdien ikke huskes, gælder serverens svar stadig */
  }
}

/**
 * Den huskede værdi gælder kun for den konto, der gemte den. Kendes kontoen
 * (sessionen er læst) og er den en anden, er kontakten slukket, til serveren svarer.
 */
export function rememberedFor(remembered: RememberedRacePageV6, currentUserId: string | null): boolean {
  return remembered.on && remembered.userId != null && remembered.userId === currentUserId;
}

/**
 * Serverens svar (GET /api/feature-flags) → hvad der skal huskes. null = svaret kendte
 * ikke kontakten (fejl eller {}): slukket nu, men det huskede overskrives ikke.
 */
export function rememberedFromFlags(flags: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const value = flags?.[key];
  return typeof value === "boolean" ? value : null;
}
