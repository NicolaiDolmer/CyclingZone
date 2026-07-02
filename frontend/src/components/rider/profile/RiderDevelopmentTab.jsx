// RiderDevelopmentTab — Udvikling-fanen (#2000 stykke 5).
//
// Registreret udvikling fra ÆGTE data: rating pr. ryttertype over tid (evne-
// vektor-snapshots fra GET /api/riders/:id/development, rating via rating-SSOT'en
// riderRating.js), registreret vækst denne sæson og en træningsdrevet
// udviklingslog (training_day_runs via useTrainingHistory — kun egne ryttere,
// fremmede ser en forklaring, spejler designets scouting-skjul).
//
// BEVIDST UDSKUDT (ejer-gate, samme disciplin som Træningsscore): loft-linje,
// stiplet projektion mod loft, "til loft"/"alder ved loft" og den projekterede
// næste-sæson-logrække. Per-type-loft kræver ability_caps (invertérbar til det
// server-skjulte potentiale, #1162); en ærlig projektion skal komme fuzzy fra
// backend efter ejer-review. Se lib/developmentReport.js.
//
// Token-only (ingen rå hex — chart-serier bruger den delte token-palette,
// slot-farver chart-1/chart-2 = prototypens blå/violet 1:1); SVG bruger CSS-vars
// + literal Inter Tight-stack (der findes ingen --font-data CSS-var). Dark mode
// via tokens. Bevidst afvigelse fra prototypen: y-akse-tal + gridlinjer er
// tilføjet (prototypen har ingen), fordi kurverne er datadrevne uden fast
// loft-reference — uden skala-tal er ratingniveauet ulæseligt.

import { useTranslation } from "react-i18next";
import {
  dedupeSnapshots, pickChartTypeKeys, typeSeries, seasonSegments,
  seasonDelta, seasonAbilityGains, dominantPlan, gainDayCount,
} from "../../../lib/developmentReport.js";
import { riderHistoryFromRuns } from "../../../lib/trainingReport.js";
import { HISTORY_DAYS } from "../../../lib/useTrainingHistory.js";
import { chartColor } from "../../../lib/chartPalette.js";
import { formatDate } from "../../../lib/intl.js";

const DATA_FONT = '"Inter Tight", "Inter Tight Fallback", system-ui, sans-serif';

// Chart-geometri — spejler handoff-prototypens viewBox/ankre (300×172; solid
// linjer, primærtype fremhævet med tykkere streg + markør ved nu-punktet).
const VB = { w: 300, h: 172, x0: 36, x1: 290, y0: 26, y1: 140 };

const fmtSigned = (n) => (n > 0 ? `+${n}` : `${n}`);

