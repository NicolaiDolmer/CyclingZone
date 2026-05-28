/**
 * Daily UCI stale-data safety-net.
 * =================================
 * GitHub Actions scheduled UCI syncs can be skipped or delayed, so this
 * read-only monitor alerts when rider_uci_history has not been refreshed.
 */

export const UCI_STALE_THRESHOLD_DAYS = 8;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export async function processUciStaleDataCheck({
  supabase,
  now = new Date(),
  thresholdDays = UCI_STALE_THRESHOLD_DAYS,
  sendWebhookFn,
  getDefaultWebhookFn,
  captureExceptionFn,
} = {}) {
  if (!supabase?.from) throw new Error("Supabase client required");

  const { data, error } = await supabase
    .from("rider_uci_history")
    .select("synced_at")
    .order("synced_at", { ascending: false })
    .limit(1);
  if (error) throw new Error(`rider_uci_history query failed: ${error.message}`);

  const latestSyncedAt = data?.[0]?.synced_at ?? null;
  const thresholdMs = thresholdDays * MS_PER_DAY;
  const ageMs = latestSyncedAt ? now.getTime() - new Date(latestSyncedAt).getTime() : Infinity;
  const ageDays = Number.isFinite(ageMs) ? ageMs / MS_PER_DAY : null;

  if (latestSyncedAt && ageMs <= thresholdMs) {
    return { alerted: false, latestSyncedAt, ageDays };
  }

  const url = getDefaultWebhookFn ? await getDefaultWebhookFn() : null;
  const ageText = latestSyncedAt ? `${ageDays.toFixed(1)} dage` : "ingen historik";
  const message = latestSyncedAt
    ? `Seneste UCI-sync i rider_uci_history er ${latestSyncedAt} (${ageText} gammel).`
    : "rider_uci_history har ingen synced_at-rækker.";

  if (url && sendWebhookFn) {
    await sendWebhookFn(url, {
      embeds: [
        {
          title: "🚨 UCI data stale",
          description: `${message}\nForventet friskere end ${thresholdDays} dage. Undersøg UCI GitHub Action og manuel sync før spillerdata driver videre.`,
          color: 0xe74c3c,
          timestamp: now.toISOString(),
        },
      ],
    });
  }

  if (captureExceptionFn) {
    captureExceptionFn(new Error(`UCI data stale: ${message}`), {
      tags: { cron: "uci-stale-data-check" },
      extra: { latestSyncedAt, ageDays, thresholdDays },
    });
  }

  return { alerted: true, latestSyncedAt, ageDays };
}
