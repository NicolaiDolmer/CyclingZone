// #8476: foer/efter for rettelserne af forkert info, én ad gangen til ejerens godkendelse.
// Dansk, fordi ejerens skaermbilleder er fra den danske side. Tal og navne er eksempler.
import { ChevronRightIcon, LockIcon } from "../../../components/ui/icons/index.jsx";
import { FIXES2, TITLES2 } from "./R5Fixes2.tsx";

const ROW ="grid grid-cols-[48px_1fr_auto] items-center gap-3 border-t border-cz-border py-2.5 text-sm";

type Day = { d: string; name: string; effort: string; tone?: string; result: string; resultTone?: string };

function SevenDays({ days }: { days: Day[] }) {
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card p-4">
      <h3 className="mb-2 font-data text-base font-semibold text-cz-1">Daglig træning · sidste 7 dage</h3>
      {days.map((x) => (
        <div key={x.d} className={ROW}>
          <span className="font-data tabular-nums text-cz-3">{x.d}</span>
          <span className="text-cz-1">{x.name} <span className={x.tone ?? "text-cz-3"}>· {x.effort}</span></span>
          <span className={`text-sm ${x.resultTone ?? "text-cz-3"}`}>{x.result}</span>
        </div>
      ))}
    </section>
  );
}

const BASE: Day[] = [
  { d: "−3d", name: "VO2max (punch)", effort: "Hård", result: "Skarp dag", resultTone: "text-cz-success" },
  { d: "−4d", name: "VO2max", effort: "training.intensity_race", result: "—" },
  { d: "−5d", name: "Udholdenhed", effort: "Let", result: "—" },
];
const FIXED: Day[] = [
  BASE[0],
  { d: "−4d", name: "Løb · Tour de Preview, etape 2", effort: "Løbsdag", tone: "text-cz-1", result: "—" },
  BASE[2],
];

function Fix1() {
  return (
    <>
      <p className="mt-1 max-w-[72ch] text-sm text-cz-2">
        På løbsdage viser listen en rå tekstnøgle. Efter rettelsen står der, at det var en løbsdag, og hvilket løb.
        Den samme nøgle bruges 4 andre steder. De rettes på samme måde. Teksten kommer på 5 sprog.
      </p>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <div><div className="mb-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-danger">Før (i dag)</div><SevenDays days={BASE} /></div>
        <div><div className="mb-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-success">Efter</div><SevenDays days={FIXED} /></div>
      </div>
    </>
  );
}

// Spillerens eget skaermbillede (Arne Deneve, egen plan) med forslaget sat ind.
function EgoAfter() {
  return (
    <div className="mx-auto w-full max-w-[560px] space-y-4">
      <section className="rounded-cz border border-cz-border bg-cz-card p-5">
        <h3 className="mb-4 font-data text-xl font-semibold text-cz-1">Træningsfokus</h3>
        <div className="flex items-start gap-3 rounded-cz border border-cz-border bg-cz-subtle px-4 py-3">
          <LockIcon size={15} aria-hidden="true" className="mt-1 shrink-0 text-cz-3" />
          <div className="min-w-0">
            <div className="text-base font-medium text-cz-1">Følger sin egen plan</div>
            <div className="text-sm text-cz-2">Dag 3 af 7 · sat på træningssiden</div>
          </div>
        </div>
        <dl className="mt-4 grid grid-cols-[auto_1fr] gap-x-5 gap-y-2 text-base">
          <dt className="text-cz-3">I dag</dt><dd className="text-cz-1">Lange stigninger · <span className="text-cz-danger">Hård</span></dd>
          <dt className="text-cz-3">Træner</dt><dd className="text-cz-1">Klatring + Tempo</dd>
          <dt className="text-cz-3">I morgen</dt><dd className="text-cz-1">VO2max (klatring) · <span className="text-cz-danger">Hård</span></dd>
        </dl>
        <span className="mt-4 inline-flex items-center gap-1 text-base font-medium text-cz-accent-t">Ret planen på træningssiden<ChevronRightIcon size={13} aria-hidden="true" /></span>
      </section>
      <section className="rounded-cz border border-cz-border bg-cz-card p-5">
        <h3 className="mb-2 font-data text-xl font-semibold text-cz-1">Daglig træning · sidste 7 dage</h3>
        {[
          ["I dag", "Lange stigninger", "Hård", "+6 evner"],
          ["−1d", "Løb · Lange enkeltstarter", "Løbsdag", "+5 evner"],
          ["−2d", "VO2max (punch)", "Hård", "+2 evner"],
        ].map(([d, n, e, r]) => (
          <div key={d} className="grid grid-cols-[56px_1fr_auto] items-center gap-3 border-t border-cz-border py-3 text-base">
            <span className="font-data tabular-nums text-cz-3">{d}</span>
            <span className="text-cz-1">{n} <span className="text-cz-3">· {e}</span></span>
            <span className="text-cz-success">{r}</span>
          </div>
        ))}
      </section>
    </div>
  );
}

const TITLES: Record<string, string> = { "1": "1 · Rå tekstnøgle på løbsdage (rytterens Træning-fane)", ego: "Arne Deneves side med forslaget" };

export default function Fixes({ n }: { n: string }) {
  return (
    <div id="shot" className="mx-auto max-w-[1000px] px-4 py-6 sm:px-6">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Forkert info · rettelse til godkendelse</div>
      <h2 className="font-data text-xl font-bold leading-tight text-cz-1">{TITLES[n] ?? TITLES2[n] ?? n}</h2>
      {n === "1" && <Fix1 />}
      {n === "ego" && <div className="mt-4"><EgoAfter /></div>}
      {FIXES2[n] && (() => { const F = FIXES2[n]; return <F />; })()}
      <p className="mt-3 text-2xs text-cz-3">Eksempeldata.</p>
    </div>
  );
}
