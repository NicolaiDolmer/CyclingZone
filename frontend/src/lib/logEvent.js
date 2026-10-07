import { supabase } from "./supabase";
import { getAuthedUser } from "./getAuthedUser.js";
import { isSquadDrafted, isTeamNewlyCreated } from "./teamDrafted.js";
import { getSessionId } from "./sessionId.js";
import { capturePosthogEvent, isPosthogCapturing } from "./posthogClient.js";

// Player-events baseline (#137). Fire-and-forget instrumentation der respekterer
// analytics-consent (samme gate som Clarity). Skriver til public.player_events
// — RLS sikrer at managers kun ser egne events.
//
// To gates, bevidst adskilt (#4321, ejer 6/10):
//   - Postgres (player_events) kræver et AKTIVT analytics-ja, uændret.
//   - PostHog-spejlingen følger PostHog-gaten: kører for alle undtagen dem der
//     aktivt har afvist (cookieløst). Den gate håndhæves af
//     posthogIntegration.jsx, der starter/opter ud; her spørger vi blot
//     isPosthogCapturing().
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
  // team_created (#4321): kerne-rejsens trin "hold oprettet". Fyrer ved første
  // dashboard-load med et hold oprettet inden for TEAM_CREATED_WINDOW_MS
  // (teamDrafted.js), så eksisterende brugere ikke tæller ved deploy. Kædet
  // efter signup-flushen, så PostHog ser signup før team_created.
  "team_created",
  "onboarding_completed",
  "first_bid",
  "first_transfer",
  // team_drafted: ny manager har FØRSTE gang en løbsklar trup (≥ MIN_RIDERS_FOR_RACE=8
  // ryttere — starter-squad-størrelsen, relaunch-design). first_race_result_viewed:
  // brugeren ser FØRSTE gang et af sine EGNE holds løbsresultater (placering). Begge
  // via logFirstEvent (de-dup pr. bruger). Instrumenteret 2026-06-25 (#940 målebølge).
  "team_drafted",
  "first_race_result_viewed",
  // first_race_result_shown (#3243): fyrer FØRSTE gang dashboardets
  // MyLatestResultCard EKSPONERER et usét løbsresultat for brugeren (badge går
  // fra "Nyt" til set, MyLatestResultCard.jsx's useSeenBadge). Adskilt fra
  // first_race_result_viewed: det event kræver at brugeren selv åbner holdets
  // resultat-fane, mens dette blot kræver at dashboardet loader MED resultatet
  // synligt. Før dette event var trinet "resultat eksponeret" kun aflæseligt
  // via teams.my_result_seen_race_id (rå kolonne, ikke et queryable event) —
  // funnel-fund #3243.
  "first_race_result_shown",
  // Bud-anbefalingen til nye managers (AuctionsPage.jsx). Forholdet mellem
  // _clicked og _shown er selve målingen. Canary-blinde indtil #5369.
  "onboarding_first_bid_recommendation_shown",
  "onboarding_first_bid_recommendation_clicked",
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
  // De øvrige rytter-faner (RiderStatsPage.jsx) fyrede hele tiden, men kun
  // udviklings-fanen stod her. Canary-blinde indtil #5369.
  "feature_rider_scouting_tab_opened",
  "feature_rider_history_tab_opened",
  "feature_rider_results_tab_opened",
  "feature_rider_palmares_tab_opened",
  "feature_rider_interest_tab_opened",
  "feature_board_consequences_panel_viewed",
  "feature_finance_forecast_card_viewed",
  // feature_dayform_line_viewed (#4598, ejer-design 2/9): fyrer fra
  // RaceDetailPage.jsx's StageTab når en spiller ser en etapes resultater MED
  // mindst én egen dagsform-replik synlig (team_ids-scopet, aldrig andres).
  "feature_dayform_line_viewed",
  "feature_hall_of_fame_opened",
  // survey_banner_shown/clicked/dismissed fjernet (#2467): SurveyBanner.jsx
  // slettet — admin-preview uden ægte Tally-URL loggede shown ved hver mount og
  // forurenede player_events (8% af tabellen, 2 admin/test-brugere). Komponenten
  // ligger i git-historikken; re-tilføj eventerne hvis banneret genindføres.
  // Academy (#1308/#932) — fyrer fra useAcademy.js når managers håndterer
  // akademiryttere. Tilføjet til KNOWN_EVENTS i #1669 (var instrumenteret men
  // canary-blinde). Naturligt 0 indtil academy_enabled flippes ved relaunch.
  "academy_sign",
  "academy_reject",
  "academy_graduate",
  // Resten af akademi-handlingerne fra useAcademy.js. Canary-blinde indtil #5369.
  // academy_intake_pull er 0 i prod: featuren er dormant bag flaget
  // academy_intake_pull_enabled (FEATURE_REGISTRY.yml), og står derfor i
  // WHITELIST_ZERO_IMPRESSION_EVENTS i audit-feature-liveness.js.
  "academy_promote",
  "academy_demote",
  "academy_release",
  "academy_intake_pull",
  // Faciliteter og stab (useFacilities.js). Canary-blinde indtil #5369.
  "facility_upgrade",
  "staff_hire",
  "staff_fire",
  // Training (#1305) — fyrer fra useTraining.js ved bulk-fokus + daglig træning.
  // Tilføjet til KNOWN_EVENTS i #1669 (var instrumenteret men canary-blinde).
  // Naturligt 0 indtil træningsmotoren er aktiv for spillere.
  "training_focus_set_bulk",
  "training_run_today",
  // Ugeplaner for holdet og for én rytter (useTraining.js). Canary-blinde indtil #5369.
  "training_week_plan_set",
  "training_rider_week_plan_set",
  // first_training (#4321): kerne-rejsens trin "første træning". Afledt i
  // logEvent() af brugerens første trænings-handling (TRAINING_ACTION_EVENTS
  // nedenfor) og de-dup'et pr. bruger via logFirstEvent. Bærer {via}.
  "first_training",
  // onboarding_step2_one_click (#5241) — fyrer fra OnboardingProgressCard.jsx
  // når "Run this week's training"/"Kør ugens træning" sætter assistentens
  // anbefalede fokus for truppen og kører dagen i ét klik. Måler #4964-fundet:
  // trin 2 var det eneste faldende onboarding-trin (52 % → 34 %), fordi det
  // krævede fokus rytter for rytter på træningssiden.
  "onboarding_step2_one_click",
  // #4557 (S-M2d) · instrumentering for aarsmoedet/Boardroom (#1141:
  // mødegennemførelse + kvitterings-åbninger). feature_board_meeting_opened
  // (canary, kun ved mount) og board_meeting_signed (funnel-modstykke, kun
  // ved succesfuld underskrift) fyrer fra AnnualMeetingPage.jsx.
  // board_receipt_opened fyrer fra Boardroom-kortenes egen GoalReceipt-
  // expand (MandateCard.jsx). Naturligt 0 indtil board_mandate_model_enabled
  // flippes for flere end admin/beta-testere.
  "feature_board_meeting_opened",
  "board_meeting_signed",
  "board_receipt_opened",
  // action_rejected (#3767) — fyrer fra actionTelemetry.js når en spiller-
  // handling bliver afvist af en regel (for lavt bud, kontraktloft nået).
  // Flyttet hertil fra Sentry, hvor de fem `player action rejected`-issues stod
  // arkiverede og usete: 51 afvisninger over 30 dage, heriblandt 13 spillere
  // stoppet af contract_extension_cap_reached. event_data bærer {action, reason,
  // status} + spil-id'er — aldrig PII. Detector E holder øje med at strømmen
  // ikke tørrer ud; 0 impressions ville betyde enten at ingen bliver stoppet
  // eller at instrumenteringen er faldet ud.
  "action_rejected",
  // NPS (#4997) — nps_submitted fyrer ved et gemt svar, nps_dismissed når
  // spilleren lukker prompten. Før #4997 blev et luk kun til setVisible(false),
  // så vi kunne ikke skelne "lukkede den" fra "så den aldrig": 40 af 262 brugere
  // havde fået prompten vist, 9 havde svaret, og de 31 imellem var et sort hul.
  // Forholdet mellem de to events er selve målingen ejeren bad om 7/9.
  "nps_submitted",
  "nps_dismissed",
  // app_version_reload (#5033/#5159) — release-koordineringen. Baerer
  // {from, to, fromSha, sha, trigger, outcome}. `outcome` er hele pointen efter
  // audit-fund M4: "arrived" (vi landede paa maalet), "no_effect" (reloadet
  // aendrede ingenting) eller "deferred" (ny frontend fundet, men spilleren
  // havde ugemt arbejde, saa vi viste banneret i stedet). Et event alene er
  // IKKE bevis for en undgaaet ChunkLoadError.
  "app_version_reload",
  // discord_invite_clicked (#5130, ejer-direktiv 10/9) — fyrer fra
  // NotificationsPage.jsx (discord_welcome-kortet) og fra Layout.jsx's
  // footer-Discord-link (DiscordJoinLink onClick), begge steder brugeren kan
  // klikke sig ind på Discord-invitationen. Måler konvertering fra
  // velkomstbeskeden i indbakken.
  "discord_invite_clicked",
]);

