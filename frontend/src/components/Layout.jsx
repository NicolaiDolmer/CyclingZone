import { useState, useEffect, useRef } from "react";
import { Outlet, Link, NavLink, useNavigate, useLocation } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import SetupWizardModal from "./SetupWizardModal";
import MobileQuickNav from "./MobileQuickNav";
import LanguageSwitcher from "./LanguageSwitcher";
import { Wordmark } from "./Brand";
import DiscordJoinLink from "./DiscordJoinLink";
import { MenuIcon, BellIcon, ChevronDownIcon, ChevronLeftIcon } from "./ui/icons";
import { resolveAcademyNavVisible, readCachedAcademyNav, writeCachedAcademyNav } from "../lib/academyNavVisibility";
import ProBadge from "./ProBadge";
import { useSubscription } from "../lib/useSubscription";
import { getAttribution } from "../lib/attribution";

const API = import.meta.env.VITE_API_URL;

// #1027 Track A — data-tunge tabel-sider får full-bleed content-wrapper, så brede
// rytter-/auktions-tabeller bruger den tilgængelige bredde (ingen klippede kolonner +
// side-whitespace samtidig). Alle andre sider beholder den læsbare max-w-6xl.
// Filter-paneler cappes per-side (max-w-[1600px]) så form-inputs ikke strækkes.
// "/team" tilføjet per #1186 — trup-tabellen (14 stat-kolonner) var klemt i max-w-5xl.
// "/transfers" tilføjet per #1675 — market-fanens evne-tabel + listen havde for meget
// side-whitespace i den smalle max-w-4xl; cards/header cappes per-side i selve siden.
const WIDE_CONTENT_ROUTES = new Set(["/riders", "/rider-rankings", "/watchlist", "/auctions", "/team", "/transfers", "/calendar"]);
// Prefix-ruter: dynamiske paths (fx /teams/<id>) matcher ikke exact i settet
// ovenfor. #1675 — andre managers holdside (/teams/:id) har samme brede
// trup-tabel som "/team" og skal bruge fuld bredde i stedet for max-w-4xl.
const WIDE_CONTENT_PREFIXES = ["/teams/"];

function buildBottomItems(t) {
  return [
    { to: "/profile",     label: t("nav.item.profile") },
    { to: "/help",        label: t("nav.item.help") },
    { to: "/rules",       label: t("nav.item.rules") },
    { to: "/roadmap",     label: t("nav.item.roadmap") },
    { to: "/patch-notes", label: t("nav.item.patchNotes") },
  ];
}

function buildNavGroups(team, t, academyEnabled = false) {
  return [
    {
      key: "klubhus", label: t("nav.group.klubhus"),
      items: [
        { to: "/dashboard",      label: t("nav.item.dashboard") },
        { to: "/team",           label: t("nav.item.team") },
        { to: "/training",       label: t("nav.item.training") },
        ...(academyEnabled ? [{ to: "/academy", label: t("nav.item.academy") }] : []),
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
        // #987: excludeQuery så "Transfers" ikke lyser op når man står på
        // transferliste-genvejen (?tab=market) — kun én af de to er aktiv.
        { to: "/transfers",    label: t("nav.item.transfers"), excludeQuery: "tab=market" },
        { to: "/transfers?tab=market", label: t("nav.item.transferList") },
        { to: "/watchlist",    label: t("nav.item.watchlist") },
        { to: "/activity",     label: t("nav.item.activity") },
      ],
    },
    {
      // #1609: "League"-gruppen nedlagt — Teams/H2H/Season-Preview er konsolideret
      // ind i Standings-hub'en (linse + drawer). Hub'en bor her som "League & standings".
      key: "saeson-resultater", label: t("nav.group.saeson"),
      items: [
        { to: "/resultater",     label: t("nav.item.results") },
        { to: "/calendar",       label: t("nav.item.calendar") },
        { to: "/standings",      label: t("nav.item.standings") },
        { to: "/rider-rankings", label: t("nav.item.riderRankings") },
        // #1681: excludeQuery så "Races" ikke også lyser op på holdudtagelse-
        // genvejen (?tab=calendar) — samme mønster som Transfers/Transfer list.
        { to: "/races",          label: t("nav.item.races"), excludeQuery: "tab=calendar" },
        // #1681: holdudtagelse var begravet 3 klik nede (Races → vælg løb →
        // scroll til panel). Top-level genvej → kalender-fanen med de kommende
        // løb man kan udtage hold til; hvert løb-kort linker til selve panelet.
        { to: "/races?tab=calendar", label: t("nav.item.teamSelection") },
        { to: "/seasons",        label: t("nav.item.seasons") },
      ],
    },
  ];
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
}

