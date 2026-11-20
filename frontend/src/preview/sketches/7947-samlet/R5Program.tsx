// #7456/#7947 retning 5, fanen Program (ejer 20/11). Specifikationen er ejerens
// to wireframes fra 17/11 ("Training plan · Week blocks" og "· Rotation") plus
// beslutningerne paa #7456: fanen starter i Week blocks og husker spillerens
// sidste valg; programmer ligger i et bibliotek og saettes kun paa en gruppe
// eller en rytter (intet holdprogram); rytterens egen plan vinder over
// gruppens; "No program" faar ingen advarsel; traethedsgraensen vinder over
// laasen; et loeb koerer altid; eet laast pas pr. dag.
// "Copy to riders" og sidens ene guldknap "Save plan" staar i sidehovedet (R5.tsx).
// Telefon: tre muligheder for ugeskemaet via ?phone=a|b|c (A er standard).

import { useState } from "react";
import { Segmented } from "../../../components/ui/Segmented.jsx";
import Toggle from "../../../components/ui/Toggle.jsx";
import {
  ChevronDownIcon, ClipboardIcon, FlameIcon, GripVerticalIcon, LockIcon, PlusIcon, TeamIcon, UserIcon, XIcon,
} from "../../../components/ui/icons/index.jsx";
import { ROTATION, SESSION_EN } from "./r5data.ts";
import { RiderName } from "./R5Parts.tsx";
import {
  CODE, CellBody, DAYS, DAY_BLOCKS, FATIGUE_LIMIT, FIELDS, FIELD_TIME, GROUPS, KindIcon, LABEL, LIBRARY,
  LimitLine, PhoneDayAtATime, PhoneGrid, PhoneWeekList, ROTATION_RIDERS, TODAY, TonightPlate,
  cellTone, programOf, riderById, rotationView, usersOf, weekBlocksView, type Kind, type WeekView,
} from "./R5ProgramParts.tsx";

const Q = new URLSearchParams(window.location.search);
const PHONE = (["a", "b", "c"] as const).find((p) => p === Q.get("phone")) ?? "a";
const PHONE_DAY = Math.max(0, Math.min(6, Number(Q.get("pday") ?? TODAY) || 0));
const SHEET = Q.get("sheet") === "1" ? { d: PHONE_DAY, f: 4 } : null;
const STORE = "cz-training-program-view";

// Ejer 19/11: et nyt program starter i Week blocks, og visningen husker spillerens sidste valg.
function rememberedKind(fromUrl: Kind): Kind {
  if (Q.has("mode")) return fromUrl;
  try { return localStorage.getItem(STORE) === "rotation" ? "rotation" : "week"; } catch { return "week"; }
}
function remember(kind: Kind) {
  try { localStorage.setItem(STORE, kind); } catch { /* privat vindue: valget huskes bare ikke */ }
}

// --- Biblioteket ----------------------------------------------------------------

