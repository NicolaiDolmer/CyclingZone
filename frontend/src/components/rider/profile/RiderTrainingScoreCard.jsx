// RiderTrainingScoreCard — traeningsscoren paa rytterprofilens traeningsfane (#4851).
//
// Ejer-beslutning 6 (6/9): "kort paa rytterprofilens traeningsfane: dagens tal
// stort, gennemsnit og bedste over 30 loebsdage, kurve, én linje 'hvad traekker
// op/ned'". Kortet ERSTATTER den midlertidige 30-dages-trend (TrendCard) den
// dag flaget `training_score_visible` taendes.
//
// Kort tekst paa fladen, forklaringen i Hjaelp (help.json) — ejer 20/8 (#4025).

import { useTranslation } from "react-i18next";
import TrainingScoreSparkline from "../../training/TrainingScoreSparkline.jsx";

export default function RiderTrainingScoreCard({ score, t }) {
  const { t: tTraining } = useTranslation("training");
  const spark = Array.isArray(score?.spark) ? score.spark : [];
  const hasToday = Number.isFinite(score?.today);

  // Den ene linje "hvad traekker op/ned": stoerste bidrag op og stoerste ned.
  const up = (score?.contributions ?? []).find((c) => c.direction === "up") ?? null;
  const down = (score?.contributions ?? []).find((c) => c.direction === "down") ?? null;
  const driverLabel = (c) => tTraining(`score.factor_${c.key}`, { defaultValue: c.key });

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <span className="font-mono text-3xs font-bold uppercase tracking-[0.12em] text-cz-accent-t">
        {t("profile.training.score.title")}
      </span>

      <div className="mt-2.5 flex items-end justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono tabular-nums text-[40px] font-bold leading-none text-cz-1">
            {hasToday ? score.today : score?.todayIsRaceDay ? t("profile.training.score.race") : "—"}
          </div>
          <div className="text-3xs text-cz-3 mt-1.5 leading-tight">
            {score?.todayIsRaceDay && !hasToday
              ? t("profile.training.score.raceNote")
              : t("profile.training.score.todayLabel")}
          </div>
        </div>
        {spark.length > 0 && (
          <TrainingScoreSparkline
            points={spark}
            label={t("profile.training.score.sparkAria")}
            width={116}
            height={34}
          />
        )}
      </div>

      <div className="grid grid-cols-2 gap-2 mt-3 pt-2.5 border-t border-cz-border">
        <div>
          <div className="font-mono tabular-nums text-lg font-bold leading-none text-cz-1">
            {Number.isFinite(score?.avg) ? score.avg : "—"}
          </div>
          <div className="text-3xs text-cz-3 mt-1.5 leading-tight">
            {t("profile.training.score.avg", { days: score?.days ?? 0 })}
          </div>
        </div>
        <div>
          <div className="font-mono tabular-nums text-lg font-bold leading-none text-cz-1">
            {Number.isFinite(score?.best) ? score.best : "—"}
          </div>
          <div className="text-3xs text-cz-3 mt-1.5 leading-tight">
            {t("profile.training.score.best")}
          </div>
        </div>
      </div>

      {(up || down) && (
        <p className="mt-3 pt-2.5 border-t border-cz-border text-3xs text-cz-3 leading-snug">
          {up && t("profile.training.score.driverUp", { driver: driverLabel(up), points: up.points })}
          {up && down ? " · " : ""}
          {down && t("profile.training.score.driverDown", { driver: driverLabel(down), points: Math.abs(down.points) })}
        </p>
      )}
    </div>
  );
}
