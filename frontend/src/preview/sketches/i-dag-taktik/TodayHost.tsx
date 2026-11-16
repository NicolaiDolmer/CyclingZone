// Skitse #7535 "I dag": wireframets "Planning · Today's tactics" (v6b-1280-today) vist som FAERDIG
// paa planlaegningssiden. Forslag A: 'Today' er en visning i planlaegningens sidehoved ved siden af
// Week board, Race list og Month calendar (samme kontakt-knapper som /planning/workbench). Dagens
// loeb staar paa een liste; det valgte loeb viser det faelles taktikpanel (PR #8289) under listen.
// data-mark = ramme + nummer paa PR-billederne (forslag 6-8 fra #8289 og placeringen A).

import { useCallback, useState, type ReactNode } from "react";
import PageHeader from "../../../components/ui/PageHeader.jsx";
import { buttonClass } from "../../../components/ui/buttonStyles.js";
import { CalendarIcon } from "../../../components/ui/icons";
import { MY } from "./data.ts";
import { PROFILE, SCHED_AT, cph, initialState, kindOf, planLabel, type TacState } from "./model.ts";
import { TacticsPanel, type SetTac } from "./Panel.tsx";
import { Sprite } from "./Profile.tsx";

function useTac(opts: { details?: boolean; mopen?: string | null }) {
  const [s, setS] = useState<TacState>(() => initialState(opts));
  const set: SetTac = useCallback((fn) => setS((prev) => { const d = structuredClone(prev); fn(d); return d; }), []);
  return [s, set] as const;
}

/** Samme kontakt-knap som planlaegningens sidehoved (PlanningWorkbenchPage: Toggle). */
function Toggle({ pressed, onClick, children, mark, flow }: { pressed: boolean; onClick: () => void; children: ReactNode; mark?: string; flow?: string }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      data-mark={mark}
      data-flow={flow}
      className={`${buttonClass({ variant: "secondary", size: "sm" })} ${pressed ? "border-cz-3 bg-cz-subtle" : ""}`}
    >
      <span aria-hidden="true" className={`inline-block h-2.5 w-2.5 shrink-0 rounded-[2px] border ${pressed ? "border-cz-1 bg-cz-1" : "border-cz-3 bg-transparent"}`} />
      {children}
    </button>
  );
}

type Row = { id: string; time: string; race: string; st: string; type: string; plan: string; changed: boolean; mine: boolean; done: boolean };