// #987: `to` kan indeholde en query (fx "/transfers?tab=market"). Aktiv kræver
// at path matcher OG alle query-params i `to` findes i URL'en. `excludeQuery`
// afaktiverer et item når en bestemt param-værdi ER sat (så søskende-genveje
// til samme path ikke begge lyser op).
function pathMatchesNavItem(location, to, exact = false, excludeQuery = null) {
  const [toPath, toQuery] = to.split("?");
  const pathOk = exact
    ? location.pathname === toPath
    : location.pathname === toPath || location.pathname.startsWith(`${toPath}/`);
  if (!pathOk) return false;
  const current = new URLSearchParams(location.search);
  if (toQuery) {
    for (const [k, v] of new URLSearchParams(toQuery)) {
      if (current.get(k) !== v) return false;
    }
  }
  if (excludeQuery) {
    for (const [k, v] of new URLSearchParams(excludeQuery)) {
      if (current.get(k) === v) return false;
    }
  }
  return true;
}

// #64: tæl ulæste notifikationer via head-count (ingen rows hentet) i stedet for
// at hente op til 9 rows og bruge .length — så badgen kan vise "9+" ved 10+ ulæste
// (før kappede limit(9) tællingen, så "9+"-grenen aldrig blev ramt).
async function fetchUnreadCount(userId) {
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false);
  return count || 0;
}

function NavItem({ to, label, badge, onClick, location, unread, exact, excludeQuery, title }) {
  const isActive = pathMatchesNavItem(location, to, exact, excludeQuery);
  const showBadge = badge && unread > 0;
  return (
    <NavLink to={to} onClick={onClick} title={title} aria-current={isActive ? "page" : undefined}
      className={`group relative flex items-center justify-between mx-2 px-3 py-2 rounded-lg text-[13px] transition-all duration-150
        ${isActive
          ? "bg-cz-accent/12 text-cz-accent font-medium cursor-default"
          : "text-cz-sidebar-2 hover:text-cz-sidebar-1 hover:bg-cz-sidebar-hover"}`}>
      <span className="flex items-center gap-2.5 min-w-0">
        {/* #481 PR-2: gold bullet — active = solid gold, inactive = muted (lights up on hover). Decorative. */}
        <span aria-hidden="true"
          className={`w-1.5 h-1.5 rounded-full flex-shrink-0 transition-colors duration-150
            ${isActive ? "bg-cz-accent" : "bg-cz-sidebar-3 group-hover:bg-cz-sidebar-2"}`} />
        <span className="truncate">{label}</span>
      </span>
      {showBadge && (
        <span className="bg-cz-accent text-cz-on-accent text-[9px] font-black px-1.5 py-0.5 rounded-full leading-none flex-shrink-0">
          {unread > 9 ? "9+" : unread}
        </span>
      )}
      {/* #481 PR-2: hover indicator — the wordmark's short thick accent-dash, scales
          in from the left on hover (inactive only; active needs no affordance). Decorative. */}
      {!isActive && (
        <span aria-hidden="true"
          className="pointer-events-none absolute left-3 bottom-1 h-0.5 w-5 rounded-full bg-cz-accent origin-left scale-x-0 transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none" />
      )}
    </NavLink>
  );
}

