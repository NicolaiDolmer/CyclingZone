import { BrowserRouter, Routes, Route, Navigate } from "react-router-dom";
import { useEffect, useState } from "react";
import { supabase } from "./lib/supabase";
import LoginPage from "./pages/LoginPage";
import DashboardPage from "./pages/DashboardPage";
import RidersPage from "./pages/RidersPage";
import AuctionsPage from "./pages/AuctionsPage";
import AuctionHistoryPage from "./pages/AuctionHistoryPage";
import TransfersPage from "./pages/TransfersPage";
import TeamPage from "./pages/TeamPage";
import AdminPage from "./pages/AdminPage";
import StandingsPage from "./pages/StandingsPage";
import BoardPage from "./pages/BoardPage";
import RiderStatsPage from "./pages/RiderStatsPage";
import TeamProfilePage from "./pages/TeamProfilePage";
import TeamsPage from "./pages/TeamsPage";
import NotificationsPage from "./pages/NotificationsPage";
import RiderComparePage from "./pages/RiderComparePage";
import ProfilePage from "./pages/ProfilePage";
import Layout from "./components/Layout";

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
    return (
      <div className="min-h-screen bg-[#0a0a0f] flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-[#e8c547] border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={session ? <Navigate to="/dashboard" replace /> : <LoginPage />} />
        <Route path="/" element={
          <ProtectedRoute session={session}><Layout /></ProtectedRoute>
        }>
          {/* Redirect root to dashboard */}
          <Route index element={<Navigate to="/dashboard" replace />} />

          {/* Main pages */}
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
          <Route path="admin" element={<AdminPage />} />

          {/* 404 fallback */}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Route>

        {/* Global 404 fallback */}
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
