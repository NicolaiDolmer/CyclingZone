import { useEffect, useState } from "react";
import { Link, useSearchParams } from "react-router";
import { useTranslation } from "react-i18next";
import { buildHelpNumbers, interpolateHelp } from "../lib/helpNumbers.js";
import { fetchRecentOpsNotices, pickNoticeCopy, SEVERITY_META } from "../lib/opsNotices.js";
import { formatDate } from "../lib/intl.js";
import {
  PageHeader,
  Card,
  Section,
  SectionHeader,
  Input,
  EmptyState,
  StatusBadge,
  Tabs,
  TabList,
  Tab,
  PageLoader,
} from "../components/ui";
import {
  InfoIcon,
  RocketIcon,
  ClipboardIcon,
  LightningIcon,
  ExchangeIcon,
  BriefcaseIcon,
  UserIcon,
  DiscordIcon,
  TrophyIcon,
  StarIcon,
  ClockIcon,
  FlagIcon,
  PodiumIcon,
  TeamIcon,
  BikeIcon,
  StopwatchIcon,
  BookOpenIcon,
  BellIcon,
  JerseyIcon,
  ChevronDownIcon,
  SettingsIcon,
  SearchIcon,
  AlertTriangleIcon,
} from "../components/ui/icons/index.jsx";

