// Ren Pro-entitlement-logik (ingen imports) — kan node-testes uden at trække
// supabase/Vite ind. Holdt bevidst i sync med backend/lib/entitlement.js.

const ACTIVE = new Set(["active", "cancelled", "past_due"]);

// #4512/#4541: respit efter cached periodeslut for løbende abonnementer, så en
// betalende kunde aldrig mister Pro fordi vores cache af Aluntas periode halter.
// Spejler backend/lib/entitlement.js PRO_GRACE_AFTER_PERIOD_END_MS — ændres de
// hver for sig, viser badge og backend to forskellige sandheder.
export const PRO_GRACE_AFTER_PERIOD_END_MS = 3 * 24 * 60 * 60 * 1000;

// #4648: spejler backend/lib/entitlement.js's PRO_GRACE_NO_PERIOD_END_MS —
// samme navn, samme tal, ændres sammen. Dækker vinduet mellem et checkout-
// webhook-event (status sat) og reconcilen der fylder current_period_end ind.
export const PRO_GRACE_NO_PERIOD_END_MS = 24 * 60 * 60 * 1000;

// 'cancelled' tæller stadig som Pro præcis indtil current_period_end (æret
// betalt tid, ingen respit). active/past_due får respitten.
export function computeIsPro(sub, now = Date.now()) {
  if (!sub) return false;
  if (!ACTIVE.has(sub.status)) return false;
  if (!sub.current_period_end) {
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
