// D-047 (ejer 10/9 kl. 15:20, #5102) — mobilstandarden for T2-tabeller.
//
// På ≤640px viser enhver DataTable navnekolonnen + PRÆCIS tre datakolonner uden
// vandret scroll. En chip-række over tabellen bytter kolonner, og valget huskes
// pr. KOLONNESÆT (ikke pr. oversat label — se `mobileColumnsStorageKey`).
// "Fuld tabel" åbner alle kolonner som to-lags (navneblok + scrollbar datablok).
// Denne fil er den RENE logik bag kolonnevalget, så den kan testes med
// `node --test` uden en DOM (DataTable.jsx ejer selve markuppen).
//
// "Tre TALkolonner" er standard-fyldet, ikke en spærring: de tre pladser fyldes
// numerisk-først, men en side må sætte en handlings- eller badge-kolonne som en
// af sine tre (`mobileDefaults`), og spilleren må bytte en ind. Ønskelisten,
// Mit hold og Akademiet gør det med rækkens handlingsknap — ellers ville sidens
// primære handling ligge bag "Fuld tabel" på mobil.
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

/**
 * Chip-raekkens orden: de VALGTE tre foerst (i kolonneorden), derefter resten (i
 * kolonneorden). Uden det kan alle tre valgte staa uden for skaermen i en tabel
 * med mange kolonner — spilleren kan ikke se hvad han faktisk kigger paa, og
 * chip-raekken holder op med at vaere en tilstandsvisning.
 */
export function orderMobileChips<T extends MobileColumnLike>(
  columns: readonly T[],
  selected: readonly string[]
): T[] {
  const swappable = mobileSwappableColumns(columns);
  return [
    ...swappable.filter((c) => selected.includes(c.key)),
    ...swappable.filter((c) => !selected.includes(c.key)),
  ];
}

/**
 * Chip-rækken tegnet i en FRYSSET orden (nøgler fra `orderMobileChips` ved
 * åbning). Ukendte nøgler i ordenen ignoreres, og kolonner der ikke står i den
 * hænges bagpå i kolonneorden — så en tabel der skifter kolonnesæt midt i livet
 * ikke taber en chip.
 */
export function applyMobileChipOrder<T extends MobileColumnLike>(
  columns: readonly T[],
  order: readonly string[]
): T[] {
  const swappable = mobileSwappableColumns(columns);
  const byKey = new Map(swappable.map((c) => [c.key, c]));
  const out: T[] = [];
  for (const key of order) {
    const col = byKey.get(key);
    if (col && !out.includes(col)) out.push(col);
  }
  for (const col of swappable) if (!out.includes(col)) out.push(col);
  return out;
}

/** Visningsorden = desktopens kolonneorden (D-047: sortering og orden som desktop). */
export function orderMobileColumns<T extends MobileColumnLike>(
  columns: readonly T[],
  selected: readonly string[]
): T[] {
  return mobileSwappableColumns(columns).filter((c) => selected.includes(c.key));
}

/**
 * localStorage-nøglen. Den bygges på tabellens KOLONNESÆT, ikke på dens viste
 * label: labelet er oversat og tæller ofte rækker med ("Trup (1)" / "Squad (1)"),
 * så en nøgle af labelet ville tabe spillerens valg hver gang han køber en
 * rytter eller skifter sprog. Kolonnesættet er derimod stabilt for en side og
 * FORSKELLIGT for to linser på samme side (Mit holds Overblik/Evner, Standings'
 * to visninger), som ellers ville overskrive hinandens valg.
 *
 * Nøglen er en kort FNV-1a-hash af nøglerne, så en tabel med 18 kolonner ikke
 * får en 200 tegn lang localStorage-nøgle. `v2` er nøgle-generationen: v1 var
 * label-baseret, og de gamle værdier skal ikke læses ind som om de hørte til.
 */
export function mobileColumnsSignature(columns: readonly MobileColumnLike[]): string {
  let hash = 0x811c9dc5;
  const source = columns.map((c) => `${c.sticky ? "!" : c.fold ? "~" : ""}${c.key}`).join("|");
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(36);
}

export function mobileColumnsStorageKey(columns: readonly MobileColumnLike[]): string | null {
  if (!Array.isArray(columns) || columns.length === 0) return null;
  return `cz:table-cols:v2:${mobileColumnsSignature(columns)}`;
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
  columns: readonly MobileColumnLike[],
  mobileDefaults?: readonly string[] | null
): string[] {
  const key = mobileColumnsStorageKey(columns);
  const store = key ? storage() : null;
  if (!store) return normalizeMobileColumnKeys(null, columns, mobileDefaults);
  try {
    return normalizeMobileColumnKeys(JSON.parse(store.getItem(key as string) ?? "null"), columns, mobileDefaults);
  } catch {
    return normalizeMobileColumnKeys(null, columns, mobileDefaults);
  }
}

export function writeMobileColumnKeys(columns: readonly MobileColumnLike[], keys: readonly string[]): void {
  const key = mobileColumnsStorageKey(columns);
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
