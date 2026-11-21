// Hele rytterens Traening-fane (telefon) med plankortet A, B eller C, saa det ses i sammenhaeng
// (ejer 19/11: "vis hele den side det drejer sig om"). Opbygning som siden i dag. Eksempeldata.
import type { ReactNode } from "react";
import { A, B, C } from "./R5PlanCard.tsx";

function Card({ title, right, children }: { title: string; right?: string; children: ReactNode }) {
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card p-4">
      <div className="mb-3 flex items-baseline justify-between gap-2"><h3 className="font-data text-lg font-semibold text-cz-1">{title}</h3>{right && <span className="font-data text-3xs uppercase tracking-[.08em] text-cz-3">{right}</span>}</div>
      {children}
    </section>
  );
}

const ABIL: [string, number, string, number, string][] = [
  ["Klatring", 68, "+1", 64, "i dag +9 %"], ["Tempo", 59, "+0", 41, "i dag +6 %"], ["Punch", 79, "+2", 22, "—"],
];

function Season() {
  const COLS = "grid grid-cols-[1fr_32px_40px_96px] items-center gap-2";
  return (
    <Card title="Denne sæson" right="Siden 28. okt.">
      <div className={`${COLS} font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3`}><span>Evne</span><span className="text-end">Nu</span><span className="text-end">Sæson</span><span>Næste point</span></div>
      {ABIL.map(([n, nu, s, p]) => (
        <div key={n} className={`${COLS} border-t border-cz-border py-2 text-sm`}>
          <span className="text-cz-1">{n}</span><span className="text-end font-data tabular-nums text-cz-1">{nu}</span>
          <span className="text-end font-data tabular-nums text-cz-success">{s}</span>
          <span className="flex items-center gap-1.5"><span className="relative block h-1.5 w-12 overflow-hidden rounded-cz bg-cz-border"><span className="absolute inset-y-0 start-0 bg-cz-accent" style={{ width: `${p}%` }} /></span><span className="font-data text-2xs tabular-nums text-cz-2">{p} %</span></span>
        </div>
      ))}
      <p className="mt-2 text-2xs text-cz-3">Hele point siden sæsonstart. Flere evner under "Alle evner".</p>
    </Card>
  );
}

function SevenDays() {
  const rows: [string, string, string, string, string?][] = [
    ["I dag", "Lange stigninger", "Hård", "+6 evner"], ["−1d", "Løb · Lange enkeltstarter", "Løbsdag", "+5 evner"],
    ["−2d", "VO2max (punch)", "Hård", "+2 evner"], ["−3d", "VO2max (klatring)", "Hård", "+5 evner"],
  ];
  return (
    <Card title="Daglig træning · sidste 7 dage">
      {rows.map(([d, n, e, r]) => (
        <div key={d} className="grid grid-cols-[44px_1fr_auto] items-center gap-2 border-t border-cz-border py-2 text-sm">
          <span className="font-data tabular-nums text-cz-3">{d}</span><span className="truncate text-cz-1">{n} <span className="text-cz-3">· {e}</span></span><span className="text-cz-success">{r}</span>
        </div>
      ))}
    </Card>
  );
}

function Form() {
  return (
    <Card title="Form og restitution">
      {[["Form", 66, "bg-cz-success"], ["Træthed", 18, "bg-cz-warning"]].map(([k, v, c]) => (
        <div key={k as string} className="mb-3">
          <div className="flex justify-between text-sm"><span className="text-cz-2">{k}</span><span className="font-data font-semibold tabular-nums text-cz-1">{v}</span></div>
          <span className="mt-1 block h-1.5 overflow-hidden rounded-cz bg-cz-border"><span className={`block h-full ${c}`} style={{ width: `${v}%` }} /></span>
        </div>
      ))}
      <span className="inline-flex items-center rounded-cz border border-cz-success/40 bg-cz-success/10 px-2 py-0.5 text-xs text-cz-success">Skadefri</span>
    </Card>
  );
}

const TABS = ["Overblik", "Fysiologi", "Træning", "Udvikling", "Scouting"];

export default function RiderTrainingPage({ v }: { v: "a" | "b" | "c" }) {
  const Plan = v === "a" ? A : v === "b" ? B : C;
  return (
    <div id="shot" className="mx-auto w-full max-w-[430px] px-4 py-5">
      <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Rytterens side · telefon · plankort {v.toUpperCase()}</div>
      <div className="mb-3 flex items-center justify-between">
        <div><div className="font-data text-xl font-bold text-cz-1">Arne Deneve</div><div className="text-xs text-cz-3">Klatrer · 26 år · Dit hold</div></div>
        <span className="inline-flex min-w-[2.4rem] justify-center rounded-cz border border-cz-border bg-cz-subtle px-1.5 py-1 font-data text-base font-semibold tabular-nums text-cz-1">68</span>
      </div>
      <div className="mb-4 flex gap-4 overflow-hidden border-b border-cz-border text-sm">
        {TABS.map((t) => <span key={t} className={`whitespace-nowrap pb-2 ${t === "Træning" ? "border-b-2 border-cz-accent font-medium text-cz-1" : "text-cz-3"}`}>{t}</span>)}
      </div>
      <div className="space-y-4">
        <Season />
        <Plan />
        <SevenDays />
        <Form />
      </div>
      <p className="mt-3 text-2xs text-cz-3">Eksempeldata.</p>
    </div>
  );
}
