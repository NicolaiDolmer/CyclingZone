import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";

const SECTION_DEFS = [
  {
    key: "start",
    icon: "🚀",
    blocks: [
      { id: "intro", kind: "text" },
      { id: "firstSteps", kind: "steps" },
    ],
  },
  {
    key: "board",
    icon: "◧",
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
    icon: "⚡",
    blocks: [
      { id: "whatAuctions", kind: "text" },
      { id: "howToStart", kind: "steps" },
      { id: "bidding", kind: "text" },
      { id: "autoBidCap", kind: "text" },
      { id: "whenExpires", kind: "text" },
      { id: "flashAuction", kind: "text" },
      { id: "tenMinExtend", kind: "text" },
      { id: "squadAndAuctions", kind: "text" },
    ],
  },
  {
    key: "transfers",
    icon: "↔",
    blocks: [
      { id: "whatTransfers", kind: "text" },
      { id: "sendOffer", kind: "steps" },
      { id: "receiveAndReply", kind: "text" },
      { id: "finalConfirmation", kind: "text" },
      { id: "negotiation", kind: "text" },
      { id: "privacy", kind: "text" },
      { id: "transferWindow", kind: "text" },
      { id: "loansAndSquad", kind: "text" },
      { id: "archiveCompleted", kind: "text" },
    ],
  },
  {
    key: "managers",
    icon: "👤",
    blocks: [
      { id: "profile", kind: "text" },
      { id: "namesAndInit", kind: "text" },
      { id: "theme", kind: "text" },
      { id: "forgotPassword", kind: "text" },
      { id: "inbox", kind: "text" },
      { id: "onlineStatus", kind: "text" },
      { id: "managersOnline", kind: "text" },
      { id: "loginStreak", kind: "text" },
      { id: "xpAndLevel", kind: "text" },
      { id: "headToHead", kind: "text" },
    ],
  },
  {
    key: "discord",
    icon: "D",
    blocks: [
      { id: "whyDms", kind: "text" },
      { id: "howToGetDms", kind: "steps" },
      { id: "optOut", kind: "text" },
      { id: "whenDmsSent", kind: "rows" },
    ],
  },
  {
    key: "achievements",
    icon: "🏆",
    blocks: [
      { id: "whatAchievements", kind: "text" },
      { id: "categories", kind: "rows" },
      { id: "secretAchievements", kind: "text" },
      { id: "notifications", kind: "text" },
    ],
  },
  {
    key: "watchlist",
    icon: "⭐",
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
    icon: "◎",
    blocks: [
      { id: "whatActivity", kind: "text" },
      { id: "tabs", kind: "steps" },
      { id: "deepLinks", kind: "text" },
    ],
  },
  {
    key: "season",
    icon: "🏁",
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
    icon: "🏅",
    blocks: [
      { id: "formula", kind: "text" },
      { id: "examples", kind: "rows" },
      { id: "payout", kind: "text" },
      { id: "fullTable", kind: "textCta" },
    ],
  },
  {
    key: "divisions",
    icon: "◉",
    blocks: [
      { id: "overview", kind: "text" },
      { id: "sizePerDivision", kind: "rows" },
      { id: "promotionRelegation", kind: "text" },
    ],
  },
  {
    key: "riders",
    icon: "🚴",
    blocks: [
      { id: "valueAndPrice", kind: "text" },
      { id: "salary", kind: "text" },
      { id: "stats", kind: "text" },
      { id: "development", kind: "text" },
      { id: "u25u23", kind: "text" },
    ],
  },
  {
    key: "activityfeed",
    icon: "◉",
    blocks: [
      { id: "whatActivityFeed", kind: "text" },
      { id: "whatShown", kind: "rows" },
      { id: "transferRumors", kind: "text" },
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
  "transferWindowNotifications",
  "minBidAmount",
  "loansInSquadLimit",
  "loanFeeTiming",
  "bidVisibility",
  "secretAchievementsFaq",
  "onlineStatusFaq",
  "loginStreakFaq",
  "watchlistCounterFaq",
  "watchlistSaleNotificationFaq",
  "riderSalaryView",
  "riderDevelopment",
  "salaryShortfall",
  "debtCeiling",
  "prizeMoneyFaq",
  "divisionBonusFaq",
  "sponsorPayoutTiming",
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
  "deadlineTimelineFaq",
  "squadEnforcementFaq",
  "season1RaceCalendarFaq",
];

function buildSections(t) {
  return SECTION_DEFS.map((def) => {
    const base = `sections.${def.key}`;
    return {
      key: def.key,
      icon: def.icon,
      label: t(`${base}.label`),
      content: def.blocks.map((block) => {
        const blockBase = `${base}.${block.id}`;
        const title = t(`${blockBase}.title`);
        if (block.kind === "steps") {
          return { title, steps: t(`${blockBase}.steps`, { returnObjects: true }) };
        }
        if (block.kind === "rows") {
          return { title, rows: t(`${blockBase}.rows`, { returnObjects: true }) };
        }
        if (block.kind === "textCta") {
          return {
            title,
            text: t(`${blockBase}.text`),
            cta: { label: t(`${blockBase}.ctaLabel`), to: t(`${blockBase}.ctaTo`) },
            disclaimer: t(`${blockBase}.disclaimer`),
          };
        }
        return { title, text: t(`${blockBase}.text`) };
      }),
    };
  });
}

function buildFaq(t) {
  return FAQ_KEYS.map((id) => ({
    id,
    q: t(`faq.${id}.q`),
    a: t(`faq.${id}.a`),
  }));
}

export default function HelpPage() {
  const { t } = useTranslation("help");
  const [activeSection, setActiveSection] = useState("start");
  const [search, setSearch] = useState("");
  const [faqOpen, setFaqOpen] = useState(null);

  const sections = buildSections(t);
  const faq = buildFaq(t);

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
          className="w-full bg-cz-subtle border border-cz-border rounded-xl px-4 py-3 text-cz-1 text-sm
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
                  className="w-full text-left bg-cz-card border border-cz-border rounded-xl px-4 py-3 mb-2
                    hover:border-cz-border transition-all"
                >
                  <p className="text-cz-1 text-sm">
                    {s.icon} {s.label}
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
                  className="bg-cz-card border border-cz-border rounded-xl px-4 py-3 mb-2"
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
                  <span>{s.icon}</span>
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
                <span>❓</span>
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
                      className="bg-cz-card border border-cz-border rounded-xl overflow-hidden"
                    >
                      <button
                        onClick={() => setFaqOpen(faqOpen === i ? null : i)}
                        className="w-full flex items-center justify-between px-4 py-3 text-left"
                      >
                        <p className="text-cz-1 text-sm font-medium">{f.q}</p>
                        <span
                          className={`text-cz-3 text-xs ms-3 flex-shrink-0 transition-transform ${
                            faqOpen === i ? "rotate-180" : ""
                          }`}
                        >
                          ▾
                        </span>
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
                <h2 className="text-cz-1 font-bold text-base mb-4">
                  {currentSection.icon} {currentSection.label}
                </h2>
                <div className="flex flex-col gap-4">
                  {currentSection.content.map((block, i) => (
                    <div
                      key={i}
                      className="bg-cz-card border border-cz-border rounded-xl p-4"
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
                          <table className="w-full text-sm">
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
