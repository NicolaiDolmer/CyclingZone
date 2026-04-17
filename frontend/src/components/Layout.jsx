import { useState, useEffect } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";

const NAV_GROUPS = [
  {
    key: "overblik",
    label: "Overblik",
    icon: "◎",
    items: [
      { to: "/dashboard",      label: "Dashboard",      icon: "◎" },
      { to: "/standings",      label: "Rangliste",      icon: "◉" },
      { to: "/races",          label: "Løbskalender",   icon: "🏁" },
      { to: "/season-preview", label: "Sæson Preview",  icon: "📊" },
      { to: "/hall-of-fame",   label: "Hall of Fame",   icon: "🏆" },
      { to: "/season-end",     label: "Sæsonresultater",icon: "🏆" },
    ],
  },
  {
    key: "marked",
    label: "Marked",
    icon: "⚡",
    items: [
      { to: "/riders",    label: "Ryttere",    icon: "🚴" },
      { to: "/auctions",  label: "Auktioner",  icon: "⚡" },
      { to: "/transfers", label: "Transfers",  icon: "↔" },
    ],
  },
  {
    key: "mithold",
    label: "Mit Hold",
    icon: "◈",
    items: [
      { to: "/team",       label: "Mit Hold",      icon: "◈" },
      { to: "/board",      label: "Bestyrelse",    icon: "◧" },
      { to: "/watchlist",  label: "Talentspejder", icon: "⭐" },
      { to: "/activity",   label: "Min Aktivitet", icon: "📋" },
    ],
  },
  {
    key: "liga",
    label: "Liga",
    icon: "◫",
    items: [
      { to: "/teams",       label: "Hold",        icon: "◫" },
      { to: "/head-to-head", label: "Head-to-Head", icon: "⚔" },
    ],
  },
];

