// #7947 retning 5, fanen Report: rapporten i XP-format (#8210), tegnet efter
// ejerens regler for fanen Day: en linje pr. rytter, navnecellen er kun navnet,
// typen er sin egen sorterbare kolonne, traethed som tal paa plade (#8364), og
// felterne aabner som underraekke. "Optjent i dag" og "udbetalt fra bjaelken"
// holdes adskilt (Fable-dommen paa #8276). Ingen scorer: XP er udviklingen (B11).
// Al tekst er engelsk; alle tal er eksempler (XP er ikke taendt).

import { useMemo, useState } from "react";
import { Segmented } from "../../../components/ui/Segmented.jsx";
import { Dropdown, MenuItem } from "../../../components/ui/Menu.jsx";
import { CheckIcon, ChevronDownIcon, ChevronLeftIcon, ChevronRightIcon, LockIcon } from "../../../components/ui/icons/index.jsx";
import { SESSION_EN, TEAM, type R5Rider } from "./r5data.ts";
import { DEV, POINTS_30, REPORT, REPORT_DAYS, reportXp, devXp30, type DevRow, type ReportRow } from "./r5devdata.ts";
import { EFFORT_TONE, EFFORT_WORD, effortOf } from "./r5model.ts";
import { num, raceShare30, reportSummary, summary30 } from "./r5devmodel.ts";
import { FormPlate } from "../../../components/training/reportXp/XpToday.tsx";
import { Swatch, XpBar } from "../../../components/training/reportXp/XpBar.tsx";
import { FORM, FORM_DELTA, FatiguePlate, PctBar, RiderName, SortHead, Spark, type SortState, TypeCell, FilterWords } from "./R5Parts.tsx";

export type ReportRange = "today" | "30";
type TodayKey = "rider" | "type" | "training" | "race" | "xp" | "points" | "fatigue";
type Key30 = "rider" | "type" | "xp" | "points" | "fromBar" | "race";

const LABEL = "mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3";
const NUM = "font-data text-[13px] tabular-nums";

function PointChip({ ability, fromBar }: { ability: string; fromBar: boolean }) {
  return fromBar ? (
    <span className="inline-flex items-center whitespace-nowrap rounded-cz border border-dashed border-cz-3 px-1.5 py-0.5 text-2xs font-medium text-cz-1" aria-label={`Plus 1 ${ability}, paid out from the bar`}>+1 {ability}</span>
  ) : (
    <span className="inline-flex items-center whitespace-nowrap rounded-cz bg-cz-1 px-1.5 py-0.5 text-2xs font-medium text-cz-card" aria-label={`Plus 1 ${ability}, earned today`}>+1 {ability}</span>
  );
}

function Delta({ n }: { n: number }) {
  return <span className="font-data text-2xs tabular-nums text-cz-2">{n > 0 ? `+${n}` : `${n}`}</span>;
}

function Points({ row }: { row: ReportRow }) {
  if (row.points.length === 0) return <span className="text-xs text-cz-3">No point</span>;
  return <span className="inline-flex flex-wrap gap-1">{row.points.map((p) => <PointChip key={p.ability} {...p} />)}</span>;
}

