import { Routes, Route, Navigate, useLocation, useSearchParams, useNavigate } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
import { parseAuthErrorHash, isExpiredOrDeniedAuthError } from "./lib/authErrorHash.js";
// #881: lazyWithRetry erstatter React.lazy så stale-chunk-fejl efter deploy bliver
// recoverable (retry + genkendelig ChunkLoadError -> auto-reload via SentryBoundary).
import { lazyWithRetry as lazy } from "./lib/lazyWithRetry.js";
import { supabase } from "./lib/supabase";
import CookieBanner from "./components/CookieBanner.jsx";
// LandingPage er eager (ikke lazy): den prerendres ved build og hydreres på "/",
// så komponenten SKAL være synkront tilgængelig ved klientens første render —
// en lazy-suspense-fallback ville ellers give et hydration-mismatch.
import LandingPage from "./pages/LandingPage.jsx";
import { logSessionStart } from "./lib/logEvent";
import { setSentryUser, clearSentryUser } from "./lib/sentry.jsx";
import { safeNextPath } from "./lib/safeNextPath.js";

// Layout + analytics integrations lazy-loaded for #479: public routes
// (/founder-supporter, /login, /privacy-*) ikke betaler for app-shell + Clarity/Vercel
// SDK'er i main-bundlen. Analytics-komponenterne er allerede consent-gated så ingen
// netværkskald før samtykke; lazy-load tager dem også ud af cold-start payload.
const Layout = lazy(() => import("./components/Layout"));
const ClarityIntegration = lazy(() => import("./lib/clarityIntegration.jsx"));
const WebVitalsIntegration = lazy(() => import("./lib/webVitalsIntegration.jsx"));
const VercelAnalyticsIntegration = lazy(() => import("./lib/vercelAnalyticsIntegration.jsx"));
const GaIntegration = lazy(() => import("./lib/gaIntegration.jsx"));
// #2040: anonym, storage-less engagement-beacon for den logget-UD cold-population
// (logget-ind måles via player_events). Consent-uafhængig, ingen storage på enheden.
const TrafficBeacon = lazy(() => import("./components/TrafficBeacon.jsx"));

