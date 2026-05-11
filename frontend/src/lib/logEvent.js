import { supabase } from "./supabase";

// Player-events baseline (#137). Fire-and-forget instrumentation der respekterer
// analytics-consent (samme gate som Clarity). Skriver til public.player_events
// — RLS sikrer at managers kun ser egne events.
//
// Master-listen KNOWN_EVENTS er Detector E's reference for hvilke events der
// bør have impressions. Tilføj nye events her samtidig med at de instrumenteres.

const CONSENT_KEY = "cz_consent_v1";

let cachedUserId = null;
let cachedTeamId = null;
let authListenerInstalled = false;

function installAuthListener() {
  if (authListenerInstalled) return;
  authListenerInstalled = true;
  supabase.auth.onAuthStateChange((event) => {
    if (event === "SIGNED_OUT" || event === "SIGNED_IN" || event === "USER_UPDATED") {
      cachedUserId = null;
      cachedTeamId = null;
    }
  });
}

function hasAnalyticsConsent() {
  try {
    const raw = localStorage.getItem(CONSENT_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw);
    return parsed?.analytics === true;
  } catch {
    return false;
  }
}

async function ensureIdentity() {
  installAuthListener();
  if (cachedUserId) return { userId: cachedUserId, teamId: cachedTeamId };
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  cachedUserId = user.id;
  const { data: team } = await supabase
    .from("teams")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  cachedTeamId = team?.id ?? null;
  return { userId: cachedUserId, teamId: cachedTeamId };
}

export const KNOWN_EVENTS = Object.freeze([
  // Game-events — engagement / retention-signal
  "session_started",
  "auction_view",
  "auction_bid_placed",
  "transfer_offer_sent",
  "notification_clicked",
  // Feature-impressions — canaries der fanger "deployed feature med 0 brugere"
  // (samme klasse som slice 14 / #279). Detector E i audit-feature-liveness.js
  // alarmerer hvis nogen af disse har 0 events sidste 30 dage.
  "feature_rider_development_tab_opened",
  "feature_admin_auction_config_opened",
  "feature_board_consequences_panel_viewed",
  "feature_finance_forecast_card_viewed",
  "feature_hall_of_fame_opened",
]);

async function _logEvent(name, data) {
  if (!hasAnalyticsConsent()) return;
  const identity = await ensureIdentity();
  if (!identity?.userId) return;
  await supabase.from("player_events").insert({
    team_id: identity.teamId,
    user_id: identity.userId,
    event_name: name,
    event_data: data || {},
  });
}

export function logEvent(name, data = {}) {
  _logEvent(name, data).catch(() => {
    // Instrumentation must never break the user flow.
  });
}
