// Founder-sæde-tælling (#1903) — CZ Pro's "første 50"-tier. Founder-status er
// permanent når først optjent (se aluntaWebhook.js); loftet begrænser kun hvor
// mange NYE rækker der kan sættes is_founder=true, aldrig eksisterende Founders.
export const FOUNDER_SEAT_CAP = 50;

// Tæller optjente Founder-sæder. Bruges af webhook-handleren (afgør ny founder-
// status) og af GET /api/billing/founder-seats (offentlig seat-counter på /pro).
export async function getFounderSeats(supabase) {
  const { count, error } = await supabase
    .from("subscriptions")
    .select("*", { count: "exact", head: true })
    .eq("is_founder", true);
  if (error) throw error;
  return { taken: count ?? 0, cap: FOUNDER_SEAT_CAP };
}
