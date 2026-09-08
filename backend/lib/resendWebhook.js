/**
 * Resend-webhook: leveringsstatus, bounces, klager og indgaaende svar (#2853).
 * ===========================================================================
 * ROD-AARSAG denne fil lukker: email_log kendte kun til afsendelsesoejeblikket
 * (sent/dry_run/failed). Alt hvad der skete DEREFTER -- leveret, hard bounce,
 * spam-klage, en spiller der svarede paa mailen -- var usynligt. En doed
 * adresse blev ved med at faa mails (og traekker afsender-omdoemmet ned for
 * ALLE modtagere), og et svar fra en spiller forsvandt i et sort hul.
 *
 * AUTH: der er ingen requireAuth paa ruten -- SIGNATUREN er auth'en. Resend
 * signerer med Svix' skema (headerne `svix-id`, `svix-timestamp`,
 * `svix-signature`), HMAC-SHA256 over `${id}.${timestamp}.${raa body}` keyet
 * med RESEND_WEBHOOK_SECRET. Verifikationen SKAL derfor ske paa de RAA bytes
 * foer JSON-parsing -- express.raw er wired paa netop denne path i
 * backend/server.js, foer den globale express.json (samme opsaetning som
 * /api/billing/alunta-webhook, se aluntaWebhook.js).
 *
 * REPLAY: en gyldig signatur alene er ikke nok. Et opsnappet, korrekt signeret
 * kald kan afspilles i det uendelige, saa `svix-timestamp` skal ligge inden
 * for SIGNATURE_TOLERANCE_MS af nu (begge retninger -- et ur der er gaaet
 * FORUD er lige saa mistaenkeligt som et der halter).
 *
 * IDEMPOTENS: Resend gen-leverer selv ved en fejlet levering. `svix-id` er
 * unik pr. levering og gemmes i email_events.provider_event_id (UNIQUE).
 * Raekken indsaettes FOER nogen sideeffekt koeres, saa en gen-levering rammer
 * conflict og bliver et rent no-op -- ikke en dobbelt-undertrykkelse eller en
 * dobbelt videresendelse. Samme greb som email_log.dedupe_key mod Resends
 * Idempotency-Key paa udgaaende side.
 *
 * UNDERTRYKKELSE: en HAARD bounce (bounce.type/subType i HARD_BOUNCE_MARKERS)
 * og enhver klage saetter users.email_prefs.all = false plus
 * suppressed_reason/suppressed_at. Det genbruger den EKSISTERENDE opt-out-
 * mekanisme (emailPrefs.js's master-noegle, den samme som et-kliks-unsubscribe
 * skriver) i stedet for en parallel suppression-tabel: én kilde til sandhed
 * for "maa vi maile denne bruger?". En BLOED bounce (Transient -- fuld
 * postkasse, midlertidig afvisning) logges kun; adressen fejler ikke
 * permanent, og at doede den ville koste os en aegte spiller.
 *
 * SVARSTATUS: efter en verificeret signatur svarer vi ALTID 200 -- ogsaa paa
 * et event vi ikke bruger. Et 4xx/5xx faar Resend til at gen-levere i timevis
 * for noget vi bevidst ignorerer. 400/401 er reserveret til det der faktisk
 * er galt: manglende/ugyldig signatur, for gammelt timestamp, ikke-parsbar
 * body.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { FROM_ADDRESS, getResendClient } from "./emailService.js";
import { withOpsMention } from "./opsWebhook.js";
import { captureException } from "./sentry.js";

export const EMAIL_EVENTS_TABLE = "email_events";

/** Svix tillader +/- 5 minutter. Samme vindue her -- se REPLAY i filhovedet. */
export const SIGNATURE_TOLERANCE_MS = 5 * 60 * 1000;

/** Hvor mange tegn af et indgaaende svar vi gemmer i email_events.payload. */
export const INBOUND_EXCERPT_CHARS = 200;

/**
 * Events vi HAANDTERER. Alt andet (email.opened, contact.*, domain.* ...)
 * kvitteres roligt med 200 uden sideeffekt -- se SVARSTATUS i filhovedet.
 */
export const HANDLED_EVENT_TYPES = Object.freeze([
  "email.sent",
  "email.delivered",
  "email.delivery_delayed",
  "email.bounced",
  "email.complained",
  "email.received",
]);

/**
 * email_log.status-vaerdien et event loefter en afsendt raekke til. Bevidst
 * IKKE en post for email.sent: raekken er allerede 'sent' fra afsendelsen, og
 * en tilbage-skrivning ville kunne overskrive en NYERE 'delivered' hvis Resend
 * leverer sent/delivered ude af raekkefoelge.
 */
