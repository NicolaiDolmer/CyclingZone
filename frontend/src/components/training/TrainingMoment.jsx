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
//
// #5318 part 2: a training injury from TODAY also renders its own warning
// line above the story, always, regardless of which story the rotation
// picked (an injury can lose the ONE headline slot to a bigger breakthrough
// and still needs to be seen, not just on the rider's own roster row).
// Gated on `isToday`: latestRun can be an older, already-cooled-off day when
// today hasn't run yet, and a warning about "today" must not describe a
// day that already happened days ago.

import { useTranslation } from "react-i18next";
import { selectTrainingMoment, selectInjuryAlerts, MOMENT_TYPES } from "../../lib/trainingMoment.js";

function capitalize(s) {
  return s.length ? s[0].toUpperCase() + s.slice(1) : s;
}

// latestRun    : { tick_date, report: { riders } } | null — most recently
//                completed training day (today's run if already executed,
//                otherwise the last historical one)
// isToday      : whether latestRun is today's run (controls the eyebrow label
//                and gates the injury warning line to an actual today)
// progressByRider : live ability_progress map (useTraining's `progress`)
// pastRuns     : runs strictly before latestRun, newest-first (cooldown only)
export default function TrainingMoment({ latestRun, isToday, progressByRider, pastRuns }) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;

  const moment = selectTrainingMoment(latestRun, progressByRider, pastRuns);
  const injuryAlerts = isToday ? selectInjuryAlerts(latestRun) : [];

  if (!moment && injuryAlerts.length === 0) return null;

  const daysPhrase = (days) => t(days === 1 ? "injuryDaysOne" : "injuryDaysOther", { days });

  let body = null;
  if (moment) {
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
        daysPhrase: moment.type === MOMENT_TYPES.INJURY ? daysPhrase(moment.injuryDays) : undefined,
      });
    }
  }

  return (
    <div className="space-y-2">
      {injuryAlerts.length > 0 && (
        <div
          data-testid="training-injury-alert"
          className="bg-cz-card border border-cz-border rounded-cz px-4 py-3 sm:px-5 sm:py-4"
        >
          <p className="text-2xs font-semibold uppercase tracking-wide text-cz-warning mb-1">
            {t("injuryAlertLabel")}
          </p>
          <p className="text-sm sm:text-base text-cz-1 leading-relaxed">
            {t("injuryAlertLine", {
              list: injuryAlerts
                .map((a) => t("injuryAlertEntry", { riderName: a.riderName, daysPhrase: daysPhrase(a.days) }))
                .join(", "),
            })}
          </p>
        </div>
      )}
      {moment && (
        <div className="bg-cz-card border border-cz-border rounded-cz px-4 py-3 sm:px-5 sm:py-4">
          <p className="text-2xs font-semibold uppercase tracking-wide text-cz-3 mb-1">
            {t(isToday ? "momentLabelToday" : "momentLabelLatest")}
          </p>
          <p className="text-sm sm:text-base text-cz-1 leading-relaxed">{body}</p>
        </div>
      )}
    </div>
  );
}
