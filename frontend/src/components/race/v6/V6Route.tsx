// #8253 · Én fælles rute i løbsside v6 (ejer 16/11): den lyse, farvede profil
// fra Etape-fanen (StageProfileV2, farvebånd pr. stigningsprocent) med
// bjergpriser (kategori-mærke + nummer + km), mellemspurter med km og mål
// direkte på profilen, en kompakt liste over rutens punkter og farveforklaringen
// under. Bruges af Resultater-panelet "Ruten" (V6RouteProfile) og senere af
// løbsfilmen (#7861).
//
// To størrelser ud fra den målte bredde (v6RouteSize): BRED som Etape-fanen og
// SMAL (Resultater-kolonnen og mobil), hvor kun mærke + nummer står på profilen
// og km står i listen. Profilen tegnes i den bredde, kolonnen faktisk har, så
// tekst aldrig skaleres. Reglerne bor i v6RouteModel.ts.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import StageProfileV2, { GradientLegend, type ProfileGeometry } from "../stagePageV2/StageProfileV2.tsx";
import { elevationSeries, sortedClimbs, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { FlagIcon } from "./v6Ui.ts";
import {
  v6RouteKm, v6RouteLabelPlan, v6RoutePoints, v6RouteSize, v6SummitFinish, v6TextWidth,
  type V6RouteClimb, type V6RoutePoints,
} from "./v6RouteModel.ts";

/** Kategori-mærket som Etape-fanen tegner det (HC og 1 mørkere end 2-4). */
function climbMarkFill(cat: string): string {
  return cat === "HC" || cat === "1" ? "rgb(var(--climb-grad-4))" : "rgb(var(--climb-grad-3))";
}

function CategoryMark({ cat }: { cat: string }) {
  return (
    <span
      className="inline-flex h-4 min-w-[18px] items-center justify-center rounded-[3px] px-0.5 font-data text-3xs font-bold leading-none text-white"
      style={{ background: climbMarkFill(cat) }}
      aria-hidden="true"
    >
      {cat}
    </span>
  );
}

function SprintMark() {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-cz-success font-data text-3xs font-bold leading-none text-white" aria-hidden="true">S</span>
  );
}

/** Etiketterne oven på StageProfileV2 (overlay), placeret efter v6RouteModel's regel. */
function RouteLabels({ geo, points, finishText }: { geo: ProfileGeometry; points: V6RoutePoints; finishText: string | null }) {
  const size = geo.narrow ? "narrow" : "wide";
  const D = points.finishKm;
  // Målets tekst står som i StageProfileV2: grundlinje 34 px over profilens top.
  const plan = v6RouteLabelPlan(points, size, geo.W, geo.X, {
    finishLabelWidth: finishText ? v6TextWidth(finishText, 11) : 0,
    finishLabelY: [geo.top - 45, geo.top - 31],
    y: (km) => geo.Y(geo.elevation(km)),
  });
  const halo = { stroke: "var(--bg-card)", strokeWidth: 3, paintOrder: "stroke" as const };
  return (
    <g aria-hidden="true" pointerEvents="none">
      {points.finalKmFrom !== null && (
        <rect data-route-final-km x={geo.X(points.finalKmFrom)} y={geo.bottom + 13} width={Math.max(1, geo.X(D) - geo.X(points.finalKmFrom))} height={2} fill="var(--text-2)" />
      )}
      {points.climbs.map((c, i) => {
        const p = plan.climbs[i];
        if (!p.side) return null;
        const tx = geo.X(c.km), ty = geo.Y(geo.elevation(c.km));
        const left = p.side === "left";
        const anchor = left ? "end" : "start";
        if (size === "narrow") {
          return (
            <text key={`c-${c.number}`} data-route-label="climb" x={tx + (left ? -13 : 13)} y={ty - 34} textAnchor={anchor} fontSize={11} fontWeight={700} fill="var(--text-1)" className="font-data tabular-nums" {...halo}>{p.tag}</text>
          );
        }
        return (
          <g key={`c-${c.number}`} data-route-label="climb">
            {p.name && (
              <text x={tx + (left ? -16 : 16)} y={ty - 40} textAnchor={anchor} fontSize={12} fontWeight={700} fill="var(--text-1)" className="font-data" {...halo}>{p.name}</text>
            )}
            <text x={tx + (left ? -16 : 16)} y={p.name ? ty - 26 : ty - 34} textAnchor={anchor} fontSize={11} fill="var(--text-2)" className="font-data tabular-nums" {...halo}>{p.tag}</text>
          </g>
        );
      })}
      {points.sprints.map((s, i) => {
        const p = plan.sprints[i];
        if (!p.side || !p.tag) return null;
        const sx = geo.X(s.km), sy = geo.Y(geo.elevation(s.km));
        const left = p.side === "left";
        return (
          <text key={`s-${s.number}`} data-route-label="sprint" x={sx + (left ? -11 : 11)} y={sy - 24} textAnchor={left ? "end" : "start"} fontSize={11} fill="var(--text-2)" className="font-data tabular-nums" {...halo}>{p.tag}</text>
        );
      })}
    </g>
  );
}

