import { supabase } from "./supabase";
import { getAuthedUser } from "./getAuthedUser.js";
import { isSquadDrafted } from "./teamDrafted.js";

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
  const user = await getAuthedUser();
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
  // Aktiverings-funnel (#1583): eksplicitte trin så drop-off kan AFLÆSES direkte
  // frem for udledes via min(created_at)-aggregering. signup fyrer ved
  // kontooprettelse (se markPendingSignup/flushPendingSignup), onboarding_completed
  // ved 4/4 onboarding-steps, first_bid/first_transfer KUN ved brugerens første
  // (de-dup pr. bruger via logFirstEvent).
  "signup",
  "onboarding_completed",
  "first_bid",
  "first_transfer",
  // team_drafted: ny manager har FØRSTE gang en løbsklar trup (≥ MIN_RIDERS_FOR_RACE=8
  // ryttere — starter-squad-størrelsen, relaunch-design). first_race_result_viewed:
  // brugeren ser FØRSTE gang et af sine EGNE holds løbsresultater (placering). Begge
  // via logFirstEvent (de-dup pr. bruger). Instrumenteret 2026-06-25 (#940 målebølge).
  "team_drafted",
  "first_race_result_viewed",
  // Game-events — engagement / retention-signal
  "session_started",
  "auction_view",
  "auction_bid_placed",
  "transfer_offer_sent",
  "notification_clicked",
  // Pillar-events til go/no-go-funnellen (#1168): training_focus_set (useTraining),
  // race_viewed (RaceDetailPage, landede med #1102 runtime-wiring).
  "training_focus_set",
  "race_viewed",
  // Feature-impressions — canaries der fanger "deployed feature med 0 brugere"
  // (samme klasse som slice 14 / #279). Detector E i audit-feature-liveness.js
  // alarmerer hvis nogen af disse har 0 events sidste 30 dage.
  // feature_admin_auction_config_opened fjernet (#1650): blev kun fyret fra den
  // gamle AdminPage.jsx, som blev slettet som dead code i #1180/#1289 (d8caeda9).
  // Den nye admin-økonomi-fane (AdminEconomyTab.jsx) re-instrumenteres ikke —
  // admin-only impressions er ikke et meningsfuldt canary-signal.
  "feature_rider_development_tab_opened",
  "feature_board_consequences_panel_viewed",
  "feature_finance_forecast_card_viewed",
  "feature_hall_of_fame_opened",
  // Sprint validation — survey-CTA-banner (#364)
  "survey_banner_shown",
  "survey_banner_clicked",
  "survey_banner_dismissed",
  // Academy (#1308/#932) — fyrer fra useAcademy.js når managers håndterer
  // akademiryttere. Tilføjet til KNOWN_EVENTS i #1669 (var instrumenteret men
  // canary-blinde). Naturligt 0 indtil academy_enabled flippes ved relaunch.
  "academy_sign",
  "academy_reject",
  "academy_free_agent_sign",
  "academy_graduate",
  // Training (#1305) — fyrer fra useTraining.js ved bulk-fokus + daglig træning.
  // Tilføjet til KNOWN_EVENTS i #1669 (var instrumenteret men canary-blinde).
  // Naturligt 0 indtil træningsmotoren er aktiv for spillere.
  "training_focus_set_bulk",
  "training_run_today",
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

// --- Funnel "first"-events (#1583) ---------------------------------------
// De-duplikér pr. bruger via localStorage, så first_bid/first_transfer/
// onboarding_completed kun fyrer ÉN gang. Best-effort: localStorage er
// device-bundet, men en ny tester gennemfører sin aktivering på samme device,
// så funnellen fanger førstegangs-handlingen. Bemærk: en eksisterende bruger
// (uden historisk flag) kan fyre ét "first"-event ved sin første relevante
// handling efter deploy — for funnel-analyse af nye testere filtreres på
// signup-dato ≥ deploy. Den autoritative signup-måling er signup_attribution.
const FIRST_EVENT_PREFIX = "cz_first_event_v1:";

async function _logFirstEvent(name, data) {
  if (!hasAnalyticsConsent()) return;
  const identity = await ensureIdentity();
  if (!identity?.userId) return;
  const flagKey = `${FIRST_EVENT_PREFIX}${name}:${identity.userId}`;
  try {
    if (localStorage.getItem(flagKey)) return;
  } catch {
    // localStorage utilgængelig — fortsæt og fyr eventet (hellere over- end under-tælle).
  }
  await supabase.from("player_events").insert({
    team_id: identity.teamId,
    user_id: identity.userId,
    event_name: name,
    event_data: data || {},
  });
  // Sæt flag FØRST efter en succesfuld insert — fejler insert, prøver vi igen næste gang.
  try {
    localStorage.setItem(flagKey, "1");
  } catch {
    // best-effort
  }
}

export function logFirstEvent(name, data = {}) {
  _logFirstEvent(name, data).catch(() => {
    // Instrumentation must never break the user flow.
  });
}

// --- Aktiverings-funnel: team_drafted (#940) ----------------------------
// Tærsklen ligger i lib/teamDrafted.js (pure, unit-testbar uden Supabase-import);
// her kobles den til logFirstEvent, så eventet de-dup'es pr. bruger og kun lander
// én gang. Kaldes med antallet af ejede ryttere fra dashboardets squad-stats.
export function logTeamDrafted(riderCount) {
  if (!isSquadDrafted(riderCount)) return;
  logFirstEvent("team_drafted", { rider_count: riderCount });
}

// --- Signup-funnel-event (#1583) -----------------------------------------
// signup sker FØR en authenticated session findes når email-bekræftelse er slået
// TIL (prod, #1570). player_events kræver auth+team, så vi kan ikke skrive eventet
// i selve signup-øjeblikket. I stedet markerer vi en ventende signup ved
// kontooprettelse, og flusher den når brugeren er authenticated (confirm-off:
// straks efter bootstrap; confirm-on: ved første dashboard-load efter bekræftelse).
// Markøren sættes KUN ved en ægte signUp(), så eksisterende brugere aldrig tæller.
const PENDING_SIGNUP_KEY = "cz_pending_signup_event_v1";

export function markPendingSignup() {
  try {
    localStorage.setItem(PENDING_SIGNUP_KEY, "1");
  } catch {
    // best-effort
  }
}

async function _flushPendingSignup() {
  let pending;
  try {
    pending = localStorage.getItem(PENDING_SIGNUP_KEY) === "1";
  } catch {
    return;
  }
  if (!pending) return;
  // Vent på consent — markøren bevares til consent gives (samme gate som øvrige events).
  if (!hasAnalyticsConsent()) return;
  const identity = await ensureIdentity();
  if (!identity?.userId) return;
  await supabase.from("player_events").insert({
    team_id: identity.teamId,
    user_id: identity.userId,
    event_name: "signup",
    event_data: {},
  });
  try {
    localStorage.removeItem(PENDING_SIGNUP_KEY);
  } catch {
    // best-effort
  }
}

export function flushPendingSignup() {
  _flushPendingSignup().catch(() => {
    // Instrumentation must never break the user flow.
  });
}
