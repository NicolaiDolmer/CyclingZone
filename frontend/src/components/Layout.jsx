import { useState, useEffect, useRef, lazy, Suspense } from "react";
import { Outlet, Link, NavLink, useNavigate, useLocation } from "react-router";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { subscribeAuthedChannel } from "../lib/realtimeChannel";
import { formatNumber } from "../lib/intl";
import SetupWizardModal from "./SetupWizardModal";
// #2602 · lazy: modalen aabnes kun ved klik paa Kontakt — dens kode (+i18n-traek)
// skal ikke belaste hovedbundlet (perf-gate: 888 KB > 885 KB-loftet uden lazy).
const FeedbackModal = lazy(() => import("./FeedbackModal"));
import MobileQuickNav from "./MobileQuickNav";
import RaceControlBanner from "./RaceControlBanner";
import LanguageSwitcher from "./LanguageSwitcher";
import { Wordmark } from "./Brand";
import DiscordJoinLink from "./DiscordJoinLink";
import { MenuIcon, BellIcon, ChevronDownIcon, ChevronLeftIcon } from "./ui/icons";
import { resolveAcademyNavVisible, readCachedAcademyNav, writeCachedAcademyNav } from "../lib/academyNavVisibility";
import { facilitiesNavItem } from "../lib/facilitiesNavVisibility";
import { useFacilities } from "../lib/useFacilities";
import { scoutingNavItem } from "../lib/scoutingNavVisibility";
import { useScoutingCentral } from "../lib/useScoutingCentral";
import { pathMatchesNavItem } from "../lib/navMatching.js";
import { buildNavBadgeCounts, resolveNavBadgeCount, formatNavBadgeCount } from "../lib/navBadges.js";
import { reportActionFailure } from "../lib/actionTelemetry.js";
import {
  loadPatchNotesMeta, isPatchNotesUnread, readLastSeenPatchNotes, writeLastSeenPatchNotes,
  buildNavDotFlags, resolveNavDot,
} from "../lib/patchNotesUnread.js";
import ProBadge from "./ProBadge";
import { useSubscription } from "../lib/useSubscription";
import { getAttribution } from "../lib/attribution";
import { useActionSummary } from "../hooks/useActionSummary";

const API = import.meta.env.VITE_API_URL;

// #1027 Track A — data-tunge tabel-sider får full-bleed content-wrapper, så brede
// rytter-/auktions-tabeller bruger den tilgængelige bredde (ingen klippede kolonner +
// side-whitespace samtidig). Alle andre sider beholder den læsbare max-w-6xl.
// Filter-paneler cappes per-side (max-w-[1600px]) så form-inputs ikke strækkes.
// "/team" tilføjet per #1186 — trup-tabellen (14 stat-kolonner) var klemt i max-w-5xl.
// "/transfers" tilføjet per #1675 — market-fanens evne-tabel + listen havde for meget
// side-whitespace i den smalle max-w-4xl; cards/header cappes per-side i selve siden.
// "/training" tilføjet per #2446 — roster-tabellen (9 kolonner) blev klippet i
// højre side i max-w-6xl samtidig med spildt whitespace; samme klasse som /team.
// "/resultater" tilføjet per #3102 etape 2 — hubben er T2 nu: arkiv-fanen er
// biblioteks-tabellen (5 kolonner) og point-fanen er point-tabellerne pr.
// løbsklasse. Uden ruten her ville begge være klemt i max-w-6xl.
// #3104 etape C: "/rider-rankings", "/global-rank" og "/staff" udgik — de tre
// ruter redirecter nu (rangliste-fanerne bor under /standings, som allerede er
// wide; personale-fanen bor i /klub, der bevidst forbliver T1 max-w-4xl —
// staff-tabellens kolonner er kompakte nok, og SCROLLER fanger overløb).
// #3102 etape 3: "/races" og "/planner" udgik (ruterne redirecter);
// "/planning" arver deres T2-behov — holdudtagelses-boardet skal ud til kanten
// på store skærme (#2568-ejer-kravet gælder uændret i hubben).
// #3454: "/academy" tilføjet — rosteret bruger den kanoniske DataTable
// (T2-recipe, sticky navnekolonne) og var fejlagtigt fanget i shellens
// max-w-6xl selvom sidens egen container allerede stod på max-w-[1600px]
// (samme fejlklasse som #1675/#1186/#2446 — se PAGE_TEMPLATES.md).
// #3858: "/race-centre" er en T2 wide data-side (sendefladen skal have plads til
// tre kort-kolonner) — den capper selv på 1600px, shellen må bare ikke klemme
// den ned i max-w-6xl.
const WIDE_CONTENT_ROUTES = new Set(["/riders", "/watchlist", "/auctions", "/team", "/transfers", "/training", "/planning", "/standings", "/resultater", "/race-centre", "/academy"]);
// #2849 bølge 4: T3-profil/detalje-sider (PAGE_TEMPLATES.md) ejer hele fladen —
// hero-båndet skal bleede edge-to-edge (til sidebar-kanten), og siden sætter selv
// indre max-w-5xl + padding. Layout-containeren dropper derfor padding + cap helt
// for disse ruter (før: RaceDetail kompenserede med negative margins og bleedte
// kun til content-boksens kant).
// Bølge 5: de fire profil-sider (/riders/:id, /teams/:id, /managers/:teamId,
// /staff/:id) migreret til T3 — /teams/ flyttet hertil fra det tidligere
// WIDE_CONTENT_PREFIXES (#1675), som dermed udgik. Prefixerne matcher kun
// detalje-ruterne: list-siderne (/riders, /staff, …) er exact-paths uden slash.
// #3102 etape 3: FULL_BLEED_EXCLUDE ("/races/strategy") udgik — ruten
// redirecter til Planlægnings-hubben, så prefixet matcher kun /races/:raceId nu.
const FULL_BLEED_PREFIXES = ["/races/", "/riders/", "/teams/", "/managers/", "/staff/"];
function isFullBleedRoute(pathname) {
  return FULL_BLEED_PREFIXES.some(p => pathname.startsWith(p));
}

