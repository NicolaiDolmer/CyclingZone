// Fælles byggesten til skitserne (#8280). Bygger videre på kittet i
// mobil-top15-skitsen (PR #8236): appens egne tokens og Tailwind-klasser, så
// skitsen følger TASTE/PAGE_TEMPLATES (hairlines, 5 px radius, ingen skygger,
// én gold primary pr. view). Ingen app-logik, intet netværk.
import type { ReactNode } from "react";
import { statColor, INK_DARK, INK_LIGHT, contrastRatio } from "../../../lib/statColor.js";

export const SHOW_MARKS = new URLSearchParams(window.location.search).get("marks") !== "0";

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
  chevronUp: "M6 15l6-6 6 6",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14zM20 20l-4-4",
  filter: "M4 6h16l-6 7v5l-4 2v-7z",
  sliders: "M4 7h10M18 7h2M4 17h4M12 17h8M14 5v4M8 15v4",
  more: "M5 12h.01M12 12h.01M19 12h.01",
  back: "M15 6l-6 6 6 6",
  table: "M4 5h16v14H4zM4 10h16M10 10v9",
  columns: "M4 5h16v14H4zM9.5 5v14M14.5 5v14",
  sortDown: "M12 5v14M7 14l5 5 5-5",
  sortUp: "M12 19V5M7 10l5-5 5 5",
  sort: "M8 5v14M5 16l3 3 3-3M16 19V5M13 8l3-3 3 3",
  user: "M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8zM5 20a7 7 0 0 1 14 0",
  info: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 11v5M12 8h.01",
  gavel: "M14 4l6 6M11 7l6 6M12.5 8.5l-8 8 3 3 8-8M3 21h8",
  bolt: "M13 3L5 14h6l-1 7 8-11h-6z",
  exchange: "M4 8h13l-3-3M20 16H7l3 3",
  flag: "M5 21V4M5 4h12l-2 4 2 4H5",
  trophy: "M8 4h8v5a4 4 0 0 1-8 0zM8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4M12 13v4M8 20h8M10 17h4",
  coin: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9.5c0-1.2 1.1-2 2.5-2s2.5.8 2.5 2-1.1 1.6-2.5 2-2.5.9-2.5 2 1.1 2 2.5 2 2.5-.8 2.5-2M12 6v1.5M12 16.5V18",
  clock: "M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM12 7v5l3 2",
  check: "M5 12l5 5 9-10",
  x: "M6 6l12 12M18 6L6 18",
  dots: "M12 6h.01M12 12h.01M12 18h.01",
};

export function Icon({ name, className = "h-5 w-5" }: { name: string; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.6}
      strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={ICONS[name] ?? ""} />
    </svg>
  );
}

const NAT: Record<string, string> = { dk: "DEN", de: "GER", es: "ESP", fr: "FRA", nl: "NED", be: "BEL" };
export function Flag({ code }: { code: string }) {
  return <span className={`fi fi-${code} shrink-0`} role="img" aria-label={NAT[code] ?? code} />;
}
export const natLabel = (code: string) => NAT[code] ?? code;

/** Rating-pladen: samme farve og blæk som appens (statColor, rating-skala). */
export function Rating({ value, type, size = "md" }: { value: number; type?: string; size?: "md" | "lg" }) {
  const bg = statColor(value, { scale: "rating" });
  const ink = contrastRatio(bg, INK_LIGHT) >= contrastRatio(bg, INK_DARK) ? INK_LIGHT : INK_DARK;
  const box = size === "lg" ? "h-10 min-w-11 text-[22px]" : "h-7 min-w-8 text-[15px]";
  return (
    <span className="inline-flex flex-col items-center gap-0.5">
      <span className={`inline-flex items-center justify-center rounded-cz px-1.5 font-data font-[650] tabular-nums ${box}`}
        style={{ background: bg, color: ink }}>{value}</span>
      {type && <span className="font-data text-3xs text-cz-3">{type}</span>}
    </span>
  );
}

/** Mestertrøje-mærke i 16 px (P12-undtagelsen), tegnet som omrids i skitsen. */
export function Jersey({ label }: { label: string }) {
  return (
    <span className="inline-flex h-4 w-4 items-center justify-center text-cz-2" title={label} aria-label={label}>
      <svg viewBox="0 0 16 16" className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={1.2}>
        <path d="M5 2l-3 2 1.5 3L5 6v8h6V6l1.5 1L14 4l-3-2c0 1-1 2-3 2S5 3 5 2z" />
      </svg>
    </span>
  );
}