const SECTION_DEFS = [
  {
    key: "start",
    Icon: RocketIcon,
    blocks: [
      { id: "intro", kind: "text" },
      { id: "firstSteps", kind: "steps" },
    ],
  },
  {
    key: "board",
    Icon: ClipboardIcon,
    blocks: [
      { id: "whatBoard", kind: "text" },
      { id: "season1Baseline", kind: "text" },
      { id: "season2Onboarding", kind: "steps" },
      { id: "strategicDashboard", kind: "text" },
      { id: "namedMembers", kind: "text" },
      { id: "clubDna", kind: "text" },
      { id: "consequenceTiers", kind: "rows" },
      { id: "requestsAndLocks", kind: "text" },
      { id: "midSeasonCheck", kind: "text" },
    ],
  },
  {
    key: "auctions",
    Icon: LightningIcon,
    blocks: [
      { id: "whatAuctions", kind: "text" },
      { id: "howToStart", kind: "steps" },
      { id: "bidding", kind: "text" },
      { id: "autoBidCap", kind: "text" },
      { id: "tieRule", kind: "text" },
      { id: "whenExpires", kind: "text" },
      { id: "flashAuction", kind: "text" },
      { id: "tenMinExtend", kind: "text" },
      { id: "squadAndAuctions", kind: "text" },
    ],
  },
  {
    key: "transfers",
    Icon: ExchangeIcon,
    blocks: [
      { id: "whatTransfers", kind: "text" },
      { id: "sellOnTransferList", kind: "text" },
      { id: "valueDeviation", kind: "text" },
      { id: "sendOffer", kind: "steps" },
      { id: "proposeSwap", kind: "steps" },
      { id: "receiveAndReply", kind: "text" },
      { id: "finalConfirmation", kind: "text" },
      { id: "midRaceTransfers", kind: "text" },
      { id: "negotiation", kind: "text" },
      { id: "privacy", kind: "text" },
      { id: "archiveCompleted", kind: "text" },
    ],
  },
  {
    key: "contracts",
    Icon: BriefcaseIcon,
    blocks: [
      { id: "whatContract", kind: "text" },
      { id: "frozenSalary", kind: "text" },
      { id: "contractOnTrade", kind: "text" },
      { id: "extendContract", kind: "text" },
      { id: "freeAgents", kind: "text" },
    ],
  },
  {
    key: "managers",
    Icon: UserIcon,
    blocks: [
      { id: "profile", kind: "text" },
      { id: "namesAndInit", kind: "text" },
      { id: "accountSettings", kind: "text" },
      { id: "theme", kind: "text" },
      { id: "forgotPassword", kind: "text" },
      { id: "inbox", kind: "text" },
      { id: "onlineStatus", kind: "text" },
      { id: "managersOnline", kind: "text" },
      { id: "headToHead", kind: "text" },
      { id: "contactSupport", kind: "text" },
    ],
  },
  {
    key: "discord",
    Icon: DiscordIcon,
    blocks: [
      { id: "whyDms", kind: "text" },
      { id: "howToGetDms", kind: "steps" },
      { id: "optOut", kind: "text" },
      { id: "whenDmsSent", kind: "rows" },
    ],
  },
  {
    key: "achievements",
    Icon: TrophyIcon,
    blocks: [
      { id: "whatAchievements", kind: "text" },
      { id: "categories", kind: "rows" },
      // #2917: sæson-achievements afgøres først ved sæsonskiftet — det er den
      // eneste kategori der ikke reagerer med det samme.
      { id: "seasonAchievements", kind: "text" },
      { id: "secretAchievements", kind: "text" },
      { id: "notifications", kind: "text" },
      // #3398 (Maiden Win Engine): career-firsts er detekteret objektivt fra
      // resultater (ikke en achievement-kategori i sig selv), men hører
      // naturligt sammen med resten af "hvad fejrer spillet"-siden.
      { id: "careerFirsts", kind: "text" },
    ],
  },
  {
    key: "watchlist",
    Icon: StarIcon,
    blocks: [
      { id: "whatWatchlist", kind: "text" },
      { id: "howToAdd", kind: "steps" },
      { id: "saleNotification", kind: "text" },
      { id: "watchlistCounter", kind: "text" },
      { id: "features", kind: "text" },
    ],
  },
  {
    key: "activity",
    Icon: ClockIcon,
    blocks: [
      { id: "whatActivity", kind: "text" },
      { id: "tabs", kind: "steps" },
      { id: "deepLinks", kind: "text" },
    ],
  },
  {
    key: "season",
    Icon: FlagIcon,
    blocks: [
      { id: "seasonFlow", kind: "steps" },
      { id: "racesAndResults", kind: "text" },
      // #3858: Race Centre-siden (v7.140) — dagens løb samlet ét sted.
      { id: "raceCentre", kind: "text" },
      // #2756: stage-ending-typerne (Summit/Downhill/Breakaway/…) var uforklarede i
      // kalender-/løbsvisningen — Discord-feedback, thelamba 20/7 ("There's 'summit'
      // and 'downhill', clear as day, but 'breakaway'?"). Tooltips på badget'et
      // forklarer den enkelte type; denne tabel samler alle på ét sted.
      { id: "stageEndings", kind: "textRows" },
      { id: "finalKilometre", kind: "text" },
      { id: "prizeMoney", kind: "text" },
      { id: "divisionBonus", kind: "textRows" },
      { id: "raceLibrary", kind: "text" },
      { id: "promotionRelegation", kind: "text" },
      { id: "whenSeasonEnds", kind: "text" },
      { id: "adminRecomputeStandings", kind: "text" },
      { id: "adminBetaReset", kind: "text" },
    ],
  },
  {
    key: "prizes",
    Icon: PodiumIcon,
    blocks: [
      { id: "formula", kind: "text" },
      { id: "examples", kind: "rows" },
      { id: "payout", kind: "text" },
      { id: "fullTable", kind: "textCta" },
    ],
  },
  {
    key: "divisions",
    Icon: TeamIcon,
    blocks: [
      { id: "overview", kind: "text" },
      { id: "sizePerDivision", kind: "rows" },
      { id: "promotionRelegation", kind: "text" },
    ],
  },
  {
    key: "globalRank",
    Icon: PodiumIcon,
    blocks: [
      { id: "whatIsIt", kind: "text" },
      { id: "howScored", kind: "text" },
      { id: "decay", kind: "text" },
      { id: "newManagers", kind: "text" },
      { id: "inactive", kind: "text" },
      { id: "movement", kind: "text" },
    ],
  },
  {
    key: "riders",
    Icon: BikeIcon,
    blocks: [
      { id: "valueAndPrice", kind: "text" },
      { id: "salary", kind: "text" },
      { id: "abilitiesExplained", kind: "rows" },
      { id: "riderType", kind: "text" },
      { id: "development", kind: "text" },
      { id: "trainingFocus", kind: "text" },
      { id: "scouting", kind: "text" },
      { id: "u25u23", kind: "text" },
    ],
  },
  {
    key: "dailytraining",
    Icon: StopwatchIcon,
    blocks: [
      { id: "whatDailyTraining", kind: "text" },
      { id: "programs", kind: "steps" },
      { id: "trainToday", kind: "text" },
      { id: "formFatigue", kind: "text" },
      { id: "injuryRisk", kind: "text" },
      { id: "progressBars", kind: "text" },
      { id: "longTermGrowth", kind: "text" },
      { id: "readingReport", kind: "text" },
    ],
  },
  {
    key: "academy",
    Icon: BookOpenIcon,
    blocks: [
      { id: "whatAcademy", kind: "text" },
      { id: "intakeCohort", kind: "text" },
      { id: "signingProspects", kind: "steps" },
      { id: "academySize", kind: "text" },
      { id: "dailyTrainingBoost", kind: "text" },
      { id: "youthAuctions", kind: "text" },
      { id: "upkeepCost", kind: "text" },
      { id: "graduation", kind: "text" },
    ],
  },
  {
    key: "facilities",
    Icon: SettingsIcon,
    blocks: [
      { id: "whatFacilities", kind: "text" },
      { id: "tracks", kind: "rows" },
      { id: "liveTracksStatus", kind: "text" },
      { id: "staffSynergy", kind: "text" },
      { id: "hireChiefScout", kind: "text" },
      { id: "coachingGroups", kind: "text" },
      { id: "costs", kind: "text" },
      { id: "staffOverview", kind: "text" },
      { id: "teamPublicProfile", kind: "text" },
    ],
  },
  {
    key: "activityfeed",
    Icon: BellIcon,
    blocks: [
      { id: "whatActivityFeed", kind: "text" },
      { id: "whatShown", kind: "rows" },
      { id: "transferRumors", kind: "text" },
    ],
  },
  {
    key: "raceSelection",
    Icon: JerseyIcon,
    blocks: [
      { id: "what", kind: "text" },
      { id: "suitability", kind: "text" },
      { id: "roles", kind: "text" },
      { id: "strategy", kind: "text" },
      { id: "breakaway", kind: "text" },
      { id: "fatigue", kind: "text" },
    ],
  },
];

