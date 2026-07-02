// Entitlement: sandheden om Pro-adgang. Provider-agnostisk — afhænger kun af
// status + current_period_end, ikke af hvem der opkrævede.
// Holdt bevidst i sync med frontend/src/lib/useSubscription.js (computeIsPro).

export const SUBSCRIPTION_ACTIVE_STATUSES = new Set(["active", "cancelled", "past_due"]);

// 'cancelled' tæller stadig som Pro indtil current_period_end (æret betalt tid).
export function computeIsPro(sub) {
  if (!sub || !sub.current_period_end) return false;
  if (!SUBSCRIPTION_ACTIVE_STATUSES.has(sub.status)) return false;
  return new Date(sub.current_period_end).getTime() > Date.now();
}

// Slår team'ets subscription op via service_role-klienten og returnerer is_pro.
export async function isPro(supabase, teamId) {
  const { data, error } = await supabase
    .from("subscriptions")
    .select("status, current_period_end, is_founder")
    .eq("team_id", teamId)
    .maybeSingle();
  if (error) throw error;
  return computeIsPro(data);
}