// #3104 etape A: Min Managerprofil flyttet hertil fra Klubhus. Den lå midt i
// spillets daglige arbejdsflade med under 245 sessions/30 dage; den hører til
// de personlige punkter ved Indstillinger, ikke mellem Økonomi og Indbakke.
// #3104 etape D: /pro fik ingen indgang nogen steder i frontend'en — ejeren
// besluttede 27/7 at den skal bo her, gated på at betalingsflowet er
// færdigtestet. Ejer-go 20/8 om at åbne indgangen selv (linket lander på
// /pro-siden, som stadig viser sin egen pause-tilstand indtil CHECKOUT_PAUSED
// flippes separat i backend/lib/billingCheckout.js — de to er bevidst afkoblet).
function buildBottomItems(t, team) {
  return [
    ...(team?.id ? [{ to: `/managers/${team.id}`, label: t("nav.item.managerProfile") }] : []),
    { to: "/profile",     label: t("nav.item.profile") },
    { to: "/pro",         label: t("nav.item.pro") },
    { to: "/help",        label: t("nav.item.help") },
    { to: "/rules",       label: t("nav.item.rules") },
    { to: "/roadmap",     label: t("nav.item.roadmap") },
    // #3811: guld-prik når nyeste patch note-dato er nyere end spillerens
    // localStorage-lastSeen — se lib/patchNotesUnread.js + Layout()'s egne
    // useEffects nedenfor. dotFlags løses op i NavItem, samme recipe som badge.
    { to: "/patch-notes", label: t("nav.item.patchNotes"), dot: true, dotLabel: t("a11y.unreadPatchNotes") },
  ];
}

// #3102: admin-gruppen stod ordret to steder (gruppe-opslaget i useEffect og
// navGroups i render) og var allerede drevet fra hinanden — kun det ene sted
// havde exact:true på /admin, så "Admin" lyste op sammen med underpunktet på
// hver /admin/*-side. Én kilde nu, så de ikke kan drifte igen.
// #3196: waitlist/sprint-metrics/attribution/retention konsolideret til ÉT
// "Vækst"-punkt (/admin/growth, faner internt) — ejer-direktiv om at samle
// vækst-data ét sted i stedet for fire spredte sub-nav-punkter.
// #3498: Fair play (/admin/fairplay, #3138) havde intet nav-punkt, kun direkte
// URL — ejer-beslutning 8/8 om at give den samme synlighed som Vækst.
function buildAdminGroup(t, isOwner = false) {
  return {
    key: "admin", label: t("nav.group.admin"),
    items: [
      { to: "/admin", label: t("nav.item.admin"), exact: true },
      { to: "/admin/growth", label: t("nav.item.growth") },
      { to: "/admin/fairplay", label: t("nav.item.fairplay") },
      // #3750: ejer-only (OWNER_USER_IDS via /api/admin/owner-check) — skjult for andre admins.
      ...(isOwner ? [{ to: "/admin/value-transition", label: t("nav.item.valueTransition") }] : []),
    ],
  };
}

