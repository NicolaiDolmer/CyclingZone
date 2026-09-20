// TrainingRaceDayStrip — dagens loebsdage som een stribe (#3643, mockup 2).
//
// Dagen laeses KRONOLOGISK som en raekke loebsdage, ikke som klokkeslaet
// (docs/design/mockups-training-mobile-2026-09-18/README.md, ejer 18/9). Med
// `training_tick_per_race_day` OFF er der praecis EEN loebsdag, og striben
// skriver "I dag" i stedet for at nummerere en model der ikke koerer endnu.
//
// Hver celle baerer det der faktisk er maalt: hvor mange ryttere der koerer
// loeb mod hvor mange der traener. Ingen fremskrivninger, ingen saeson-tal.

import { useTranslation } from "react-i18next";
import type { RaceDayColumn } from "../../../lib/trainingMobileModel.ts";

// `set` = ryttere der HAR en dag paa denne loebsdag (et loeb eller en session).
// `total` = hele truppen. En rytter uden et valg taeller ikke som traenende.
export type RaceDaySplit = { set: number; total: number };

export default function TrainingRaceDayStrip({
  columns,
  splitFor,
}: {
  columns: RaceDayColumn[];
  splitFor: (column: RaceDayColumn) => RaceDaySplit;
}) {
  const { t } = useTranslation("training");
  if (!columns?.length) return null;
  const single = columns.length === 1;

  return (
    <div>
      <div className="flex overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        {columns.map((column) => {
          const split = splitFor(column);
          return (
            <div
              key={column.key}
              className={`flex-1 border-s border-cz-border px-1.5 py-2 text-center first:border-s-0 ${
                column.state === "now" ? "bg-cz-subtle" : ""
              }`}
            >
              <div
                className={`font-data text-3xs font-semibold uppercase tracking-[.09em] ${
                  column.state === "now" ? "text-cz-1" : "text-cz-3"
                }`}
              >
                {single ? t("mobile.today") : t("mobile.raceDayShort", { n: column.index })}
              </div>
              <div className="mt-0.5 font-data text-sm font-semibold leading-tight tabular-nums">
                {split.set}
                <span className="font-medium text-cz-3">/</span>
                <span className="text-cz-2">{split.total}</span>
              </div>
              <div className="mt-0.5 font-data text-3xs font-medium uppercase tracking-[.07em] text-cz-3">
                {t(`mobile.raceDayState_${column.state}`)}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-1.5 font-data text-3xs font-medium uppercase tracking-[.07em] text-cz-3">
        {t("mobile.stripLegend")}
      </p>
    </div>
  );
}