const STATUS_BY_EVENT = Object.freeze({
  "email.delivered": "delivered",
  "email.bounced": "bounced",
  "email.complained": "complained",
});

/**
 * En status kan kun bevaege sig FREMAD i denne raekkefoelge. Uden det kan to
 * webhook-leveringer der ankommer ude af orden (delivered efter bounced)
 * skrive den forkerte endestation ind i email_log.
 */
const STATUS_RANK = Object.freeze({ dry_run: 0, failed: 0, sent: 1, delivered: 2, bounced: 3, complained: 4 });

/**
 * Haarde bounce-markoerer fra Resends payload (`data.bounce.type` og
 * `.subType`, se SDK'ets EmailBounce). "Permanent" er SES' egen type-vaerdi;
 * General/NoEmail/Suppressed er de subtyper der betyder "denne adresse
 * eksisterer ikke / vil aldrig modtage". Alt andet (Transient, MailboxFull,
 * ContentRejected ...) er bloedt.
 */
export const HARD_BOUNCE_MARKERS = Object.freeze(["permanent", "general", "noemail", "suppressed"]);

/**
 * REN: er dette en haard bounce?
 * @param {{type?: string, subType?: string}|null|undefined} bounce
 */
export function isHardBounce(bounce) {
  if (!bounce) return false;
  const markers = [bounce.type, bounce.subType, bounce.sub_type]
    .filter(Boolean)
    .map((v) => String(v).toLowerCase().replace(/[\s_-]/g, ""));
  return markers.some((m) => HARD_BOUNCE_MARKERS.includes(m));
}

/**
 * REN: maa `next` overskrive `current` i email_log.status?
 * Kun fremad i STATUS_RANK -- se kommentaren over STATUS_RANK.
 */
export function statusAdvances(current, next) {
  return (STATUS_RANK[next] ?? -1) > (STATUS_RANK[current] ?? -1);
}

/**
 * REN: verificér Svix-signaturen paa den RAA body.
 *
 * @param {object} args
 * @param {(name: string) => string|undefined} args.getHeader
 * @param {Buffer|string} args.rawBody
 * @param {string|undefined} args.secret RESEND_WEBHOOK_SECRET ("whsec_..." eller bar base64)
 * @param {Date} [args.now]
 * @param {number} [args.toleranceMs]
 * @returns {{ok: true, eventId: string} | {ok: false, status: 400|401, reason: string}}
 */
export function verifyResendSignature({ getHeader, rawBody, secret, now = new Date(), toleranceMs = SIGNATURE_TOLERANCE_MS }) {
  if (!secret) return { ok: false, status: 401, reason: "secret_not_configured" };

  const id = getHeader("svix-id");
  const timestamp = getHeader("svix-timestamp");
  const signature = getHeader("svix-signature");
  if (!id || !timestamp || !signature) return { ok: false, status: 401, reason: "missing_headers" };

  // Svix' timestamp er unix-SEKUNDER. Et uparsbart timestamp er lige saa
  // ubrugeligt som et for gammelt -- begge afvises.
  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs)) return { ok: false, status: 400, reason: "bad_timestamp" };
  if (Math.abs(now.getTime() - timestampMs) > toleranceMs) return { ok: false, status: 400, reason: "timestamp_out_of_tolerance" };

  const raw = Buffer.isBuffer(rawBody)
    ? rawBody
    : Buffer.from(typeof rawBody === "string" ? rawBody : JSON.stringify(rawBody ?? {}), "utf8");

  // whsec_-praefikset er kun etiket; selve noeglen er base64 bagefter.
  const keyMaterial = String(secret).startsWith("whsec_") ? String(secret).slice("whsec_".length) : String(secret);
  const key = Buffer.from(keyMaterial, "base64");
  if (!key.length) return { ok: false, status: 401, reason: "secret_not_configured" };

  const signedContent = Buffer.concat([Buffer.from(`${id}.${timestamp}.`, "utf8"), raw]);
  const expected = createHmac("sha256", key).update(signedContent).digest("base64");
  const expectedBuf = Buffer.from(expected, "utf8");

  // Headeren kan baere FLERE versionerede signaturer ("v1,<sig> v1,<sig>")
  // under en noegle-rotation -- én match er nok.
  const provided = String(signature)
    .split(" ")
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => (part.includes(",") ? part.slice(part.indexOf(",") + 1) : part));

  for (const candidate of provided) {
    const candidateBuf = Buffer.from(candidate, "utf8");
    if (candidateBuf.length !== expectedBuf.length) continue;
    if (timingSafeEqual(candidateBuf, expectedBuf)) return { ok: true, eventId: id };
  }
  return { ok: false, status: 401, reason: "signature_mismatch" };
}

