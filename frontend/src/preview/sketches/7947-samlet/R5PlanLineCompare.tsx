// Telefonens I dag-fane: hvor planen staar i raekken. A = en stille linje under navnet (anbefalet),
// B = et lille maerke ved navnet, hvor man trykker for at se planen. Hele fanen vises. Eksempeldata.
import { CalendarIcon, UserIcon } from "../../../components/ui/icons/index.jsx";
import { FatiguePlate } from "./R5Parts.tsx";

type Row = { name: string; meta: string; fatigue: number; today: string; effort: string; plan: string; short: string; quick?: boolean };
const ROWS: Row[] = [
  { name: "Arne Deneve", meta: "Klatrer · 26", fatigue: 34, today: "VO2max", effort: "Hård", plan: "Egen plan · dag 3 af 7", short: "Egen plan" },
  { name: "Lukas Moesgaard", meta: "Klatrer · 23", fatigue: 41, today: "Lange stigninger", effort: "Normal", plan: "Program: Klatreblok · uge 2 af 4", short: "Program" },
  { name: "Owen Pellow", meta: "Sprinter · 21", fatigue: 22, today: "Sprint", effort: "Hård", plan: "Hård i dag · programmet fortsætter i morgen", short: "I dag", quick: true },
  { name: "Jesper Hollund", meta: "Baroudeur · 28", fatigue: 57, today: "Restitution", effort: "Let", plan: "Holdets program", short: "Hold" },
];
const TONE: Record<string, string> = { Hård: "text-cz-danger", Normal: "text-cz-warning", Let: "text-cz-success" };

function Header() {
  return (
    <div className="mb-3">
      <div className="font-data text-lg font-bold text-cz-1">Daglig træning</div>
      <div className="mt-2 flex gap-4 border-b border-cz-border text-sm">
        {["I dag", "Program", "Udvikling", "Rapport"].map((t) => <span key={t} className={`pb-2 ${t === "I dag" ? "border-b-2 border-cz-accent font-medium text-cz-1" : "text-cz-3"}`}>{t}</span>)}
      </div>
      <div className="mt-3 grid grid-cols-3 gap-2 text-center">
        {[["Træner", "15"], ["Kører løb", "27"], ["Trætte", "0"]].map(([k, v]) => (
          <div key={k} className="rounded-cz border border-cz-border bg-cz-card px-2 py-2"><div className="font-data text-lg font-semibold tabular-nums text-cz-1">{v}</div><div className="text-3xs uppercase tracking-[.06em] text-cz-3">{k}</div></div>
        ))}
      </div>
    </div>
  );
}

function List({ mode }: { mode: "a" | "b" }) {
  return (
    <ul className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
      {ROWS.map((r) => (
        <li key={r.name} className="flex items-center gap-3 border-b border-cz-border px-3 py-2.5 last:border-b-0">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <UserIcon size={12} aria-hidden="true" className="shrink-0 text-cz-3" />
              <span className="truncate text-sm font-medium text-cz-1">{r.name}</span>
              {mode === "b" && (
                <span className={`shrink-0 rounded-cz border px-1 py-px text-3xs font-medium ${r.quick ? "border-cz-accent/50 text-cz-accent-t" : "border-cz-border text-cz-2"}`}>{r.short}</span>
              )}
            </div>
            <div className="text-2xs text-cz-3">{r.meta}</div>
            {mode === "a" && (
              <span className={`mt-0.5 flex min-w-0 items-center gap-1 text-2xs ${r.quick ? "text-cz-accent-t" : "text-cz-2"}`}>
                {r.quick ? <span className="inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-cz-accent" aria-hidden="true" /> : <CalendarIcon size={11} aria-hidden="true" className="shrink-0 text-cz-3" />}
                <span className="truncate">{r.plan}</span>
              </span>
            )}
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1"><span className="text-xs text-cz-1">{r.today}</span><span className={`text-2xs font-medium ${TONE[r.effort]}`}>{r.effort}</span></div>
          <FatiguePlate value={r.fatigue} />
        </li>
      ))}
    </ul>
  );
}

export default function PlanLineCompare() {
  return (
    <div id="shot" className="mx-auto max-w-[860px] px-4 py-5">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Telefon · fanen I dag · hvor planen står</div>
      <div className="grid gap-6 sm:grid-cols-2">
        <div><div className="mb-1.5 font-data text-xs font-semibold text-cz-1">A · Én stille linje under navnet <span className="text-cz-success">(anbefalet)</span></div><Header /><List mode="a" /><p className="mt-2 text-2xs text-cz-2">Planen kan læses direkte, også hvor langt den er nået.</p></div>
        <div><div className="mb-1.5 font-data text-xs font-semibold text-cz-1">B · Et lille mærke ved navnet</div><Header /><List mode="b" /><p className="mt-2 text-2xs text-cz-2">Kortere rækker. Man trykker for at se dag og uge.</p></div>
      </div>
      <p className="mt-3 text-2xs text-cz-3">Eksempeldata.</p>
    </div>
  );
}
