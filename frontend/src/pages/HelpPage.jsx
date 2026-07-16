import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { buildHelpNumbers, interpolateHelp } from "../lib/helpNumbers.js";
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
      { id: "secretAchievements", kind: "text" },
      { id: "notifications", kind: "text" },
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
      { id: "prizeMoney", kind: "text" },
      { id: "divisionBonus", kind: "rows" },
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
    key: "riders",
    Icon: BikeIcon,
    blocks: [
      { id: "valueAndPrice", kind: "text" },
      { id: "salary", kind: "text" },
      { id: "abilitiesExplained", kind: "rows" },
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
      { id: "onlyTrainingLive", kind: "text" },
      { id: "staffSynergy", kind: "text" },
      { id: "costs", kind: "text" },
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
  "watchlistSaleNotificationFaq",
  "riderSalaryView",
  "riderDevelopment",
  "howToWinRace",
  "whyReportFaq",
  "riderAbilities",
  "trainingFocusFaq",
  "seasonPlanner",
  "peakTraining",
  "salaryShortfall",
  "debtCeiling",
  "prizeMoneyFaq",
  "divisionBonusFaq",
  "sponsorPayoutTiming",
  "sponsorNegotiation",
  "seasonFinanceReport",
  "forecastCalculation",
  "standingsUpdate",
  "adminFinishWithPending",
  "boardSatisfaction",
  "boardNegotiation",
  "directYouthToStarSwitch",
  "boardCurrentAssessment",
  "season1BaselineFaq",
  "buildOnCoreBadge",
  "forgotToNegotiatePlan",
  "boardMembersFaq",
  "boardChairman",
  "memberReactions",
  "starSigningGoal",
  "u25StatGain",
  "balancedRelativeRank",
  "boardUnsatisfiedConsequences",
  "bonusOffer",
  "clubDnaFaq",
  "clubDnaEffects",
  "midSeasonCheckFaq",
  "majorPivotCooldown",
  "endOfSeasonBlock",
  "multiYearPlanLock",
  "tightenedBadge",
  "relativeRankLive",
  "season0To1Special",
  "season1RaceCalendarFaq",
  "overlappingRaces",
  "teamStrategyFaq",
  "relaunchTeamMoney",
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

export default function HelpPage() {
  const { t, i18n } = useTranslation("help");
  const [activeSection, setActiveSection] = useState("start");
  const [search, setSearch] = useState("");
  const [faqOpen, setFaqOpen] = useState(null);

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

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
        <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
      </div>

      {/* Search */}
      <div className="mb-5">
        <input
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={t("page.searchPlaceholder")}
          aria-label={t("common:a11y.searchHelp")}
          className="w-full bg-cz-subtle border border-cz-border rounded-cz px-4 py-3 text-cz-1 text-sm
            placeholder-cz-3 focus:outline-none focus:border-cz-accent/40"
        />
      </div>

      {search ? (
        /* Search results */
        <div className="space-y-4">
          {filteredSections && filteredSections.length > 0 && (
            <div>
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">
                {t("page.searchResults.sectionsHeading")}
              </p>
              {filteredSections.map((s) => (
                <button
                  key={s.key}
                  onClick={() => {
                    setSearch("");
                    setActiveSection(s.key);
                  }}
                  className="w-full text-left bg-cz-card border border-cz-border rounded-cz px-4 py-3 mb-2
                    hover:border-cz-border transition-all"
                >
                  <p className="text-cz-1 text-sm flex items-center gap-2">
                    <s.Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" /> <span>{s.label}</span>
                  </p>
                </button>
              ))}
            </div>
          )}
          {filteredFAQ.length > 0 && (
            <div>
              <p className="text-cz-3 text-xs uppercase tracking-wider mb-3">
                {t("page.searchResults.faqHeading")}
              </p>
              {filteredFAQ.map((f) => (
                <div
                  key={f.id}
                  className="bg-cz-card border border-cz-border rounded-cz px-4 py-3 mb-2"
                >
                  <p className="text-cz-1 text-sm font-medium mb-1">{f.q}</p>
                  <p className="text-cz-2 text-sm">{f.a}</p>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div className="flex gap-4">
          {/* Sidebar */}
          <div className="w-40 flex-shrink-0">
            <div className="flex flex-col gap-1">
              {sections.map((s) => (
                <button
                  key={s.key}
                  onClick={() => setActiveSection(s.key)}
                  className={`text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center gap-2
                    ${
                      activeSection === s.key
                        ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30"
                        : "text-cz-2 hover:text-cz-1 hover:bg-cz-subtle"
                    }`}
                >
                  <s.Icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  <span>{s.label}</span>
                </button>
              ))}
              <div className="h-px bg-cz-subtle my-1" />
              <button
                onClick={() => setActiveSection("faq")}
                className={`text-left px-3 py-2 rounded-lg text-xs transition-all flex items-center gap-2
                  ${
                    activeSection === "faq"
                      ? "bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30"
                      : "text-cz-2 hover:text-cz-1 hover:bg-cz-subtle"
                  }`}
              >
                <InfoIcon className="w-4 h-4 flex-shrink-0" />
                <span>{t("page.faqLabel")}</span>
              </button>
            </div>
          </div>

          {/* Content */}
          <div className="flex-1 min-w-0">
            {activeSection === "faq" ? (
              <div>
                <h2 className="text-cz-1 font-bold text-base mb-4">{t("page.faqHeading")}</h2>
                <div className="flex flex-col gap-2">
                  {faq.map((f, i) => (
                    <div
                      key={f.id}
                      className="bg-cz-card border border-cz-border rounded-cz overflow-hidden"
                    >
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
                    </div>
                  ))}
                </div>
              </div>
            ) : currentSection ? (
              <div>
                <h2 className="text-cz-1 font-bold text-base mb-4 flex items-center gap-2">
                  <currentSection.Icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" /> <span>{currentSection.label}</span>
                </h2>
                <div className="flex flex-col gap-4">
                  {currentSection.content.map((block, i) => (
                    <div
                      key={i}
                      className="bg-cz-card border border-cz-border rounded-cz p-4"
                    >
                      <h3 className="text-cz-1 font-semibold text-sm mb-2">{block.title}</h3>
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
                    </div>
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
