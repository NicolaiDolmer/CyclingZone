// Alunta webhook-handler. Svar 2xx < 3 sek. (Aluntas grænse); minimal DB-arbejde.
// Auth (bekræftet i Aluntas OpenAPI-spec 20/7, lukker spec §9-TODO'en): Alunta
// sender en `Signature`-header = HMAC-SHA256 over den RÅ JSON-body, keyet med
// webhook-secret'en fra dashboardet (ALUNTA_WEBHOOK_SECRET). Verifikation SKAL
// ske på rå bytes før parsing (express.raw er wired på pathen i server.js) og
// med constant-time-sammenligning.
//
// #2736 — event-katalog + fornyelse/udløb. Aluntas ÆGTE event-katalog har intet
// 'invoice.paid' (se .claude/learnings/2026-08-03-alunta-invoice-paid-missing-
// current-period-end.md) — det er fjernet herfra. Status-mappingen SPEJLER
// bevidst aluntaSubscriptionReconcile.js's mapAluntaStatus-aliaser (samme
// daglige sikkerhedsnet dækker begge, de må aldrig være uenige):
//
//   Event                         -> status      (reconcile-alias)
//   checkout.completed            -> active      (førstekøb — founder-eligible)
//   subscription.created          -> active      (førstekøb — founder-eligible)
//   subscription.started          -> active      (fornyelse/reaktivering)
//   subscription.resumed          -> active      (fornyelse efter pause)
//   subscription.cancelled        -> cancelled   (æret indtil current_period_end)
//   subscription.payment_failed   -> past_due    (grace — stadig Pro til periodeudløb)
//   subscription.ended            -> inactive    (matcher reconcilens INACTIVE_ALIASES)
//   subscription.tier_changed     -> (se nedenfor — rører ALDRIG status)
//   invoice.created, customer.*   -> ignoreret (200, ingen entitlement-relevans)
//
// tier_changed: ændrer kun plan (fx monthly -> semiannual), ikke abonnement-
// livscyklussen. Reconcilen har ingen særskilt tier_changed-håndtering (den
// synker plan_interval som en del af sin daglige fulde status-sync) — webhooken
// spejler det ved KUN at opdatere plan_interval, aldrig status/current_period_end/
// alunta-id'er/is_founder. Uden plan_interval i payloaden er der intet at gøre.
//
// Founder-semantik (#1903, skærpet her): et NYT founder-sæde kan KUN claimes af
// et førstekøbs-event (checkout.completed/subscription.created) — aldrig af et
// fornyelses-/udløbs-event. is_founder-nøglen udelades derfor helt af row for
// alle andre events (started/resumed/cancelled/payment_failed/ended/tier_changed),
// så upsert lader den eksisterende kolonneværdi stå uanset sæde-tælling.
//
// Feltbevarelse: plan_interval/alunta_customer_id/alunta_subscription_id/
// current_period_end falder tilbage til den EKSISTERENDE rækkeværdi når
// payloaden ikke bærer feltet (`data.X ?? existing?.X ?? null`), i stedet for
// blindt at nulle det ud — samme forsvarsmæssige mønster som
// aluntaSubscriptionReconcile.js's computeReconcileActions. Dette lukker en
// beslægtet variant af #2736-bugget: en fornyelses-payload der ikke gentager
// alle felter (fx payment_failed uden current_period_end) må ikke slette en
// allerede-sat værdi.
//
// IDEMPOTENS / REPLAY (#2736 scope-krav):
//  1) Eksakt duplikat: hvis det indkommende events id (data.uuid, eller
//     fallback `${event}:${payload.timestamp}` når Alunta ikke sender uuid —
//     set i prod, jf. postmortem) er IDENTISK med rækkens last_event_id,
//     er det en Alunta-retry af samme levering -> 200, ingen skrivning.
//  2) Out-of-order: hvis begge events har et tolkeligt payload.timestamp, og
//     det indkommende er STRENGT ældre end rækkens last_event_at, er det en
//     forsinket/omordnet levering af et event vi allerede har overhalet med
//     et nyere -> 200, ingen skrivning (undgår fx at en forsinket 'cancelled'
//     regressere en allerede anvendt nyere 'started').
//  Kendte grænser (bevidst accepteret, "simpel og deterministisk" jf. issuet):
//   - To FORSKELLIGE events med identisk (sekund-præcis) timestamp: den anden
//     bliver skippet som "ikke nyere" selvom den reelt er en ny hændelse. Uskadeligt
//     — den daglige reconcile (aluntaSubscriptionReconcile.js) retter status/
//     plan_interval inden for 24 timer under alle omstændigheder.
//   - Events uden noget timestamp, eller mod en række uden endnu et lagret
//     last_event_at (kolonnen findes måske ikke før migrationen er anvendt,
//     se database/2026-08-06-alunta-subscriptions-last-event-at.sql), fejler
//     ÅBENT (anvendes uden ordenskontrol) — bevidst valg: at BLOKERE en ægte
//     betalende kundes fornyelse pga. manglende ordens-info er værre end at
//     acceptere den (lave, dokumenterede) resterende risiko.