/** Discord-embed for en spam-klage. Kort, ingen emoji-klynger. */
export function buildComplaintEmbed({ recipient, emailType, providerId, now = new Date() }) {
  return {
    embeds: [
      {
        title: "Mail-klage modtaget",
        description:
          "En modtager har markeret en Cycling Zone-mail som spam. Brugeren er nu undertrykt " +
          "(email_prefs.all = false). Klage-raten skal holdes under 0,1 % -- se runbookens driftsafsnit.",
        color: 0xe74c3c,
        fields: [
          { name: "Modtager", value: recipient || "(ukendt)", inline: true },
          { name: "Mailtype", value: emailType || "(ukendt)", inline: true },
          { name: "Resend-id", value: providerId || "(ukendt)", inline: false },
        ],
        timestamp: now.toISOString(),
      },
    ],
  };
}

/**
 * Undertryk en bruger: email_prefs merges med master-off + aarsag/tidspunkt.
 * Best-effort paa laesningen (en manglende raekke betyder bare "start fra {}"),
 * men en FEJLET skrivning rapporteres -- det er hele pointen med kaldet.
 */
async function suppressUser({ supabase, userId, reason, now, captureExceptionFn }) {
  const { data: userRow, error: readErr } = await supabase
    .from("users").select("email_prefs").eq("id", userId).maybeSingle();
  if (readErr) {
    captureExceptionFn(new Error(`resend-webhook prefs-laesning (${reason}): ${readErr.message}`), {
      tags: { flow: "email-loop", component: "resend-webhook" }, extra: { userId },
    });
    return false;
  }

  const merged = {
    ...(userRow?.email_prefs && typeof userRow.email_prefs === "object" ? userRow.email_prefs : {}),
    all: false,
    suppressed_reason: reason,
    suppressed_at: now.toISOString(),
  };

  const { error: updateErr } = await supabase.from("users").update({ email_prefs: merged }).eq("id", userId);
  if (updateErr) {
    captureExceptionFn(new Error(`resend-webhook undertrykkelse (${reason}): ${updateErr.message}`), {
      tags: { flow: "email-loop", component: "resend-webhook" }, extra: { userId },
    });
    return false;
  }
  return true;
}

/**
 * Find brugeren bag en mail: primaert via email_log.user_id (join paa
 * provider_id -- det er den raekke VI skrev ved afsendelsen), sekundaert via
 * users.email = modtageren. Fallbacken daekker mails sendt uden om
 * sendLoopEmail (fx en manuel testafsendelse fra Resend-dashboardet).
 */
async function findUserForEvent({ supabase, providerId, recipient, captureExceptionFn = captureException }) {
  if (providerId) {
    const { data: logRow, error: logErr } = await supabase
      .from("email_log").select("id, user_id, email_type, status").eq("provider_id", providerId).maybeSingle();
    // En laesefejl her betyder at vi ikke kan identificere brugeren bag mailen
    // — en haard bounce ville saa ikke undertrykke nogen. Det skal vaere
    // synligt, men maa ikke stoppe resten (recipient-fallbacken nedenfor kan
    // stadig lykkes).
    if (logErr) {
      captureExceptionFn(new Error(`resend-webhook email_log-opslag: ${logErr.message}`), {
        tags: { flow: "email-loop", component: "resend-webhook" }, extra: { providerId },
      });
    }
    if (logRow?.user_id) return { userId: logRow.user_id, logRow };
  }
  if (recipient) {
    const { data: userRow, error: userErr } = await supabase
      .from("users").select("id").eq("email", recipient).maybeSingle();
    if (userErr) {
      captureExceptionFn(new Error(`resend-webhook users-opslag paa modtager: ${userErr.message}`), {
        tags: { flow: "email-loop", component: "resend-webhook" },
      });
    }
    if (userRow?.id) return { userId: userRow.id, logRow: null };
  }
  return { userId: null, logRow: null };
}

/**
 * Videresend et indgaaende svar til EMAIL_REPLY_FORWARD_TO.
 * Fail-safe: er env-variablen usat, logges ÉN warn og funktionen springes over
 * (intet kaster) -- webhooken skal fortsat kvittere 200.
 *
 * @returns {Promise<{forwarded: boolean, skipped?: string, excerpt: string|null, subject: string|null}>}
 */
