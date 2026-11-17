// #8298/#8355 skitse: indsatsen paa en vejetape. Variant 2 ("Hurtigvalg") og 4 (holdtidskoersel)
// i den rigtige taktik-komponent (TacticsRiderTable + EffortSegmented). Opgaver og prisord er
// etapeplanens egne (backend/lib/stagePlan.ts TASK_EFFORT, tacticsReady7864 prisord). Ejerens hold
// (prod, kun SELECT): navne og nation; tal og valg er eksempler. Intet her er produktkode.
// ?v=2 eller ?v=4
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { useState, type ReactNode } from "react";
import "../../../index.css";
import TacticsRiderTable, { type TacticsRiderRow } from "../../../components/tactics/TacticsRiderTable.tsx";
import EffortSegmented from "../../../components/tactics/EffortSegmented.tsx";

type Task = "stay_sheltered" | "shelter_leader" | "tempo" | "follow_moves" | "attack" | "ride_for_result" | "breakaway" | "ride_in" | "grupetto";
type Effort = "grupetto" | "save" | "normal" | "protect" | "all_out";
const TASK_EFFORT: Record<Task, Effort> = {
  breakaway: "normal", stay_sheltered: "save", shelter_leader: "normal", tempo: "protect", follow_moves: "protect",
  attack: "all_out", ride_for_result: "normal", grupetto: "grupetto", ride_in: "save",
};
const TASK_WORD: Record<Task, string> = {
  stay_sheltered: "Kør i læ", shelter_leader: "Hold lederen fremme", tempo: "Kør tempo", follow_moves: "Følg angrebene",
  attack: "Angrib", ride_for_result: "Kør for resultat", breakaway: "Gå i udbrud", ride_in: "Kør ind", grupetto: "Grupetto",
};
const PRICE: Record<Effort, { word: string; cls: string }> = {
  grupetto: { word: "Let", cls: "text-cz-success" }, save: { word: "Let", cls: "text-cz-success" },
  normal: { word: "Mellem", cls: "text-cz-warning" }, protect: { word: "Hård", cls: "text-cz-danger" }, all_out: { word: "Meget hård", cls: "text-cz-danger" },
};
const LEGS = ["Til Passo Lorsa", "Til Cima Preview", "Sidste 10 km"];
type RoleKey = "captain" | "sprint" | "helper" | "hunter";
// Hurtigvalgets genvej: samme opgaver som etapeplanen har, valgt efter rolle og indsats.
const QUICK: Record<RoleKey, Record<"let" | "normal" | "hard", Task>> = {
  captain: { let: "stay_sheltered", normal: "ride_for_result", hard: "follow_moves" },
  sprint: { let: "stay_sheltered", normal: "ride_for_result", hard: "follow_moves" },
  helper: { let: "stay_sheltered", normal: "shelter_leader", hard: "tempo" },
  hunter: { let: "stay_sheltered", normal: "breakaway", hard: "attack" },
};
type Rider = { id: string; name: string; nation: string; role: string; roleKey: RoleKey; legs: Task[]; rating: number; form: number; fatigue: number; match: number };
const RIDERS: Rider[] = [
  { id: "a", name: "Felix Schmidt", nation: "ch", role: "Kaptajn", roleKey: "captain", legs: ["stay_sheltered", "stay_sheltered", "ride_for_result"], rating: 78, form: 74, fatigue: 22, match: 79 },
  { id: "b", name: "Henrik Nyström", nation: "no", role: "Sprintkaptajn", roleKey: "sprint", legs: ["stay_sheltered", "grupetto", "grupetto"], rating: 74, form: 58, fatigue: 44, match: 44 },
  { id: "c", name: "Bram Janssen", nation: "be", role: "Hjælper", roleKey: "helper", legs: ["shelter_leader", "shelter_leader", "ride_in"], rating: 69, form: 71, fatigue: 18, match: 57 },
  { id: "d", name: "Aron Bizimana", nation: "er", role: "Udbrudsjæger", roleKey: "hunter", legs: ["breakaway", "attack", "ride_in"], rating: 71, form: 66, fatigue: 31, match: 81 },
];

