// Authoritative numbers reference (#1604) — separate from Help/FAQ.
//
// Editorial structure + prose live in locales/{en,da}/rules.json. The NUMBERS
// are interpolated from lib/rulesNumbers.js, which is pinned to the backend
// code constants by lib/rulesNumbers.test.js (drift guard). Help/FAQ explains
// "how do I X"; this page is the source of truth for limits, rates and formulas.

import { useState } from "react";
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl.js";
import { RULES_NUMBERS } from "../lib/rulesNumbers.js";
import { useAcademy } from "../lib/useAcademy.js";
import PageHeader from "../components/ui/PageHeader.jsx";
import PageLoader from "../components/ui/PageLoader.jsx";
import Section, { SectionHeader } from "../components/ui/Section.jsx";
import { Table, Tr, Th, Td } from "../components/ui/Table.jsx";
import { Tabs, TabList, Tab } from "../components/ui/Tabs.jsx";
import {
  InfoIcon,
  ExternalLinkIcon,
  TeamIcon,
  CoinIcon,
  TagIcon,
  ExchangeIcon,
  FlagIcon,
  CalendarIcon,
  StarIcon,
  LockIcon,
} from "../components/ui/icons/index.jsx";

// Section → block ids + block kind. "table" blocks render rules[].rows; the rest
// render a single interpolated paragraph. Order here is the display order.
const SECTION_DEFS = [
  { key: "squad", icon: TeamIcon, blocks: ["cap", "enforcement", "academyExempt"] },
  {
    key: "economy",
    icon: CoinIcon,
    blocks: [
      "startingBalance",
      "sponsor",
      "upkeep",
      "salary",
      "negativeInterest",
      "debtCeiling",
      "emergencyLoan",
      { id: "divisionBonus", kind: "table" },
    ],
  },
  { key: "auctions", icon: TagIcon, blocks: ["duration", "minBid", "extension", "proxy"] },
  { key: "transfers", icon: ExchangeIcon, blocks: ["contractInherited", "loansCount"] },
  { key: "races", icon: FlagIcon, blocks: ["prize", "resultType", "freeAgentPrize"] },
  { key: "season", icon: CalendarIcon, blocks: ["structure", "promotion", "transition"] },
  // Academy is gated behind academy_enabled (see RulesPage props). When the flag
  // is off we still render the section (numbers are final) with a "launches at
  // relaunch" note, per #1604.
  { key: "academy", icon: StarIcon, gated: true, blocks: ["slots", "age", "salary", "drift"] },
  { key: "fairPlay", icon: LockIcon, blocks: ["starProtection", "noBoardForBots"] },
];

// FAQ deep-links shown under the page intro — FAQ stays "how do I X" and points
// back here as source of truth. Keys map to help.json faq.<id> + rules.faqLinks.<id>.
const FAQ_LINKS = [
  "minBidAmount",
  "debtCeiling",
  "prizeMoneyFaq",
  "divisionBonusFaq",
  "auctionExpiry",
];

// Pre-format every number into a locale-aware display string so rules.json prose
// stays language-agnostic and da gets "." thousands separators automatically.
function buildVars(n) {
  const vars = {};
  for (const [k, v] of Object.entries(n)) {
    vars[k] = typeof v === "number" && Math.abs(v) >= 1000 ? formatNumber(v) : v;
  }
  return vars;
}

