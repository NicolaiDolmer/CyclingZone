// Desktop: fanen I dag med den AEGTE holdtabel (TrainingTeamTableB, tændt for alle).
// Foer / A (egen graa linje under navnet) / B (kort i samme linje som type og alder).
// Ejer 19/11: "Jeg vil gerne lave desktop visningen til dette foerst". Eksempeldata.
import "../../../i18n/index.js";
import i18n from "i18next";
import { useEffect, useState } from "react";
import TrainingTeamTableB, { type TeamRowB } from "../../../components/training/TrainingTeamTableB.tsx";

const PLAN: Record<string, [string, string]> = {
  a: ["Egen plan · dag 3 af 7", "Egen plan 3/7"],
  b: ["Gruppen Klatrere · uge 2 af 4", "Klatrere 2/4"],
  c: ["Kun i dag: Restitution · programmet fortsætter i morgen", "Kun i dag"],
  d: ["Holdets program", "Holdets program"],
};
const BASE: { id: string; name: string; sub: string; squad: string; form: number; fatigue: number; day: string; race: string | null }[] = [
  { id: "a", name: "Arne Deneve", sub: "Klatrer · 26", squad: "senior", form: 66, fatigue: 34, day: "VO2max · Hård", race: null },
  { id: "b", name: "Lukas Moesgaard", sub: "Klatrer · 23", squad: "senior", form: 71, fatigue: 41, day: "Løb", race: "Tour de Preview" },
  { id: "c", name: "Owen Pellow", sub: "Sprinter · 21", squad: "u23", form: 58, fatigue: 22, day: "Restitution · Let", race: null },
  { id: "d", name: "Jesper Hollund", sub: "Baroudeur · 28", squad: "senior", form: 62, fatigue: 57, day: "Udholdenhed · Normal", race: null },
];

function Table({ mode }: { mode: "before" | "a" | "b" }) {
  const rows: TeamRowB[] = BASE.map((r) => ({
    id: r.id, name: r.name, squad: r.squad,
    sub: mode === "b" ? `${r.sub} · ${PLAN[r.id][1]}` : r.sub,
    form: r.form, fatigue: r.fatigue, tired: false, seasonPoints: null, noDay: false,
    daysOver: 0, race: r.race, assistant: "agrees",
  }));
  const day = (id: string) => <span className="text-sm text-cz-1">{BASE.find((r) => r.id === id)?.day}</span>;
  return (
    <TrainingTeamTableB
      rows={rows} showScore={false} sort={null} sortDir="asc" onSort={() => {}}
      selected={new Set()} allSelected={false} onToggleSelect={() => {}} onToggleAll={() => {}}
      openId={null} onToggleOpen={() => {}}
      renderDay={day} renderDetail={() => null}
      renderStatus={(id) => (mode === "a" ? <span className="block text-xs text-cz-3">{PLAN[id][0]}</span> : null)}
      renderNoDay={() => null} onUse={() => {}} toolbar={null} limit={70}
    />
  );
}

export default function TodayDesktopPlan() {
  const [ready, setReady] = useState(false);
  useEffect(() => { void i18n.changeLanguage("da").then(() => i18n.loadNamespaces(["training", "common", "rider"])).then(() => setReady(true)); }, []);
  if (!ready) return null;
  const block = (title: string, note: string, mode: "before" | "a" | "b") => (
    <section>
      <div className="mb-1.5 font-data text-xs font-semibold text-cz-1">{title}</div>
      <Table mode={mode} />
      <p className="mt-2 text-2xs text-cz-2">{note}</p>
    </section>
  );
  return (
    <div id="shot" className="mx-auto max-w-[1100px] space-y-6 px-6 py-6">
      <div>
        <div className="mb-1 font-data text-2xs font-semibold uppercase tracking-[.08em] text-cz-accent-t">Desktop · Daglig træning · I dag</div>
        <p className="max-w-[80ch] text-sm text-cz-2">Den ægte holdtabel fra spillet. Planen står i samme grå tekst som typen og alderen. Ingen farve, ingen mærker.</p>
      </div>
      {block("Før (i dag)", "Man kan ikke se, om rytteren følger en plan.", "before")}
      {block("A · Egen linje under navnet (anbefalet)", "Hele planen kan læses, også \"programmet fortsætter i morgen\". Rækken bliver lidt højere.", "a")}
      {block("B · Kort i samme linje", "Rækken er lige så lav som i dag. Planen står kort; detaljen ses, når rytteren foldes ud.", "b")}
      <p className="text-2xs text-cz-3">Eksempeldata.</p>
    </div>
  );
}
