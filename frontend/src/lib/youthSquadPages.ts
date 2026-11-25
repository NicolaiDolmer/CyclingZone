// #5519: U23 team- og Junior team-siderne: kontakten, ruterne og menupunkterne.
//
// Kilden er app_config-flaget `youth_squad_pages` (off|beta|on), evalueret
// SERVER-side mod viewerens beta-status og leveret som en bar boolean i
// GET /api/display-flags (backend/lib/youthSquadPagesFlag.js). Klienten læser
// aldrig app_config selv. Fail-safe er OFF: intet svar, fejl eller ukendt
// værdi betyder dagens visning (ingen menupunkter, Coming soon-kortet står).
//
// Sidst kendte værdi caches pr. browser, så menuen ikke blinker ved hver
// sideload. Cachen er kun en startværdi; serverens svar vinder altid.
//
// Ren .ts uden React-import, så node --test kan loade den.

/** De to ungdomstrupper med egen side, i menu-rækkefølge (HANDOFF 3a). */
export const YOUTH_SQUADS = ["u23", "junior"] as const;
export type YouthSquad = (typeof YOUTH_SQUADS)[number];

export function isYouthSquad(value: unknown): value is YouthSquad {
  return typeof value === "string" && (YOUTH_SQUADS as readonly string[]).includes(value);
}

/** Rute pr. trup. Bevidst IKKE under /team: "/team"-menupunktet ville ellers
 *  lyse op sammen med trup-punktet (navMatching.js matcher på prefix). */
export function youthSquadPath(squad: YouthSquad): string {
  return `/squads/${squad}`;
}

export const YOUTH_SQUAD_PATHS: readonly string[] = YOUTH_SQUADS.map(youthSquadPath);

const NAV_LABEL_KEY: Record<YouthSquad, string> = {
  u23: "nav.item.u23Team",
  junior: "nav.item.juniorTeam",
};

export interface NavItem { to: string; label: string }

/**
 * Menupunkterne der står lige efter My Team i Klubhus. Tom liste når
 * kontakten er slukket, så spread'en i buildNavGroups blot udelader dem
 * (samme mønster som scoutingNavItem/facilitiesNavItem).
 */
export function youthSquadNavItems(enabled: boolean, t: (key: string) => string): NavItem[] {
  if (!enabled) return [];
  return YOUTH_SQUADS.map((squad) => ({ to: youthSquadPath(squad), label: t(NAV_LABEL_KEY[squad]) }));
}

interface YouthSquadsResponse {
  squads?: Partial<Record<YouthSquad, { riderIds?: unknown }>>;
}

/**
 * Rytter-id'erne for én trup i svaret fra GET /api/youth-squads. Et
 * uventet svar giver en tom liste (siden viser da sin tomme tilstand), aldrig
 * en exception midt i render.
 */
export function riderIdsForSquad(payload: unknown, squad: YouthSquad): string[] {
  const ids = (payload as YouthSquadsResponse | null)?.squads?.[squad]?.riderIds;
  return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === "string" && id.length > 0) : [];
}

// ── Kontakt-store ───────────────────────────────────────────────────────────

const STORAGE_KEY = "cz_youth_squad_pages";

function readCached(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let youthSquadPages = readCached();
const listeners = new Set<() => void>();

export function isYouthSquadPagesOn(): boolean {
  return youthSquadPages;
}

export function setYouthSquadPages(enabled: boolean): void {
  const next = enabled === true;
  try {
    if (typeof localStorage !== "undefined") {
      if (next) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Blokeret storage: kontakten virker stadig for denne sideload.
  }
  if (next === youthSquadPages) return;
  youthSquadPages = next;
  for (const fn of listeners) fn();
}

export function subscribeYouthSquadPages(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