/** Firkantet status-mærke (5 px radius, hairline): ingen nye pille-stile (P8). */
export function Tag({ children, tone = "neutral" }: { children: ReactNode; tone?: "neutral" | "accent" | "danger" }) {
  const t = tone === "accent" ? "border-cz-accent/40 text-cz-accent-t" : tone === "danger" ? "border-cz-danger/40 text-cz-danger" : "border-cz-border text-cz-2";
  return <span className={`inline-flex h-4 items-center rounded-cz border px-1 font-data text-3xs font-semibold uppercase tracking-wide ${t}`}>{children}</span>;
}

export function Btn({ children, variant = "secondary", full = false, size = "md", className = "" }: { children: ReactNode; variant?: "primary" | "secondary" | "ghost"; full?: boolean; size?: "md" | "sm"; className?: string }) {
  const v = variant === "primary"
    ? "bg-cz-accent text-cz-on-accent border-transparent"
    : variant === "ghost" ? "bg-transparent text-cz-2 border-transparent" : "bg-cz-card text-cz-1 border-cz-border";
  const s = size === "sm" ? "min-h-8 px-3 text-xs [@media(max-width:640px)]:min-h-11" : "min-h-11 px-4 text-sm";
  return (
    <button type="button" className={`inline-flex min-w-11 items-center justify-center gap-2 whitespace-nowrap rounded-cz border font-semibold ${s} ${v} ${full ? "w-full" : ""} ${className}`}>
      {children}
    </button>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <section className={`rounded-cz border border-cz-border bg-cz-card ${className}`}>{children}</section>;
}

/** Kanonisk Segmented (components/ui/Segmented.jsx): hairline-gruppe, 5 px,
 *  aktivt segment = guld-tekst på 10 % guld-flade, 44 px på touch. */
export function Segmented({ options, active = 0, className = "", grow = false }: { options: ReactNode[]; active?: number; className?: string; grow?: boolean }) {
  return (
    <div role="group" className={`inline-flex overflow-hidden rounded-cz border border-cz-border ${grow ? "w-full" : ""} ${className}`}>
      {options.map((o, i) => (
        <button key={i} type="button" aria-pressed={i === active}
          className={`inline-flex min-h-9 items-center justify-center gap-1.5 whitespace-nowrap px-3 text-xs font-medium [@media(max-width:640px)]:min-h-11 ${grow ? "flex-1" : ""} ${i > 0 ? "border-s border-cz-border" : ""} ${i === active ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-card text-cz-2"}`}>
          {o}
        </button>
      ))}
    </div>
  );
}

export function TabRow({ tabs, active = 0, more = false, className = "mt-4" }: { tabs: string[]; active?: number; more?: boolean; className?: string }) {
  return (
    <div className={`relative border-b border-cz-border ${className}`}>
      <div className="flex gap-1 overflow-hidden">
        {tabs.map((t, i) => (
          <button key={t} type="button"
            className={`-mb-px min-h-11 shrink-0 whitespace-nowrap border-b-2 px-3 text-sm font-medium ${i === active ? "border-cz-accent text-cz-1" : "border-transparent text-cz-3"}`}>
            {t}
          </button>
        ))}
      </div>
      {more && (
        <span className="absolute right-0 top-0 inline-flex h-11 w-11 items-center justify-center border-s border-cz-border bg-cz-body text-cz-2">
          <Icon name="chevron" className="h-4 w-4" />
        </span>
      )}
    </div>
  );
}

export function HeroStats({ items, cols }: { items: { label: string; value: ReactNode; sub?: ReactNode }[]; cols?: string }) {
  return (
    <div className={`grid ${cols ?? "grid-cols-2 sm:grid-cols-4"} gap-x-4 gap-y-3`}>
      {items.map((it) => (
        <div key={it.label} className="min-w-0">
          <div className="mb-0.5 font-data text-3xs font-semibold uppercase tracking-widest text-cz-3">{it.label}</div>
          <div className="font-data text-[17px] font-[650] leading-tight tabular-nums text-cz-1">{it.value}</div>
          {it.sub && <div className="mt-0.5 font-data text-2xs text-cz-3">{it.sub}</div>}
        </div>
      ))}
    </div>
  );
}

/** Nummereret markør til billederne (P17: nummererede noter der peger på
 *  billedet). Kun i skitsen; slås fra med ?marks=0. Bevidst rå mørk plade, så
 *  den aldrig forveksles med spillets egne mærker. */
export function Mark({ n, className = "" }: { n: number; className?: string }) {
  if (!SHOW_MARKS) return null;
  return (
    <span data-mark className={`pointer-events-none z-20 inline-flex h-5 min-w-5 items-center justify-center rounded-cz bg-cz-danger px-1 font-data text-2xs font-bold leading-none text-white ${className}`}>{n}</span>
  );
}

/* ── app-rammer ──────────────────────────────────────────────────────── */

export function Phone({ children, nav = "Dashboard" }: { children: ReactNode; nav?: string }) {
  const tabs: [string, string][] = [["home", "Dashboard"], ["inbox", "Inbox"], ["bag", "Market"], ["users", "Riders"], ["star", "My Team"]];
  return (
    <div className="relative mx-auto h-[844px] w-[390px] overflow-hidden bg-cz-body text-cz-1">
      <header className="flex h-12 items-center justify-between bg-cz-sidebar px-2 text-cz-sidebar-1">
        <span className="inline-flex h-11 w-11 items-center justify-center"><Icon name="menu" /></span>
        <span className="font-display text-[15px] tracking-wide text-cz-accent">CYCLING ZONE</span>
        <span className="inline-flex h-11 w-11 items-center justify-center"><Icon name="bell" /></span>
      </header>
      <main className="h-[740px] overflow-hidden px-4 pt-4">{children}</main>
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

/** Desktop-ramme 1440 × 900 med appens sidebjælke (forenklet). */
export function Desktop({ children, nav = "Riders" }: { children: ReactNode; nav?: string }) {
  const groups: [string, string[]][] = [["Clubhouse", []], ["Planning", []], ["Market", ["Riders", "Auctions", "Transfers", "Transfer list", "Watchlist"]], ["Results", []]];
  return (
    <div className="flex h-[900px] w-[1440px] overflow-hidden bg-cz-body text-cz-1">
      <aside className="flex w-[208px] shrink-0 flex-col bg-cz-sidebar text-cz-sidebar-1">
        <div className="flex h-[100px] items-center justify-center border-b border-cz-sidebar-border font-display text-[22px] tracking-wide text-cz-accent">CYCLING ZONE</div>
        <div className="border-b border-cz-sidebar-border px-4 py-4">
          <div className="font-data text-3xs uppercase tracking-widest text-cz-sidebar-3">Balance</div>
          <div className="font-data text-[15px] font-bold tabular-nums text-cz-accent">500,000 CZ$</div>
          <div className="text-2xs text-cz-sidebar-3">Division 2</div>
        </div>
        <div className="px-2 py-3">
          {nav === "Inbox" && (
            <div className="mb-2 flex items-center gap-2 rounded-cz bg-cz-sidebar-hover px-3 py-2 text-sm text-cz-accent"><Icon name="inbox" className="h-4 w-4" />Inbox<span className="ms-auto font-data text-2xs">7</span></div>
          )}
          {groups.map(([g, items]) => (
            <div key={g} className="mb-1">
              <div className="px-2 py-2.5 font-data text-3xs font-semibold uppercase tracking-widest text-cz-sidebar-3">{g}</div>
              {items.map((it) => (
                <div key={it} className={`flex items-center gap-2 rounded-cz px-3 py-2 text-sm ${it === nav ? "bg-cz-sidebar-hover text-cz-accent" : "text-cz-sidebar-2"}`}>
                  <span className={`h-1.5 w-1.5 rounded-cz-pill ${it === nav ? "bg-cz-accent" : "bg-cz-sidebar-3"}`} />{it}
                </div>
              ))}
            </div>
          ))}
        </div>
      </aside>
      <main className="h-[900px] flex-1 overflow-hidden px-8 pt-8">{children}</main>
    </div>
  );
}

export function PageTitle({ title, sub, action }: { title: string; sub?: ReactNode; action?: ReactNode }) {
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