function SidebarContent({ onNav, navigate, team, balance, onlineCount, navGroups, bottomItems, openGroups, toggleGroup, signOut, location, unread, logoutLabel }) {
  const { t } = useTranslation("common");
  const { isPro, isFounder } = useSubscription(team?.id);
  return (
    <div className="flex flex-col h-full">
      {/* Logo + team */}
      <button
        onClick={() => navigate("/dashboard")}
        aria-label="Cycling Zone"
        className="flex items-center gap-2.5 px-4 py-4 border-b border-cz-sidebar-border w-full text-left hover:bg-cz-sidebar-hover transition-colors">
        {/* #671 Slice B: wordmark = primaer brand-mark (BRAND_BRIEF). Det redundante
            CZ-monogram er fjernet — monogram + wordmark + team-navn var tre identitets-
            elementer i samme hjoerne. Sidebar-canvas altid navy → forceDark wordmark.
            Bredere nav-header/IA-restructure spores i #1027. */}
        <div className="min-w-0">
          <Wordmark forceDark className="h-5 w-auto" alt="" />
          <div className="flex items-center gap-1.5 mt-1">
            <p className="text-cz-sidebar-3 text-[10px] truncate">{team?.name || "…"}</p>
            {isPro && <ProBadge isFounder={isFounder} />}
          </div>
        </div>
      </button>

      {/* Balance — guard mod undefined (jf. #446 bootstrap-race) */}
      {balance != null && (
        <div className="px-4 py-3 border-b border-cz-sidebar-border">
          <p className="text-[9px] text-cz-sidebar-3 uppercase tracking-widest mb-0.5">{t("sidebar.balance")}</p>
          <p className="text-cz-accent font-mono font-bold text-sm leading-tight" title={t("sidebar.balanceTooltip")}>
            {formatNumber(balance)} CZ$
          </p>
          {team?.division != null && (
            <p className="text-cz-sidebar-3 text-[10px] mt-0.5" title={t("sidebar.divisionTooltip")}>{t("sidebar.division", { division: team.division })}</p>
          )}
        </div>
      )}

      {/* Online indicator */}
      {onlineCount > 0 && (
        <div className="px-4 py-2 border-b border-cz-sidebar-border">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cz-success" />
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
                <ChevronDownIcon aria-hidden="true" className={`w-3 h-3 text-cz-sidebar-3 group-hover:text-cz-sidebar-2 transition-all duration-200 ${isOpen ? "rotate-180" : ""}`} />
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

        {/* #679: fast Discord-join-link mod community-serveren (ekstern). */}
        <DiscordJoinLink variant="sidebar" label={t("sidebar.joinDiscord")} onClick={onNav} className="mt-1" />
      </nav>

      {/* Footer */}
      <div className="border-t border-cz-sidebar-border px-4 py-3 flex items-center justify-between gap-2">
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1 text-[11px] text-cz-sidebar-3 hover:text-cz-sidebar-2 transition-colors">
          <ChevronLeftIcon aria-hidden="true" className="w-3 h-3" /> {logoutLabel}
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
  const [session, setSession]               = useState(null);
  const [team, setTeam]                     = useState(null);
  const [balance, setBalance]               = useState(null);
  const [unread, setUnread]   = useState(0);
  const [isAdmin, setIsAdmin]               = useState(false);
  const [mobileOpen, setMobileOpen]         = useState(false);
  const [openGroups, setOpenGroups]         = useState({});
  const [onlineCount, setOnlineCount]       = useState(0);
  const [teamLoaded, setTeamLoaded]         = useState(false);
  // #2068: fallback-værdier til SetupWizardModal hvis auto-bootstrap (nedenfor)
  // ikke kan fuldføre stille (fx holdnavnet blev taget i mellemtiden) — modalen
  // skal så starte forudfyldt med det spilleren skrev ved signup, ikke tomt.
  const [setupPrefill, setSetupPrefill]     = useState({ teamName: "", managerName: "" });
  // Init fra cache (#1792-klasse): vis akademiet med det samme hvis brugeren har
  // set det før, så et forbigående fetch-hikke ikke skjuler et fungerende akademi.
  const [academyEnabled, setAcademyEnabled] = useState(readCachedAcademyNav);
  const heartbeatRef = useRef(null);
  const teamId = team?.id;
  const isWideContent = WIDE_CONTENT_ROUTES.has(location.pathname)
    || WIDE_CONTENT_PREFIXES.some(p => location.pathname.startsWith(p));

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
    const groups = buildNavGroups(teamId ? { id: teamId } : null, t, academyEnabled);
    if (isAdmin) groups.push({ key: "admin", label: t("nav.group.admin"), items: [
      { to: "/admin", label: t("nav.item.admin"), exact: true },
      { to: "/admin/waitlist", label: t("nav.item.waitlist") },
      { to: "/admin/sprint-metrics", label: t("nav.item.sprintMetrics") },
      { to: "/admin/attribution", label: t("nav.item.attribution") },
    ] });
    const activeGroup = groups.find(g => g.items.some(i => pathMatchesNavItem(location, i.to, i.exact, i.excludeQuery)))
      || (path.startsWith("/managers/") ? groups.find(g => g.key === "klubhus") : null);
    if (activeGroup) setOpenGroups(prev => ({ ...prev, [activeGroup.key]: true }));
    setMobileOpen(false);
  }, [location, teamId, isAdmin, t, academyEnabled]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      setSession(session);

      const { data: userData } = await supabase.from("users")
        .select("role, username").eq("id", session.user.id).single();
      setIsAdmin(userData?.role === "admin");
      const { data: teamData } = await supabase.from("teams").select("id, name, balance, division, manager_name").eq("user_id", session.user.id).single();
      if (teamData) {
        setTeam(teamData);
        setBalance(teamData.balance);
      } else {
        // #2068: ingen hold endnu — dette er (næsten altid) en confirm-on-bruger
        // der lige har klikket bekræftelseslinket. Signup gemte team_name +
        // manager_name i auth-metadata; brug dem til at oprette holdet STILLE her
        // i stedet for at bede spilleren skrive navnene igen i SetupWizard.
        // Fejler det (fx holdnavnet blev taget i mellemtiden, eller metadata
        // mangler for en ældre/anden konto-type) falder vi tilbage til modalen,
        // forudfyldt med det vi har.
        const meta = session.user.user_metadata || {};
        const metaTeamName = (meta.team_name || "").trim();
        const metaManagerName = (meta.manager_name || "").trim();
        setSetupPrefill({ teamName: metaTeamName, managerName: metaManagerName });

        if (metaTeamName && metaManagerName && API) {
          try {
            const h = await authHeaders();
            const res = await fetch(`${API}/api/teams/my`, {
              method: "PUT",
              headers: h,
              body: JSON.stringify({
                name: metaTeamName,
                manager_name: metaManagerName,
                // #2079: confirm-linket åbnes tit på en anden enhed end signup'et
                // (mobil-mailapp) — localStorage er tom dér. Fald tilbage til
                // attribution-snapshottet som LoginPage gemte i auth-metadata.
                attribution: getAttribution() || meta.attribution || null,
              }),
            });
            if (res.ok) {
              const bootstrapped = await res.json();
              setTeam(bootstrapped.team);
              setBalance(bootstrapped.team.balance);
              // #2102: siderne (fx DashboardPage) mountede PARALLELT med denne
              // bootstrap og fandt intet hold i deres egen fetch — de bailer
              // stille og refetcher aldrig → spilleren så et tomt spil med
              // holdnavn i topbaren (Team CSC 2/7). Én hård reload efter
              // succesfuld oprettelse remounter alt med holdet i DB.
              // sessionStorage-guard: reload højst én gang pr. session, så en
              // utænkelig teamData-læsefejl + ok-PUT (upsert) aldrig kan loope.
              if (!sessionStorage.getItem("cz-bootstrap-reloaded")) {
                sessionStorage.setItem("cz-bootstrap-reloaded", "1");
                window.location.reload();
                return;
              }
            } else {
              console.warn("[auto-bootstrap] holdoprettelse fejlede, falder tilbage til SetupWizard", res.status);
            }
          } catch (err) {
            console.warn("[auto-bootstrap] holdoprettelse fejlede, falder tilbage til SetupWizard", err);
          }
        }
      }
      setTeamLoaded(true);
      setUnread(await fetchUnreadCount(session.user.id));

      if (!API) { console.error("VITE_API_URL is not set — presence/streak calls skipped"); return; }
      const h = await authHeaders();
      // Akademi-nav-synlighed (#1308): bestem via /api/academy/me, men fejl LUKKER
      // ikke punktet. Kun 200/409 er autoritative (opdater state + cache); 401
      // (udløbet/fornyende session, #1792), 5xx og netværksfejl bevarer sidst kendte.
      fetch(`${API}/api/academy/me`, { headers: h })
        .then(async res => {
          const data = res.status === 200 ? await res.json().catch(() => null) : null;
          const visible = resolveAcademyNavVisible({
            status: res.status,
            enabled: data?.enabled,
            lastKnown: readCachedAcademyNav(),
          });
          setAcademyEnabled(visible);
          if (res.status === 200 || res.status === 409) writeCachedAcademyNav(visible);
        })
        .catch(() => { /* netværksfejl: behold sidst kendte (state uændret) */ });
      fetch(`${API}/api/presence`,     { method: "POST", headers: h }).catch(e => console.error("presence:", e));
      // Login-streak power-mekanik fjernet (#1139) — ingen daglig login-tvang.
      // Achievements-check kører fortsat (kosmetiske unlocks), uafhængigt af streak.
      fetch(`${API}/api/achievements/check`, {
        method: "POST",
        headers: h,
        body: JSON.stringify({ context: "team_update", data: {} }),
      }).catch(() => {});
      fetchOnlineCount(h);
    });
  }, []);

  useEffect(() => {
    if (!session) return;
    const channel = supabase.channel("layout-notifs-v2")
      .on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` },
        async () => {
          setUnread(await fetchUnreadCount(session.user.id));
          const { data: t } = await supabase.from("teams").select("balance").eq("user_id", session.user.id).single();
          if (t) setBalance(t.balance);
        }).subscribe();
    return () => supabase.removeChannel(channel);
  }, [session]);

  // Supabase DELETE-events mangler user_id i payload uden REPLICA IDENTITY FULL — lyt på window-event i stedet.
  useEffect(() => {
    if (!session) return;
    async function handleNotifDeleted() {
      setUnread(await fetchUnreadCount(session.user.id));
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

  const baseGroups = buildNavGroups(team, t, academyEnabled);
  const navGroups = isAdmin
    ? [...baseGroups, { key: "admin", label: t("nav.group.admin"), items: [
        { to: "/admin", label: t("nav.item.admin") },
        { to: "/admin/waitlist", label: t("nav.item.waitlist") },
        { to: "/admin/sprint-metrics", label: t("nav.item.sprintMetrics") },
        { to: "/admin/attribution", label: t("nav.item.attribution") },
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

      {/* Main content — min-w-0 så flex-child'en kan krympe til viewporten i
          stedet for at vokse med bredt indhold (fx en bred tabel i overflow-x-auto).
          Uden den blæser indholdets min-content MAIN ud over mobil-viewporten →
          horizontal overflow + shrink-to-fit-skalering → klikpunkter rammer
          nabolayout (#1872). */}
      <main className="flex-1 min-w-0 md:ms-52 min-h-screen">
        {/* Mobile topbar — bevidst IKKE sticky: den skal scrolle med indholdet
            og ikke "følge med op" og stjæle plads på små skærme (#1007). */}
        <div className="md:hidden flex items-center justify-between px-4 py-3 bg-cz-sidebar border-b border-cz-sidebar-border">
          <button onClick={() => setMobileOpen(true)} aria-label={t("a11y.openMenu")} className="text-cz-sidebar-2 hover:text-cz-sidebar-1"><MenuIcon aria-hidden="true" className="w-6 h-6" /></button>
          <Link to="/dashboard" aria-label={t("nav.item.dashboard")} className="flex items-center gap-2 rounded hover:opacity-80 transition-opacity">
            <Wordmark forceDark className="h-5 w-auto" alt="" />
          </Link>
          <div className="flex items-center gap-2">
            <LanguageSwitcher />
            <NavLink to="/notifications" aria-label={t("a11y.openNotifications")} className="relative">
              <BellIcon aria-hidden="true" className="w-5 h-5 text-cz-sidebar-2 hover:text-cz-sidebar-1" />
              {unread > 0 && (
                <span className="absolute -top-1 -right-1 bg-cz-accent text-cz-on-accent text-[8px] font-black min-w-3.5 h-3.5 px-0.5 rounded-full flex items-center justify-center leading-none">
                  {unread > 9 ? "9+" : unread}
                </span>
              )}
            </NavLink>
          </div>
        </div>

        <div className={`p-4 md:p-6 pb-24 md:pb-10 mx-auto ${isWideContent ? "max-w-full" : "max-w-6xl"}`}>
          <Outlet />
        </div>
      </main>

      <MobileQuickNav unread={unread} />
      {needsSetup && (
        <SetupWizardModal
          onComplete={handleSetupComplete}
          initialTeamName={setupPrefill.teamName}
          initialManagerName={setupPrefill.managerName}
        />
      )}
    </div>
  );
}
