// Alunta webhook-handler. Svar 2xx < 3 sek. (Aluntas grænse); minimal DB-arbejde.
// Interim-auth: delt hemmelig header over HTTPS. TODO: skift til Aluntas rigtige
// signatur-mekanisme når den er bekræftet i test_mode (spec §9 åbne afklaringer).

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
  if (data.is_founder !== undefined) row.is_founder = data.is_founder;

  const { error } = await supabase.from("subscriptions").upsert(row, { onConflict: "team_id" });
  if (error) return res.sendStatus(500); // Alunta retry'er

  return res.sendStatus(200);
}
