// #8254 (valg runde 2 for #7535): små byggesten (knap, mærke, segment, flag, profil) i spillets egne
// klasser. Knap- og mærke-klasserne kommer fra spillets helpers, så skitsen ikke opfinder
// egen radius, egen guld eller egne mærker (PAGE_TEMPLATES, TASTE P3/P8).
import type { ReactNode } from "react";
import "flag-icons/css/flag-icons.min.css";
import { buttonClass as buttonClassBase } from "../../../components/ui/buttonStyles.js";
import { statusBadgeClass as statusBadgeClassBase } from "../../../components/ui/badgeStyles.js";
import type { StageKind } from "./data.ts";

const buttonClass = buttonClassBase as unknown as (o?: { variant?: string; size?: string; fullWidth?: boolean }) => string;
const statusBadgeClass = statusBadgeClassBase as unknown as (s: string, o?: { emphasis?: boolean }) => string;

export function Btn({
  children,
  variant = "secondary",
  size = "sm",
  full = false,
  disabled = false,
  className = "",
}: {
  children: ReactNode;
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  full?: boolean;
  disabled?: boolean;
  className?: string;
}) {
  return (
    <button type="button" disabled={disabled} className={`whitespace-nowrap ${buttonClass({ variant, size, fullWidth: full })} ${className}`}>
      {children}
    </button>
  );
}

export type Tone = "won" | "closing" | "info" | "outbid";

export function Badge({ tone, children, title }: { tone: Tone; children: ReactNode; title?: string }) {
  return (
    <span className={`${statusBadgeClass(tone, { emphasis: true })} whitespace-nowrap`} title={title}>
      {children}
    </span>
  );
}

/** Spillets segmenterede kontrol (hairline-ramme, aktivt segment = guld-tekst på 10 % guld). */
export function Seg({ options, value, small = false, full = false }: { options: string[]; value: string; small?: boolean; full?: boolean }) {
  return (
    <div className={`inline-flex overflow-hidden rounded-cz border border-cz-border ${full ? "w-full" : ""}`} role="group">
      {options.map((o, i) => (
        <span
          key={o}
          className={`whitespace-nowrap ${full ? "flex-1 text-center" : ""} ${small ? "px-2 py-1 text-xs" : "px-3.5 py-1.5 text-[13px]"} font-medium ${
            i > 0 ? "border-s border-cz-border" : ""
          } ${o === value ? "bg-cz-accent/10 text-cz-accent-t" : "text-cz-2"}`}
        >
          {o}
        </span>
      ))}
    </div>
  );
}

export function Flag({ code }: { code: string }) {
  return <span className={`fi fi-${code} shrink-0 rounded-[2px]`} style={{ width: 16, height: 12 }} aria-hidden="true" />;
}

/** Hairline-chip til D-047-kolonnevalget, med kortets 5px-radius (ejer 16/11: ingen piller). */
export function Chip({ children, active = false }: { children: ReactNode; active?: boolean }) {
  return (
    <span
      className={`inline-flex items-center whitespace-nowrap rounded-cz border px-2 py-1 font-data text-2xs font-semibold uppercase tracking-[.06em] ${
        active ? "border-cz-1 text-cz-1" : "border-cz-border text-cz-2"
      }`}
    >
      {children}
    </span>
  );
}

/** Plan-chip som i taktik v6/#7864: opgave i fed, indsats dæmpet. */
export function PlanChip({ task, effort }: { task: string; effort: string }) {
  return (
    <span className="inline-flex items-center gap-1 whitespace-nowrap rounded-cz border border-cz-border bg-cz-subtle px-2 py-0.5 text-xs">
      <span className="font-semibold text-cz-1">{task}</span>
      <span className="text-cz-3">{effort}</span>
    </span>
  );
}

export function Plan({ plan }: { plan: Array<[string, string]> }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1.5">
      {plan.map(([t, e], i) => (
        <span key={t + i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="font-data text-3xs uppercase tracking-wide text-cz-3">sidste 10 km</span>}
          <PlanChip task={t} effort={e} />
        </span>
      ))}
    </span>
  );
}

/** Lille neutral bjælke med tal (rutematch, TASTE: aldrig guld-tal). */
export function MatchBar({ value, wide = false, narrow = false }: { value: number; wide?: boolean; narrow?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className={`relative h-1.5 ${wide ? "w-16" : narrow ? "w-6" : "w-10"} overflow-hidden bg-cz-border`}>
        <span className="absolute inset-y-0 start-0 bg-cz-1" style={{ width: `${Math.min(100, value)}%` }} />
      </span>
      <span className="font-data text-xs tabular-nums text-cz-1">{value}</span>
    </span>
  );
}

// --- Stroke-ikoner (samme anatomi som spillets ikonsæt: 1.6 streg, currentColor) ---

function Svg({ size = 14, children, className = "" }: { size?: number; children: ReactNode; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">
      {children}
    </svg>
  );
}

