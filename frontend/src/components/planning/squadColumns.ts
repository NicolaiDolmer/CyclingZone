// #7535 (ejervalg 20/11, A+B): paa pc staar Status, Traethed og Belastning skjult som standard i trup-tabellen,
// saa overskrifterne faar plads paa én linje og typen aldrig afkortes. Manageren slaar dem til i kolonnevaelgeren;
// valget huskes (samme lager-moenster som mobilens chip-raekke). Mobilen bruger stadig sin egen chip-raekke.
// Ren logik uden DOM, saa den kan testes med `node --test`.
export const OPTIONAL_COLUMNS = ["status", "fatigue", "load"] as const;
export type OptionalColumn = (typeof OPTIONAL_COLUMNS)[number];
const COLUMNS_PREF_KEY = "cz-planning-squadColumns";

/** Gemt valg -> kendte valgfrie kolonner i fast raekkefoelge; alt ukendt (eller intet gemt) = alle skjult. */
export function normalizeOptionalColumns(value: unknown): OptionalColumn[] {
  if (!Array.isArray(value)) return [];
  return OPTIONAL_COLUMNS.filter((c) => value.includes(c));
}

export function toggleOptionalColumn(current: OptionalColumn[], key: OptionalColumn): OptionalColumn[] {
  const next = current.includes(key) ? current.filter((c) => c !== key) : [...current, key];
  return OPTIONAL_COLUMNS.filter((c) => next.includes(c));
}

export function readColumnsPref(): OptionalColumn[] {
  try {
    const raw = localStorage.getItem(COLUMNS_PREF_KEY);
    return raw === null ? [] : normalizeOptionalColumns(JSON.parse(raw));
  } catch {
    return [];
  }
}

export function writeColumnsPref(value: OptionalColumn[]) {
  try {
    localStorage.setItem(COLUMNS_PREF_KEY, JSON.stringify(value));
  } catch {
    // catch-ok: privat tilstand eller blokeret lager; valget gaelder bare for denne session.
  }
}
