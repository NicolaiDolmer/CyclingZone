// #7947 retning 5, fanen Development: XP-model B (ejervalg 19/11 paa #6110).
// XP er det ene udviklingstal: i dag og de sidste 30 dage. Ingen alder i
// forklaringen; toppen beskrives som "sidst i 20'erne". Ingen loefter og intet
// "faerdig ved loft". Samme moenster som fanen Day: en linje pr. rytter, navnecellen
// er kun navnet, typen er sin egen sorterbare kolonne, og evnerne aabner som
// underraekke. Al tekst er engelsk; alle tal er eksempler (XP er ikke taendt).

import { useMemo, useState } from "react";
import { ChevronDownIcon, ChevronRightIcon, LockIcon } from "../../../components/ui/icons/index.jsx";
import { TEAM, type R5Rider } from "./r5data.ts";
import { DEV, devXp30, type DevRow } from "./r5devdata.ts";
import { devSummary, num } from "./r5devmodel.ts";
import { PctBar, RiderName, SortHead, Spark, type SortState } from "./R5Parts.tsx";

type Key = "rider" | "type" | "rating" | "top" | "season" | "xpToday" | "xp30" | "next";
type Row = { rider: R5Rider; dev: DevRow; xp30: number };

const RATING_PLATE = "inline-flex min-w-[2.125rem] items-center justify-center rounded-cz border border-cz-border bg-cz-subtle px-1 py-0.5 font-data text-[13px] font-semibold leading-none tabular-nums text-cz-1";
const LABEL = "mb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3";
const TOP_TIP = "Where the rider is expected to level out, usually in the late twenties";

// Nu og forventet top paa samme hairline: fyld = nu, stregen = toppen.
function TopTrack({ now, top }: { now: number; top: number }) {
  const at = (v: number) => `${Math.max(0, Math.min(100, ((v - 40) / 59) * 100))}%`;
  return (
    <span className="relative inline-block h-3 w-16 shrink-0" role="img" aria-label={`Now ${now}, expected top ${top}`}>
      <span className="absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 rounded-cz bg-cz-border" />
      <span className="absolute start-0 top-1/2 h-1 -translate-y-1/2 rounded-cz bg-cz-3" style={{ width: at(now) }} />
      <span className="absolute top-0 h-3 w-0.5 bg-cz-1" style={{ insetInlineStart: at(top) }} />
    </span>
  );
}

function XpToday({ dev }: { dev: DevRow }) {
  if (dev.xpToday === null) return <span className="inline-flex items-center gap-1 text-xs text-cz-3"><LockIcon size={11} aria-hidden="true" />After the stage</span>;
  return (
    <span className="inline-flex items-baseline gap-1.5">
      <span className="font-data text-[13px] font-semibold tabular-nums text-cz-1">{num(dev.xpToday)}</span>
      {dev.pointToday && <span className="text-2xs text-cz-2">+1 {dev.pointToday}</span>}
    </span>
  );
}

function Abilities({ dev, mobile }: { dev: DevRow; mobile: boolean }) {
  return (
    <div>
      <div className={`grid items-center gap-x-3 border-b border-cz-border pb-1 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3 ${mobile ? "grid-cols-[1fr_32px_48px_92px]" : "grid-cols-[180px_60px_90px_160px]"}`}>
        <span>Ability</span><span className="text-end">Now</span><span className="text-end">Season</span><span>Next point</span>
      </div>
      <ul>
        {dev.abilities.map((a) => (
          <li key={a.name} className={`grid items-center gap-x-3 border-b border-cz-border py-1.5 text-xs last:border-b-0 ${mobile ? "grid-cols-[1fr_32px_48px_92px]" : "grid-cols-[180px_60px_90px_160px]"}`}>
            <span className="truncate text-cz-1">{a.name}</span>
            <span className="text-end font-data tabular-nums text-cz-1">{a.now}</span>
            <span className="text-end font-data tabular-nums text-cz-2">{a.season > 0 ? `+${a.season}` : "0"}</span>
            <PctBar pct={a.pct} />
          </li>
        ))}
      </ul>
    </div>
  );
}

