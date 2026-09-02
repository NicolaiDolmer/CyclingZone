// Entitlement: sandheden om Pro-adgang. Provider-agnostisk — afhænger kun af
// status + current_period_end, ikke af hvem der opkrævede.
// Holdt bevidst i sync med frontend/src/lib/proEntitlement.js (computeIsPro).

export const SUBSCRIPTION_ACTIVE_STATUSES = new Set(["active", "cancelled", "past_due"]);

// #4512/#4541: respit efter cached periodeslut for løbende abonnementer.
// `current_period_end` er en CACHE af Aluntas sandhed (webhook + time-reconcile),
// og en betalende kunde må aldrig miste Pro fordi cachen halter — 1/9 faldt
// den eneste betalende kunde ud ved midnat mens Alunta samtidig sagde 'active'
// med ny periode til 1/10. Respitten dækker cache-lag (op til én reconcile-
// time + et deploy) og Aluntas egen rykkerproces, hvor status forbliver
// active/past_due indtil Alunta selv afslutter abonnementet. Afslutter Alunta
// det (subscription.ended → 'inactive'), falder Pro med det samme uanset
// respit. 'cancelled' (kunden opsagde selv) æres præcis til periodeslut —
// dér er slutdatoen et løfte, ikke en cache.
export const PRO_GRACE_AFTER_PERIOD_END_MS = 3 * 24 * 60 * 60 * 1000;

// #4648: checkout.completed (og andre webhook-events) kan lande en active/
// past_due-status FØR current_period_end er kendt — Alunta bærer ikke altid
// periodeslutdatoen på selve checkout-eventet (BILLING_STACK.md §5), og
// reconcilen (aluntaSubscriptionReconcile.js) er time-vis, ikke øjeblikkelig.
// Uden dette respit ville en frisk betalende kunde se sig selv som ikke-Pro i
// op til en time. 24 timer dækker rigeligt reconcile-vinduet + et deploy.
// last_event_at stemples af webhooken ved hvert event, uafhængigt af
// current_period_end (aluntaWebhook.js). Konstanten hedder det SAMME i
// frontend/src/lib/proEntitlement.js — ændres de hver for sig, viser badge og
// backend to forskellige sandheder.
export const PRO_GRACE_NO_PERIOD_END_MS = 24 * 60 * 60 * 1000;

export function computeIsPro(sub, now = Date.now()) {
  if (!sub) return false;
  if (!SUBSCRIPTION_ACTIVE_STATUSES.has(sub.status)) return false;
  if (!sub.current_period_end) {
    // #4648: 'cancelled' uden periodeslut har intet at æres til — ingen respit.
    if (sub.status === "cancelled") return false;
    if (!sub.last_event_at) return false;
    const lastEvent = new Date(sub.last_event_at).getTime();
    if (Number.isNaN(lastEvent)) return false;
    return lastEvent + PRO_GRACE_NO_PERIOD_END_MS > now;
  }
  const end = new Date(sub.current_period_end).getTime();
  if (Number.isNaN(end)) return false;
  if (sub.status === "cancelled") return end > now;
  return end + PRO_GRACE_AFTER_PERIOD_END_MS > now;
}

// Slår team'ets subscription op via service_role-klienten og returnerer is_pro.
export async function isPro(supabase, teamId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, is_founder, last_event_at")
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw error;
  return computeIsPro(data);
}