export async function forwardInboundReply({
  data,
  resendFactory = getResendClient,
  forwardTo = process.env.EMAIL_REPLY_FORWARD_TO,
  captureExceptionFn = captureException,
}) {
  if (!forwardTo) {
    console.warn("[resend-webhook] EMAIL_REPLY_FORWARD_TO usat - indgaaende svar videresendes ikke");
    return { forwarded: false, skipped: "no_forward_address", excerpt: null, subject: null };
  }

  const emailId = data?.email_id;
  if (!emailId) return { forwarded: false, skipped: "no_email_id", excerpt: null, subject: null };

  const resend = resendFactory();
  const { data: inbound, error: getErr } = await resend.emails.receiving.get(emailId);
  if (getErr || !inbound) {
    const message = getErr?.message ?? "tomt svar fra Resend";
    captureExceptionFn(new Error(`resend-webhook hent af indgaaende mail fejlede: ${message}`), {
      tags: { flow: "email-loop", component: "resend-webhook" }, extra: { emailId },
    });
    return { forwarded: false, skipped: "fetch_failed", excerpt: null, subject: null };
  }

  const subject = inbound.subject || "(intet emne)";
  const sender = Array.isArray(inbound.from) ? inbound.from[0] : inbound.from;
  const bodyText = inbound.text || "";
  const excerpt = (bodyText || inbound.html || "").slice(0, INBOUND_EXCERPT_CHARS) || null;

  const { error: sendErr } = await resend.emails.send({
    from: FROM_ADDRESS,
    to: [forwardTo],
    subject: `Fwd: ${subject}`,
    ...(inbound.html ? { html: inbound.html } : {}),
    text: bodyText || "(ingen tekstdel i det indgaaende svar)",
    ...(sender ? { reply_to: [sender] } : {}),
  });
  if (sendErr) {
    captureExceptionFn(new Error(`resend-webhook videresendelse fejlede: ${sendErr.message ?? String(sendErr)}`), {
      tags: { flow: "email-loop", component: "resend-webhook" }, extra: { emailId },
    });
    return { forwarded: false, skipped: "send_failed", excerpt, subject };
  }

  return { forwarded: true, excerpt, subject };
}

/**
 * Express-handler for POST /api/email/resend-webhook.
 * Alle samarbejdspartnere er injicerbare (samme test-seam-moenster som
 * aluntaWebhook.js), saa hele stien kan unit-testes uden netvaerk.
 */
