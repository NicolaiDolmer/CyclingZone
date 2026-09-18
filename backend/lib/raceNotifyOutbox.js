/**
 * Udgaaende koe for eksterne loebs-notifikationer (#3624).
 * ========================================================
 * Maaling: docs/audits/2026-09-18-3624-loebsforsinkelser.md §3+§5.
 * Efter #5182/#5204 er notify-fasen det stoerste enkeltbidrag til koetiden i
 * stage-scheduleren: "board faerdig → resultat-notifikation ude" maalte 62 s
 * (endagsloeb) / 25 s (etapeloeb), og hele koen af forfaldne etaper stod stille
 * imens, fordi afviklingen awaiter et eksternt Discord-kald pr. webhook-URL.
 *
 * Dette modul flytter SELVE AFSENDELSEN ud af den stien. Afviklingen afleverer
 * beskeden i race_notify_outbox (én lokal insert) og gaar videre; et
 * selvstaendigt cron-tick henter og sender.
 *
 * ── HVORFOR IKKE discord_webhook_outbox (#3545) ─────────────────────────────
 * Den tabel er en RETRY-koe: en post lander der KUN naar den allerede har fejlet
 * i den synkrone sti. Den har derfor hverken en dublet-noegle (en fejlet post er
 * pr. definition ikke leveret) eller en lease (en raekke slettes ved succes).
 * Her afleverer vi FOER foerste forsoeg, og foerste forsoeg sker i et tick der
 * kan koere samtidig med sig selv efter en genstart — saa baade noeglen og
 * leasen er noedvendige. De to koer lever side om side og roerer ikke hinanden:
 * drainen her leverer via attemptWebhookDelivery (ikke sendWebhook), saa en
 * fejl her kan ikke ogsaa lande i #3545's koe og blive sendt to gange.
 *
 * ── KONTRAKTEN (rapportens §5, bindende) ────────────────────────────────────
 * 1) RAEKKEFOELGE. `enqueueRaceNotify` kaldes inde i #4147's notify-trin, som
 *    foerst markerer trinnet udfoert i sit `finally`. Raekken er altsaa
 *    committet FOER races.finalize_state siger "notify kørt" — et nedbrud
 *    imellem efterlader en umarkeret raekke, ikke en tabt besked.
 * 2) UNIK NOEGLE (race_id, message_type, channel_key). En genkoersel af
 *    afslutningen rammer ON CONFLICT DO NOTHING. En dubleret resultat-besked er
 *    synlig for spillerne; det er den fejl vi ikke maa bytte forsinkelsen for.
 * 3) STATUS + LEASE. pending → sending → sent/failed. Claim'en er en BETINGET
 *    UPDATE (`.eq("status", <den vi laeste>)`), saa to tick ikke kan tage samme
 *    raekke: Postgres genevaluerer WHERE efter raekke-laasen, og den anden
 *    opdatering rammer 0 raekker. En raekke der haenger i `sending` (processen
 *    doede midt i et HTTP-kald) kan tages igen naar `lease_expires_at` er
 *    passeret.
 * 4) RETRY. Begraenset antal forsoeg med backoff, derefter `failed` + Sentry.
 *
 * ── HORISONTEN ER KORTERE END #3545's ───────────────────────────────────────
 * discord_webhook_outbox proever i ~27 timer, fordi en auktions-annoncering
 * stadig har vaerdi naeste morgen. Et LOEBSRESULTAT har det ikke: resultatet
 * staar allerede paa siden, og en kanal-post der lander seks timer senere er
 * stoej, ikke service. Skemaet herunder giver ~1 t 50 min over 6 forsoeg — nok
 * til at ride et typisk Discord-5xx-udfald af, kort nok til at en besked enten
 * kommer mens den er relevant eller bliver et synligt Sentry-fund.
 */

import { createHash } from "node:crypto";

import { normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";

export const RACE_NOTIFY_OUTBOX_TABLE = "race_notify_outbox";

/** Eneste beskedtype i dag: hele loebets resultat-embed til divisionens kanaler. */
export const RACE_RESULT_MESSAGE_TYPE = "race_result";

// Backoff pr. attempt-nummer (1-indekseret = "efter foerste fejlede forsoeg").
// Sidste vaerdi genbruges. Samlet horisont ≈ 1 t 50 min, se modul-headeren.
const RETRY_SCHEDULE_MS = [
  60 * 1000, // efter 1. fejl: +1 min
  5 * 60 * 1000, // +5 min
  15 * 60 * 1000, // +15 min
  30 * 60 * 1000, // +30 min
  60 * 60 * 1000, // +1 t
];

export const MAX_NOTIFY_ATTEMPTS = RETRY_SCHEDULE_MS.length + 1;

/**
 * Lease-vindue. Skal vaere komfortabelt laengere end et enkelt leverings-forsoeg
 * (attemptWebhookDelivery har et inline-loft paa 15 s), men kort nok til at en
 * raekke efterladt af en doed proces er i luften igen inden for ét resultat-
 * vindue. 5 min = ét scheduler-tick.
 */
export const LEASE_MS = 5 * 60 * 1000;

const DRAIN_BATCH_SIZE = 25;

/**
 * Hvor laenge leverede raekker bliver liggende. De er dublet-vaernet (punkt 2),
 * saa de kan ikke slettes med det samme — men en genkoersel af en afslutning
 * sker inden for minutter/timer, aldrig uger. 30 dage er rigeligt til at daekke
 * ethvert realistisk recovery-vindue og holder tabellen bundet.
 */
export const SENT_RETENTION_DAYS = 30;

export function nextAttemptDelayMs(attempts) {
  const index = Math.min(Math.max(attempts - 1, 0), RETRY_SCHEDULE_MS.length - 1);
  return RETRY_SCHEDULE_MS[index];
}

/**
 * Kanal-leddet i dublet-noeglen: SHA-256 (hex) af webhook-URL'en.
 *
 * URL'en baerer Discords webhook-token. Den skal ikke staa i et unikt indeks
 * eller i teksten paa en constraint-fejl, og den kan aendre sig for SAMME kanal
 * hvis webhooken gendannes — men i det tilfaelde er en gensendelse ogsaa den
 * rigtige adfaerd, saa hash'en er den praecise noegle vi vil have.
 */
export function channelKeyForWebhookUrl(webhookUrl) {
  return createHash("sha256").update(String(webhookUrl ?? "")).digest("hex");
}

/**
 * Er fejlen "tabellen findes ikke endnu" (Postgres 42P01 / PostgREST PGRST205)?
 *
 * Vinduet mellem merge og applied migration er reelt. Enqueue-stien falder i det
 * vindue tilbage til synkron afsendelse (se deliverRaceResultNotify), og drainen
 * tier stille i stedet for at fylde Sentry med ét event pr. tick.
 */
export function isMissingTableError(error) {
  if (!error) return false;
  const code = String(error.code || "");
  if (code === "42P01" || code === "PGRST205") return true;
  return new RegExp(
    `relation .*${RACE_NOTIFY_OUTBOX_TABLE}.* does not exist|could not find the table`,
    "i",
  ).test(String(error.message || ""));
}

/**
 * Laeg én besked i koen. Best-effort paa samme maade som resten af notify-stien:
 * kaster ALDRIG ind i kalderen (afviklingen maa ikke kunne vaelte af en kø-fejl),
 * men rapporterer praecist nok til at kalderen kan falde tilbage til synkron
 * afsendelse i stedet for at tabe beskeden.
 *
 * @returns {Promise<{enqueued: boolean, duplicate: boolean, missingTable: boolean}>}
 *   `duplicate: true` = raekken fandtes allerede (genkoersel af afslutningen).
 *   Det er en SUCCES for kalderen: beskeden er i koen, den skal ikke sendes igen.
 */
export async function enqueueRaceNotify({
  supabase,
  raceId,
  messageType = RACE_RESULT_MESSAGE_TYPE,
  webhookUrl,
  payload,
  captureExceptionFn,
  now = new Date(),
}) {
  if (!supabase?.from) return { enqueued: false, duplicate: false, missingTable: false };

  const { data, error } = await supabase
    .from(RACE_NOTIFY_OUTBOX_TABLE)
    .upsert(
      {
        race_id: raceId,
        message_type: messageType,
        channel_key: channelKeyForWebhookUrl(webhookUrl),
        webhook_url: webhookUrl,
        payload,
        status: "pending",
        attempts: 0,
        next_attempt_at: now.toISOString(),
      },
      // ON CONFLICT DO NOTHING paa dublet-noeglen (punkt 2). Vi opdaterer
      // bevidst IKKE den eksisterende raekke: er beskeden allerede sendt, maa en
      // genkoersel ikke kunne saette den tilbage til pending og sende igen.
      { onConflict: "race_id,message_type,channel_key", ignoreDuplicates: true },
    )
    .select("id");

  if (error) {
    const reason = normalizeSupabaseErrorMessage(error.message);
    if (isMissingTableError(error)) {
      console.warn("[race-notify:outbox] tabellen findes ikke endnu — migration mangler", { error: reason });
      return { enqueued: false, duplicate: false, missingTable: true };
    }
    console.error("[race-notify:outbox] enqueue fejlede", { raceId, error: reason });
    captureExceptionFn?.(new Error(`Race notify-outbox enqueue fejlede: ${reason}`), {
      tags: { component: "race-notify-outbox" },
      extra: { raceId, messageType },
    });
    return { enqueued: false, duplicate: false, missingTable: false };
  }

  // Tom data = ON CONFLICT DO NOTHING slog til: raekken laa der i forvejen.
  const duplicate = Array.isArray(data) && data.length === 0;
  return { enqueued: true, duplicate, missingTable: false };
}

/**
 * Afleveringen fra afviklingens notify-trin — ÉT sted, saa "flag OFF er
 * bit-identisk med i dag" er en testbar paastand og ikke en if-saetning spredt
 * ud i cron.js.
 *
 * Flag OFF  → praecis det gamle loop: `for (const url of urls) await sendFn(url, payload)`.
 * Flag ON   → én enqueue pr. URL; afviklingen roerer ikke Discord.
 * Enqueue-fejl (defekt koe, manglende migration) → den URL sendes SYNKRONT
 *   alligevel. Flag ON maa aldrig vaere daarligere end flag OFF: hellere en
 *   langsom besked end ingen besked.
 *
 * @returns {Promise<{queued: number, duplicates: number, sentInline: number}>}
 */
export async function deliverRaceResultNotify({
  urls = [],
  payload,
  raceId,
  messageType = RACE_RESULT_MESSAGE_TYPE,
  queueEnabled = false,
  enqueueFn,
  sendFn,
}) {
  let queued = 0;
  let duplicates = 0;
  let sentInline = 0;

  for (const url of urls) {
    if (queueEnabled && enqueueFn) {
      const result = await enqueueFn({ raceId, messageType, webhookUrl: url, payload });
      if (result?.enqueued) {
        queued++;
        if (result.duplicate) duplicates++;
        continue;
      }
      // Faldt igennem: koen tog ikke imod. Send som foer flaget.
    }
    await sendFn(url, payload);
    sentInline++;
  }

  return { queued, duplicates, sentInline };
}

/**
 * Afsender-tikket: tag alle forfaldne raekker, lever dem, og opdatér status.
 *
 * @param {object} deps
 * @param {Function} deps.deliverFn  async ({ webhookUrl, payload }) => resultat fra
 *   attemptWebhookDelivery ({ ok, status, failure, error }). MAA IKKE vaere
 *   sendWebhook: den ville laegge fejlen i discord_webhook_outbox (#3545) OGSAA,
 *   og saa ville to koer proeve at levere samme besked.
 * @param {Function} [deps.sendWebhookFn] bruges KUN til failed-alarmen; skal vaere
 *   en variant der ikke selv enqueuer.
 * @returns {Promise<{processed: number, sent: number, rescheduled: number, failed: number, skipped: number, purged: number}>}
 */
export async function processRaceNotifyOutboxDrain({
  supabase,
  deliverFn,
  sendWebhookFn,
  getAlarmWebhookFn,
  captureExceptionFn,
  now = new Date(),
  maxAttempts = MAX_NOTIFY_ATTEMPTS,
  leaseMs = LEASE_MS,
  batchSize = DRAIN_BATCH_SIZE,
  retentionDays = SENT_RETENTION_DAYS,
}) {
  const empty = { processed: 0, sent: 0, rescheduled: 0, failed: 0, skipped: 0, purged: 0 };
  const nowIso = now.toISOString();

  const { data: rows, error } = await supabase
    .from(RACE_NOTIFY_OUTBOX_TABLE)
    .select("id, race_id, message_type, webhook_url, payload, attempts, status, lease_expires_at")
    .in("status", ["pending", "sending"])
    .lte("next_attempt_at", nowIso)
    .order("next_attempt_at", { ascending: true })
    .limit(batchSize);

  if (error) {
    // #2023: normalisér en evt. Cloudflare/HTML-fejlside ned til én linje.
    const reason = normalizeSupabaseErrorMessage(error.message);
    if (isMissingTableError(error)) {
      console.warn("[race-notify:outbox] tabellen findes ikke endnu — migration mangler", { error: reason });
      return empty;
    }
    console.error("[race-notify:outbox] drain-select fejlede", { error: reason });
    captureExceptionFn?.(new Error(`Race notify-outbox drain-select fejlede: ${reason}`), {
      tags: { component: "race-notify-outbox" },
    });
    return empty;
  }

  let sent = 0;
  let rescheduled = 0;
  let skipped = 0;
  const failedRows = [];

  for (const row of rows ?? []) {
    // En raekke i `sending` hoerer stadig til det tick der tog den, indtil leasen
    // er passeret. Filtreret her frem for i select'en, saa claim-queryen bliver
    // ved med at vaere ét simpelt indeks-opslag.
    if (row.status === "sending" && row.lease_expires_at && row.lease_expires_at > nowIso) {
      skipped++;
      continue;
    }

    const attempts = (row.attempts ?? 0) + 1;

    // ── Claim (punkt 3) ──────────────────────────────────────────────────────
    // Betinget UPDATE: `.eq("status", row.status)` (plus lease-guarden for en
    // genoptaget raekke) er hele mutexen. Tager et andet tick raekken foerst,
    // rammer denne 0 raekker, og vi gaar videre uden at sende.
    let claim = supabase
      .from(RACE_NOTIFY_OUTBOX_TABLE)
      .update({
        status: "sending",
        attempts,
        leased_at: nowIso,
        lease_expires_at: new Date(now.getTime() + leaseMs).toISOString(),
      })
      .eq("id", row.id)
      .eq("status", row.status);
    if (row.status === "sending") claim = claim.lte("lease_expires_at", nowIso);

    const { data: claimed, error: claimError } = await claim.select("id");
    if (claimError) {
      const reason = normalizeSupabaseErrorMessage(claimError.message);
      console.error("[race-notify:outbox] claim fejlede", { id: row.id, error: reason });
      captureExceptionFn?.(new Error(`Race notify-outbox claim fejlede (id=${row.id}): ${reason}`), {
        tags: { component: "race-notify-outbox" },
        extra: { rowId: row.id },
      });
      skipped++;
      continue;
    }
    if (!claimed?.length) {
      // Et andet tick var hurtigere. Praecis det leasen skal forhindre.
      skipped++;
      continue;
    }

    const result = await deliverFn({ webhookUrl: row.webhook_url, payload: row.payload });

    if (result.ok) {
      const { error: sentError } = await supabase
        .from(RACE_NOTIFY_OUTBOX_TABLE)
        .update({
          status: "sent",
          sent_at: nowIso,
          last_status: result.status ?? null,
          last_error: null,
          lease_expires_at: null,
        })
        .eq("id", row.id);
      if (sentError) {
        // Beskeden ER leveret; det kan vi ikke fortryde. Fejler denne skrivning,
        // staar raekken i `sending` med en lease der udloeber om 5 min — og saa
        // bliver den sendt IGEN. Vi kan ikke forhindre det herfra, kun goere det
        // synligt, praecis som #3545's delete-efter-levering.
        const reason = normalizeSupabaseErrorMessage(sentError.message);
        console.error(
          "[race-notify:outbox] sent-markering fejlede efter succesfuld levering — risiko for dobbelt-levering",
          { id: row.id, error: reason },
        );
        captureExceptionFn?.(
          new Error(`Race notify-outbox sent-markering fejlede efter levering (id=${row.id}): ${reason}`),
          { tags: { component: "race-notify-outbox" }, extra: { rowId: row.id } },
        );
      }
      sent++;
      continue;
    }

    const isPermanent = result.failure?.kind === "permanent";
    const exhausted = attempts >= maxAttempts;

    if (isPermanent || exhausted) {
      const { error: failedError } = await supabase
        .from(RACE_NOTIFY_OUTBOX_TABLE)
        .update({
          status: "failed",
          failed_at: nowIso,
          last_status: result.status ?? null,
          last_error: String(result.error ?? "").slice(0, 500),
          lease_expires_at: null,
        })
        .eq("id", row.id);
      if (failedError) {
        // Raekken bliver staaende i `sending` og bliver taget igen efter leasen.
        // Den taelles STADIG som failed i alarmen nedenfor: beskeden er reelt
        // opgivet for spilleren uanset om vi naaede at skrive det.
        const reason = normalizeSupabaseErrorMessage(failedError.message);
        console.error("[race-notify:outbox] failed-markering fejlede", { id: row.id, error: reason });
        captureExceptionFn?.(
          new Error(`Race notify-outbox failed-markering fejlede (id=${row.id}): ${reason}`),
          { tags: { component: "race-notify-outbox" }, extra: { rowId: row.id } },
        );
      }
      failedRows.push({ id: row.id, raceId: row.race_id, status: result.status, reason: result.failure?.reason });
      continue;
    }

    const { error: retryError } = await supabase
      .from(RACE_NOTIFY_OUTBOX_TABLE)
      .update({
        status: "pending",
        next_attempt_at: new Date(now.getTime() + nextAttemptDelayMs(attempts)).toISOString(),
        last_status: result.status ?? null,
        last_error: String(result.error ?? "").slice(0, 500),
        lease_expires_at: null,
      })
      .eq("id", row.id);
    if (retryError) {
      // Backoff'en blev aldrig skrevet — raekken staar i `sending` og tages igen
      // naar leasen udloeber (5 min). Taelles derfor IKKE som rescheduled.
      const reason = normalizeSupabaseErrorMessage(retryError.message);
      console.error("[race-notify:outbox] reschedule fejlede", { id: row.id, error: reason });
      captureExceptionFn?.(
        new Error(`Race notify-outbox reschedule fejlede (id=${row.id}): ${reason}`),
        { tags: { component: "race-notify-outbox" }, extra: { rowId: row.id } },
      );
    } else {
      rescheduled++;
    }
  }

  // ÉN aggregeret alarm pr. drain-run (ikke pr. raekke). Foerst HER er beskeden
  // reelt opgivet — og det er samtidig det eneste sted #3624 kan tabe en besked,
  // saa signalet skal vaere hoejt.
  if (failedRows.length > 0) {
    const summary = failedRows
      .map((r) => `id=${r.id} (race=${r.raceId}, status=${r.status ?? "n/a"}, ${r.reason ?? "ukendt"})`)
      .join(", ");
    const url = getAlarmWebhookFn ? await getAlarmWebhookFn() : null;
    if (url && sendWebhookFn) {
      await sendWebhookFn(url, {
        embeds: [
          {
            title: "🚨 Loebs-notifikationer kunne ikke leveres",
            description:
              `${failedRows.length} resultat-besked(er) opgivet efter gentagne forsoeg (notify-outbox → failed).\n` +
              `Typisk aarsag: langvarigt Discord-udfald eller et slettet/fejlkonfigureret webhook.\n${summary}`,
            color: 0xe74c3c,
            timestamp: nowIso,
          },
        ],
      });
    }
    captureExceptionFn?.(
      new Error(`Race notify-outbox: ${failedRows.length} besked(er) opgivet — ${summary}`),
      { tags: { component: "race-notify-outbox" }, extra: { failedRows } },
    );
  }

  const purged = await purgeSentRows({ supabase, now, retentionDays, captureExceptionFn });

  return { processed: rows?.length ?? 0, sent, rescheduled, failed: failedRows.length, skipped, purged };
}

/**
 * Ryd leverede raekker aeldre end retentionen. Se SENT_RETENTION_DAYS for hvorfor
 * de ikke bare slettes ved levering. Best-effort: en oprydnings-fejl maa ikke
 * kunne faa drainen til at se ud som om leveringen fejlede.
 */
async function purgeSentRows({ supabase, now, retentionDays, captureExceptionFn }) {
  if (!Number.isFinite(retentionDays) || retentionDays <= 0) return 0;
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000).toISOString();
  const { data, error } = await supabase
    .from(RACE_NOTIFY_OUTBOX_TABLE)
    .delete()
    .eq("status", "sent")
    .lt("sent_at", cutoff)
    .select("id");
  if (error) {
    const reason = normalizeSupabaseErrorMessage(error.message);
    console.warn("[race-notify:outbox] oprydning af leverede raekker fejlede", { error: reason });
    captureExceptionFn?.(new Error(`Race notify-outbox oprydning fejlede: ${reason}`), {
      tags: { component: "race-notify-outbox" },
    });
    return 0;
  }
  return data?.length ?? 0;
}
