import { Outlet, NavLink, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase, signOut } from "../lib/supabase";

const NAV = [
  { to: "/", label: "Dashboard", icon: "⬡" },
  { to: "/riders", label: "Ryttere", icon: "🚴" },
  { to: "/auctions", label: "Auktioner", icon: "⚡" },
  { to: "/transfers", label: "Transfers", icon: "↔" },
  { to: "/team", label: "Mit Hold", icon: "◈" },
  { to: "/standings", label: "Rangliste", icon: "◉" },
  { to: "/teams", label: "Hold", icon: "◫" },
  { to: "/board", label: "Bestyrelse", icon: "◧" },
  { to: "/notifications", label: "Notifikationer", icon: "🔔" },
];

export default function Layout({ session }) {
  const navigate = useNavigate();
  const [notifications, setNotifications] = useState([]);
  const [showNotif, setShowNotif] = useState(false);
  const [teamName, setTeamName] = useState("");
  const [balance, setBalance] = useState(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);

  useEffect(() => {
    loadTeamData();
    loadNotifications();
    const channel = supabase.channel("notifs")
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "notifications",
        filter: `user_id=eq.${session.user.id}` },
        (payload) => setNotifications(prev => [payload.new, ...prev]))
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, []);

  async function loadTeamData() {
    const { data: team } = await supabase.from("teams").select("name, balance").eq("user_id", session.user.id).single();
    if (team) { setTeamName(team.name); setBalance(team.balance); }
    const { data: u } = await supabase.from("users").select("role").eq("id", session.user.id).single();
    if (u?.role === "admin") setIsAdmin(true);
  }

  async function loadNotifications() {
    const { data } = await supabase.from("notifications").select("*")
      .eq("user_id", session.user.id).eq("is_read", false)
      .order("created_at", { ascending: false }).limit(10);
    setNotifications(data || []);
  }

  async function markAllRead() {
    await supabase.from("notifications").update({ is_read: true }).eq("user_id", session.user.id);
    setNotifications([]);
    setShowNotif(false);
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] text-white flex">
      <aside className={`fixed inset-y-0 left-0 z-40 w-60 bg-[#0f0f18] border-r border-white/5
        transform transition-transform duration-200 ${mobileOpen ? "translate-x-0" : "-translate-x-full"} lg:translate-x-0`}>
        <div className="px-6 py-6 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-[#e8c547] flex items-center justify-center">
              <span className="text-[#0a0a0f] font-black text-lg">C</span>
            </div>
            <div>
              <p className="font-bold text-white text-sm tracking-wide">CYCLING</p>
              <p className="text-[#e8c547] text-xs font-medium tracking-widest uppercase">Manager</p>
            </div>
          </div>
        </div>
        {teamName && (
          <div className="px-6 py-4 border-b border-white/5">
            <p className="text-white/40 text-xs uppercase tracking-widest mb-1">Dit Hold</p>
            <p className="text-white font-semibold text-sm truncate">{teamName}</p>
            {balance !== null && (
              <p className="text-[#e8c547] font-mono text-sm mt-1">{balance.toLocaleString("da-DK")} CZ$</p>
            )}
          </div>
        )}
        <nav className="px-3 py-4 flex flex-col gap-1">
          {NAV.map(({ to, label, icon }) => (
            <NavLink key={to} to={to} end={to === "/"} onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150
                ${isActive ? "bg-[#e8c547]/10 text-[#e8c547] border border-[#e8c547]/20" : "text-white/50 hover:text-white hover:bg-white/5"}`}>
              <span className="text-base w-5 text-center">{icon}</span>{label}
            </NavLink>
          ))}
          {isAdmin && (
            <NavLink to="/admin" onClick={() => setMobileOpen(false)}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all mt-4
                ${isActive ? "bg-red-500/10 text-red-400 border border-red-500/20" : "text-red-400/40 hover:text-red-400 hover:bg-red-500/5"}`}>
              <span className="text-base w-5 text-center">⚙</span>Admin
            </NavLink>
          )}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 px-3 pb-4">
          <button onClick={async () => { await signOut(); navigate("/login"); }}
            className="w-full flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm text-white/30 hover:text-white/60 hover:bg-white/5 transition-all">
            <span className="w-5 text-center">→</span>Log ud
          </button>
        </div>
      </aside>

      {mobileOpen && <div className="fixed inset-0 z-30 bg-black/60 lg:hidden" onClick={() => setMobileOpen(false)} />}

      <div className="flex-1 lg:ml-60 flex flex-col min-h-screen">
        <header className="sticky top-0 z-20 bg-[#0a0a0f]/90 backdrop-blur border-b border-white/5 px-4 lg:px-6 h-14 flex items-center justify-between">
          <button className="lg:hidden text-white/60 hover:text-white" onClick={() => setMobileOpen(true)}>☰</button>
          <div className="flex items-center gap-3 ml-auto">
            <div className="relative">
              <Link to="/notifications"
                className="relative w-9 h-9 rounded-lg flex items-center justify-center text-white/50 hover:text-white hover:bg-white/5 transition-all">
                🔔
                {notifications.length > 0 && (
                  <span className="absolute top-1 right-1 w-4 h-4 bg-[#e8c547] rounded-full text-[#0a0a0f] text-[10px] font-bold flex items-center justify-center">
                    {notifications.length > 9 ? "9+" : notifications.length}
                  </span>
                )}
              </Link>

            </div>
            <div className="h-7 w-px bg-white/10" />
            <span className="text-white/40 text-sm hidden sm:block">{session.user.email}</span>
          </div>
        </header>
        <main className="flex-1 p-4 lg:p-6"><Outlet /></main>
      </div>
    </div>
  );
}
