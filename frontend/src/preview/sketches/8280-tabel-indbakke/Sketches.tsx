// Skitser til #8280 (mobil-rettelse 6 og 9 fra #8073): tabel-kontroller og
// indbakke, tre retninger hver, ved 390 og 1440. Kun dev; ingen app-kode
// importerer filen. Navne, tal og datoer er preview-mockens (src/preview/
// seedData.js + installPreviewMock.js), så FØR (rigtig app med mock) og EFTER
// (skitse) viser de samme ryttere og beskeder.
//
// URL: ?s=table|inbox&d=A|B|C&w=390|1440[&marks=0]
import type { ReactNode } from "react";
import {
  Btn, Card, Desktop, Flag, Icon, Jersey, Mark, PageTitle, Phone, Rating, Segmented, TabRow, Tag, natLabel,
} from "./Kit.tsx";

const q = new URLSearchParams(window.location.search);
const W = q.get("w") === "1440" ? 1440 : 390;
const MOBILE = W === 390;

/* ── mock-ryttere (seedData.js RIDERS[0], RIDERS[1]) ─────────────────── */

type Rider = {
  first: string; last: string; nat: string; age: number; rating: number; type: string; value: string; salary: string;
  pot?: string; status: string; team: string; role: string; badges: ReactNode;
};
const ADA: Rider = { first: "Ada", last: "Pedersen", nat: "dk", age: 24, rating: 29, type: "Sprint", value: "1,680,000", salary: "42,000", pot: "40–48", status: "U25", team: "E2E Racing", role: "Sprinter / Rouleur",
  badges: <><Jersey label="U23 world champion" /><Icon name="star" className="h-3.5 w-3.5 text-cz-accent-t" /></> };
const MIKKEL: Rider = { first: "Mikkel", last: "Hansen", nat: "dk", age: 29, rating: 26, type: "Climb", value: "1,400,000", salary: "140,000", status: "AUC", team: "Regression VC", role: "Climber / GC contender",
  badges: <Jersey label="World champion" /> };
const RIDERS = [ADA, MIKKEL];

/** Navnecellen efter P12 + rettelse 1: nation · ikon · navn · mærker, status i underlinjen. */
function NameCell({ r, desktop = false }: { r: Rider; desktop?: boolean }) {
  if (desktop) {
    return (
      <div className="flex items-center gap-1.5">
        <Icon name="user" className="h-3.5 w-3.5 text-cz-3" />
        <a className="text-[14px] font-medium text-cz-1">{r.first} {r.last}</a>{r.badges}
      </div>
    );
  }
  return (
    <div className="min-w-0">
      <a className="block text-[14px] font-medium leading-snug text-cz-1">{r.first.charAt(0)}. {r.last}</a>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 font-data text-3xs uppercase text-cz-3">
        <Flag code={r.nat} />{natLabel(r.nat)} · {r.age}<Tag>{r.status}</Tag>{r.badges}
      </div>
    </div>
  );
}

const potCell = (r: Rider) => r.pot
  ? <span className="inline-flex flex-col items-end"><span>{r.pot}</span><span className="font-data text-3xs text-cz-3">3/3</span></span>
  : <span className="inline-flex min-h-11 items-center gap-1 text-[13px] text-cz-2"><Icon name="search" className="h-3.5 w-3.5" />Scout</span>;

/** Sortérbar kolonneoverskrift: knap i <th>, aria-sort kun på den sorterede
 *  (modern-web-guidance `sortable-table`). Retningen vises med en streg-pil. */
