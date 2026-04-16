import { Outlet, NavLink, useNavigate, Link } from "react-router-dom";
import { useState, useEffect } from "react";
import { supabase, signOut } from "../lib/supabase";

const NAV = [
  { to: "/dashboard",      label: "Dashboard",       icon: "◎" },
  { to: "/riders",         label: "Ryttere",          icon: "🚴" },
  { to: "/auctions",       label: "Auktioner",        icon: "⚡" },
  { to: "/transfers",      label: "Transfers",        icon: "↔" },
  { to: "/team",           label: "Mit Hold",         icon: "◈" },
  { to: "/teams",          label: "Hold",             icon: "◫" },
  { to: "/standings",      label: "Rangliste",        icon: "◉" },
  { to: "/board",          label: "Bestyrelse",       icon: "◧" },
  { to: "/notifications",  label: "Notifikationer",   icon: "🔔" },
];

const MOBILE_NAV = [
  { to: "/dashboard",  label: "Hjem",       icon: "◎" },
  { to: "/riders",     label: "Ryttere",    icon: "🚴" },
  { to: "/auctions",   label: "Auktioner",  icon: "⚡" },
  { to: "/transfers",  label: "Transfers",  icon: "↔" },
  { to: "/team",       label: "Mit Hold",   icon: "◈" },
];

