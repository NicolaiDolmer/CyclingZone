// #3496/#3491: notification-klik skal føre til BESLUTNINGEN/det relevante
// underliggende indhold — ikke altid bare den generiske rytterprofil, blot
// fordi metadata bærer en riderId (#1486-reglen nedenfor). Ren funktion, uden
// DOM-afhængighed (samme udtræknings-mønster som lib/groupNotifications.js),
// så den kan testes direkte med node --test og importeres af
// NotificationsPage.jsx's click-handler.
//
// #3496: tilbuds-/modbuds-/byttehandels-notifikationer bar ALLEREDE
// TYPE_CONFIG.link="/transfers" (hvor "modtaget"-fanen viser selve
// beslutningen + et rytterkort med hvem/hvad/pris — #3496 punkt 1+2), men
// #1486-reglen overstyrede dette til /riders/:riderId, hver gang backend
// (transferNotifications.js's withRider-helper) også satte metadata.riderId
// — hvilket den gør for ALLE disse typer. Spilleren landede altså på
// rytterprofilen i stedet for "gør noget"-siden, præcis som rapporteret i
// #3496's Discord-tråd.
const TRANSFER_DECISION_TYPES = new Set([
  "transfer_offer_received",
  "transfer_offer_accepted",
  "transfer_offer_rejected",
  "transfer_offer_withdrawn",
  "transfer_counter",
]);

/**
 * Udled navigations-target for et klik på én notifikation i "Mine"-fanen.
 * @param {{type?:string, metadata?:object, related_id?:string}} notification
 * @param {string|null|undefined} fallbackLink — TYPE_CONFIG[notification.type]?.link
 * @returns {string|null}
 */
// #4557 (S-M2d): aarsmoede-notifikationer (aabning + de to reminders) skal
// lande direkte paa /board/meeting, ikke det generiske /board — spilleren
// klikkede netop FORDI moedet venter. /board/meeting er selv rute-vagtet
// (AnnualMeetingRoute.jsx falder tilbage til /board hvis moedet allerede er
// lukket), saa et forsinket klik lander stadig et sikkert sted.
// boardMandateAutoAccepted er bevidst UDELADT: moedet er allerede
// underskrevet naar den notifikation fyrer, saa /board (boardroom med det
// nye mandat) er den rigtige landing, ikke ruten der straks ville sende
// spilleren tilbage.
const BOARD_MEETING_TITLE_CODES = new Set([
  "notif.boardMandateOpened.title",
  "notif.boardMandateT1Reminder.title",
  "notif.boardMandateT3Reminder.title",
]);

export function resolveNotificationLink(notification, fallbackLink) {
  const n = notification || {};
  const meta = n.metadata || {};

  if (TRANSFER_DECISION_TYPES.has(n.type)) {
    return fallbackLink ?? null;
  }

  if ((n.type === "board_update" || n.type === "board_critical") && BOARD_MEETING_TITLE_CODES.has(meta.titleCode)) {
    return "/board/meeting";
  }

  // #3491: scout-rapport for en enkelt-rytter-undersøgelse (kind="target",
  // metadata.riderId sat af buildScoutReportReadyNotification) skal lande
  // direkte på scout-fanen — ikke rytterprofilens standardfane, hvor
  // spilleren selv skulle finde den rapport notifikationen handlede om.
  // Mission-fund (intet riderId) falder uændret videre til den generiske
  // #1486-regel og ender på fallbackLink ("/scouting").
  if (n.type === "scout_report_ready" && meta.riderId) {
    return `/riders/${meta.riderId}?tab=scouting`;
  }

  // #1486: rytter-centrerede notifikationer bærer riderId i metadata og
  // deep-linker direkte til rytterprofilen.
  if (meta.riderId) return `/riders/${meta.riderId}`;

  // #921: legacy "Transferrygte" bruger related_id (ingen metadata).
  if (n.type === "transfer_interest" && n.related_id) return `/riders/${n.related_id}`;

  // #1952: resultat-notifikation deep-linker direkte til løbets resultatside.
  // #3243: stage_result bar SAMME metadata.raceId (#2523) men manglede denne
  // regel og faldt til den generiske /resultater.
  if ((n.type === "race_result" || n.type === "stage_result") && (meta.raceId || n.related_id)) {
    return `/races/${meta.raceId || n.related_id}`;
  }

  // #2180/#3310: selection_warning bærer raceId (samme mønster som
  // race_result/stage_result) og deep-linker til løbets selection-panel i
  // stedet for det generiske kalender-board.
  if (n.type === "selection_warning" && (meta.raceId || n.related_id)) {
    return `/races/${meta.raceId || n.related_id}#selection`;
  }

  // #2832-review (ejer-merge-krav): season_ended bærer den AFSLUTTEDE sæsons
  // id i related_id (emitSeasonEndedNotifications). Uden dette pegede
  // beskeden på det generiske /seasons, som defaulter til den AKTIVE (nye,
  // tomme) sæson lige efter en transition.
  if (n.type === "season_ended" && n.related_id) return `/seasons/${n.related_id}`;

  // #4118/#3517: svar på egen tråd — related_id er post_id, deep-link
  // direkte til tråden i stedet for den generiske forum-forside.
  if (n.type === "forum_thread_reply" && n.related_id) return `/forum/${n.related_id}`;

  return fallbackLink ?? null;
}
