// TrainingMoment — daily curated training story on the check-in (#2484, H3).
//
// Replaces "just the raw numbers" as the first thing a manager sees on
// /training with ONE selected story from the most recently completed
// training day. Standalone card above the roster/report tables — it renders
// its own markup and doesn't touch the table layout, so it doesn't collide
// with the #2446 column-overflow fix (tracked in that issue + this PR body).
//
// All copy is fact-grounded (a gain that happened, or a live progress
// fraction) — never ceiling/potential language (#1162 fog-gate).

import { useTranslation } from "react-i18next";
import { selectTrainingMoment, MOMENT_TYPES } from "../../lib/trainingMoment.js";

function capitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// latestRun    : { tick_date, report: { riders } } | null — most recently
//                completed training day (today's run if already executed,
//                otherwise the last historical one)
// isToday      : whether latestRun is today's run (controls the eyebrow label)
// progressByRider : live ability_progress map (useTraining's `progress`)
// pastRuns     : runs strictly before latestRun, newest-first (cooldown only)
export default function TrainingMoment({ latestRun, isToday, progressByRider, pastRuns }) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;

  const moment = selectTrainingMoment(latestRun, progressByRider, pastRuns);
  if (!moment) return null;

  let body;
  if (moment.type === MOMENT_TYPES.QUIET) {
    const key = moment.allRest ? `momentRest_${moment.variant}` : `momentQuiet_${moment.variant}`;
    body = t(key, { trained: moment.trained });
  } else {
    const ability = moment.ability ? tRider(`racePreview.derived.${moment.ability}`) : "";
    body = t(`moment${capitalize(moment.type)}_${moment.variant}`, {
      riderName: moment.riderName,
      ability,
      from: moment.from,
      to: moment.to,
      pct: moment.pct,
    });
  }

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz px-4 py-3 sm:px-5 sm:py-4">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-cz-3 mb-1">
        {t(isToday ? "momentLabelToday" : "momentLabelLatest")}
      </p>
      <p className="text-sm sm:text-base text-cz-1 leading-relaxed">{body}</p>
    </div>
  );
}
