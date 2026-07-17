/**
 * #2571 — Aggregeret no-recipient-rate-guard for cron-drevne Discord-DM-strømme.
 *
 * Opfølgning på #2569 (bestyrelses-DM'er tavst droppet i 14 dage — se
 * .claude/learnings/2026-07-17-silent-param-drop-board-dm.md). Enkelt-DM
 * no-recipient-skip er normalt (#449: bruger har opt-out eller mangler
 * discord_id) og forbliver console.info i discordNotifier.js. Men hvis EN HEL
 * cron-kørsel skipper ALLE forsøgte DM'er af en given type, er det ikke
 * længere "én bruger" — det er tegn på et data-/config-nedbrud, og den rate
 * kan en enkelt-besked-log aldrig vise (#2569 levede 14 dage netop fordi
 * ingen læste loggen).
 *
 * Tæller forsøgte + skippede DM'er PR. CRON-KØRSEL (ikke pr. besked, ikke pr.
 * enkelt-DM) og capturer til Sentry hvis raten er 100% over N kørsler i træk
 * (ALL_SKIPPED_STREAK_THRESHOLD) OG antal forsøgte > 0 i de kørsler. En
 * kørsel med 0 forsøgte DM'er (fx en deploy-storm hvor ingen board-reminders
 * var due) er NEUTRAL — den hverken forlænger eller nulstiller streak'en,
 * så guarden aldrig fyrer på tomme kørsler (samme støj-fælde som #2440).
 *
 * Scope (issue #2571): kun de rent cron-drevne DM-strømme (board, auktion)
 * er wired ind i cron.js's flushDmRunGuard-kald. recordDmAttempt no-op'er
 * medmindre kalderen eksplicit markerer cronRun:true — request-scopede kald
 * (outbid ved bud-placering, transfer-offer, watchlist-notifikation ved
 * auktions-oprettelse — alle trigget direkte af en bruger-handling i
 * routes/api.js) sætter aldrig cronRun, så de påvirker aldrig guarden.
 *
 * INGEN ændring af selve leverings-logikken — modulet tæller og capturer,
 * intet mere.
 */

import { captureException as sentryCaptureDefault } from "./sentry.js";

const ALL_SKIPPED_STREAK_THRESHOLD = 3;

// type -> { attempted, skipped } — akkumuleret siden sidste flush for den type.
const runBuckets = new Map();
// type -> antal på hinanden følgende ikke-tomme kørsler med 100% skip.
const streaks = new Map();
// type -> har vi allerede capturet for den IGANGVÆRENDE streak? (undgår Sentry-spam
// hver eneste kørsel af en vedvarende, allerede-kendte hændelse).
const alreadyCaptured = new Set();

function getBucket(type) {
  let bucket = runBuckets.get(type);
  if (!bucket) {
    bucket = { attempted: 0, skipped: 0 };
    runBuckets.set(type, bucket);
  }
  return bucket;
}

/**
 * Registrér udfaldet af ét notifyDiscordDM-kald. No-op medmindre cronRun er
 * eksplicit sat af kalderen (kun cron.js sætter den) — se scope-note ovenfor.
 */
export function recordDmAttempt({ type, skipped = false, cronRun = false } = {}) {
  if (!cronRun || !type) return;
  const bucket = getBucket(type);
  bucket.attempted += 1;
  if (skipped) bucket.skipped += 1;
}

/**
 * Kaldes fra cron.js ved starten af hver relevant cron-tick, for de DM-typer
 * den tick'en kan producere. Evaluerer den akkumulerede bucket SIDEN SIDSTE
 * flush (dvs. reelt forrige kørsels resultat — kald ved tick-start giver
 * fire-and-forget DM-kald fra forrige tick tid nok til at lande, uden at
 * ændre selve leverings-logikken), opdaterer streak, og capturer til Sentry
 * ved 100%-skip over N kørsler i træk.
 */
export function flushDmRunGuard(types, { captureExceptionFn = sentryCaptureDefault } = {}) {
  for (const type of types) {
    const bucket = runBuckets.get(type);
    runBuckets.set(type, { attempted: 0, skipped: 0 });

    if (!bucket || bucket.attempted === 0) {
      // #2440-undgåelse: 0 forsøgte DM'er i denne kørsel er neutralt — rør
      // ikke streak'en.
      continue;
    }

    const allSkipped = bucket.skipped === bucket.attempted;
    if (!allSkipped) {
      streaks.set(type, 0);
      alreadyCaptured.delete(type);
      continue;
    }

    const streak = (streaks.get(type) || 0) + 1;
    streaks.set(type, streak);

    if (streak >= ALL_SKIPPED_STREAK_THRESHOLD && !alreadyCaptured.has(type)) {
      alreadyCaptured.add(type);
      captureExceptionFn(
        new Error(
          `Discord DM: alle ${bucket.attempted} forsøgte "${type}"-DM'er blev skippet (no-recipient) i ${streak} kørsler i træk`
        ),
        {
          fingerprint: ["discord-dm-all-skipped", type],
          tags: { component: "discord-dm", dmType: type },
          extra: { attempted: bucket.attempted, skipped: bucket.skipped, streak },
        }
      );
    }
  }
}

/** Test-only: nulstil alt modul-state mellem tests. */
export function __resetDmRunGuardForTests() {
  runBuckets.clear();
  streaks.clear();
  alreadyCaptured.clear();
}
