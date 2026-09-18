// TrainingMobileRoster — hele truppens dag paa eet blik (#3643, mockup 2).
//
// Raekker = ryttere, kolonner = dagens loebsdage. Ingen kolonne ligger bag
// skaermkanten: tabellen er `table-fixed` i en `overflow-hidden`-ramme, og
// navnecellen wrapper i stedet for at staa paa een nowrap-linje. Det er den
// samme haandhaevelse D-047 kraever ("ikke haabet om at indholdet passer"),
// men uden chip-byttere: der er ikke laengere fem kolonner at vaelge imellem.
//
// #5350 (spillerfund 6/9): fornavne i fuld laengde aad bredden, og ryttertypen
// fyldte en hel badge. Navnet er nu "M. Soerensen" + een dæmpet underlinje med
// type, form og traethed — samme form som Mit Hold, som spillerne selv pegede paa.
//
// Rytteren man trykker paa faar sit fulde kort EEN gang UNDER tabellen, ikke i
// hver raekke. Tastaturvejen er knappen i navnecellen (aria-expanded/-controls);
// de oevrige celler er museklik-genveje til den samme handling.

import { useTranslation } from "react-i18next";
import type { RaceDayColumn } from "../../../lib/trainingMobileModel.ts";

export type RosterCell = {
  label: string;
  tone: "race" | "session" | "off";
  title?: string;
};

export type RosterRider = {
  id: string;
  name: string;
  sub: string;
};

export default function TrainingMobileRoster({
  riders,
  columns,
  cellFor,
  selectedId,
  onSelect,
  detailId,
}: {
  riders: RosterRider[];
  columns: RaceDayColumn[];
  cellFor: (riderId: string, column: RaceDayColumn) => RosterCell;
  selectedId: string | null;
  onSelect: (riderId: string) => void;
  // id'et paa kortet under tabellen, saa raekkens knap kan pege paa det.
  detailId: string;
}) {
  const { t } = useTranslation("training");
  const single = columns.length === 1;

  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
      <div className="flex items-center justify-between gap-2 border-b border-cz-border px-3 py-2">
        <span className="text-[13px] font-semibold text-cz-1">{t("mobile.rosterTitle")}</span>
        <span className="font-data text-2xs font-medium uppercase tracking-[.07em] text-cz-3">
          {t("mobile.riderCount", { n: riders.length })}
        </span>
      </div>

      <table className="w-full table-fixed border-separate border-spacing-0" data-testid="training-mobile-roster">
        <thead>
          <tr>
            <th className="w-[124px] border-b border-e border-cz-border px-2.5 py-1.5 text-start font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
              {t("colRider")}
            </th>
            {columns.map((column) => (
              <th
                key={column.key}
                className="border-b border-cz-border px-1 py-1.5 text-center font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3"
              >
                {single ? t("mobile.today") : column.index}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {riders.map((rider, index) => {
            const isSelected = rider.id === selectedId;
            return (
              <tr key={rider.id} className={isSelected ? "bg-cz-subtle" : ""}>
                <td className="border-b border-e border-cz-border align-middle last:border-b-0">
                  <button
                    type="button"
                    onClick={() => onSelect(rider.id)}
                    aria-expanded={isSelected}
                    aria-controls={detailId}
                    // #2819: onboarding-tourens foerste anker paa /training.
                    // Paa desktop sidder det paa Dag-knappen i raekken; her er
                    // raekken SELV vejen til dagens valg, saa ankeret hoerer paa
                    // den oeverste raekkes knap.
                    data-tour={index === 0 ? "training-focus" : undefined}
                    className="flex min-h-11 w-full flex-col justify-center px-2.5 py-1.5 text-start"
                  >
                    <span className="text-[13px] font-medium leading-tight text-cz-1">{rider.name}</span>
                    <span className="mt-px font-data text-3xs font-medium uppercase tracking-[.05em] tabular-nums text-cz-3">
                      {rider.sub}
                    </span>
                  </button>
                </td>
                {columns.map((column) => {
                  const cell = cellFor(rider.id, column);
                  return (
                    <td
                      key={column.key}
                      onClick={() => onSelect(rider.id)}
                      className="border-b border-cz-border px-1 py-1.5 text-center align-middle"
                    >
                      <span
                        title={cell.title}
                        className={`block truncate rounded-cz px-0.5 py-0.5 font-data text-2xs font-semibold leading-tight ${
                          cell.tone === "race"
                            ? "bg-cz-1 text-cz-card"
                            : cell.tone === "off"
                              ? "font-medium text-cz-3"
                              : "text-cz-1"
                        }`}
                      >
                        {cell.label}
                      </span>
                    </td>
                  );
                })}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
