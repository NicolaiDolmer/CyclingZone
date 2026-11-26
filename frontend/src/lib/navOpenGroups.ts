// #8816 · Menuens foldbare grupper (TASTE v2, ejer 26/11): den gruppe, der
// rummer siden man står på, er altid åben; de andre husker spillerens eget valg
// på denne enhed. Gælder kun bag kontakten sentence_case_8725; slukket kontakt
// beholder den gamle adfærd (aktiv gruppe foldes ud ved navigation, intet huskes).
//
// Ren logik, så den kan dækkes af node --test. Lagringen er en bekvemmelighed
// pr. browser: fejler den (privat vindue, blokeret lager), opfører menuen sig
// blot som om intet er husket.

export const NAV_OPEN_GROUPS_KEY = "cz_nav_open_groups_8816";

export type OpenGroups = Record<string, boolean>;

/** Læser en gemt værdi defensivt: kun nøgler med boolske værdier overlever. */
export function parseOpenGroups(raw: string | null | undefined): OpenGroups {
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const out: OpenGroups = {};
    for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof value === "boolean") out[key] = value;
    }
    return out;
  } catch {
    return {};
  }
}

export function readOpenGroups(storage: Pick<Storage, "getItem"> | null | undefined = globalThis.localStorage): OpenGroups {
  try {
    return parseOpenGroups(storage?.getItem(NAV_OPEN_GROUPS_KEY));
  } catch {
    return {};
  }
}

export function writeOpenGroups(groups: OpenGroups, storage: Pick<Storage, "setItem"> | null | undefined = globalThis.localStorage): void {
  try {
    storage?.setItem(NAV_OPEN_GROUPS_KEY, JSON.stringify(groups));
  } catch {
    // Kun en bekvemmelighed: uden lager huskes valget bare ikke.
  }
}

/** Er gruppen foldet ud? Den aktive gruppe er altid åben, når låsen er slået til. */
export function isGroupOpen(key: string, openGroups: OpenGroups, activeKey: string | null | undefined, lockActive: boolean): boolean {
  if (lockActive && key === activeKey) return true;
  return Boolean(openGroups[key]);
}
