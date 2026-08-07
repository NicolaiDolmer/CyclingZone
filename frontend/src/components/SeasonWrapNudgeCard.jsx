import { useTranslation } from "react-i18next";
import { Section, SectionHeader, Button, ZonePill, XIcon } from "./ui";
import { formatNumber } from "../lib/intl";
import { RULES_NUMBERS } from "../lib/rulesNumbers";
import { movementTone, movementLabelKey, nextSeasonGoalKey } from "../lib/seasonRecapCopy.js";

// #2752 (design draft, PR pending owner approval) — the ACTIVE season-transition
// nudge for the dashboard: today a manager "falls into" the next season with no
// closure moment for the one that just ended. This card is that moment — it
// surfaces automatically right after a season ends (dashboard, same slot as
// SeasonStartGuideCard.jsx) and bridges backward ("Season N wrapped — you
// finished #Y") into forward ("Season N+1 starts now — here's your goal").
//
// Deliberately a SEPARATE card from SeasonStartGuideCard (the decisions
// checklist): this one is the emotional beat (result + goal), that one is the
// task list. They can both show in the same transition window without
// competing — this card's CTA leads to SeasonRecapHero (the yearbook), the
// checklist's items lead to squad/training/board/academy.
//
// PRESENTATIONAL ONLY (props-in, no fetch) — same reasoning as SeasonRecapHero.
//
// DESIGN: canonical Section/SectionHeader recipe, dismiss-X mirrors
// SeasonStartGuideCard's own dismiss affordance (dismissal should be
// per-season, same localStorage pattern as seasonStartGuide.js — left to the
// real-wiring follow-up). ONE gold primary CTA ("view recap") — but only when
// no higher-priority moment already owns the gold slot; see `primary` prop.
//
// #3509 — this card used to always render its CTA as gold, which could stack
// with TeamSelectionCtaCard's own gold CTA right after a season switch (recap
// not dismissed yet AND next season's squad selection still missing). The
// gold-CTA priority chain now lives in DashboardPage.jsx (first-race-moment >
// squad-selection-CTA > season-wrap); `primary` reflects whether this card
// won that chain.
export default function SeasonWrapNudgeCard({
  seasonNumber,
  nextSeasonNumber,
  division,
  divisionSize,
  rank,
  movement = null,
  points = 0,
  wins = 0,
  primary = true,
  onView,
  onDismiss,
}) {
  const { t } = useTranslation("dashboard");

  const movementLabel = t(`seasonWrap.movement.${movementLabelKey(movement)}`, { division });
  const goalSuffix = nextSeasonGoalKey({
    movement,
    division,
    minDivision: RULES_NUMBERS.minDivision,
    maxDivision: RULES_NUMBERS.maxDivision,
  });

  return (
    <Section className="mb-4" data-testid="season-wrap-nudge">
      <SectionHeader
        title={t("seasonWrap.title", { number: seasonNumber })}
        action={
          onDismiss && (
            <button
              type="button"
              onClick={onDismiss}
              className="shrink-0 leading-none text-cz-3 transition-colors hover:text-cz-1"
              aria-label={t("seasonWrap.dismissAria")}
            >
              <XIcon size={16} aria-hidden="true" />
            </button>
          )
        }
      />

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <ZonePill tone={movementTone(movement)}>{movementLabel}</ZonePill>
        {rank != null && divisionSize != null && (
          <span className="text-[13px] text-cz-2">
            {t("seasonWrap.rankLine", { rank, size: divisionSize, division })}
          </span>
        )}
      </div>

      <p className="mb-4 font-data text-2xs uppercase tracking-[.08em] tabular-nums text-cz-3">
        {t("seasonWrap.statsLine", { points: formatNumber(points), wins })}
      </p>

      <p className="mb-4 border-t border-cz-border pt-3 text-[13px] text-cz-2">
        {t(`seasonWrap.goal.${goalSuffix}`, { nextNumber: nextSeasonNumber, division })}
      </p>

      <div className="flex justify-end">
        <Button variant={primary ? "primary" : "secondary"} size="sm" onClick={onView}>
          {t("seasonWrap.cta")}
        </Button>
      </div>
    </Section>
  );
}
