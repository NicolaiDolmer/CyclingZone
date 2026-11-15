import { useId } from "react";
import { useTranslation } from "react-i18next";

// #7627 · The report's one bar recipe. Two neutral tokens and a pattern, never
// gold (#7988): training is a solid neutral, the race part is hatched, so the two
// read apart without colour. Widths are shares 0..1 of the whole bar.

export type Part = "before" | "training" | "race";

const FILL: Record<Exclude<Part, "race">, string> = {
  before: "fill-cz-border",
  training: "fill-cz-border-strong",
};

/** The hatch: dark ink with card-coloured stripes. One per SVG, so ids never clash. */
function Hatch({ id }: { id: string }) {
  return (
    <defs>
      <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
        <rect width="4" height="4" className="fill-cz-1" />
        <line x1="0" y1="0" x2="0" y2="4" strokeWidth="1.6" className="stroke-cz-card" />
      </pattern>
    </defs>
  );
}

const pct = (n: number) => `${Math.max(0, Math.min(1, n)) * 100}%`;

/** A horizontal bar: before today, training and race, left to right, on a track. */
export function XpBar({ before = 0, training, race, height = 6, label, testId }: {
  before?: number; training: number; race: number; height?: number; label: string; testId?: string;
}) {
  const hatch = useId();
  const parts: Array<[Part, number]> = [["before", before], ["training", training], ["race", race]];
  let x = 0;
  return (
    <svg width="100%" height={height} role="img" aria-label={label} className="block overflow-hidden" data-testid={testId}>
      <Hatch id={hatch} />
      <rect width="100%" height="100%" className="fill-cz-subtle" />
      {parts.map(([part, share]) => {
        const at = x;
        x += Math.max(0, share);
        return share > 0
          ? <rect key={part} x={pct(at)} width={pct(share)} height="100%" data-part={part}
              className={part === "race" ? undefined : FILL[part]} fill={part === "race" ? `url(#${hatch})` : undefined} />
          : null;
      })}
    </svg>
  );
}

/** One swatch, the same fill as the bar. */
export function Swatch({ part }: { part: Part }) {
  const hatch = useId();
  return (
    <svg width="14" height="8" aria-hidden="true" className="shrink-0">
      {part === "race" && <Hatch id={hatch} />}
      <rect width="14" height="8" className={part === "race" ? undefined : FILL[part]} fill={part === "race" ? `url(#${hatch})` : undefined} />
    </svg>
  );
}

export function XpLegend({ before = false, className = "" }: { before?: boolean; className?: string }) {
  const { t } = useTranslation("trainingXp");
  const items: Part[] = before ? ["training", "race", "before"] : ["training", "race"];
  return (
    <span className={`flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-2 ${className}`.trim()} data-testid="xp-legend">
      {items.map(part => <span key={part} className="inline-flex items-center gap-1.5"><Swatch part={part} />{t(`xpReport.legend.${part}`)}</span>)}
    </span>
  );
}

/** Stacked day columns for the 30-day chart: training at the foot, race on top. */
export function XpColumn({ training, race, max, height }: { training: number; race: number; max: number; height: number }) {
  const hatch = useId();
  const scale = max > 0 ? (height - 2) / max : 0;
  const th = training * scale, rh = race * scale;
  return (
    <svg width="100%" height={height} aria-hidden="true" className="block">
      <Hatch id={hatch} />
      {th > 0 && <rect x="12%" width="76%" y={height - th} height={th} className="fill-cz-border-strong" />}
      {rh > 0 && <rect x="12%" width="76%" y={height - th - rh} height={rh} fill={`url(#${hatch})`} />}
    </svg>
  );
}

/** The rider's 30 small columns. Monochrome: the number beside it carries the meaning. */
export function XpSpark({ values, height = 18 }: { values: number[]; height?: number }) {
  const max = Math.max(1, ...values);
  const w = 100 / Math.max(1, values.length);
  return (
    <svg width="100%" height={height} aria-hidden="true" className="block" data-testid="xp-spark">
      {values.map((v, i) => {
        const h = v > 0 ? Math.max(1, (v / max) * height) : 1;
        return <rect key={i} x={`${i * w + w * 0.15}%`} width={`${w * 0.7}%`} y={height - h} height={h} className={v > 0 ? "fill-cz-2" : "fill-cz-border"} />;
      })}
    </svg>
  );
}
