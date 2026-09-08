/**
 * Ops-alarmer for mail-loopet -- SAMLET pr. sweep-koersel (#2853).
 * ================================================================
 * Hvorfor et eget modul: en permanent sendefejl er allerede i Sentry, men
 * Sentry er ikke et sted ejeren KIGGER -- ops-kanalen er. Og en alarm pr. mail
 * ville vaere praecis den fejl #2853's dry_run-session fandt paa Sentry-siden:
 * tre identiske alarmer paa 15 minutter fordi kaldet laa inde i loopet over
 * hold. Kontrakten her er derfor: én besked pr. SWEEP-KOERSEL, uanset om den
 * daekker 1 eller 40 fejlede mails.
 *
 * Formen er laant fra emailRetrySweep.js's eksisterende dead-alarm (som
 * allerede aggregerer korrekt) og fra cronHeartbeat.js's embed-opbygning.
 *
 * Fail-safe hele vejen: mangler webhook-URL'en eller send-funktionen, sker der
 * ingenting (ingen kast, ingen log-spam). En alarm-kanal der ikke er
 * provisioneret maa aldrig kunne vaelte selve sweepen.
 */

import { withOpsMention } from "./opsWebhook.js";

/** Hvor mange enkeltlinjer et embed viser foer det opsummerer resten. */
const MAX_EMBED_LINES = 8;

/**
 * Opsamler til permanente sendefejl inden for ÉN sweep-koersel. Sendes med
 * ind i sendLoopEmail, som skubber sine permanente fejl herind i stedet for
 * at alarmere selv.
 */
export function createEmailFailureCollector() {
  return { permanent: [] };
}

/** REN: klip en linjeliste ned og tilfoej en "og N mere"-hale. */
export function summarizeLines(lines, max = MAX_EMBED_LINES) {
  if (lines.length <= max) return lines.join("\n");
  return [...lines.slice(0, max), `... og ${lines.length - max} mere`].join("\n");
}

/**
 * REN: embed for permanente sendefejl i én sweep-koersel.
 *
 * Bevidst KUN dedupe_key + den klassificerede aarsag. Resends raa fejlbesked
 * citerer typisk modtager-adressen, og ops-kanalen har et bredere publikum end
 * Sentry — den fulde besked bor i Sentry og i email_log.error, ikke her.
 * dedupe_key baerer et bruger-UUID, ikke en mailadresse.
 */
export function buildPermanentFailureEmbed({ sweep, failures, now = new Date() }) {
  const lines = failures.map((f) => `\`${f.dedupeKey}\` -- ${f.reason ?? "ukendt"}`);
  return {
    embeds: [
      {
        title: `Mail-loop: ${failures.length} permanent fejlet afsendelse(r)`,
        description:
          `Sweep: \`${sweep}\`. Permanente fejl (ugyldig adresse, ugyldig noegle, validering) ` +
          "bliver ALDRIG proevet igen -- de mails er tabt indtil aarsagen er rettet.",
        color: 0xe74c3c,
        fields: [{ name: "Fejlede", value: summarizeLines(lines) || "(ingen)" }],
        timestamp: now.toISOString(),
      },
    ],
  };
}

/** REN: embed for retries som drainen har opgivet. */
export function buildRetryDeadEmbed({ deadRows, now = new Date() }) {
  const lines = deadRows.map(
    (r) => `\`${r.dedupeKey}\` -- ${r.reason ?? "ukendt"} efter ${r.attempts ?? "?"} forsoeg`
  );
  return {
    embeds: [
      {
        title: `Mail-loop: ${deadRows.length} mail(s) opgivet`,
        description:
          "Retry-drainen har opbrugt sine forsoeg (eller ramt en permanent fejl). " +
          "Mailene naaede aldrig frem og bliver ikke proevet igen.",
        color: 0xe67e22,
        fields: [{ name: "Opgivet", value: summarizeLines(lines) || "(ingen)" }],
        timestamp: now.toISOString(),
      },
    ],
  };
}

/**
 * Send ét embed til ops-kanalen. No-op naar kanalen ikke er wired (ingen
 * sendWebhookFn / ingen URL) -- se filhovedet.
 *
 * `sendWebhookFn` SKAL vaere den BARE discordNotifier.sendWebhook, ikke
 * sendOpsWebhook: sidstnaevnte auto-prepender @mention paa ALT, og hele
 * pointen her er at kunne sende en rolig daglig rapport UDEN mention og kun
 * @mentione naar noget faktisk er galt. `mention` styrer det pr. kald.
 *
 * @param {{payload: object, mention?: boolean, sendWebhookFn?: Function, getOpsWebhookFn?: Function}} args
 * @returns {Promise<boolean>} true hvis der faktisk blev sendt noget.
 */
export async function postOpsEmbed({ payload, mention = true, sendWebhookFn, getOpsWebhookFn }) {
  if (!sendWebhookFn || !getOpsWebhookFn) return false;
  const url = await getOpsWebhookFn();
  if (!url) return false;
  await sendWebhookFn(url, mention ? withOpsMention(payload) : payload);
  return true;
}

/**
 * Kaldes ÉN gang til sidst i en sweep-koersel. Tom opsamler -> ingen besked.
 */
export async function postPermanentFailureAlert({
  collector,
  sweep,
  now = new Date(),
  sendWebhookFn,
  getOpsWebhookFn,
}) {
  const failures = collector?.permanent ?? [];
  if (!failures.length) return false;
  return postOpsEmbed({
    payload: buildPermanentFailureEmbed({ sweep, failures, now }),
    sendWebhookFn,
    getOpsWebhookFn,
  });
}