import { createHmac, timingSafeEqual } from "node:crypto";
import { FOUNDER_SEAT_CAP, getFounderSeats } from "./founderSeats.js";
import { captureException } from "./sentry.js";

export function verifyWebhookSignature(req, secret) {
  if (!secret) return false;
  const provided = req.get("Signature");
  if (!provided) return false;
  const raw = Buffer.isBuffer(req.body)
    ? req.body
    : Buffer.from(typeof req.body === "string" ? req.body : JSON.stringify(req.body ?? {}), "utf8");
  const expected = createHmac("sha256", secret).update(raw).digest("hex");
  const expectedBuf = Buffer.from(expected, "utf8");
  const providedBuf = Buffer.from(provided, "utf8");
  if (expectedBuf.length !== providedBuf.length) return false;
  return timingSafeEqual(expectedBuf, providedBuf);
}

// Status-mapping — se filhovedet for den fulde event-tabel + rationale.
const STATUS_BY_EVENT = {
  "checkout.completed": "active",
  "subscription.created": "active",
  "subscription.started": "active",
  "subscription.resumed": "active",
  "subscription.cancelled": "cancelled",
  "subscription.payment_failed": "past_due",
  "subscription.ended": "inactive",
};

// Kun førstekøbs-events må claime et NYT founder-sæde (se filhovedet).
const FOUNDER_ELIGIBLE_EVENTS = new Set(["checkout.completed", "subscription.created"]);

const TIER_CHANGE_EVENT = "subscription.tier_changed";

// PUR: Aluntas payload.timestamp -> Date, eller null hvis fraværende/ugyldig.
function parseEventTimestamp(raw) {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? null : d;
}

