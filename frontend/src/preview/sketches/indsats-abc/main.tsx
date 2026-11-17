// #8298 skitse: indsatsens trin A/B/C i den RIGTIGE taktik-komponent (TacticsRiderTable +
// EffortSegmented), samme fire ryttere i alle tre. Ejerens hold (prod, kun SELECT 17/11):
// navne og nation er aegte; rolle, tal og valg er eksempler. Intet her er produktkode.
// Aabnes: /src/preview/sketches/indsats-abc/index.html
import { createRoot } from "react-dom/client";
import { MemoryRouter } from "react-router";
import { useEffect, useRef, useState, type ReactNode } from "react";
import "../../../index.css";
import TacticsRiderTable, { type TacticsRiderRow } from "../../../components/tactics/TacticsRiderTable.tsx";
import EffortSegmented from "../../../components/tactics/EffortSegmented.tsx";

type Variant = "A" | "B" | "C";
const FIVE = ["grupetto", "save", "normal", "protect", "all_out"];
const THREE = ["save", "normal", "all_out"];
const WORD_A: Record<string, string> = { grupetto: "Grupetto", save: "Spar", normal: "Normal", protect: "Arbejd", all_out: "Alt ud" };
const WORD_3: Record<string, string> = { save: "Let", normal: "Normal", all_out: "Hård" };

type Rider = { id: string; name: string; nation: string; role: string; roleKey: "captain" | "sprint" | "helper" | "hunter"; stored: string; rating: number; form: number; fatigue: number; match: number };
const RIDERS: Rider[] = [
  { id: "a", name: "Felix Schmidt", nation: "ch", role: "Kaptajn", roleKey: "captain", stored: "normal", rating: 78, form: 74, fatigue: 22, match: 79 },
  { id: "b", name: "Henrik Nyström", nation: "no", role: "Sprintkaptajn", roleKey: "sprint", stored: "grupetto", rating: 74, form: 58, fatigue: 44, match: 44 },
  { id: "c", name: "Bram Janssen", nation: "be", role: "Hjælper", roleKey: "helper", stored: "protect", rating: 69, form: 71, fatigue: 18, match: 57 },
  { id: "d", name: "Aron Bizimana", nation: "er", role: "Udbrudsjæger", roleKey: "hunter", stored: "all_out", rating: 71, form: 66, fatigue: 31, match: 81 },
];

const TEXT: Record<Variant, { title: string; line: string }> = {
  A: { title: "A · Alle fem på én linje", line: "Spilleren beholder alle fem valg, også Grupetto og Arbejd. Linjen er bredere og har flere ord at læse." },
  B: { title: "B · Tre på linjen, Grupetto og Arbejd ved rollen", line: "Linjen er kort og ens for alle (Let, Normal, Hård). Grupetto findes kun hos sprinteren og Arbejd kun hos hjælperen, hvor de giver mening, så intet valg går tabt." },
  C: { title: "C · Kun tre, præcis som wireframet", line: "Enklest at se, men Grupetto og Arbejd forsvinder. En rytter, der i dag står på en af dem, vises uden valg, og næste gem gør ham til Let eller Hård." },
};

function RoleCell({ rider, variant }: { rider: Rider; variant: Variant }) {
  const [on, setOn] = useState(rider.stored === "grupetto" || rider.stored === "protect");
  const extra = variant === "B" && (rider.roleKey === "sprint" || rider.roleKey === "helper")
    ? (rider.roleKey === "sprint" ? "Grupetto i dag" : "Arbejd for kaptajnen")
    : null;
  return (
    <div className="min-w-0">
      <div className="text-sm text-cz-1">{rider.role}</div>
      <div className="text-2xs uppercase tracking-wide text-cz-3">Hele løbet</div>
      {extra && (
        <label className="mt-1 inline-flex items-center gap-1.5 text-xs text-cz-1">
          <input type="checkbox" checked={on} onChange={(e) => setOn(e.target.checked)} />
          {extra}
        </label>
      )}
    </div>
  );
}

