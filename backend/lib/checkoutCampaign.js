import { captureServerEvent, hasDeclinedAnalytics, POSTHOG_DEFAULT_TIMEOUT_MS } from "./posthogServer.ts";

const CAMPAIGN_KEYS = ["utm_source", "utm_medium", "utm_campaign", "utm_content"];
const UTM_TAG = /^[a-z0-9][a-z0-9._-]{0,79}$/i;
const UUID = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;
const PHONE_LIKE = /^[0-9._-]{7,}$/;

async function readCheckoutCampaign(supabase, userId) {
  const { data: user, error: consentError } = await supabase.from("users")
    .select("consent_preferences, role").eq("id", userId).maybeSingle();
  if (consentError || !user || user.role === "admin" || hasDeclinedAnalytics(user.consent_preferences)) return null;

  const { data: row, error } = await supabase.from("signup_attribution")
    .select("utm_source, utm_medium, utm_campaign, utm_content").eq("user_id", userId).maybeSingle();
  if (error) return null;

  const campaign = {};
  for (const key of CAMPAIGN_KEYS) {
    const tag = typeof row?.[key] === "string" ? row[key].trim() : "";
    if (UTM_TAG.test(tag) && !UUID.test(tag) && !PHONE_LIKE.test(tag)) {
      campaign[key] = key === "utm_campaign" ? tag.toLowerCase() : tag;
    }
  }
  return campaign;
}

export async function recordCheckoutEvent({
  supabase, teamId, userId, isTestAccount, eventName, eventData, captureCheckoutEventFn = captureServerEvent,
}) {
  let campaign = null;
  let timer;
  try {
    if (!isTestAccount) {
      const timeout = new Promise((resolve) => {
        timer = setTimeout(() => resolve(null), POSTHOG_DEFAULT_TIMEOUT_MS);
        timer.unref?.();
      });
      campaign = await Promise.race([readCheckoutCampaign(supabase, userId), timeout]);
    }
  } catch {
    // Best-effort attribution. The original billing event is retained.
  } finally {
    clearTimeout(timer);
  }

  const { error } = await supabase.from("player_events").insert({
    team_id: teamId,
    user_id: userId,
    event_name: eventName,
    event_data: { ...eventData, ...campaign },
  });
  if (error) throw new Error("checkout player_events insert failed");
  if (!campaign) return;

  // Copy only fixed billing labels and campaign tags to PostHog. The internal
  // UUID is the SDK's distinct ID, in line with the race milestone.
  const properties = { ...campaign };
  const intervalKey = eventName === "checkout_started" ? "interval" : "plan_interval";
  const interval = eventData[intervalKey];
  if (interval === "monthly" || interval === "semiannual") properties[intervalKey] = interval;
  if (eventData.currency === "DKK" || eventData.currency === "EUR") properties.currency = eventData.currency;
  if (Object.keys(campaign).length) properties.$set_once = campaign;
  await captureCheckoutEventFn({ event: eventName, distinctId: userId, properties });
}
