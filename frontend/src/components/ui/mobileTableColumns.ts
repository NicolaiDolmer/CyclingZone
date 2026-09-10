// D-047 (ejer 10/9 kl. 15:20, #5102) — mobilstandarden for T2-tabeller.
//
// På ≤640px viser enhver DataTable navnekolonnen + PRÆCIS tre talkolonner uden
// vandret scroll. En chip-række over tabellen bytter kolonner, og valget huskes
// pr. tabel-label. "Fuld tabel" åbner alle kolonner som to-lags (navneblok +
// scrollbar datablok). Denne fil er den RENE logik bag kolonnevalget, så den kan
// testes med `node --test` uden en DOM (DataTable.jsx ejer selve markuppen).
//
// Kolonneroller på mobil:
//   sticky  → navnekolonnen. Altid låst, aldrig en chip (D-047: en til/fra-knap
//             ville styre noget der aldrig kan slås fra).
//   fold    → tekst-meta (nation, alder, …) der folder ind i navnecellens
//             underlinje som hidtil. Ikke en chip — den er allerede synlig.
//   resten  → "swappable": chip-rækkens kolonner.

export const MOBILE_COLUMN_COUNT = 3;

export type MobileColumnLike = {
  key: string;
  sticky?: boolean;
  fold?: boolean;
  numeric?: boolean;
};

/** Kolonnerne spilleren kan bytte imellem på mobil (alt der ikke er navn/fold). */
export function mobileSwappableColumns<T extends MobileColumnLike>(columns: readonly T[]): T[] {
  return columns.filter((c) => !c.sticky && !c.fold);
}

/**
 * De tre kolonner en side starter med. `mobileDefaults` er sidens eget valg
 * (kun gyldige, byttebare nøgler tæller med); mangler der noget, fyldes der op
 * med de første NUMERISKE kolonner og derefter resten i kolonneorden — så en
 * side der ikke har sat `mobileDefaults` stadig lander på tre tal og ikke på tre
 * badge-kolonner.
 */
export function defaultMobileColumnKeys(
  columns: readonly MobileColumnLike[],
  mobileDefaults?: readonly string[] | null
): string[] {
  const swappable = mobileSwappableColumns(columns);
  const valid = new Set(swappable.map((c) => c.key));
  const picked: string[] = [];
  const add = (key: string) => {
    if (valid.has(key) && !picked.includes(key) && picked.length < MOBILE_COLUMN_COUNT) picked.push(key);
  };

  for (const key of mobileDefaults ?? []) add(key);
  for (const col of swappable) if (col.numeric) add(col.key);
  for (const col of swappable) add(col.key);
  return picked;
}

/**
 * Gør en gemt (eller på anden vis upålidelig) liste til et brugbart valg:
 * ukendte/forældede nøgler smides væk, dubletter fjernes, og der fyldes op fra
 * sidens defaults. Rækkefølgen er VALG-rækkefølge (ældste først) — den er det
 * `swapMobileColumn` bruger til at vide hvilken kolonne der ryger ud.
 */
export function normalizeMobileColumnKeys(
  stored: unknown,
  columns: readonly MobileColumnLike[],
  mobileDefaults?: readonly string[] | null
): string[] {
  const valid = new Set(mobileSwappableColumns(columns).map((c) => c.key));
  const keys: string[] = [];
  if (Array.isArray(stored)) {
    for (const key of stored) {
      if (typeof key === "string" && valid.has(key) && !keys.includes(key) && keys.length < MOBILE_COLUMN_COUNT) {
        keys.push(key);
      }
    }
  }
  for (const key of defaultMobileColumnKeys(columns, mobileDefaults)) {
    if (!keys.includes(key) && keys.length < MOBILE_COLUMN_COUNT) keys.push(key);
  }
  return keys;
}

/**
 * Chip-tryk: en kolonne der ikke er valgt endnu skubber den ÆLDSTE valgte ud
 * (FIFO), så antallet altid er tre og spilleren kan blive ved med at bytte uden
 * først at skulle fravælge noget. Tryk på en allerede valgt kolonne gør intet —
 * standarden er tre kolonner, ikke "op til tre".
 */
export function swapMobileColumn(current: readonly string[], nextKey: string): string[] {
  if (current.includes(nextKey)) return [...current];
  const next = [...current, nextKey];
  return next.length > MOBILE_COLUMN_COUNT ? next.slice(next.length - MOBILE_COLUMN_COUNT) : next;
}

/** Visningsorden = desktopens kolonneorden (D-047: sortering og orden som desktop). */
export function orderMobileColumns<T extends MobileColumnLike>(
  columns: readonly T[],
  selected: readonly string[]
): T[] {
  return mobileSwappableColumns(columns).filter((c) => selected.includes(c.key));
}

/** localStorage-nøgle pr. tabel-label. Uden et tekst-label huskes valget ikke. */
export function mobileColumnsStorageKey(label: unknown): string | null {
  if (typeof label !== "string") return null;
  const trimmed = label.trim();
  return trimmed ? `cz:table-cols:${trimmed}` : null;
}

type StorageLike = Pick<Storage, "getItem" | "setItem">;

function storage(): StorageLike | null {
  try {
    return typeof window !== "undefined" ? window.localStorage : null;
  } catch {
    return null; // privat vindue / blokerede cookies — valget huskes bare ikke
  }
}

export function readMobileColumnKeys(
  label: unknown,
  columns: readonly MobileColumnLike[],
  mobileDefaults?: readonly string[] | null
): string[] {
  const key = mobileColumnsStorageKey(label);
  const store = key ? storage() : null;
  if (!store) return normalizeMobileColumnKeys(null, columns, mobileDefaults);
  try {
    return normalizeMobileColumnKeys(JSON.parse(store.getItem(key as string) ?? "null"), columns, mobileDefaults);
  } catch {
    return normalizeMobileColumnKeys(null, columns, mobileDefaults);
  }
}

export function writeMobileColumnKeys(label: unknown, keys: readonly string[]): void {
  const key = mobileColumnsStorageKey(label);
  const store = key ? storage() : null;
  if (!store) return;
  try {
    store.setItem(key as string, JSON.stringify(keys));
  } catch {
    /* quota/privat vindue — valget er en bekvemmelighed, ikke state vi må fejle på */
  }
}

/** Chip-label: kolonnens egen header når den er tekst, ellers `mobileLabel`. */
export function mobileColumnLabel(col: { key: string; header?: unknown; mobileLabel?: string }): string {
  if (typeof col.mobileLabel === "string" && col.mobileLabel) return col.mobileLabel;
  if (typeof col.header === "string" && col.header) return col.header;
  return col.key;
}
