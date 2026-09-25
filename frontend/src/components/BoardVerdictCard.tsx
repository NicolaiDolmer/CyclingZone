// #5753 (Mandat-launch B) · "The board's verdict" — første highlight i
// sæsonrecappen (SeasonRecapHero på /seasons/:id). Data fra GET
// /api/board/verdict/:seasonId (backend/routes/boardVerdict.js), hentet
// best-effort af SeasonEndPage og sendt ind her som ren data.
//
// DESIGN (TASTE.md): rækken deler anatomi med de andre highlights (ikon, label,
// tabular værdi, hairline-top fra listen), citatet er samme subtle-flade som
// Boardroom'ens formands-citat (BoardCard.jsx, ingen accent-bjælke), og knappen
// er SECONDARY: heroens "Download share card" er sidens ene guld-CTA.
import { useTranslation } from "react-i18next";
import { useNavigate } from "react-router";
import Button from "./ui/Button.jsx";
import { BriefcaseIcon, ChevronRightIcon } from "./ui/icons/index.jsx";

export interface BoardVerdictChairman {
  name: string | null;
  initials: string | null;
  archetypeKey: string;
  quoteKey: string | null;
  quoteFallbackDa: string | null;
}

export interface BoardVerdictCardProps {
  goalsMet: number;
  goalsTotal: number;
  confidenceBefore?: number | null;
  confidenceAfter?: number | null;
  chairman?: BoardVerdictChairman | null;
  meetingAvailable?: boolean;
}

export default function BoardVerdictCard({
  goalsMet,
  goalsTotal,
  confidenceBefore = null,
  confidenceAfter = null,
  chairman = null,
  meetingAvailable = false,
}: BoardVerdictCardProps) {
  const { t } = useTranslation(["seasonEnd", "board"]);
  const navigate = useNavigate();

  const hasConfidence = confidenceBefore != null && confidenceAfter != null;
  const value = t("recap.boardVerdict.value", { met: goalsMet, total: goalsTotal });

  // Replikken bor i board-namespacet (boardArchetypes' stemme-linjer); den rå
  // danske tekst fra backenden er fallback, samme mønster som Boardroom.
  const quote = chairman?.quoteKey
    ? t(chairman.quoteKey, { ns: "board", defaultValue: chairman.quoteFallbackDa ?? "" })
    : "";

  return (
    <div data-testid="board-verdict">
      <div className="flex flex-wrap items-center gap-x-2.5 gap-y-0.5">
        <BriefcaseIcon size={14} className="flex-shrink-0 text-cz-2" aria-hidden="true" />
        <span className="flex-1 whitespace-nowrap text-[13px] text-cz-2">{t("recap.boardVerdict.label")}</span>
        <span className="font-data ms-auto inline-flex flex-wrap items-center justify-end gap-x-1 text-[13px] font-semibold tabular-nums text-cz-1">
          <span>{value}</span>
          {hasConfidence && (
            // Pilen er et stroke-ikon, ikke en unicode-glyf (lint-ui-slop, PAGE_TEMPLATES).
            <span className="inline-flex items-center gap-1 font-normal text-cz-2">
              <span aria-hidden="true">·</span>
              <span>{t("recap.boardVerdict.confidence")}</span>
              <span className="font-semibold text-cz-1">{Math.round(confidenceBefore)}</span>
              <ChevronRightIcon size={11} className="text-cz-3" aria-hidden="true" />
              <span className="sr-only">{t("recap.boardVerdict.confidenceTo")}</span>
              <span className="font-semibold text-cz-1">{Math.round(confidenceAfter)}</span>
            </span>
          )}
        </span>
      </div>

      {quote && (
        <figure className="mt-2.5 rounded-cz bg-cz-subtle px-3.5 py-3">
          <blockquote className="text-[13.5px] leading-relaxed text-cz-1">&ldquo;{quote}&rdquo;</blockquote>
          {chairman?.name && (
            <figcaption className="mt-1.5 text-2xs uppercase tracking-[.08em] text-cz-3">
              {t("recap.boardVerdict.attribution", { name: chairman.name })}
            </figcaption>
          )}
        </figure>
      )}

      <div className="mt-2.5 flex justify-end">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => navigate(meetingAvailable ? "/board/meeting" : "/board")}
        >
          {meetingAvailable ? t("recap.boardVerdict.ctaMeeting") : t("recap.boardVerdict.ctaBoardroom")}
        </Button>
      </div>
    </div>
  );
}
