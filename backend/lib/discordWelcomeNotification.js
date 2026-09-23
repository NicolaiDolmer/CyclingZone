// #5130 (ejer-direktiv 10/9): "faa flere spillere ind paa Discord - nemmere
// indgang + velkomstbesked i indbakken tidligt i forloebet".
//
// Ren payload-builder (samme moenster som buildWelcomeNotification/
// buildSquadBelowMinimumNotification, notificationService.js) — selve
// afsendelsen + idempotens bor i discordWelcomeSweep.js.
//
// AFSENDER (orkestrator-valg, se PR-body #5211): systemafsenderen i
// indbakken (den generiske notifications-tabel), IKKE DM v1
// (dm_conversations kraever to rigtige managere som deltagere, #3200) og
// IKKE ejerens egen konto. Samme afsender-model som "welcome"-notifikationen
// (Gab 2, #2822).
export const DISCORD_WELCOME_TYPE = "discord_welcome";

/**
 * Byg payloaden for Discord-velkomstbeskeden. Ingen related_id (ikke knyttet
 * til nogen entitet) — CTA'en er et fast eksternt link (DISCORD_INVITE_URL,
 * frontend/src/lib/externalLinks.js), udledt af notifikationens TYPE i
 * NotificationsPage.jsx's TYPE_CONFIG, ikke af metadata her.
 *
 * #2761: kortets synlige "Join Discord"-knap og linjen om manager-forummet
 * rendres ogsaa af frontend ud fra TYPEN (notif.discordWelcome.cta/.forumLine),
 * ikke af payloaden. Derfor faar baade den loebende velkomst (#5130) og
 * backfill-udsendelsen (#2761) samme kort, ogsaa raekker der allerede er sendt.
 * Den engelske fallback nedenfor (e-mail-digest, gamle klienter) er uroert.
 */
export function buildDiscordWelcomeNotification() {
  return {
    type: DISCORD_WELCOME_TYPE,
    title: "Come hang out on Discord",
    message:
      "I'm in there, and so are the other managers: ask me anything, swap tactics, and get the roadbook before anyone else.",
    relatedId: null,
    metadata: {
      titleCode: "notif.discordWelcome.title",
      titleParams: {},
      messageCode: "notif.discordWelcome.message",
      messageParams: {},
    },
  };
}
