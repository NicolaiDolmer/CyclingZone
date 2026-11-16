// Skitse #7535: de to vaerter om det faelles panel. Loebssiden er wireframe v6c ordret (hero B med
// Spoiler shield og status, etapestriben, fanerne). Planlaegningen bruger wireframets
// "Planning · Today's tactics"-sidehoved og -liste, og viser SAMME panel for det valgte loeb.

import { useCallback, useState, type ReactNode } from "react";
import { MY } from "./data.ts";
import {
  FINALE, PROFILE, SCHED_AT, STAGES, TYPE_LABEL, cph, initialState, isDone, kindOf, planLabel, stripWord, type TacState,
} from "./model.ts";
import { TacticsPanel, type SetTac } from "./Panel.tsx";
import { MiniProfile, Sprite } from "./Profile.tsx";

export function useTac(opts: { details?: boolean; mopen?: string | null }) {
  const [s, setS] = useState<TacState>(() => initialState(opts));
  const set: SetTac = useCallback((fn) => setS((prev) => { const d = structuredClone(prev); fn(d); return d; }), []);
  return [s, set] as const;
}

function Shell({ children }: { children: ReactNode }) {
  return (
    <div className="twf">
      <Sprite />
      <div className="twf-shell">
        <aside className="twf-side" aria-label="App sidebar">App sidebar 208 px</aside>
        <div className="twf-main"><div className="wrap">{children}</div></div>
      </div>
    </div>
  );
}

const stageStatus = (s: TacState) =>
  s.confirmed
    ? <><span className="badge good">Saved</span><span className="when">{`Stage ${s.stage} · all ${MY.length} riders · you can change it until Sat 16:55`}</span></>
    : <><span className="badge warn">Not saved</span><span className="when">{`Stage ${s.stage} locks Sat 16:55, in 35 min · ${MY.length} riders ride the assistant's plan`}</span></>;

export function RaceHost({ details, mopen }: { details: boolean; mopen: string | null }) {
  const [s, set] = useTac({ details, mopen });
  const [shield, setShield] = useState(false);
  const n = s.stage;
  const p = PROFILE[n];
  const lc = p.climbs[p.climbs.length - 1];
  const tabs = [["stage", "Stage"], ["start", "Start list"], ["tactics", "Tactics"], ["team", "Team"]];
  return (
    <Shell>
      <a className="back" href="#races" onClick={(e) => e.preventDefault()}><svg viewBox="0 0 16 16"><path d="M10 3L5 8l5 5" /></svg>Races</a>
      <header className="hero">
        <div>
          <h1>Giro delle Alpi Orientali</h1>
          <div className="meta">{`WorldTour · stage race · Stage ${n} of 7 · ${TYPE_LABEL[p.type]} · ${p.km} km · ${cph(SCHED_AT[n])}`}</div>
          <div className="verdict">{`${FINALE[p.finale] ?? ""}${lc ? ` on ${lc.name} (${lc.cat})` : ""} · ${p.climbs.length} categorised climbs`}</div>
        </div>
        <div className="hero-r">
          <button className="shield" type="button" aria-pressed={shield} onClick={() => setShield(!shield)}>
            <span>Spoiler shield</span><span className="sw" aria-hidden="true" />
          </button>
        </div>
        <div className="hero-act">{stageStatus(s)}</div>
      </header>
      <div className="calwrap">
        <button className="arrow" type="button" aria-label="Previous stage" disabled={n <= 1} onClick={() => set((d) => { d.stage = Math.max(2, d.stage - 1); })}><svg><use href="#s-left" /></svg></button>
        <nav className="cal" aria-label="Stages">
          {STAGES.map((k) => {
            const q = PROFILE[k];
            const today = SCHED_AT[k].toDateString() === new Date("2026-11-07T15:20:00Z").toDateString();
            const done = isDone(k);
            return (
              <button key={k} type="button" className={`st ${done ? "done" : ""}`} aria-pressed={k === n} onClick={() => !done && set((d) => { d.stage = k; })}>
                {today && <span className="today">TODAY</span>}
                <div className="top">
                  <span className="lhs"><b>{k}</b><svg className="ic"><use href={`#i-${q.type}`} /></svg></span>
                  <span className="t">{cph(SCHED_AT[k])}</span>
                  {q.weather === "rain" && <svg className="wx" aria-label="Rain"><use href="#w-rain" /></svg>}
                </div>
                <MiniProfile q={q} />
                <div className="win" style={done && !shield ? undefined : { color: "var(--t3)" }}>{done && shield ? "Finished" : stripWord(s, k)}</div>
              </button>
            );
          })}
          <button type="button" className="st" aria-pressed="false">
            <div className="top"><b>Overall</b></div>
            <div className="row">after stage 1</div>
            <div className="win">{shield ? "Hidden" : "Tonti leads"}</div>
          </button>
        </nav>
        <button className="arrow" type="button" aria-label="Next stage" disabled={n >= 7} onClick={() => set((d) => { d.stage = Math.min(7, d.stage + 1); })}><svg><use href="#s-right" /></svg></button>
      </div>
      <div className="tabs" role="tablist">
        {tabs.map(([k, l]) => <button key={k} role="tab" type="button" aria-selected={k === "tactics"}>{l}</button>)}
      </div>
      <TacticsPanel s={s} set={set} />
    </Shell>
  );
}

