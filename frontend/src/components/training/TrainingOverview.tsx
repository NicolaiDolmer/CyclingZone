// TrainingOverview — overblikket oeverst paa fanen Today (#5485, aendring 1).
//
// Clarity 16-23/9: mobil-besoeget er et hurtigt tjek (41 s aktiv tid mod 146 s
// paa PC), og scroll-dybden paa 90-96 % viste at det spilleren skulle bruge
// stod langt nede. Foerste skaerm svarer derfor paa "hvem mangler en dag, hvem
// koerer loeb, hvem traener, hvem er traet" som fire tal. Et tryk paa et tal
// filtrerer tabellen til netop de ryttere; et tryk mere viser alle igen.
//
// Tre geometrier af det samme indhold:
//   desktop  fire celler + dagens status i en femte (sidens statuslinje)
//   compact  fire celler, tal over etiket (telefon, portraet)
//   chips    fire smaa chips paa fanelinjen (telefon paa langs, under ca. 500 px)

import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import type { OverviewFilter } from "./trainingOverview.ts";

export type OverviewCell = {
  key: OverviewFilter;
  label: string;
  shortLabel: string;
  count: number;
  context?: string | null;
  // Advarselsfarve paa tallet: nogen mangler en dag, eller nogen er traette.
  warn?: boolean;
};

export default function TrainingOverview({
  cells,
  active,
  onToggle,
  variant,
  status = null,
}: {
  cells: OverviewCell[];
  active: OverviewFilter | null;
  onToggle: (key: OverviewFilter) => void;
  variant: "desktop" | "compact" | "chips";
  status?: ReactNode;
}) {
  const { t } = useTranslation("training");

  if (variant === "chips") {
    return (
      <div className="flex items-center gap-1.5" role="group" aria-label={t("overview.label")}>
        {cells.map((cell) => (
          <button
            key={cell.key}
            type="button"
            aria-pressed={active === cell.key}
            title={t("overview.filterAria", { label: cell.label })}
            onClick={() => onToggle(cell.key)}
            className={`inline-flex items-baseline gap-1 whitespace-nowrap rounded-cz border px-2 py-1 text-2xs text-cz-2 transition-colors ${
              active === cell.key ? "border-cz-1 bg-cz-subtle" : "border-cz-border bg-cz-card hover:bg-cz-subtle"
            }`}
          >
            <b className={`font-data text-sm font-semibold tabular-nums ${cell.warn && cell.count > 0 ? "text-cz-warning" : "text-cz-1"}`}>
              {cell.count}
            </b>
            {cell.shortLabel}
          </button>
        ))}
      </div>
    );
  }

  const compact = variant === "compact";

  return (
    <div
      data-testid="training-overview"
      role="group"
      aria-label={t("overview.label")}
      className={`grid overflow-hidden rounded-cz border border-cz-border bg-cz-card ${
        compact ? "grid-cols-4" : "grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,1.25fr)]"
      }`}
    >
      {cells.map((cell, index) => {
        const pressed = active === cell.key;
        return (
          <button
            key={cell.key}
            type="button"
            aria-pressed={pressed}
            title={t("overview.filterAria", { label: cell.label })}
            onClick={() => onToggle(cell.key)}
            className={`min-w-0 text-start transition-colors ${index > 0 ? "border-s border-cz-border" : ""} ${
              pressed ? "bg-cz-subtle" : "hover:bg-cz-subtle"
            } ${compact ? "min-h-11 px-2 py-2" : "px-4 py-3"}`}
          >
            {compact ? (
              <>
                <span
                  className={`block font-data text-xl font-semibold leading-none tabular-nums ${
                    cell.warn && cell.count > 0 ? "text-cz-warning" : "text-cz-1"
                  }`}
                >
                  {cell.count}
                </span>
                <span className="mt-1 block truncate font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
                  {cell.shortLabel}
                </span>
              </>
            ) : (
              <>
                <span className="block truncate font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-3">
                  {cell.label}
                </span>
                <span className="mt-1.5 flex min-w-0 items-baseline gap-2">
                  <span
                    className={`font-data text-[22px] font-semibold leading-none tabular-nums ${
                      cell.warn && cell.count > 0 ? "text-cz-warning" : "text-cz-1"
                    }`}
                  >
                    {cell.count}
                  </span>
                  {cell.context && (
                    <span className="min-w-0 truncate text-xs text-cz-2" title={cell.context}>
                      {cell.context}
                    </span>
                  )}
                </span>
              </>
            )}
          </button>
        );
      })}
      {!compact && (
        <div className="flex min-w-0 items-center justify-between gap-3 border-s border-cz-border px-4 py-3">
          {status}
        </div>
      )}
    </div>
  );
}
