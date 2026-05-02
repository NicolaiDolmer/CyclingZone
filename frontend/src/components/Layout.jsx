import { useState, useEffect, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "../lib/supabase";
import SetupWizardModal from "./SetupWizardModal";
import DeadlineDayBanner from "./DeadlineDayBanner";
import DeadlineDayTicker from "./DeadlineDayTicker";

const API = import.meta.env.VITE_API_URL;

const BOTTOM_ITEMS = [
  { to: "/help",        label: "Hjælp & Regler" },
  { to: "/patch-notes", label: "Patch Notes" },
];

function buildNavGroups(team) {
  return [
    {
      key: "overblik", label: "Overblik",
      items: [
        { to: "/dashboard",      label: "Dashboard" },
        { to: "/team",           label: "Mit Hold" },
        { to: "/board",          label: "Bestyrelse" },
        { to: "/finance",        label: "Finanser" },
        { to: "/notifications",  label: "Indbakke", badge: true },
        ...(team?.id ? [{ to: `/managers/${team.id}`, label: "Min Managerprofil" }] : []),
        { to: "/profile",        label: "Profil & Indstillinger" },
      ],
    },
    {
      key: "marked", label: "Marked",
      items: [
        { to: "/riders",    label: "Ryttere" },
        { to: "/auctions",  label: "Auktioner" },
        { to: "/transfers", label: "Transfers" },
        { to: "/activity",  label: "Min Aktivitet" },
        { to: "/watchlist", label: "Ønskeliste" },
      ],
    },
    {
      key: "resultater", label: "Resultater",
      items: [
        { to: "/resultater",     label: "Overblik" },
        { to: "/standings",      label: "Ranglisten" },
        { to: "/rider-rankings", label: "Rytterrangliste" },
        { to: "/season-end",     label: "Sæsonresultater" },
        { to: "/hall-of-fame",   label: "Hall of Fame" },
        { to: "/race-archive",   label: "Løbsarkiv" },
      ],
    },
    {
      key: "liga", label: "Liga",
      items: [
        { to: "/teams",          label: "Hold" },
        { to: "/head-to-head",   label: "Head-to-Head" },
        { to: "/season-preview", label: "Sæson Preview" },
        { to: "/races",          label: "Løbskalender" },
      ],
    },
  ];
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

function pathMatchesNavItem(pathname, to) {
  return pathname === to || pathname.startsWith(`${to}/`);
}

export default function Layout() {
  const navigate = useNavigate();
  const location = useLocation();
  const [session, setSession]             = useState(null);
  const [team, setTeam]                   = useState(null);
  const [balance, setBalance]             = useState(null);
  const [notifications, setNotifications] = useState([]);
  const [isAdmin, setIsAdmin]             = useState(false);
  const [mobileOpen, setMobileOpen]       = useState(false);
  const [openGroups, setOpenGroups]       = useState({});
  const [onlineCount, setOnlineCount]     = useState(0);
  const [teamLoaded, setTeamLoaded]       = useState(false);
  const heartbeatRef = useRef(null);

  useEffect(() => {
    const path = location.pathname;
    const activeGroup = buildNavGroups(null).find(g => g.items.some(i => pathMatchesNavItem(path, i.to)));
    if (activeGroup) setOpenGroups(prev => ({ ...prev, [activeGroup.key]: true }));
    setMobileOpen(false);
  }, [location.pathname]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      setSession(session);

      const { data: userData } = await supabase.from("users")
        .select("role, username").eq("id", session.user.id).single();
      setIsAdmin(userData?.role === "admin");
      const { data: teamData } = await supabase.from("teams").select("id, name, balance, division, manager_name").eq("user_id", session.user.id).single();
      if (teamData) { setTeam(teamData); setBalance(teamData.balance); }
      setTeamLoaded(true);
      const { data: notifs } = await supabase.from("notifications").select("id").eq("user_id", session.user.id).eq("is_read", false).limit(9);
      setNotifications(notifs || []);

      if (!API) { console.error("VITE_API_URL is not set — presence/streak calls skipped"); return; }
      const h = await authHeaders();
      fetch(`${API}/api/presence`,     { method: "POST", headers: h }).catch(e => console.error("presence:", e));
      fetch(`${API}/api/login-streak`, { method: "POST", headers: h })
        .catch(e => console.error("login-streak:", e))
        .finally(() => {
          fetch(`${API}/api/achievements/check`, {
            method: "POST",
            headers: h,
            body: JSON.stringify({ context: "team_update", data: {} }),
          }).catch(() => {});
        });
      fetchOnlineCount(h);
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel("layout-notifs-v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` },
        async () => {
          const { data } = await supabase.from("notifications").select("id").eq("user_id", session.user.id).eq("is_read", false).limit(9);
          setNotifications(data || []);
          const { data: t } = await supabase.from("teams").select("balance").eq("user_id", session.user.id).single();
          if (t) setBalance(t.balance);
        }).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  useEffect(() => {
    if (!session) return;
    heartbeatRef.current = setInterval(async () => {
      if (!API) return;
      const h = await authHeaders();
      fetch(`${API}/api/presence`, { method: "POST", headers: h }).catch(e => console.error("heartbeat:", e));
      fetchOnlineCount(h);
    }, 60000);
    return () => clearInterval(heartbeatRef.current);
  }, [session]);

  async function fetchOnlineCount(headers) {
    if (!API) return;
    try {
      const h = headers || await authHeaders();
      const res = await fetch(`${API}/api/online-count`, { headers: h });
      const data = await res.json();
      setOnlineCount(data.count || 0);
    } catch (e) { console.error("online-count:", e); }
  }

  async function signOut() {
    await supabase.auth.signOut();
    navigate("/login");
  }

  function toggleGroup(key) { setOpenGroups(prev => ({ ...prev, [key]: !prev[key] })); }

  function handleSetupComplete(updatedTeam) {
    setTeam(updatedTeam);
    setBalance(updatedTeam.balance);
  }

  const unread = notifications.length;
  const baseGroups = buildNavGroups(team);
  const navGroups = isAdmin
    ? [...baseGroups, { key: "admin", label: "Admin", items: [{ to: "/admin", label: "Admin" }] }]
    : baseGroups;

  function NavItem({ to, label, badge, onClick }) {
    const isActive = pathMatchesNavItem(location.pathname, to);
    const showBadge = badge && unread > 0;
    return (
      <NavLink to={to} onClick={onClick}
        className={`flex items-center justify-between mx-2 px-3 py-2 rounded-lg text-[13px] transition-all duration-150
          ${isActive
            ? "bg-[#e8c547]/12 text-[#e8c547] font-medium"
            : "text-white/55 hover:text-white hover:bg-white/6"}`}>
        <span>{label}</span>
        {showBadge && (
          <span className="bg-[#e8c547] text-[#1a1f38] text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </NavLink>
    );
  }

  function SidebarContent({ onNav }) {
    return (
      <div className="flex flex-col h-full">
        {/* Logo + team */}
        <button
          onClick={() => navigate("/dashboard")}
          className="flex items-center gap-2.5 px-4 py-4 border-b border-white/7 w-full text-left hover:bg-white/4 transition-colors">
          <div className="w-7 h-7 bg-[#e8c547] rounded-md flex items-center justify-center text-[10px] font-black text-[#1a1f38] flex-shrink-0">
            CZ
          </div>
          <div className="min-w-0">
            <p className="text-white text-xs font-bold leading-tight">Cycling Zone</p>
            <p className="text-white/30 text-[10px] truncate">{team?.name || "…"}</p>
          </div>
        </button>

        {/* Balance */}
        {balance !== null && (
          <div className="px-4 py-3 border-b border-white/7">
            <p className="text-[9px] text-white/25 uppercase tracking-widest mb-0.5">Balance</p>
            <p className="text-[#e8c547] font-mono font-bold text-sm leading-tight">
              {balance.toLocaleString("da-DK")} CZ$
            </p>
            {team && <p className="text-white/25 text-[10px] mt-0.5">Division {team.division}</p>}
          </div>
        )}

        {/* Online indicator */}
        {onlineCount > 0 && (
          <div className="px-4 py-2 border-b border-white/7">
            <span className="inline-flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
              <span className="text-white/25 text-[10px]">{onlineCount} online nu</span>
            </span>
          </div>
        )}

        {/* Nav groups */}
        <nav className="flex-1 overflow-y-auto py-2">
          {navGroups.map(group => {
            const isOpen = openGroups[group.key];
            return (
              <div key={group.key} className="mb-1">
                {/* Section label — clearly a label, not a link */}
                <button
                  onClick={() => toggleGroup(group.key)}
                  className="w-full flex items-center justify-between px-4 pt-4 pb-1 group">
                  <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-white/25 group-hover:text-white/40 transition-colors">
                    {group.label}
                  </span>
                  <span className={`text-[8px] text-white/20 group-hover:text-white/35 transition-all duration-200 ${isOpen ? "rotate-180" : ""}`}>
                    ▾
                  </span>
                </button>

                {isOpen && (
                  <div className="py-0.5">
                    {group.items.map(item => (
                      <NavItem key={item.to} {...item} onClick={onNav} />
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          {/* Bottom nav items */}
          <div className="h-px bg-white/7 my-3 mx-4" />
          {BOTTOM_ITEMS.map(item => (
            <NavItem key={item.to} {...item} onClick={onNav} />
          ))}
        </nav>

        {/* Footer */}
        <div className="border-t border-white/7 px-4 py-3">
          <button
            onClick={signOut}
            className="text-[11px] text-white/25 hover:text-white/60 transition-colors">
            ← Log ud
          </button>
        </div>
      </div>
    );
  }

  const needsSetup = teamLoaded && !team?.manager_name;

  return (
    <div className="min-h-screen bg-cz-body flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-52 flex-shrink-0 bg-[#1a1f38] border-r border-white/7 fixed top-0 left-0 h-full z-30">
        <SidebarContent onNav={() => {}} />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-52 bg-[#1a1f38] border-r border-white/7 z-50">
            <SidebarContent onNav={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:ml-52 min-h-screen">
        {/* Mobile topbar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-[#1a1f38] border-b border-white/7 sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} className="text-white/50 hover:text-white text-xl">☰</button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-[#e8c547] rounded flex items-center justify-center text-[9px] font-black text-[#1a1f38]">CZ</div>
            <span className="text-white text-sm font-bold">Cycling Zone</span>
          </div>
          <NavLink to="/notifications" className="relative">
            <span className="text-white/50 hover:text-white text-lg">🔔</span>
            {unread > 0 && (
              <span className="absolute -top-1 -right-1 bg-[#e8c547] text-[#1a1f38] text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                {unread > 9 ? "9" : unread}
              </span>
            )}
          </NavLink>
        </div>

        <DeadlineDayBanner />
        <div className="p-4 md:p-6 pb-10 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>

      {needsSetup && <SetupWizardModal onComplete={handleSetupComplete} />}
      <DeadlineDayTicker />
    </div>
  );
}
