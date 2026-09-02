// #4624 — side-inventar for design-kvalitetsaudit (slice 2 af #4622).
// Bygget ud fra frontend/src/App.jsx's <Routes> krydset med frontend/src/pages/*.jsx.
// Springer over: /ui* (dev-only kitchen sink), *-fallback, og rene Navigate-redirects
// (de renderer ingen side selv — de peger på en side der allerede er sin egen række).
// Param-varianter der monterer PRÆCIS samme komponent uden observerbar visuel forskel
// (fx /pro vs /pro/success, /seasons vs /seasons/:seasonId der begge falder tilbage
// til samme aktive sæson) er dedupliceret til én række.
//
// auth: "public" = ikke logget ind (LandingPage ville ellers redirecte hvis
//       sessionen var aktiv), "protected" = kræver login() først.

export const RIDER_ID = "rider-1"; // RIDERS[0].id
export const TEAM_ID = "team-e2e"; // TEST_TEAM.id
export const RIVAL_TEAM_ID = "team-rival"; // RIVAL_TEAM.id
export const RACE_ID = "race-up-1"; // SEED_RACES[0].id (scheduled, har stage-profiler)
export const SEASON_ID = "season-e2e"; // ACTIVE_SEASON.id
export const FORUM_POST_ID = "forum-pinned-1"; // seedet i mockHandlers.js
export const STAFF_ID = "staff-1"; // ingen seed findes — generisk mock, forventet tom-state
export const RACE_ARCHIVE_SLUG = encodeURIComponent("Omloop Preview"); // race-done-1's navn