export default function RulesPage() {
  // #2849 bølge 4: rules-namespacet er IKKE inlinet (lazy via HttpBackend) —
  // `ready` gater render bag PageLoader så raw keys aldrig rammer first paint.
  // Se INLINE_EXEMPT i scripts/i18n-check-namespace-inline.mjs.
  const { t, ready } = useTranslation("rules");
  const [activeSection, setActiveSection] = useState("squad");
  // Academy is gated behind academy_enabled (#1308); the flag is off until the
  // relaunch. We still render the section (the numbers are final) but show a
  // "launches at relaunch" note while disabled.
  const { enabled: academyEnabled } = useAcademy();

  if (!ready) return <PageLoader />;

  const vars = buildVars(RULES_NUMBERS);
  const currentDef = SECTION_DEFS.find((s) => s.key === activeSection) ?? SECTION_DEFS[0];

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader title={t("page.title")} subtitle={t("page.subtitle")} />

      <Section className="mb-[14px]">
        <p className="text-cz-2 text-sm leading-relaxed">{t("page.intro")}</p>
        <div className="mt-3 pt-3 border-t border-cz-border">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">
            {t("page.faqLinkIntro")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {FAQ_LINKS.map((id) => (
              <li key={id}>
                <Link
                  to={`/help?faq=${id}`}
                  className="inline-flex items-start gap-1.5 text-sm text-cz-accent-t hover:underline"
                >
                  <ExternalLinkIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{t(`faqLinks.${id}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </Section>

      {/* Section nav — mobile ≤767px: horizontal scrollable tab row (ui/Tabs).
          md+: sticky vertical list to the left of the content column. Both are
          fully controlled by the same activeSection state; only one is visible
          per breakpoint via `hidden`/`md:hidden`, so there's no duplicate
          interaction surface — just two responsive renderings of one nav. */}
      <div className="md:hidden mb-4">
        <Tabs value={activeSection} onChange={setActiveSection}>
          <TabList label={t("sections.navLabel", { defaultValue: "Rule sections" })}>
            {SECTION_DEFS.map((s) => (
              <Tab key={s.key} value={s.key}>
                <span className="inline-flex items-center gap-1.5">
                  <s.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                  {t(`sections.${s.key}.label`)}
                </span>
              </Tab>
            ))}
          </TabList>
        </Tabs>
      </div>

      <div className="flex gap-4">
        <div className="hidden md:block w-40 flex-shrink-0">
          <div className="sticky top-4 flex flex-col gap-1">
            {SECTION_DEFS.map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setActiveSection(s.key)}
                aria-current={activeSection === s.key ? "true" : undefined}
                className={`text-left px-3 py-2 rounded-cz text-xs transition-colors flex items-center gap-2 border
                  ${
                    activeSection === s.key
                      ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                      : "text-cz-2 hover:text-cz-1 hover:bg-cz-subtle border-transparent"
                  }`}
              >
                <s.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{t(`sections.${s.key}.label`)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Section content */}
        <div className="flex-1 min-w-0">
          {currentDef.gated && !academyEnabled && (
            <div className="bg-cz-subtle border border-cz-border rounded-cz p-3 mb-4 flex items-start gap-2">
              <InfoIcon className="w-4 h-4 flex-shrink-0 mt-0.5 text-cz-accent-t" />
              <p className="text-cz-2 text-sm leading-relaxed">{t("academyDisabledNote")}</p>
            </div>
          )}

          <div className="flex flex-col gap-[14px]">
            {currentDef.blocks.map((block) => {
              const id = typeof block === "string" ? block : block.id;
              const kind = typeof block === "string" ? "text" : block.kind;
              const base = `sections.${currentDef.key}.blocks.${id}`;
              return (
                <Section key={id}>
                  <SectionHeader as="h3" title={t(`${base}.title`)} />
                  <p className="text-cz-2 text-sm leading-relaxed">{t(`${base}.text`, vars)}</p>
                  {kind === "table" && (
                    <div className="mt-3">
                      <Table data-sort-exempt="Statisk regel-reference (i18n rows)">
                        <tbody>
                          {t(`${base}.rows`, { returnObjects: true }).map((row, ri) => {
                            const cells = row.map((cell) => interpolateCell(cell, vars));
                            const isHeader = ri === 0;
                            return (
                              <Tr key={ri}>
                                {cells.map((cell, ci) =>
                                  isHeader ? (
                                    <Th key={ci} numeric={ci > 0}>
                                      {cell}
                                    </Th>
                                  ) : (
                                    <Td key={ci} numeric={ci > 0} className={ci === 0 ? "font-medium" : ""}>
                                      {cell}
                                    </Td>
                                  )
                                )}
                              </Tr>
                            );
                          })}
                        </tbody>
                      </Table>
                    </div>
                  )}
                </Section>
              );
            })}
          </div>

          <p className="mt-4 text-xs text-cz-3 italic">{t("page.lastVerified")}</p>
        </div>
      </div>
    </div>
  );
}

// Table cells in rules.json carry {placeholder} tokens (e.g. "{bonusD1P1} CZ$").
// i18next's returnObjects path doesn't interpolate array leaves, so we substitute
// the same pre-formatted vars manually. Unknown tokens are left as-is.
function interpolateCell(cell, vars) {
  if (typeof cell !== "string") return cell;
  return cell.replace(/\{(\w+)\}/g, (match, key) =>
    Object.prototype.hasOwnProperty.call(vars, key) ? vars[key] : match
  );
}
