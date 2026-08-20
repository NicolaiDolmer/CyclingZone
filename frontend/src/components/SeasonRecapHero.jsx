import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Section, SectionHeader, Button, ZonePill,
  BookOpenIcon, PodiumIcon, TrophyIcon, CoinIcon, ClipboardIcon, DownloadIcon,
} from "./ui";
import { formatNumber } from "../lib/intl";
import { movementTone, movementLabelKey } from "../lib/seasonRecapCopy.js";

// #2752 — the "yearbook" recap hero: a per-team, shareable summary of a
// JUST-COMPLETED season. Sits at the TOP of SeasonEndPage (/seasons/:id) for
// MY team's row, above the season-wide SeasonHonours block — SeasonHonours
// crowns the season's best RIDERS (anyone's), this hero is about how MY TEAM
// did. Wired to real data (season_standings + the recap RPC SeasonEndPage
// already fetches: final rank, points, stage wins, prize) since PR #3283/
// follow-ups; the mock preview at /ui/season-experience still feeds it
// hand-built data for scenario review.
//
// DESIGN (docs/design/PAGE_TEMPLATES.md): same gold-keyline Section recipe as
// SeasonHonours.jsx directly above it on the page (border-t-2 border-t-cz-accent)
// — the two blocks read as one "season wrapped" moment, not two unrelated cards.
// ONE gold primary button (season-recap-polish 18/8, ejer-godkendt mockup):
// "Download share card" — the canvas-exported PNG that used to live on
// SeasonDocumentary.jsx's own (now-removed) download button, same card, same
// filename pattern, just triggered from here so the page keeps exactly one
// gold CTA. "Copy recap link" moved to a secondary button next to it.
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
 * @param {() => Promise<void>} [p.onDownloadCard]  bygger + downloader delekortet
 *   (PNG). Selve data-indsamlingen (facts, meta-linje) hører hjemme hos kaldestedet
 *   (SeasonEndPage.jsx) — heroen ejer kun knap-UI'et (loading/fejl), samme
 *   ansvarsdeling som resten af filen (i18n/format i siden, ikke her).
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
  onDownloadCard,
}) {
  const { t } = useTranslation("seasonEnd");
  const [copied, setCopied] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [downloadError, setDownloadError] = useState(false);

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

  const handleDownload = async () => {
    if (!onDownloadCard) return;
    setDownloading(true);
    setDownloadError(false);
    try {
      await onDownloadCard();
    } catch (e) {
      console.error("SeasonRecapHero: share card download failed", e);
      setDownloadError(true);
    } finally {
      setDownloading(false);
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
        <ZonePill tone={movementTone(movement)}>
          {t(`recap.movement.${movementLabelKey(movement)}`, { division })}
        </ZonePill>
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

      <div className="mt-5 flex flex-wrap items-center justify-end gap-2 border-t border-cz-border pt-4">
        {downloadError && (
          <span className="text-xs text-cz-danger">{t("recap.downloadError")}</span>
        )}
        <Button
          variant="secondary"
          size="sm"
          onClick={handleShare}
          iconLeft={<ClipboardIcon size={14} aria-hidden="true" />}
        >
          {copied ? t("recap.linkCopied") : t("recap.copyLink")}
        </Button>
        <Button
          variant="primary"
          size="sm"
          onClick={handleDownload}
          disabled={downloading || !onDownloadCard}
          iconLeft={<DownloadIcon size={14} aria-hidden="true" />}
        >
          {downloading ? t("recap.downloading") : t("recap.downloadCard")}
        </Button>
      </div>
    </Section>
  );
}