export async function handleResendWebhook({
  req,
  res,
  supabase,
  secret = process.env.RESEND_WEBHOOK_SECRET,
  now = new Date(),
  resendFactory = getResendClient,
  forwardTo = undefined, // undefined = laes env ved kaldstid i forwardInboundReply
  sendWebhookFn = null,
  getOpsWebhookFn = null,
  captureExceptionFn = captureException,
}) {
  const getHeader = (name) => (typeof req.get === "function" ? req.get(name) : req.headers?.[name]);

  const verified = verifyResendSignature({ getHeader, rawBody: req.body, secret, now });
  if (!verified.ok) {
    // Forventet-men-interessant afvisning: log AT det skete, aldrig body,
    // headers eller hemmelighed (samme regel som aluntaWebhook.js, #2817).
    console.warn(`[resend-webhook] afvist: ${verified.reason}`);
    return res.sendStatus(verified.status);
  }

  let payload;
  try {
    if (Buffer.isBuffer(req.body)) payload = JSON.parse(req.body.toString("utf8"));
    else if (typeof req.body === "string") payload = JSON.parse(req.body);
    else payload = req.body;
  } catch {
    // best-effort: selve parse-fejlen kastes bevidst vaek. Den eneste
    // information i den er den ikke-parsbare body, og den maa aldrig logges
    // (kan indeholde modtager-/kundedata) — samme regel som aluntaWebhook.js
    // (#2817). At det skete, staar i linjen nedenfor; 400 fortaeller Resend
    // at leveringen var ubrugelig.
    console.warn("[resend-webhook] afvist: body kunne ikke parses som JSON");
    return res.sendStatus(400);
  }

  const type = payload?.type ?? null;
  const data = payload?.data ?? {};
  const providerId = data.email_id ?? null;
  const recipient = Array.isArray(data.to) ? data.to[0] : (data.to ?? null);

  // Idempotens-gaten: raekken skrives FOER nogen sideeffekt. Rammer den
  // UNIQUE-conflict, har vi allerede behandlet praecis denne levering.
  const { error: eventErr } = await supabase.from(EMAIL_EVENTS_TABLE).insert({
    provider_event_id: verified.eventId,
    provider_id: providerId,
    type: type ?? "unknown",
    recipient,
    payload,
  });
  if (eventErr) {
    if (String(eventErr.code) === "23505") {
      console.log(`[resend-webhook] gen-levering ignoreret (svix-id allerede set): ${type ?? "unknown"}`);
      return res.sendStatus(200);
    }
    // Kan vi ikke skrive event-raekken, kan vi heller ikke garantere
    // idempotens for sideeffekterne -- saa vi koerer dem ikke. 200 alligevel:
    // en Resend-retry ville ramme den samme DB-fejl.
    captureExceptionFn(new Error(`resend-webhook email_events insert: ${eventErr.message}`), {
      tags: { flow: "email-loop", component: "resend-webhook" }, extra: { type },
    });
    return res.sendStatus(200);
  }

  if (!HANDLED_EVENT_TYPES.includes(type)) {
    // Ukendt/uinteressant event: logget i email_events, ingen sideeffekt.
    return res.sendStatus(200);
  }

  try {
    if (type === "email.received") {
      const result = await forwardInboundReply({
        data,
        resendFactory,
        ...(forwardTo === undefined ? {} : { forwardTo }),
        captureExceptionFn,
      });
      if (result.excerpt) {
        const { error: excerptErr } = await supabase
          .from(EMAIL_EVENTS_TABLE)
          .update({ payload: { ...payload, inbound_excerpt: result.excerpt, inbound_subject: result.subject, forwarded: result.forwarded } })
          .eq("provider_event_id", verified.eventId);
        if (excerptErr) console.error("[resend-webhook] uddrag-opdatering fejlede:", excerptErr.message);
      }
      return res.sendStatus(200);
    }

    const { userId, logRow } = await findUserForEvent({ supabase, providerId, recipient, captureExceptionFn });

    // Loeft email_log-raekkens status -- kun fremad (se STATUS_RANK).
    const nextStatus = STATUS_BY_EVENT[type];
    if (nextStatus && logRow?.id && statusAdvances(logRow.status, nextStatus)) {
      const { error: statusErr } = await supabase
        .from("email_log").update({ status: nextStatus }).eq("id", logRow.id);
      if (statusErr) {
        captureExceptionFn(new Error(`resend-webhook email_log status-opdatering (${nextStatus}): ${statusErr.message}`), {
          tags: { flow: "email-loop", component: "resend-webhook" }, extra: { logRowId: logRow.id },
        });
      }
    }

    if (type === "email.bounced") {
      const hard = isHardBounce(data.bounce);
      if (!hard) {
        console.warn(`[resend-webhook] bloed bounce logget (ingen undertrykkelse): ${data.bounce?.type ?? "?"}/${data.bounce?.subType ?? "?"}`);
        return res.sendStatus(200);
      }
      if (userId) await suppressUser({ supabase, userId, reason: "bounce", now, captureExceptionFn });
      else console.warn("[resend-webhook] haard bounce uden kendt bruger - kun logget");
      captureExceptionFn(new Error(`Haard bounce paa mail-loopet (${data.bounce?.type ?? "?"}/${data.bounce?.subType ?? "?"})`), {
        tags: { flow: "email-loop", component: "resend-webhook", reason: "hard-bounce" },
        extra: { providerId, emailType: logRow?.email_type ?? null },
      });
      return res.sendStatus(200);
    }

    if (type === "email.complained") {
      if (userId) await suppressUser({ supabase, userId, reason: "complaint", now, captureExceptionFn });
      else console.warn("[resend-webhook] klage uden kendt bruger - kun logget");

      captureExceptionFn(new Error("Spam-klage paa mail-loopet"), {
        tags: { flow: "email-loop", component: "resend-webhook", reason: "complaint" },
        extra: { providerId, emailType: logRow?.email_type ?? null },
      });

      // ÉN alarm pr. klage (ikke pr. sweep): en klage er sjaelden og alvorlig
      // nok til at fortjene sin egen @mention i ops-kanalen.
      const url = getOpsWebhookFn ? await getOpsWebhookFn() : null;
      if (url && sendWebhookFn) {
        await sendWebhookFn(
          url,
          withOpsMention(buildComplaintEmbed({ recipient, emailType: logRow?.email_type ?? null, providerId, now }))
        );
      }
      return res.sendStatus(200);
    }

    // email.sent / email.delivered / email.delivery_delayed: status-loeftet
    // ovenfor er hele arbejdet.
    return res.sendStatus(200);
  } catch (err) {
    // Signaturen var gyldig og eventet er allerede logget -- en fejl i
    // sideeffekterne maa ikke faa Resend til at gen-levere i timevis.
    captureExceptionFn(err, { tags: { flow: "email-loop", component: "resend-webhook" }, extra: { type } });
    console.error("[resend-webhook] sideeffekt fejlede:", err?.message || err);
    return res.sendStatus(200);
  }
}
