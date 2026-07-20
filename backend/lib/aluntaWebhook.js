// Alunta webhook-handler. Svar 2xx < 3 sek. (Aluntas grænse); minimal DB-arbejde.
// Auth (bekræftet i Aluntas OpenAPI-spec 20/7, lukker spec §9-TODO'en): Alunta
// sender en `Signature`-header = HMAC-SHA256 over den RÅ JSON-body, keyet med
// webhook-secret'en fra dashboardet (ALUNTA_WEBHOOK_SECRET). Verifikation SKAL
// ske på rå bytes før parsing (express.raw er wired på pathen i server.js) og
// med constant-time-sammenligning.

import { createHmac, timingSafeEqual } from "node:crypto";
import { FOUNDER_SEAT_CAP, getFounderSeats } from "./founderSeats.js";

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

const ACTIVATING = new Set(["checkout.completed", "invoice.paid", "subscription.created"]);
const CANCELLING = new Set(["subscription.cancelled"]);

export async function handleAluntaWebhook({ req, res, supabase, secret = process.env.ALUNTA_WEBHOOK_SECRET }) {
  if (!verifyWebhookSignature(req, secret)) return res.sendStatus(401);

  let payload;
  try {
    if (Buffer.isBuffer(req.body)) payload = JSON.parse(req.body.toString("utf8"));
    else if (typeof req.body === "string") payload = JSON.parse(req.body);
    else payload = req.body;
  } catch {
    return res.sendStatus(400);
  }

  const { event, data } = payload || {};
  const teamId = data?.external_customer_id;
  if (!event || !teamId) return res.sendStatus(200); // intet at gøre — undgå retries

  let status = null;
  if (ACTIVATING.has(event)) status = "active";
  else if (CANCELLING.has(event)) status = "cancelled";
  if (!status) return res.sendStatus(200); // ukendt event-type — ignorér roligt

  const row = {
    team_id: teamId,
    status,
    plan_interval: data.plan_interval ?? null,
    alunta_customer_id: data.customer_uuid ?? null,
    alunta_subscription_id: data.subscription_uuid ?? null,
    current_period_end: data.current_period_end ?? null,
    last_event_id: data.uuid ?? `${event}:${payload.timestamp ?? ""}`,
  };

  // Founder-status (#1903) er server-afledt — ALDRIG fra provider-payloaden — og
  // permanent når først optjent. Cancelling-events rører derfor aldrig is_founder:
  // nøglen udelades helt af row, så upsert lader den eksisterende kolonneværdi stå.
  if (ACTIVATING.has(event)) {
    const { data: existing } = await supabase
      .from("subscriptions")
      .select("is_founder")
      .eq("team_id", teamId)
      .maybeSingle();
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
  if (error) return res.sendStatus(500); // Alunta retry'er

  return res.sendStatus(200);
}