function Plan({ legs }: { legs: Task[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1">
      {legs.map((task, i) => (
        <span key={i} className="text-xs">
          <span className="text-2xs text-cz-3">{LEGS[i]}: </span>
          <span className="text-cz-1">{TASK_WORD[task]}</span>{" "}
          <span className={`font-semibold ${PRICE[TASK_EFFORT[task]].cls}`}>{PRICE[TASK_EFFORT[task]].word}</span>
        </span>
      ))}
    </div>
  );
}

function quickOf(r: Rider, legs: Task[]): "let" | "normal" | "hard" | "" {
  const open = legs.filter((t) => t !== "ride_in" && t !== "grupetto");
  for (const k of ["let", "normal", "hard"] as const) if (open.length && open.every((t) => t === QUICK[r.roleKey][k])) return k;
  return "";
}

function Row2({ r, after }: { r: Rider; after: boolean }) {
  const [legs, setLegs] = useState<Task[]>(after && r.roleKey === "helper" ? r.legs.map((t) => (t === "ride_in" ? t : QUICK.helper.hard)) : r.legs);
  const pick = (k: string) => setLegs(legs.map((t) => (t === "ride_in" || t === "grupetto" ? t : QUICK[r.roleKey][k as "let"])));
  return { legs, el: <EffortSegmented label={`Hurtigvalg for ${r.name}`} steps={["save", "normal", "all_out"]} value={{ let: "save", normal: "normal", hard: "all_out", "": "" }[quickOf(r, legs)]} labelFor={(s) => ({ save: "Let", normal: "Normal", all_out: "Hård" } as Record<string, string>)[s]} onPick={(s) => pick({ save: "let", normal: "normal", all_out: "hard" }[s] as string)} /> };
}

function Variant2Table({ after }: { after: boolean }) {
  const rows: TacticsRiderRow[] = RIDERS.map((r) => {
    const Cell = () => { const { legs, el } = Row2({ r, after }); return <div className="flex flex-col items-start gap-1.5">{el}<Plan legs={legs} /></div>; };
    return base(r, <Cell />, after && r.roleKey === "helper");
  });
  return <Table rows={rows} effortLabel="Hurtigvalg · og planen langs ruten" />;
}

function base(r: Rider, effort: ReactNode, mark = false): TacticsRiderRow {
  return {
    id: r.id, name: r.name, nation: r.nation, rating: r.rating, form: r.form, fatigue: r.fatigue,
    role: <div><div className="text-sm text-cz-1">{r.role}</div><div className="text-2xs uppercase tracking-wide text-cz-3">Hele løbet</div></div>,
    roleMobile: <div className="text-sm text-cz-1">{r.role}</div>,
    routeMatch: <span className="font-data text-xs tabular-nums text-cz-2">{r.match}</span>,
    routeMatchNumber: <span className="font-data text-xs tabular-nums text-cz-1">{r.match}</span>,
    timeLimitMark: null,
    today: mark ? <b className="text-cz-1">Tryk på Hård: hele planen blev til Kør tempo</b> : "Kører sin plan.",
    effort, effortMobile: effort, orders: null, expanded: null,
  };
}

function Table({ rows, effortLabel }: { rows: TacticsRiderRow[]; effortLabel: string }) {
  return (
    <TacticsRiderTable rows={rows} showOrders={false}
      columns={{ rider: "Rytter", role: "Rolle", rating: "Rating", form: "Form", routeMatch: "Rute-match", fatigue: "Træthed", today: "I dag", effort: effortLabel, orders: "Ordrer" }}
      routeMatchTitle="Sortér" mobileRouteMatchLabel="Rute-match" sortDir={null} onSort={() => {}} />
  );
}

function Variant4() {
  const words: Record<string, string> = { grupetto: "Grupetto", save: "Spar", normal: "Normal", protect: "Arbejd", all_out: "Alt ud" };
  const rows = RIDERS.map((r) => {
    const Cell = () => { const [v, setV] = useState("normal"); return <EffortSegmented label={`Indsats for ${r.name}`} steps={["grupetto", "save", "normal", "protect", "all_out"]} value={v} labelFor={(s) => words[s]} onPick={setV} />; };
    return base(r, <Cell />);
  });
  return (
    <>
      <Table rows={rows} effortLabel="Indsats" />
      <p className="mt-2 text-xs text-cz-warning">På holdtidskørsel virker Grupetto, Spar, Normal og Arbejd ens i dag. Kun Alt ud gør en forskel (#8355).</p>
    </>
  );
}

function App() {
  const v = new URLSearchParams(location.search).get("v") ?? "2";
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
      {v === "2" ? (
        <>
          <h1 className="font-data text-xl font-bold text-cz-1">2 · Hurtigvalg på vejetapen</h1>
          <p className="mt-1 text-sm text-cz-2">Let | Normal | Hård er en genvej, der sætter rytterens opgaver langs ruten. Prisordet viser, hvad hver opgave koster. Ingen ny motor: knappen skriver kun opgaver, etapeplanen allerede har.</p>
          <section className="mt-4 rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5"><h2 className="mb-2 text-sm font-semibold text-cz-1">Før tryk</h2><Variant2Table after={false} /></section>
          <section className="mt-4 rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5"><h2 className="mb-2 text-sm font-semibold text-cz-1">Efter tryk på Hård hos Bram Janssen (hjælper)</h2><Variant2Table after /></section>
        </>
      ) : (
        <>
          <h1 className="font-data text-xl font-bold text-cz-1">4 · Holdtidskørsel</h1>
          <p className="mt-1 text-sm text-cz-2">Fem trin på én linje, som i dag.</p>
          <section className="mt-4 rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5"><Variant4 /></section>
        </>
      )}
    </main>
  );
}

document.documentElement.lang = "da";
createRoot(document.getElementById("root")!).render(<MemoryRouter><App /></MemoryRouter>);
