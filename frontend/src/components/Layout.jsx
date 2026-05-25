import { useState, useEffect, useRef } from "react";
import { Outlet, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import SetupWizardModal from "./SetupWizardModal";
import DeadlineDayBanner from "./DeadlineDayBanner";
import DeadlineDayTicker from "./DeadlineDayTicker";
import MobileQuickNav from "./MobileQuickNav";
import LanguageSwitcher from "./LanguageSwitcher";

const API = import.meta.env.VITE_API_URL;

function buildBottomItems(t) {
  return [
    { to: "/profile",     label: t("nav.item.profile") },
    { to: "/help",        label: t("nav.item.help") },
    { to: "/patch-notes", label: t("nav.item.patchNotes") },
  ];
}

function buildNavGroups(team, t) {
  return [
    {
      key: "klubhus", label: t("nav.group.klubhus"),
      items: [
        { to: "/dashboard",      label: t("nav.item.dashboard") },
        { to: "/team",           label: t("nav.item.team") },
        { to: "/board",          label: t("nav.item.board") },
        { to: "/finance",        label: t("nav.item.finance") },
        { to: "/notifications",  label: t("nav.item.notifications"), badge: true },
        ...(team?.id ? [{ to: `/managers/${team.id}`, label: t("nav.item.managerProfile") }] : []),
      ],
    },
    {
      key: "marked", label: t("nav.group.marked"),
      items: [
        { to: "/riders",       label: t("nav.item.riders") },
        { to: "/auctions",     label: t("nav.item.auctions") },
        { to: "/transfers",    label: t("nav.item.transfers") },
        { to: "/deadline-day", label: t("nav.item.deadlineDay") },
        { to: "/watchlist",    label: t("nav.item.watchlist") },
        { to: "/activity",     label: t("nav.item.activity") },
      ],
    },
    {
      key: "saeson-resultater", label: t("nav.group.saeson"),
      items: [
        { to: "/resultater",     label: t("nav.item.results") },
        { to: "/standings",      label: t("nav.item.standings") },
        { to: "/rider-rankings", label: t("nav.item.riderRankings") },
        { to: "/races",          label: t("nav.item.races") },
        { to: "/seasons",        label: t("nav.item.seasons") },
        { to: "/hall-of-fame",   label: t("nav.item.hallOfFame") },
      ],
    },
    {
      key: "liga", label: t("nav.group.liga"),
      items: [
        { to: "/teams",          label: t("nav.item.teams") },
        { to: "/head-to-head",   label: t("nav.item.headToHead") },
        { to: "/season-preview", label: t("nav.item.seasonPreview") },
      ],
    },
  ];
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

function pathMatchesNavItem(pathname, to, exact = false) {
  if (exact) return pathname === to;
  return pathname === to || pathname.startsWith(`${to}/`);
}

function NavItem({ to, label, badge, onClick, location, unread, exact }) {
  const isActive = pathMatchesNavItem(location.pathname, to, exact);
  const showBadge = badge && unread > 0;
  return (
    <NavLink to={to} onClick={onClick}
      className={`flex items-center justify-between mx-2 px-3 py-2 rounded-lg text-[13px] transition-all duration-150
        ${isActive
          ? "bg-cz-accent/12 text-cz-accent font-medium"
          : "text-cz-sidebar-2 hover:text-cz-sidebar-1 hover:bg-cz-sidebar-hover"}`}>
      <span>{label}</span>
      {showBadge && (
        <span className="bg-cz-accent text-cz-on-accent text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
    </NavLink>
  );
}

function SidebarContent({ onNav, navigate, team, balance, onlineCount, navGroups, bottomItems, openGroups, toggleGroup, signOut, location, unread, logoutLabel }) {
  const { t } = useTranslation("common");
  return (
    <div className="flex flex-col h-full">
      {/* Logo + team */}
      <button
        onClick={() => navigate("/dashboard")}
        className="flex items-center gap-2.5 px-4 py-4 border-b border-cz-sidebar-border w-full text-left hover:bg-cz-sidebar-hover transition-colors">
        <div className="w-7 h-7 bg-cz-accent rounded-md flex items-center justify-center text-[10px] font-black text-cz-on-accent flex-shrink-0">
          CZ
        </div>
        <div className="min-w-0">
          <p className="text-cz-sidebar-1 text-xs font-bold leading-tight">Cycling Zone</p>
          <p className="text-cz-sidebar-3 text-[10px] truncate">{team?.name || "…"}</p>
        </div>
      </button>

      {/* Balance — guard mod undefined (jf. #446 bootstrap-race) */}
      {balance != null && (
        <div className="px-4 py-3 border-b border-cz-sidebar-border">
          <p className="text-[9px] text-cz-sidebar-3 uppercase tracking-widest mb-0.5">{t("sidebar.balance")}</p>
          <p className="text-cz-accent font-mono font-bold text-sm leading-tight">
            {formatNumber(balance)} CZ$
          </p>
          {team?.division != null && (
            <p className="text-cz-sidebar-3 text-[10px] mt-0.5">{t("sidebar.division", { division: team.division })}</p>
          )}
        </div>
      )}

      {/* Online indicator */}
      {onlineCount > 0 && (
        <div className="px-4 py-2 border-b border-cz-sidebar-border">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
            <span className="text-cz-sidebar-3 text-[10px]">{t("sidebar.onlineNow", { count: onlineCount })}</span>
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
                <span className="text-[9px] font-bold uppercase tracking-[0.14em] text-cz-sidebar-3 group-hover:text-cz-sidebar-2 transition-colors">
                  {group.label}
                </span>
                <span className={`text-[8px] text-cz-sidebar-3 group-hover:text-cz-sidebar-2 transition-all duration-200 ${isOpen ? "rotate-180" : ""}`}>
                  ▾
                </span>
              </button>

              {isOpen && (
                <div className="py-0.5">
                  {group.items.map(item => (
                    <NavItem key={item.to} {...item} onClick={onNav} location={location} unread={unread} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Bottom nav items */}
        <div className="h-px bg-cz-sidebar-border my-3 mx-4" />
        {bottomItems.map(item => (
          <NavItem key={item.to} {...item} onClick={onNav} location={location} unread={unread} />
        ))}
      </nav>

      {/* Footer */}
      <div className="border-t border-cz-sidebar-border px-4 py-3 flex items-center justify-between gap-2">
        <button
          onClick={signOut}
          className="text-[11px] text-cz-sidebar-3 hover:text-cz-sidebar-2 transition-colors">
          ← {logoutLabel}
        </button>
        <LanguageSwitcher />
      </div>
    </div>
  );
}

export default function Layout() {
  const { t } = useTranslation("common");
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
  const [tickerActive, setTickerActive]   = useState(false);
  const heartbeatRef = useRef(null);
  const teamId = team?.id;

  async function fetchOnlineCount(headers) {
    if (!API) return;
    try {
      const h = headers || await authHeaders();
      const res = await fetch(`${API}/api/online-count`, { headers: h });
      const data = await res.json();
      setOnlineCount(data.count || 0);
    } catch (e) { console.error("online-count:", e); }
  }

  useEffect(() => {
    const path = location.pathname;
    const groups = buildNavGroups(teamId ? { id: teamId } : null, t);
    if (isAdmin) groups.push({ key: "admin", label: t("nav.group.admin"), items: [
      { to: "/admin", label: t("nav.item.admin"), exact: true },
      { to: "/admin/waitlist", label: t("nav.item.waitlist") },
      { to: "/admin/sprint-metrics", label: t("nav.item.sprintMetrics") },
    ] });
    const activeGroup = groups.find(g => g.items.some(i => pathMatchesNavItem(path, i.to, i.exact)))
      || (path.startsWith("/managers/") ? groups.find(g => g.key === "klubhus") : null);
    if (activeGroup) setOpenGroups(prev => ({ ...prev, [activeGroup.key]: true }));
    setMobileOpen(false);
  }, [location.pathname, teamId, isAdmin, t]);

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

  // Supabase DELETE-events mangler user_id i payload uden REPLICA IDENTITY FULL — lyt på window-event i stedet.
  useEffect(() => {
    if (!session) return;
    async function handleNotifDeleted() {
      const { data } = await supabase.from("notifications").select("id").eq("user_id", session.user.id).eq("is_read", false).limit(9);
      setNotifications(data || []);
    }
    window.addEventListener("cz:notif-deleted", handleNotifDeleted);
    return () => window.removeEventListener("cz:notif-deleted", handleNotifDeleted);
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
  const baseGroups = buildNavGroups(team, t);
  const navGroups = isAdmin
    ? [...baseGroups, { key: "admin", label: t("nav.group.admin"), items: [
        { to: "/admin", label: t("nav.item.admin") },
        { to: "/admin/waitlist", label: t("nav.item.waitlist") },
        { to: "/admin/sprint-metrics", label: t("nav.item.sprintMetrics") },
      ] }]
    : baseGroups;
  const bottomItems = buildBottomItems(t);

  const needsSetup = teamLoaded && !team?.manager_name;
  const sidebarProps = { navigate, team, balance, onlineCount, navGroups, bottomItems, openGroups, toggleGroup, signOut, location, unread, logoutLabel: t("nav.item.logout") };

  return (
    <div className="min-h-screen bg-cz-body flex">
      {/* Desktop sidebar */}
      <aside className="hidden md:flex flex-col w-52 flex-shrink-0 bg-cz-sidebar border-r border-cz-sidebar-border fixed top-0 left-0 h-full z-30">
        <SidebarContent {...sidebarProps} onNav={() => {}} />
      </aside>

      {/* Mobile sidebar overlay */}
      {mobileOpen && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-52 bg-cz-sidebar border-r border-cz-sidebar-border z-50">
            <SidebarContent {...sidebarProps} onNav={() => setMobileOpen(false)} />
          </aside>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 md:ms-52 min-h-screen">
        {/* Mobile topbar */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-cz-sidebar border-b border-cz-sidebar-border sticky top-0 z-20">
          <button onClick={() => setMobileOpen(true)} className="text-cz-sidebar-2 hover:text-cz-sidebar-1 text-xl">☰</button>
          <div className="flex items-center gap-2">
            <div className="w-6 h-6 bg-cz-accent rounded flex items-center justify-center text-[9px] font-black text-cz-on-accent">CZ</div>
            <span className="text-cz-sidebar-1 text-sm font-bold">Cycling Zone</span>
          </div>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <NavLink to="/notifications" className="relative">
              <span className="text-cz-sidebar-2 hover:text-cz-sidebar-1 text-lg">🔔</span>
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-cz-accent text-cz-on-accent text-[8px] font-black w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none">
                  {unread > 9 ? "9" : unread}
                </span>
              )}
            </NavLink>
          </div>
        </div>

        <DeadlineDayBanner />
        <div className="p-4 md:p-6 pb-24 md:pb-10 max-w-6xl mx-auto">
          <Outlet />
        </div>
      </main>

      <MobileQuickNav unread={unread} tickerActive={tickerActive} />
      {needsSetup && <SetupWizardModal onComplete={handleSetupComplete} />}
      <DeadlineDayTicker onActiveChange={setTickerActive} />
    </div>
  );
}