// #3104: `team` udgik som parameter da Min Managerprofil (det eneste punkt der
// brugte holdets id) flyttede til bund-menuen. Grupperne her afhænger nu kun af
// flag-tilstand, så useEffect'ens opslag og render-kaldet ikke længere kan give
// forskellige menuer for samme bruger.
function buildNavGroups(t, academyEnabled = false, facilitiesEnabled = false, scoutSystemEnabled = false) {
  return [
    {
      // #3104 etape A: sorteret efter faktisk brug (Clarity, sessions/30 dage,
      // målt 27/7) i stedet for den historiske rækkefølge punkterne blev tilføjet i.
      // Indbakke var appens 3.-mest besøgte side (6.152) men lå på 10. plads, og
      // Økonomi (2.258) lå efter Bestyrelse (959). Grupperingen er stadig efter
      // opgave — kun rækkefølgen indeni følger tallene.
      key: "klubhus", label: t("nav.group.klubhus"),
      items: [
        { to: "/dashboard",      label: t("nav.item.dashboard") },     // 7.350
        { to: "/notifications",  label: t("nav.item.notifications"), badge: true }, // 6.152
        { to: "/team",           label: t("nav.item.team") },          // 5.955
        { to: "/training",       label: t("nav.item.training") },      // 2.732
        { to: "/finance",        label: t("nav.item.finance") },       // 2.258
        ...(academyEnabled ? [{ to: "/academy", label: t("nav.item.academy") }] : []), // 2.054
        { to: "/board",          label: t("nav.item.board") },         // 959
        ...scoutingNavItem(scoutSystemEnabled, t),                     // 689
        ...facilitiesNavItem(facilitiesEnabled, t),                    // 612
        // #3199: nyt socialt lag — ingen brugsdata endnu, placeret sidst i
        // gruppen indtil Clarity-tallene kan rangere det.
        // #4118/#3451: gul prik ved ulæst tråd-aktivitet — samme prik-recipe
        // som Patch Notes (dot: true, dotFlags i NavItem), ikke et nyt
        // visuelt sprog. Se forumUnread-state + fetchForumUnread nedenfor.
        { to: "/forum", label: t("nav.item.forum"), dot: true, dotLabel: t("a11y.unreadForum") },
        // #3104 etape C: Personale (~400 sessions) er en fane i Klub nu
        // (/klub?tab=staff) — eget nav-punkt udgik, Klubhus 10 → 9 punkter.
      ],
    },
    {
      // #3102 etape 3: alle fire planlægnings-flader (Holdudtagelse · Formplan ·
      // Strategi · Kalender) er faner i Planlægnings-hubben nu — gruppen er endt
      // på ét punkt (kontrakten: én kalender-sandhed, /calendar redirecter).
      // Formplanens kill-switch (peak_planner_enabled) gater ikke længere et
      // nav-punkt; fanen selv viser plannerens tom-state når flaget er off.
      key: "planlaegning", label: t("nav.group.planlaegning"),
      items: [
        { to: "/planning", label: t("nav.item.planning") },
      ],
    },
    {
      key: "marked", label: t("nav.group.marked"),
      items: [
        { to: "/riders",       label: t("nav.item.riders") },
        { to: "/auctions",     label: t("nav.item.auctions") },
        // #987: excludeQuery så "Transfers" ikke lyser op når man står på
        // transferliste-genvejen (?tab=market) — kun én af de to er aktiv.
        // #3521: badge: true — ubesvarede indgående tilbud (samme kilde som
        // Indbakkens "Skal handles"-fane, se buildNavBadgeCounts). Kun det
        // primære punkt, ikke transferliste-genvejen nedenfor.
        { to: "/transfers",    label: t("nav.item.transfers"), excludeQuery: "tab=market", badge: true },
        { to: "/transfers?tab=market", label: t("nav.item.transferList") },
        { to: "/watchlist",    label: t("nav.item.watchlist") },
        // #3104 etape C: Min Aktivitet (<245 sessions) er en fane i Indbakken nu
        // (/notifications?tab=activity) — eget nav-punkt udgik.
      ],
    },
    {
      // #1609: "League"-gruppen nedlagt — Teams/H2H/Season-Preview er konsolideret
      // ind i Standings-hub'en (linse + drawer). Hub'en bor her som "League & standings".
      // #3102 etape 1: gruppen er renset til rene KIGGE-flader — planlægnings-
      // genvejene (holdudtagelse, kalender) er flyttet til Planlægning ovenfor.
      key: "resultater", label: t("nav.group.resultater"),
      items: [
        // #3858: Race Centre er dagens sendeflade og står ØVERST i gruppen —
        // "hvad sker der lige nu" kommer før "hvad er sket".
        { to: "/race-centre",    label: t("nav.item.raceCentre") },
        { to: "/resultater",     label: t("nav.item.results") },
        // #3102 etape 3: "Løb"-punktet udgik — /races er opløst (kalenderen bor
        // i Planlægnings-hubben, verdens-kataloget + de afsluttede løb i
        // Resultat-hubben) og ruten redirecter. Etape 2 holdt bevidst punktet i
        // live én etape ekstra; det her er etapen der opløser det.
        // #3104 etape C: Liga & rangliste (2.233 sessions) + Rytterrangliste
        // (478) + Global Rank (<245) er ét punkt med faner nu (Ranglister-hubben
        // på /standings; de to gamle ruter redirecter) — Resultater 6 → 4 punkter.
        { to: "/standings",      label: t("nav.item.rankings") },
        { to: "/seasons",        label: t("nav.item.seasons") },
      ],
    },
  ];
}