// Dagens fem felter og hvor XP'en kom fra (underraekken).
function Detail({ rider, row, mobile }: { rider: R5Rider; row: ReportRow; mobile: boolean }) {
  return (
    <div className={`grid gap-6 ${mobile ? "grid-cols-1" : "grid-cols-[minmax(0,280px)_minmax(0,700px)]"}`}>
      <div>
        <div className={LABEL}>Sessions that day</div>
        <ul className="text-xs">
          {row.sessions.map((s, i) => (
            <li key={i} className="grid grid-cols-[20px_1fr_auto] items-center gap-2 border-b border-cz-border py-1.5 last:border-b-0">
              <span className="font-data tabular-nums text-cz-3">{i + 1}</span>
              {s === "stage" ? (
                <>
                  <span className="inline-flex items-center gap-1 font-semibold text-cz-1"><LockIcon size={11} aria-hidden="true" className="shrink-0 text-cz-3" />Race · Stage 2</span>
                  <span className="text-cz-3">Settled</span>
                </>
              ) : (
                <>
                  <span className="truncate text-cz-1">{SESSION_EN[s]}</span>
                  <span className={EFFORT_TONE[effortOf(s)]}>{EFFORT_WORD[effortOf(s)]}</span>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
      <div>
        <div className={LABEL}>XP by ability</div>
        {row.abilities.length === 0 ? (
          <p className="text-xs text-cz-2">
            Rested all day, so no XP was earned. {row.points.map((p) => `${p.ability} landed from the bar`).join(", ")}
            {row.points.length > 0 ? ": XP saved on earlier days already covered the point." : "."}
          </p>
        ) : (
          <ul className="text-xs">
            {row.abilities.map((a) => (
              <li key={a.name} className={`grid items-center gap-x-3 border-b border-cz-border py-1.5 last:border-b-0 ${mobile ? "grid-cols-[1fr_52px_92px]" : "grid-cols-[150px_70px_150px_1fr]"}`}>
                <span className="truncate text-cz-1">{a.name}</span>
                <span className="text-end font-data tabular-nums text-cz-1">+{a.xp} XP</span>
                {SPLIT ? <SplitBar pct={a.pct} xp={a.xp} point={a.point} raceShare={row.race / Math.max(1, row.training + row.race)} /> : <PctBar pct={a.pct} />}
                {!mobile && (
                  <span className="whitespace-nowrap text-2xs text-cz-2">
                    {a.point ? (row.points.find((p) => p.ability === a.name)?.fromBar ? "Point paid out from the bar" : "Point earned today") : ""}
                  </span>
                )}
              </li>
            ))}
          </ul>
        )}
        {SPLIT && (
          <span className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-2">
            <span className="inline-flex items-center gap-1.5"><Swatch part="before" />Before today</span>
            <span className="inline-flex items-center gap-1.5"><Swatch part="training" />Training today</span>
            <span className="inline-flex items-center gap-1.5"><Swatch part="race" />Race today</span>
          </span>
        )}
        <p className="mt-2 text-2xs text-cz-3">{rider.name}: form {(FORM[rider.id] ?? 0) - (FORM_DELTA[rider.id] ?? 0)} to {FORM[rider.id] ?? "—"} from the sessions, fatigue {row.fatigue} after the day.</p>
      </div>
    </div>
  );
}

// Ejer 19/11 spm. 4: ?bars=split viser bjaelken delt i "foer i dag" (graa) og "i dag" (groen).
// Eksempel: prisen for et point saettes til 1.200 XP, saa dagens del = XP / 12 %.
const SPLIT = new URLSearchParams(window.location.search).get("bars") === "split";
function SplitBar({ pct, xp, point, raceShare }: { pct: number; xp: number; point: boolean; raceShare: number }) {
  // Spillets egen rapportbjaelke (XpBar, #7627): foer i dag, traening (fyldt) og loeb (skraveret).
  // Point i dag: bjaelken startede forfra, saa kun resten efter pointet staar.
  const today = Math.min(point ? 100 : pct, Math.round(xp / 12));
  const before = point ? 0 : pct - today;
  const shown = point ? today : pct;
  const race = Math.round(today * raceShare);
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="block w-24 overflow-hidden rounded-cz">
        <XpBar before={before / 100} training={(today - race) / 100} race={race / 100} label={`${shown} percent of the way to the next point`} />
      </span>
      <span className="font-data text-2xs tabular-nums text-cz-2">{shown} %</span>
    </span>
  );
}

export default function ReportTab({ mobile, range, openIds }: { mobile: boolean; range: ReportRange; openIds: string[] }) {
  const [view, setView] = useState<ReportRange>(range);
  const [open, setOpen] = useState<Set<string>>(new Set(openIds));
  const [sort, setSort] = useState<SortState<TodayKey>>({ key: "xp", dir: -1 });
  const [sort30, setSort30] = useState<SortState<Key30>>({ key: "xp", dir: -1 });
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const next = <K extends string>(x: SortState<K>, key: K, text: boolean): SortState<K> =>
    (x?.key === key ? { key, dir: (x.dir * -1) as 1 | -1 } : { key, dir: text ? 1 : -1 });

  const today = useMemo(() => {
    const base = TEAM.map((rider) => ({ rider, row: REPORT.find((r) => r.id === rider.id)! }));
    if (!sort) return base;
    const val = (x: (typeof base)[number]): string | number => ({
      rider: x.rider.name, type: x.rider.type, training: x.row.training, race: x.row.race, xp: reportXp(x.row),
      points: x.row.points.length, fatigue: x.row.fatigue,
    })[sort.key];
    return [...base].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [sort]);

  const days = useMemo(() => {
    const base = TEAM.map((rider) => ({ rider, dev: DEV.find((d) => d.id === rider.id) as DevRow }));
    if (!sort30) return base;
    const val = (x: (typeof base)[number]): string | number => ({
      rider: x.rider.name, type: x.rider.type, xp: devXp30(x.dev), points: POINTS_30[x.rider.id].points,
      fromBar: POINTS_30[x.rider.id].fromBar, race: raceShare30(x.rider.id),
    })[sort30.key];
    return [...base].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort30.dir);
  }, [sort30]);

  const s = reportSummary();
  const s30 = summary30();
  const selected = 5;
  const first = Math.max(0, selected - 1);
  const visible = mobile ? [first, first + 1, first + 2] : REPORT_DAYS.map((_, i) => i);

  // Dagspilene bag i tiden, samme moenster som dagsvaelgeren paa fanen Day.
  const dayStrip = (
    <div className="mb-3 flex items-stretch gap-1" role="group" aria-label="Choose day">
      <button type="button" aria-label="Previous day" className="flex min-h-11 min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2">
        <ChevronLeftIcon size={16} aria-hidden="true" />
      </button>
      <div className="grid flex-1 gap-1" style={{ gridTemplateColumns: `repeat(${visible.length}, minmax(0, 1fr))` }}>
        {visible.map((i) => {
          const d = REPORT_DAYS[i];
          const active = i === selected;
          return (
            <button key={i} type="button" aria-current={active ? "date" : undefined}
              className={`min-w-0 rounded-cz border px-2 py-1.5 text-start ${active ? "border-cz-1 bg-cz-card" : "border-cz-border bg-cz-card hover:border-cz-3"}`}>
              <span className={`block font-data text-xs tabular-nums ${active ? "font-bold text-cz-1" : "text-cz-2"}`}>{d.points === null ? "Today" : `${d.short} ${d.day}`}</span>
              <span className={`block truncate text-3xs ${d.points === null ? "text-cz-3" : "text-cz-2"}`}>
                {d.points === null ? mobile ? "Open" : "Settles tonight" : <><span className="font-data font-semibold tabular-nums text-cz-1">+{d.points}</span> points</>}
              </span>
            </button>
          );
        })}
      </div>
      <button type="button" aria-label="Next day" disabled className="flex min-h-11 min-w-11 items-center justify-center rounded-cz border border-cz-border bg-cz-card text-cz-2 disabled:opacity-40">
        <ChevronRightIcon size={16} aria-hidden="true" />
      </button>
    </div>
  );

  const columnsMenu = (
    <Dropdown
      trigger={({ open: o, toggle: t }: { open: boolean; toggle: () => void }) => (
        <button type="button" onClick={t} aria-expanded={o} aria-haspopup="menu"
          className="inline-flex items-center gap-1.5 rounded-cz border border-cz-border px-2 py-1 text-xs font-medium text-cz-1 hover:border-cz-3 max-sm:min-h-11">
          Columns<ChevronDownIcon size={12} aria-hidden="true" className="text-cz-3" />
        </button>
      )}
    >
      {["Training XP", "Race XP", "Points", "Fatigue"].map((c) => (
        <MenuItem key={c}><span className="inline-flex items-center gap-2"><CheckIcon size={12} aria-hidden="true" />{c}</span></MenuItem>
      ))}
    </Dropdown>
  );

  const stats = view === "today" ? (
    <span className="text-xs text-cz-2">
      <span className="font-semibold text-cz-1">Monday 16 November</span> · settled
      <span className="px-1 text-cz-3">·</span>XP <span className={`${NUM} font-semibold text-cz-1`}>{num(s.xp)}</span>
      <span className="px-1 text-cz-3">·</span><span className={`${NUM} font-semibold text-cz-1`}>{s.points}</span> points
      <span className="text-cz-3"> ({s.fromBar} paid out from the bar)</span>
      <span className="px-1 text-cz-3">·</span><span className={`${NUM} font-semibold text-cz-1`}>{s.raceShare} %</span> from races
    </span>
  ) : (
    <span className="text-xs text-cz-2">
      <span className="font-semibold text-cz-1">Last 30 days</span>
      <span className="px-1 text-cz-3">·</span>XP <span className={`${NUM} font-semibold text-cz-1`}>{num(s30.xp)}</span>
      <span className="px-1 text-cz-3">·</span><span className={`${NUM} font-semibold text-cz-1`}>{s30.points}</span> points
      <span className="text-cz-3"> ({s30.fromBar} paid out from the bar)</span>
      <span className="px-1 text-cz-3">·</span><span className={`${NUM} font-semibold text-cz-1`}>{s30.raceShare} %</span> from races
    </span>
  );

  const toolbar = (
    <div className={`flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-cz-border px-3 py-2 ${mobile ? "flex-col items-stretch" : ""}`}>
      <div className={mobile ? "[&_button]:flex-1" : ""}>
        <Segmented label="Report range" value={view} onChange={(v: ReportRange) => setView(v)}
          options={[{ value: "today", label: "Today" }, { value: "30", label: "30 days" }]} className={mobile ? "w-full" : ""} />
      </div>
      {stats}
      <FilterWords />
      {!mobile && <div className="ms-auto">{columnsMenu}</div>}
    </div>
  );

  const legend = (
    <p className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-2xs text-cz-3">
      <span className="inline-flex items-center gap-1.5"><PointChip ability="Climbing" fromBar={false} />Earned today</span>
      <span className="inline-flex items-center gap-1.5"><PointChip ability="Flat" fromBar />Paid out from the bar: XP saved on earlier days already covered the point</span>
      <span>Fatigue is after the day.</span>
    </p>
  );

  // --- Today, computer ---
  const todayTable = (
    <table className="w-full table-fixed text-xs" data-sortable>
      <thead>
        <tr className="border-b border-cz-border">
          <th className="w-[40px]" aria-label="Details" />
          <SortHead<TodayKey> k="rider" label="Rider" cls="w-[230px]" sort={sort} onSort={(k) => setSort((x) => next(x, k, k === "rider" || k === "type"))} />
          <SortHead<TodayKey> k="type" label="Type" cls="w-[140px]" sort={sort} onSort={(k) => setSort((x) => next(x, k, k === "rider" || k === "type"))} />
          <SortHead<TodayKey> k="training" label="Training XP" right cls="w-[110px] whitespace-nowrap" sort={sort} onSort={(k) => setSort((x) => next(x, k, false))} />
          <SortHead<TodayKey> k="race" label="Race XP" right cls="w-[100px] whitespace-nowrap" sort={sort} onSort={(k) => setSort((x) => next(x, k, false))} />
          <SortHead<TodayKey> k="xp" label="XP" right cls="w-[90px]" sort={sort} onSort={(k) => setSort((x) => next(x, k, false))} />
          <SortHead<TodayKey> k="points" label="Points" cls="w-[250px]" sort={sort} onSort={(k) => setSort((x) => next(x, k, false))} />
          <th className="w-[110px] px-3 py-2 text-start font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3">Form</th>
          <SortHead<TodayKey> k="fatigue" label="Fatigue" cls="" sort={sort} onSort={(k) => setSort((x) => next(x, k, false))} />
        </tr>
      </thead>
      <tbody>
        {today.map(({ rider, row }) => {
          const o = open.has(rider.id);
          return [
            <tr key={rider.id} className={`border-t border-cz-border first:border-t-0 ${o ? "bg-cz-subtle/40" : ""}`}>
              <td className="ps-3">
                <button type="button" onClick={() => toggle(rider.id)} aria-expanded={o} aria-label={`Details for ${rider.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-cz text-cz-2 hover:bg-cz-subtle hover:text-cz-1">
                  {o ? <ChevronDownIcon size={14} aria-hidden="true" /> : <ChevronRightIcon size={14} aria-hidden="true" />}
                </button>
              </td>
              <td className="px-3 py-[7px]"><RiderName rider={rider} /></td>
              <td className="px-3 py-[7px]"><TypeCell id={rider.id} /></td>
              <td className={`px-3 py-[7px] text-end ${NUM} ${row.training ? "text-cz-1" : "text-cz-3"}`}>{num(row.training)}</td>
              <td className={`px-3 py-[7px] text-end ${NUM} ${row.race ? "text-cz-1" : "text-cz-3"}`}>{num(row.race)}</td>
              <td className={`px-3 py-[7px] text-end ${NUM} font-semibold ${reportXp(row) ? "text-cz-1" : "text-cz-3"}`}>{num(reportXp(row))}</td>
              <td className="px-3 py-[7px]"><Points row={row} /></td>
              <td className="px-3 py-[7px]"><span className="inline-flex items-center gap-2"><FormPlate value={FORM[rider.id] ?? null} /><Delta n={FORM_DELTA[rider.id] ?? 0} /></span></td>
              <td className="px-3 py-[7px]"><span className="inline-flex items-center gap-2"><FatiguePlate value={row.fatigue} label="Fatigue after the day" /><Delta n={row.delta} /></span></td>
            </tr>,
            o && (
              <tr key={`${rider.id}-d`} className="bg-cz-subtle/40">
                <td />
                <td colSpan={8} className="px-3 pb-3 pt-1"><Detail rider={rider} row={row} mobile={false} /></td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );

  // --- Today, telefon: navn + tre kolonner, resten i rytterens aabne kort ---
  const todayList = (
    <div>
      <div className="grid grid-cols-[1fr_52px_52px_64px] gap-2 border-b border-cz-border px-3 py-2 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
        <span>Rider</span><span className="text-end">XP</span><span>Points</span><span>Fatigue</span>
      </div>
      <ul>
        {today.map(({ rider, row }) => {
          const o = open.has(rider.id);
          return (
            <li key={rider.id} className="border-t border-cz-border first:border-t-0">
              <button type="button" onClick={() => toggle(rider.id)} aria-expanded={o}
                className={`grid min-h-11 w-full grid-cols-[1fr_52px_52px_64px] items-center gap-2 px-3 py-2 text-start ${o ? "bg-cz-subtle/60" : ""}`}>
                <RiderName rider={rider} wrap />
                <span className={`text-end ${NUM} font-semibold ${reportXp(row) ? "text-cz-1" : "text-cz-3"}`}>{num(reportXp(row))}</span>
                <span className="text-xs">
                  {row.points.length === 0 ? <span className="text-cz-3">0</span> : (
                    <span className={`inline-flex items-center rounded-cz px-1.5 py-0.5 text-2xs font-medium ${row.points[0].fromBar ? "border border-dashed border-cz-3 text-cz-1" : "bg-cz-1 text-cz-card"}`}
                      aria-label={`${row.points.length} point, ${row.points[0].fromBar ? "paid out from the bar" : "earned today"}`}>+{row.points.length}</span>
                  )}
                </span>
                <span className="flex items-center justify-between gap-1">
                  <span className="inline-flex items-center gap-1"><FatiguePlate value={row.fatigue} label="Fatigue after the day" /></span>
                  {o ? <ChevronDownIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" /> : <ChevronRightIcon size={13} aria-hidden="true" className="shrink-0 text-cz-3" />}
                </span>
              </button>
              {o && (
                <div className="flex flex-col gap-3 border-t border-cz-border bg-cz-subtle/60 px-3 pb-4 pt-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><div className={LABEL}>Type</div><div><TypeCell id={rider.id} /></div></div>
                    <div><div className={LABEL}>Fatigue change</div><Delta n={row.delta} /></div>
                    <div><div className={LABEL}>Training XP</div><div className={`${NUM} text-cz-1`}>{num(row.training)}</div></div>
                    <div><div className={LABEL}>Race XP</div><div className={`${NUM} text-cz-1`}>{num(row.race)}</div></div>
                  </div>
                  <div><div className={LABEL}>Points</div><Points row={row} /></div>
                  <Detail rider={rider} row={row} mobile />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  // --- 30 days ---
  const t30 = (k: Key30) => setSort30((x) => next(x, k, k === "rider" || k === "type"));
  const table30 = (
    <table className="w-full table-fixed text-xs" data-sortable>
      <thead>
        <tr className="border-b border-cz-border">
          <SortHead<Key30> k="rider" label="Rider" cls="w-[270px]" sort={sort30} onSort={t30} />
          <SortHead<Key30> k="type" label="Type" cls="w-[140px]" sort={sort30} onSort={t30} />
          <SortHead<Key30> k="xp" label="XP, 30 days" right cls="w-[120px] whitespace-nowrap" sort={sort30} onSort={t30} />
          <SortHead<Key30> k={null} label="Per day" cls="w-[170px]" sort={sort30} onSort={t30} />
          <SortHead<Key30> k="points" label="Points" right cls="w-[90px]" sort={sort30} onSort={t30} />
          <SortHead<Key30> k="fromBar" label="From the bar" right cls="w-[130px] whitespace-nowrap" sort={sort30} onSort={t30} />
          <SortHead<Key30> k="race" label="From races" right cls="w-[120px] whitespace-nowrap" sort={sort30} onSort={t30} />
          <th />
        </tr>
      </thead>
      <tbody>
        {days.map(({ rider, dev }) => (
          <tr key={rider.id} className="border-t border-cz-border first:border-t-0">
            <td className="px-3 py-[7px]"><RiderName rider={rider} /></td>
            <td className="px-3 py-[7px]"><TypeCell id={rider.id} /></td>
            <td className={`px-3 py-[7px] text-end ${NUM} font-semibold text-cz-1`}>{num(devXp30(dev))}</td>
            <td className="px-3 py-[7px]"><Spark values={dev.spark} label={`${rider.name}: XP per day, last 30 days`} /></td>
            <td className={`px-3 py-[7px] text-end ${NUM} text-cz-1`}>{POINTS_30[rider.id].points}</td>
            <td className={`px-3 py-[7px] text-end ${NUM} ${POINTS_30[rider.id].fromBar ? "text-cz-1" : "text-cz-3"}`}>{POINTS_30[rider.id].fromBar}</td>
            <td className={`px-3 py-[7px] text-end ${NUM} ${raceShare30(rider.id) ? "text-cz-1" : "text-cz-3"}`}>{raceShare30(rider.id)} %</td>
            <td />
          </tr>
        ))}
      </tbody>
    </table>
  );

  const list30 = (
    <div>
      <div className="grid grid-cols-[1fr_56px_44px_52px] gap-2 border-b border-cz-border px-3 py-2 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
        <span>Rider</span><span className="text-end">XP</span><span className="text-end">Points</span><span className="text-end">Races</span>
      </div>
      <ul>
        {days.map(({ rider, dev }) => (
          <li key={rider.id} className="grid min-h-11 grid-cols-[1fr_56px_44px_52px] items-center gap-2 border-t border-cz-border px-3 py-2 first:border-t-0">
            <RiderName rider={rider} wrap />
            <span className={`text-end ${NUM} font-semibold text-cz-1`}>{num(devXp30(dev))}</span>
            <span className={`text-end ${NUM} text-cz-1`}>{POINTS_30[rider.id].points}</span>
            <span className={`text-end ${NUM} ${raceShare30(rider.id) ? "text-cz-1" : "text-cz-3"}`}>{raceShare30(rider.id)} %</span>
          </li>
        ))}
      </ul>
    </div>
  );

  return (
    <>
      {view === "today" && dayStrip}
      <div className="rounded-cz border border-cz-border bg-cz-card">
        {toolbar}
        {view === "today" ? (mobile ? todayList : todayTable) : (mobile ? list30 : table30)}
      </div>
      {view === "today" ? legend : (
        <p className="mt-3 text-2xs text-cz-3">XP per day, oldest to today. Points paid out from the bar landed on XP saved on earlier days.</p>
      )}
      <p className="mt-1 text-2xs text-cz-3">
        Names, nations and types: your squad. XP, points and fatigue are examples; XP is not switched on yet.
      </p>
    </>
  );
}
