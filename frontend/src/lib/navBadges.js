// Badge-tal pr. nav-punkt. Rene funktioner, unit-testbare — samme mønster som
// navMatching.js (lå før inline i Layout.jsx, hvor .jsx-filer ikke dækkes af
// node --test).
//
// #3521: Transfers-menupunktet fik sit eget badge-tal (ubesvarede indgående
// tilbud, kilden er den kanoniske `useActionSummary`-hook / `/api/inbox/pending`
// — samme tal som Indbakkens "Skal handles"-fane, IKKE en ny beregning) ved
// siden af Indbakkens ulæst-notifikations-tal. De to må ikke blandes sammen —
// derfor ét map pr. `to`-nøgle i stedet for det tidligere delte scalar-tal,
// som antog at kun ét nav-punkt nogensinde havde `badge: true`.

/**
 * Bygger `to` → badge-tal-kortet SidebarContent/NavItem slår op i.
 * @param {{ unread?: number, pendingOffersCount?: number }} args
 */
export function buildNavBadgeCounts({ unread = 0, pendingOffersCount = 0 } = {}) {
  return {
    "/notifications": unread,
    "/transfers": pendingOffersCount,
  };
}

/**
 * Badge-tallet for ét nav-item. 0 for items uden `badge: true`, uanset hvad
 * kortet indeholder for den `to` — badge-recipen (NavItem) tegner intet badge
 * ved 0.
 */
export function resolveNavBadgeCount(item, badgeCounts) {
  if (!item?.badge) return 0;
  return badgeCounts?.[item.to] ?? 0;
}

// Genbrugt visnings-recipe (#3439: loftet hævet fra "9+" til "99+" — det
// gamle "9+"-loft underspillede volumen nu hvor narrative resultat-
// notifikationer fylder mere, jf. #3399. Samme "99+"-mønster som
// NotificationsPage's aggregat-badge) — hidtil duplikeret tre steder
// (desktop NavItem, mobil-topbarens klokke, MobileQuickNav).
export function formatNavBadgeCount(count) {
  return count > 99 ? "99+" : String(count);
}