export async function handleAluntaWebhook({
  req,
  res,
  supabase,
  secret = process.env.ALUNTA_WEBHOOK_SECRET,
  // Testbarheds-seam, samme mønster som activeSeasonLookup.js/aluntaSubscriptionReconcile.js
  // m.fl.: defaulter til den ægte Sentry-capture, tests kan injicere en spy.
  captureExceptionFn = captureException,
}) {
  // #2817: forventet-men-interessant afvisning — console.warn, ikke captureException.
  // Logger ALDRIG payload/signatur/headers/secret, kun at det skete.
  if (!verifyWebhookSignature(req, secret)) {
    console.warn("[alunta-webhook] afvist: ugyldig eller manglende signatur");
    return res.sendStatus(401);
  }

  let payload;
  try {
    if (Buffer.isBuffer(req.body)) payload = JSON.parse(req.body.toString("utf8"));
    else if (typeof req.body === "string") payload = JSON.parse(req.body);
    else payload = req.body;
  } catch {
    // #2817: parse-fejl på en allerede signatur-verificeret body er usædvanligt —
    // log at det skete, men ALDRIG selve den ikke-parsbare body (kan indeholde kundedata).
    console.warn("[alunta-webhook] afvist: body kunne ikke parses som JSON");
    return res.sendStatus(400);
  }

  const { event, data } = payload || {};
  const teamId = data?.external_customer_id;
  if (!event || !teamId) {
    // #2817: kun event-type + team-id (UUID, ikke-følsomt) logges — ALDRIG resten af data.
    console.warn("[alunta-webhook] ignoreret: mangler event eller team_id", { event: event ?? null, teamId: teamId ?? null });
    return res.sendStatus(200); // intet at gøre — undgå retries
  }

  const isTierChange = event === TIER_CHANGE_EVENT;
  const status = STATUS_BY_EVENT[event] ?? null;
  if (!status && !isTierChange) {
    console.warn("[alunta-webhook] ignoreret: ukendt eller irrelevant event-type", { event, teamId });
    return res.sendStatus(200); // ukendt/irrelevant event-type — ignorér roligt
  }

  // Samme select bruges til: replay/out-of-order-guard, founder-bevarelse OG
  // felt-bevarelse (se filhovedet). Fejler kolonnen last_event_at ikke at
  // eksistere endnu (migration ikke anvendt), returnerer PostgREST roligt
  // {data:null, error} — existing bliver undefined, ingen throw (fail-open,
  // se filhovedets "kendte grænser").
  const { data: existing } = await supabase
    .from("subscriptions")
    .select("status, plan_interval, alunta_customer_id, alunta_subscription_id, current_period_end, is_founder, last_event_id, last_event_at")
    .eq("team_id", teamId)
    .maybeSingle();

  const eventId = data.uuid ?? `${event}:${payload.timestamp ?? ""}`;
  const eventTimestamp = parseEventTimestamp(payload.timestamp);

  if (existing?.last_event_id === eventId) return res.sendStatus(200); // eksakt duplikat/retry — no-op
  if (
    existing?.last_event_at &&
    eventTimestamp &&
    eventTimestamp.getTime() < new Date(existing.last_event_at).getTime()
  ) {
    return res.sendStatus(200); // forsinket/omordnet event, allerede overhalet af et nyere — no-op
  }

  // last_event_at regresserer ALDRIG til null: mangler det indkommende event et
  // timestamp, bevares den eksisterende baseline så senere ordenskontrol stadig virker.
  const lastEventAt = eventTimestamp ? eventTimestamp.toISOString() : (existing?.last_event_at ?? null);

  if (isTierChange) {
    if (data.plan_interval == null) return res.sendStatus(200); // intet at ændre
    const { error } = await supabase.from("subscriptions").upsert(
      { team_id: teamId, plan_interval: data.plan_interval, last_event_id: eventId, last_event_at: lastEventAt },
      { onConflict: "team_id" }
    );
    if (error) {
      // #2817: DB-upsert-fejl er omsætningskritisk (Alunta retry'er, men fejlen var
      // usynlig indtil nu). error er Postgres/PostgREST's egen fejlbesked (fx
      // constraint-navn), aldrig webhook-payloaden — samme mønster som billingCheckout.js.
      captureExceptionFn(error, { tags: { flow: "billing", stage: "webhook-upsert" }, teamId, event });
      return res.sendStatus(500); // Alunta retry'er
    }
    return res.sendStatus(200);
  }

  const row = {
    team_id: teamId,
    status,
    plan_interval: data.plan_interval ?? existing?.plan_interval ?? null,
    alunta_customer_id: data.customer_uuid ?? existing?.alunta_customer_id ?? null,
    alunta_subscription_id: data.subscription_uuid ?? existing?.alunta_subscription_id ?? null,
    current_period_end: data.current_period_end ?? existing?.current_period_end ?? null,
    last_event_id: eventId,
    last_event_at: lastEventAt,
  };

  // Founder-status (#1903) er server-afledt — ALDRIG fra provider-payloaden — og
  // permanent når først optjent. Kun førstekøbs-events kan claime et NYT sæde;
  // alle andre events (inkl. cancelled/started/resumed/payment_failed/ended)
  // rører derfor aldrig is_founder: nøglen udelades helt af row, så upsert
  // lader den eksisterende kolonneværdi stå.
  if (FOUNDER_ELIGIBLE_EVENTS.has(event)) {
    if (existing?.is_founder) {
      row.is_founder = true;
    } else {
      const { taken } = await getFounderSeats(supabase);
      // Count-then-write er ikke atomisk: to samtidige aktiveringer omkring sæde 50
      // kan i teorien begge se "taken < cap" og begge blive Founder. Accepteret ved
      // nuværende (lave) tilmeldings-volumen — se FOUNDER_SEAT_CAP.
      row.is_founder = taken < FOUNDER_SEAT_CAP;
    }
  }

  const { error } = await supabase.from("subscriptions").upsert(row, { onConflict: "team_id" });
  if (error) {
    // #2817: se kommentar ved tier_changed-upserten ovenfor — samme rationale.
    captureExceptionFn(error, { tags: { flow: "billing", stage: "webhook-upsert" }, teamId, event });
    return res.sendStatus(500); // Alunta retry'er
  }

  return res.sendStatus(200);
}
