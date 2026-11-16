// Skitser til mobil-gennemgangen 16/11 (#8073, PR #8236): ÉN skærm pr. rettelse
// ved 390 px, til før/efter-billeder. Ingen app-logik og ingen netværk. Tal og
// navne spejler preview-mockens seed (src/preview/seedData.js), så FØR (rigtig
// app med mock) og EFTER (skitse) viser de samme ryttere. Tokens og Tailwind-
// klasser er appens egne (index.css), så skitsen følger TASTE/PAGE_TEMPLATES:
// hairlines, 5 px radius, ingen skygger, én gold primary pr. skærm.
import type { ReactNode } from "react";
import { statColor, INK_DARK, INK_LIGHT, contrastRatio } from "../../../lib/statColor.js";

/* ── små byggesten ─────────────────────────────────────────────────────── */

const ICONS: Record<string, string> = {
  menu: "M4 7h16M4 12h16M4 17h16",
  bell: "M6 16V11a6 6 0 0 1 12 0v5l1.5 2h-15L6 16zM10 20a2 2 0 0 0 4 0",
  home: "M4 11l8-6 8 6v9h-5v-6H9v6H4z",
  inbox: "M4 13l2-8h12l2 8v6H4zM4 13h5l1 2h4l1-2h5",
  bag: "M5 8h14l-1 12H6zM9 8V6a3 3 0 0 1 6 0v2",
  users: "M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6zM3 20a6 6 0 0 1 12 0M16 5a3 3 0 0 1 0 6M21 20a6 6 0 0 0-4-5.6",
  star: "M12 4l2.4 5 5.6.6-4.2 3.8 1.2 5.6L12 16.2 7 19l1.2-5.6L4 9.6l5.6-.6z",
  chevron: "M9 6l6 6-6 6",
  chevronDown: "M6 9l6 6 6-6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  filter: "M4 6h16l-6 7v5l-4 2v-7z",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  back: "M15 6l-6 6 6 6",
  scout: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  plus: "M12 5v14M5 12h14",
  table: "M4 5h16v14H4zM4 10h16M10 10v9",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
};

function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

function Flag({ code }: { code: string }) {
  return <span className={`fi fi-${code} shrink-0`} role="img" aria-label={code.toUpperCase()} />;
}

/** Rating-pladen: samme farve og blæk som appens (statColor, rating-skala). */
function Rating({ value, type }: { value: number; type?: string }) {
  const bg = statColor(value, { scale: "rating" });
  const ink = contrastRatio(bg, INK_LIGHT) >= contrastRatio(bg, INK_DARK) ? INK_LIGHT : INK_DARK;
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className="inline-flex h-7 min-w-8 items-center justify-center rounded-cz px-1.5 font-data text-[15px] font-[650] tabular-nums"
        style={{ background: bg, color: ink }}>{value}</span>
      {type && <span className="font-data text-3xs text-cz-3">{type}</span>}
    </span>
  );
}

/** Mestertrøje-mærke i 16 px (P12-undtagelsen), tegnet som omrids i skitsen. */
function Jersey({ label }: { label: string }) {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center text-cz-2" title={label} aria-label={label}>
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <path d="M5 2l-3 2 1.5 3L5 6v8h6V6l1.5 1L14 4l-3-2c0 1-1 2-3 2S5 3 5 2z" />
      </svg>
    </span>
  );
}

/** Firkantet status-mærke (5 px radius, hairline): ingen nye pille-stile (P8). */
function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" }) {
  const t = tone === "accent" ? "border-cz-accent/40 text-cz-accent-t" : "border-cz-border text-cz-2";
  return <span className={`inline-flex h-4 items-center rounded-cz border px-1 font-data text-3xs font-semibold uppercase tracking-wide ${t}`}>{children}</span>;
}

/** 44 px trykflade med lille synlig tekst: P16-gulvet via padding. */
function TextAction({ children, gold = false }: { children: ReactNode; gold?: boolean }) {
  return (
    <button type="button" className={`inline-flex min-h-11 min-w-11 items-center gap-1 px-1 text-sm font-medium ${gold ? "text-cz-accent-t" : "text-cz-2"}`}>
      {children}
    </button>
  );
}