// #4321: spejl eventet til PostHog. Postgres-skrivningen nedenfor er og bliver
// sandheden (fair-play-detektion + Detector E læser player_events); PostHog er
// kopien der giver funnels/retention uden håndbygget SQL. capturePosthogEvent
// er no-op medmindre PostHog-gaten er åben (PROD + ikke aktivt afvist), og kan
// hverken kaste eller blokere — spejlingen må aldrig påvirke instrumenteringen.
// userId sendes med, så eventet venter på identify og lander på personen.
function mirrorToPosthog(name, data, userId) {
  capturePosthogEvent(name, data || {}, { userId });
}

// Hvilke af de to sinks der skal have eventet lige nu. Begge lukkede = ingen
// grund til identitets-opslaget (en teams-forespørgsel).
function activeSinks() {
  return { toPostgres: hasAnalyticsConsent(), toPosthog: isPosthogCapturing() };
}

async function _logEvent(name, data) {
  const { toPostgres, toPosthog } = activeSinks();
  if (!toPostgres && !toPosthog) return;
  const identity = await ensureIdentity();
  if (!identity?.userId) return;
  mirrorToPosthog(name, data, identity.userId);
  if (!toPostgres) return;
  await supabase.from("player_events").insert({
    team_id: identity.teamId,
    user_id: identity.userId,
    event_name: name,
    event_data: data || {},
  });
}

