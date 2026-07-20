// Alunta webhook-handler. Svar 2xx < 3 sek. (Aluntas grænse); minimal DB-arbejde.
// Interim-auth: delt hemmelig header over HTTPS. TODO: skift til Aluntas rigtige
// signatur-mekanisme når den er bekræftet i test_mode (spec §9 åbne afklaringer).

import { FOUNDER_SEAT_CAP, getFounderSeats } from "./founderSeats.js";

export function verifyWebhookSecret(req, secret) {
  const provided = req.get("X-Alunta-Secret");
  return Boolean(secret) && provided === secret;
}

const ACTIVATING = new Set(["checkout.completed", "invoice.paid", "subscription.created"]);
const CANCELLING = new Set(["subscription.cancelled"]);

export async function handleAluntaWebhook({ req, res, supabase, secret = process.env.ALUNTA_WEBHOOK_SECRET }) {
  if (!verifyWebhookSecret(req, secret)) return res.sendStatus(401);

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
