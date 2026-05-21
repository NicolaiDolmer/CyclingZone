/**
 * Daglig safety-net: tæller sæson-transitions i admin_log seneste 24h.
 * ====================================================================
 * Under incidenten 2026-05-21 fyrede cron-loopen 4 transitions over 30 minutter
 * før brugeren spotted det. Et passivt safety-net ville have raset alarm efter
 * den 2. transition (max 1 forventet per faktisk sæson, dvs. << 1 per døgn).
 *
 * Cron'en er pure read + notify — ingen DB-writes. Idempotens behøves ikke.
 */

import { ADMIN_ACTION_TYPE } from "./economyConstants.js";

const MAX_EXPECTED_TRANSITIONS_PER_DAY = 1;

export async function processDailySeasonCountCheck({
  supabase,
  now = new Date(),
  sendWebhookFn,
  getDefaultWebhookFn,
  captureExceptionFn,
}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const since = new Date(now.getTime() - 24 * 60 * 60 * 1000).toISOString();
  const { data, error, count } = await supabase
    .from("admin_log")
    .select("id, description, created_at, meta", { count: "exact" })
    .eq("action_type", ADMIN_ACTION_TYPE.SEASON_TRANSITION)
    .gte("created_at", since)
    .order("created_at", { ascending: false });
  if (error) throw new Error(`admin_log query failed: ${error.message}`);

  const transitionCount = count ?? (data || []).length;
  if (transitionCount <= MAX_EXPECTED_TRANSITIONS_PER_DAY) {
    return { transitionCount, alerted: false };
  }

  const url = getDefaultWebhookFn ? await getDefaultWebhookFn() : null;
  const transitionList = (data || []).map((entry) => {
    const from = entry.meta?.from_season_number ?? "?";
    const to = entry.meta?.to_season_number ?? "?";
    return `• ${from} → ${to} (${entry.created_at})`;
  }).join("\n");

  if (url && sendWebhookFn) {
    await sendWebhookFn(url, {
      embeds: [{
        title: "🚨 Unusual season-transition rate detected",
        description: `${transitionCount} sæson-transitions logget seneste 24h (forventet ≤ ${MAX_EXPECTED_TRANSITIONS_PER_DAY}).\nMulig cron-loop — undersøg straks.`,
        color: 0xe74c3c,
        fields: [{ name: "Transitions", value: transitionList || "(tom)" }],
        timestamp: now.toISOString(),
      }],
    });
  }

  if (captureExceptionFn) {
    captureExceptionFn(
      new Error(`Sæson-transition rate-anomali: ${transitionCount} transitions/døgn`),
      { tags: { cron: "daily-season-count-check" }, extra: { transitionCount, transitions: data } }
    );
  }

  return { transitionCount, alerted: true };
}
