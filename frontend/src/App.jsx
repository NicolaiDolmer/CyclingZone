import { Routes, Route, Navigate, useLocation, useSearchParams, useNavigate } from "react-router";
import { Suspense, useEffect, useState } from "react";
import { parseAuthErrorHash, isExpiredOrDeniedAuthError } from "./lib/authErrorHash.js";
// #881: lazyWithRetry erstatter React.lazy så stale-chunk-fejl efter deploy bliver
// recoverable (retry + genkendelig ChunkLoadError -> auto-reload via SentryBoundary).
import { lazyWithRetry as lazy } from "./lib/lazyWithRetry.js";
import { supabase } from "./lib/supabase";
import CookieBanner from "./components/CookieBanner.jsx";
// LandingPage er eager (ikke lazy): den prerendres ved build og hydreres på "/",
// så komponenten SKAL være synkront tilgængelig ved klientens første render —
// en lazy-suspense-fallback ville ellers give et hydration-mismatch.
import LandingPage from "./pages/LandingPage.jsx";
import { logSessionStart } from "./lib/logEvent";
import { setSentryUser, clearSentryUser } from "./lib/sentry.jsx";
import { safeNextPath } from "./lib/safeNextPath.js";

// Layout + analytics integrations lazy-loaded for #479: public routes
// (/founder-supporter, /login, /privacy-*) ikke betaler for app-shell + Clarity/Vercel
// SDK'er i main-bundlen. Analytics-komponenterne er allerede consent-gated så ingen
// netværkskald før samtykke; lazy-load tager dem også ud af cold-start payload.
const Layout = lazy(() => import("./components/Layout"));
const ClarityIntegration = lazy(() => import("./lib/clarityIntegration.jsx"));
const WebVitalsIntegration = lazy(() => import("./lib/webVitalsIntegration.jsx"));
const VercelAnalyticsIntegration = lazy(() => import("./lib/vercelAnalyticsIntegration.jsx"));
const GaIntegration = lazy(() => import("./lib/gaIntegration.jsx"));
// #2040: anonym, storage-less engagement-beacon for den logget-UD cold-population
// (logget-ind måles via player_events). Consent-uafhængig, ingen storage på enheden.
const TrafficBeacon = lazy(() => import("./components/TrafficBeacon.jsx"));

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
const AdminFeedbackTab = lazy(() => import("./pages/admin/AdminFeedbackTab"));
const AdminDataTab = lazy(() => import("./pages/admin/AdminDataTab"));
const AdminSystemTab = lazy(() => import("./pages/admin/AdminSystemTab"));
// #3196: waitlist/sprint-metrics/attribution/retention er konsolideret som
// faner i AdminGrowthPage — deres filer eksporterer nu kun *Content()-
// komponenter (genbrugt derfra), ingen standalone route/lazy-import længere.
const AdminGrowthPage = lazy(() => import("./pages/AdminGrowthPage"));
const RankingsHubPage = lazy(() => import("./pages/RankingsHubPage"));
const BoardPage = lazy(() => import("./pages/BoardPage"));
const RiderStatsPage = lazy(() => import("./pages/RiderStatsPage"));
const TeamProfilePage = lazy(() => import("./pages/TeamProfilePage"));
const NotificationsPage = lazy(() => import("./pages/NotificationsPage"));
const RiderComparePage = lazy(() => import("./pages/RiderComparePage"));
const WatchlistPage = lazy(() => import("./pages/WatchlistPage"));
const HelpPage = lazy(() => import("./pages/HelpPage"));
const PatchNotesPage = lazy(() => import("./pages/PatchNotesPage"));
const RoadmapPage = lazy(() => import("./pages/RoadmapPage"));
const RulesPage = lazy(() => import("./pages/RulesPage"));
const PrivacyPolicyPage = lazy(() => import("./pages/PrivacyPolicyPage"));
const PrivacyPolicyPageEn = lazy(() => import("./pages/PrivacyPolicyPageEn"));
const TermsPage = lazy(() => import("./pages/TermsPage"));
const TermsPageEn = lazy(() => import("./pages/TermsPageEn"));
const FounderSupporterPage = lazy(() => import("./pages/FounderSupporterPage"));
const ProUpgradePage = lazy(() => import("./pages/ProUpgradePage"));
const KitchenSinkPage = lazy(() => import("./pages/KitchenSinkPage"));
const SeasonEndPage = lazy(() => import("./pages/SeasonEndPage"));
const ResultaterPage = lazy(() => import("./pages/ResultaterPage"));
const RaceHistoryPage = lazy(() => import("./pages/RaceHistoryPage"));
const RaceDetailPage = lazy(() => import("./pages/RaceDetailPage"));
const ManagerProfilePage = lazy(() => import("./pages/ManagerProfilePage"));
const FinancePage = lazy(() => import("./pages/FinancePage"));
const SeasonFinanceReport = lazy(() => import("./pages/SeasonFinanceReport"));
const ProfilePage = lazy(() => import("./pages/ProfilePage"));
const TrainingPage = lazy(() => import("./pages/TrainingPage"));
const AcademyPage = lazy(() => import("./pages/AcademyPage"));
const KlubPage = lazy(() => import("./pages/KlubPage"));
const ScoutingCentralPage = lazy(() => import("./pages/ScoutingCentralPage"));
const PlanningHubPage = lazy(() => import("./pages/PlanningHubPage"));
const StaffProfilePage = lazy(() => import("./pages/StaffProfilePage"));