function Btn({ children, variant = "secondary", full = false }: { children: ReactNode; variant?: "primary" | "secondary"; full?: boolean }) {
  const v = variant === "primary"
    ? "bg-cz-accent text-cz-on-accent border-transparent"
    : "bg-transparent text-cz-1 border-cz-border";
  return (
    <button type="button" className={`inline-flex min-h-11 min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-cz border px-4 text-sm font-semibold ${v} ${full ? "w-full" : ""}`}>
      {children}
    </button>
  );
}

function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-cz border border-cz-border bg-cz-card ${className}`}>{children}</section>;
}

function HeroStats({ items }: { items: { label: string; value: ReactNode; gold?: boolean }[] }) {
  return (
    <div className={`mt-4 grid ${items.length >= 5 ? "grid-cols-3" : "grid-cols-2"} gap-x-4 gap-y-3 border-t border-cz-border pt-3`}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <div className="mb-0.5 font-data text-3xs font-semibold uppercase tracking-widest text-cz-3">{it.label}</div>
          <div className={`font-data text-[17px] font-[650] leading-tight tabular-nums ${it.gold ? "text-cz-accent-t" : "text-cz-1"}`}>{it.value}</div>
        </div>
      ))}
    </div>
  );
}

/** Kanoniske underline-faner. `more` = opak "mere"-markør til højre (rettelse 12). */
function TabRow({ tabs, active = 0, more = false }: { tabs: string[]; active?: number; more?: boolean }) {
  return (
    <div className="relative mt-4 border-b border-cz-border">
      <div className="flex gap-1 overflow-hidden">
        {tabs.map((t, i) => (
          <button key={t} type="button"
            className={`-mb-px min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium ${i === active ? "border-cz-accent text-cz-1" : "border-transparent text-cz-3"}`}>
            {t}
          </button>
        ))}
      </div>
      {more && (
        <button type="button" aria-label="More tabs"
          className="absolute end-0 top-0 inline-flex h-11 w-11 items-center justify-center border-s border-cz-border bg-cz-body text-cz-2">
          <Icon name="chevron" className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function Chips({ items, active = [0, 1, 2] }: { items: string[]; active?: number[] }) {
  return (
    <div className="mb-2 flex items-center gap-1.5 overflow-hidden">
      {items.map((c, i) => (
        <button key={c} type="button"
          className={`inline-flex min-h-11 shrink-0 items-center rounded-cz-pill border px-3 font-data text-2xs font-semibold uppercase tracking-wide ${active.includes(i) ? "border-cz-1 text-cz-1" : "border-cz-border text-cz-3"}`}>
          {c}
        </button>
      ))}
      <button type="button" className="ms-auto inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-cz-pill border border-cz-1 px-3 font-data text-2xs font-semibold uppercase tracking-wide text-cz-1">
        <Icon name="table" className="h-3.5 w-3.5" />Full table
      </button>
    </div>
  );
}

function Th({ children, right = false, w }: { children: ReactNode; right?: boolean; w?: string }) {
  return <th className={`px-2 py-2 font-data text-2xs font-semibold uppercase tracking-wide text-cz-3 ${right ? "text-right" : "text-left"} ${w ?? ""}`}>{children}</th>;
}

/* ── app-rammen: topbjælke + bundnavigation som i appen ────────────────── */

function Phone({ children, nav = "Dashboard", sheet }: { children: ReactNode; nav?: string; sheet?: ReactNode }) {
  const tabs: [string, string][] = [["home", "Dashboard"], ["inbox", "Inbox"], ["bag", "Market"], ["users", "Riders"], ["star", "My Team"]];
  return (
    <div className="relative mx-auto h-[844px] w-[390px] overflow-hidden bg-cz-body text-cz-1">
      <header className="flex h-12 items-center justify-between bg-cz-sidebar px-2 text-cz-sidebar-1">
        <span className="inline-flex h-11 w-11 items-center justify-center"><Icon name="menu" /></span>
        <span className="font-display text-[15px] tracking-wide text-cz-accent">CYCLING ZONE</span>
        <span className="inline-flex h-11 w-11 items-center justify-center"><Icon name="bell" /></span>
      </header>
      <main className="h-[740px] overflow-hidden px-4 pt-4">{children}</main>
      {sheet}
      <nav className="absolute inset-x-0 bottom-0 grid h-14 grid-cols-5 border-t border-cz-sidebar-border bg-cz-sidebar">
        {tabs.map(([icon, label]) => (
          <span key={label} className={`flex flex-col items-center justify-center gap-0.5 text-2xs ${label === nav ? "text-cz-accent" : "text-cz-sidebar-2"}`}>
            <Icon name={icon} className="h-5 w-5" />{label}
          </span>
        ))}
      </nav>
    </div>
  );
}

function PageTitle({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <h1 className="text-[22px] font-bold leading-tight tracking-tight">{title}</h1>
        {sub && <div className="mt-0.5 text-sm text-cz-3">{sub}</div>}
      </div>
      {action}
    </div>
  );
}

/* ── seed-ryttere (spejler preview-mocken) ─────────────────────────────── */

type Rider = { first: string; last: string; nat: string; age: number; rating: number; type: string; value: string; salary: string; pot?: string; badges?: ReactNode; status?: string };
const ADA: Rider = { first: "Ada", last: "Pedersen", nat: "dk", age: 24, rating: 29, type: "Sprint", value: "1,680,000", salary: "42,000", pot: "40–48", status: "U25",
  badges: <><Jersey label="U23 world champion" /><Icon name="star" className="h-3.5 w-3.5 text-cz-accent-t" /></> };
const MIKKEL: Rider = { first: "Mikkel", last: "Hansen", nat: "dk", age: 29, rating: 26, type: "Climb", value: "1,400,000", salary: "140,000", status: "AUC",
  badges: <Jersey label="World champion" /> };
const EMIL: Rider = { first: "Emil", last: "Vestergaard", nat: "dk", age: 21, rating: 15, type: "Climb", value: "240,000", salary: "14,000" };
const NOAH: Rider = { first: "Noah", last: "Brandt", nat: "de", age: 20, rating: 15, type: "ITT", value: "195,000", salary: "12,500" };
const MATEO: Rider = { first: "Mateo", last: "Ferrer", nat: "es", age: 22, rating: 14, type: "Punch", value: "210,000", salary: "13,000" };

/** Navnecellen efter rettelse 1: navnet ejer linje 1 (knækker kun mellem ord),
 *  nation · alder · status · mærker står i underlinjen. Rækkefølge efter P12. */
function NameCell({ r }: { r: Rider }) {
  return (
    <div className="min-w-0">
      <a className="block text-[14px] font-medium leading-snug text-cz-1 [overflow-wrap:normal] [word-break:normal] after:absolute after:inset-0 after:content-['']">{r.first.charAt(0)}. {r.last}</a>
      <div className="mt-0.5 flex flex-wrap items-center gap-1 font-data text-3xs uppercase text-cz-3">
        <Flag code={r.nat} />{r.nat === "dk" ? "DEN" : r.nat === "de" ? "GER" : "ESP"} · {r.age}
        {r.status && <Tag>{r.status}</Tag>}
        {r.badges}
      </div>
    </div>
  );
}

function RiderTable({ riders, cols }: { riders: Rider[]; cols: [string, (r: Rider) => ReactNode][] }) {
  return (
    <Card className="overflow-hidden">
      <table className="w-full table-fixed border-collapse" data-sort-exempt="statisk skitse, ingen data">
        <colgroup><col /><col className="w-[60px]" /><col className="w-[92px]" /><col className="w-[78px]" /></colgroup>
        <thead className="border-b border-cz-border"><tr><Th>Rider</Th>{cols.map(([h], i) => <Th key={h} right={i > 0}>{h}</Th>)}</tr></thead>
        <tbody>
          {riders.map((r) => (
            <tr key={r.last} className="relative border-b border-cz-border last:border-b-0">
              <td className="px-2 py-2.5 align-middle"><NameCell r={r} /></td>
              {cols.map(([h, f], i) => <td key={h} className={`px-2 py-2.5 align-middle font-data text-[14px] tabular-nums ${i > 0 ? "text-right" : "text-center"}`}>{f(r)}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </Card>
  );
}

const scoutCell = (r: Rider) => r.pot
  ? <span className="inline-flex flex-col items-end"><span>{r.pot}</span><span className="font-data text-3xs text-cz-3">3/3</span></span>
  : <button type="button" className="relative z-10 -my-2 inline-flex min-h-11 items-center gap-1 text-[13px] text-cz-2"><Icon name="scout" className="h-3.5 w-3.5" />Scout</button>;

/* ── de ti skitser ─────────────────────────────────────────────────────── */

function Fix1() {
  return (
    <Phone nav="Riders">
      <PageTitle title="Rider Database" sub="2 riders" />
      <div className="mt-3 flex gap-2">
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-sm text-cz-3"><Icon name="search" className="h-4 w-4" />Search rider</label>
        <Btn><Icon name="filter" className="h-4 w-4" />Filters</Btn>
      </div>
      <div className="mt-3"><Chips items={["Rating", "Value", "Potential"]} /></div>
      <RiderTable riders={[ADA, MIKKEL, EMIL]} cols={[["Rating", (r) => <Rating value={r.rating} type={r.type} />], ["Value", (r) => <span className="text-cz-accent-t">{r.value}</span>], ["Potential", scoutCell]]} />
      <p className="mt-2 text-xs text-cz-3">Name owns line 1 and wraps only between words. Nation, age, status and badges sit on line 2. The whole row is the tap area.</p>
    </Phone>
  );
}

function Fix2() {
  return (
    <Phone nav="Dashboard">
      <PageTitle title="E2E Racing" sub="Division 2 · 1 rider"
        action={<div className="text-right"><div className="font-data text-[20px] font-[650] tabular-nums text-cz-accent-t">450,000 CZ$</div><div className="font-data text-3xs text-cz-3">50,000 CZ$ locked in bids</div></div>} />
      <Card className="mt-4 p-4">
        <div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">How your team did</h2><TextAction gold>Full result<Icon name="chevron" className="h-4 w-4" /></TextAction></div>
        <HeroStats items={[{ label: "Races", value: "2" }, { label: "Points", value: "125" }, { label: "Prize money", value: "334,000 CZ$", gold: true }, { label: "Stage wins", value: "1" }]} />
        <div className="mt-3 border-t border-cz-border pt-3 text-sm text-cz-3">Giro di Preview · 2 stages</div>
        <div className="mt-1 flex items-center gap-3"><span className="font-display text-[28px] leading-none">#2</span><Flag code="dk" /><span className="text-[15px]">Ada Pedersen</span><span className="ms-auto font-data text-sm tabular-nums text-cz-3">+0:22</span></div>
        <div className="mt-2 text-sm text-cz-2">Mikkel Hansen soloed clear to win by 0:22.</div>
      </Card>
      <div className="mt-4 divide-y divide-cz-border rounded-cz border border-cz-border bg-cz-card">
        <button type="button" className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm"><span className="flex-1">Sign up for season 2 to keep your spot</span><Icon name="chevron" className="h-4 w-4 text-cz-3" /></button>
        <button type="button" className="flex min-h-11 w-full items-center gap-3 px-4 text-left text-sm"><span className="flex-1">Help pick what we build next · 5 min</span><Icon name="chevron" className="h-4 w-4 text-cz-3" /></button>
      </div>
      <Card className="mt-4 p-4"><div className="flex items-center justify-between"><h2 className="text-[15px] font-semibold">Next race</h2><TextAction>Calendar</TextAction></div><div className="text-sm text-cz-2">Tour de Preview · Race days 13–15</div></Card>
    </Phone>
  );
}

function Fix3() {
  return (
    <Phone nav="Market">
      <PageTitle title="Auctions" sub="Balance 500,000 CZ$ · 0 recent bids" action={<Btn>Live bids</Btn>} />
      <TabRow tabs={["My auctions (0)", "All (1)", "Other managers (1)"]} active={1} />
      <a className="mt-1 flex min-h-11 items-center gap-2 text-sm text-cz-2"><Icon name="info" className="h-4 w-4" />How auctions work<Icon name="chevron" className="ms-auto h-4 w-4 text-cz-3" /></a>
      <div className="flex gap-2">
        <label className="flex min-h-11 flex-1 items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-sm text-cz-3"><Icon name="search" className="h-4 w-4" />Search riders</label>
        <Btn><Icon name="filter" className="h-4 w-4" />Filters</Btn>
      </div>
      <Card className="mt-3 p-4">
        <div className="flex items-start justify-between gap-2">
          <NameCell r={MIKKEL} />
          <div className="text-right"><div className="font-data text-3xs uppercase tracking-widest text-cz-3">Time left</div><div className="font-data text-[15px] font-semibold tabular-nums">5h 59m</div></div>
        </div>
        <HeroStats items={[{ label: "Highest bid", value: "50,000 CZ$" }, { label: "Est. value", value: "1,400,000 CZ$" }, { label: "Salary", value: "140,000 CZ$" }, { label: "Seller", value: "Manager" }]} />
        <div className="mt-4 flex gap-2">
          <div className="flex min-h-11 flex-1 items-center rounded-cz border border-cz-border bg-cz-body px-3 font-data text-[15px] tabular-nums">50,000</div>
          <Btn variant="primary">Bid</Btn>
        </div>
        <div className="mt-1 flex items-center justify-between"><span className="font-data text-3xs text-cz-3">Min. bid 50,000 CZ$</span><TextAction>Set auto-bid limit</TextAction></div>
      </Card>
    </Phone>
  );
}

function Fix4() {
  return (
    <Phone nav="Dashboard">
      <PageTitle title="Planning" />
      <div className="mt-3 inline-flex rounded-cz border border-cz-border">
        <button type="button" className="min-h-11 px-4 text-sm text-cz-2">Season</button>
        <button type="button" className="min-h-11 border-s border-cz-border bg-cz-accent/10 px-4 text-sm font-medium text-cz-accent-t">Day</button>
      </div>
      <div className="mt-3 flex items-center gap-1">
        <button type="button" aria-label="Previous day" className="inline-flex h-11 w-11 items-center justify-center text-cz-2"><Icon name="back" className="h-4 w-4" /></button>
        {[10, 11, 12, 13, 14].map((d) => (
          <button key={d} type="button" className={`flex h-11 flex-1 items-center justify-center rounded-cz border font-data text-xs tabular-nums ${d === 12 ? "border-cz-accent text-cz-accent-t" : "border-cz-border text-cz-3"}`}>{d}</button>
        ))}
        <button type="button" aria-label="Next day" className="inline-flex h-11 w-11 items-center justify-center text-cz-2"><Icon name="chevron" className="h-4 w-4" /></button>
      </div>
      <Card className="mt-4">
        <div className="p-4 pb-2"><h2 className="text-[15px] font-semibold">Tour de Preview</h2><div className="text-sm text-cz-3">Race days 13–15 · 3 stages</div></div>
        <div className="flex items-center gap-2 border-t border-cz-border px-4 py-1">
          <Flag code="dk" /><span className="flex-1 text-sm">Ada Pedersen</span>
          <button type="button" aria-label="Remove rider" className="inline-flex h-11 w-11 items-center justify-center text-cz-3"><svg viewBox="0 0 24 24" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.6}><path d="M6 6l12 12M18 6L6 18" /></svg></button>
        </div>
        <div className="flex items-center justify-between border-t border-cz-border px-2"><TextAction>Clear selection</TextAction><TextAction>Withdraw</TextAction></div>
      </Card>
      <div className="mt-4 flex items-center gap-1 border-y border-cz-border">
        <TextAction gold>Auto-fill</TextAction><TextAction>Clear day</TextAction><TextAction>Clear all</TextAction>
      </div>
      <p className="mt-3 text-xs text-cz-3">Same text size as today. Every tap area is 44 × 44 px through padding, so the screen looks the same but the finger always hits.</p>
    </Phone>
  );
}

function Fix5() {
  const sheet = (
    <div className="absolute inset-x-0 bottom-14 rounded-t-cz border-t border-cz-border-strong bg-cz-card">
      <div className="mx-auto mt-2 h-1 w-10 rounded-cz-pill bg-cz-border-strong" />
      <div className="flex items-center justify-between px-4 pt-2"><h2 className="text-[15px] font-semibold">Add riders · Tour de Preview</h2><span className="font-data text-xs tabular-nums text-cz-3">1 / 8</span></div>
      <div className="px-4 font-data text-3xs uppercase tracking-widest text-cz-3">Available · 1-squad</div>
      <div className="mt-2 divide-y divide-cz-border border-t border-cz-border">
        {[ADA].map((r, i) => (
          <label key={r.last} className="flex min-h-11 items-center gap-3 px-4 py-1.5">
            <span className={`inline-flex h-5 w-5 items-center justify-center rounded-cz border ${i === 0 ? "border-cz-accent bg-cz-accent text-cz-on-accent" : "border-cz-border-strong"}`}>{i === 0 && <svg viewBox="0 0 24 24" className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2}><path d="M5 12l5 5 9-10" /></svg>}</span>
            <span className="flex-1"><NameCell r={r} /></span>
            <span className="text-right font-data text-xs tabular-nums text-cz-2">Form 60<br /><span className="text-cz-3">Rested 3d</span></span>
          </label>
        ))}
      </div>
      <div className="flex gap-2 border-t border-cz-border p-3"><Btn>Auto-fill</Btn><Btn variant="primary" full>Add 1 rider</Btn></div>
    </div>
  );
  return (
    <Phone nav="Dashboard" sheet={sheet}>
      <PageTitle title="Planning" />
      <TabRow tabs={["Team selection", "Form plan", "Strategy"]} more />
      <div className="mt-3 text-sm font-semibold text-cz-accent-t">Race day 13</div>
      <Card className="mt-2 p-4">
        <h2 className="text-[15px] font-semibold">Tour de Preview</h2>
        <div className="text-sm text-cz-3">Race days 13–15 · Aug 31 – Sep 2 · 3 stages</div>
        <div className="mt-2 flex items-center gap-2"><Tag tone="accent">1 / 8 · Understaffed</Tag><span className="text-xs text-cz-2">Needs 6 to start</span></div>
      </Card>
      <Card className="mt-3 p-4"><h2 className="text-[15px] font-semibold">Critérium Preview</h2><div className="text-sm text-cz-3">Race day 13 · One-day race</div></Card>
    </Phone>
  );
}

function Fix6() {
  return (
    <Phone nav="Dashboard">
      <PageTitle title="Rankings" />
      <TabRow tabs={["League & standings", "Rider Rankings", "Global"]} more />
      <label className="mt-3 flex min-h-11 items-center gap-2 rounded-cz border border-cz-border bg-cz-card px-3 text-sm text-cz-3"><Icon name="search" className="h-4 w-4" />Search teams</label>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {["Division 2 (2)", "Standings"].map((s) => (
          <span key={s} className="flex min-h-11 items-center justify-between rounded-cz border border-cz-border bg-cz-card px-3 text-sm">{s}<Icon name="chevronDown" className="h-4 w-4 text-cz-3" /></span>
        ))}
      </div>
      <div className="mt-3"><Chips items={["Wins", "Prize", "Points"]} /></div>
      <Card className="overflow-hidden">
        <table className="w-full border-collapse" data-sort-exempt="statisk skitse, ingen data">
          <thead className="border-b border-cz-border"><tr><Th>Team</Th><Th right>Wins</Th><Th right>Prize</Th><Th right>Points</Th></tr></thead>
          <tbody>
            {[["1", "Regression VC", "4", "0", "6,120", "Leader"], ["2", "E2E Racing", "1", "194,000", "5,480", ""]].map(([pos, name, w, p, pts, tag]) => (
              <tr key={name} className="border-b border-cz-border last:border-b-0">
                <td className="px-2 py-2.5"><div className="flex items-center gap-2"><span className="w-4 font-data text-sm tabular-nums text-cz-3">{pos}</span><span className="text-[14px] font-medium">{name}</span></div>{tag && <div className="ms-6 mt-1"><Tag tone="accent">{tag}</Tag></div>}</td>
                <td className="px-2 text-right font-data tabular-nums">{w}</td><td className="px-2 text-right font-data tabular-nums">{p}</td><td className="px-2 text-right font-data font-semibold tabular-nums">{pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="border-t border-cz-border px-3 py-2 font-data text-3xs text-cz-3">Top 2 up, bottom 4 down per pool · Relegation starts when Division 3 opens</div>
      </Card>
      <p className="mt-2 text-xs text-cz-3">Tick two rows to compare. The Compare button only shows once two are ticked.</p>
    </Phone>
  );
}

function Fix7() {
  return (
    <Phone nav="Riders">
      <a className="-ms-2 inline-flex min-h-11 items-center gap-1 px-2 text-sm text-cz-2"><Icon name="back" className="h-4 w-4" />Back</a>
      <Card className="border-t-2 border-t-cz-accent p-4">
        <div className="flex items-start gap-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5"><h1 className="font-display text-[30px] leading-none tracking-wide">ADA PEDERSEN</h1><Jersey label="U23 world champion" /><Icon name="star" className="h-4 w-4 text-cz-accent-t" /></div>
            <div className="mt-1 flex flex-wrap items-center gap-1.5 font-data text-xs text-cz-2"><Flag code="dk" />DEN · 24 yrs · <a className="-my-3 inline-block py-3 text-cz-1 underline decoration-cz-border underline-offset-2">E2E Racing</a> · <Tag>U25</Tag></div>
            <div className="mt-1 text-xs text-cz-3">Natural Sprinter / Rouleur</div>
          </div>
          <Rating value={29} type="Sprint" />
        </div>
        <HeroStats items={[{ label: "Market value", value: "1,680,000" }, { label: "Salary", value: "42,000" }, { label: "Projected", value: "40–48" }, { label: "Contract", value: "Season 4" }]} />
        <div className="mt-3 flex items-center gap-2 rounded-cz border border-cz-border bg-cz-elevated px-3 py-1">
          <span className="flex-1 text-sm">On auction · <span className="font-data tabular-nums">50,000 CZ$</span> · <span className="font-data tabular-nums">5h 59m</span></span>
          <Btn variant="primary">Bid</Btn>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <Btn><Icon name="star" className="h-4 w-4" /></Btn><Btn>Compare</Btn>
          <button type="button" className="ms-auto inline-flex min-h-11 items-center gap-1 text-sm text-cz-2">Manage contract<Icon name="chevron" className="h-4 w-4" /></button>
        </div>
      </Card>
      <TabRow tabs={["Overview", "Physiology", "Training", "Development"]} more />
      <Card className="mt-3 p-4">
        <div className="mb-2 font-data text-2xs font-semibold uppercase tracking-widest text-cz-3">Physical · 10 abilities</div>
        {[["Climbing", 19], ["Tempo", 23], ["Punch", 26], ["Sprint", 31]].map(([k, v]) => (
          <div key={k} className="flex justify-between border-t border-cz-border py-1.5 text-sm"><span>{k}</span><span className="font-data font-semibold tabular-nums">{v}</span></div>
        ))}
      </Card>
    </Phone>
  );
}

function Fix8() {
  return (
    <Phone nav="My Team">
      <Card className="p-4">
        <PageTitle title="E2E Racing" sub="Manager: Playwright Manager" />
        <HeroStats items={[{ label: "Balance", value: "500,000", gold: true }, { label: "Division", value: "2" }, { label: "Senior riders", value: "1/30" }, { label: "Salary/season", value: "42,000" }, { label: "Team value", value: "1,680,000" }]} />
        <a className="mt-3 flex min-h-11 items-center gap-2 border-t border-cz-border pt-1 text-sm text-cz-2">1 rider on auction<Icon name="chevron" className="ms-auto h-4 w-4 text-cz-3" /></a>
      </Card>
      <TabRow tabs={["Squad (1)", "Contracts", "Development", "Stats"]} more />
      <div className="mt-3"><Chips items={["Overview", "Abilities"]} active={[0]} /></div>
      <RiderTable riders={[ADA]} cols={[["Rating", (r) => <Rating value={r.rating} type={r.type} />], ["Value", (r) => <span className="text-cz-accent-t">{r.value}</span>], ["Salary", (r) => r.salary]]} />
      <p className="mt-2 text-xs text-cz-3">Same header on /squads/u23 and /squads/junior. Overview / Abilities moves into the chip row (fix 13).</p>
    </Phone>
  );
}

function Fix9() {
  const Row = ({ title, body, meta, unread }: { title: string; body: string; meta: string; unread: boolean }) => (
    <div className="flex items-stretch border-b border-cz-border last:border-b-0">
      <a className="flex min-h-11 flex-1 gap-3 py-3 ps-3">
        <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-cz-pill ${unread ? "bg-cz-accent" : "bg-transparent"}`} />
        <span className="min-w-0">
          <span className="block text-[15px] font-medium leading-snug">{title}</span>
          <span className="mt-0.5 block text-sm text-cz-2">{body}</span>
          <span className="mt-1 block font-data text-3xs text-cz-3">{meta}</span>
        </span>
      </a>
      <button type="button" aria-label="More actions" className="inline-flex w-11 shrink-0 items-start justify-center pt-3 text-cz-3"><span className="inline-flex h-11 w-11 items-center justify-center"><Icon name="more" className="h-5 w-5" /></span></button>
    </div>
  );
  return (
    <Phone nav="Inbox">
      <PageTitle title="Inbox" sub="7 unread" action={<Btn>Mark all read</Btn>} />
      <TabRow tabs={["Mine 7", "To handle", "League", "My Activity"]} more />
      <Card className="mt-3">
        <Row unread title="Your auto-bid held the lead (×4)" body="Northwind Cycling tried to outbid you on Théo Journal. Your auto-bid rose to 412,000 CZ$." meta="First Aug 5 · Latest Aug 5" />
        <Row unread title="Your auto-bid held the lead (×3)" body="Alpine Grit tried to outbid you on Mats Verhoeven. Your auto-bid rose to 214,000 CZ$." meta="Includes 2 where you lost the lead" />
      </Card>
      <p className="mt-2 text-xs text-cz-3">The whole row opens the message. Delete sits in the More sheet (or swipe left), so it can no longer be hit by mistake. Colours follow #8260.</p>
    </Phone>
  );
}