// ── Chart-kort: rating pr. type over tid ─────────────────────────────────────────
function ChartCard({ snapshots, chartTypes, t }) {
  const seriesByKey = chartTypes.map((tp) => ({ ...tp, points: typeSeries(snapshots, tp.key) }));
  const segments = seasonSegments(snapshots);
  const currentSeason = segments.length > 0 ? segments[segments.length - 1].season : null;

  // X = ægte tid (dato-skaleret — index-baseret x ville lyve om kurvens hældning,
  // fordi daily-snapshots kun skrives på gevinst-dage og derfor ikke er ækvidistante).
  const ts = snapshots.map((s) => Date.parse(s.snapshot_date));
  const tMin = Math.min(...ts), tMax = Math.max(...ts);
  const xAt = (i) => (tMax === tMin
    ? (VB.x0 + VB.x1) / 2
    : VB.x0 + ((ts[i] - tMin) / (tMax - tMin)) * (VB.x1 - VB.x0));

  // Y = lineær rating-skala med luft, klampet til [1,99] (samme domæne-idé som
  // resten af appen: ratings er 1-99).
  const allRatings = seriesByKey.flatMap((s) => s.points.map((p) => p.rating));
  const lo = Math.max(1, Math.min(...allRatings) - 4);
  const hi = Math.min(99, Math.max(...allRatings) + 4);
  const span = Math.max(1, hi - lo);
  const yAt = (r) => VB.y1 - ((r - lo) / span) * (VB.y1 - VB.y0);
  const gridVals = [...new Set([lo, Math.round((lo + hi) / 2), hi])];

  const single = snapshots.length === 1;
  const lastIdx = snapshots.length - 1;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-1.5">
        {t("profile.development.chart.title")}
      </h3>
      <svg viewBox={`0 0 ${VB.w} ${VB.h}`} className="block w-full h-auto" aria-hidden="true">
        {gridVals.map((g) => (
          <g key={`g-${g}`}>
            <line x1={VB.x0} y1={yAt(g).toFixed(1)} x2={VB.x1} y2={yAt(g).toFixed(1)} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
            <text x={VB.x0 - 4} y={(yAt(g) + 3).toFixed(1)} fontSize="8.5" fill="var(--text-3)" fontFamily={DATA_FONT} textAnchor="end">{g}</text>
          </g>
        ))}
        <line x1={VB.x0} y1={VB.y1} x2={VB.x1} y2={VB.y1} stroke="var(--border)" strokeWidth="1" />

        {/* Sæson-grænser (lodret stiplet) + sæson-labels centreret pr. segment. */}
        {segments.map((seg, i) => {
          const cx = (xAt(seg.startIndex) + xAt(seg.endIndex)) / 2;
          const isCurrent = seg.season === currentSeason && i === segments.length - 1;
          const label = seg.season == null
            ? "—"
            : isCurrent
              ? t("profile.development.chart.seasonNow", { n: seg.season })
              : t("profile.development.chart.season", { n: seg.season });
          return (
            <g key={`seg-${seg.season}-${seg.startIndex}`}>
              {i > 0 && (
                <line x1={xAt(seg.startIndex).toFixed(1)} y1={VB.y0 - 2} x2={xAt(seg.startIndex).toFixed(1)} y2={VB.y1} stroke="var(--border)" strokeWidth="1" strokeDasharray="2 3" opacity="0.7" />
              )}
              <text x={cx.toFixed(1)} y="155" fontSize="8.5" fill={isCurrent ? "var(--text-1)" : "var(--text-3)"} fontFamily={DATA_FONT} textAnchor="middle">{label}</text>
            </g>
          );
        })}

        {/* Serier: øvrige typer først, primærtypen sidst/øverst (tykkere + markør). */}
        {[...seriesByKey].reverse().map((s, ri) => {
          const isPrimary = ri === seriesByKey.length - 1;
          const pts = s.points.map((p, i) => `${xAt(i).toFixed(1)},${yAt(p.rating).toFixed(1)}`).join(" ");
          return (
            <g key={s.key}>
              {!single && <polyline points={pts} fill="none" stroke={s.color} strokeWidth={isPrimary ? 2.4 : 2} />}
              {(single || isPrimary) && (
                <circle cx={xAt(lastIdx).toFixed(1)} cy={yAt(s.points[lastIdx].rating).toFixed(1)} r="3" fill={s.color} />
              )}
            </g>
          );
        })}

        <text x={(VB.x0 + VB.x1) / 2} y="168" fontSize="7.5" fill="var(--text-3)" fontFamily={DATA_FONT} textAnchor="middle">
          {t("profile.development.chart.caption")}
        </text>
      </svg>
      <div className="flex gap-3.5 flex-wrap mt-2">
        {seriesByKey.map((s) => (
          <span key={s.key} className="inline-flex items-center gap-1.5 text-[11px] text-cz-2">
            <span className="w-3.5 h-[3px] rounded-sm" style={{ backgroundColor: s.color }} aria-hidden="true" />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  );
}

// ── Vækst denne sæson ────────────────────────────────────────────────────────────
function GrowthCard({ primaryLabel, growth, totalPoints, trackedSince, t }) {
  const rows = [
    {
      label: t("profile.development.growth.typeRating", { type: primaryLabel }),
      value: growth ? t("profile.development.growth.thisSeason", { delta: fmtSigned(growth.delta) }) : "—",
      cls: growth && growth.delta > 0 ? "text-cz-success" : "text-cz-1",
    },
    {
      label: t("profile.development.growth.abilityPoints"),
      value: fmtSigned(totalPoints),
      cls: totalPoints > 0 ? "text-cz-success" : "text-cz-1",
    },
    {
      label: t("profile.development.growth.trackedSince"),
      value: trackedSince ? formatDate(trackedSince, null, { day: "numeric", month: "short" }) : "—",
      cls: "text-cz-1",
    },
  ];
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0 mb-[9px]">
        {t("profile.development.growth.title")}
      </h3>
      <div className="flex flex-col gap-[9px]">
        {rows.map((r) => (
          <div key={r.label} className="flex items-center justify-between gap-2">
            <span className="text-[12.5px] text-cz-2">{r.label}</span>
            <span className={`font-mono tabular-nums font-bold text-[13px] ${r.cls}`}>{r.value}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Læsning (guld venstre-kant) ──────────────────────────────────────────────────
function ReadingCard({ viewer, growth, primaryLabel, t }) {
  const rising = Boolean(growth && growth.delta > 0);
  const key = `profile.development.reading.${viewer === "own" ? "own" : "scouting"}.${rising ? "rising" : "flat"}`;
  return (
    <div className="bg-cz-card border border-cz-border border-l-2 border-l-cz-accent rounded-cz py-[15px] px-[17px]">
      <span className="font-mono text-[9.5px] font-bold uppercase tracking-[0.12em] text-cz-accent-t">
        {t("profile.development.reading.title")}
      </span>
      <p className="mt-[7px] mb-0 text-[12.5px] text-cz-2 leading-[1.55]">
        {t(key, { delta: fmtSigned(growth?.delta ?? 0), type: primaryLabel })}
      </p>
    </div>
  );
}

// ── Udviklingslog ────────────────────────────────────────────────────────────────
function LogCard({ viewer, entries, t }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz py-[15px] px-[17px]">
      <div className="flex items-baseline justify-between gap-2 flex-wrap mb-0.5">
        <h3 className="font-display text-[17px] leading-none tracking-[0.02em] uppercase text-cz-1 m-0">
          {t("profile.development.log.title")}
        </h3>
        <span className="text-[10.5px] text-cz-3">{t("profile.development.log.hint")}</span>
      </div>

      {viewer !== "own" ? (
        <p className="text-[12px] text-cz-2 leading-[1.5] pt-2">{t("profile.development.log.scoutingHidden")}</p>
      ) : (
        entries.map((e, i) => (
          <div key={`${e.season}-${i}`} className={`py-[11px] ${i === 0 ? "" : "border-t border-cz-border"}`}>
            <div className="flex items-center gap-[9px] flex-wrap min-w-0">
              <span className="font-bold text-[12.5px] text-cz-1 min-w-[130px]">
                {e.isCurrent
                  ? t("profile.development.log.seasonNow", { n: e.season })
                  : t("season.row", { n: e.season })}
              </span>
              {e.plan && (
                <span className="inline-flex items-center font-mono text-[10px] font-bold tracking-[0.03em] px-2 py-[2px] rounded-full bg-cz-accent/[.12] text-cz-accent-t">
                  {t(`profile.training.focus.${e.plan.focus}`)}
                  {e.plan.intensity ? ` · ${t(`training.intensity_${e.plan.intensity}`)}` : ""}
                </span>
              )}
              <span className={`font-mono tabular-nums text-[12px] font-bold ${e.delta > 0 ? "text-cz-success" : "text-cz-3"}`}>
                {t("profile.development.log.delta", { delta: fmtSigned(e.delta) })}
              </span>
            </div>
            <div className="flex items-center gap-1.5 flex-wrap mt-[7px]">
              {e.gains.map((g) => (
                <span key={g.ability} className="inline-flex items-center gap-[5px] text-[11px] px-2 py-[2px] rounded-full bg-cz-subtle border border-cz-border text-cz-1">
                  {t(`racePreview.derived.${g.ability}`)}
                  <b className="font-mono tabular-nums text-cz-success">+{g.delta}</b>
                </span>
              ))}
              <span className="text-[11px] text-cz-3">
                {e.gainDays > 0
                  ? t("profile.development.log.note", { days: e.gainDays, window: HISTORY_DAYS })
                  : t("profile.development.log.noTraining")}
              </span>
            </div>
          </div>
        ))
      )}
    </div>
  );
}

export default function RiderDevelopmentTab({ rider, history = [], types = [], trainingHistory, viewer = "own" }) {
  const { t } = useTranslation("rider");

  // null = fetch undervejs: vis loader, ikke en misvisende "ingen udvikling"-
  // påstand (samme mønster som Trænings-fanens loading-gate).
  if (history == null) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5 flex items-center justify-center py-10">
        <div className="w-5 h-5 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" aria-label={t("profile.development.loading")} />
      </div>
    );
  }

  const snapshots = dedupeSnapshots(history);
  const typeByKey = Object.fromEntries(types.map((tp) => [tp.key, tp]));
  const chartKeys = snapshots.length > 0
    ? pickChartTypeKeys(snapshots[snapshots.length - 1].abilities, rider?.primary_type ?? null, types.map((tp) => tp.key))
    : [];
  if (chartKeys.length === 0) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-cz p-5">
        <p className="text-cz-3 text-center py-8">{t("profile.development.empty")}</p>
      </div>
    );
  }

  // Primærtypen fremhæves med accent-guld (design); serie 2/3 farves efter
  // chart-SLOT (chart-1 blå / chart-2 violet = prototypens farver 1:1) frem for
  // type-index — type-index-farver kan kollidere med primærliniens guld.
  const chartTypes = chartKeys.map((key, i) => ({
    key,
    label: typeByKey[key]?.label ?? key,
    color: i === 0 ? "rgb(var(--accent-t))" : chartColor(i - 1),
  }));

  const segments = seasonSegments(snapshots);
  const currentSeason = segments[segments.length - 1].season;
  const primaryLabel = chartTypes[0].label;
  const growth = seasonDelta(snapshots, chartKeys[0], currentSeason);
  const { totalPoints } = seasonAbilityGains(snapshots, currentSeason);

  // Udviklingslog: én række pr. sæson i data, nyeste først. Fokus-chip + note
  // kun for indeværende sæson (trænings-historikken dækker de seneste 30 dage —
  // at mappe den på ældre sæsoner ville gætte).
  const runEntries = viewer === "own" ? riderHistoryFromRuns(trainingHistory?.runs ?? [], rider?.id) : [];
  const logEntries = [...segments].reverse().filter((seg) => seg.season != null).map((seg) => {
    const isCurrent = seg.season === currentSeason;
    return {
      season: seg.season,
      isCurrent,
      delta: seasonDelta(snapshots, chartKeys[0], seg.season)?.delta ?? 0,
      gains: seasonAbilityGains(snapshots, seg.season).gains.slice(0, 3),
      plan: isCurrent ? dominantPlan(runEntries) : null,
      gainDays: isCurrent ? gainDayCount(runEntries) : 0,
    };
  });

  return (
    <div className="flex flex-col gap-[13px]">
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-[13px] items-start">
        <ChartCard snapshots={snapshots} chartTypes={chartTypes} t={t} />
        <div className="flex flex-col gap-[13px] min-w-0">
          <GrowthCard
            primaryLabel={primaryLabel}
            growth={growth}
            totalPoints={totalPoints}
            trackedSince={snapshots[0].snapshot_date}
            t={t}
          />
          <ReadingCard viewer={viewer} growth={growth} primaryLabel={primaryLabel} t={t} />
        </div>
      </div>
      <LogCard viewer={viewer} entries={logEntries} t={t} />
    </div>
  );
}
