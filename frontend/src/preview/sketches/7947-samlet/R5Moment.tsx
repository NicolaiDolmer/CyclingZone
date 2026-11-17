// #7947 retning 5, ejerens punkt 9 + #8363: Train now-oejeblikket som egen
// visning "Today's training". Samme visning er dagens kvittering og kan aabnes
// igen. Alle ryttere i fast raekkefoelge, bjaelker der fyldes, evner der taeller
// op, under 6 sekunder, "Skip", og til sidst een samlet linje og "Done".
// BYGGES FOERST NAAR XP ER TAENDT (ejer 17/11 paa #8363). XP-tallene er eksempler.

import { useEffect, useState } from "react";
import Button from "../../../components/ui/Button.jsx";
import { ChevronRightIcon, ClockIcon, InfoIcon } from "../../../components/ui/icons/index.jsx";
import { MOMENT, TEAM } from "./r5data.ts";
import { RiderName } from "./R5Parts.tsx";

const TOTAL_MS = 5200;
const STEP = 0.11; // forskydning mellem rytterne (andel af hele forloebet)
const SPAN = 0.3; // hvor lang tid een rytters bjaelke tager

function reducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true;
}

export default function TodaysTraining({ mobile, frame, onDone }: { mobile: boolean; frame: number | null; onDone: () => void }) {
  const [t, setT] = useState(frame ?? (reducedMotion() ? 1 : 0));

  useEffect(() => {
    if (frame !== null || reducedMotion()) return;
    const start = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      const next = Math.min(1, (now - start) / TOTAL_MS);
      setT(next);
      if (next < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [frame]);

  const trainers = MOMENT.filter((m) => m.kind === "train");
  const best = Math.max(...trainers.map((m) => (m.kind === "train" ? m.xp : 0)));
  const finished = t >= 1;
  let order = 0;

  const rows = MOMENT.map((m) => {
    const rider = TEAM.find((r) => r.id === m.id)!;
    if (m.kind === "race") {
      return (
        <li key={m.id} className="flex min-h-[70px] flex-col justify-center gap-1 border-t border-cz-border px-3 py-2 first:border-t-0">
          <RiderName rider={rider} />
          <div className="inline-flex items-center gap-1 text-2xs text-cz-3"><ClockIcon size={12} aria-hidden="true" />Racing Stage 3 · settles after the stage</div>
        </li>
      );
    }
    const begin = order * STEP;
    order += 1;
    const p = Math.max(0, Math.min(1, (t - begin) / SPAN));
    const xp = Math.round(m.xp * p);
    const isBest = m.xp === best;
    const fill = isBest ? "bg-cz-accent" : m.xp >= 400 ? "bg-cz-success" : "bg-cz-2";
    return (
      <li key={m.id} className="flex min-h-[70px] flex-col justify-center gap-1 border-t border-cz-border px-3 py-2 first:border-t-0">
        <div className="flex items-center justify-between gap-2">
          <RiderName rider={rider} />
          <span className="font-data text-[13px] font-semibold tabular-nums text-cz-1">+{xp} XP</span>
        </div>
        <div className="flex items-center gap-2">
          <span className="w-[150px] shrink-0 truncate text-3xs text-cz-3 max-sm:w-[120px]">{m.focus}</span>
          <span className="h-1.5 flex-1 overflow-hidden rounded-cz bg-cz-border" aria-hidden="true">
            <span className={`block h-full ${fill}`} style={{ width: `${Math.round((m.xp / best) * p * 100)}%` }} />
          </span>
        </div>
        <div className="flex min-h-[18px] items-center gap-2 text-2xs">
          {p >= 1 && m.gain && (
            <span className="inline-flex items-center gap-0.5 rounded-cz bg-cz-success-bg px-1.5 py-0.5 font-data font-semibold tabular-nums text-cz-success">
              {m.gain.ability} {m.gain.from}<ChevronRightIcon size={10} aria-hidden="true" />{m.gain.from + 1}
            </span>
          )}
          {p >= 1 && m.next && <span className="text-cz-3">{m.next.pct} % to next +1 in {m.next.ability}</span>}
          {p >= 1 && isBest && <span className="font-semibold text-cz-accent-t">Best today</span>}
        </div>
      </li>
    );
  });

  const half = Math.ceil(rows.length / 2);
  const gains = trainers.filter((m) => m.kind === "train" && m.gain).length;
  const bestRider = TEAM.find((r) => r.id === trainers.find((m) => m.kind === "train" && m.xp === best)?.id)!;

  return (
    <main className={`mx-auto max-w-[1600px] pb-16 pt-7 ${mobile ? "px-4" : "px-8"}`}>
      <header className="mb-6 flex flex-wrap items-center justify-between gap-4 max-sm:flex-col max-sm:items-stretch max-sm:gap-3">
        <div className="min-w-0">
          <h1 className="font-data text-[20px] font-bold tracking-[-0.01em] text-cz-1">Today's training</h1>
          <p className="mt-1 text-[13px] text-cz-2">Tuesday 17 November · {TEAM.length} riders · same order every day</p>
        </div>
        <div className="flex items-center gap-2 max-sm:w-full">
          {!finished && <Button variant="secondary" size="sm" onClick={() => setT(1)} className="max-sm:w-full">Skip</Button>}
        </div>
      </header>

      <p className="mb-3 inline-flex items-center gap-1.5 rounded-cz border border-cz-border bg-cz-card px-2 py-1 text-2xs font-semibold uppercase tracking-[.06em] text-cz-2">
        <InfoIcon size={12} aria-hidden="true" />Planned: built when XP is switched on · numbers are examples
      </p>

      <div className={`grid gap-3 ${mobile ? "grid-cols-1" : "grid-cols-2"}`}>
        {(mobile ? [rows] : [rows.slice(0, half), rows.slice(half)]).map((col, i) => (
          <ul key={i} className="rounded-cz border border-cz-border bg-cz-card">{col}</ul>
        ))}
      </div>

      <div className={`mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-cz border border-cz-border bg-cz-card px-3 py-2.5 text-[13px] transition-opacity duration-150 ${finished ? "opacity-100" : "opacity-0"}`}
        aria-hidden={!finished}>
        <span className="font-semibold text-cz-1"><span className="font-data tabular-nums">{gains}</span> ability points today</span>
        <span className="text-cz-3">·</span>
        <span className="text-cz-2">Best: <span className="text-cz-1">{bestRider.name}</span> <span className="font-data tabular-nums">+{best} XP</span></span>
        <span className="text-cz-3">·</span>
        <span className="text-cz-2">Bonus for pressing it yourself: <span className="font-data tabular-nums text-cz-1">+15 %</span></span>
        {finished && <Button size="sm" onClick={onDone} className="ms-auto max-sm:mt-1 max-sm:w-full">Done</Button>}
      </div>
    </main>
  );
}