function Library({ selected, onSelect }: { selected: string; onSelect: (id: string) => void }) {
  const noProgram = ["r1", "r2", "r3", "r4", "r5", "r6", "r7", "r8", "r9"].filter((id) => !programOf(id).program);
  const ownOnly = ["r9"]; // ryttere uden gruppe, men med egen plan
  return (
    <aside className="flex flex-col gap-4" aria-label="Program library" data-mark="library">
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className={LABEL}>Programs</h3>
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1">
            <PlusIcon size={13} aria-hidden="true" />New
          </button>
        </div>
        <ul className="flex flex-col gap-1">
          {LIBRARY.map((p) => {
            const u = usersOf(p.id);
            const on = [...u.groups.map((g) => g.group.name), ...u.riders.map((id) => riderById(id).name)];
            const active = p.id === selected;
            return (
              <li key={p.id}>
                <button type="button" aria-pressed={active} onClick={() => onSelect(p.id)}
                  className={`w-full rounded-cz border px-3 py-2 text-start ${active ? "border-cz-accent/50 bg-cz-accent/10" : "border-cz-border bg-cz-card hover:bg-cz-subtle"}`}>
                  <span className="flex items-center gap-1.5">
                    <KindIcon kind={p.kind} />
                    <span className={`text-[13px] font-semibold ${active ? "text-cz-accent-t" : "text-cz-1"}`}>{p.name}</span>
                  </span>
                  <span className="mt-0.5 block text-2xs text-cz-2">{p.kind === "week" ? "Week blocks" : "Rotation"} · {p.detail}</span>
                  <span className="mt-0.5 block truncate text-2xs text-cz-3">On: {on.join(", ")}</span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className={LABEL}>Groups and riders</h3>
          <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1">
            <PlusIcon size={13} aria-hidden="true" />Group
          </button>
        </div>
        <ul className="rounded-cz border border-cz-border bg-cz-card text-xs">
          {GROUPS.map((g) => (
            <li key={g.id} className="border-t border-cz-border px-3 py-2 first:border-t-0">
              <span className="flex items-center gap-1.5">
                <TeamIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
                <span className="font-semibold text-cz-1">{g.name}</span>
                <span className="ms-auto text-cz-2">{LIBRARY.find((p) => p.id === g.program)!.name}</span>
              </span>
              <ul className="mt-1 flex flex-col gap-0.5 ps-5">
                {g.riders.map((id) => {
                  const own = programOf(id).via === "own";
                  return (
                    <li key={id} className="flex items-center justify-between gap-2 text-2xs">
                      <span className="truncate text-cz-2">{riderById(id).name}</span>
                      {own && <span className="shrink-0 text-cz-1">Own plan: {programOf(id).program!.name}</span>}
                    </li>
                  );
                })}
              </ul>
            </li>
          ))}
          {ownOnly.map((id) => (
            <li key={id} className="flex items-center gap-1.5 border-t border-cz-border px-3 py-2">
              <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
              <span className="truncate text-cz-1">{riderById(id).name}</span>
              <span className="ms-auto shrink-0 text-cz-2">Own plan: {programOf(id).program!.name}</span>
            </li>
          ))}
          {noProgram.map((id) => (
            <li key={id} className="flex items-center gap-1.5 border-t border-cz-border px-3 py-2" data-mark="noprogram">
              <UserIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
              <span className="truncate text-cz-2">{riderById(id).name}</span>
              <span className="ms-auto shrink-0 text-cz-3">No program</span>
            </li>
          ))}
        </ul>
        <p className="mt-1.5 text-2xs text-cz-3">A rider's own plan wins over the group's.</p>
      </section>
    </aside>
  );
}

// --- Editorens hoved: hvem programmet sidder paa ---------------------------------

function AppliedTo({ programId }: { programId: string }) {
  const u = usersOf(programId);
  const chip = "inline-flex h-7 items-center gap-1 rounded-cz border border-cz-border bg-cz-card ps-2 pe-1 text-xs text-cz-1";
  return (
    <div className="flex flex-wrap items-center gap-1.5" data-mark="applied">
      <span className="text-xs text-cz-2">On</span>
      {u.groups.map(({ group, following }) => (
        <span key={group.id} className={chip}>
          <TeamIcon size={12} aria-hidden="true" className="text-cz-3" />{group.name}
          <span className="font-data tabular-nums text-cz-3">{following.length}</span>
          <button type="button" aria-label={`Remove ${group.name}`} className="inline-flex h-6 w-6 items-center justify-center rounded-cz text-cz-3 hover:text-cz-1"><XIcon size={11} /></button>
        </span>
      ))}
      {u.riders.map((id) => (
        <span key={id} className={chip}>
          <UserIcon size={12} aria-hidden="true" className="text-cz-3" />{riderById(id).name}
          <button type="button" aria-label={`Remove ${riderById(id).name}`} className="inline-flex h-6 w-6 items-center justify-center rounded-cz text-cz-3 hover:text-cz-1"><XIcon size={11} /></button>
        </span>
      ))}
      <button type="button" className="inline-flex h-7 items-center gap-1 rounded-cz border border-dashed border-cz-border px-2 text-xs text-cz-2 hover:text-cz-1">
        <PlusIcon size={12} aria-hidden="true" />Group or rider
      </button>
    </div>
  );
}

function FatigueBar({ kind, lockOn, onLock }: { kind: Kind; lockOn: boolean; onLock: (v: boolean) => void }) {
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-cz border border-cz-border bg-cz-card px-4 py-2.5 text-xs" data-mark="fatigue">
      <FlameIcon size={14} aria-hidden="true" className="shrink-0 text-cz-3" />
      <span className="min-w-0 flex-1 text-cz-2">
        <span className="font-semibold text-cz-1">Fatigue limit {FATIGUE_LIMIT}:</span> team rule, with exceptions per rider. Over the limit the rest of the day becomes
        {" "}<button type="button" className="inline-flex items-center gap-0.5 font-medium text-cz-1 underline decoration-cz-border underline-offset-2">active recovery<ChevronDownIcon size={11} aria-hidden="true" /></button>
        {kind === "rotation" ? " and the rotation waits." : ", even a locked session."}
      </span>
      {kind === "rotation" ? (
        <Toggle id="rot-lock" label="Locked daily session" checked={lockOn} onChange={(e: { target: { checked: boolean } }) => onLock(e.target.checked)} />
      ) : (
        <a href="#day" className="shrink-0 text-cz-2 hover:text-cz-1">Same rule as on Day</a>
      )}
    </div>
  );
}

// --- Ugen for een rytter (begge typer) -----------------------------------------

function WeekGrid({ view, kind }: { view: WeekView; kind: Kind }) {
  return (
    <div className="overflow-hidden rounded-cz border border-cz-border" data-mark="weekgrid">
      <div className="grid grid-cols-[52px_repeat(7,minmax(0,1fr))]">
        <span className="border-b border-cz-border bg-cz-subtle" />
        {DAYS.map((x, d) => {
          const races = view.cells[d].filter((c) => c.kind === "race").length;
          return (
            <div key={x.short} className="border-b border-s border-cz-border bg-cz-subtle px-2.5 py-1.5">
              <span className="flex items-center gap-1 text-xs font-semibold text-cz-1">
                {x.short} {x.date}
                {d === TODAY && <span className="inline-flex items-center gap-0.5 font-normal text-cz-2" title="Today's fields lock after Train now; changes then apply from tomorrow"><LockIcon size={10} aria-hidden="true" />Today</span>}
              </span>
              <span className="block text-3xs text-cz-2">{races ? `${races} race${races > 1 ? "s" : ""}` : "No races"}</span>
            </div>
          );
        })}
        {FIELDS.map((f) => (
          <Row key={f} f={f} view={view} />
        ))}
        <span className="flex items-center border-t border-cz-border px-2 font-data text-3xs uppercase tracking-[.06em] text-cz-3">{kind === "week" ? "Taken" : ""}</span>
        {DAYS.map((x, d) => (
          <div key={x.short} className="flex items-center justify-between gap-2 border-s border-t border-cz-border px-2.5 py-1.5 text-3xs text-cz-2" data-mark={d === 3 ? "tonight" : undefined}>
            <span className="min-w-0 truncate">
              {kind === "week"
                ? (view.taken[d].length ? view.taken[d].map((s) => SESSION_EN[s]).join(", ") : "All ridden")
                : ""}
            </span>
            <span className="inline-flex shrink-0 items-center gap-1">Tonight <TonightPlate value={view.fatigueTonight[d]} /></span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Row({ f, view }: { f: number; view: WeekView }) {
  return (
    <>
      <span className="flex flex-col justify-center border-t border-cz-border px-2 font-data text-3xs tabular-nums text-cz-3">
        <span className="font-semibold text-cz-2">LD {f + 1}</span>{FIELD_TIME[f]}
      </span>
      {DAYS.map((x, d) => {
        const c = view.cells[d][f];
        const lineBelow = view.limitAfter[d] === f;
        return (
          <div key={x.short} className={`relative min-h-[50px] border-s border-t border-cz-border px-2.5 py-1.5 ${cellTone(c)}`}
            data-mark={c.kind === "session" && c.locked && c.movedFrom !== undefined && d === 0 ? "moved" : c.kind === "session" && c.limitedFrom ? "limited" : undefined}>
            {c.kind === "session" && c.n !== undefined && (
              <span className="absolute end-1.5 top-1 font-data text-3xs tabular-nums text-cz-3" aria-label={`Rotation number ${c.n}`}>#{c.n}</span>
            )}
            <CellBody cell={c} field={f} />
            {lineBelow && <span className="absolute inset-x-0 -bottom-px z-10 border-b-2 border-dashed border-cz-danger" aria-hidden="true" />}
          </div>
        );
      })}
    </>
  );
}

// --- Week blocks: dagblokkene ----------------------------------------------------

function DayBlocks({ view }: { view: WeekView }) {
  return (
    <section data-mark="dayblocks">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={LABEL}>Day blocks</h3>
        <span className="text-2xs text-cz-2">Drag to reorder · tap a session to change it · one locked session per day (optional)</span>
      </div>
      <div className="grid grid-cols-7 gap-2">
        {DAY_BLOCKS.map((b, d) => {
          const taken = new Set<number>();
          const n = view.taken[d].length;
          for (let i = b.prio.length - n; i < b.prio.length; i += 1) taken.add(i);
          return (
            <section key={d} className="rounded-cz border border-cz-border bg-cz-card" aria-label={`${DAYS[d].long} block`}>
              <header className="flex items-center gap-1 border-b border-cz-border px-2 py-1">
                <span className="flex-1 text-xs font-semibold text-cz-1">{DAYS[d].short}</span>
                <button type="button" aria-label={`Copy ${DAYS[d].long} to other days`} title="Copy day" className="inline-flex h-7 w-7 items-center justify-center rounded-cz text-cz-3 hover:bg-cz-subtle hover:text-cz-1" data-mark={d === 0 ? "copyday" : undefined}>
                  <ClipboardIcon size={13} />
                </button>
                <button type="button" aria-label={`Drag ${DAYS[d].long}`} className="inline-flex h-7 w-7 cursor-grab items-center justify-center rounded-cz text-cz-3 hover:bg-cz-subtle">
                  <GripVerticalIcon size={13} />
                </button>
              </header>
              <ol>
                {b.locked && (
                  <li className="flex min-h-8 items-center gap-1.5 px-2 text-xs">
                    <LockIcon size={11} aria-label="Locked" className="shrink-0 text-cz-accent-t" />
                    <button type="button" className="min-w-0 flex-1 truncate text-start font-medium text-cz-1">{SESSION_EN[b.locked]}</button>
                  </li>
                )}
                {b.prio.map((s, i) => (
                  <li key={i} className="flex min-h-8 items-center gap-1.5 border-t border-cz-border px-2 text-xs">
                    <span className="w-2.5 shrink-0 font-data text-2xs tabular-nums text-cz-3">{i + 1}</span>
                    <button type="button" className={`min-w-0 flex-1 truncate text-start ${taken.has(i) ? "text-cz-3 line-through" : "text-cz-1"}`}>{SESSION_EN[s]}</button>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
      <p className="mt-1.5 text-2xs text-cz-3">Crossed out = taken by a race this week. In Week blocks, sessions taken by races are not made up. Switch to Rotation to carry them over.</p>
    </section>
  );
}

// --- Rotation: baandet og tabellen ---------------------------------------------------

function RotationStrip({ riderId }: { riderId: string }) {
  const me = ROTATION_RIDERS.find((r) => r.id === riderId)!;
  const ridden = new Set<number>();
  for (const day of me.week) for (const c of day) if (c.kind === "session") ridden.add(c.n);
  const starts = new Map(ROTATION_RIDERS.map((r) => [r.nextStart, r.rider.name.split(" ").slice(-1)[0]]));
  return (
    <section data-mark="strip">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={LABEL}>Rotation · {ROTATION.length} sessions</h3>
        <span className="text-2xs text-cz-2">Sessions run in this order. A race or rest day never skips one, it waits.</span>
      </div>
      <ol className="grid grid-cols-[repeat(35,minmax(0,1fr))] gap-0.5 pt-4">
        {ROTATION.map((s, i) => {
          const n = i + 1;
          const who = starts.get(n);
          return (
            <li key={i} className={`relative flex flex-col items-center rounded-cz border py-1 ${who ? "border-cz-accent-t" : "border-cz-border"} ${ridden.has(n) ? "bg-cz-subtle" : "bg-cz-card"}`}
              title={`${n}. ${SESSION_EN[s]}`}>
              {who && <span className="absolute -top-4 whitespace-nowrap text-3xs font-semibold text-cz-accent-t">{who}</span>}
              <span className="font-data text-3xs font-semibold text-cz-1">{CODE[s]}</span>
              <span className="font-data text-3xs tabular-nums text-cz-3">{n}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-1.5 text-2xs text-cz-3">
        Grey = ridden this week by {riderById(riderId).name} · gold frame = where each rider starts next week · EN Endurance · TE Tempo · VP VO2max (punch) · AT Attack repeats · TQ Technique · TH Threshold · RC Race craft · AR Active recovery · RE Rest
      </p>
    </section>
  );
}

function RotationTable() {
  return (
    <section data-mark="perrider">
      <div className="mb-1.5 flex flex-wrap items-baseline justify-between gap-2">
        <h3 className={LABEL}>Same rotation, own place per rider</h3>
        <span className="text-2xs text-cz-2">Riders on one program can race different calendars</span>
      </div>
      <table className="w-full table-fixed rounded-cz border border-cz-border text-xs" data-sort-exempt="skitse: tre ryttere i rotationens raekkefoelge">
        <thead>
          <tr className="border-b border-cz-border">
            {["Rider", "Racing this week", "Race fields", "Sessions ridden", "Carried over", "Next week starts at"].map((h, i) => (
              <th key={h} className={`px-3 py-2 font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3 ${i === 0 ? "w-[220px] text-start" : i === 1 ? "text-start" : "text-end"}`}>{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {ROTATION_RIDERS.map((r) => {
            const races = [...new Set(r.week.flat().filter((c) => c.kind === "race").map((c) => (c.kind === "race" ? c.label : "")))];
            const fields = r.week.flat().filter((c) => c.kind === "race").length;
            return (
              <tr key={r.id} className="border-t border-cz-border">
                <td className="px-3 py-[7px]"><RiderName rider={r.rider} /></td>
                <td className="truncate px-3 py-[7px] text-cz-1">{races.length ? races.join(", ") : <span className="text-cz-3">No races</span>}</td>
                <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">{fields}</td>
                <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">{r.ridden} of {35}</td>
                <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">{r.carried}</td>
                <td className="px-3 py-[7px] text-end font-data tabular-nums text-cz-1">#{r.nextStart} {SESSION_EN[ROTATION[r.nextStart - 1]]}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </section>
  );
}

// --- Fanen ---------------------------------------------------------------------------

const WEEK_RIDERS = ["r1", "r2", "r3", "r9"];

function RiderPicker({ value, options, onChange, full = false }: { value: string; options: string[]; onChange: (v: string) => void; full?: boolean }) {
  return (
    <span className={`relative ${full ? "block" : ""}`}>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label="Week for rider"
        className={`appearance-none rounded-cz border border-cz-border bg-cz-card py-1 pe-7 ps-2 text-xs font-semibold text-cz-1 max-sm:min-h-11 ${full ? "w-full" : ""}`}>
        {options.map((id) => <option key={id} value={id}>{riderById(id).name}</option>)}
      </select>
      <ChevronDownIcon size={12} aria-hidden="true" className="pointer-events-none absolute end-2 top-1/2 -translate-y-1/2 text-cz-3" />
    </span>
  );
}

export default function ProgramTab({ mode: urlMode, mobile }: { mode: Kind; mobile: boolean }) {
  const [kind, setKindRaw] = useState<Kind>(() => rememberedKind(urlMode));
  const [programId, setProgramId] = useState(kind === "rotation" ? "ardennes" : "team-week");
  const [weekRider, setWeekRider] = useState("r1");
  const [rotRider, setRotRider] = useState("r4");
  const [lockOn, setLockOn] = useState(false);
  const setKind = (k: Kind) => {
    setKindRaw(k);
    remember(k);
    if (LIBRARY.find((p) => p.id === programId)?.kind !== k) setProgramId(k === "rotation" ? "ardennes" : "team-week");
  };
  const select = (id: string) => { setProgramId(id); const k = LIBRARY.find((p) => p.id === id)!.kind; setKindRaw(k); remember(k); };

  const program = LIBRARY.find((p) => p.id === programId)!;
  const view = kind === "week" ? weekBlocksView() : rotationView(rotRider);
  const rider = kind === "week" ? weekRider : rotRider;
  const riders = kind === "week" ? WEEK_RIDERS : ROTATION_RIDERS.map((r) => r.id);
  const setRider = kind === "week" ? setWeekRider : setRotRider;
  const intro = kind === "week"
    ? "Each day has its own order. One session per day can be locked so races never take it."
    : "One list of sessions in a fixed order. Whatever a race or rest day blocks is carried over, never lost.";

  if (mobile) {
    return (
      <div className="flex flex-col gap-3">
        <div className="flex items-center gap-2">
          <button type="button" className="flex min-h-11 min-w-0 flex-1 items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-start" aria-haspopup="dialog">
            <KindIcon kind={program.kind} />
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold text-cz-1">{program.name}</span>
              <span className="block truncate text-3xs text-cz-2">On: {[...usersOf(program.id).groups.map((g) => g.group.name), ...usersOf(program.id).riders.map((id) => riderById(id).name)].join(", ")}</span>
            </span>
            <ChevronDownIcon size={14} aria-hidden="true" className="shrink-0 text-cz-3" />
          </button>
          <Segmented label="Plan type" value={kind} onChange={(v: Kind) => setKind(v)}
            options={[{ value: "week", label: "Week" }, { value: "rotation", label: "Rotation" }]} />
        </div>
        <p className="flex items-center gap-1.5 text-xs text-cz-2">
          <FlameIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />
          <span><span className="font-semibold text-cz-1">Limit {FATIGUE_LIMIT}</span> · above it the rest of the day is active recovery</span>
        </p>
        <div className="flex items-center justify-between gap-2">
          <RiderPicker value={rider} options={riders} onChange={setRider} />
          <span className="text-right text-3xs text-cz-2">{view.summary}</span>
        </div>
        {PHONE === "a" && <PhoneDayAtATime key={`${kind}-${rider}`} view={view} start={PHONE_DAY} editable={kind === "week"} />}
        {PHONE === "b" && <PhoneWeekList key={`${kind}-${rider}`} view={view} open={PHONE_DAY} />}
        {PHONE === "c" && <PhoneGrid key={`${kind}-${rider}`} view={view} sheet={SHEET} />}
      </div>
    );
  }

  return (
    <div className="grid grid-cols-[256px_minmax(0,1fr)] gap-5">
      <Library selected={programId} onSelect={select} />
      <section className="flex min-w-0 flex-col gap-4">
        <header className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2">
          <div className="min-w-0">
            <h2 className="text-[15px] font-semibold text-cz-1">Training plan · {program.name}</h2>
            <p className="mt-0.5 text-xs text-cz-2">{intro}</p>
          </div>
          <Segmented label="Plan type" value={kind} onChange={(v: Kind) => setKind(v)}
            options={[{ value: "week", label: "Week blocks" }, { value: "rotation", label: "Rotation" }]} />
        </header>
        <AppliedTo programId={programId} />
        <FatigueBar kind={kind} lockOn={lockOn} onLock={setLockOn} />
        {kind === "rotation" && <RotationStrip riderId={rotRider} />}
        <section>
          <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2">
              <h3 className={LABEL}>Week for</h3>
              <RiderPicker value={rider} options={riders} onChange={setRider} />
              <span className="text-2xs text-cz-2">{riderById(rider).type}</span>
            </span>
            <span className="font-data text-xs tabular-nums text-cz-2">{view.summary}</span>
          </div>
          <WeekGrid view={view} kind={kind} />
          <p className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
            <span>Races sit in their fixed fields and always run</span>
            <span className="inline-flex items-center gap-1"><LockIcon size={10} aria-hidden="true" className="text-cz-accent-t" />Locked: never taken by a race, moves to a free field</span>
            <span className="inline-flex w-40 items-center gap-1"><LimitLine label={false} /></span>
            <span>Fatigue limit: the rest of the day follows your choice, even a locked session</span>
            {kind === "rotation" && <span>#n = place in the rotation</span>}
          </p>
        </section>
        {kind === "week" ? <DayBlocks view={view} /> : <RotationTable />}
        <p className="inline-flex items-center gap-1 text-2xs text-cz-3" data-mark="todaylock">
          <LockIcon size={10} aria-hidden="true" />Today's fields lock after Train now. A saved plan then applies from tomorrow.
        </p>
      </section>
    </div>
  );
}