const FAQ_KEYS = [
  "balanceVisibility",
  "ridersOffline",
  "passwordReset",
  "riderTransferTiming",
  "cancelParkedTransfer",
  "aiDirectOffers",
  "auctionExpiry",
  "flashAuction",
  "minBidAmount",
  "bidVisibility",
  "secretAchievementsFaq",
  "onlineStatusFaq",
  "watchlistCounterFaq",
  "scoutVisibilityFaq",
  "scoutNetworkOwnRidersFaq",
  "scoutChangeRecalcFaq",
  "typeRatingScaleFaq",
  "scoutHistoryFaq",
  "watchlistSaleNotificationFaq",
  "riderSalaryView",
  "riderDevelopment",
  "academyIntakeScoutingFaq",
  "academyIntakeExpiryFaq",
  "howToWinRace",
  "whyReportFaq",
  "riderAbilities",
  "riderRating",
  "developmentProjectionFaq",
  "trainingFocusFaq",
  "restForDevelopedFaq",
  "fatigueInjuryThresholdFaq",
  "seasonPlanner",
  "peakTraining",
  // #3086: konsekvensen af en peak (spænd + payback) var indtil nu usynlig for
  // spilleren — den stod hverken i UI'et eller i hjælpen, selvom motoren har
  // regnet med den siden 13/7.
  "peakValue",
  "peakPayback",
  "raceSignupFaq",
  "raceClassificationsFaq",
  "raceJerseysFaq",
  "raceRouteRealismFaq",
  "dayFormFaq",
  "crashesFaq",
  "newPlayerEconomyFaq",
  "seasonChangeMoneyFaq",
  "salaryShortfall",
  "debtCeiling",
  "prizeMoneyFaq",
  "divisionBonusFaq",
  "sponsorPayoutTiming",
  "sponsorNegotiation",
  "sponsorMidSeasonOnboarding",
  "sponsorRaceDayUnit",
  "sponsorBoardModifierScope",
  "seasonFinanceReport",
  "forecastCalculation",
  "standingsUpdate",
  "adminFinishWithPending",
  "boardSatisfaction",
  "boardSatisfactionArrow",
  "boardPassiveModifierLayer",
  "boardNegotiation",
  "directYouthToStarSwitch",
  "boardCurrentAssessment",
  "season1BaselineFaq",
  "buildOnCoreBadge",
  "forgotToNegotiatePlan",
  "boardMembersFaq",
  "boardMemberWeights",
  "boardChairman",
  "boardChairmanWarning",
  "memberReactions",
  "starSigningGoal",
  "boardProfileRiders",
  "u25StatGain",
  "balancedRelativeRank",
  "boardUnsatisfiedConsequences",
  "bonusOffer",
  "bonusOfferDistance",
  "clubDnaFaq",
  "clubDnaEffects",
  "midSeasonCheckFaq",
  "majorPivotCooldown",
  "endOfSeasonBlock",
  "multiYearPlanLock",
  "tightenedBadge",
  "boardTradeoffWarning",
  "relativeRankLive",
  "season0To1Special",
  "season1RaceCalendarFaq",
  "overlappingRaces",
  "autoSelect",
  "teamStrategyFaq",
  "relaunchTeamMoney",
  "relaunchRiderNames",
  "relaunchFounderBadge",
  "relaunchNextSeasonBuys",
  "contractExpiryRetirementFaq",
  "staffReleaseFaq",
  // #3202: tre ubesvarede mekanik-spørgsmål fra Discord-ugesweepet (spar
  // kræfter på tværs af løb, form ved sæsonskifte, sprint-kaptajn vs. kaptajn)
  // — svarene er verificeret direkte i motor-koden, se PR-beskrivelsen.
  "saveLegsCarryoverFaq",
  "seasonFormCarryoverFaq",
  "sprintCaptainRoleFaq",
  "forumFaq", // #3199
  "forumPollsFaq",
  "forumReportFaq",
];

