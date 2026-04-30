import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { lazy, Suspense, useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import Layout from "./components/Layout";

const LoginPage = lazy(() => import("./pages/LoginPage"));
const ResetPasswordPage = lazy(() => import("./pages/ResetPasswordPage"));
const DashboardPage = lazy(() => import("./pages/DashboardPage"));
const RidersPage = lazy(() => import("./pages/RidersPage"));
const AuctionsPage = lazy(() => import("./pages/AuctionsPage"));
const AuctionHistoryPage = lazy(() => import("./pages/AuctionHistoryPage"));
const TransfersPage = lazy(() => import("./pages/TransfersPage"));
const TeamPage = lazy(() => import("./pages/TeamPage"));
const AdminPage = lazy(() => import("./pages/AdminPage"));
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
const RacesPage = lazy(() => import("./pages/RacesPage"));
const SeasonEndPage = lazy(() => import("./pages/SeasonEndPage"));
const ResultaterPage = lazy(() => import("./pages/ResultaterPage"));
const RiderRankingsPage = lazy(() => import("./pages/RiderRankingsPage"));
const RaceArchivePage = lazy(() => import("./pages/RaceArchivePage"));
const RaceHistoryPage = lazy(() => import("./pages/RaceHistoryPage"));
const ManagerProfilePage = lazy(() => import("./pages/ManagerProfilePage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));

function LoadingScreen() {
  return (
    <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
      <div className="w-8 h-8 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function RouteFallback() {
  return (
    <div className="min-h-[50vh] flex items-center justify-center">
      <div className="w-7 h-7 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
    </div>
  );
}

function ProfileRedirect() {
  const [to, setTo] = useState(null);
  useEffect(() => {
    supabase.auth.getUser().then(({ data: { user } }) => {
      if (!user) {
        setTo("/dashboard");
        return;
      }
      supabase
        .from("teams")
        .select("id")
        .eq("user_id", user.id)
        .single()
        .then(({ data }) => {
          setTo(data?.id ? `/managers/${data.id}` : "/dashboard");
        });
    });
  }, []);
  if (!to) return null;
  return <Navigate to={to} replace />;
}

function ProtectedRoute({ children, session }) {
  if (!session) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  const [session, setSession] = useState(undefined);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => setSession(session));
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_, session) => setSession(session));
    return () => subscription.unsubscribe();
  }, []);

  if (session === undefined) {
    return <LoadingScreen />;
  }

  return (
    <BrowserRouter>
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={session ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage session={session} />} />
          <Route path="/" element={
            <ProtectedRoute session={session}><Layout /></ProtectedRoute>
          }>
            <Route index element={<Navigate to="/dashboard" replace />} />

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
            <Route path="hall-of-fame" element={<HallOfFamePage />} />
            <Route path="season-preview" element={<SeasonPreviewPage />} />
            <Route path="head-to-head" element={<HeadToHeadPage />} />
            <Route path="patch-notes" element={<PatchNotesPage />} />
            <Route path="races" element={<RacesPage />} />
            <Route path="season-end" element={<SeasonEndPage />} />
            <Route path="resultater" element={<ResultaterPage />} />
            <Route path="rider-rankings" element={<RiderRankingsPage />} />
            <Route path="race-archive" element={<RaceArchivePage />} />
            <Route path="race-archive/:raceSlug" element={<RaceHistoryPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="managers/:teamId" element={<ManagerProfilePage />} />
            <Route path="admin" element={<AdminPage />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
    </BrowserRouter>
  );
}
