// Ren Pro-entitlement-logik (ingen imports) — kan node-testes uden at trække
// supabase/Vite ind. Holdt bevidst i sync med backend/lib/entitlement.js.

const ACTIVE = new Set(["active", "cancelled", "past_due"]);

// 'cancelled' tæller stadig som Pro indtil current_period_end (æret betalt tid).
export function computeIsPro(sub) {
  if (!sub || !sub.current_period_end) return false;
  if (!ACTIVE.has(sub.status)) return false;
  return new Date(sub.current_period_end).getTime() > Date.now();
}