function buildSections(t, vars) {
  return SECTION_DEFS.map((def) => {
    const base = `sections.${def.key}`;
    return {
      key: def.key,
      Icon: def.Icon,
      label: t(`${base}.label`, vars),
      content: def.blocks.map((block) => {
        const blockBase = `${base}.${block.id}`;
        const title = t(`${blockBase}.title`, vars);
        if (block.kind === "steps") {
          // i18next-icu does not interpolate returnObjects array elements, so fill
          // the help numbers in manually (#1916).
          return { title, steps: interpolateHelp(t(`${blockBase}.steps`, { returnObjects: true }), vars) };
        }
        if (block.kind === "rows") {
          return { title, rows: interpolateHelp(t(`${blockBase}.rows`, { returnObjects: true }), vars) };
        }
        // #3100: a bare table can be read the wrong way round (a player read the
        // division-bonus table's place column as a division and expected the wrong
        // payout). "textRows" puts a how-to-read line above the table, the same
        // sentence /rules already carries.
        if (block.kind === "textRows") {
          return {
            title,
            text: t(`${blockBase}.text`, vars),
            rows: interpolateHelp(t(`${blockBase}.rows`, { returnObjects: true }), vars),
          };
        }
        if (block.kind === "textCta") {
          return {
            title,
            text: t(`${blockBase}.text`, vars),
            cta: { label: t(`${blockBase}.ctaLabel`, vars), to: t(`${blockBase}.ctaTo`) },
            disclaimer: t(`${blockBase}.disclaimer`, vars),
          };
        }
        return { title, text: t(`${blockBase}.text`, vars) };
      }),
    };
  });
}

function buildFaq(t, vars) {
  return FAQ_KEYS.map((id) => ({
    id,
    q: t(`faq.${id}.q`, vars),
    a: t(`faq.${id}.a`, vars),
  }));
}

// Sidenav item — shared between the desktop sticky rail and the mobile
// horizontal tab row so icon + active-state markup stays in one place.
function NavIcon({ Icon }) {
  return <Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />;
}

