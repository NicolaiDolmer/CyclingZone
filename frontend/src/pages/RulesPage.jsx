// Authoritative numbers reference (#1604) — separate from Help/FAQ.
//
// Editorial structure + prose live in locales/{en,da}/rules.json. The NUMBERS
// are interpolated from lib/rulesNumbers.js, which is pinned to the backend
// code constants by lib/rulesNumbers.test.js (drift guard). Help/FAQ explains
// "how do I X"; this page is the source of truth for limits, rates and formulas.

import { useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl.js";
import { RULES_NUMBERS } from "../lib/rulesNumbers.js";
import { useAcademy } from "../lib/useAcademy.js";
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
  const { t } = useTranslation("rules");
  const [activeSection, setActiveSection] = useState("squad");
  // Academy is gated behind academy_enabled (#1308); the flag is off until the
  // relaunch. We still render the section (the numbers are final) but show a
  // "launches at relaunch" note while disabled.
  const { enabled: academyEnabled } = useAcademy();

  const vars = buildVars(RULES_NUMBERS);
  const currentDef = SECTION_DEFS.find((s) => s.key === activeSection) ?? SECTION_DEFS[0];

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-cz-1">{t("page.title")}</h1>
        <p className="text-cz-3 text-sm">{t("page.subtitle")}</p>
      </div>

      <div className="bg-cz-card border border-cz-border rounded-cz p-4 mb-5">
        <p className="text-cz-2 text-sm leading-relaxed">{t("page.intro")}</p>
        <div className="mt-3 pt-3 border-t border-cz-border">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-2">
            {t("page.faqLinkIntro")}
          </p>
          <ul className="flex flex-col gap-1.5">
            {FAQ_LINKS.map((id) => (
              <li key={id}>
                <Link
                  to="/help"
                  className="inline-flex items-start gap-1.5 text-sm text-cz-accent-t hover:underline"
                >
                  <ExternalLinkIcon className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span>{t(`faqLinks.${id}`)}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="flex gap-4">
        {/* Section nav */}
        <div className="w-40 flex-shrink-0">
          <div className="flex flex-col gap-1">
            {SECTION_DEFS.map((s) => (
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
                <s.icon className="w-4 h-4 flex-shrink-0" aria-hidden="true" />
                <span>{t(`sections.${s.key}.label`)}</span>
              </button>
            ))}
          </div>
        </div>

        {/* Section content */}
        <div className="flex-1 min-w-0">
          <h2 className="text-cz-1 font-bold text-base mb-4 flex items-center gap-2">
            <currentDef.icon className="w-5 h-5 flex-shrink-0" aria-hidden="true" />
            {t(`sections.${currentDef.key}.label`)}
          </h2>

          {currentDef.gated && !academyEnabled && (
            <div className="bg-cz-subtle border border-cz-border rounded-cz p-3 mb-4 flex items-start gap-2">
              <InfoIcon className="w-4 h-4 flex-shrink-0 mt-0.5 text-cz-accent-t" />
              <p className="text-cz-2 text-sm leading-relaxed">{t("academyDisabledNote")}</p>
            </div>
          )}

          <div className="flex flex-col gap-4">
            {currentDef.blocks.map((block) => {
              const id = typeof block === "string" ? block : block.id;
              const kind = typeof block === "string" ? "text" : block.kind;
              const base = `sections.${currentDef.key}.blocks.${id}`;
              return (
                <div key={id} className="bg-cz-card border border-cz-border rounded-cz p-4">
                  <h3 className="text-cz-1 font-semibold text-sm mb-2">{t(`${base}.title`)}</h3>
                  <p className="text-cz-2 text-sm leading-relaxed">{t(`${base}.text`, vars)}</p>
                  {kind === "table" && (
                    <div className="overflow-x-auto mt-3">
                      <table className="w-full text-sm">
                        <tbody>
                          {t(`${base}.rows`, { returnObjects: true }).map((row, ri) => {
                            const cells = row.map((cell) => interpolateCell(cell, vars));
                            const isHeader = ri === 0;
                            return (
                              <tr
                                key={ri}
                                className="border-b border-cz-border last:border-0"
                              >
                                {cells.map((cell, ci) =>
                                  isHeader ? (
                                    <th
                                      key={ci}
                                      className="px-3 py-2 text-left text-cz-3 text-xs uppercase tracking-wider font-medium"
                                    >
                                      {cell}
                                    </th>
                                  ) : (
                                    <td
                                      key={ci}
                                      className={`px-3 py-2 ${ci === 0 ? "text-cz-1 font-medium" : "text-cz-2"}`}
                                    >
                                      {cell}
                                    </td>
                                  )
                                )}
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  )}
                </div>
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