function Effort({ rider, variant, fill }: { rider: Rider; variant: Variant; fill: boolean }) {
  const steps = variant === "A" ? FIVE : THREE;
  const words = variant === "A" ? WORD_A : WORD_3;
  // B: grupetto/protect bor ved rollen; linjen viser "Normal" som base for de to.
  // C: et gemt grupetto/protect findes ikke paa linjen -> intet valgt.
  const initial = variant === "A" ? rider.stored : THREE.includes(rider.stored) ? rider.stored : variant === "B" ? "normal" : "";
  const [value, setValue] = useState(initial);
  return (
    <div data-effort-cell className="min-w-0">
      <EffortSegmented label={`Indsats for ${rider.name}`} steps={steps} value={value} labelFor={(s) => words[s] ?? s} onPick={setValue} fill={fill} />
      {variant === "C" && !THREE.includes(rider.stored) && (
        <div className="mt-1 text-2xs text-cz-warning">Står i dag på {WORD_A[rider.stored]}, som ikke kan vises her</div>
      )}
    </div>
  );
}

function rowsFor(variant: Variant): TacticsRiderRow[] {
  return RIDERS.map((r) => ({
    id: r.id, name: r.name, nation: r.nation, rating: r.rating, form: r.form, fatigue: r.fatigue,
    role: <RoleCell rider={r} variant={variant} />, roleMobile: <RoleCell rider={r} variant={variant} />,
    routeMatch: <span className="font-data text-xs tabular-nums text-cz-2">{r.match}</span>,
    routeMatchNumber: <span className="font-data text-xs tabular-nums text-cz-1">{r.match}</span>,
    timeLimitMark: null,
    today: "Intet sat. Han kører sin rolle.",
    effort: <Effort rider={r} variant={variant} fill={false} />,
    effortMobile: <Effort rider={r} variant={variant} fill />,
    orders: null, expanded: null,
  }));
}

function Measure({ children }: { children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [m, setM] = useState("");
  useEffect(() => {
    const t = setTimeout(() => {
      const box = ref.current; if (!box) return;
      const cells = [...box.querySelectorAll<HTMLElement>("[data-effort-cell] [role=radiogroup], [data-effort-cell] > div:first-child")];
      const w = Math.max(0, ...cells.map((c) => Math.round(c.getBoundingClientRect().width)));
      const rows = [...box.querySelectorAll<HTMLElement>("tr[data-tactics-rider]")].filter((r) => r.offsetParent);
      const h = rows.length ? Math.round(Math.max(...rows.map((r) => r.getBoundingClientRect().height))) : 0;
      setM(`Indsatskolonnen: ${w} px bred${h ? ` · højeste række: ${h} px` : ""}`);
    }, 600);
    return () => clearTimeout(t);
  }, []);
  return <div ref={ref}>{children}<p data-measure className="mt-2 font-data text-xs font-semibold tabular-nums text-cz-1">{m}</p></div>;
}

function App() {
  return (
    <main className="mx-auto max-w-[1280px] px-4 py-6 sm:px-8">
      <h1 className="font-data text-xl font-bold text-cz-1">Indsatsens trin: tre muligheder</h1>
      <p className="mt-1 text-sm text-cz-2">Samme fire ryttere fra dit hold i alle tre, i den rigtige taktik-komponent. Bram Janssen står i dag på Arbejd, Henrik Nyström på Grupetto. Tal og valg er eksempler.</p>
      {(["A", "B", "C"] as Variant[]).map((v) => (
        <section key={v} className="mt-6 rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
          <h2 className="text-[15px] font-semibold text-cz-1">{TEXT[v].title}</h2>
          <p className="mb-3 text-sm text-cz-2">{TEXT[v].line}</p>
          <Measure>
            <TacticsRiderTable rows={rowsFor(v)} showOrders={false}
              columns={{ rider: "Rytter", role: "Rolle", rating: "Rating", form: "Form", routeMatch: "Rute-match", fatigue: "Træthed", today: "I dag", effort: "Indsats", orders: "Ordrer" }}
              routeMatchTitle="Sortér" mobileRouteMatchLabel="Rute-match" sortDir={null} onSort={() => {}} />
          </Measure>
        </section>
      ))}
    </main>
  );
}

document.documentElement.lang = "da";
createRoot(document.getElementById("root")!).render(<MemoryRouter><App /></MemoryRouter>);
