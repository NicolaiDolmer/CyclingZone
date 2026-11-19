// Plankortet paa rytterens Traening-fane: tre udgaver, hvor al info er korrekt, ogsaa med
// flere pas om dagen og loebsdage (spiller 19/11). Eksempeldata.
import type { ReactNode } from "react";
import { ChevronRightIcon, LockIcon } from "../../../components/ui/icons/index.jsx";

function Shell({ children }: { children: ReactNode }) {
  return <section className="rounded-cz border border-cz-border bg-cz-card p-4"><h3 className="mb-3 font-data text-lg font-semibold text-cz-1">Træningsfokus</h3>{children}</section>;
}
function Plan() {
  return (
    <div className="flex items-start gap-3 rounded-cz border border-cz-border bg-cz-subtle px-3 py-2.5">
      <LockIcon size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" />
      <div className="min-w-0"><div className="text-sm font-medium text-cz-1">Følger sin egen plan</div><div className="text-xs text-cz-2">Dag 3 af 7 · sat på træningssiden</div></div>
    </div>
  );
}
function Link() {
  return <span className="mt-3 inline-flex items-center gap-1 text-sm font-medium text-cz-accent-t">Ret planen på træningssiden<ChevronRightIcon size={12} aria-hidden="true" /></span>;
}

function A() {
  return <Shell><Plan /><Link /></Shell>;
}

// B: dagens fem pas, praecis som planen saetter dem; et loeb staar som loeb.
function B() {
  const passes: [string, string, string][] = [["1", "Lange stigninger", "Hård"], ["2", "Løb · Tour de Preview, etape 3", "Løbsdag"], ["3", "Tempo", "Normal"], ["4", "Udholdenhed", "Let"], ["5", "Aktiv restitution", "Hvile"]];
  return (
    <Shell>
      <Plan />
      <div className="mt-3 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">I dag efter planen</div>
      <ul className="mt-1 text-xs">
        {passes.map(([i, n, e]) => (
          <li key={i} className="grid grid-cols-[18px_1fr_auto] items-center gap-2 border-t border-cz-border py-1.5">
            <span className="font-data tabular-nums text-cz-3">{i}</span><span className="truncate text-cz-1">{n}</span><span className="text-cz-3">{e}</span>
          </li>
        ))}
      </ul>
      <Link />
    </Shell>
  );
}

// C: planens uge som smaa dage; i dag markeret, loebsdage som loeb.
function C() {
  const days: [string, string, boolean][] = [["Man", "Hård", false], ["Tir", "Løb", false], ["Ons", "Hård", true], ["Tor", "Let", false], ["Fre", "Løb", false], ["Lør", "Normal", false], ["Søn", "Hvile", false]];
  return (
    <Shell>
      <Plan />
      <div className="mt-3 grid grid-cols-7 gap-1">
        {days.map(([d, e, now]) => (
          <div key={d} className={`rounded-cz border px-1 py-1.5 text-center ${now ? "border-cz-accent bg-cz-accent/10" : "border-cz-border"}`}>
            <div className="font-data text-3xs uppercase tracking-[.06em] text-cz-3">{d}</div>
            <div className="mt-0.5 text-2xs text-cz-1">{e}</div>
          </div>
        ))}
      </div>
      <p className="mt-2 text-2xs text-cz-3">Belastningen pr. dag efter planen. Hvad han faktisk trænede, står i "sidste 7 dage".</p>
      <Link />
    </Shell>
  );
}

export default function PlanCard() {
  return (
    <div id="shot" className="mx-auto max-w-[1180px] px-4 py-6 sm:px-6">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Rytterens side · Træning-fanen</div>
      <h2 className="font-data text-xl font-bold leading-tight text-cz-1">Plankortet: tre udgaver, hvor al info er korrekt</h2>
      <p className="mt-1 max-w-[76ch] text-sm text-cz-2">Ingen "Skift"-knap, når en plan styrer. Alle tre passer også med flere pas om dagen og løbsdage.</p>
      <div className="mt-4 grid gap-4 md:grid-cols-3">
        <div><div className="mb-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">A · Kun planen</div><A /></div>
        <div><div className="mb-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">B · Planen + dagens fem pas</div><B /></div>
        <div><div className="mb-1.5 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">C · Planen + ugen</div><C /></div>
      </div>
      <p className="mt-3 text-2xs text-cz-3">Eksempeldata.</p>
    </div>
  );
}