/** Wireframets "Planning · Today's tactics": dagens loeb paa en liste; det valgte loeb viser SAMME panel. */
export function PlanHost({ details, mopen }: { details: boolean; mopen: string | null }) {
  const [s, set] = useTac({ details, mopen });
  const n = s.stage;
  const rows = [
    { time: cph(SCHED_AT[1]), race: "Giro delle Alpi Orientali", st: "Stage 1", type: PROFILE[1].type, plan: planLabel(kindOf(s, 1), 1), mine: false, ex: false },
    { time: cph(SCHED_AT[2]), race: "Giro delle Alpi Orientali", st: `Stage ${n}`, type: PROFILE[n].type, plan: planLabel(kindOf(s, n), n), mine: true, ex: false },
    { time: "Sat 18:00", race: "Example: U23 Tour", st: "Stage 2", type: "hilly", plan: "Stage win", mine: false, ex: true },
    { time: "Sat 19:00", race: "Example: Junior Classic", st: "One day", type: "flat", plan: "Sprint", mine: false, ex: true },
    { time: "Sat 20:00", race: "Example: Tour du Sud", st: "Stage 4", type: "mountain", plan: "Ride for GC", mine: false, ex: true },
  ];
  return (
    <Shell>
      <div className="pagehead">
        <h1 className="pg">{"Planning · Today's tactics"}</h1>
        <p className="dim">Every race today on one list. Most days this is all you need.</p>
      </div>
      <section className="card">
        <div className="tbl">
          <table>
            <thead><tr><th>Time</th><th>Race</th><th>Stage</th><th>Team plan</th><th>Source</th><th /></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.race + r.st} aria-current={r.mine ? "true" : undefined}>
                  <td className="n" style={{ fontWeight: 700 }}>{r.time}</td>
                  <td className={r.ex ? "ex" : ""}>{r.race}</td>
                  <td style={{ whiteSpace: "nowrap" }}><svg className="ic" style={{ verticalAlign: -4 }}><use href={`#i-${r.type}`} /></svg> {r.st}</td>
                  <td><b>{r.plan}</b></td>
                  <td className="dim">{r.mine && s.kinds[n] && s.kinds[n] !== s.std[PROFILE[n].type] ? "Changed for this stage" : "Your standard"}</td>
                  <td>{r.mine ? <span className="dim">Shown below</span> : r.ex ? null : <button type="button" className="chip">Open</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
      <div className="racehead">
        <h2>{`Giro delle Alpi Orientali · Stage ${n} of 7`}</h2>
        <span style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", fontSize: 13 }}>{stageStatus(s)}</span>
      </div>
      <TacticsPanel s={s} set={set} />
    </Shell>
  );
}
