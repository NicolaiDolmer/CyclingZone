// #8609 · Brostens- og grussektorerne paa en etapeprofil (spillerfeedback 22/11: "hvor er brostenene
// paa den her etape?"). Profilen tegner sektorerne som skraverede felter; listen her giver hver sektor
// fuld tekst: underlag, navn, placering (km fra-til), laengde og km til maal, ogsaa paa mobil, hvor en
// tooltip ikke kan holdes. Genbrugelig under enhver etapeprofil, som StageClimbList (#8857).
//
// Med onSelect er hver raekke et valg af sektoren, og profilen markerer den med en hairline-ramme
// (SectorHighlight). Uden onSelect er listen ren laesning.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../lib/intl.js";
import type { ProfileGeometry } from "../race/stagePageV2/StageProfileV2.tsx";
import type { SectorKind, SectorRow } from "./stageSectorRows.ts";

const one = (v: number) => formatNumber(v, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

/** Underlagets tegn: samme moenster som profilens felter (streger = brosten, prikker = grus). Stroke, ingen emoji. */
export function SectorGlyph({ kind }: { kind: SectorKind }) {
  return (
    <svg width={16} height={10} viewBox="0 0 16 10" aria-hidden="true" className="shrink-0">
      <rect x={0.5} y={0.5} width={15} height={9} rx={1.5} fill="none" stroke="var(--border)" />
      {kind === "gravel"
        ? [4, 8, 12].map((x) => <circle key={x} cx={x} cy={5} r={1} fill="var(--text-2)" />)
        : [2, 6, 10].map((x) => <line key={x} x1={x} y1={8} x2={x + 4} y2={2} stroke="var(--text-2)" strokeWidth={1.3} />)}
    </svg>
  );
}

/** Den fulde tekst om en sektor (tooltip og skaermlaeser): underlag, navn, laengde, placering, til maal. */
export function useSectorText() {
  const { t } = useTranslation("planning");
  return (row: SectorRow) =>
    t("sectorList.full", {
      kind: t(`sectorList.kind.${row.kind}`),
      name: row.name ?? t("sectorList.sector"),
      length: one(row.lengthKm),
      from: one(row.startKm),
      to: one(row.endKm),
      toFinish: formatNumber(row.kmToGo),
    });
}

/** Den valgte sektor paa profilen: hairline-ramme om feltet (lag oven paa StageProfileV2 via overlay). */
export function SectorHighlight({ geo, row }: { geo: ProfileGeometry; row: SectorRow | null }) {
  if (!row) return null;
  const x0 = geo.X(row.startKm);
  const w = Math.max(2, geo.X(row.endKm) - x0);
  return (
    <rect
      data-testid="sector-highlight"
      x={x0}
      y={geo.top - 30}
      width={w}
      height={geo.bottom - geo.top + 30}
      fill="none"
      stroke="var(--text-1)"
      strokeWidth={1}
      pointerEvents="none"
    />
  );
}

export default function StageSectorList({
  rows,
  selected,
  onSelect,
}: {
  /** Etapens sektorer i km-raekkefoelge (sectorRows). */
  rows: SectorRow[];
  /** Den valgte sektor (indeks), naar listen styrer profilens markering. */
  selected?: number | null;
  onSelect?: (index: number | null) => void;
}) {
  const { t } = useTranslation("planning");
  const fullText = useSectorText();
  if (!rows.length) return null;
  const kinds = new Set(rows.map((r) => r.kind));
  const titleKey = kinds.size > 1 ? "titleMixed" : kinds.has("gravel") ? "titleGravel" : "titleCobbles";
  const title = t(`sectorList.${titleKey}`);
  return (
    <section aria-label={title} data-testid="stage-sector-list" className="mt-3">
      <h4 className="mb-1.5 text-xs font-semibold text-cz-1">{title}</h4>
      <div className="overflow-hidden rounded-cz border border-cz-border">
        <table data-sort-exempt="etapens sektorer i km-raekkefoelge, ikke en sorterbar liste" className="w-full border-collapse text-xs">
          <thead className="hidden sm:table-header-group">
            <tr className="bg-cz-subtle text-2xs text-cz-3">
              <th scope="col" className="px-2.5 py-1.5 text-left font-medium">{t("sectorList.sector")}</th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{t("sectorList.from")}</th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{t("sectorList.length")}</th>
              <th scope="col" className="px-2.5 py-1.5 text-right font-medium">{t("sectorList.toFinish")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const on = onSelect != null && row.index === selected;
              const kindLabel = t(`sectorList.kind.${row.kind}`);
              const label = row.name ?? kindLabel;
              const full = fullText(row);
              const nameCell = (
                <span className="flex min-w-0 items-center gap-2">
                  <SectorGlyph kind={row.kind} />
                  <span className="truncate font-medium text-cz-1">{label}</span>
                  {/* Underlaget staar i overskriften; kun en blandet etape skriver det pr. raekke. */}
                  {row.name && kinds.size > 1 && <span className="shrink-0 text-2xs text-cz-3">{kindLabel}</span>}
                </span>
              );
              return (
                <tr
                  key={`${row.startKm}-${row.index}`}
                  title={full}
                  data-sector={row.kind}
                  data-selected={on ? "true" : undefined}
                  className={`border-t border-cz-border first:border-t-0 sm:first:border-t ${on ? "bg-cz-subtle" : ""}`}
                >
                  <td className="px-2.5 py-1.5">
                    {onSelect ? (
                      <button
                        type="button"
                        onClick={() => onSelect(on ? null : row.index)}
                        aria-pressed={on}
                        aria-label={t("sectorList.showOnProfile", { text: full })}
                        className="block w-full min-w-0 text-left"
                      >
                        {nameCell}
                      </button>
                    ) : (
                      nameCell
                    )}
                    {/* Mobil: tallene staar under navnet med fuld tekst (ingen smalle kolonner). */}
                    <span className="mt-0.5 block font-data text-2xs tabular-nums text-cz-2 sm:hidden">
                      {t("sectorList.mobileFacts", {
                        from: one(row.startKm),
                        to: one(row.endKm),
                        length: one(row.lengthKm),
                        toFinish: formatNumber(row.kmToGo),
                      })}
                    </span>
                  </td>
                  <td className="hidden px-2.5 py-1.5 text-right font-data tabular-nums text-cz-2 sm:table-cell">
                    {t("sectorList.range", { from: one(row.startKm), to: one(row.endKm) })}
                  </td>
                  <td className="hidden px-2.5 py-1.5 text-right font-data tabular-nums text-cz-1 sm:table-cell">{one(row.lengthKm)} km</td>
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