export const Ico = {
  chevL: (s?: number) => <Svg size={s}><path d="M15 18l-6-6 6-6" /></Svg>,
  chevR: (s?: number) => <Svg size={s}><path d="M9 18l6-6-6-6" /></Svg>,
  chevD: (s?: number) => <Svg size={s}><path d="M6 9l6 6 6-6" /></Svg>,
  chevU: (s?: number) => <Svg size={s}><path d="M18 15l-6-6-6 6" /></Svg>,
  x: (s?: number) => <Svg size={s}><path d="M18 6L6 18M6 6l12 12" /></Svg>,
  check: (s?: number) => <Svg size={s}><path d="M20 6L9 17l-5-5" /></Svg>,
  alert: (s?: number) => <Svg size={s}><path d="M12 3l9.5 17h-19L12 3z" /><path d="M12 10v4M12 17.5v.01" /></Svg>,
  peak: (s?: number) => <Svg size={s}><path d="M3 18l6-8 4 5 3-4 5 7" /><path d="M14 5l2-2 2 2" /></Svg>,
  flag: (s?: number) => <Svg size={s}><path d="M5 21V4M5 4h11l-2 4 2 4H5" /></Svg>,
  copy: (s?: number) => <Svg size={s}><rect x="9" y="9" width="11" height="11" rx="1.5" /><path d="M5 15V5a1 1 0 011-1h10" /></Svg>,
  spark: (s?: number) => <Svg size={s}><path d="M12 3v4M12 17v4M3 12h4M17 12h4M6 6l2.5 2.5M15.5 15.5L18 18M6 18l2.5-2.5M15.5 8.5L18 6" /></Svg>,
  menu: (s?: number) => <Svg size={s}><path d="M4 7h16M4 12h16M4 17h16" /></Svg>,
  bell: (s?: number) => <Svg size={s}><path d="M6 8a6 6 0 1112 0c0 7 3 8 3 8H3s3-1 3-8" /><path d="M10 21a2 2 0 004 0" /></Svg>,
  ext: (s?: number) => <Svg size={s}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></Svg>,
  lock: (s?: number) => <Svg size={s}><rect x="5" y="11" width="14" height="10" rx="1.5" /><path d="M8 11V8a4 4 0 018 0v3" /></Svg>,
  table: (s?: number) => <Svg size={s}><rect x="3" y="4" width="18" height="16" rx="1.5" /><path d="M3 10h18M9 10v10" /></Svg>,
  undo: (s?: number) => <Svg size={s}><path d="M9 14L4 9l5-5" /><path d="M4 9h11a5 5 0 010 10h-3" /></Svg>,
};

// --- Terræn-glyffer og ruteprofil -----------------------------------------------

const GLYPH: Record<StageKind, string> = {
  flat: "M2 13h20",
  hilly: "M2 15c3-5 5-5 7 0s4 5 6 0 4-5 7 0",
  mountain: "M2 19l6-9 4 5 4-10 6 14",
  itt: "M2 12h14M16 8l4 4-4 4M6 8v8",
};

export function Glyph({ kind, size = 16, className = "" }: { kind: StageKind; size?: number; className?: string }) {
  const tone = kind === "mountain" ? "text-cz-danger" : kind === "hilly" ? "text-cz-warning" : "text-cz-info";
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`${tone} ${className}`} aria-hidden="true">
      <path d={GLYPH[kind]} />
    </svg>
  );
}

/** Deterministisk højdekurve pr. etapetype (kun billedet; ingen rigtig rute). */
export function elevation(kind: StageKind, n = 120): number[] {
  const bumps: Array<[number, number, number]> =
    kind === "flat"
      ? [[0.3, 0.05, 0.06], [0.62, 0.04, 0.05], [0.93, 0.16, 0.03]]
      : kind === "hilly"
        ? [[0.18, 0.32, 0.05], [0.38, 0.42, 0.05], [0.55, 0.3, 0.04], [0.72, 0.5, 0.05], [0.88, 0.38, 0.04]]
        : kind === "mountain"
          ? [[0.22, 0.45, 0.07], [0.45, 0.62, 0.07], [0.68, 0.55, 0.06], [0.97, 0.95, 0.07]]
          : [[0.5, 0.08, 0.2]];
  const out: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = i / (n - 1);
    let y = 0.08 + 0.02 * Math.sin(x * 37) + 0.015 * Math.sin(x * 91);
    for (const [c, h, w] of bumps) y += h * Math.exp(-((x - c) ** 2) / (2 * w * w));
    out.push(Math.min(1, y));
  }
  return out;
}

export function Profile({ kind, height = 150, axis = true, mini = false }: { kind: StageKind; height?: number; axis?: boolean; mini?: boolean }) {
  const ys = elevation(kind, mini ? 48 : 120);
  const W = 1000;
  const H = 100;
  const pts = ys.map((y, i) => `${((i / (ys.length - 1)) * W).toFixed(1)},${(H - y * (H - 8)).toFixed(1)}`);
  const line = `M${pts.join(" L")}`;
  const area = `${line} L${W},${H} L0,${H} Z`;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" style={{ width: "100%", height }} aria-hidden="true">
        <path d={area} fill="var(--color-cz-subtle)" />
        <path d={line} fill="none" stroke="var(--color-cz-1)" strokeWidth={mini ? 3 : 1.6} vectorEffect="non-scaling-stroke" />
        {!mini && kind !== "itt" && <line x1={W * 0.42} x2={W * 0.42} y1={0} y2={H} stroke="var(--color-cz-success)" strokeDasharray="3 4" vectorEffect="non-scaling-stroke" />}
        {!mini && kind === "mountain" && <rect x={W * 0.9} y={0} width={W * 0.07} height={H} fill="var(--color-cz-danger)" opacity={0.08} />}
      </svg>
      {axis && !mini && (
        <div className="mt-1 flex justify-between font-data text-3xs tabular-nums text-cz-3">
          {[0, 40, 80, 120, 160, 190].map((k) => (
            <span key={k}>{k}</span>
          ))}
        </div>
      )}
    </div>
  );
}
