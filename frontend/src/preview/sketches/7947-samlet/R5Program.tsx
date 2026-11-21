// #7947 retning 5, fanen Program: ejerens to godkendte wireframes fra 17/11
// (#7456, "Training plan · Rotation" og "Training plan · Week blocks"), tegnet
// saa taet som kommentarens beskrivelse tillader. Det, beskrivelsen ikke siger
// noget om, er IKKE tegnet; det staar som spoergsmaal til ejeren i PR'en.
// Faelles: vaelgeren Week blocks | Rotation, "Copy to riders" og sidens ene
// guldknap "Save plan" (de to sidste staar i sidehovedet, R5.tsx).

import { useState } from "react";
import { Segmented } from "../../../components/ui/Segmented.jsx";
import { ChevronDownIcon, GripVerticalIcon, LockIcon } from "../../../components/ui/icons/index.jsx";
import type { Session } from "./model.ts";
import { EFFORT_TONE, EFFORT_WORD, effortOf, fillRotation, type WeekCell } from "./r5model.ts";
import { BLOCKS, DATES, FOLLOWERS, ROTATION, SESSION_EN, SESSION_SHORT_EN, TEAM } from "./r5data.ts";
import { RiderName } from "./R5Parts.tsx";

const WEEK = ["Mon 16", "Tue 17", "Wed 18", "Thu 19", "Fri 20", "Sat 21", "Sun 22"];
const WEEKDAY = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function SessionChip({ session, n, compact = false }: { session: Session; n?: number; compact?: boolean }) {
  const effort = effortOf(session);
  if (compact) {
    return (
      <span className="flex min-h-11 min-w-0 flex-col rounded-cz border border-cz-border bg-cz-card px-1 py-0.5">
        {n !== undefined && <span className="text-end font-data text-3xs leading-none tabular-nums text-cz-3" aria-label={`Rotation number ${n}`}>{n}</span>}
        <span className="truncate text-3xs leading-tight text-cz-1">{SESSION_SHORT_EN[session]}</span>
        <span className={`truncate text-3xs leading-tight ${EFFORT_TONE[effort]}`}>{EFFORT_WORD[effort]}</span>
      </span>
    );
  }
  return (
    <span className="relative flex min-h-11 min-w-0 flex-col justify-center rounded-cz border border-cz-border bg-cz-card px-2 py-1">
      {n !== undefined && (
        <span className="absolute end-1 top-0.5 font-data text-3xs tabular-nums text-cz-3" aria-label={`Rotation number ${n}`}>{n}</span>
      )}
      <span className="truncate pe-4 text-xs text-cz-1">{SESSION_EN[session]}</span>
      <span className={`truncate text-3xs ${EFFORT_TONE[effort]}`}>{EFFORT_WORD[effort]}</span>
    </span>
  );
}

function WeekGrid({ week, mobile }: { week: WeekCell[][]; mobile: boolean }) {
  return (
    <div className="grid grid-cols-7 gap-1">
      {WEEK.map((d) => (
        <div key={d} className="pb-0.5 text-center font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">{mobile ? d.slice(0, 3) : d}</div>
      ))}
      {[0, 1, 2, 3, 4].map((field) =>
        week.map((day, d) => {
          const c = day[field];
          if (c.kind === "race") {
            return (
              <span key={`${d}-${field}`} className={`flex items-center justify-center gap-1 rounded-cz bg-cz-1 px-1 text-cz-card ${mobile ? "min-h-10" : "min-h-11"}`}
                role="img" aria-label={`${WEEKDAY[d]}, field ${field + 1}: race, fixed field`}>
                <LockIcon size={11} aria-hidden="true" className="shrink-0" />
                {!mobile && <span className="truncate text-3xs font-semibold">{c.label}</span>}
              </span>
            );
          }
          if (c.kind === "restDay") {
            return (
              <span key={`${d}-${field}`} className={`flex items-center justify-center rounded-cz border border-dashed border-cz-border px-1 text-3xs text-cz-3 ${mobile ? "min-h-10" : "min-h-11"}`}>
                Rest day
              </span>
            );
          }
          return <SessionChip key={`${d}-${field}`} session={c.session} n={c.n} compact={mobile} />;
        }),
      )}
    </div>
  );
}

