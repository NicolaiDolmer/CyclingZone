// #8857 · Stigningsdetaljerne paa en etapeprofil (egomadsen 26/11, ejer: "should be available everywhere
// theres a stage profile"). Alle etapens kategoriserede stigninger i km-raekkefoelge: kategori, navn,
// top ved km, laengde, gennemsnit og km til maal. Genbrugelig: tager kun etapens profil (samme felter
// som race_stage_profiles) og kan bruges under enhver etapeprofil; planlaegningssiden er den foerste.
//
// Med onSelect er hver raekke et valg af stigningen, synkront med profilens egen markering (samme
// valgte stigning som profilen og finaledetaljerne). Uden onSelect er listen ren laesning.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../lib/intl.js";
import type { Climb, ElevationSeries, StageProfile } from "../race/stagePageV2/stagePageV2Model.ts";
import { categoryLabel } from "../race/stagePageV2/StageProfileV2.tsx";
import { climbRows } from "./stageClimbRows.ts";

const one = (v: number) => formatNumber(Math.round(v * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function CategoryBadge({ cat }: { cat: string }) {
  const { t } = useTranslation("planning");
  // Samme farver som profilens og loebssidens stigningsmaerker (StageProfileV2/ClimbCard).
  const hard = cat === "HC" || cat === "1";
  return (
    <span
      title={t("climbList.category", { cat })}
      aria-label={t("climbList.category", { cat })}
      className="inline-flex h-[18px] min-w-6 shrink-0 items-center justify-center rounded-cz px-1 font-data text-3xs font-bold text-white"
      style={{ background: hard ? "rgb(var(--climb-grad-4))" : "rgb(var(--climb-grad-3))" }}
    >
      {cat}
    </span>
  );
}

export default function StageClimbList({
  profile,
  series = null,
  climbs,
  selected,
  onSelect,
}: {
  profile: StageProfile;
  series?: ElevationSeries | null;
  /** Etapens stigninger sorteret efter km (sortedClimbs). */
  climbs: Climb[];
  /** Den valgte stigning (indeks i climbs), naar listen foelger profilens markering. */
  selected?: number;
  onSelect?: (index: number) => void;
}) {
  const { t } = useTranslation("planning");
  if (!climbs.length) return null;
  const rows = climbRows(profile, series, climbs);
  return (
    <section aria-label={t("climbList.title")} data-testid="stage-climb-list" className="mt-3">
      <h4 className="mb-1.5 text-xs font-semibold text-cz-1">{t("climbList.title")}</h4>
      <div className="overflow-hidden rounded-cz border border-cz-border">
        <table data-sort-exempt="etapens stigninger i km-raekkefoelge, ikke en sorterbar liste" className="w-full border-collapse text-xs">
          <thead className="hidden sm:table-header-group">
            <tr className="bg-cz-subtle text-2xs text-cz-3">
              <th scope="col" className="px-2.5 py-1.5 text-left font-medium">{t("climbList.name")}</th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{t("climbList.top")}</th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{t("climbList.length")}</th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{t("climbList.average")}</th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{t("climbList.toFinish")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const on = onSelect != null && row.index === selected;
              const cat = categoryLabel(row.category);
              const label = row.name ?? t("climbList.category", { cat });
              const nameCell = (
                <span className="flex min-w-0 items-center gap-2">
                  <CategoryBadge cat={cat} />
                  <span className="truncate font-medium text-cz-1">{label}</span>
                </span>
              );
              return (
                <tr
                  key={`${row.name}-${row.index}`}
                  data-selected={on ? "true" : undefined}
                  className={`border-t border-cz-border first:border-t-0 sm:first:border-t ${on ? "bg-cz-subtle" : ""}`}
                >
                  <td className="px-2.5 py-1.5">
                    {onSelect ? (
                      <button
                        type="button"
                        onClick={() => onSelect(row.index)}
                        aria-pressed={on}
                        aria-label={t("climbList.showOnProfile", { name: label })}
                        className="block w-full min-w-0 text-left"
                      >
                        {nameCell}
                      </button>
                    ) : (
                      nameCell
                    )}
                    {/* Mobil: tallene staar under navnet med fuld tekst (ingen smalle kolonner). */}
                    <span className="mt-0.5 block font-data text-2xs tabular-nums text-cz-2 sm:hidden">
                      {t("climbList.mobileFacts", {
                        km: formatNumber(row.topKm),
                        length: one(row.lengthKm),
                        average: one(row.avgGradient),
                        toFinish: formatNumber(row.kmToGo),
                      })}
                    </span>
                  </td>
                  <td className="hidden px-2.5 py-1.5 text-right font-data tabular-nums text-cz-2 sm:table-cell">{formatNumber(row.topKm)}</td>
                  <td className="hidden px-2.5 py-1.5 text-right font-data tabular-nums text-cz-1 sm:table-cell">{one(row.lengthKm)} km</td>
                  <td className="hidden px-2.5 py-1.5 text-right font-data tabular-nums text-cz-1 sm:table-cell">{one(row.avgGradient)} %</td>
                  <td className="hidden px-2.5 py-1.5 text-right font-data tabular-nums text-cz-2 sm:table-cell">{formatNumber(row.kmToGo)} km</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}