export default function HelpPage() {
  // #2849 bølge 4: help-namespacet er IKKE inlinet (121 KB raw pr. sprog var
  // ~29% af index-chunkens rå vægt; lazy-loades via HttpBackend) — `ready`
  // gater render bag PageLoader så raw keys aldrig rammer first paint.
  // Se INLINE_EXEMPT i scripts/i18n-check-namespace-inline.mjs.
  const { t, i18n, ready } = useTranslation("help");
  const [searchParams] = useSearchParams();
  // Deep-link support (#2467): ?faq=<id> opens the FAQ tab with that question
  // expanded; ?section=<key> opens a specific section. Unknown/missing values
  // fall back to the previous defaults so this never throws on a bad link.
  const faqParam = searchParams.get("faq");
  const sectionParam = searchParams.get("section");
  const [activeSection, setActiveSection] = useState(() => {
    if (faqParam) return "faq";
    if (sectionParam === "knownIssues") return "knownIssues";
    if (sectionParam && SECTION_DEFS.some((s) => s.key === sectionParam)) return sectionParam;
    return "start";
  });
  const [search, setSearch] = useState("");
  const [faqOpen, setFaqOpen] = useState(() => {
    if (!faqParam) return null;
    const idx = FAQ_KEYS.indexOf(faqParam);
    return idx !== -1 ? idx : null;
  });

  // #3941 — "Kendte problemer": aktive + seneste 14 dages ops_notices, samme
  // datakilde som driftsbanneret i Layout.jsx. Hooken skal stå FØR den tidlige
  // `ready`-return nedenfor (rules-of-hooks: samme antal hooks hver render).
  const [knownIssues, setKnownIssues] = useState([]);
  const [knownIssuesLoaded, setKnownIssuesLoaded] = useState(false);
  useEffect(() => {
    let active = true;
    fetchRecentOpsNotices()
      .then((data) => { if (active) setKnownIssues(data); })
      .catch(() => { /* ikke-kritisk: listen forbliver tom */ })
      .finally(() => { if (active) setKnownIssuesLoaded(true); });
    return () => { active = false; };
  }, []);

  if (!ready) return <PageLoader />;

  // #1916: fill the hard game numbers in help prose from RULES_NUMBERS (pinned to
  // the backend constants) so /help can't drift the way it did in #1907.
  const helpNumbers = buildHelpNumbers(i18n.language);
  const sections = buildSections(t, helpNumbers);
  const faq = buildFaq(t, helpNumbers);

  const currentSection = sections.find((s) => s.key === activeSection);

  const filteredFAQ = faq.filter(
    (f) =>
      f.q.toLowerCase().includes(search.toLowerCase()) ||
      f.a.toLowerCase().includes(search.toLowerCase())
  );

  const filteredSections = search
    ? sections.filter(
        (s) =>
          s.label.toLowerCase().includes(search.toLowerCase()) ||
          s.content.some(
            (c) =>
              c.title.toLowerCase().includes(search.toLowerCase()) ||
              (c.text || "").toLowerCase().includes(search.toLowerCase())
          )
      )
    : null;

  const hasSearchResults = (filteredSections?.length ?? 0) > 0 || filteredFAQ.length > 0;

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      {/* Search */}
      <div className="mb-5">
        <Input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("page.searchPlaceholder")}
          aria-label={t("common:a11y.searchHelp")}
        />
      </div>

      {search ? (
        /* Search results */
        <div className="space-y-4">
          {!hasSearchResults && (
            <EmptyState
              icon={<SearchIcon size={26} aria-hidden="true" />}
              title={t("page.searchResults.emptyTitle")}
              description={t("page.searchResults.emptyDescription")}
            />
          )}
          {filteredSections && filteredSections.length > 0 && (
            <div>
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">
                {t("page.searchResults.sectionsHeading")}
              </p>
              <div className="flex flex-col gap-2">
                {filteredSections.map((s) => (
                  <Card key={s.key} className="p-0">
                    <button
                      onClick={() => {
                        setSearch("");
                        setActiveSection(s.key);
                      }}
                      className="w-full text-left px-4 py-3"
                    >
                      <p className="text-cz-1 text-sm flex items-center gap-2">
                        <NavIcon Icon={s.Icon} /> <span>{s.label}</span>
                      </p>
                    </button>
                  </Card>
                ))}
              </div>
            </div>
          )}
          {filteredFAQ.length > 0 && (
            <div>
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">
                {t("page.searchResults.faqHeading")}
              </p>
              <div className="flex flex-col gap-2">
                {filteredFAQ.map((f) => (
                  <Card key={f.id} className="px-4 py-3">
                    <p className="text-cz-1 text-sm font-medium mb-1">{f.q}</p>
                    <p className="text-cz-2 text-sm">{f.a}</p>
                  </Card>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : (
        <div className="md:flex md:gap-4">
          {/* Mobile fallback (<md): sidenav becomes a horizontal scrollable tab
              row above the content, reusing the canonical Tabs recipe (its
              tabListClass already ships overflow-x-auto). Presentation-only
              swap — same activeSection state drives both. */}
          <div className="md:hidden mb-4">
            <Tabs value={activeSection} onChange={setActiveSection}>
              <TabList label={t("page.title")}>
                {sections.map((s) => (
                  <Tab key={s.key} value={s.key}>
                    <span className="inline-flex items-center gap-1.5">
                      <NavIcon Icon={s.Icon} />
                      {s.label}
                    </span>
                  </Tab>
                ))}
                <Tab value="faq">
                  <span className="inline-flex items-center gap-1.5">
                    <NavIcon Icon={InfoIcon} />
                    {t("page.faqLabel")}
                  </span>
                </Tab>
                <Tab value="knownIssues">
                  <span className="inline-flex items-center gap-1.5">
                    <NavIcon Icon={AlertTriangleIcon} />
                    {t("knownIssues.label")}
                  </span>
                </Tab>
              </TabList>
            </Tabs>
          </div>

          {/* Desktop (md+): sticky sidenav */}
          <div className="hidden md:block w-40 flex-shrink-0">
            <div className="sticky top-7 flex flex-col gap-1">
              {sections.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`text-left px-3 py-2 rounded-cz text-xs transition-all flex items-center gap-2
                    ${
                      activeSection === s.key
                        ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30"
                        : "text-cz-2 hover:text-cz-1 hover:bg-cz-subtle"
                    }`}
                >
                  <NavIcon Icon={s.Icon} />
                  <span>{s.label}</span>
                </button>
              ))}
              <div className="h-px bg-cz-subtle my-1" />
              <button
                onClick={() => setActiveSection("faq")}
                className={`text-left px-3 py-2 rounded-cz text-xs transition-all flex items-center gap-2
                  ${
                    activeSection === "faq"
                      ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30"
                      : "text-cz-2 hover:text-cz-1 hover:bg-cz-subtle"
                  }`}
              >
                <NavIcon Icon={InfoIcon} />
                <span>{t("page.faqLabel")}</span>
              </button>
              <button
                onClick={() => setActiveSection("knownIssues")}
                className={`text-left px-3 py-2 rounded-cz text-xs transition-all flex items-center gap-2
                  ${
                    activeSection === "knownIssues"
                      ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30"
                      : "text-cz-2 hover:text-cz-1 hover:bg-cz-subtle"
                  }`}
              >
                <NavIcon Icon={AlertTriangleIcon} />
                <span>{t("knownIssues.label")}</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === "knownIssues" ? (
              <div>
                <h2 className="text-cz-1 font-bold text-base mb-4">{t("knownIssues.heading")}</h2>
                {!knownIssuesLoaded ? (
                  <div className="flex flex-col gap-[14px]">
                    <Section className="animate-pulse h-16" />
                    <Section className="animate-pulse h-16" />
                  </div>
                ) : knownIssues.length === 0 ? (
                  <EmptyState
                    icon={<AlertTriangleIcon size={26} aria-hidden="true" />}
                    title={t("knownIssues.emptyTitle")}
                    description={t("knownIssues.emptyDescription")}
                  />
                ) : (
                  <div className="flex flex-col gap-[14px]">
                    {knownIssues.map((notice) => {
                      const meta = SEVERITY_META[notice.severity] || SEVERITY_META.info;
                      const { title, body } = pickNoticeCopy(notice, i18n.language);
                      return (
                        <Section key={notice.id}>
                          <SectionHeader
                            as="h3"
                            title={title}
                            meta={formatDate(notice.starts_at)}
                          />
                          {body && <p className="text-cz-2 text-sm leading-relaxed">{body}</p>}
                          <div className="mt-2">
                            <StatusBadge state={meta.badgeState}>
                              {notice.active ? t("knownIssues.activeLabel") : t("knownIssues.resolvedLabel")}
                            </StatusBadge>
                          </div>
                        </Section>
                      );
                    })}
                  </div>
                )}
              </div>
            ) : activeSection === "faq" ? (
              <div>
                <h2 className="text-cz-1 font-bold text-base mb-4">{t("page.faqHeading")}</h2>
                <div className="flex flex-col gap-2">
                  {faq.map((f, i) => (
                    <Card key={f.id} className="overflow-hidden">
                      <button
                        onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left"
                      >
                        <p className="text-cz-1 text-sm font-medium">{f.q}</p>
                        <ChevronDownIcon
                          aria-hidden="true"
                          className={`w-4 h-4 text-cz-3 ms-3 flex-shrink-0 transition-transform ${
                            faqOpen === i ? "rotate-180" : ""
                          }`}
                        />
                      </button>
                      {faqOpen === i && (
                        <div className="px-4 pb-3 border-t border-cz-border pt-3">
                          <p className="text-cz-2 text-sm leading-relaxed">{f.a}</p>
                        </div>
                      )}
                    </Card>
                  ))}
                </div>
              </div>
            ) : currentSection ? (
              <div>
                <h2 className="text-cz-1 font-bold text-base mb-4 flex items-center gap-2">
                  <currentSection.Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" /> <span>{currentSection.label}</span>
                </h2>
                <div className="flex flex-col gap-[14px]">
                  {currentSection.content.map((block, i) => (
                    <Section key={i}>
                      <SectionHeader as="h3" title={block.title} />
                      {block.text && (
                        <p className="text-cz-2 text-sm leading-relaxed">{block.text}</p>
                      )}
                      {block.steps && (
                        <ol className="flex flex-col gap-1.5 mt-1">
                          {block.steps.map((step, j) => (
                            <li key={j} className="flex items-start gap-2">
                              <span className="text-cz-accent-t text-xs font-bold flex-shrink-0 mt-0.5">
                                {j + 1}.
                              </span>
                              <span className="text-cz-2 text-sm leading-relaxed">{step}</span>
                            </li>
                          ))}
                        </ol>
                      )}
                      {block.rows && (
                        <div className="overflow-x-auto mt-2">
                          <table data-sort-exempt="Statisk hjaelpe-reference (i18n rows)" className="w-full text-sm">
                            <thead>
                              <tr className="border-b border-cz-border">
                                {block.rows[0].map((h, j) => (
                                  <th
                                    key={j}
                                    className="px-3 py-2 text-left text-cz-3 text-xs uppercase tracking-wider font-medium"
                                  >
                                    {h}
                                  </th>
                                ))}
                              </tr>
                            </thead>
                            <tbody>
                              {block.rows.slice(1).map((row, j) => (
                                <tr key={j} className="border-b border-cz-border last:border-0">
                                  {row.map((cell, k) => (
                                    <td key={k} className="px-3 py-2 text-cz-2">
                                      {cell}
                                    </td>
                                  ))}
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      )}
                      {block.cta && (
                        <Link
                          to={block.cta.to}
                          className="mt-3 inline-flex items-center gap-1 text-xs text-cz-accent-t hover:underline font-medium"
                        >
                          {block.cta.label}
                        </Link>
                      )}
                      {block.disclaimer && (
                        <p className="mt-2 text-xs text-cz-3 italic border-l-2 border-cz-border pl-2">
                          {block.disclaimer}
                        </p>
                      )}
                    </Section>
                  ))}
                </div>
              </div>
            ) : null}
          </div>
        </div>
      )}
    </div>
  );
}