function Fix12() {
  return (
    <Phone nav="Inbox">
      <PageTitle title="Inbox" sub="7 unread" action={<Btn>Mark all read</Btn>} />
      <TabRow tabs={["Mine 7", "To handle", "League", "My Activity", "Messages"]} more />
      <div className="mt-3 grid grid-cols-2 gap-3 text-xs text-cz-2">
        <Card className="p-3"><div className="font-data text-3xs uppercase tracking-widest text-cz-3">Before</div>Last tab is cut ("My Activit") and nothing says more exist.</Card>
        <Card className="p-3"><div className="font-data text-3xs uppercase tracking-widest text-cz-3">After</div>Opaque chevron field with a hairline, same as DataTable's "more to the right". Tap scrolls one tab on.</Card>
      </div>
      <div className="mt-4 font-data text-3xs uppercase tracking-widest text-cz-3">Same marker on</div>
      <TabRow tabs={["Squad (3)", "Calendar", "Results", "Standings"]} more />
      <TabRow tabs={["Overview", "Physiology", "Training", "Development"]} more />
    </Phone>
  );
}

const FIXES: Record<string, () => ReactNode> = { 1: Fix1, 2: Fix2, 3: Fix3, 4: Fix4, 5: Fix5, 6: Fix6, 7: Fix7, 8: Fix8, 9: Fix9, 12: Fix12 };

export function SketchApp() {
  const fix = new URLSearchParams(window.location.search).get("fix") ?? "1";
  const Sketch = FIXES[fix] ?? Fix1;
  return <Sketch />;
}
