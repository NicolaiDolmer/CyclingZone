// TrainingProgramGrid — programmet som GITTER: 7 ugedage x N loebsdage (#3643).
//
// Ejer 18/9 (laast): programmet staar som et gitter, ikke som en liste, og det
// skalerer med antallet af loebsdage. Med `training_tick_per_race_day` OFF er
// der een raekke — samme form, ikke en anden komponent.
//
// Laesevisning. Redigeringen bor uaendret paa Program-fanen (holdets ugerytme),
// som "Redigér" springer til: mobil-fladen opfinder ikke sin egen editor.
//
// Loebs-cellen bruger det etablerede INVERTEREDE par (`bg-cz-1 text-cz-card`,
// samme som D-047's "Fuld tabel"-chip), ikke en raa navy-hex: fyldet skal vende
// med temaet i stedet for at blive en sort blok paa en moerk flade (TASTE §3).

import { Fragment } from "react";
import { useTranslation } from "react-i18next";
import type { ProgramCell } from "../../../lib/trainingMobileModel.ts";

export default function TrainingProgramGrid({
  weekdays,
  rows,
  onEdit,
  isRaceCell,
}: {
  weekdays: readonly string[];
  rows: ProgramCell[][];
  onEdit: () => void;
  // Loebsdage hvor rytterne koerer loeb i stedet for at traene. Uden
  // loebsdags-data er den altid false, og gitteret viser bare ugerytmen.
  isRaceCell?: (cell: ProgramCell) => boolean;
}) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;
  if (!rows?.length) return null;
  const single = rows.length === 1;

  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
      <div className="flex items-center justify-between border-b border-cz-border ps-3 pe-1">
        <span className="py-2 text-[13px] font-semibold text-cz-1">{t("mobile.programTitle")}</span>
        <button
          type="button"
          onClick={onEdit}
          className="min-h-11 px-2 font-data text-xs font-medium text-cz-accent-t"
        >
          {t("mobile.programEdit")}
        </button>
      </div>

      <div
        className="grid"
        style={{ gridTemplateColumns: `${single ? "" : "32px "}repeat(${weekdays.length}, minmax(0, 1fr))` }}
      >
        {/* Hjoerne + ugedags-hoved */}
        {!single && <span className="border-b border-cz-border bg-cz-subtle" aria-hidden="true" />}
        {weekdays.map((weekday) => (
          <span
            key={`h-${weekday}`}
            className="truncate border-b border-s border-cz-border bg-cz-subtle px-0.5 py-1 text-center font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3 first:border-s-0"
          >
            {t(`weekday_${weekday}`)}
          </span>
        ))}

        {rows.map((row, rowIndex) => (
          <Fragment key={`rd-${rowIndex + 1}`}>
            {!single && (
              <span className="border-t border-cz-border bg-cz-subtle px-0.5 py-1 text-center font-data text-3xs font-semibold uppercase tracking-[.05em] text-cz-3">
                {t("mobile.raceDayShort", { n: rowIndex + 1 })}
              </span>
            )}
            {row.map((cell, cellIndex) => {
              const race = isRaceCell?.(cell) ?? false;
              return (
                <span
                  key={`${cell.weekday}-${cell.raceDay}`}
                  className={`truncate border-s border-t border-cz-border px-0.5 py-1 text-center font-data text-3xs ${
                    single && cellIndex === 0 ? "border-s-0" : ""
                  } ${
                    race
                      ? "bg-cz-1 font-semibold text-cz-card"
                      : cell.intensity === "rest"
                        ? "text-cz-3"
                        : "text-cz-1"
                  }`}
                >
                  {race ? t("mobile.raceShort") : tRider(`training.intensity_${cell.intensity}`)}
                </span>
              );
            })}
          </Fragment>
        ))}
      </div>

      <p className="border-t border-cz-border px-3 py-1.5 font-data text-3xs font-medium uppercase tracking-[.07em] text-cz-3">
        {single ? t("mobile.programNoteSingle") : t("mobile.programNote", { n: rows.length })}
      </p>
    </div>
  );
}
