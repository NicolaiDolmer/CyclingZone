/**
 * #2619 — Board-DM-spejling gated på in-app dedup-resultat.
 *
 * `notifyUserWithBoardDM` (cron.js) spejlede `board_update`/`board_critical` til
 * en Discord-DM for HVER cron-tick, uafhængigt af om `notifyUser` faktisk
 * oprettede en ny in-app-notifikation eller ramte 24h-dedup'en. Board-crons
 * (`runBoardAutoAcceptCron` + `runMidSeasonReviewCron`) kører hvert 30. minut, så
 * en linket bruger med en pending board-plan ville få samme "📋 Board Update"-DM
 * hver halve time indtil planen blev indsendt (DM-spam). Samtidig så #2571-rate-
 * guarden en permanent 100%-skip-streak når den eneste due modtager var ulinket
 * (`discord_id = null`) → falsk-positiv Sentry-alarm (CYCLINGZONE-35).
 *
 * Fix: spejl kun til DM når in-app-notifikationen blev NYOPRETTET
 * (`result.delivered === true`). `notifyUser` returnerer `{ delivered:false,
 * deduped:true }` når den rammer 24h-vinduet, så dedup'ede reminders re-sender
 * ikke DM'en — DM-kadencen matcher nu in-app-kadencen (maks 1 pr. 24h pr.
 * board-event). Ændringen fejler "closed": den kan kun reducere antal DM-sends,
 * aldrig øge det.
 *
 * Faktoreret ud af cron.js til et injicerbart, unit-testbart seam (samme
 * separation som discordDmRecipient.js / discordDmTarget.js).
 */

const BOARD_DM_TYPES = new Set(["board_update", "board_critical"]);

/**
 * Byg den delte board-notifier som board-crons bruger til at spejle in-app
 * board-notifikationer til Discord-DM'er.
 *
 * @param {object} deps
 * @param {Function} deps.notifyUser          - notificationService.notifyUser (in-app + dedup).
 * @param {Function} deps.notifyBoardUpdateDM - discordNotifier.notifyBoardUpdateDM (fire-and-forget DM).
 * @param {object}   deps.supabase            - Supabase service-role-klient.
 * @returns {(args: object) => Promise<object>} notifyUserWithBoardDM(args)
 */
export function makeBoardDmNotifier({ notifyUser, notifyBoardUpdateDM, supabase }) {
  return async (args) => {
    const result = await notifyUser({ supabase, ...args });

    // Spejl KUN når in-app-notifikationen blev nyoprettet (ikke dedup-ramt) OG
    // typen er en board-DM-type. En dedup'et reminder (result.delivered !== true)
    // re-sender aldrig DM'en → ingen 30-min-re-forsøg, ingen DM-spam, ingen falsk
    // 100%-skip-streak i #2571-guarden.
    if (result?.delivered && BOARD_DM_TYPES.has(args.type)) {
      notifyBoardUpdateDM({
        userId: args.userId,
        type: args.type,
        title: args.title,
        description: args.message,
      }).catch(() => {});
    }

    return result;
  };
}
