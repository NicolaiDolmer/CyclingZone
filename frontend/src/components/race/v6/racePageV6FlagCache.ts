// #7865 (punkt 7) · Den sidst kendte værdi af kontakten race_page_v6 i browseren.
// Ren hjælper uden imports, så den kan prøves uden React og uden netværk.
// Bruges kun til første billede; serverens svar vinder altid bagefter.

export const RACE_PAGE_V6_LAST_KEY = "cz_race_page_v6_last";

export type StorageLike = Pick<Storage, "getItem" | "setItem">;

function defaultStorage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // catch-ok: blokeret lager = ingen husket værdi = gammel side straks
  }
}

/** Den sidst kendte værdi; alt andet end en husket "1" er slukket. */
export function readLastRacePageV6(storage: StorageLike | null = defaultStorage()): boolean {
  try {
    return storage?.getItem(RACE_PAGE_V6_LAST_KEY) === "1";
  } catch {
    return false; // catch-ok: ulæseligt lager = slukket = som i dag
  }
}

export function writeLastRacePageV6(enabled: boolean, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(RACE_PAGE_V6_LAST_KEY, enabled ? "1" : "0");
  } catch {
    /* catch-ok: kan værdien ikke huskes, gælder serverens svar stadig */
  }
}

/**
 * Serverens svar (GET /api/feature-flags) → hvad der skal huskes. null = svaret kendte
 * ikke kontakten (fejl eller {}): slukket nu, men det huskede overskrives ikke.
 */
export function rememberedFromFlags(flags: Record<string, unknown> | null | undefined, key: string): boolean | null {
  const value = flags?.[key];
  return typeof value === "boolean" ? value : null;
}