export const ROUTES = [
  // ── Public / auth (uden login) ──────────────────────────────────────────
  { route: "/", path: "/", file: "LandingPage.jsx", template: "marketing", auth: "public" },
  { route: "/login", path: "/login", file: "LoginPage.jsx", template: "auth", auth: "public" },
  { route: "/reset-password", path: "/reset-password", file: "ResetPasswordPage.jsx", template: "auth", auth: "public" },
  { route: "/founder-supporter", path: "/founder-supporter", file: "FounderSupporterPage.jsx", template: "marketing", auth: "public" },
  { route: "/terms", path: "/terms", file: "TermsPageEn.jsx", template: "marketing", auth: "public" },
  { route: "/handelsbetingelser", path: "/handelsbetingelser", file: "TermsPage.jsx", template: "marketing", auth: "public" },
  { route: "/privacy-policy", path: "/privacy-policy", file: "PrivacyPolicyPageEn.jsx", template: "marketing", auth: "public" },
  { route: "/privatlivspolitik", path: "/privatlivspolitik", file: "PrivacyPolicyPage.jsx", template: "marketing", auth: "public" },

  // ── Protected (kræver login) ────────────────────────────────────────────
  { route: "/dashboard", path: "/dashboard", file: "DashboardPage.jsx", template: "T1", auth: "protected" },
  { route: "/riders", path: "/riders", file: "RidersPage.jsx", template: "T2", auth: "protected" },
  { route: "/riders/:id", path: `/riders/${RIDER_ID}`, file: "RiderStatsPage.jsx", template: "T3", auth: "protected" },
  { route: "/staff/:id", path: `/staff/${STAFF_ID}`, file: "StaffProfilePage.jsx", template: "T3", auth: "protected", note: "ingen staff-seed — generisk mock, forventet tom/fejl-state" },
  { route: "/auctions", path: "/auctions", file: "AuctionsPage.jsx", template: "T2", auth: "protected" },
  { route: "/auctions/history", path: "/auctions/history", file: "AuctionHistoryPage.jsx", template: "T2", auth: "protected" },
  { route: "/transfers", path: "/transfers", file: "TransfersPage.jsx", template: "T2", auth: "protected" },
  { route: "/team", path: "/team", file: "TeamPage.jsx", template: "T2", auth: "protected" },
  { route: "/teams/:id", path: `/teams/${RIVAL_TEAM_ID}`, file: "TeamProfilePage.jsx", template: "T3", auth: "protected" },
  { route: "/standings", path: "/standings", file: "RankingsHubPage.jsx", template: "T2", auth: "protected" },
  { route: "/board", path: "/board", file: "boardroom/BoardroomRoute.jsx -> BoardPage.jsx", template: "T1", auth: "protected" },
  { route: "/notifications", path: "/notifications", file: "NotificationsPage.jsx", template: "T1", auth: "protected" },
  { route: "/forum", path: "/forum", file: "ForumPage.jsx", template: "T2", auth: "protected" },
  { route: "/forum/:postId", path: `/forum/${FORUM_POST_ID}`, file: "ForumPostPage.jsx", template: "T3", auth: "protected" },
  { route: "/compare", path: "/compare", file: "RiderComparePage.jsx", template: "T2", auth: "protected" },
  { route: "/profile", path: "/profile", file: "ProfilePage.jsx", template: "T1", auth: "protected" },
  { route: "/pro", path: "/pro", file: "ProUpgradePage.jsx", template: "T1", auth: "protected", note: "dækker også /pro/success (samme komponent, ingen visuel forskel)" },
  { route: "/watchlist", path: "/watchlist", file: "WatchlistPage.jsx", template: "T2", auth: "protected" },
  { route: "/planning", path: "/planning", file: "PlanningHubPage.jsx", template: "T2", auth: "protected" },
  { route: "/races/:raceId", path: `/races/${RACE_ID}`, file: "RaceDetailPage.jsx", template: "T3", auth: "protected" },
  { route: "/seasons", path: "/seasons", file: "SeasonEndPage.jsx", template: "T1", auth: "protected", note: "dækker også /seasons/:seasonId (falder til samme aktive sæson uden id)" },
  { route: "/resultater", path: "/resultater", file: "ResultaterPage.jsx", template: "T2", auth: "protected" },
  { route: "/race-centre", path: "/race-centre", file: "RaceCentrePage.jsx", template: "T2", auth: "protected" },
  { route: "/race-archive/:raceSlug", path: `/race-archive/${RACE_ARCHIVE_SLUG}`, file: "RaceHistoryPage.jsx", template: "T3", auth: "protected" },
  { route: "/finance", path: "/finance", file: "FinancePage.jsx", template: "T1", auth: "protected" },
  { route: "/seasons/:seasonId/finance/:teamId", path: `/seasons/${SEASON_ID}/finance/${TEAM_ID}`, file: "SeasonFinanceReport.jsx", template: "T1", auth: "protected" },
  { route: "/managers/:teamId", path: `/managers/${TEAM_ID}`, file: "ManagerProfilePage.jsx", template: "T3", auth: "protected" },
  { route: "/admin/season", path: "/admin/season", file: "admin/AdminSeasonTab.jsx", template: "T2", auth: "protected" },
  { route: "/admin/economy", path: "/admin/economy", file: "admin/AdminEconomyTab.jsx", template: "T2", auth: "protected" },
  { route: "/admin/users", path: "/admin/users", file: "admin/AdminUsersTab.jsx", template: "T2", auth: "protected" },
  { route: "/admin/feedback", path: "/admin/feedback", file: "admin/AdminFeedbackTab.jsx", template: "T2", auth: "protected" },
  { route: "/admin/forum", path: "/admin/forum", file: "admin/AdminForumTab.jsx", template: "T2", auth: "protected" },
  { route: "/admin/data", path: "/admin/data", file: "admin/AdminDataTab.jsx", template: "T2", auth: "protected" },
  { route: "/admin/system", path: "/admin/system", file: "admin/AdminSystemTab.jsx", template: "T1", auth: "protected" },
  { route: "/admin/growth", path: "/admin/growth", file: "AdminGrowthPage.jsx", template: "T2", auth: "protected" },
  { route: "/admin/fairplay", path: "/admin/fairplay", file: "AdminFairplayPage.jsx", template: "T2", auth: "protected" },
  { route: "/admin/value-transition", path: "/admin/value-transition", file: "AdminValueTransitionPage.jsx", template: "T2", auth: "protected" },
  { route: "/training", path: "/training", file: "TrainingPage.jsx", template: "T2", auth: "protected" },
  { route: "/academy", path: "/academy", file: "AcademyPage.jsx", template: "T2", auth: "protected" },
  { route: "/klub", path: "/klub", file: "KlubPage.jsx", template: "T2", auth: "protected" },
  { route: "/scouting", path: "/scouting", file: "ScoutingCentralPage.jsx", template: "T2", auth: "protected" },
  { route: "/help", path: "/help", file: "HelpPage.jsx", template: "T1", auth: "protected" },
  { route: "/rules", path: "/rules", file: "RulesPage.jsx", template: "T1", auth: "protected" },
  { route: "/patch-notes", path: "/patch-notes", file: "PatchNotesPage.jsx", template: "T1", auth: "protected" },
  { route: "/roadmap", path: "/roadmap", file: "RoadmapPage.jsx", template: "T1", auth: "protected" },
];

export function slugFor(route) {
  return route.replace(/^\//, "").replace(/\//g, "-").replace(/:/g, "").replace(/[^a-zA-Z0-9-]/g, "") || "landing";
}