// #3102 etape 3: /races er opløst — kalender-fanen (holdudtagelses-boardet) bor
// i Planlægnings-hubben, verdens-kataloget i Resultat-hubbens Arkiv, og de
// afsluttede løb + resultat-panelet i Resultat-hubbens Seneste. Query-afhængig
// redirect kræver en komponent (Navigate kan ikke selv læse ?tab=) — samme
// mønster som den gamle RacesPageRoute-wrapper.
function RacesLegacyRedirect() {
  const [searchParams] = useSearchParams();
  const tab = searchParams.get("tab");
  if (tab === "calendar") return <Navigate to="/planning" replace />;
  if (tab === "world" || tab === "library") return <Navigate to="/resultater?tab=archive" replace />;
  if (tab === "points") return <Navigate to="/resultater?tab=points" replace />;
  return <Navigate to="/resultater" replace />;
}

// /planner → Formplan-fanen. Plannerens gamle indre ?tab= (squad/season/races)
// oversættes til hubbens ?view= — races-fanen er nedlagt og falder til default.
function PlannerLegacyRedirect() {
  const [searchParams] = useSearchParams();
  const view = searchParams.get("tab") === "season" ? "&view=season" : "";
  return <Navigate to={`/planning?tab=form${view}`} replace />;
}

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
  const location = useLocation();
  // #1347: session === undefined = endnu ukendt (getSession kører). Vis loader frem
  // for straks at redirecte, så en allerede indlogget bruger ikke blinker forbi login.
  // Var tidligere en GLOBAL gate i App; flyttet hertil så de offentlige ruter
  // (landing/login) kan males straks — forudsætning for ren prerender-hydration på "/".
  if (session === undefined) return <LoadingScreen />;
  if (!session) {
    // #2042: bevar deep-link-destinationen så cold trafik der opretter en konto
    // lander på det de kom for, ikke en generisk /dashboard-omvej.
    const next = encodeURIComponent(location.pathname + location.search);
    return <Navigate to={`/login?next=${next}`} replace />;
  }
  return children;
}

// #2042: kontekst-bevidst /login-rute. En logget-ind bruger (eller en der lige har
// oprettet konto / logget ind) sendes til sin oprindelige ?next-destination.
function LoginRoute({ session }) {
  const [params] = useSearchParams();
  if (session) {
    return <Navigate to={safeNextPath(params.get("next")) || "/dashboard"} replace />;
  }
  return <LoginPage />;
}

