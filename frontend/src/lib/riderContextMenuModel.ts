// #7858 · Hoejreklik-menuen paa ryttere: hvilke valg giver mening for netop
// denne rytter, som ren data. Komponenten (components/rider/RiderContextMenu.tsx)
// renderer listen og udfoerer intet selv ud over at navigere eller kalde de
// handlinger der allerede findes (oenskeliste, MessageManagerButton-flowet).
//
// Ejer-godkendt menu 7/11 (Discord, #7858):
//   ALLE:   aabn profil, sammenlign med mine ryttere, resultater denne saeson.
//   ANDRES: oenskeliste (til/fra), giv et bud, send en scout, skriv til manageren.
//   EGNE:   ret plan for naeste etape (kun naar holdet er i et loeb), skift rolle,
//           saet paa transferlisten, forlaeng kontrakt, afskedig (bekraeftes).
//   Loebsfilm er bevidst IKKE med.
//
// Alt genbruger eksisterende skaerme: profilens faner (?tab=), transferlistens
// dybe link (?sell=1), sammenligningen (/compare?ids=) og loebssidens taktik
// (?tab=tactics). Afskedigelse foerer til profilen, hvor RiderManageActions
// spoerger "er du sikker?" som i dag; menuen afskediger aldrig selv.

export type RiderMenuGroup = "all" | "other" | "own";

export type RiderMenuKey =
  | "profile"
  | "compare"
  | "results"
  | "watchlistAdd"
  | "watchlistRemove"
  | "bid"
  | "scout"
  | "message"
  | "plan"
  | "role"
  | "transferList"
  | "extend"
  | "dismiss";

export type RiderMenuItem = {
  key: RiderMenuKey;
  group: RiderMenuGroup;
  /** Navigation til en eksisterende skaerm. */
  href?: string;
  /** Handling menuen selv udfoerer (via eksisterende flow). */
  action?: "watchlist" | "message";
  /** Destruktiv: vises sidst, i fare-farve, og bekraeftes paa profilen. */
  danger?: boolean;
};

export type RiderMenuInput = {
  riderId: string;
  /** Viewerens hold (null = ikke logget ind / intet hold). */
  viewerTeamId: string | null;
  /** Rytterens hold (null = fri rytter). */
  riderTeamId: string | null;
  /** Rytterens data er hentet. Foer det vises kun valgene for alle ryttere. */
  loaded: boolean;
  isRetired?: boolean;
  /** Rytteren er paa viewerens oenskeliste (null = ukendt endnu). */
  onWatchlist?: boolean | null;
  /** Holdet har en menneskelig manager man kan skrive til. */
  canMessageManager?: boolean;
  /** Det loeb viewerens hold koerer med rytteren lige nu (null = intet). */
  currentRaceId?: string | null;
};

function sameId(a: unknown, b: unknown): boolean {
  if (a === null || a === undefined || b === null || b === undefined) return false;
  return String(a) === String(b);
}

export function riderMenuOwnership(input: Pick<RiderMenuInput, "viewerTeamId" | "riderTeamId" | "loaded">): "unknown" | "own" | "other" | "none" {
  if (!input.loaded) return "unknown";
  if (input.viewerTeamId === null || input.viewerTeamId === undefined) return "none";
  return sameId(input.riderTeamId, input.viewerTeamId) ? "own" : "other";
}

export function buildRiderContextMenu(input: RiderMenuInput): RiderMenuItem[] {
  const id = encodeURIComponent(String(input.riderId));
  const profile = `/riders/${id}`;
  const items: RiderMenuItem[] = [
    { key: "profile", group: "all", href: profile },
    { key: "compare", group: "all", href: `/compare?ids=${id}` },
    { key: "results", group: "all", href: `${profile}?tab=results` },
  ];
  const ownership = riderMenuOwnership(input);
  const retired = input.isRetired === true;

  if (ownership === "other" && !retired) {
    if (input.onWatchlist === true) items.push({ key: "watchlistRemove", group: "other", action: "watchlist" });
    else if (input.onWatchlist === false) items.push({ key: "watchlistAdd", group: "other", action: "watchlist" });
    if (input.riderTeamId) items.push({ key: "bid", group: "other", href: profile });
    items.push({ key: "scout", group: "other", href: `${profile}?tab=scouting` });
    if (input.canMessageManager === true && input.riderTeamId) {
      items.push({ key: "message", group: "other", action: "message" });
    }
  }

  if (ownership === "own" && !retired) {
    if (input.currentRaceId) {
      const tactics = `/races/${encodeURIComponent(String(input.currentRaceId))}?tab=tactics`;
      items.push({ key: "plan", group: "own", href: tactics });
      items.push({ key: "role", group: "own", href: tactics });
    }
    items.push({ key: "transferList", group: "own", href: `${profile}?sell=1` });
    items.push({ key: "extend", group: "own", href: profile });
    items.push({ key: "dismiss", group: "own", href: profile, danger: true });
  }

  return items;
}

/** Skal et tastetryk aabne menuen (Shift+F10 eller kontekst-tasten)? */
export function isContextMenuKey(e: { key?: string; shiftKey?: boolean }): boolean {
  return e.key === "ContextMenu" || (e.key === "F10" && e.shiftKey === true);
}

/** Naeste fokus i menuen ved piletaster (ruller rundt). */
export function nextMenuIndex(current: number, count: number, key: string): number {
  if (count <= 0) return -1;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  return current;
}

/** Hvor menuen staar: ved markoeren, holdt inden for vinduet. */
export function placeContextMenu(
  point: { x: number; y: number },
  menu: { width: number; height: number },
  viewport: { width: number; height: number },
  margin = 8,
): { top: number; left: number } {
  const left = point.x + menu.width + margin > viewport.width ? point.x - menu.width : point.x;
  const top = point.y + menu.height + margin > viewport.height ? point.y - menu.height : point.y;
  return {
    left: Math.min(Math.max(left, margin), Math.max(margin, viewport.width - margin - menu.width)),
    top: Math.min(Math.max(top, margin), Math.max(margin, viewport.height - margin - menu.height)),
  };
}
