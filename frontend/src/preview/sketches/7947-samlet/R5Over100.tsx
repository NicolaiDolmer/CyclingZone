// #7947 retning 5, Rapport: hvordan bjaelken viser en dag over 100 % (spiller-oenske 19/11:
// "A fungerer perfekt, men hvad naar en rytter faar 137 % af en evne?"). To varianter, A1 og A2,
// bygget med samme byggesten som Rapport-fanen. Tal og navne er eksempler.
import { useId } from "react";
import { ChevronRightIcon, UserIcon } from "../../../components/ui/icons/index.jsx";

// "70 › 71": pilen som ikon (ingen pil-tegn i tekst, TASTE).
function Step({ a, b }: { a: number; b: number }) {
  return <span className="inline-flex items-center gap-0.5">{a}<ChevronRightIcon size={10} aria-label="to" />{b}</span>;
}

const LABEL = "mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3";
const NUM = "font-data text-[13px] tabular-nums";
// Skraveringen som SVG-moenster (samme opskrift som spillets XpBar), ingen CSS-gradient (anti-slop).
function Hatch() {
  const id = useId();
  return (
    <svg aria-hidden="true" className="absolute inset-0 h-full w-full">
      <defs>
        <pattern id={id} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="4" height="4" className="fill-cz-1" />
          <line x1="0" y1="0" x2="0" y2="4" strokeWidth="1.6" className="stroke-cz-card" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

type Seg = { from: number; to: number; kind: "before" | "training" | "race" };

// Ét spor 0-100 %. Graa = foer i dag, fuld = traening i dag, skraveret = loeb i dag.
function Track({ segs, wide = true }: { segs: Seg[]; wide?: boolean }) {
  return (
    <span className={`relative block h-1.5 overflow-hidden rounded-cz bg-cz-border ${wide ? "w-full" : "w-24"}`}>
      {segs.map((s, i) => (
        <span key={i} className={`absolute inset-y-0 ${s.kind === "before" ? "bg-cz-3/45" : s.kind === "training" ? "bg-cz-1" : "overflow-hidden"}`}
          style={{ left: `${s.from}%`, width: `${s.to - s.from}%` }}>{s.kind === "race" && <Hatch />}</span>
      ))}
    </span>
  );
}

function PointChip({ text }: { text: string }) {
  return <span className="inline-flex items-center whitespace-nowrap rounded-cz bg-cz-1 px-1.5 py-0.5 text-2xs font-medium text-cz-card">{text}</span>;
}

function Legend() {
  return (
    <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-2xs text-cz-3">
      <span className="inline-flex items-center gap-1.5"><span className="block h-1.5 w-4 rounded-cz bg-cz-3/45" />Before today</span>
      <span className="inline-flex items-center gap-1.5"><span className="block h-1.5 w-4 rounded-cz bg-cz-1" />Training today</span>
      <span className="inline-flex items-center gap-1.5"><span className="relative block h-1.5 w-4 overflow-hidden rounded-cz"><Hatch /></span>Race today</span>
    </div>
  );
}

function RiderHead() {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-cz-border px-4 py-3" data-mobile-head>
      <div className="flex min-w-0 items-center gap-2">
        <svg width="18" height="13" viewBox="0 0 37 28" aria-label="Denmark" className="shrink-0 rounded-[2px]"><rect width="37" height="28" fill="currentColor" className="text-cz-danger" /><rect x="12" width="4" height="28" fill="currentColor" className="text-white" /><rect y="12" width="37" height="4" fill="currentColor" className="text-white" /></svg>
        <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
        <span className="truncate text-sm font-medium text-cz-1">Lukas Moesgaard</span>
        <span className="hidden whitespace-nowrap text-xs text-cz-3 sm:inline">Climber · rode stage 4</span>
      </div>
      <span className={`${NUM} whitespace-nowrap text-cz-1`}>+612 XP</span>
    </div>
  );
}

// Fælles raekke for Tempo (en almindelig dag under 100 %).
function TempoRow({ mobile }: { mobile: boolean }) {
  return (
    <li className={`grid items-center gap-x-3 border-b border-cz-border py-2.5 last:border-b-0 ${mobile ? "grid-cols-[80px_1fr_70px]" : "grid-cols-[130px_1fr_180px]"}`}>
      <span className="truncate text-xs text-cz-1">Tempo</span>
      <Track segs={[{ from: 0, to: 40, kind: "before" }, { from: 40, to: 62, kind: "training" }]} />
      <span className={`text-end ${NUM} text-cz-2`}><span className="whitespace-nowrap text-cz-1">+140 XP</span>{mobile ? <br /> : " · "}62 %</span>
    </li>
  );
}

function VariantA1({ mobile }: { mobile: boolean }) {
  return (
    <ul className="px-4 py-1 text-xs">
      <li className={`grid items-start gap-x-3 border-b border-cz-border py-2.5 ${mobile ? "grid-cols-[80px_1fr_70px]" : "grid-cols-[130px_1fr_180px]"}`}>
        <span className="truncate pt-0.5 text-xs text-cz-1">Climbing</span>
        <span className="flex flex-col gap-1.5">
          <span><span className="inline-flex items-center whitespace-nowrap rounded-cz bg-cz-1 px-1.5 py-0.5 text-2xs font-medium text-cz-card">+1 Climbing&nbsp;<Step a={70} b={71} /></span></span>
          <Track segs={[{ from: 0, to: 42, kind: "training" }, { from: 42, to: 89, kind: "race" }]} />
        </span>
        <span className={`text-end ${NUM} text-cz-2`}><span className="text-cz-1">+472 XP</span><br />89 % to 72</span>
      </li>
      <TempoRow mobile={mobile} />
    </ul>
  );
}

function VariantA2({ mobile }: { mobile: boolean }) {
  return (
    <ul className="px-4 py-1 text-xs">
      <li className={`grid items-start gap-x-3 border-b border-cz-border py-2.5 ${mobile ? "grid-cols-[80px_1fr_70px]" : "grid-cols-[130px_1fr_180px]"}`}>
        <span className="truncate pt-4 text-xs text-cz-1">Climbing</span>
        <span className="flex flex-col gap-1">
          <span className="flex justify-between text-3xs font-data uppercase tracking-[.06em] text-cz-3"><Step a={70} b={71} /><span className="text-cz-1">Point earned</span></span>
          <Track segs={[{ from: 0, to: 52, kind: "before" }, { from: 52, to: 100, kind: "training" }]} />
          <span className="mt-1 flex justify-between text-3xs font-data uppercase tracking-[.06em] text-cz-3"><Step a={71} b={72} /><span>89 %</span></span>
          <Track segs={[{ from: 0, to: 42, kind: "training" }, { from: 42, to: 89, kind: "race" }]} />
        </span>
        <span className={`pt-4 text-end ${NUM} text-cz-2`}><span className="text-cz-1">+472 XP</span><br />+1 point</span>
      </li>
      <TempoRow mobile={mobile} />
    </ul>
  );
}

export default function Over100({ which, mobile }: { which: "a1" | "a2"; mobile: boolean }) {
  const a1 = which === "a1";
  return (
    <div id="shot" className="mx-auto max-w-[920px] px-4 py-6 sm:px-6">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Report · a day over 100 %</div>
      <h2 className="font-data text-xl font-bold leading-tight text-cz-1">{a1 ? "A1 · The point lands, the bar starts again" : "A2 · Today's whole journey on two lines"}</h2>
      <p className="mt-1 max-w-[70ch] text-sm text-cz-2">
        {a1
          ? "Climbing was 52 % of the way to 71 and got 137 % of a point today. The point is shown on its own, and the bar restarts with the 89 % left over."
          : "Same day. The first line finishes the old point (52 % to 100 %), the second shows the next point under way (0 to 89 %). Each line stays 0-100 %."}
      </p>
      <div className="mt-4 overflow-hidden rounded-cz border border-cz-border bg-cz-card">
        <RiderHead />
        <div className="px-4 pt-3"><div className={LABEL}>XP by ability</div></div>
        {a1 ? <VariantA1 mobile={mobile} /> : <VariantA2 mobile={mobile} />}
      </div>
      <Legend />
      <p className="mt-3 max-w-[70ch] text-xs text-cz-2">
        {a1
          ? "Good: one bar per ability, always 0-100 %, and the new point can't be missed. Watch out: the bar alone looks shorter than yesterday; the chip carries the big day."
          : "Good: you see exactly where today went: 48 % finished the old point, 89 % started the next. Watch out: the best days take two lines."}
      </p>
      <p className="mt-2 text-2xs text-cz-3">Names and numbers are examples.</p>
    </div>
  );
}
