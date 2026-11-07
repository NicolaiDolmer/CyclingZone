// Roadmap-admin, grafen (#7789): idé-score på x, vigtighed på y, én boble pr.
// punkt eller pr. kategori, og boblens størrelse er antal stemmere.
//
// Samme anatomi som spørgeskema-panelets kvadrant (QuadrantChart i
// admin/survey/surveyCharts.jsx): kvadratisk plot, midterlinjer, én fyldt flade
// øverst til højre ("byg det her"), guld som eneste kulør. Den kunne ikke
// genbruges direkte: Stem bruger 1-6 og ikke 1-5, boblerne har hver sin
// størrelse, og en boble skal kunne vælges (horisonten flyttes fra panelet ved
// siden af). Tallene regnes i lib/roadmapAdminModel.ts; her tegnes de kun.
//
// Uenighed (spredning på vigtighed over SPLIT_SD) vises som en stiplet kant i
// neutral blæk, ikke som en ny farve: den kan ses uden farvesyn, og guld
// forbliver det eneste prioritetssignal (TASTE §3).
import type { KeyboardEvent } from "react";
import { SCORE_MAX, SCORE_MIN, bubbleRadius, coincidentIndex, fmtScore } from "../../../lib/roadmapAdminModel.ts";
import type { ChartPoint } from "../../../lib/roadmapAdminModel.ts";

interface Props {
  points: ChartPoint[];
  selectedKey: string | null;
  onSelect: (key: string) => void;
  axisXLabel: string;
  axisYLabel: string;
  cornerLabel: string;
  // Et kort mærke ved boblen (kategoriernes nummer i listen ved siden af).
  // Hele navne overlappede, fordi kategoriernes snit ligger tæt; punkterne står
  // kun i title-elementet og i panelet, når de vælges.
  labels?: Map<string, string>;
}

