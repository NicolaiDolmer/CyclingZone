// #7947 retning 4, ekstra billeder til ejeren:
//  - ?v=r4&view=q: tre smaa udsnit, der viser anbefaling mod alternativ for
//    ejerspoergsmaal 1-3 (kravspec #8301 §7).
//  - ?v=r4&view=program: programmet som eet objekt med tilstanden uge ELLER
//    rotation (spm. 5, teknisk valg), med "laas et pas" og pause ved hvile (#7456).
// Intet her er produktkode.

import type { ReactNode } from "react";
import { LockIcon } from "../../../components/ui/icons/index.jsx";
import { levelOf, type Level, type Session } from "./model.ts";
import { SESSION_SHORT } from "./data.ts";
import { quickPattern } from "./r4model.ts";

type Cell = Session | "S";
type Src = "Program" | "Hurtigvalg" | "Etape" | "Kørt";

function Ticks({ level }: { level: Level }) {
  return (
    <span aria-hidden="true" className="flex items-end gap-[2px]">
      {[1, 2, 3].map((n) => <span key={n} className={`w-[3px] rounded-[1px] ${n <= level ? "bg-cz-2" : "bg-cz-border"}`} style={{ height: 3 + n * 2 }} />)}
    </span>
  );
}

function Strip({ cells, src, label }: { cells: Cell[]; src: Src[]; label: string }) {
  return (
    <div>
      <div className="mb-1 font-data text-2xs font-semibold text-cz-2">{label}</div>
      <div className="grid grid-cols-5 gap-1">
        {cells.map((c, i) => (
          <div key={i} className="min-w-0">
            {c === "S" ? (
              <span className="flex min-h-8 items-center justify-center gap-1 rounded-cz bg-cz-1 px-1 font-data text-2xs font-semibold text-cz-card"><LockIcon size={10} aria-hidden="true" />Etape</span>
            ) : (
              <span className="flex min-h-8 items-center justify-between gap-1 rounded-cz border border-cz-border bg-cz-card px-1.5 font-data text-2xs text-cz-1">
                {SESSION_SHORT[c]}<Ticks level={levelOf(c)} />
              </span>
            )}
            <div className={`mt-0.5 text-center font-data text-3xs ${src[i] === "Hurtigvalg" ? "font-semibold text-cz-1" : "text-cz-3"}`}>{src[i]}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Samme rotation som programkortet: tirsdag = dag 1 (her overstyret af hurtigvalget),
// onsdag = dag 2, torsdag = dag 3.
const PROGRAM_WED: Cell[] = ["endurance", "technique", "endurance", "endurance", "recovery"];
const PROGRAM_THU: Cell[] = ["vo2max_punch", "vo2max_punch", "tempo", "tempo", "recovery"];
const HARD_PUNCH = quickPattern({ kind: "effort", effort: "hard", type: "Puncheur" });
const P5: Src[] = ["Program", "Program", "Program", "Program", "Program"];
const Q5: Src[] = ["Hurtigvalg", "Hurtigvalg", "Hurtigvalg", "Hurtigvalg", "Hurtigvalg"];

function Compare({ n, question, rec, alt }: {
  n: number; question: string;
  rec: { title: string; body: ReactNode; note: string };
  alt: { title: string; body: ReactNode; note: string };
}) {
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card">
      <header className="border-b border-cz-border px-4 py-3">
        <div className="font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3">Spørgsmål {n}</div>
        <h2 className="mt-0.5 text-[15px] font-semibold text-cz-1">{question}</h2>
      </header>
      <div className="grid gap-px bg-cz-border sm:grid-cols-2">
        {[{ ...rec, tag: "Anbefaling" }, { ...alt, tag: "Alternativ" }].map((x) => (
          <div key={x.tag} className="bg-cz-card p-4">
            <div className={`font-data text-2xs font-semibold uppercase tracking-[.06em] ${x.tag === "Anbefaling" ? "text-cz-1" : "text-cz-3"}`}>{x.tag}</div>
            <div className="mt-0.5 text-sm font-semibold text-cz-1">{x.title}</div>
            <div className="mt-3 flex flex-col gap-3">{x.body}</div>
            <p className="mt-3 text-xs text-cz-2">{x.note}</p>
          </div>
        ))}
      </div>
    </section>
  );
}

export function Questions() {
  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 pb-16 pt-6 sm:px-8">
      <p className="text-sm text-cz-2">Gabriele Moretti (puncheur) følger programmet Ardennerne. Tirsdag (i dag) har du sat hurtigvalget <b className="text-cz-1">Hård mod Puncheur</b>. Sådan ser hans onsdag og torsdag ud:</p>
      <Compare
        n={1}
        question="Hvad gælder på en dato, du ikke har rørt: programmet eller dit seneste hurtigvalg?"
        rec={{ title: "Programmet", body: <Strip label="Torsdag 19/11 (urørt)" cells={PROGRAM_THU} src={P5} />, note: "Det, du ser i programmet, er det, der sker. Et hurtigvalg flytter sig aldrig til en anden dag." }}
        alt={{ title: "Seneste hurtigvalg", body: <Strip label="Torsdag 19/11 (urørt)" cells={HARD_PUNCH} src={Q5} />, note: "Hård fortsætter, til du ændrer det. Programmet står stille, uden at det ses i programmet." }}
      />
      <Compare
        n={2}
        question="Skal dagens valg stadig gælde fremad (stående plan), som i dag?"
        rec={{
          title: "Nej, kun datoen",
          body: (<><Strip label="Tirsdag 17/11 (i dag)" cells={HARD_PUNCH} src={Q5} /><Strip label="Onsdag 18/11" cells={PROGRAM_WED} src={P5} /></>),
          note: "Onsdag følger programmet igen, og rækken siger \"Gælder kun i dag. Programmet fortsætter i morgen\". Eksisterende stående planer bevares for ryttere uden datoplan.",
        }}
        alt={{
          title: "Ja, gælder fremad",
          body: (<><Strip label="Tirsdag 17/11 (i dag)" cells={HARD_PUNCH} src={Q5} /><Strip label="Onsdag 18/11" cells={HARD_PUNCH} src={["Hurtigvalg", "Hurtigvalg", "Hurtigvalg", "Hurtigvalg", "Hurtigvalg"]} /></>),
          note: "Som i dag: valget bliver stående, til du ændrer det. Det er netop den uenighed mellem program og dagens valg, spillerne har klaget over (#8026).",
        }}
      />
      <Compare
        n={3}
        question="Hurtigvalg Hård + type: hvilke træninger vælger spillet?"
        rec={{ title: "Typens standardprogram", body: <Strip label="Hård mod Klatrer" cells={quickPattern({ kind: "effort", effort: "hard", type: "Klatrer" })} src={Q5} />, note: "Altid de samme træninger for samme type og indsats. Forudsigeligt, og spilleren kan se og lære dem." }}
        alt={{ title: "Rytterens svageste evne", body: <Strip label="Hård mod Klatrer (svagest: enkeltstart)" cells={["threshold", "threshold", "aero", "tempo", "recovery"]} src={Q5} />, note: "Skifter fra rytter til rytter og over tid. Mere \"smart\", men sværere at forudsige. Det er nærmere assistentens forslag." }}
      />
    </main>
  );
}

// --- Programmet som eet objekt (uge eller rotation) ---------------------------

const ROTATION: Cell[][] = [
  ["vo2max_punch", "attack_repeats", "tempo", "endurance", "recovery"],
  ["endurance", "technique", "endurance", "endurance", "recovery"],
  ["vo2max_punch", "vo2max_punch", "tempo", "tempo", "recovery"],
  ["rest", "rest", "rest", "rest", "rest"],
];
const WEEK: Cell[][] = [
  ["threshold", "threshold", "threshold", "aero", "threshold"],
  ["endurance", "endurance", "endurance", "endurance", "endurance"],
  ["threshold", "threshold", "aero", "tempo", "recovery"],
  ["aero", "technique", "endurance", "endurance", "recovery"],
  ["rest", "rest", "rest", "rest", "rest"],
  ["threshold", "tempo", "tempo", "endurance", "recovery"],
  ["endurance", "endurance", "endurance", "endurance", "endurance"],
];
const WEEKDAY = ["Man", "Tir", "Ons", "Tor", "Fre", "Lør", "Søn"];

function ProgramCard({ name, mode, days, labels, riders, lockedSlot, note }: {
  name: string; mode: "Rotation" | "Uge"; days: Cell[][]; labels: string[]; riders: string; lockedSlot: number | null; note: string;
}) {
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-cz-border px-4 py-3">
        <h2 className="text-[15px] font-semibold text-cz-1">{name}</h2>
        <div role="radiogroup" aria-label="Programmets form" className="grid grid-cols-2 overflow-hidden rounded-cz border border-cz-border text-xs">
          {(["Uge", "Rotation"] as const).map((m, i) => (
            <span key={m} role="radio" aria-checked={m === mode} className={`px-3 py-1 ${i > 0 ? "border-s border-cz-border" : ""} ${m === mode ? "bg-cz-accent/10 font-semibold text-cz-accent-t" : "text-cz-2"}`}>{m}</span>
          ))}
        </div>
        <span className="text-xs text-cz-2">{riders}</span>
        <span className="ms-auto text-xs text-cz-2">Eget program · kan gemmes og gives til ryttere eller grupper</span>
      </header>
      <div className="overflow-x-auto px-4 py-3">
        <table className="w-full min-w-[640px] table-fixed text-xs" data-sort-intent="none">
          <thead>
            <tr>
              <th className="w-[120px] pb-1 text-start font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3">{mode === "Rotation" ? "Dag i rotationen" : "Ugedag"}</th>
              {[1, 2, 3, 4, 5].map((n) => (
                <th key={n} className="pb-1 text-center font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3">
                  Felt {n}{lockedSlot === n - 1 && <span className="ms-1 inline-flex items-center gap-0.5 normal-case text-cz-1"><LockIcon size={10} aria-hidden="true" />låst pas</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {days.map((d, i) => (
              <tr key={i} className="border-t border-cz-border">
                <td className="py-1.5 pe-2 font-data text-xs text-cz-1">{labels[i]}</td>
                {d.map((c, j) => (
                  <td key={j} className="p-0.5">
                    {c !== "S" && (
                      <span className={`flex min-h-8 items-center justify-between gap-1 rounded-cz border bg-cz-card px-1.5 font-data text-2xs ${lockedSlot === j && c !== "rest" ? "border-cz-1 font-semibold text-cz-1" : "border-cz-border text-cz-1"}`}>
                        {SESSION_SHORT[c]}<Ticks level={levelOf(c)} />
                      </span>
                    )}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-cz-2">{note}</p>
      </div>
    </section>
  );
}

export function ProgramView() {
  return (
    <main className="mx-auto flex max-w-[1100px] flex-col gap-4 px-4 pb-16 pt-6 sm:px-8">
      <p className="text-sm text-cz-2">Fanen Program. Ét programobjekt med to former. <b className="text-cz-1">Uge</b> følger ugedagene. <b className="text-cz-1">Rotation</b> kører dag 1, 2, 3 … og rykker kun frem på dage med træning, så et løb skubber rotationen i stedet for at springe en dag over (#7456).</p>
      <ProgramCard
        name="Ardennerne" mode="Rotation" days={ROTATION} labels={["Dag 1", "Dag 2", "Dag 3", "Dag 4 · hvile"]}
        riders="Følges af Gabriele Moretti" lockedSlot={0}
        note="Felt 1 er låst: kører Gabriele et løb, tager løbet dagens mindst vigtige pas, og Punch-intervallerne bliver stående. I dag er han på dag 1; hurtigvalget i dag gælder kun i dag, og rotationen fortsætter med dag 2 i morgen."
      />
      <ProgramCard
        name="Enkeltstart-uge" mode="Uge" days={WEEK} labels={WEEKDAY} riders="Følges af Sota Morita" lockedSlot={null}
        note="Samme objekt i formen Uge: det, holdets 35 felter (7 dage × 5 felter) er i dag. Et program gives til en rytter, en gruppe eller hele holdet, og rækken på Dag viser altid, hvilket program feltet kommer fra."
      />
    </main>
  );
}