function SortTh({ label, sorted, right = true, menu = false, mark }: { label: string; sorted?: "asc" | "desc"; right?: boolean; menu?: boolean; mark?: number }) {
  return (
    <th scope="col" aria-sort={sorted === "desc" ? "descending" : sorted === "asc" ? "ascending" : undefined}
      className={`relative p-0 font-data text-2xs font-semibold uppercase tracking-wide ${right ? "text-right" : "text-left"}`}>
      <button type="button" className={`inline-flex min-h-11 w-full items-center gap-1 px-2 font-data text-2xs font-semibold uppercase tracking-wide ${right ? "justify-end" : "justify-start"} ${sorted ? "text-cz-1" : "text-cz-3"}`}>
        {label}
        {sorted && <Icon name={sorted === "desc" ? "sortDown" : "sortUp"} className="h-3 w-3" />}
        {menu && !sorted && <Icon name="chevronDown" className="h-3 w-3" />}
        {menu && sorted && <Icon name="chevronDown" className="h-3 w-3 text-cz-3" />}
      </button>
      {mark && <Mark n={mark} className="absolute -top-2 right-0" />}
    </th>
  );
}

function MobileTable({ head, toolbar, footer }: { head: ReactNode; toolbar?: ReactNode; footer?: boolean }) {
  return (
    <Card className="overflow-hidden">
      {toolbar}
      <table className="w-full table-fixed border-collapse" data-sort-exempt="statisk skitse, ingen data">
        <colgroup><col /><col className="w-[64px]" /><col className="w-[96px]" /><col className="w-[80px]" /></colgroup>
        <thead className="border-b border-cz-border">{head}</thead>
        <tbody>
          {RIDERS.map((r) => (
            <tr key={r.last} className="border-b border-cz-border last:border-b-0">
              <td className="px-2 py-2.5 align-middle"><NameCell r={r} /></td>
              <td className="px-2 py-2.5 text-center align-middle"><Rating value={r.rating} type={r.type} /></td>
              <td className="px-2 py-2.5 text-right align-middle font-data text-[14px] tabular-nums">{r.value}</td>
              <td className="px-2 py-2.5 text-right align-middle font-data text-[14px] tabular-nums">{potCell(r)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {footer && <div className="border-t border-cz-border px-3 py-2 font-data text-2xs text-cz-3">Showing 1–2 of 2</div>}
    </Card>
  );
}

const DESK_COLS: [string, (r: Rider) => ReactNode, boolean?][] = [
  ["Rating", (r) => <span className="inline-flex items-center gap-1.5"><Rating value={r.rating} /><Tag>{r.type}</Tag></span>],
  ["Value", (r) => r.value, true],
  ["Potential", potCell, true],
  ["Salary", (r) => r.salary, true],
  ["Team", (r) => <a className="text-cz-1">{r.team}</a>],
  ["Status", (r) => <Tag>{r.status}</Tag>],
  ["Age", (r) => r.age, true],
  ["Natural role", (r) => <span className="text-cz-2">{r.role}</span>],
];

function DesktopTable({ toolbar, headMenu = false, headMark }: { toolbar: ReactNode; headMenu?: boolean; headMark?: number }) {
  return (
    <Card className="overflow-visible">
      {toolbar}
      <table className="w-full border-collapse" data-sort-exempt="statisk skitse, ingen data">
        <thead className="border-b border-cz-border">
          <tr>
            <SortTh label="Nation" right={false} menu={headMenu} />
            <SortTh label="Rider" right={false} menu={headMenu} />
            {DESK_COLS.map(([h, , num], i) => (
              <SortTh key={h} label={h} right={!!num} sorted={h === "Value" ? "desc" : undefined} menu={headMenu} mark={i === 1 ? headMark : undefined} />
            ))}
          </tr>
        </thead>
        <tbody>
          {RIDERS.map((r) => (
            <tr key={r.last} className="border-b border-cz-border last:border-b-0">
              <td className="px-2 py-3 font-data text-xs text-cz-2"><span className="inline-flex items-center gap-1.5"><Flag code={r.nat} />{natLabel(r.nat)}</span></td>
              <td className="px-2 py-3"><NameCell r={r} desktop /></td>
              {DESK_COLS.map(([h, f, num]) => (
                <td key={h} className={`px-2 py-3 font-data text-[14px] tabular-nums ${num ? "text-right" : ""}`}>{f(r)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex items-center justify-between border-t border-cz-border px-3 py-2 font-data text-2xs text-cz-3">
        <span>Showing 1–2 of 2</span><span>Page 1 of 1</span>
      </div>
    </Card>
  );
}

/** FilterBar efter PAGE_TEMPLATES T2: søg 240 px + højst 3 selects + "More filters". */
function DesktopFilterBar({ extra }: { extra?: ReactNode }) {
  const sel = (t: string) => <span className="flex min-h-9 w-[150px] items-center justify-between rounded-cz border border-cz-border bg-cz-card px-3 text-[13px] text-cz-2">{t}<Icon name="chevronDown" className="h-4 w-4 text-cz-3" /></span>;
  return (
    <div className="mb-4 flex items-center gap-2">
      <label className="flex min-h-9 w-[240px] items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-[13px] text-cz-3"><Icon name="search" className="h-4 w-4" />Search rider</label>
      {sel("All countries")}{sel("Natural role: all")}{sel("Best role now: all")}
      <span className="inline-flex min-h-9 items-center gap-1.5 px-2 text-[13px] text-cz-2"><Icon name="filter" className="h-4 w-4" />More filters<Icon name="chevronDown" className="h-3.5 w-3.5" /></span>
      {extra}
    </div>
  );
}

function DesktopHeader() {
  return (
    <div className="mb-5 flex items-start justify-between">
      <div><h1 className="text-[22px] font-bold tracking-tight">Rider Database</h1><div className="mt-0.5 text-sm text-cz-3">2 riders</div></div>
      <div className="flex gap-2"><Btn size="sm">Show stats</Btn><Btn size="sm">My Watchlist (0)</Btn></div>
    </div>
  );
}

/* ── TABEL A · Segmented kolonnesæt + sortering i overskriften ────────── */

function TableA() {
  const lens = ["Overview", "Contract", "Abilities"];
  if (MOBILE) {
    return (
      <Phone nav="Riders">
        <PageTitle title="Rider Database" sub="2 riders" />
        <div className="relative mt-3 flex gap-2">
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-sm text-cz-3"><Icon name="search" className="h-4 w-4" />Search rider</label>
          <Btn><Icon name="sliders" className="h-4 w-4" />Filters</Btn>
          <Mark n={1} className="absolute -top-2 right-0" />
        </div>
        <div className="mt-3">
          <MobileTable
            toolbar={
              <div className="relative flex items-center gap-2 border-b border-cz-border p-2">
                <Segmented options={lens} grow className="flex-1" />
                <button type="button" aria-label="All columns" className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-cz border border-cz-border text-cz-1"><Icon name="columns" className="h-4 w-4" /></button>
                <Mark n={2} className="absolute -top-2 left-2" /><Mark n={3} className="absolute -top-2 right-2" />
              </div>
            }
            head={<tr><SortTh label="Rider" right={false} /><SortTh label="Rating" /><SortTh label="Value" sorted="desc" mark={4} /><SortTh label="Pot." /></tr>}
            footer
          />
        </div>
      </Phone>
    );
  }
  return (
    <Desktop>
      <DesktopHeader />
      <div className="relative"><DesktopFilterBar /><Mark n={1} className="absolute -top-2 left-[232px]" /></div>
      <DesktopTable headMark={4} toolbar={
        <div className="relative flex items-center gap-3 border-b border-cz-border px-3 py-2">
          <Segmented options={[...lens, "Physiology"]} />
          <span className="font-data text-2xs text-cz-3">Value, potential, salary, team</span>
          <span className="ms-auto inline-flex min-h-9 items-center gap-1.5 text-[13px] text-cz-2"><Icon name="columns" className="h-4 w-4" />Columns</span>
          <span className="inline-flex min-h-9 items-center gap-1.5 text-[13px] text-cz-2">Save view</span>
          <Mark n={2} className="absolute -top-2 left-3" /><Mark n={3} className="absolute -top-2 right-24" />
        </div>
      } />
    </Desktop>
  );
}

/* ── TABEL B · Én værktøjslinje: Sort · Columns · Filters (ark) ───────── */

function ToolbarB({ big = false }: { big?: boolean }) {
  const cell = (icon: string, label: ReactNode, open = false) => (
    <button type="button" className={`inline-flex ${big ? "min-h-11 flex-1" : "min-h-9 px-3"} items-center justify-center gap-1.5 text-[13px] font-medium ${open ? "bg-cz-subtle text-cz-1" : "bg-cz-card text-cz-2"}`}>
      <Icon name={icon} className="h-4 w-4" />{label}
    </button>
  );
  return (
    <div className={`flex overflow-hidden rounded-cz border border-cz-border ${big ? "w-full" : ""} divide-x divide-cz-border`}>
      {cell("sort", <>Sort <span className="text-cz-3">Value</span><Icon name="sortDown" className="h-3 w-3 text-cz-3" /></>)}
      {cell("columns", <>Columns <span className="font-data text-cz-3">3/9</span></>, true)}
      {cell("sliders", <>Filters <span className="font-data text-cz-3">0</span></>)}
    </div>
  );
}

function ColumnsList({ compact = false }: { compact?: boolean }) {
  const cols: [string, boolean][] = [["Rating", true], ["Value", true], ["Potential", true], ["Salary", false], ["Team", false], ["Status", false], ["Age", false], ["Natural role", false]];
  return (
    <div className="divide-y divide-cz-border">
      {cols.slice(0, compact ? 6 : 8).map(([c, on]) => (
        <label key={c} className="flex min-h-11 items-center gap-3 px-4 text-sm">
          <span className={`inline-flex h-4 w-4 items-center justify-center rounded-cz border ${on ? "border-cz-1 bg-cz-1 text-cz-card" : "border-cz-border"}`}>{on && <Icon name="check" className="h-3 w-3" />}</span>
          {c}
          {on && <span className="ms-auto font-data text-2xs text-cz-3">shown</span>}
        </label>
      ))}
    </div>
  );
}

function TableB() {
  if (MOBILE) {
    return (
      <Phone nav="Riders">
        <div className="relative h-full">
          <PageTitle title="Rider Database" sub="2 riders" />
          <label className="mt-3 flex min-h-11 items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-sm text-cz-3"><Icon name="search" className="h-4 w-4" />Search rider</label>
          <div className="relative mt-2"><ToolbarB big /><Mark n={1} className="absolute -top-2 left-2" /></div>
          <div className="mt-3"><MobileTable head={<tr><SortTh label="Rider" right={false} /><SortTh label="Rating" /><SortTh label="Value" sorted="desc" /><SortTh label="Pot." /></tr>} /></div>
          {/* Ark fra bunden (P18). Skitsen bruger en stærkere hairline i stedet for skygge. */}
          <div className="absolute inset-x-[-16px] bottom-[-4px] rounded-t-cz border-t border-cz-border bg-cz-card border-cz-border-strong">
            <div className="mx-auto mt-2 h-1 w-9 rounded-cz-pill bg-cz-border" />
            <div className="flex items-center justify-between px-4 pt-2"><div className="text-[15px] font-semibold">Columns</div><span className="font-data text-2xs text-cz-3">3 on a phone</span></div>
            <ColumnsList compact />
            <div className="relative px-4 py-2"><Btn full>Show all columns</Btn><Mark n={2} className="absolute -top-1 right-4" /></div>
          </div>
        </div>
      </Phone>
    );
  }
  return (
    <Desktop>
      <DesktopHeader />
      <div className="relative mb-4 flex items-center gap-2">
        <label className="flex min-h-9 w-[240px] items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-[13px] text-cz-3"><Icon name="search" className="h-4 w-4" />Search rider</label>
        <ToolbarB />
        <Mark n={1} className="absolute -top-2 left-[250px]" />
        {/* Svævende kort under "Columns" (P18). */}
        <div className="absolute left-[420px] top-11 z-10 w-[260px] rounded-cz border border-cz-border-strong bg-cz-card">
          <div className="px-4 py-2.5 text-[13px] font-semibold">Columns</div>
          <div className="border-t border-cz-border"><ColumnsList /></div>
          <Mark n={2} className="absolute -top-2 right-2" />
        </div>
      </div>
      <DesktopTable toolbar={null} />
    </Desktop>
  );
}

/* ── TABEL C · Overskriften er kontrollen ─────────────────────────────── */

function HeaderMenu({ className = "", desktop = false }: { className?: string; desktop?: boolean }) {
  const row = (icon: string, t: string, on = false) => (
    <div className={`flex min-h-11 items-center gap-2.5 px-3 text-sm ${on ? "text-cz-accent-t" : "text-cz-1"}`}><Icon name={icon} className="h-4 w-4" />{t}{on && <Icon name="check" className="ms-auto h-4 w-4" />}</div>
  );
  return (
    <div className={`absolute z-10 w-[220px] rounded-cz border border-cz-border-strong bg-cz-card text-left normal-case tracking-normal ${className}`}>
      {row("sortDown", "High to low", true)}
      {row("sortUp", "Low to high")}
      <div className="border-t border-cz-border px-3 pb-1 pt-2 font-data text-3xs font-semibold uppercase tracking-widest text-cz-3">{desktop ? "Column" : "Show here instead"}</div>
      {(desktop ? ["Hide column", "Move left"] : ["Salary", "Age", "Team"]).map((c) => <div key={c} className="flex min-h-11 items-center px-3 text-sm text-cz-2">{c}</div>)}
    </div>
  );
}

function TableC() {
  if (MOBILE) {
    return (
      <Phone nav="Riders">
        <PageTitle title="Rider Database" sub="2 riders" />
        <div className="relative mt-3 flex gap-2">
          <label className="flex min-h-11 flex-1 items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-sm text-cz-3"><Icon name="search" className="h-4 w-4" />Search rider</label>
          <Btn><Icon name="sliders" className="h-4 w-4" />Filters</Btn>
        </div>
        <div className="relative mt-3">
          <MobileTable head={
            <tr>
              <th scope="col" className="relative p-0 text-left">
                <span className="inline-flex min-h-11 items-center gap-1.5 px-2 font-data text-2xs font-semibold uppercase tracking-wide text-cz-3">
                  Rider<span aria-label="All columns" className="inline-flex h-7 w-7 items-center justify-center rounded-cz border border-cz-border text-cz-1"><Icon name="columns" className="h-3.5 w-3.5" /></span>
                </span>
                <Mark n={2} className="absolute -top-2 left-16" />
              </th>
              <SortTh label="Rtg" menu /><SortTh label="Value" sorted="desc" menu mark={1} /><SortTh label="Pot." menu />
            </tr>
          } footer />
          <HeaderMenu className="right-[72px] top-11" />
        </div>
      </Phone>
    );
  }
  return (
    <Desktop>
      <DesktopHeader />
      <DesktopFilterBar />
      <div className="relative">
        <DesktopTable toolbar={null} headMenu headMark={1} />
        <HeaderMenu desktop className="left-[425px] top-11" />
      </div>
    </Desktop>
  );
}

/* ── INDBAKKE: mock-beskeder ──────────────────────────────────────────── */

type Msg = { icon: string; type: "Auctions" | "Transfers" | "Races"; text: ReactNode; time?: string; unread?: boolean; detail?: ReactNode; count?: number };

const ACTION: Msg = { icon: "exchange", type: "Transfers", unread: true, time: "28 Jun",
  text: <>Regression VC offers <b className="font-data font-semibold tabular-nums">415,000 CZ$</b> for <a className="font-semibold">Jonas Brandt</a></> };

const TODAY: Msg[] = [
  { icon: "bolt", type: "Auctions", unread: true, time: "10:42", count: 4,
    text: <><a className="font-semibold">Théo Journal</a>: auto-bid held at <b className="font-data font-semibold tabular-nums">412,000 CZ$</b></>,
    detail: (
      <div className="space-y-0.5 font-data text-xs tabular-nums text-cz-2">
        <div className="flex gap-3 text-3xs uppercase tracking-widest text-cz-3"><span className="w-10">Time</span><span className="flex-1">Bid by</span><span>Your auto-bid</span></div>
        {[["10:42", "Northwind Cycling", "412,000"], ["10:31", "Northwind Cycling", "388,000"], ["10:18", "Solera Continental", "361,000"], ["10:04", "Solera Continental", "340,000"]].map(([t, who, amt]) => (
          <div key={t} className="flex gap-3"><span className="w-10 text-cz-3">{t}</span><span className="flex-1">{who}</span><span>{amt} CZ$</span></div>
        ))}
      </div>
    ) },
  { icon: "bolt", type: "Auctions", unread: true, time: "09:55", count: 3,
    text: <><a className="font-semibold">Mats Verhoeven</a>: auto-bid held at <b className="font-data font-semibold tabular-nums">214,000 CZ$</b></> },
  { icon: "gavel", type: "Auctions", unread: true, time: "09:14",
    text: <><a className="font-semibold">Théo Journal</a> lost to Northwind Cycling at <b className="font-data font-semibold tabular-nums">340,000 CZ$</b></> },
];
const EARLIER: [string, Msg[]][] = [
  ["Thu 9 Jul", [{ icon: "exchange", type: "Transfers", time: "14:02", text: <>Your offer for <a className="font-semibold">Sofie Lund</a> is waiting · <b className="font-data font-semibold tabular-nums">640,000 CZ$</b></> }]],
  ["Sun 10 May", [{ icon: "trophy", type: "Races", text: <><a className="font-semibold">Ada Pedersen</a> 2nd overall in Giro di Preview · <b className="font-data font-semibold tabular-nums">+0:22</b></> }]],
  ["Sun 1 Mar", [{ icon: "flag", type: "Races", text: <><a className="font-semibold">Ada Pedersen</a> won Omloop Preview · <b className="font-data font-semibold tabular-nums">100,000 CZ$</b></> }]],
];

function TypeIcon({ name }: { name: string }) {
  return <span className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-cz border border-cz-border bg-cz-subtle text-cz-2"><Icon name={name} className="h-4 w-4" /></span>;
}

/** Én linje pr. besked. Hele rækken er trykfladen (≥ 52 px). `open` viser den
 *  udfoldede tilstand (<details>-mønstret, modern-web-guidance `accordion`). */
function OneLine({ m, open = false, mark }: { m: Msg; open?: boolean; mark?: number }) {
  return (
    <div className="relative border-b border-cz-border last:border-b-0">
      <div className="flex min-h-[52px] items-center gap-3 px-3 py-2">
        <TypeIcon name={m.icon} />
        <div className={`min-w-0 flex-1 text-[14px] leading-snug ${m.unread ? "text-cz-1" : "text-cz-2"}`}>
          <span className={MOBILE ? "line-clamp-2" : "line-clamp-1"}>{m.text}</span>
        </div>
        {m.count && <span className="font-data text-2xs tabular-nums text-cz-3">×{m.count}</span>}
        <span className="w-10 text-right font-data text-2xs tabular-nums text-cz-3">{m.time}</span>
        {m.unread ? <span className="h-2 w-2 shrink-0 rounded-cz-pill bg-cz-accent" aria-label="Unread" /> : <span className="h-2 w-2 shrink-0" />}
        {m.detail && <Icon name={open ? "chevronUp" : "chevronDown"} className="h-4 w-4 shrink-0 text-cz-3" />}
      </div>
      {open && m.detail && (
        <div className="border-t border-cz-border bg-cz-body px-3 py-3 ps-14">
          {m.detail}
          <div className="mt-2 flex gap-4"><a className="inline-flex min-h-11 items-center gap-1 text-sm font-medium text-cz-accent-t">Open auction<Icon name="chevron" className="h-4 w-4" /></a><a className="inline-flex min-h-11 items-center text-sm text-cz-2">Mark read</a></div>
        </div>
      )}
      {mark && <Mark n={mark} className="absolute -top-2 right-2" />}
    </div>
  );
}

function Eyebrow({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <div className="mb-1.5 mt-4 flex items-center justify-between font-data text-3xs font-semibold uppercase tracking-widest text-cz-3">
      <span>{children}</span>{right}
    </div>
  );
}

function InboxFrame({ children }: { children: ReactNode }) {
  if (MOBILE) return <Phone nav="Inbox">{children}</Phone>;
  return <Desktop nav="Inbox"><div className="mx-auto max-w-[896px]">{children}</div></Desktop>;
}

function InboxHead({ tabs }: { tabs: string[] }) {
  return (
    <>
      <PageTitle title="Inbox" sub="7 unread" action={<Btn size={MOBILE ? "md" : "sm"}>Mark all read</Btn>} />
      <TabRow tabs={tabs} more={MOBILE} />
    </>
  );
}

/* ── INDBAKKE A · "Needs you" + dage (bygger på ejer-godkendt #2223 A) ── */

function InboxA() {
  return (
    <InboxFrame>
      <InboxHead tabs={["Inbox 7", "League", "My Activity", "Messages"]} />
      <div className="relative mt-3">
        <Segmented options={["All", "Auctions 3", "Transfers 2", "Races 2"]} grow={MOBILE} />
        <Mark n={1} className="absolute -top-2 right-0" />
      </div>
      <Eyebrow right={<span className="normal-case tracking-normal">1</span>}>Needs you</Eyebrow>
      <Card className="relative">
        <div className="flex min-h-[52px] items-center gap-3 px-3 py-2">
          <TypeIcon name={ACTION.icon} />
          <div className="min-w-0 flex-1 text-[14px] leading-snug">{ACTION.text}<div className="font-data text-2xs text-cz-3">Transfer offer · {ACTION.time}</div></div>
          <Btn size="sm">Reply</Btn>
        </div>
        <Mark n={2} className="absolute -top-2 left-2" />
      </Card>
      <Eyebrow right={<span className="normal-case tracking-normal">3 new</span>}>Today · Wed 5 Aug</Eyebrow>
      <Card>
        <OneLine m={TODAY[0]} open mark={4} />
        <OneLine m={TODAY[1]} mark={3} />
        <OneLine m={TODAY[2]} />
      </Card>
      <Eyebrow>Earlier</Eyebrow>
      <Card className="relative">
        {EARLIER.map(([day, msgs]) => (
          <div key={day} className="flex min-h-11 items-center gap-2 border-b border-cz-border px-3 text-sm text-cz-2 last:border-b-0">
            <Icon name="chevron" className="h-4 w-4 text-cz-3" /><span className="text-cz-1">{day}</span><span className="font-data text-2xs text-cz-3">{msgs.length}</span>
            <span className="ms-auto truncate text-xs text-cz-3">{msgs[0].type}</span>
          </div>
        ))}
        <Mark n={5} className="absolute -top-2 right-2" />
      </Card>
    </InboxFrame>
  );
}


/* ── INDBAKKE B · Grupperet pr. type ──────────────────────────────────── */

function TypeGroup({ icon, title, count, link, msgs, mark }: { icon: string; title: string; count: number; link: string; msgs: Msg[]; mark?: number }) {
  return (
    <Card className="relative mt-3">
      <div className="flex min-h-11 items-center gap-2 border-b border-cz-border px-3">
        <Icon name={icon} className="h-4 w-4 text-cz-2" /><span className="text-[15px] font-semibold">{title}</span><span className="font-data text-2xs text-cz-3">{count}</span>
        <a className="ms-auto inline-flex min-h-11 items-center gap-1 text-sm text-cz-accent-t">{link}<Icon name="chevron" className="h-4 w-4" /></a>
      </div>
      {msgs.map((m, i) => (
        <div key={i} className="flex min-h-11 items-center gap-3 border-b border-cz-border px-3 py-2 last:border-b-0">
          {m.unread ? <span className="h-2 w-2 shrink-0 rounded-cz-pill bg-cz-accent" /> : <span className="h-2 w-2 shrink-0" />}
          <span className={`min-w-0 flex-1 text-[14px] leading-snug ${MOBILE ? "line-clamp-2" : "line-clamp-1"} ${m.unread ? "" : "text-cz-2"}`}>{m.text}</span>
          {m.count && <span className="font-data text-2xs text-cz-3">×{m.count}</span>}
          <span className="font-data text-2xs tabular-nums text-cz-3">{m.time}</span>
        </div>
      ))}
      {mark && <Mark n={mark} className="absolute -top-2 left-2" />}
    </Card>
  );
}

function InboxB() {
  return (
    <InboxFrame>
      <InboxHead tabs={["Mine 7", "To handle 1", "League", "My Activity", "Messages"]} />
      <div className="relative mt-3 flex items-center gap-2">
        <Segmented options={["Unread 5", "All 7"]} />
        <Mark n={1} className="absolute -top-2 left-[150px]" />
      </div>
      <TypeGroup icon="exchange" title="Transfers" count={2} link="Transfers" mark={2}
        msgs={[{ ...ACTION, text: <>{ACTION.text} <Tag>Needs reply</Tag></> }, EARLIER[0][1][0]]} />
      <TypeGroup icon="gavel" title="Auctions" count={3} link="Auctions" mark={3} msgs={TODAY} />
      <TypeGroup icon="trophy" title="Races" count={2} link="Results" msgs={[EARLIER[1][1][0], EARLIER[2][1][0]]} />
    </InboxFrame>
  );
}

/* ── INDBAKKE C · Tidslinje med stryg-handlinger ──────────────────────── */

function InboxC() {
  const two = (m: Msg, swiped = false) => (
    <div className="relative overflow-hidden border-b border-cz-border last:border-b-0">
      {swiped && (
        <div className="absolute inset-y-0 right-0 flex">
          <span className="inline-flex w-[76px] items-center justify-center bg-cz-subtle text-xs font-medium text-cz-1">Mark read</span>
          <span className="inline-flex w-[64px] items-center justify-center bg-cz-danger-bg text-xs font-medium text-cz-danger">Delete</span>
        </div>
      )}
      <div className={`relative flex min-h-[60px] items-start gap-3 bg-cz-card px-3 py-2.5 ${swiped ? "-translate-x-[140px] border-e border-cz-border" : ""}`}>
        <TypeIcon name={m.icon} />
        <div className="min-w-0 flex-1">
          <div className="text-[14px] leading-snug"><span className="line-clamp-2">{m.text}</span></div>
          <div className="mt-0.5 flex items-center gap-1.5 font-data text-2xs text-cz-3">{m === ACTION && <Tag>Needs reply</Tag>}{m.type} · {m.time}{m.count ? ` · ${m.count} events` : ""}</div>
        </div>
        <button type="button" aria-label="More actions" className="-me-2 inline-flex h-11 w-11 shrink-0 items-center justify-center text-cz-3"><Icon name="more" className="h-5 w-5" /></button>
      </div>
    </div>
  );
  return (
    <InboxFrame>
      <InboxHead tabs={["Mine 7", "To handle 1", "League", "My Activity", "Messages"]} />
      <div className="relative mt-3 flex gap-1.5 overflow-hidden">
        {["All 7", "Auctions 3", "Transfers 2", "Races 2"].map((c, i) => (
          <span key={c} className={`inline-flex min-h-11 shrink-0 items-center rounded-cz border px-3 text-[13px] font-medium ${i === 0 ? "border-cz-1 text-cz-1" : "border-cz-border text-cz-2"}`}>{c}</span>
        ))}
        <Mark n={1} className="absolute -top-0 right-0" />
      </div>
      <Eyebrow>Today · Wed 5 Aug</Eyebrow>
      <Card className="relative">
        {two(ACTION)}{two(TODAY[0], true)}{two(TODAY[1])}{two(TODAY[2])}
        <Mark n={2} className="absolute top-[64px] left-2" />
      </Card>
      <Eyebrow>Thu 9 Jul</Eyebrow>
      <Card>{two(EARLIER[0][1][0])}</Card>
    </InboxFrame>
  );
}

const SKETCHES: Record<string, Record<string, () => ReactNode>> = {
  table: { A: TableA, B: TableB, C: TableC },
  inbox: { A: InboxA, B: InboxB, C: InboxC },
};

export function SketchApp() {
  const s = q.get("s") ?? "table";
  const d = q.get("d") ?? "A";
  const S = SKETCHES[s]?.[d] ?? TableA;
  return <S />;
}