export default function Layout({ isAdmin }) {
  const navigate = useNavigate();
  const [session, setSession] = useState(null);
  const [teamName, setTeamName] = useState("");
  const [balance, setBalance] = useState(null);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [isAdmin_, setIsAdmin_] = useState(false);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) loadTeam(session.user.id);
    });
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_e, session) => {
      setSession(session);
      if (session) loadTeam(session.user.id);
    });
    return () => subscription.unsubscribe();
  }, []);

  async function loadTeam(userId) {
    const { data: team } = await supabase.from("teams").select("name, balance").eq("user_id", userId).single();
    if (team) { setTeamName(team.name); setBalance(team.balance); }
    const { data: u } = await supabase.from("users").select("role").eq("id", userId).single();
    if (u?.role === "admin") setIsAdmin_(true);
    const { data: notifs } = await supabase.from("notifications")
      .select("id").eq("user_id", userId).eq("is_read", false).limit(9);
    setNotifications(notifs || []);
  }

  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel("layout-notifs")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications",
        filter: `user_id=eq.${session.user.id}` },
        async () => {
          const { data } = await supabase.from("notifications")
            .select("id").eq("user_id", session.user.id).eq("is_read", false).limit(9);
          setNotifications(data || []);
          // Refresh balance
          const { data: t } = await supabase.from("teams").select("balance").eq("user_id", session.user.id).single();
          if (t) setBalance(t.balance);
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  if (!session) return <Outlet />;

  const navItems = isAdmin_ ? [...NAV, { to: "/admin", label: "Admin", icon: "⚙" }] : NAV;
  const unread = notifications.length;

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex">
      {/* Desktop sidebar */}
      <aside className="hidden lg:flex flex-col w-56 bg-[#0d0d16] border-r border-white/5 fixed h-full z-20">
        {/* Logo */}
        <div className="px-5 py-5 border-b border-white/5">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-[#e8c547] flex items-center justify-center flex-shrink-0">
              <span className="text-[#0a0a0f] font-black text-xs">CZ</span>
            </div>
            <div>
              <p className="text-white font-bold text-sm">Cycling Zone</p>
              <p className="text-[#e8c547] font-mono text-xs">{balance?.toLocaleString("da-DK")} CZ$</p>
            </div>
          </div>
          {teamName && <p className="text-white/30 text-xs mt-1 truncate">{teamName}</p>}
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 overflow-y-auto">
          {navItems.map(({ to, label, icon }) => (
            <NavLink key={to} to={to}
              className={({ isActive }) =>
                `flex items-center gap-3 px-3 py-2 rounded-lg text-sm mb-0.5 transition-all
                ${isActive
                  ? "bg-[#e8c547]/10 text-[#e8c547]"
                  : "text-white/40 hover:text-white hover:bg-white/5"}`}>
              <span className="text-base">{icon}</span>
              <span>{label}</span>
              {to === "/notifications" && unread > 0 && (
                <span className="ml-auto w-5 h-5 bg-[#e8c547] rounded-full text-[#0a0a0f] text-[10px] font-bold flex items-center justify-center">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </NavLink>
          ))}
        </nav>

        {/* Sign out */}
        <div className="px-3 py-4 border-t border-white/5">
          <button onClick={async () => { await signOut(); navigate("/login"); }}
            className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/30
              hover:text-white hover:bg-white/5 transition-all w-full">
            <span>→</span><span>Log ud</span>
          </button>
        </div>
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <div className="absolute left-0 top-0 bottom-0 w-64 bg-[#0d0d16] border-r border-white/5 flex flex-col">
            <div className="px-5 py-5 border-b border-white/5 flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg bg-[#e8c547] flex items-center justify-center">
                  <span className="text-[#0a0a0f] font-black text-xs">CZ</span>
                </div>
                <div>
                  <p className="text-white font-bold text-sm">Cycling Zone</p>
                  <p className="text-[#e8c547] font-mono text-xs">{balance?.toLocaleString("da-DK")} CZ$</p>
                </div>
              </div>
              <button onClick={() => setMobileOpen(false)} className="text-white/40 hover:text-white text-xl">×</button>
            </div>
            <nav className="flex-1 px-3 py-4 overflow-y-auto">
              {navItems.map(({ to, label, icon }) => (
                <NavLink key={to} to={to} onClick={() => setMobileOpen(false)}
                  className={({ isActive }) =>
                    `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm mb-0.5 transition-all
                    ${isActive ? "bg-[#e8c547]/10 text-[#e8c547]" : "text-white/50 hover:text-white hover:bg-white/5"}`}>
                  <span className="text-base w-5">{icon}</span>
                  <span>{label}</span>
                  {to === "/notifications" && unread > 0 && (
                    <span className="ml-auto w-5 h-5 bg-[#e8c547] rounded-full text-[#0a0a0f] text-[10px] font-bold flex items-center justify-center">
                      {unread > 9 ? "9+" : unread}
                    </span>
                  )}
                </NavLink>
              ))}
            </nav>
            <div className="px-3 py-4 border-t border-white/5">
              <button onClick={async () => { await signOut(); navigate("/login"); setMobileOpen(false); }}
                className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-white/30 hover:text-white hover:bg-white/5 w-full">
                <span>→</span><span>Log ud</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main content */}
      <div className="flex-1 lg:ml-56 flex flex-col min-h-screen">
        {/* Mobile top bar */}
        <header className="lg:hidden flex items-center px-4 py-3 bg-[#0d0d16] border-b border-white/5 sticky top-0 z-10">
          <button onClick={() => setMobileOpen(true)} className="text-white/60 hover:text-white mr-3">☰</button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 rounded bg-[#e8c547] flex items-center justify-center">
              <span className="text-[#0a0a0f] font-black text-[9px]">CZ</span>
            </div>
            <span className="text-white font-bold text-sm">Cycling Zone</span>
          </div>
          <div className="ml-auto flex items-center gap-2">
            <span className="text-[#e8c547] font-mono text-xs">{balance?.toLocaleString("da-DK")} CZ$</span>
            <Link to="/notifications" className="relative w-8 h-8 flex items-center justify-center text-white/50 hover:text-white">
              🔔
              {unread > 0 && (
                <span className="absolute top-0.5 right-0.5 w-4 h-4 bg-[#e8c547] rounded-full text-[#0a0a0f] text-[9px] font-bold flex items-center justify-center">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </Link>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 p-4 lg:p-6 pb-24 lg:pb-6">
          <Outlet />
        </main>

        {/* Mobile bottom navigation */}
        <nav className="lg:hidden fixed bottom-0 left-0 right-0 bg-[#0d0d16] border-t border-white/8 z-10">
          <div className="flex">
            {MOBILE_NAV.map(({ to, label, icon }) => (
              <NavLink key={to} to={to}
                className={({ isActive }) =>
                  `flex-1 flex flex-col items-center justify-center py-2.5 text-xs transition-all
                  ${isActive ? "text-[#e8c547]" : "text-white/30 hover:text-white/60"}`}>
                <span className="text-lg mb-0.5">{icon}</span>
                <span className="text-[9px] uppercase tracking-wider">{label}</span>
              </NavLink>
            ))}
            <button onClick={() => setMobileOpen(true)}
              className="flex-1 flex flex-col items-center justify-center py-2.5 text-xs text-white/30 hover:text-white/60">
              <span className="text-lg mb-0.5">☰</span>
              <span className="text-[9px] uppercase tracking-wider">Mere</span>
            </button>
          </div>
        </nav>
      </div>
    </div>
  );
}