export function TodayHost({ details, mopen }: { details: boolean; mopen: string | null }) {
  const [s, set] = useTac({ details, mopen });
  const [view, setView] = useState({ today: true, week: false, list: false });
  const n = s.stage;
  const changed = !!s.kinds[n] && s.kinds[n] !== s.std[PROFILE[n].type];
  const rows: Row[] = [
    { id: "a1", time: cph(SCHED_AT[1]), race: "Giro delle Alpi Orientali", st: "Stage 1", type: PROFILE[1].type, plan: planLabel(kindOf(s, 1), 1), changed: false, mine: false, done: true },
    { id: "a2", time: cph(SCHED_AT[2]), race: "Giro delle Alpi Orientali", st: `Stage ${n}`, type: PROFILE[n].type, plan: planLabel(kindOf(s, n), n), changed, mine: true, done: false },
    { id: "b2", time: "Sat 18:00", race: "Ronde van Westerland", st: "Stage 2", type: "hilly", plan: "Stage win", changed: false, mine: false, done: false },
    { id: "c1", time: "Sat 19:00", race: "Classica dei Colli", st: "One day", type: "flat", plan: "Sprint", changed: false, mine: false, done: false },
    { id: "d4", time: "Sat 20:00", race: "Tour du Sud-Ouest", st: "Stage 4", type: "mountain", plan: "Ride for GC", changed: false, mine: false, done: false },
  ];
  const source = (r: Row) => (r.changed ? "Changed for this stage" : "Your standard");
  const action = (r: Row) =>
    r.mine ? <span className="dim">Shown below</span>
      : r.done ? <span className="dim">Finished</span>
        : <button type="button" className="chip">Open</button>;
  const save = () => set((d) => { d.confirmed = true; d.touched = false; });

  const actions = (
    <div className="flex flex-wrap items-center gap-2">
      <Toggle pressed={view.today} onClick={() => setView({ ...view, today: !view.today })} mark="A" flow="2">Today</Toggle>
      <Toggle pressed={view.week} onClick={() => setView({ ...view, week: !view.week })}>Week board</Toggle>
      <Toggle pressed={view.list} onClick={() => setView({ ...view, list: !view.list })}>Race list</Toggle>
      <a href="#calendar" onClick={(e) => e.preventDefault()} className={buttonClass({ variant: "secondary", size: "sm" })}>
        <CalendarIcon size={14} aria-hidden="true" />
        Month calendar
      </a>
      <button type="button" data-mark="6" onClick={save} className={buttonClass({ variant: "primary", size: "sm" })}>
        {s.confirmed ? "Saved" : `Save stage ${n} tactics`}
      </button>
    </div>
  );

  return (
    <div className="mx-auto max-w-[1600px]">
      <Sprite />
      <PageHeader
        title="Planning"
        subtitle={"Today · Sat 7 Nov · 5 races. Most days this is all you need."}
        // @ts-ignore: PageHeader (jsx) udleder actions som null-only fra sin default, samme note som PlanningHubPage
        actions={actions}
      />
      <div className="twf" style={{ minHeight: 0, background: "transparent" }}>
        <section className="card" data-flow="3" aria-label="Today's races">
          <h2>{"Today's races"} <small>one plan per race · click Open to switch race</small></h2>
          {/* computer: wireframets tabel */}
          <div className="tbl hidden sm:block">
            <table data-sort-exempt="dagens løb i tidsorden">
              <thead><tr><th>Time</th><th>Race</th><th>Stage</th><th>Team plan</th><th>Source</th><th /></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} aria-current={r.mine ? "true" : undefined} data-mark={r.mine ? "7" : undefined}>
                    <td className="n" style={{ fontWeight: 700 }}>{r.time}</td>
                    <td style={r.done ? { color: "var(--t3)" } : undefined}>{r.race}</td>
                    <td style={{ whiteSpace: "nowrap" }}><svg className="ic" style={{ verticalAlign: -4 }}><use href={`#i-${r.type}`} /></svg> {r.st}</td>
                    <td><b>{r.plan}</b></td>
                    <td className="dim">{source(r)}</td>
                    <td>{action(r)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {/* telefon: een raekke pr. loeb, samme felter */}
          <ul className="sm:hidden" style={{ listStyle: "none", margin: "0 -16px", padding: 0 }}>
            {rows.map((r) => (
              <li
                key={r.id}
                aria-current={r.mine ? "true" : undefined}
                data-mark={r.mine ? "7" : undefined}
                style={{ display: "grid", gridTemplateColumns: "56px minmax(0,1fr) auto", gap: 8, alignItems: "center", padding: "10px 16px", borderTop: "1px solid var(--line)", background: r.mine ? "var(--sub)" : undefined, minHeight: 56 }}
              >
                <span style={{ fontFamily: "var(--num)", fontWeight: 700, fontVariantNumeric: "tabular-nums", fontSize: 13 }}>{r.time.replace("Sat ", "")}</span>
                <span style={{ minWidth: 0 }}>
                  <span style={{ display: "block", fontSize: 13.5, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", color: r.done ? "var(--t3)" : undefined }}>{r.race}</span>
                  <span className="dim" style={{ display: "flex", gap: 4, alignItems: "center" }}>
                    <svg className="ic" style={{ width: 14, height: 14 }}><use href={`#i-${r.type}`} /></svg>{r.st} · <b style={{ color: "var(--t1)" }}>{r.plan}</b>
                  </span>
                </span>
                <span>{action(r)}</span>
              </li>
            ))}
          </ul>
        </section>

        <div className="racehead" data-mark="8">
          <h2>{`Giro delle Alpi Orientali · Stage ${n} of 7`}</h2>
          <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>
            {s.confirmed
              ? <><span className="badge good">Saved</span><span className="when">{`all ${MY.length} riders · you can change it until Sat 16:55`}</span></>
              : <><span className="badge warn">Not saved</span><span className="when">{`Locks Sat 16:55, in 35 min · ${MY.length} riders ride the assistant's plan`}</span></>}
          </span>
        </div>
        <TacticsPanel s={s} set={set} saveInHeader />
      </div>
    </div>
  );
}