const BOTTOM_ITEMS = [
  { to: "/notifications", label: "Notifikationer", icon: "🔔" },
  { to: "/help",          label: "Hjælp & Regler", icon: "?" },
  { to: "/patch-notes",   label: "Patch Notes",    icon: "📋" },
  { to: "/profile",       label: "Min Profil",     icon: "👤" },
];

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession] = useState(null);
  const [team, setTeam] = useState(null);
  const [balance, setBalance] = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [isAdmin, setIsAdmin] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [openGroups, setOpenGroups] = useState({});

  // Auto-open the group containing the current route
  useEffect(() => {
    const path = location.pathname;
    const activeGroup = NAV_GROUPS.find(g => g.items.some(i => path.startsWith(i.to)));
    if (activeGroup) {
      setOpenGroups(prev => ({ ...prev, [activeGroup.key]: true }));
    }
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      setSession(session);
      const { data: userData } = await supabase.from("users")
        .select("role, username").eq("id", session.user.id).single();
      setIsAdmin(userData?.role === "admin");

      const { data: teamData } = await supabase.from("teams")
        .select("id, name, balance, division").eq("user_id", session.user.id).single();
      if (teamData) { setTeam(teamData); setBalance(teamData.balance); }

      const { data: notifs } = await supabase.from("notifications")
        .select("id").eq("user_id", session.user.id).eq("is_read", false).limit(9);
      setNotifications(notifs || []);
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel("layout-notifs-v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications",
        filter: `user_id=eq.${session.user.id}` },
        async () => {
          const { data } = await supabase.from("notifications")
            .select("id").eq("user_id", session.user.id).eq("is_read", false).limit(9);
          setNotifications(data || []);
          const { data: t } = await supabase.from("teams")
            .select("balance").eq("user_id", session.user.id).single();
          if (t) setBalance(t.balance);
        })
      .subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  function toggleGroup(key) {
    setOpenGroups(prev => ({ ...prev, [key]: !prev[key] }));
  }

  const unread = notifications.length;
  const navGroups = isAdmin
    ? [...NAV_GROUPS, { key: "admin", label: "Admin", icon: "⚙", items: [{ to: "/admin", label: "Admin", icon: "⚙" }] }]
    : NAV_GROUPS;

  function NavItem({ to, label, icon, onClick }) {
    const isActive = location.pathname === to || (to !== "/dashboard" && location.pathname.startsWith(to));
    const showBadge = to === "/notifications" && unread > 0;
    return (
      <NavLink to={to}
        onClick={onClick}
        className={`flex items-center gap-2.5 px-4 py-2 text-sm transition-all
          ${isActive
            ? "text-[#e8c547] bg-[#e8c547]/8"
            : "text-white/40 hover:text-white hover:bg-white/4"}`}>
        <span className="w-4 text-center text-xs flex-shrink-0">{icon}</span>
        <span className="flex-1">{label}</span>
        {showBadge && (
          <span className="bg-[#e8c547] text-[#0a0a0f] text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </NavLink>
    );
  }

  function SidebarContent({ onNav }) {
    return (
      <div className="flex flex-col h-full">
        {/* Logo */}
        <div className="flex items-center gap-2.5 px-4 py-4 border-b border-white/5">
          <div className="w-7 h-7 bg-[#e8c547] rounded-md flex items-center justify-center
            text-[10px] font-black text-[#0a0a0f] flex-shrink-0">CZ</div>
          <div className="min-w-0">
            <p className="text-white text-xs font-bold leading-tight">Cycling Zone</p>
            <p className="text-white/30 text-[10px] truncate">{team?.name || "..."}</p>
          </div>
        </div>

        {/* Balance */}
        {balance !== null && (
          <div className="px-4 py-2.5 border-b border-white/5">
            <p className="text-[9px] text-white/25 uppercase tracking-wider">Balance</p>
            <p className="text-[#e8c547] font-mono font-bold text-sm">
              {balance.toLocaleString("da-DK")} CZ$
            </p>
            {team && (
              <p className="text-white/25 text-[10px]">Division {team.division}</p>
            )}
          </div>
        )}

        {/* Grouped nav */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navGroups.map(group => {
            const isOpen = openGroups[group.key];
            const hasActive = group.items.some(i =>
              location.pathname === i.to ||
              (i.to !== "/dashboard" && location.pathname.startsWith(i.to))
            );
            return (
              <div key={group.key}>
                <button
                  onClick={() => toggleGroup(group.key)}
                  className={`w-full flex items-center justify-between px-4 py-2 text-xs
                    font-semibold uppercase tracking-wider transition-all
                    ${hasActive ? "text-white/70" : "text-white/25 hover:text-white/50"}`}>
                  <span className="flex items-center gap-2">
                    <span>{group.icon}</span>
                    <span>{group.label}</span>
                  </span>
                  <span className={`text-[8px] transition-transform duration-200
                    ${isOpen ? "rotate-180" : ""}`}>▾</span>
                </button>
                {isOpen && (
                  <div className="mb-1">
                    {group.items.map(item => (
                      <NavItem key={item.to} {...item} onClick={onNav} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Divider */}
          <div className="h-px bg-white/5 my-2 mx-4" />

          {/* Bottom items */}
          {BOTTOM_ITEMS.map(item => (
            <NavItem key={item.to} {...item} onClick={onNav} />
          ))}
        </nav>

        {/* Sign out */}
        <div className="border-t border-white/5 p-3">
          <button onClick={signOut}
            className="w-full text-xs text-white/25 hover:text-white/50 py-2 transition-colors text-left px-1">
            ← Log ud
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#0a0a0f] flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-52 flex-shrink-0
        bg-[#0a0a14] border-r border-white/5 fixed top-0 left-0 h-full z-30">
        <SidebarContent onNav={() => {}} />
      </aside>

      {/* Mobile overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/70" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-52 bg-[#0a0a14] border-r border-white/5 z-50">
            <SidebarContent onNav={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:ml-52 min-h-screen">
        {/* Mobile top bar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3
          bg-[#0a0a14] border-b border-white/5 sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} className="text-white/50 hover:text-white text-xl">☰</button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#e8c547] rounded flex items-center justify-center text-[9px] font-black text-[#0a0a0f]">CZ</div>
            <span className="text-white text-sm font-bold">Cycling Zone</span>
          </div>
          <NavLink to="/notifications" className="relative">
            <span className="text-white/50 hover:text-white text-lg">🔔</span>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#e8c547] text-[#0a0a0f]
                text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                {unread > 9 ? "9" : unread}
              </span>
            )}
          </NavLink>
        </div>

        <div className="p-4 md:p-6 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