function Rotation({ mobile }: { mobile: boolean }) {
  const [riderId, setRiderId] = useState("r4");
  const results = FOLLOWERS.map((f) => ({
    ...f,
    rider: TEAM.find((r) => r.id === f.id)!,
    ...fillRotation(ROTATION, f.start, f.blocked, (d) => DATES[d - 1]?.event ?? "Race"),
  }));
  const current = results.find((r) => r.id === riderId)!;
  const label = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";

  return (
    <div className="flex flex-col gap-5">
      <section>
        <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
          <h3 className={label}>Rotation · {ROTATION.length} sessions in fixed order</h3>
          <span className="text-xs text-cz-2">A race or a rest day never skips a session. The rotation waits and continues in the next free field.</span>
        </div>
        <ol className={`grid gap-1 ${mobile ? "grid-cols-2" : "grid-cols-7"}`}>
          {ROTATION.map((s, i) => (
            <li key={i} className="flex min-w-0 items-center gap-1.5 rounded-cz border border-cz-border bg-cz-card px-1.5 py-1">
              <span className="w-5 shrink-0 text-end font-data text-2xs tabular-nums text-cz-3">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-xs text-cz-1">{mobile ? SESSION_SHORT_EN[s] : SESSION_EN[s]}</span>
              <span className={`shrink-0 text-3xs ${EFFORT_TONE[effortOf(s)]}`}>{EFFORT_WORD[effortOf(s)]}</span>
            </li>
          ))}
        </ol>
      </section>

      <section>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <h3 className={label}>Week for</h3>
          <span className="relative">
            <select value={riderId} onChange={(e) => setRiderId(e.target.value)} aria-label="Week for rider"
              className="appearance-none rounded-cz border border-cz-border bg-cz-card py-1 pe-7 ps-2 text-xs text-cz-1 max-sm:min-h-11">
              {results.map((r) => <option key={r.id} value={r.id}>{r.rider.name}</option>)}
            </select>
            <ChevronDownIcon size={12} aria-hidden="true" className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-cz-3" />
          </span>
          <span className="text-xs text-cz-2">Races stay in their fixed fields. The number in the corner is the session's place in the rotation.</span>
        </div>
        <WeekGrid week={current.week} mobile={mobile} />
      </section>

      <section>
        <h3 className={`${label} mb-2`}>Same rotation, own place per rider</h3>
        {mobile ? (
          <ul className="rounded-cz border border-cz-border">
            {results.map((r) => (
              <li key={r.id} className="border-t border-cz-border px-3 py-2 first:border-t-0">
                <RiderName rider={r.rider} />
                <div className="mt-1 font-data text-2xs tabular-nums text-cz-2">
                  {r.races.length} race {r.races.length === 1 ? "field" : "fields"} · {r.ridden} ridden · {r.carried} carried over · next week #{r.nextStart}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <table className="w-full table-fixed rounded-cz border border-cz-border text-xs" data-sort-exempt="skitse: tre ryttere i rotationens raekkefoelge">
            <thead>
              <tr className="border-b border-cz-border">
                {["Rider", "Races this week", "Race fields", "Sessions ridden", "Carried over", "Next week starts at"].map((h, i) => (
                  <th key={h} className={`px-3 py-2 font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3 ${i === 0 ? "w-[240px] text-start" : "text-end"}`}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {results.map((r) => (
                <tr key={r.id} className="border-t border-cz-border">
                  <td className="px-3 py-[7px]"><RiderName rider={r.rider} /></td>
                  <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">{new Set(r.races).size}</td>
                  <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">{r.races.length}</td>
                  <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">{r.ridden}</td>
                  <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">{r.carried}</td>
                  <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">#{r.nextStart}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <p className="text-xs text-cz-2">
        <span className="font-semibold text-cz-1">Fatigue limit:</span> team rule, with exceptions per rider. Above the limit the rest of the day becomes active recovery, and the rotation waits.
      </p>
    </div>
  );
}

// Ejer 19/11 spm. 8: ?locks=many viser flere laaste pas pr. dag (tirsdag 3, torsdag alle 5).
const MANY_LOCKS = new URLSearchParams(window.location.search).get("locks") === "many";
const LOCKS_MANY: Record<number, number[]> = { 1: [0, 1, 2], 3: [0, 1, 2, 3, 4] };
const isLocked = (b: { locked: number | null }, d: number, i: number) => (MANY_LOCKS && LOCKS_MANY[d] ? LOCKS_MANY[d].includes(i) : b.locked === i);

function WeekBlocks({ mobile }: { mobile: boolean }) {
  return (
    <div className="flex flex-col gap-3">
      <p className="text-xs text-cz-2">
        Each day has its own order. Races take the lowest priority first. Lock one session per day so a race never takes it; it moves to a free field. Sessions taken by a race are not made up.
      </p>
      <div className={`grid gap-2 ${mobile ? "grid-cols-2" : "grid-cols-7"}`}>
        {BLOCKS.map((b, d) => (
          <section key={d} className="rounded-cz border border-cz-border bg-cz-card" aria-label={`${WEEKDAY[d]} block`}>
            <header className="flex items-center justify-between gap-1 border-b border-cz-border px-2 py-1.5">
              <span className="text-xs font-semibold text-cz-1">{WEEKDAY[d]}</span>
              <button type="button" aria-label={`Drag ${WEEKDAY[d]}`} className="flex h-7 w-7 cursor-grab items-center justify-center rounded-cz text-cz-3 hover:bg-cz-subtle max-sm:h-11 max-sm:w-11">
                <GripVerticalIcon size={14} aria-hidden="true" />
              </button>
            </header>
            <ol className="flex flex-col">
              {b.sessions.map((s, i) => (
                <li key={i} className="flex items-center gap-1.5 border-t border-cz-border px-2 py-1.5 first:border-t-0">
                  <span className="w-3 shrink-0 font-data text-2xs tabular-nums text-cz-3">{i + 1}</span>
                  <span className="min-w-0 flex-1">
                    <span className={`block truncate text-xs ${isLocked(b, d, i) ? "font-semibold text-cz-1" : "text-cz-1"}`}>{SESSION_EN[s]}</span>
                    <span className={`block text-3xs ${EFFORT_TONE[effortOf(s)]}`}>{EFFORT_WORD[effortOf(s)]}</span>
                  </span>
                  {isLocked(b, d, i) && <LockIcon size={12} aria-label="Locked: a race never takes it" className="shrink-0 text-cz-1" />}
                </li>
              ))}
            </ol>
            {MANY_LOCKS && d === 3 && (
              <p className="border-t border-cz-border px-2 py-1.5 text-3xs text-cz-warning">All 5 locked. A race on Thursday has no free field.</p>
            )}
          </section>
        ))}
      </div>
      <p className="text-2xs text-cz-3">Priority 1 is the most important session of the day. Drag a day block to move it.</p>
    </div>
  );
}

export default function ProgramTab({ mode: initialMode, mobile }: { mode: "week" | "rotation"; mobile: boolean }) {
  const [mode, setMode] = useState(initialMode);
  const followers = mode === "rotation" ? ["Gabriele Moretti", "Lachlan Sutton", "Óscar Bermúdez"] : ["Henok Nguse", "Zhi Deng", "Zhen Qian", "Jiwoo Hong"];
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card p-5 max-sm:p-4">
      <header className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-2">
        <h2 className="text-[15px] font-semibold text-cz-1">Training plan · {mode === "rotation" ? "Ardennes" : "Team week"}</h2>
        <Segmented label="Plan type" value={mode} onChange={(v: "week" | "rotation") => setMode(v)}
          options={[{ value: "week", label: "Week blocks" }, { value: "rotation", label: "Rotation" }]} />
        <span className="text-xs text-cz-2 sm:ms-auto">Followed by {followers.join(", ")}</span>
      </header>
      {mode === "rotation" ? <Rotation mobile={mobile} /> : <WeekBlocks mobile={mobile} />}
    </section>
  );
}
