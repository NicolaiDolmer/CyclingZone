import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Section, SectionHeader, Button, ZonePill,
  BookOpenIcon, PodiumIcon, TrophyIcon, CoinIcon, ClipboardIcon,
} from "./ui";
import { formatNumber } from "../lib/intl";
import { movementTone, movementLabelKey } from "../lib/seasonRecapCopy.js";

// #2752 (design draft, PR pending owner approval) — the "yearbook" recap hero:
// a per-team, shareable summary of a JUST-COMPLETED season. Intended to sit at
// the TOP of SeasonEndPage (/seasons/:id) for MY team's row, above the season-
// wide SeasonHonours block — SeasonHonours crowns the season's best RIDERS
// (anyone's), this hero is about how MY TEAM did.
//
// PRESENTATIONAL ONLY (props-in, no fetch) — the draft mock preview feeds it
// hand-built data; real wiring reads season_standings + the recap RPC data
// SeasonEndPage already fetches (final rank, points, stage wins, prize) and is
// intentionally deferred to a follow-up PR once the owner has approved this via
// the draft's screenshots.
//
// DESIGN (docs/design/PAGE_TEMPLATES.md): same gold-keyline Section recipe as
// SeasonHonours.jsx directly above it on the page (border-t-2 border-t-cz-accent)
// — the two blocks read as one "season wrapped" moment, not two unrelated cards.
// ONE gold primary button (share) — the page's Select/finance-report actions in
// the header are secondary/neutral, so this hero owns the page's one primary CTA.
const STAT_ICONS = { rank: PodiumIcon, stageWins: TrophyIcon, prize: CoinIcon };

function formatCZ(amount) {
  return `${formatNumber(amount || 0)} CZ$`;
}

/**
 * @param {object} p
 * @param {number} p.seasonNumber
 * @param {string} p.teamName
 * @param {number} p.division        division HOLDET SLUTTEDE sæsonen i
 * @param {number} p.divisionSize    antal hold i den division
 * @param {number} p.rank            rank_in_division
 * @param {"promoted"|"relegated"|"maintained"|null} [p.movement]
 * @param {number} [p.points]
 * @param {number} [p.stageWins]
 * @param {number} [p.prizeWon]
 * @param {Array<{id?:string, icon?:Function, label:string, value:string}>} [p.highlights]
 * @param {string} [p.shareUrl]      overstyrer window.location.href (tests/preview)
 */
export default function SeasonRecapHero({
  seasonNumber,
  teamName,
  division,
  divisionSize,
  rank,
  movement = null,
  points = 0,
  stageWins = 0,
  prizeWon = 0,
  highlights = [],
  shareUrl,
}) {
  const { t } = useTranslation("seasonEnd");
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    const url = shareUrl || (typeof window !== "undefined" ? window.location.href : "");
    try {
      if (navigator?.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      }
    } catch {
      // Clipboard-adgang nægtet (private mode/permissions) — knappen forbliver
      // bare uden "copied"-feedback; intet at fejle synligt over.
    }
  };

  const stats = [
    { key: "rank", label: t("recap.stat.rank"), value: rank ? `#${rank}` : "—" },
    { key: "points", label: t("recap.stat.points"), value: formatNumber(points) },
    { key: "stageWins", label: t("recap.stat.stageWins"), value: formatNumber(stageWins) },
    { key: "prize", label: t("recap.stat.prize"), value: formatCZ(prizeWon) },
  ];

  return (
    <Section borderClass="border-cz-border border-t-2 border-t-cz-accent">
      <SectionHeader title={t("recap.heading")} meta={t("recap.metaFinal", { number: seasonNumber })} />

      <div className="mb-2 flex items-center gap-1.5">
        <BookOpenIcon size={15} className="flex-shrink-0 text-cz-accent" aria-hidden="true" />
        <span className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
          {t("recap.eyebrow", { number: seasonNumber })}
        </span>
      </div>

      <p className="font-display block break-words text-[32px] uppercase leading-[.92] text-cz-1 sm:text-[40px]">
        {teamName}
      </p>

      <div className="mb-4 mt-2 flex flex-wrap items-center gap-2">
        <ZonePill tone={movementTone(movement)}>{t(movementLabelKey(movement), { division })}</ZonePill>
        {rank != null && divisionSize != null && (
          <span className="text-[13px] text-cz-2">
            {t("recap.rankLine", { rank, size: divisionSize, division })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 border-t border-cz-border pt-4 sm:grid-cols-4">
        {stats.map((s) => {
          const Icon = STAT_ICONS[s.key];
          return (
            <div key={s.key} className="min-w-0">
              <div className="mb-1 flex items-center gap-1">
                {Icon && <Icon size={13} className="flex-shrink-0 text-cz-3" aria-hidden="true" />}
                <span className="font-data text-3xs uppercase tracking-[.1em] text-cz-3">{s.label}</span>
              </div>
              <p className="font-data text-[20px] font-[650] tabular-nums text-cz-1">{s.value}</p>
            </div>
          );
        })}
      </div>

      {highlights.length > 0 && (
        <ol className="mt-1">
          {highlights.map((h, i) => (
            <li key={h.id ?? i} className="flex items-center gap-2.5 border-t border-cz-border py-2">
              {h.icon && <h.icon size={14} className="flex-shrink-0 text-cz-2" aria-hidden="true" />}
              <span className="min-w-0 flex-1 truncate text-[13px] text-cz-2">{h.label}</span>
              <span className="font-data flex-shrink-0 text-[13px] font-semibold tabular-nums text-cz-1">
                {h.value}
              </span>
            </li>
          ))}
        </ol>
      )}

      <div className="mt-5 flex justify-end border-t border-cz-border pt-4">
        <Button
          variant="primary"
          size="sm"
          onClick={handleShare}
          iconLeft={<ClipboardIcon size={14} aria-hidden="true" />}
        >
          {copied ? t("recap.shareCopied") : t("recap.share")}
        </Button>
      </div>
    </Section>
  );
}