const PAD = 12;
const SPAN = 100 - PAD * 2;
const MID = (SCORE_MIN + SCORE_MAX) / 2;
const toX = (v: number) => PAD + ((v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * SPAN;
const toY = (v: number) => PAD + SPAN - ((v - SCORE_MIN) / (SCORE_MAX - SCORE_MIN)) * SPAN;
const clamp = (v: number) => Math.max(SCORE_MIN, Math.min(SCORE_MAX, v));
const TICKS = [1, 2, 3, 4, 5, 6];

function describe(p: ChartPoint, axisXLabel: string, axisYLabel: string): string {
  const parts = [
    p.label,
    `${axisXLabel} ${fmtScore(p.x)}`,
    `${axisYLabel} ${fmtScore(p.y)}`,
    `${p.voters} stemmere`,
  ];
  if (p.dontKnow > 0) parts.push(`${p.dontKnow} Ved ikke`);
  if (p.split) parts.push("deler spillerne");
  return parts.join(" · ");
}

export default function RoadmapAdminChart({
  points, selectedKey, onSelect, axisXLabel, axisYLabel, cornerLabel, labels,
}: Props) {
  const maxVoters = points.reduce((m, p) => Math.max(m, p.voters), 0);
  // Store bobler tegnes først, så en lille boble oven på en stor kan klikkes.
  const ordered = [...points].sort((a, b) => b.voters - a.voters || a.key.localeCompare(b.key));
  const spread = coincidentIndex(points);

  const onKey = (key: string) => (e: KeyboardEvent<SVGGElement>) => {
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect(key);
    }
  };

  return (
    <svg
      viewBox="0 0 100 100"
      role="group"
      aria-label={cornerLabel}
      className="mx-auto block w-full max-w-[600px]"
      style={{ aspectRatio: "1 / 1" }}
      data-testid="roadmap-admin-chart"
    >
      <rect
        x={toX(MID)} y={toY(SCORE_MAX)} width={toX(SCORE_MAX) - toX(MID)} height={toY(MID) - toY(SCORE_MAX)}
        className="fill-cz-accent/[0.07]"
      />
      <line x1={toX(MID)} y1={toY(SCORE_MIN)} x2={toX(MID)} y2={toY(SCORE_MAX)} className="stroke-cz-border" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
      <line x1={toX(SCORE_MIN)} y1={toY(MID)} x2={toX(SCORE_MAX)} y2={toY(MID)} className="stroke-cz-border" strokeWidth="0.4" vectorEffect="non-scaling-stroke" />
      <line x1={toX(SCORE_MIN)} y1={toY(SCORE_MIN)} x2={toX(SCORE_MAX)} y2={toY(SCORE_MIN)} className="stroke-cz-2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />
      <line x1={toX(SCORE_MIN)} y1={toY(SCORE_MIN)} x2={toX(SCORE_MIN)} y2={toY(SCORE_MAX)} className="stroke-cz-2" strokeWidth="0.5" vectorEffect="non-scaling-stroke" />

      {TICKS.map((t) => (
        <text key={`x-${t}`} x={toX(t)} y={toY(SCORE_MIN) + 3.5} textAnchor="middle" className="fill-cz-3 font-data" style={{ fontSize: "3px" }}>
          {t}
        </text>
      ))}
      {TICKS.map((t) => (
        <text key={`y-${t}`} x={toX(SCORE_MIN) - 1.5} y={toY(t) + 1} textAnchor="end" className="fill-cz-3 font-data" style={{ fontSize: "3px" }}>
          {t}
        </text>
      ))}

      {ordered.map((p) => {
        const r = bubbleRadius(p.voters, maxVoters);
        // Samme snit: skub boblen en radius ud i sin egen retning, så den kan klikkes.
        const nth = spread.get(p.key) ?? 0;
        const angle = nth * 2.4;
        const cx = toX(clamp(p.x ?? SCORE_MIN)) + (nth ? Math.cos(angle) * r : 0);
        const cy = toY(clamp(p.y ?? SCORE_MIN)) + (nth ? Math.sin(angle) * r : 0);
        const selected = p.key === selectedKey;
        const label = describe(p, axisXLabel, axisYLabel);
        return (
          <g
            key={p.key}
            role="button"
            tabIndex={0}
            aria-label={label}
            aria-pressed={selected}
            className="cursor-pointer outline-hidden [&:focus-visible>circle]:stroke-cz-1"
            onClick={() => onSelect(p.key)}
            onKeyDown={onKey(p.key)}
          >
            <title>{label}</title>
            <circle
              cx={cx} cy={cy} r={r}
              className={selected ? "fill-cz-accent/60 stroke-cz-1" : "fill-cz-accent/25 stroke-cz-accent"}
              strokeWidth={selected ? 1.6 : 0.8}
              vectorEffect="non-scaling-stroke"
            />
            {p.split && (
              <circle
                cx={cx} cy={cy} r={r + 0.9}
                className="fill-none stroke-cz-1"
                strokeWidth="0.8"
                strokeDasharray="2 2"
                vectorEffect="non-scaling-stroke"
              />
            )}
            {labels?.has(p.key) && (
              <text x={cx} y={cy + 1} textAnchor="middle" className="pointer-events-none fill-cz-1 font-data font-semibold" style={{ fontSize: "2.8px" }}>
                {labels.get(p.key)}
              </text>
            )}
          </g>
        );
      })}

      <text x={toX(SCORE_MAX)} y={toY(SCORE_MIN) + 7.5} textAnchor="end" className="fill-cz-3 font-data" style={{ fontSize: "3.2px" }}>
        {axisXLabel}
      </text>
      <text
        x={toX(SCORE_MIN) - 4} y={toY(SCORE_MAX)} textAnchor="end"
        className="fill-cz-3 font-data" style={{ fontSize: "3.2px" }}
        transform={`rotate(-90 ${toX(SCORE_MIN) - 4} ${toY(SCORE_MAX)})`}
      >
        {axisYLabel}
      </text>
      <text x={toX(SCORE_MAX)} y={toY(SCORE_MAX) - 2} textAnchor="end" className="fill-cz-3 font-data" style={{ fontSize: "3.2px" }}>
        {cornerLabel}
      </text>
    </svg>
  );
}