function climbRowText(c: V6RouteClimb): string {
  return `#${c.number}${c.name ? ` ${c.name}` : ""} · km ${formatNumber(v6RouteKm(c.km))}`;
}

export interface V6RouteProps {
  profile: StageProfile;
}

export default function V6Route({ profile }: V6RouteProps) {
  const { t } = useTranslation("races");
  const series = useMemo(() => elevationSeries(profile), [profile]);
  const climbs = useMemo(() => sortedClimbs(profile), [profile]);
  const points = useMemo(() => v6RoutePoints(profile), [profile]);
  const [selected, setSelected] = useState<number | null>(null);
  if (!series) return null;

  const finishH = Math.round(series.hs[series.hs.length - 1]);
  const finishText = v6SummitFinish(points) ? null : t("stagePageV2.profile.finish", { m: formatNumber(finishH) });

  return (
    <div data-v6-route className="min-w-0">
      <StageProfileV2
        profile={profile}
        series={series}
        climbs={climbs}
        selectedClimb={selected}
        onSelectClimb={(i) => setSelected((cur) => (cur === i ? null : i))}
        climbText={false}
        overlay={(geo) => <RouteLabels geo={geo} points={points} finishText={finishText} />}
      />
      <ol data-route-points className="m-0 mt-3 flex list-none flex-wrap gap-x-4 gap-y-1.5 p-0 font-data text-xs tabular-nums text-cz-2">
        {points.climbs.map((c, i) => (
          <li key={`c-${c.number}`} className={`inline-flex items-center gap-1.5 ${selected === i ? "font-semibold text-cz-1" : ""}`}>
            <CategoryMark cat={c.cat} />
            <span>{climbRowText(c)}</span>
          </li>
        ))}
        {points.sprints.map((s) => (
          <li key={`s-${s.number}`} className="inline-flex items-center gap-1.5">
            <SprintMark />
            <span>{t("stagePageV2.profile.sprint", { km: formatNumber(v6RouteKm(s.km)) })}</span>
          </li>
        ))}
        <li className="inline-flex items-center gap-1.5">
          <FlagIcon size={14} aria-hidden="true" className="text-cz-1" />
          <span>{`${t("stagePageV2.profile.finish", { m: formatNumber(finishH) })} · km ${formatNumber(v6RouteKm(points.finishKm))}`}</span>
        </li>
      </ol>
      <div data-route-legend className="mt-3 flex flex-wrap items-center gap-x-3.5 gap-y-1.5 [&>div]:contents">
        <GradientLegend profile={profile} />
        {points.sprints.length > 0 && (
          <span className="inline-flex items-center gap-1.5 font-data text-2xs text-cz-2">
            <span className="inline-block h-2 w-2 rounded-full bg-cz-success" aria-hidden="true" />
            {t("stagePageV2.story.splits.sprint")}
          </span>
        )}
        {points.finalKmFrom !== null && (
          <span className="inline-flex items-center gap-1.5 font-data text-2xs text-cz-2">
            <span className="inline-block h-0.5 w-4 bg-[var(--text-2)]" aria-hidden="true" />
            {t("stagePlan.from.final_km")}
          </span>
        )}
      </div>
      {series.source === "synthetic" && <p className="m-0 mt-2 text-xs text-cz-3">{t("stagePageV2.profile.drawn")}</p>}
    </div>
  );
}