export default function DevelopmentTab({ mobile, openIds }: { mobile: boolean; openIds: string[] }) {
  const [open, setOpen] = useState<Set<string>>(new Set(openIds));
  const [sort, setSort] = useState<SortState<Key>>({ key: "xp30", dir: -1 });
  const onSort = (key: Key) => setSort((x) => (x?.key === key ? { key, dir: (x.dir * -1) as 1 | -1 } : { key, dir: key === "rider" || key === "type" ? 1 : -1 }));
  const toggle = (id: string) => setOpen((o) => { const n = new Set(o); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  const rows: Row[] = useMemo(() => {
    const base = TEAM.map((rider) => {
      const dev = DEV.find((d) => d.id === rider.id)!;
      return { rider, dev, xp30: devXp30(dev) };
    });
    if (!sort) return base;
    const val = (r: Row): string | number => ({
      rider: r.rider.name, type: r.rider.type, rating: r.dev.rating, top: r.dev.top, season: r.dev.season,
      xpToday: r.dev.xpToday ?? -1, xp30: r.xp30, next: r.dev.next.pct,
    })[sort.key];
    return [...base].sort((a, b) => (val(a) > val(b) ? 1 : val(a) < val(b) ? -1 : 0) * sort.dir);
  }, [sort]);

  const s = devSummary();

  const summary = (
    <div className="mb-3 flex flex-wrap items-center gap-x-1 gap-y-1 text-xs text-cz-2 max-sm:gap-x-3">
      <span className="me-1 font-semibold text-cz-1">{s.riders} riders</span>
      <span className="px-1 text-cz-3 max-sm:hidden">·</span>
      <span>XP today <span className="font-data font-semibold tabular-nums text-cz-1">{num(s.xpToday)}</span>{s.unsettled > 0 && <span className="text-cz-3"> ({s.unsettled} settle after the stage)</span>}</span>
      <span className="px-1 text-cz-3 max-sm:hidden">·</span>
      <span>XP, last 30 days <span className="font-data font-semibold tabular-nums text-cz-1">{num(s.xp30)}</span></span>
      <span className="px-1 text-cz-3 max-sm:hidden">·</span>
      <span><span className="font-data font-semibold tabular-nums text-cz-1">{s.seasonPoints}</span> points this season</span>
      <span className="px-1 text-cz-3 max-sm:hidden">·</span>
      <span><span className="font-data font-semibold tabular-nums text-cz-1">{s.close}</span> close to the next point</span>
    </div>
  );

  const desktopTable = (
    <table className="w-full table-fixed text-xs" data-sortable>
      <thead>
        <tr className="border-b border-cz-border">
          <th className="w-[40px]" aria-label="Abilities" />
          <SortHead<Key> k="rider" label="Rider" cls="w-[230px]" sort={sort} onSort={onSort} />
          <SortHead<Key> k="type" label="Type" cls="w-[140px]" sort={sort} onSort={onSort} />
          <SortHead<Key> k="rating" label="Rating" cls="w-[90px]" sort={sort} onSort={onSort} />
          <SortHead<Key> k="top" label="Expected top" cls="w-[150px] whitespace-nowrap" sort={sort} onSort={onSort} />
          <SortHead<Key> k="season" label="Season" cls="w-[90px]" sort={sort} onSort={onSort} />
          <SortHead<Key> k="xpToday" label="XP today" cls="w-[150px] whitespace-nowrap" sort={sort} onSort={onSort} />
          <SortHead<Key> k="xp30" label="XP, 30 days" cls="w-[210px] whitespace-nowrap" sort={sort} onSort={onSort} />
          <SortHead<Key> k="next" label="Next point" cls="" sort={sort} onSort={onSort} />
        </tr>
      </thead>
      <tbody>
        {rows.map(({ rider, dev, xp30 }) => {
          const o = open.has(rider.id);
          return [
            <tr key={rider.id} className={`border-t border-cz-border first:border-t-0 ${o ? "bg-cz-subtle/40" : ""}`}>
              <td className="ps-3">
                <button type="button" onClick={() => toggle(rider.id)} aria-expanded={o} aria-label={`Abilities for ${rider.name}`}
                  className="flex h-7 w-7 items-center justify-center rounded-cz text-cz-2 hover:bg-cz-subtle hover:text-cz-1">
                  {o ? <ChevronDownIcon size={14} aria-hidden="true" /> : <ChevronRightIcon size={14} aria-hidden="true" />}
                </button>
              </td>
              <td className="px-3 py-[7px]"><RiderName rider={rider} /></td>
              <td className="px-3 py-[7px] text-[13px] text-cz-2">{rider.type}</td>
              <td className="px-3 py-[7px]"><span className={RATING_PLATE}>{dev.rating}</span></td>
              <td className="px-3 py-[7px]" title={TOP_TIP}>
                <span className="inline-flex items-center gap-2">
                  <span className="w-6 font-data text-[13px] font-semibold tabular-nums text-cz-1">{dev.top}</span>
                  <TopTrack now={dev.rating} top={dev.top} />
                </span>
              </td>
              <td className="px-3 py-[7px] font-data text-[13px] tabular-nums text-cz-1">{dev.season > 0 ? `+${dev.season}` : "0"}</td>
              <td className="px-3 py-[7px]"><XpToday dev={dev} /></td>
              <td className="px-3 py-[7px]">
                <span className="inline-flex items-center gap-2">
                  <span className="w-12 font-data text-[13px] font-semibold tabular-nums text-cz-1">{num(xp30)}</span>
                  <Spark values={dev.spark} label={`${rider.name}: XP per day, last 30 days`} />
                </span>
              </td>
              <td className="px-3 py-[7px]">
                <span className="inline-flex items-center gap-3">
                  <span className="w-[84px] truncate text-[13px] text-cz-1">{dev.next.ability}</span>
                  <PctBar pct={dev.next.pct} />
                </span>
              </td>
            </tr>,
            o && (
              <tr key={`${rider.id}-a`} className="bg-cz-subtle/40">
                <td />
                <td colSpan={8} className="px-3 pb-3 pt-1"><div className="max-w-[560px]"><Abilities dev={dev} mobile={false} /></div></td>
              </tr>
            ),
          ];
        })}
      </tbody>
    </table>
  );

  const mobileList = (
    <div>
      <div className="grid grid-cols-[1fr_40px_56px_76px] gap-2 border-b border-cz-border px-3 py-2 font-data text-3xs font-semibold uppercase tracking-[.06em] text-cz-3">
        <span>Rider</span><span>Rating</span><span>XP, 30 d</span><span>Next point</span>
      </div>
      <ul>
        {rows.map(({ rider, dev, xp30 }) => {
          const o = open.has(rider.id);
          return (
            <li key={rider.id} className="border-t border-cz-border first:border-t-0">
              <button type="button" onClick={() => toggle(rider.id)} aria-expanded={o}
                className={`grid min-h-11 w-full grid-cols-[1fr_40px_56px_76px] items-center gap-2 px-3 py-2 text-start ${o ? "bg-cz-subtle/60" : ""}`}>
                <RiderName rider={rider} wrap />
                <span><span className={RATING_PLATE}>{dev.rating}</span></span>
                <span className="font-data text-[13px] font-semibold tabular-nums text-cz-1">{num(xp30)}</span>
                <span className="flex items-start justify-between gap-1 text-xs">
                  <span className="leading-tight text-cz-1">{dev.next.ability}<span className="block font-data text-3xs tabular-nums text-cz-2">{dev.next.pct} %</span></span>
                  {o ? <ChevronDownIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" /> : <ChevronRightIcon size={13} aria-hidden="true" className="mt-0.5 shrink-0 text-cz-3" />}
                </span>
              </button>
              {o && (
                <div className="flex flex-col gap-3 border-t border-cz-border bg-cz-subtle/60 px-3 pb-4 pt-3">
                  <div className="grid grid-cols-2 gap-3 text-xs">
                    <div><div className={LABEL}>Type</div><div className="text-[13px] text-cz-1">{rider.type}</div></div>
                    <div><div className={LABEL}>Expected top</div>
                      <span className="inline-flex items-center gap-2"><span className="font-data text-[13px] font-semibold tabular-nums text-cz-1">{dev.top}</span><TopTrack now={dev.rating} top={dev.top} /></span>
                    </div>
                    <div><div className={LABEL}>XP today</div><XpToday dev={dev} /></div>
                    <div><div className={LABEL}>Season</div><div className="font-data text-[13px] tabular-nums text-cz-1">{dev.season > 0 ? `+${dev.season}` : "0"} points</div></div>
                  </div>
                  <div>
                    <div className={LABEL}>XP per day, last 30 days</div>
                    <Spark values={dev.spark} label={`${rider.name}: XP per day, last 30 days`} />
                  </div>
                  <Abilities dev={dev} mobile />
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );

  return (
    <>
      {summary}
      <div className="rounded-cz border border-cz-border bg-cz-card">{mobile ? mobileList : desktopTable}</div>
      <p className="mt-3 text-2xs text-cz-3">
        XP is the one development number: today and the last 30 days. Riders usually reach their top in their late twenties.{" "}
        <a href="#help" className="font-medium text-cz-accent-t hover:underline">How development works</a>
      </p>
      <p className="mt-1 text-2xs text-cz-3">
        Names, nations and types: your squad. Rating, XP and abilities are examples; XP is not switched on yet.
      </p>
    </>
  );
}
