import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { Suspense, useEffect, useState } from "react";
// #881: lazyWithRetry erstatter React.lazy så stale-chunk-fejl efter deploy bliver
// recoverable (retry + genkendelig ChunkLoadError -> auto-reload via SentryBoundary).
import { lazyWithRetry as lazy } from "./lib/lazyWithRetry.js";
import { supabase } from "./lib/supabase";
import CookieBanner from "./components/CookieBanner.jsx";
import { logEvent } from "./lib/logEvent";
import { setSentryUser, clearSentryUser } from "./lib/sentry.jsx";

// Layout + analytics integrations lazy-loaded for #479: public routes
// (/founder-supporter, /login, /privacy-*) ikke betaler for app-shell + Clarity/Vercel
// SDK'er i main-bundlen. Analytics-komponenterne er allerede consent-gated så ingen
// netværkskald før samtykke; lazy-load tager dem også ud af cold-start payload.
const Layout = lazy(() => import("./components/Layout"));
const ClarityIntegration = lazy(() => import("./lib/clarityIntegration.jsx"));
const SpeedInsightsIntegration = lazy(() => import("./lib/speedInsightsIntegration.jsx"));
const VercelAnalyticsIntegration = lazy(() => import("./lib/vercelAnalyticsIntegration.jsx"));
const GaIntegration = lazy(() => import("./lib/gaIntegration.jsx"));

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
const StandingsPage = lazy(() => import("./pages/StandingsPage"));
const BoardPage = lazy(() => import("./pages/BoardPage"));
const RiderStatsPage = lazy(() => import("./pages/RiderStatsPage"));
const TeamProfilePage = lazy(() => import("./pages/TeamProfilePage"));
const TeamsPage = lazy(() => import("./pages/TeamsPage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const RiderComparePage = lazy(() => import("./pages/RiderComparePage"));
const ActivityPage = lazy(() => import("./pages/ActivityPage"));
const WatchlistPage = lazy(() => import("./pages/WatchlistPage"));
const HelpPage = lazy(() => import("./pages/HelpPage"));
const HallOfFamePage = lazy(() => import("./pages/HallOfFamePage"));
const SeasonPreviewPage = lazy(() => import("./pages/SeasonPreviewPage"));
const HeadToHeadPage = lazy(() => import("./pages/HeadToHeadPage"));
const PatchNotesPage = lazy(() => import("./pages/PatchNotesPage"));
const RoadmapPage = lazy(() => import("./pages/RoadmapPage"));
const RulesPage = lazy(() => import("./pages/RulesPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const PrivacyPolicyPageEn = lazy(() => import("./pages/PrivacyPolicyPageEn"));
const FounderSupporterPage = lazy(() => import("./pages/FounderSupporterPage"));
const LandingPage = lazy(() => import("./pages/LandingPage"));
const KitchenSinkPage = lazy(() => import("./pages/KitchenSinkPage"));
const RacesPage = lazy(() => import("./pages/RacesPage"));
const SeasonEndPage = lazy(() => import("./pages/SeasonEndPage"));
const ResultaterPage = lazy(() => import("./pages/ResultaterPage"));
const RiderRankingsPage = lazy(() => import("./pages/RiderRankingsPage"));
const RaceHistoryPage = lazy(() => import("./pages/RaceHistoryPage"));
const RaceDetailPage = lazy(() => import("./pages/RaceDetailPage"));
const ManagerProfilePage = lazy(() => import("./pages/ManagerProfilePage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const SeasonFinanceReport = lazy(() => import("./pages/SeasonFinanceReport"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const RacePointsPage = lazy(() => import("./pages/RacePointsPage"));
const DeadlineDayBoard = lazy(() => import("./pages/DeadlineDayBoard"));
const TrainingPage = lazy(() => import("./pages/TrainingPage"));
const AcademyPage = lazy(() => import("./pages/AcademyPage"));

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
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        // #621 item 2 — tag Sentry-events med user.id (UUID, ingen PII) så
        // "Affected users"-counter virker. Initial session-restore-path.
        setSentryUser(session.user?.id);
        logEvent("session_started");
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
        logEvent("session_started");
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

  if (session === undefined) {
    return <LoadingScreen />;
  }

  return (
    // #969: v7_startTransition wrapper alle router-state-opdateringer i React.startTransition,
    // så sidebar-klik ikke blokerer paint mens destinationssidens første render kører
    // (INP 248ms -> klik-respons males straks, tung render bliver interruptible).
    // Kræver at alle lazy()-kald ligger på module-scope — verificeret 2026-06-10.
    <BrowserRouter future={{ v7_startTransition: true }}>
      <Suspense fallback={null}>
        <ClarityIntegration />
        <SpeedInsightsIntegration />
        <VercelAnalyticsIntegration />
        <GaIntegration />
      </Suspense>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={session ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
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
            <Route path="auctions" element={<AuctionsPage />} />
            <Route path="auctions/history" element={<AuctionHistoryPage />} />
            <Route path="transfers" element={<TransfersPage />} />
            <Route path="team" element={<TeamPage />} />
            <Route path="teams" element={<TeamsPage />} />
            <Route path="teams/:id" element={<TeamProfilePage />} />
            <Route path="standings" element={<StandingsPage />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="compare" element={<RiderComparePage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="activity" element={<ActivityPage />} />
            <Route path="activity-feed" element={<Navigate to="/notifications" replace />} />
            <Route path="watchlist" element={<WatchlistPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="rules" element={<RulesPage />} />
            <Route path="hall-of-fame" element={<HallOfFamePage />} />
            <Route path="season-preview" element={<SeasonPreviewPage />} />
            <Route path="head-to-head" element={<HeadToHeadPage />} />
            <Route path="patch-notes" element={<PatchNotesPage />} />
            <Route path="roadmap" element={<RoadmapPage />} />
            <Route path="races" element={<RacesPage />} />
            <Route path="races/:raceId" element={<RaceDetailPage />} />
            <Route path="seasons" element={<SeasonEndPage />} />
            <Route path="seasons/:seasonId" element={<SeasonEndPage />} />
            <Route path="season-end" element={<Navigate to="/seasons" replace />} />
            <Route path="resultater" element={<ResultaterPage />} />
            <Route path="rider-rankings" element={<RiderRankingsPage />} />
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
            <Route path="training" element={<TrainingPage />} />
            <Route path="academy" element={<AcademyPage />} />
            <Route path="deadline-day" element={<DeadlineDayBoard />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
      <CookieBanner />
    </BrowserRouter>
  );
}
