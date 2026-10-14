// #6570 · "The climbs": chips til at vaelge en stigning, km-for-km-grafen og
// fire noegletal. Km-for-km findes kun med den rigtige hoejdeserie (#6594);
// uden den viser kortet de tal der er sande (laengde, snit, top) og siger det.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import { climbDetail, type Climb, type ElevationSeries, type StageProfile } from "./stagePageV2Model.ts";
import { bandFill, categoryLabel } from "./StageProfileV2.tsx";
import { Section, SectionHeader } from "./ui.ts";

const one = (v: number) => formatNumber(Math.round(v * 10) / 10, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function PerKmChart({ detail, name }: { detail: ReturnType<typeof climbDetail>; name: string }) {
  const { t } = useTranslation("races");
  const n = detail.perKm.length;
  if (!n) return null;
  const W = 600, H = 170, B = 26, T = 18;
  const maxG = Math.max(4, ...detail.perKm.map((k) => k.grade));
  const colW = W / n;
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full" role="img" aria-label={t("stagePageV2.climbs.perKmAria", { name })}>
      {detail.perKm.map((k, i) => {
        const h = Math.max(4, (Math.max(0, k.grade) / maxG) * (H - B - T));
        const f = bandFill(k.band);
        const x = i * colW;
        return (
          <g key={k.index}>
            <rect x={x + 1} y={H - B - h} width={Math.max(2, colW * k.fraction - 2)} height={h} fill={f.fill} fillOpacity={f.opacity} />
            {colW >= 28 && (
              <text x={x + colW / 2} y={H - B - h - 4} textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text-1)" className="font-data tabular-nums">{one(k.grade)}</text>
            )}
            {colW >= 16 && (
              <text x={x + colW / 2} y={H - 8} textAnchor="middle" fontSize={10} fill="var(--text-3)" className="font-data tabular-nums">{k.index}</text>
            )}
          </g>
        );
      })}
      <line x1={0} x2={W} y1={H - B} y2={H - B} stroke="var(--border)" />
    </svg>
  );
}

export interface ClimbCardProps {
  profile: StageProfile;
  series: ElevationSeries | null;
  climbs: Climb[];
  selected: number;
  onSelect: (index: number) => void;
}

export default function ClimbCard({ profile, series, climbs, selected, onSelect }: ClimbCardProps) {
  const { t } = useTranslation("races");
  if (!climbs.length) {
    return (
      <Section aria-label={t("stagePageV2.climbs.title")}>
        <SectionHeader title={t("stagePageV2.climbs.title")} />
        <p className="text-sm text-cz-3">{t("stagePageV2.climbs.none")}</p>
      </Section>
    );
  }
  const climb = climbs[Math.min(selected, climbs.length - 1)];
  const d = climbDetail(profile, series, climb);
  const base: Array<[string, string]> = [
    [t("stagePageV2.climbs.length"), `${one(Number(climb.length_km))} km`],
    [t("stagePageV2.climbs.average"), `${one(Number(climb.avg_gradient))} %`],
  ];
  // Med den rigtige serie: stejleste km + haardeste 5 km. Uden: toppen og
  // afstanden til maal, som er sande uanset tegningen.
  const kpis: Array<[string, string]> = d.steepest
    ? [
      ...base,
      [t("stagePageV2.climbs.steepest"), t("stagePageV2.climbs.steepestValue", { grade: one(d.steepest.grade), index: d.steepest.index })],
      d.hardest5 !== null
        ? [t("stagePageV2.climbs.hardest5"), `${one(d.hardest5)} %`]
        : [t("stagePageV2.climbs.toFinish"), `${formatNumber(d.kmToGo)} km`],
    ]
    : [
      ...base,
      [t("stagePageV2.climbs.top"), d.topElevation !== null
        ? t("stagePageV2.climbs.topValue", { m: formatNumber(d.topElevation), km: formatNumber(Math.round(d.topKm)) })
        : `km ${formatNumber(Math.round(d.topKm))}`],
      [t("stagePageV2.climbs.toFinish"), `${formatNumber(d.kmToGo)} km`],
    ];
  return (
    <Section aria-label={t("stagePageV2.climbs.title")}>
      <SectionHeader title={t("stagePageV2.climbs.title")} meta={t("stagePageV2.climbs.hint")} />
      <div className="mb-3 flex flex-wrap gap-2">
        {climbs.map((c, i) => {
          const cat = categoryLabel(c.category);
          const on = i === Math.min(selected, climbs.length - 1);
          return (
            <button
              key={`${c.name}-${i}`}
              type="button"
              onClick={on ? undefined : () => onSelect(i)}
              aria-pressed={on}
              className={`inline-flex min-h-9 items-center gap-2 rounded-cz border px-3 py-1.5 font-data text-xs font-semibold transition-colors ${on ? "border-cz-1 text-cz-1" : "cursor-pointer border-cz-border text-cz-2 hover:bg-cz-subtle"}`}
            >
              <span
                className="inline-flex h-[18px] min-w-5 items-center justify-center rounded-sm px-1 text-3xs font-bold text-white"
                style={{ background: cat === "HC" || cat === "1" ? "rgb(var(--climb-grad-4))" : "rgb(var(--climb-grad-3))" }}
              >
                {cat}
              </span>
              {c.name}
            </button>
          );
        })}
      </div>
      {d.perKm.length ? (
        <PerKmChart detail={d} name={climb.name ?? ""} />
      ) : (
        <p className="mb-3 text-xs text-cz-3">{t("stagePageV2.climbs.noPerKm")}</p>
      )}
      <dl className="mt-3 grid grid-cols-2 overflow-hidden rounded-cz border border-cz-border sm:grid-cols-4">
        {kpis.map(([label, value], i) => (
          <div key={`${label}-${i}`} className={`flex min-w-0 flex-col gap-0.5 px-3.5 py-2.5 ${i % 2 === 1 ? "border-l border-cz-border" : ""} ${i >= 2 ? "border-t border-cz-border sm:border-t-0" : ""} ${i === 2 ? "sm:border-l" : ""}`}>
            <dt className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">{label}</dt>
            <dd className="m-0 font-data text-base font-semibold tabular-nums text-cz-1">{value}</dd>
          </div>
        ))}
      </dl>
    </Section>
  );
}