async function authHeaders() {
  const { data: { session } } = await supabase.auth.getSession();
  return { "Content-Type": "application/json", Authorization: `Bearer ${session?.access_token}` };
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

// #4118/#3451: nav-prikkens kilde — ÉT let kald, ikke et N+1-opslag pr.
// tråd (se getForumUnreadStatus, backend/lib/forum.js). Fejl (netværk/401
// under en session-fornyelse) lader prikkens sidst kendte tilstand stå i
// stedet for at fejle synligt — samme ikke-kritisk-UI-filosofi som patch-
// notes-metaen ovenfor.
async function fetchForumUnread(headers) {
  if (!API || !headers) return null;
  try {
    const res = await fetch(`${API}/api/forum/unread-status`, { headers });
    if (!res.ok) return null;
    const data = await res.json().catch(() => null);
    return typeof data?.has_unread === "boolean" ? data.has_unread : null;
  } catch {
    return null;
  }
}

function NavItem({ to, label, badge, dot, dotLabel, onClick, location, badgeCounts, dotFlags, exact, excludeQuery, excludePaths, title }) {
  const isActive = pathMatchesNavItem(location, { to, exact, excludeQuery, excludePaths });
  // #3521: badge-tallet er nu item-specifikt (Indbakke ≠ Transfers) — se
  // navBadges.js. resolveNavBadgeCount returnerer 0 for items uden badge: true.
  const badgeValue = resolveNavBadgeCount({ to, badge }, badgeCounts);
  const showBadge = badgeValue > 0;
  // #3811: ulæst-prik (Patch Notes) — samme item-specifikke opslags-recipe som
  // badge ovenfor, men boolean i stedet for tal (ingen "hvor mange", kun "nyt").
  const showDot = resolveNavDot({ to, dot }, dotFlags);
  // #3102: Link, ikke NavLink. NavLink beregner selv aktiv-tilstand på et rent
  // prefix-match og sætter aria-current="page" ud fra DEN — den kender hverken
  // excludeQuery eller excludePaths. Med tre nav-items under /races-prefixet
  // (Løb · Holdudtagelse · Holdstrategi) annoncerede skærmlæsere derfor alle tre
  // som current page, selv om kun én var fremhævet visuelt. Vi ejer allerede
  // isActive her, så Link + vores eget aria-current er den ene sandhed.
  return (
    <Link to={to} onClick={onClick} title={title} aria-current={isActive ? "page" : undefined}
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
        <span className="bg-cz-accent text-cz-on-accent text-3xs font-black px-1.5 py-0.5 rounded-full leading-none flex-shrink-0 tabular-nums">
          {formatNavBadgeCount(badgeValue)}
        </span>
      )}
      {/* #3811: ulæst-prik — bevidst en ren prik (ikke et tal, "hvor mange nye
          patch notes" er ikke en meningsfuld optælling for spilleren), samme
          guld som badgen ovenfor. Forsvinder når /patch-notes åbnes (Layout()). */}
      {showDot && (
        <span className="flex-shrink-0" title={dotLabel}>
          <span aria-hidden="true" className="block w-2 h-2 rounded-full bg-cz-accent" />
          <span className="sr-only">{dotLabel}</span>
        </span>
      )}
      {/* #481 PR-2: hover indicator — the wordmark's short thick accent-dash, scales
          in from the left on hover (inactive only; active needs no affordance). Decorative. */}
      {!isActive && (
        <span aria-hidden="true"
          className="pointer-events-none absolute left-3 bottom-1 h-0.5 w-5 rounded-full bg-cz-accent origin-left scale-x-0 transition-transform duration-200 ease-out group-hover:scale-x-100 motion-reduce:transition-none" />
      )}
    </Link>
  );
}