const LoginPage = lazy(() => import("./pages/LoginPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const RidersPage = lazy(() => import("./pages/RidersPage"));
const AuctionsPage = lazy(() => import("./pages/AuctionsPage"));
const AuctionHistoryPage = lazy(() => import("./pages/AuctionHistoryPage"));
const TransfersPage = lazy(() => import("./pages/TransfersPage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const AdminLayout = lazy(() => import("./pages/admin/AdminLayout"));
const AdminSeasonTab = lazy(() => import("./pages/admin/AdminSeasonTab"));
const AdminEconomyTab = lazy(() => import("./pages/admin/AdminEconomyTab"));
const AdminUsersTab = lazy(() => import("./pages/admin/AdminUsersTab"));
const AdminDataTab = lazy(() => import("./pages/admin/AdminDataTab"));
const AdminSystemTab = lazy(() => import("./pages/admin/AdminSystemTab"));
const AdminWaitlistPage = lazy(() => import("./pages/AdminWaitlistPage"));
const AdminSprintMetricsPage = lazy(() => import("./pages/AdminSprintMetricsPage"));
const AdminAttributionPage = lazy(() => import("./pages/AdminAttributionPage"));
const AdminRetentionPage = lazy(() => import("./pages/AdminRetentionPage"));
const StandingsPage = lazy(() => import("./pages/StandingsPage"));
const BoardPage = lazy(() => import("./pages/BoardPage"));
const RiderStatsPage = lazy(() => import("./pages/RiderStatsPage"));
const TeamProfilePage = lazy(() => import("./pages/TeamProfilePage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const RiderComparePage = lazy(() => import("./pages/RiderComparePage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const WatchlistPage = lazy(() => import("./pages/WatchlistPage"));
const HelpPage = lazy(() => import("./pages/HelpPage"));
const PatchNotesPage = lazy(() => import("./pages/PatchNotesPage"));
const RoadmapPage = lazy(() => import("./pages/RoadmapPage"));
const RulesPage = lazy(() => import("./pages/RulesPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const PrivacyPolicyPageEn = lazy(() => import("./pages/PrivacyPolicyPageEn"));
const FounderSupporterPage = lazy(() => import("./pages/FounderSupporterPage"));
const ProUpgradePage = lazy(() => import("./pages/ProUpgradePage"));
const KitchenSinkPage = lazy(() => import("./pages/KitchenSinkPage"));
const RacesPage = lazy(() => import("./pages/RacesPage"));
const CalendarPage = lazy(() => import("./pages/CalendarPage"));
const StrategyPage = lazy(() => import("./pages/StrategyPage"));
const SeasonEndPage = lazy(() => import("./pages/SeasonEndPage"));
const ResultaterPage = lazy(() => import("./pages/ResultaterPage"));
const RiderRankingsPage = lazy(() => import("./pages/RiderRankingsPage"));
const GlobalRankPage = lazy(() => import("./pages/GlobalRankPage"));
const RaceHistoryPage = lazy(() => import("./pages/RaceHistoryPage"));
const RaceDetailPage = lazy(() => import("./pages/RaceDetailPage"));
const ManagerProfilePage = lazy(() => import("./pages/ManagerProfilePage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const SeasonFinanceReport = lazy(() => import("./pages/SeasonFinanceReport"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const RacePointsPage = lazy(() => import("./pages/RacePointsPage"));
const TrainingPage = lazy(() => import("./pages/TrainingPage"));
const AcademyPage = lazy(() => import("./pages/AcademyPage"));
const KlubPage = lazy(() => import("./pages/KlubPage"));
const ScoutingCentralPage = lazy(() => import("./pages/ScoutingCentralPage"));
const SeasonPlannerPage = lazy(() => import("./pages/SeasonPlannerPage"));
const StaffProfilePage = lazy(() => import("./pages/StaffProfilePage"));

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-cz-body flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProtectedRoute({ children, session }) {
  const location = useLocation();
  // #1347: session === undefined = endnu ukendt (getSession kører). Vis loader frem
  // for straks at redirecte, så en allerede indlogget bruger ikke blinker forbi login.
  // Var tidligere en GLOBAL gate i App; flyttet hertil så de offentlige ruter
  // (landing/login) kan males straks — forudsætning for ren prerender-hydration på "/".
  if (session === undefined) return <LoadingScreen />;
  if (!session) {
    // #2042: bevar deep-link-destinationen så cold trafik der opretter en konto
    // lander på det de kom for, ikke en generisk /dashboard-omvej.
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

// #2042: kontekst-bevidst /login-rute. En logget-ind bruger (eller en der lige har
// oprettet konto / logget ind) sendes til sin oprindelige ?next-destination.
function LoginRoute({ session }) {
  const [params] = useSearchParams();
  if (session) {
    return <Navigate to={safeNextPath(params.get("next")) || "/dashboard"} replace />;
  }
  return <LoginPage />;
}

export default function App() {
  const [session, setSession] = useState(undefined);
  // Client-only mount-flag: holder lazy/analytics-Suspense ude af prerenderens
  // server-render (renderToString kan ikke fuldføre en lazy boundary → React #419).
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate();

  // #2078: en udløbet/ugyldig email-confirm-link redirecter til Site URL ("/")
  // med fejlen i hash'et (#error=access_denied&error_code=otp_expired...) og
  // UDEN session. Uden dette landede brugeren tavst på landing page. Vi fanger
  // fejl-hash'et ved mount, fjerner det fra URL'en (så et refresh ikke gentager
  // det) og sender brugeren til /login med en klar besked + resend-adgang.
  // Kør FØR getSession-effekten så vi ikke blinker forbi landing-flowet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const parsed = parseAuthErrorHash(window.location.hash);
    if (!isExpiredOrDeniedAuthError(parsed)) return;
    // Ryd hash'et (bevar path + query) så beskeden ikke gentages ved refresh og
    // fejl-fragmentet ikke lækker videre i historikken.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    navigate("/login", { replace: true, state: { authLinkError: parsed.errorCode || parsed.error } });
  }, [navigate]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        // #621 item 2 — tag Sentry-events med user.id (UUID, ingen PII) så
        // "Affected users"-counter virker. Initial session-restore-path.
        setSentryUser(session.user?.id);
        logSessionStart();
      }
    }).catch((err) => {
      // #1347 — getSession() kan reject ved offline/network-fejl eller en
      // malformed/udløbet gemt session. Uden denne catch forblev session
      // === undefined og fullscreen-loaderen hang for evigt. Vi falder
      // tilbage til en terminal unauthenticated-state (null) så appen render
      // login-flowet i stedet for at strande på en uendelig spinner.
      console.warn("[auth] initial getSession() fejlede — falder tilbage til unauthenticated", err);
      setSession(null);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      setSession(session);
      if (event === "SIGNED_IN") {
        setSentryUser(session?.user?.id);
        logSessionStart();
      } else if (event === "TOKEN_REFRESHED" && session?.user?.id) {
        // Token-refresh kan ske efter cold-start uden SIGNED_IN — sørg for at
        // user-context aldrig taber sig pga. en refresh.
        setSentryUser(session.user.id);
      } else if (event === "SIGNED_OUT") {
        clearSentryUser();
      }
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    setMounted(true);
  }, []);

  // Ingen global session-gate længere: offentlige ruter (/, /login, ...) renderer
  // straks (session === undefined → falsy → landing/login). Beskyttede ruter venter
  // på session i ProtectedRoute. Forudsætning for at den prerendrede landing kan
  // hydreres rent — klientens første render på "/" giver LandingPage.
  return (
    // Routeren leveres af entry'et (BrowserRouter i main.jsx, StaticRouter i
    // entry-server.jsx). #969 v7_startTransition bor nu på den BrowserRouter.
    <>
      {/* Analytics + traffic-beacon er client-only (consent/browser-API'er) og lazy.
          Mount FØRST efter hydration, så de ikke indgår i prerenderens server-render
          — en lazy Suspense-boundary kan ikke fuldføres på serveren → React #419. */}
      {mounted && (
        <Suspense fallback={null}>
          <ClarityIntegration />
          <WebVitalsIntegration />
          <VercelAnalyticsIntegration />
          <GaIntegration />
          <TrafficBeacon session={session} />
        </Suspense>
      )}
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginRoute session={session} />} />
          <Route path="/reset-password" element={<ResetPasswordPage session={session} />} />
          <Route path="/privatlivspolitik" element={<PrivacyPolicyPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPageEn />} />
          <Route path="/founder-supporter" element={<FounderSupporterPage />} />
          <Route path="/ui" element={<KitchenSinkPage />} />
          {/* Bart domæne (#672): ikke-loggede-ind ser den offentlige landing,
              loggede-ind ryger til appen. */}
          <Route path="/" element={session ? <Navigate to="/dashboard" replace /> : <LandingPage />} />

          {/* App-flader: pathless protected layout-route — URL'erne (/dashboard, /riders ...)
              er uændrede, men "/" er ikke længere forælder, så landing kan eje roden. */}
          <Route element={
            <ProtectedRoute session={session}><Layout /></ProtectedRoute>
          }>
            <Route path="dashboard" element={<DashboardPage />} />
            <Route path="riders" element={<RidersPage />} />
            <Route path="riders/:id" element={<RiderStatsPage />} />
            <Route path="staff/:id" element={<StaffProfilePage />} />
            <Route path="auctions" element={<AuctionsPage />} />
            <Route path="auctions/history" element={<AuctionHistoryPage />} />
            <Route path="transfers" element={<TransfersPage />} />
            <Route path="team" element={<TeamPage />} />
            {/* #1609: Teams/H2H/Season-Preview konsolideret ind i Standings-hub'en.
                Bevarer dybe links via redirect (eget hold som Compare-A på H2H). */}
            <Route path="teams" element={<Navigate to="/standings" replace />} />
            <Route path="teams/:id" element={<TeamProfilePage />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="compare" element={<RiderComparePage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="pro" element={<ProUpgradePage />} />
            <Route path="pro/success" element={<ProUpgradePage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="activity-feed" element={<Navigate to="/notifications" replace />} />
            <Route path="watchlist" element={<WatchlistPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="rules" element={<RulesPage />} />
            {/* #2359: HoF-fladen afløses af verdenshistorik (S3); route redirecter, side-kode
                bevares indtil narrativ-fladen erstatter den — se HallOfFamePage.jsx. */}
            <Route path="hall-of-fame" element={<Navigate to="/standings" replace />} />
            <Route path="season-preview" element={<Navigate to="/standings?view=strength" replace />} />
            <Route path="head-to-head" element={<Navigate to="/standings?compare=1" replace />} />
            <Route path="patch-notes" element={<PatchNotesPage />} />
            <Route path="roadmap" element={<RoadmapPage />} />
            <Route path="races" element={<RacesPage />} />
            <Route path="races/strategy" element={<StrategyPage />} />
            <Route path="races/:raceId" element={<RaceDetailPage />} />
            <Route path="seasons" element={<SeasonEndPage />} />
            <Route path="seasons/:seasonId" element={<SeasonEndPage />} />
            <Route path="season-end" element={<Navigate to="/seasons" replace />} />
            <Route path="resultater" element={<ResultaterPage />} />
            <Route path="calendar" element={<CalendarPage />} />
            <Route path="rider-rankings" element={<RiderRankingsPage />} />
            <Route path="global-rank" element={<GlobalRankPage />} />
            <Route path="race-archive" element={<Navigate to="/races?tab=library" replace />} />
            <Route path="race-archive/:raceSlug" element={<RaceHistoryPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="seasons/:seasonId/finance/:teamId" element={<SeasonFinanceReport />} />
            <Route path="race-points" element={<RacePointsPage />} />
            <Route path="managers/:teamId" element={<ManagerProfilePage />} />
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="season" replace />} />
              <Route path="season"  element={<AdminSeasonTab />} />
              <Route path="economy" element={<AdminEconomyTab />} />
              <Route path="users"   element={<AdminUsersTab />} />
              <Route path="data"    element={<AdminDataTab />} />
              <Route path="system"  element={<AdminSystemTab />} />
              <Route path="*"       element={<Navigate to="season" replace />} />
            </Route>
            <Route path="admin/waitlist" element={<AdminWaitlistPage />} />
            <Route path="admin/sprint-metrics" element={<AdminSprintMetricsPage />} />
            <Route path="admin/attribution" element={<AdminAttributionPage />} />
            <Route path="admin/retention" element={<AdminRetentionPage />} />
            <Route path="training" element={<TrainingPage />} />
            <Route path="planner" element={<SeasonPlannerPage />} />
            <Route path="academy" element={<AcademyPage />} />
            <Route path="klub" element={<KlubPage />} />
            <Route path="scouting" element={<ScoutingCentralPage />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
      <CookieBanner />
    </>
  );
}