export default function App() {
  const [session, setSession] = useState(undefined);
  // Client-only mount-flag: holder lazy/analytics-Suspense ude af prerenderens
  // server-render (renderToString kan ikke fuldføre en lazy boundary → React #419).
  const [mounted, setMounted] = useState(false);
  const navigate = useNavigate();

  // #2078: en udløbet/ugyldig email-confirm-link redirecter til Site URL ("/")
  // med fejlen i hash'et (#error=access_denied&error_code=otp_expired...) og
  // UDEN session. Uden dette landede brugeren tavst på landing page. Vi fanger
  // fejl-hash'et ved mount, fjerner det fra URL'en (så et refresh ikke gentager
  // det) og sender brugeren til /login med en klar besked + resend-adgang.
  // Kør FØR getSession-effekten så vi ikke blinker forbi landing-flowet.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const parsed = parseAuthErrorHash(window.location.hash);
    if (!isExpiredOrDeniedAuthError(parsed)) return;
    // Ryd hash'et (bevar path + query) så beskeden ikke gentages ved refresh og
    // fejl-fragmentet ikke lækker videre i historikken.
    window.history.replaceState(null, "", window.location.pathname + window.location.search);
    navigate("/login", { replace: true, state: { authLinkError: parsed.errorCode || parsed.error } });
  }, [navigate]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session);
      if (session) {
        // #621 item 2 — tag Sentry-events med user.id (UUID, ingen PII) så
        // "Affected users"-counter virker. Initial session-restore-path.
        setSentryUser(session.user?.id);
        logSessionStart();
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
        logSessionStart();
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

  useEffect(() => {
    setMounted(true);
  }, []);

  // Ingen global session-gate længere: offentlige ruter (/, /login, ...) renderer
  // straks (session === undefined → falsy → landing/login). Beskyttede ruter venter
  // på session i ProtectedRoute. Forudsætning for at den prerendrede landing kan
  // hydreres rent — klientens første render på "/" giver LandingPage.
  return (
    // Routeren leveres af entry'et (BrowserRouter i main.jsx, StaticRouter i
    // entry-server.jsx). #969 v7_startTransition bor nu på den BrowserRouter.
    <>
      {/* Analytics + traffic-beacon er client-only (consent/browser-API'er) og lazy.
          Mount FØRST efter hydration, så de ikke indgår i prerenderens server-render
          — en lazy Suspense-boundary kan ikke fuldføres på serveren → React #419. */}
      {mounted && (
        <Suspense fallback={null}>
          <ClarityIntegration />
          <WebVitalsIntegration />
          <VercelAnalyticsIntegration />
          <GaIntegration />
          <TrafficBeacon session={session} />
        </Suspense>
      )}
      <Suspense fallback={<RouteFallback />}>
        <Routes>
          <Route path="/login" element={<LoginRoute session={session} />} />
          <Route path="/reset-password" element={<ResetPasswordPage session={session} />} />
          <Route path="/privatlivspolitik" element={<PrivacyPolicyPage />} />
          <Route path="/privacy-policy" element={<PrivacyPolicyPageEn />} />
          <Route path="/handelsbetingelser" element={<TermsPage />} />
          <Route path="/terms" element={<TermsPageEn />} />
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
            {/* #3104 etape C: personale-oversigten er en fane i Klub nu (~400
                sessions/30 dage mod Klubs 612 — samme flag-gate i forvejen). */}
            <Route path="staff" element={<Navigate to="/klub?tab=staff" replace />} />
            <Route path="staff/:id" element={<StaffProfilePage />} />
            <Route path="auctions" element={<AuctionsPage />} />
            <Route path="auctions/history" element={<AuctionHistoryPage />} />
            <Route path="transfers" element={<TransfersPage />} />
            <Route path="team" element={<TeamPage />} />
            {/* #1609: Teams/H2H/Season-Preview konsolideret ind i Standings-hub'en.
                Bevarer dybe links via redirect (eget hold som Compare-A på H2H). */}
            <Route path="teams" element={<Navigate to="/standings" replace />} />
            <Route path="teams/:id" element={<TeamProfilePage />} />
            {/* #3104 etape C: /standings er Ranglister-hubben (Liga & rangliste ·
                Rytterrangliste · Global Rank som faner). ?view=/?compare=-dybe
                links lander uændret på liga-fanen (default). */}
            <Route path="standings" element={<RankingsHubPage />} />
            <Route path="board" element={<BoardPage />} />
            <Route path="notifications" element={<NotificationsPage />} />
            <Route path="compare" element={<RiderComparePage />} />
            <Route path="profile" element={<ProfilePage />} />
            <Route path="pro" element={<ProUpgradePage />} />
            <Route path="pro/success" element={<ProUpgradePage />} />
            {/* #3104 etape C: Min Aktivitet (<245 sessions/30 dage) er en fane i
                Indbakken (6.152) nu — markeds-handlingscentret bor hvor spillerne
                allerede kigger efter "hvad kræver min opmærksomhed". */}
            <Route path="activity" element={<Navigate to="/notifications?tab=activity" replace />} />
            <Route path="activity-feed" element={<Navigate to="/notifications" replace />} />
            <Route path="watchlist" element={<WatchlistPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="rules" element={<RulesPage />} />
            {/* #2359: HoF-fladen afløses af verdenshistorik (S3); route redirecter, side-kode
                bevares indtil narrativ-fladen erstatter den — se HallOfFamePage.jsx. */}
            <Route path="hall-of-fame" element={<Navigate to="/standings" replace />} />
            <Route path="season-preview" element={<Navigate to="/standings?view=strength" replace />} />
            <Route path="head-to-head" element={<Navigate to="/standings?compare=1" replace />} />
            <Route path="patch-notes" element={<PatchNotesPage />} />
            <Route path="roadmap" element={<RoadmapPage />} />
            {/* #3102 etape 3: Planlægnings-hubben (Holdudtagelse · Formplan ·
                Strategi · Kalender). De fire gamle ruter redirecter med
                fane-mapping. */}
            <Route path="planning" element={<PlanningHubPage />} />
            <Route path="races" element={<RacesLegacyRedirect />} />
            <Route path="races/strategy" element={<Navigate to="/planning?tab=strategy" replace />} />
            <Route path="races/:raceId" element={<RaceDetailPage />} />
            <Route path="seasons" element={<SeasonEndPage />} />
            <Route path="seasons/:seasonId" element={<SeasonEndPage />} />
            <Route path="season-end" element={<Navigate to="/seasons" replace />} />
            <Route path="resultater" element={<ResultaterPage />} />
            {/* #3102 etape 3 (PR 3): kalenderen er en fane i Planlægnings-hubben
                — én kalender-sandhed. Siden havde ingen URL-båret indre tilstand
                (faner/sæson/måned er komponent-state), så redirect'en er statisk. */}
            <Route path="calendar" element={<Navigate to="/planning?tab=calendar" replace />} />
            {/* #3104 etape C: begge bor som faner i Ranglister-hubben (/standings). */}
            <Route path="rider-rankings" element={<Navigate to="/standings?tab=riders" replace />} />
            <Route path="global-rank" element={<Navigate to="/standings?tab=global" replace />} />
            {/* #3102 etape 2: arkivet flyttede fra /races til Resultat-hubben. */}
            <Route path="race-archive" element={<Navigate to="/resultater?tab=archive" replace />} />
            <Route path="race-archive/:raceSlug" element={<RaceHistoryPage />} />
            <Route path="finance" element={<FinancePage />} />
            <Route path="seasons/:seasonId/finance/:teamId" element={<SeasonFinanceReport />} />
            {/* #3102 etape 1: /race-points var en orphan — ingen nav-indgang og
                ingen links siden point-tabellen blev en fane i /races. Samme
                redirect-mønster som /race-archive ovenfor (siden selv lever
                videre som tab-indhold). Etape 2: fanen bor i Resultat-hubben nu. */}
            <Route path="race-points" element={<Navigate to="/resultater?tab=points" replace />} />
            <Route path="managers/:teamId" element={<ManagerProfilePage />} />
            {/* Redirect-målene er ABSOLUTTE med vilje. React Router v7 opløser relative
                paths inde i en splat-route mod HELE den matchede location (splat
                inklusive), ikke mod route-path'en uden splat som v6 gjorde. Et relativt
                to="season" på splat-linjen ville derfor sende /admin/bogus videre til
                /admin/bogus/season → ny splat-match → redirect-loop. */}
            <Route path="admin" element={<AdminLayout />}>
              <Route index element={<Navigate to="/admin/season" replace />} />
              <Route path="season"  element={<AdminSeasonTab />} />
              <Route path="economy" element={<AdminEconomyTab />} />
              <Route path="users"   element={<AdminUsersTab />} />
              <Route path="feedback" element={<AdminFeedbackTab />} />
              <Route path="data"    element={<AdminDataTab />} />
              <Route path="system"  element={<AdminSystemTab />} />
              <Route path="*"       element={<Navigate to="/admin/season" replace />} />
            </Route>
            <Route path="admin/growth" element={<AdminGrowthPage />} />
            {/* #3196: gamle standalone-ruter redirecter til deres fane i det
                samlede vækst-dashboard, så eksisterende bogmærker/links ikke knækker. */}
            <Route path="admin/waitlist" element={<Navigate to="/admin/growth?tab=waitlist" replace />} />
            <Route path="admin/sprint-metrics" element={<Navigate to="/admin/growth?tab=sprint" replace />} />
            <Route path="admin/attribution" element={<Navigate to="/admin/growth?tab=attribution" replace />} />
            <Route path="admin/retention" element={<Navigate to="/admin/growth?tab=retention" replace />} />
            <Route path="training" element={<TrainingPage />} />
            <Route path="planner" element={<PlannerLegacyRedirect />} />
            <Route path="academy" element={<AcademyPage />} />
            <Route path="klub" element={<KlubPage />} />
            <Route path="scouting" element={<ScoutingCentralPage />} />

            <Route path="*" element={<Navigate to="/dashboard" replace />} />
          </Route>

          <Route path="*" element={<Navigate to="/login" replace />} />
        </Routes>
      </Suspense>
      <CookieBanner />
    </>
  );
}