function SidebarContent({ onNav, navigate, team, balance, onlineCount, navGroups, bottomItems, openGroups, toggleGroup, signOut, location, badgeCounts, dotFlags, logoutLabel, onOpenFeedback, contactLabel }) {
  const { t } = useTranslation("common");
  const { isPro, isFounder } = useSubscription(team?.id);
  return (
    <div className="flex flex-col h-full">
      {/* Logo + team */}
      <button
        onClick={() => navigate("/dashboard")}
        aria-label="Cycling Zone"
        className="flex items-center px-4 py-6 border-b border-cz-sidebar-border w-full text-left hover:bg-cz-sidebar-hover transition-colors">
        {/* #671 Slice B: wordmark = primaer brand-mark (BRAND_BRIEF). Det redundante
            CZ-monogram er fjernet — monogram + wordmark + team-navn var tre identitets-
            elementer i samme hjoerne. Sidebar-canvas altid navy → forceDark wordmark.
            #2181: holdnavnet er fjernet fra dette hjørne (det står andre steder på
            siden). Ejer-godkendt variant A (18/8): wordmarket fylder headeren i
            stedet for kun at sidde i hjørnet — skaleret til kolonnens fulde
            indholdsbredde (w-full/h-auto, ikke den gamle faste h-5) minus normal
            kant-padding (~3x tidligere størrelse), venstrestillet så det flugter
            med nav-punkternes indryk, med ekstra lodret luft (py-6) så headeren
            får vægt. Bredere nav-header/IA-restructure spores i #1027. */}
        <div className="w-full min-w-0">
          <Wordmark forceDark className="w-full h-auto" alt="" />
          {/* Founder-badge er permanent status, selv efter subscription-udløb (#1903);
              plain Pro-badge kræver stadig aktiv Pro. */}
          {(isPro || isFounder) && (
            <div className="mt-2">
              <ProBadge isFounder={isFounder} />
            </div>
          )}
        </div>
      </button>

      {/* Balance — guard mod undefined (jf. #446 bootstrap-race) */}
      {balance != null && (
        <div className="px-4 py-3 border-b border-cz-sidebar-border">
          <p className="text-3xs text-cz-sidebar-3 uppercase tracking-widest mb-0.5">{t("sidebar.balance")}</p>
          <p className="text-cz-accent font-mono font-bold text-sm leading-tight" title={t("sidebar.balanceTooltip")}>
            {formatNumber(balance)} CZ$
          </p>
          {team?.division != null && (
            <p className="text-cz-sidebar-3 text-3xs mt-0.5" title={t("sidebar.divisionTooltip")}>{t("sidebar.division", { division: team.division })}</p>
          )}
        </div>
      )}

      {/* Online indicator */}
      {onlineCount > 0 && (
        <div className="px-4 py-2 border-b border-cz-sidebar-border">
          <span className="inline-flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-cz-success" />
            <span className="text-cz-sidebar-3 text-3xs">{t("sidebar.onlineNow", { count: onlineCount })}</span>
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
                <span className="text-3xs font-bold uppercase tracking-[0.14em] text-cz-sidebar-3 group-hover:text-cz-sidebar-2 transition-colors">
                  {group.label}
                </span>
                <ChevronDownIcon aria-hidden="true" className={`w-3 h-3 text-cz-sidebar-3 group-hover:text-cz-sidebar-2 transition-all duration-200 ${isOpen ? "rotate-180" : ""}`} />
              </button>

              {isOpen && (
                <div className="py-0.5">
                  {group.items.map(item => (
                    <NavItem key={item.to} {...item} onClick={onNav} location={location} badgeCounts={badgeCounts} dotFlags={dotFlags} />
                  ))}
                </div>
              )}
            </div>
          );
        })}

        {/* Bottom nav items */}
        <div className="h-px bg-cz-sidebar-border my-3 mx-4" />
        {bottomItems.map(item => (
          <NavItem key={item.to} {...item} onClick={onNav} location={location} badgeCounts={badgeCounts} dotFlags={dotFlags} />
        ))}

        {/* #2602: Contact/feedback-indgang — samme sted som Help (bottom nav),
            IKKE en flydende knap. Åbner FeedbackModal i stedet for at navigere,
            derfor et rent button-element frem for NavItem (som altid er et Link). */}
        <button
          type="button"
          onClick={() => { onNav?.(); onOpenFeedback?.(); }}
          className="group relative flex items-center w-full mx-2 px-3 py-2 rounded-lg text-[13px] text-cz-sidebar-2 hover:text-cz-sidebar-1 hover:bg-cz-sidebar-hover transition-all duration-150"
        >
          <span className="flex items-center gap-2.5 min-w-0">
            <span aria-hidden="true" className="w-1.5 h-1.5 rounded-full flex-shrink-0 bg-cz-sidebar-3 group-hover:bg-cz-sidebar-2 transition-colors duration-150" />
            <span className="truncate">{contactLabel}</span>
          </span>
        </button>

        {/* #679: fast Discord-join-link mod community-serveren (ekstern). */}
        <DiscordJoinLink variant="sidebar" label={t("sidebar.joinDiscord")} onClick={onNav} className="mt-1" />
      </nav>

      {/* Footer */}
      <div className="border-t border-cz-sidebar-border px-4 py-3 flex items-center justify-between gap-2">
        <button
          onClick={signOut}
          className="inline-flex items-center gap-1 text-2xs text-cz-sidebar-3 hover:text-cz-sidebar-2 transition-colors">
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
  // #3811: ulæst-prik ved "Patch Notes" — patchNotesLatestDate er nyeste patch-
  // dato (fra den lette patch-notes-meta.json), patchNotesUnread er den afledte
  // boolean NavItem viser prikken ud fra. Se effekten nederst i komponenten.
  const [patchNotesLatestDate, setPatchNotesLatestDate] = useState(null);
  const [patchNotesUnread, setPatchNotesUnread]         = useState(false);
  // #4118/#3451: gul prik ved "Forum" i navigationen — samme prik-recipe som
  // Patch Notes, men serverdrevet (forumUnread kommer fra
  // GET /api/forum/unread-status, ikke en lokal dato-sammenligning).
  const [forumUnread, setForumUnread]                   = useState(false);
  const [isAdmin, setIsAdmin]               = useState(false);
  const [isOwner, setIsOwner]               = useState(false); // #3750 ejer-only-menupunkter
  const [mobileOpen, setMobileOpen]         = useState(false);
  const [feedbackOpen, setFeedbackOpen]     = useState(false);
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
  // #1441 A3: Klub-nav gater på API'ets `enabled` (403 facilities_disabled →
  // false), samme flag-kilde som selve /klub-siden. Skjult i prod indtil ejer-flip.
  const { enabled: facilitiesEnabled } = useFacilities();
  // #2244 Fase 3: Scouting-central-nav gater på scout_system_enabled (kill-switch,
  // ikke beta-gate) — samme flag /api/scouting/me rapporterer til siden selv.
  const { enabled: scoutSystemEnabled } = useScoutingCentral();
  // #3102 etape 3: peak_planner-nav-gaten (usePlanner) udgik — Formplan er en
  // fane i Planlægnings-hubben, og fanen selv viser tom-staten ved kill-switch.
  const heartbeatRef = useRef(null);
  const isWideContent = WIDE_CONTENT_ROUTES.has(location.pathname);
  // #3521: Transfers-menupunktets badge — ubesvarede indgående tilbud. Samme
  // kanoniske kilde som Indbakkens "Skal handles"-fane (useActionSummary →
  // /api/inbox/pending), IKKE en ny beregning; hooket polyfetcher + realtime-
  // opdaterer sig selv (useRealtimeRefetch), så badgen forsvinder automatisk
  // når alle tilbud er besvaret uden ekstra wiring her.
  const { pending: pendingActions } = useActionSummary();
  const badgeCounts = buildNavBadgeCounts({ unread, pendingOffersCount: pendingActions.counts.total });

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
    const groups = buildNavGroups(t, academyEnabled, facilitiesEnabled, scoutSystemEnabled);
    if (isAdmin) groups.push(buildAdminGroup(t, isOwner));
    // #3104: /managers/-fallbacken der åbnede Klubhus er udgået sammen med
    // flytningen — Min Managerprofil bor nu i bund-menuen, som ikke er en
    // foldbar gruppe, så der er ingen gruppe at åbne for den rute længere.
    const activeGroup = groups.find(g => g.items.some(i => pathMatchesNavItem(location, i)));
    if (activeGroup) setOpenGroups(prev => ({ ...prev, [activeGroup.key]: true }));
    setMobileOpen(false);
  }, [location, isAdmin, isOwner, t, academyEnabled, facilitiesEnabled, scoutSystemEnabled]);

  useEffect(() => {
    supabase.auth.getSession().then(async ({ data: { session } }) => {
      if (!session) return;
      setSession(session);

      const { data: userData } = await supabase.from("users")
        .select("role, username").eq("id", session.user.id).single();
      setIsAdmin(userData?.role === "admin");
      if (userData?.role === "admin") {
        // #3750: kun ejeren (OWNER_USER_IDS) ser ejer-only-punkter. Fail-closed: fejl ⇒ skjult.
        try {
          const r = await fetch(`${API}/api/admin/owner-check`, { headers: { Authorization: `Bearer ${session.access_token}` } });
          const d = r.ok ? await r.json() : null;
          setIsOwner(Boolean(d?.isOwner));
        } catch {
          // best-effort: ejer-check er kun menu-synlighed; backend håndhæver selve gaten.
          setIsOwner(false);
        }
      }
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
      fetchForumUnread(h).then((hasUnread) => { if (hasUnread != null) setForumUnread(hasUnread); });
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
    // #4010: subscribeAuthedChannel sætter realtime-token'et eksplicit før
    // subscribe(). Session-tjekket ovenfor er ikke nok i sig selv — supabase-js
    // slår selv token op og falder tilbage til api-nøglen hvis opslaget kommer
    // tomt tilbage midt i auth-init.
    return subscribeAuthedChannel("layout-notifs-v2", channel =>
      channel.on("postgres_changes", { event: "*", schema: "public", table: "notifications", filter: `user_id=eq.${session.user.id}` },
        async () => {
          setUnread(await fetchUnreadCount(session.user.id));
          const { data: t } = await supabase.from("teams").select("balance").eq("user_id", session.user.id).single();
          if (t) setBalance(t.balance);
        })
    );
  }, [session]);

  // #4118/#3451: forum_posts/forum_replies har allerede en SELECT-policy
  // udelukkende for Realtime (#3199) — genbruges her til at genberegne
  // nav-prikken hurtigt (i stedet for at vente op til 60s på heartbeatet
  // nedenfor) når NOGEN poster/svarer, ikke kun requesterens egen aktivitet.
  useEffect(() => {
    if (!session) return;
    return subscribeAuthedChannel("layout-forum-unread", channel => {
      const refetch = async () => {
        const h = await authHeaders();
        const hasUnread = await fetchForumUnread(h);
        if (hasUnread != null) setForumUnread(hasUnread);
      };
      channel
        .on("postgres_changes", { event: "*", schema: "public", table: "forum_posts" }, refetch)
        .on("postgres_changes", { event: "*", schema: "public", table: "forum_replies" }, refetch);
    });
  }, [session]);

  // #4118/#3451: ForumPostPage markerer tråden læst server-side ved åbning
  // (GET /api/forum/posts/:id) — window-event så prikken forsvinder MED DET
  // SAMME i stedet for at vente på næste heartbeat/realtime-tick, samme
  // event-i-stedet-for-prop-drilling-mønster som "cz:notif-deleted".
  useEffect(() => {
    if (!session) return;
    async function handleForumRead() {
      const h = await authHeaders();
      const hasUnread = await fetchForumUnread(h);
      if (hasUnread != null) setForumUnread(hasUnread);
    }
    window.addEventListener("cz:forum-thread-read", handleForumRead);
    return () => window.removeEventListener("cz:forum-thread-read", handleForumRead);
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

  // #3811: henter kun den lette patch-notes-meta.json (ikke hele changelog'en) —
  // uafhængig af session, statisk asset, ingen auth nødvendig. Fejl (netværk/404
  // i et miljø uden build-emittet asset) lader prikken forblive skjult i stedet
  // for at fejle synligt — den er ikke-kritisk UI.
  useEffect(() => {
    let active = true;
    loadPatchNotesMeta()
      .then((meta) => { if (active && meta?.date) setPatchNotesLatestDate(meta.date); })
      .catch(() => { /* netværksfejl: prikken forbliver skjult */ });
    return () => { active = false; };
  }, []);

  // #3811: markér som læst med det samme /patch-notes åbnes (ingen genindlæsning
  // krævet) + genberegn ulæst-status hver gang nyeste dato bliver kendt ELLER
  // ruten skifter. Samme localStorage-nøgle som PatchNotesPage.jsx's egen
  // mark-as-read-effekt (LAST_SEEN_KEY i lib/patchNotesUnread.js), så de to
  // aldrig kan komme ud af sync.
  useEffect(() => {
    if (!patchNotesLatestDate) return;
    if (location.pathname.startsWith("/patch-notes")) {
      writeLastSeenPatchNotes(patchNotesLatestDate);
      setPatchNotesUnread(false);
    } else {
      setPatchNotesUnread(isPatchNotesUnread(patchNotesLatestDate, readLastSeenPatchNotes()));
    }
  }, [patchNotesLatestDate, location.pathname]);

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

  // #3012: supabase-js's signOut({ scope: "global" }, default) rydder ALTID
  // den lokale session først, selv når server-siden revoke fejler (fx
  // netværksfejl) — se GoTrueClient._signOut. Spilleren bliver derfor korrekt
  // logget ud lokalt uanset, så der er intet UI at rulle tilbage og ingen
  // besked der ville nå frem (siden skifter med det samme). Fejlen skal dog
  // stadig kunne ses — før forsvandt den sporløst.
  async function signOut() {
    const { error } = await supabase.auth.signOut();
    if (error) reportActionFailure("auth_sign_out", { reason: error.message });
    navigate("/login");
  }

  function toggleGroup(key) { setOpenGroups(prev => ({ ...prev, [key]: !prev[key] })); }

  function handleSetupComplete(updatedTeam) {
    setTeam(updatedTeam);
    setBalance(updatedTeam.balance);
  }

  const baseGroups = buildNavGroups(t, academyEnabled, facilitiesEnabled, scoutSystemEnabled);
  const navGroups = isAdmin ? [...baseGroups, buildAdminGroup(t, isOwner)] : baseGroups;
  const bottomItems = buildBottomItems(t, team);

  const needsSetup = teamLoaded && !team?.manager_name;
  // #3811: ulæst-prik-flag pr. `to` — samme recipe som badgeCounts ovenfor.
  // #4118/#3451: forum-prikken lever uden for buildNavDotFlags (den er
  // patch-notes-specifik og lokalt drevet) — samme kort, egen nøgle.
  const dotFlags = { ...buildNavDotFlags({ patchNotesUnread }), "/forum": forumUnread };
  const sidebarProps = {
    navigate, team, balance, onlineCount, navGroups, bottomItems, openGroups, toggleGroup, signOut, location, badgeCounts, dotFlags,
    logoutLabel: t("nav.item.logout"),
    onOpenFeedback: () => setFeedbackOpen(true),
    contactLabel: t("nav.item.contact"),
  };

  return (
    <div className="min-h-screen bg-cz-body flex">
      {/* Desktop sidebar — persistent nav chrome (like MobileQuickNav), NOT a
          transient overlay: it's always mounted, main content is pushed right
          via md:ms-52 so nothing legitimately competes with it spatially.
          z-overlay is reserved for dismissible layers (the mobile drawer
          below, backdrops, tours) — giving the static sidebar that tier
          buried anything portaled near it (#2880 CI regression: the
          LanguageSwitcher's portaled dropdown, anchored inside this sidebar's
          footer, uses a fixed z-index and was left below it). z-nav keeps the
          sidebar above sticky page content while staying under dropdown-tier
          portals/modals/toasts. */}
      <aside className="hidden md:flex flex-col w-52 flex-shrink-0 bg-cz-sidebar border-r border-cz-sidebar-border fixed top-0 left-0 h-full z-nav">
        <SidebarContent {...sidebarProps} onNav={() => {}} />
      </aside>

      {/* Mobile sidebar overlay — genuinely transient/dismissible (backdrop +
          click-away), so z-overlay is correct here. */}
      {mobileOpen && (
        <div className="fixed inset-0 z-overlay md:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setMobileOpen(false)} />
          <aside className="absolute left-0 top-0 h-full w-52 bg-cz-sidebar border-r border-cz-sidebar-border z-10">
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
        {/* #3941 — Race Control driftsbanner: øverst på ALLE manager-sider, under
            den (mobile) top-nav og over den paddede indholds-wrapper. Renderer
            intet når der ingen aktive ops_notices er (fetch fejler stille). */}
        <RaceControlBanner />

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
                <span className="absolute -top-1 -right-1 bg-cz-accent text-cz-on-accent text-3xs font-black min-w-3.5 h-3.5 px-0.5 rounded-full flex items-center justify-center leading-none tabular-nums">
                  {formatNavBadgeCount(unread)}
                </span>
              )}
            </NavLink>
          </div>
        </div>

        {/* #2849 bølge 4: kanonisk side-padding jf. PAGE_TEMPLATES.md — pt-7 px-8
            pb-16 på desktop, 16px sider på mobil. pb-24 på mobil er IKKE spec-drift:
            den clearer den fixede MobileQuickNav-bar. T3-full-bleed-ruter får ingen
            padding/cap — siden ejer selv hero-bleed + indre containere. */}
        <div className={isFullBleedRoute(location.pathname)
          ? ""
          : `pt-4 px-4 pb-24 md:pt-7 md:px-8 md:pb-16 mx-auto ${isWideContent ? "max-w-full" : "max-w-6xl"}`}>
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
      {/* #2602: én modal-instans delt af desktop- og mobil-sidebaren (begge
          knapper kalder samme setFeedbackOpen via sidebarProps). */}
      {feedbackOpen && (
        <Suspense fallback={null}>
          <FeedbackModal open={feedbackOpen} onClose={() => setFeedbackOpen(false)} />
        </Suspense>
      )}
    </div>
  );
}