// Kerne-rejsens "første træning" (#4321): enhver af disse handlinger tæller.
// Afledt her i stedet for på hvert kaldsted i useTraining.js /
// OnboardingProgressCard.jsx, så et nyt trænings-event kun skal tilføjes ét sted.
export const TRAINING_ACTION_EVENTS = Object.freeze([
  "training_focus_set",
  "training_focus_set_bulk",
  "training_run_today",
  "training_week_plan_set",
  "training_rider_week_plan_set",
  "onboarding_step2_one_click",
]);

export function logEvent(name, data = {}) {
  _logEvent(name, data).catch(() => {
    // Instrumentation must never break the user flow.
  });
  if (TRAINING_ACTION_EVENTS.includes(name)) {
    logFirstEvent("first_training", { via: name });
  }
}

// session_started fyrede før ved HVER getSession() + HVER SIGNED_IN → 25.280
// events fra 50 brugere (#2040). Dedup pr. ægte session-id (30-min vindue) så
// reloads/auth-re-init/token-refresh ikke fragmenterer én session i tusindvis.
let lastSessionStartId = null;
export function logSessionStart() {
  let sid;
  try { sid = getSessionId(); } catch { sid = null; }
  if (sid && sid === lastSessionStartId) return;
  lastSessionStartId = sid;
  logEvent("session_started", sid ? { sid } : {});
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

// De-dup af PostHog-spejlingen inden for én page load. localStorage-flaget
// nedenfor skrives KUN med analytics-samtykke (uændret); for en bruger der ikke
// har svaret på banneret skriver vi bevidst intet til browseren (cookieløs
// variant A, ejer 6/10). Konsekvens, dokumenteret i ANALYTICS_STACK §3: for
// sådanne brugere kan et first_*-event nå PostHog én gang pr. page load. Brug
// derfor unikke personer, ikke rå event-antal, når first_* tælles i PostHog.
const mirroredFirstEvents = new Set();

async function _logFirstEvent(name, data) {
  const { toPostgres, toPosthog } = activeSinks();
  if (!toPostgres && !toPosthog) return;
  const identity = await ensureIdentity();
  if (!identity?.userId) return;
  const flagKey = `${FIRST_EVENT_PREFIX}${name}:${identity.userId}`;
  try {
    if (localStorage.getItem(flagKey)) return;
  } catch {
    // localStorage utilgængelig — fortsæt og fyr eventet (hellere over- end under-tælle).
  }
  if (!mirroredFirstEvents.has(flagKey)) {
    mirroredFirstEvents.add(flagKey);
    mirrorToPosthog(name, data, identity.userId);
  }
  if (!toPostgres) return;
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

// --- Kerne-rejsen: team_created (#4321) ---------------------------------
// Holdet oprettes tre steder (Layout-auto-bootstrap, SetupWizardModal,
// LoginPage ved confirm-off), og alle tre lander på dashboardet bagefter. Vi
// fyrer derfor ved første dashboard-load med et NYT hold (oprettet inden for
// vinduet i teamDrafted.js), så eksisterende brugere ikke tæller ved deploy.
// Det kædes EFTER en igangværende signup-flush (samme dashboard-load), så
// PostHog altid ser signup før team_created og tragtens rækkefølge holder.
export function logTeamCreated(createdAt) {
  if (!isTeamNewlyCreated(createdAt)) return;
  signupFlushInFlight.then(() => logFirstEvent("team_created", {}));
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
// Markørens to tilstande: "1" = afventer både PostHog og Postgres;
// POSTHOG_SENT = PostHog har fået signup, Postgres venter stadig på samtykke.
// Samme nøgle, ingen ny browser-lagring (#4321): uden den ville en bruger der
// ikke svarer på banneret sende signup til PostHog ved hver eneste page load.
const PENDING_SIGNUP = "1";
const PENDING_SIGNUP_POSTHOG_SENT = "posthog_sent";
// Den seneste flush, så logTeamCreated() kan vente på den (se dér).
let signupFlushInFlight = Promise.resolve();

export function markPendingSignup() {
  try {
    localStorage.setItem(PENDING_SIGNUP_KEY, PENDING_SIGNUP);
  } catch {
    // best-effort
  }
}

async function _flushPendingSignup() {
  let pending;
  try {
    pending = localStorage.getItem(PENDING_SIGNUP_KEY);
  } catch {
    return;
  }
  if (pending !== PENDING_SIGNUP && pending !== PENDING_SIGNUP_POSTHOG_SENT) return;
  // Postgres venter på consent — markøren bevares til consent gives (samme gate
  // som øvrige events). PostHog følger sin egen gate.
  const { toPostgres, toPosthog } = activeSinks();
  const posthogDue = toPosthog && pending === PENDING_SIGNUP;
  if (!toPostgres && !posthogDue) return;
  const identity = await ensureIdentity();
  if (!identity?.userId) return;
  if (posthogDue) {
    mirrorToPosthog("signup", {}, identity.userId);
    if (!toPostgres) {
      try {
        localStorage.setItem(PENDING_SIGNUP_KEY, PENDING_SIGNUP_POSTHOG_SENT);
      } catch {
        // best-effort
      }
      return;
    }
  }
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
  signupFlushInFlight = _flushPendingSignup().catch(() => {
    // Instrumentation must never break the user flow.
  });
}
