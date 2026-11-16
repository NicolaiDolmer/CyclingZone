// Skitse #7535: DET FAELLES TAKTIKPANEL. Samme komponent paa loebssiden og i planlaegningen.
// Indhold og raekkefoelge er wireframe v6c's Tactics-fane (#7778) ordret: ruten, holdplanen,
// ordrer for etapen (holdets jagt, tabellen med ordrer pr. rutedel), forklaring og bunden med gem.
// Under 640px panelbredde: wireframe v6b-mobil-taktik (tids-akse, et aabent kort pr. rytter).

import { useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import type { MyRider } from "./data.ts";
import {
  PLAN_KINDS, PLAN_TEXT, PROFILE, ROLE_L, SHORT, STAGES, TASK, TONIGHT, WORD, attackPoints, buildPlans, canDo, captainOf,
  effortPlan, formOf, fatigueOf, isDone, kindOf, legNames, matchOf, planLabel, plansOf, ratingOf, roleOf, say, sortedMy,
  stepOptions, tonightLevel, TYPE_LABEL, type Chase, type Effort, type PlanKind, type TacState, type TaskId,
} from "./model.ts";
import { RouteCard } from "./Profile.tsx";

export type SetTac = (fn: (d: TacState) => void) => void;

const Chev = () => <svg><use href="#s-down" /></svg>;
const LockIcon = () => (
  <svg className="lk" viewBox="0 0 12 12"><rect x="2.5" y="5.5" width="7" height="5" rx="1" /><path d="M4 5.5V3.8a2 2 0 0 1 4 0v1.7" /></svg>
);
export const Flag = ({ cc }: { cc: string }) => <span className={`fl fi fi-${cc}`} role="img" aria-label={cc.toUpperCase()} />;

type PopState = { x: number; y: number; body: ReactNode } | null;

export function TacticsPanel({ s, set }: { s: TacState; set: SetTac }) {
  const n = s.stage;
  const p = PROFILE[n];
  const plans = plansOf(s, n);
  const capt = captainOf();
  const last = p.climbs[p.climbs.length - 1];
  const attackKm = last && plans[capt.id][2] === "attack" ? last.crest - [last.len, last.len / 2, 3, 0][s.attack[capt.id]] : null;
  const legs = legNames(n);
  const [pop, setPop] = useState<PopState>(null);

  useEffect(() => {
    if (!pop) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setPop(null); };
    const onDown = (e: MouseEvent) => { if (!(e.target as HTMLElement).closest(".twf-pop")) setPop(null); };
    const close = () => setPop(null);
    window.addEventListener("keydown", onKey);
    window.addEventListener("mousedown", onDown);
    window.addEventListener("resize", close);
    return () => { window.removeEventListener("keydown", onKey); window.removeEventListener("mousedown", onDown); window.removeEventListener("resize", close); };
  }, [pop]);

  const openPop = (el: HTMLElement, body: ReactNode) => {
    const r = el.getBoundingClientRect();
    const w = Math.min(300, window.innerWidth - 32);
    setPop({ x: Math.max(16, Math.min(r.left, window.innerWidth - w - 16)), y: r.bottom + 6, body });
  };
  // Hver aendring nulstiller "gemt" (wireframets regel: aendret = ikke gemt igen).
  const change = (fn: (d: TacState) => void) => set((d) => { fn(d); d.confirmed = false; d.touched = true; });
  const ensure = (d: TacState) => (d.plans[n] ??= buildPlans(d, n));

  const pickStep = (r: MyRider, i: number, t: TaskId) => { change((d) => { ensure(d)[r.id][i] = t; d.custom[`${n}|${r.id}`] = true; }); setPop(null); };
  const stepPop = (el: HTMLElement, r: MyRider, i: number) => {
    const cur = plans[r.id][i];
    openPop(el, (
      <>
        <div className="h">{`${r.name} · ${legs[i]}`}</div>
        {stepOptions(i).filter((t) => canDo(r.role, t)).map((t) => (
          <button key={t} type="button" className="o" aria-pressed={t === cur} onClick={() => pickStep(r, i, t)}>
            <span>{TASK[t][0]}<small>{TASK[t][2]}</small></span>
            <span className={`word w${TASK[t][1]}`}>{WORD[TASK[t][1]]}</span>
          </button>
        ))}
        {i === 2 && cur === "attack" && (
          <>
            <div className="sep" />
            <div className="h">Attack from</div>
            <div className="seg">
              {attackPoints(n).map((l, k) => (
                <button key={l} type="button" aria-pressed={s.attack[r.id] === k} onClick={() => { change((d) => { d.attack[r.id] = k; }); setPop(null); }}>{l}</button>
              ))}
            </div>
          </>
        )}
      </>
    ));
  };
  const rolePop = (el: HTMLElement, r: MyRider) => openPop(el, (
    <>
      <div className="h">{`Role for ${r.name}`}</div>
      {["captain", "co_captain", "helper", "luxury_helper", "hunter", "sprint_captain", "free_role"].map((k) => (
        <button key={k} type="button" className="o" aria-pressed={r.role === k}><span>{ROLE_L[k]}</span></button>
      ))}
      <div className="sep" />
      <div className="h">Applies to</div>
      <div className="seg"><button type="button" aria-pressed="false">This stage</button><button type="button" aria-pressed="true">Rest of race</button></div>
    </>
  ));
  const riderPop = (el: HTMLElement, r: MyRider) => openPop(el, (
    <div className="card-r">
      <div className="big"><Flag cc={r.cc} />{r.name}</div>
      <div className="dim">{`${r.type.replace("_", " ")} · ${r.age}`}</div>
      <div className="dim">Opens the rider card, like every rider name in the game.</div>
    </div>
  ));
  const howPop = (el: HTMLElement) => openPop(el, (
    <div className="card-r">
      <div className="big">How tactics work</div>
      <div>Each rider has a plan along the route. Click a step to change the task. The word shows how hard the task is, and tonight&apos;s fatigue follows the hardest step he rides.</div>
      <div className="dim">Full guide in Help.</div>
    </div>
  ));

  const setEffort = (r: MyRider, k: Effort) => change((d) => { d.effort[`${n}|${r.id}`] = k; delete d.custom[`${n}|${r.id}`]; ensure(d)[r.id] = effortPlan(d, r, k, n); });
  const setPlan = (k: PlanKind) => change((d) => {
    d.kinds[n] = k;
    d.plans[n] = buildPlans(d, n, d.plans[n]);
    for (const r of sortedMy(d, n)) { const key = `${n}|${r.id}`; if (!d.locks[key]) { delete d.effort[key]; delete d.custom[key]; } }
  });
  const sortBy = (k: string) => set((d) => { d.sort = d.sort?.k === k ? { k, d: -d.sort.d } : { k, d: k === "rider" || k === "role" ? 1 : -1 }; });
  const thS = (k: string, l: string, c = "") => (
    <th className={c} aria-sort={s.sort?.k === k ? (s.sort.d > 0 ? "ascending" : "descending") : undefined}>
      <button type="button" className="th" onClick={() => sortBy(k)}>
        {l}
        {s.sort?.k === k && <svg><use href={`#s-${s.sort.d > 0 ? "up" : "dn"}`} /></svg>}
      </button>
    </th>
  );

  const type = p.type;
  const src = !s.kinds[n] || s.kinds[n] === s.std[type] ? "follows your season standard" : "changed for this stage";
  const kind = kindOf(s, n);
  const sameType = STAGES.filter((x) => x !== n && PROFILE[x].type === type && !isDone(x));
  const rows = sortedMy(s, n);
  const leaderName = capt.name.split(" ").slice(-1)[0];

  const stepCells = (r: MyRider) => (
    <>
      {[0, 1, 2].map((i) => {
        const t = plans[r.id][i];
        return (
          <div className="step" key={i}>
            <span className="dim">{legs[i]}</span>
            <button type="button" className="chip" aria-haspopup="dialog" onClick={(e) => stepPop(e.currentTarget, r, i)}>
              {TASK[t][0]} <span className={`word w${TASK[t][1]}`}>{WORD[TASK[t][1]]}</span><Chev />
            </button>
            {i === 2 && t === "attack" && <div className="dim">{attackPoints(n)[s.attack[r.id]]}</div>}
          </div>
        );
      })}
      <div className="step">
        <span className="dim">Extra orders</span>
        <div className="extras">
          {([["breakaway", "Try the break"], ["sprint_train", "Sprint train"]] as [TaskId, string][]).filter(([t]) => canDo(roleOf(s, r, n), t)).map(([t, l]) => (
            <button key={t} type="button" className="chip" aria-pressed={!!s.extra[`${r.id}|${t}`]} onClick={() => change((d) => { d.extra[`${r.id}|${t}`] = !d.extra[`${r.id}|${t}`]; })}>{l}</button>
          ))}
        </div>
      </div>
    </>
  );
  const effortSeg = (r: MyRider) => {
    const key = `${n}|${r.id}`;
    const eff = s.custom[key] ? null : s.effort[key] ?? "normal";
    return (
      <div className="seg" role="group" aria-label={`Effort for ${r.name}`}>
        {([["hard", "Hard"], ["normal", "Normal"], ["easy", "Easy"]] as [Effort, string][]).map(([k, l]) => (
          <button key={k} type="button" aria-pressed={eff === k} onClick={() => setEffort(r, k)}>{l}</button>
        ))}
      </div>
    );
  };
  const lockBtn = (r: MyRider) => {
    const key = `${n}|${r.id}`;
    return (
      <button type="button" className="chip" aria-pressed={!!s.locks[key]} aria-label={`Lock ${r.name}`} onClick={() => set((d) => { d.locks[key] = !d.locks[key]; })}>
        <LockIcon />
      </button>
    );
  };
  const roleChip = (r: MyRider) => (
    <button type="button" className="chip" aria-haspopup="dialog" onClick={(e) => rolePop(e.currentTarget, r)}>
      {ROLE_L[roleOf(s, r, n)] ?? roleOf(s, r, n)} <Chev />
    </button>
  );

  return (
    <div className="tac">
      <RouteCard p={p} attackKm={attackKm} />

      <section className="card">
        <h2>{"Today's plan"} <small>{`one choice for the whole team · ${src}`}</small></h2>
        <div className="plans">
          {PLAN_KINDS.map((x) => (
            <button key={x} type="button" className="plan" aria-pressed={x === kind} onClick={() => setPlan(x)}>
              <b>{planLabel(x, n)}</b>
              <span>{PLAN_TEXT[x]}</span>
            </button>
          ))}
        </div>
        {sameType.length > 0 && (
          <div style={{ marginTop: 8, display: "flex", gap: 10, flexWrap: "wrap", alignItems: "center", fontSize: 12.5 }}>
            <button type="button" className="btn2">{sameType.length === 1 ? `Copy to stage ${sameType[0]}` : `Copy to stages ${sameType.join(", ")}`}</button>
            <span className="dim">{TYPE_LABEL[type]}</span>
          </div>
        )}
      </section>

      <section className="card">
        <div className="status">
          <b>{`Orders for stage ${n}`}</b>
          <div className="seg" style={{ marginLeft: "auto" }} role="group" aria-label="View">
            <button type="button" aria-pressed={!s.details} onClick={() => set((d) => { d.details = false; })}>Simple</button>
            <button type="button" aria-pressed={s.details} onClick={() => set((d) => { d.details = true; })}>All orders</button>
          </div>
          <button type="button" className="btn2" aria-haspopup="dialog" onClick={(e) => howPop(e.currentTarget)}>How tactics work</button>
        </div>
        <div className="teambar">
          <b>The team</b>
          <span className="dim">Chase the break?</span>
          <div className="seg" role="group" aria-label="Chase the break">
            {([["chase", "Chase"], ["neutral", "Judge it on the road"], ["let_go", "Leave it to others"]] as [Chase, string][]).map(([k, l]) => (
              <button key={k} type="button" aria-pressed={s.chase === k} onClick={() => change((d) => { d.chase = k; })}>{l}</button>
            ))}
          </div>
          <span className="dim">{`Reacts if the break threatens ${leaderName}'s GC.`}</span>
        </div>

        {/* computer: tabellen med alle kolonner, ordrer pr. rutedel under hver rytter */}
        <div className="tbl dtac">
          <table data-sortable>
            <thead>
              <tr>
                {thS("rider", "Rider")}{thS("role", "Role")}{thS("rating", "Rating", "n")}{thS("form", "Form", "n")}{thS("match", "Route match", "n")}{thS("fatigue", "Fatigue now", "n")}
                <th>Today</th><th>Effort</th><th>Orders</th><th>Lock</th><th>Tonight</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const key = `${n}|${r.id}`;
                const open = s.details || !!s.open[key];
                const lvl = tonightLevel(s, r, n);
                return [
                  <tr key={r.id} className={s.locks[key] ? "locked" : ""}>
                    <td>
                      <Flag cc={r.cc} />
                      <button type="button" className="hv" aria-label={`Rider card for ${r.name}`} onClick={(e) => riderPop(e.currentTarget, r)}>
                        <svg viewBox="0 0 12 12"><circle cx="6" cy="4" r="2.2" /><path d="M2 11c.6-2.6 2.2-3.8 4-3.8s3.4 1.2 4 3.8" /></svg>
                      </button>
                      <button type="button" className="rn" onClick={(e) => riderPop(e.currentTarget, r)}>{r.name}</button>
                    </td>
                    <td>{roleChip(r)}</td>
                    <td className="n ex">{ratingOf(r)}</td>
                    <td className="n ex">{formOf(r)}</td>
                    <td className="n ex">{matchOf(r, n)}</td>
                    <td className="n ex">{fatigueOf(r)}</td>
                    <td>{say(s, r, n)}</td>
                    <td>{effortSeg(r)}{s.custom[key] && <div className="dim" style={{ marginTop: 2 }}>Custom orders</div>}</td>
                    <td>
                      <button type="button" className="chip" aria-expanded={open} onClick={() => set((d) => { d.open[key] = !d.open[key]; })}>Orders <Chev /></button>
                    </td>
                    <td>{lockBtn(r)}</td>
                    <td><span className={`word w${lvl}`}>{TONIGHT[lvl]}</span></td>
                  </tr>,
                  open && (
                    <tr key={`${r.id}-o`} className="ordersrow">
                      <td colSpan={11}><div className="steps">{stepCells(r)}</div></td>
                    </tr>
                  ),
                ];
              })}
            </tbody>
          </table>
        </div>

        {/* telefon: tids-aksen (navn + en kolonne pr. rutedel), tryk aabner rytterens kort */}
        <div className="mtac">
          <div className="mhead">
            <span>Rider</span>
            {legs.map((l) => <span key={l}>{l.replace(/^To the /, "").replace(/^To /, "")}</span>)}
          </div>
          {rows.map((r) => {
            const key = `${n}|${r.id}`;
            const open = s.mopen === r.id;
            const lvl = tonightLevel(s, r, n);
            const parts = r.name.split(" ");
            const sn = `${parts[0][0]}. ${parts.slice(1).join(" ")}`;
            return (
              <div key={r.id}>
                <button type="button" className="mrow" aria-expanded={open} onClick={() => set((d) => { d.mopen = d.mopen === r.id ? null : r.id; })}>
                  <span className="mn">
                    <b><Flag cc={r.cc} />{sn}</b>
                    <span className="dim">
                      {`${ROLE_L[roleOf(s, r, n)] ?? ""} · `}<span className={`word w${lvl}`}>{TONIGHT[lvl]}</span>{s.locks[key] ? " · locked" : ""}
                    </span>
                  </span>
                  {plans[r.id].map((t, i) => (
                    <span key={i} className={`mt word w${TASK[t][1]}`}>
                      {SHORT[t]}
                      {i === 2 && t === "attack" && <span className="dim" style={{ display: "block", fontWeight: 400 }}>{attackPoints(n)[s.attack[r.id]]}</span>}
                    </span>
                  ))}
                </button>
                {open && (
                  <div className="mcard">
                    <div className="ex">{`Rating ${ratingOf(r)} · form ${formOf(r)} · route match ${matchOf(r, n)} · fatigue now ${fatigueOf(r)}`}</div>
                    <div className="row2">{effortSeg(r)}{roleChip(r)}{lockBtn(r)}</div>
                    <div className="steps">{stepCells(r)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="legend">
          <span>Cost: <b className="word w1">Easy</b> · <b className="word w2">Medium</b> · <b className="word w3">Hard</b> · <b className="word w4">Very hard</b></span>
          <span>Tonight: Fresh · OK · Tired · Very tired</span>
          <span className="ex">Grey italic numbers are examples (private).</span>
          <span>Click a column to sort. A locked rider keeps his plan when you change the team plan.</span>
        </div>
        <div className="foot">
          <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
            {s.confirmed ? <><span className="badge good">Saved</span> You can still change it until 16:55.</>
              : s.touched ? <><span className="badge warn">Not saved</span> You have unsaved changes</>
                : <><span className="badge warn">Not saved</span> If you do nothing, they ride exactly this</>}
          </span>
          <span style={{ display: "flex", gap: 8 }}>
            <button type="button" className="btn2">{`Copy to stage ${n + 1}`}</button>
            <button type="button" className="gold" onClick={() => set((d) => { d.confirmed = true; d.touched = false; })}>{s.confirmed ? "Saved" : `Save stage ${n}`}</button>
          </span>
        </div>
      </section>

      {pop && createPortal(
        <div className="twf-pop" role="dialog" style={{ left: pop.x, top: pop.y }}>{pop.body}</div>,
        document.body,
      )}
    </div>
  );
}
