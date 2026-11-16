// Skitse #7535 "I dag": spillets RIGTIGE app-skal, gengivet med de samme klasser og tokens som
// components/Layout.jsx (sidebjaelke, mobil-topbar, side-padding, hurtig-navigation i bunden).
// Layout selv kraever login, router og live-data, saa skitsen tegner skallen efter; teksterne er
// de engelske navne fra public/locales/en/common.json. Saldo og antal online er opdigtede.

import type { ReactNode } from "react";
import { Wordmark } from "../../../components/Brand.jsx";
import { ChevronDownIcon, ChevronLeftIcon, MenuIcon, BellIcon } from "../../../components/ui/icons";

type NavGroup = { key: string; label: string; open: boolean; items: { label: string; active?: boolean; dot?: boolean }[] };

const GROUPS: NavGroup[] = [
  { key: "klubhus", label: "Clubhouse", open: false, items: [] },
  { key: "planlaegning", label: "Planning", open: true, items: [{ label: "Planning", active: true, dot: true }] },
  { key: "marked", label: "Market", open: false, items: [] },
  { key: "resultater", label: "Results", open: false, items: [] },
];
const BOTTOM = ["My Manager Profile", "Settings", "Pro", "Help", "Rules", "Roadmap", "Patch Notes", "Contact"];

function NavItem({ label, active, dot }: { label: string; active?: boolean; dot?: boolean }) {
  return (
    <a
      href="#planning"
      onClick={(e) => e.preventDefault()}
      aria-current={active ? "page" : undefined}
      data-flow={active ? "1" : undefined}
      className={`group relative flex items-center justify-between mx-2 px-3 py-2 rounded-cz text-[13px] transition-all duration-150 ${
        active ? "bg-cz-accent/12 text-cz-accent font-medium cursor-default" : "text-cz-sidebar-2 hover:text-cz-sidebar-1 hover:bg-cz-sidebar-hover"
      }`}
    >
      <span className="flex items-center gap-2.5 min-w-0">
        <span aria-hidden="true" className={`w-1.5 h-1.5 rounded-full shrink-0 ${active ? "bg-cz-accent" : "bg-cz-sidebar-3"}`} />
        <span className="truncate">{label}</span>
      </span>
      {dot && <span aria-hidden="true" className="block w-2 h-2 rounded-full bg-cz-warning" />}
    </a>
  );
}

function Sidebar() {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center px-4 py-6 border-b border-cz-sidebar-border w-full">
        <div className="w-full min-w-0"><Wordmark forceDark className="w-full h-auto" alt="" /></div>
      </div>
      <div className="px-4 py-3 border-b border-cz-sidebar-border">
        <p className="text-3xs text-cz-sidebar-3 uppercase tracking-widest mb-0.5">Balance</p>
        <p className="text-cz-accent font-mono font-bold text-sm leading-tight">812,400 CZ$</p>
        <p className="text-cz-sidebar-3 text-3xs mt-0.5">Division 3</p>
      </div>
      <div className="px-4 py-2 border-b border-cz-sidebar-border">
        <span className="inline-flex items-center gap-1.5">
          <span className="w-1.5 h-1.5 rounded-full bg-cz-success" />
          <span className="text-cz-sidebar-3 text-3xs">14 online now</span>
        </span>
      </div>
      <nav className="flex-1 overflow-x-hidden overflow-y-auto py-2" aria-label="Sidebar">
        {GROUPS.map((g) => (
          <div key={g.key} className="mb-1">
            <div className="w-full flex items-center justify-between px-4 pt-4 pb-1">
              <span className="text-3xs font-bold uppercase tracking-[0.14em] text-cz-sidebar-3">{g.label}</span>
              <ChevronDownIcon aria-hidden="true" className={`w-3 h-3 text-cz-sidebar-3 ${g.open ? "rotate-180" : ""}`} />
            </div>
            {g.open && <div className="py-0.5">{g.items.map((it) => <NavItem key={it.label} {...it} />)}</div>}
          </div>
        ))}
        <div className="h-px bg-cz-sidebar-border my-3 mx-4" />
        <div className="px-4 pt-4 pb-1">
          <span className="text-3xs font-bold uppercase tracking-[0.14em] text-cz-sidebar-3">Account &amp; help</span>
        </div>
        {BOTTOM.map((l) => <NavItem key={l} label={l} />)}
      </nav>
      <div className="border-t border-cz-sidebar-border px-4 py-3 flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1 text-2xs text-cz-sidebar-3"><ChevronLeftIcon aria-hidden="true" className="w-3 h-3" /> Log out</span>
        <span className="inline-flex items-center gap-1.5 text-2xs text-cz-sidebar-2"><span className="fi fi-gb" aria-hidden="true" /> EN</span>
      </div>
    </div>
  );
}

const QUICK: [string, ReactNode][] = [
  ["Dashboard", <><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" /><path d="M9 22V12h6v10" /></>],
  ["Inbox", <><path d="M22 12h-6l-2 3H10l-2-3H2" /><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z" /></>],
  ["Market", <><path d="M6 2L3 6v14a2 2 0 002 2h14a2 2 0 002-2V6l-3-4z" /><line x1="3" y1="6" x2="21" y2="6" /><path d="M16 10a4 4 0 01-8 0" /></>],
  ["Riders", <><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2" /><circle cx="9" cy="7" r="4" /><path d="M23 21v-2a4 4 0 00-3-3.87" /><path d="M16 3.13a4 4 0 010 7.75" /></>],
  ["My Team", <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />],
];

/** Skallen: sidebjaelke fra md (768 px) som i appen; under md mobil-topbar og hurtig-navigation. */
export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen bg-cz-body">
      {/* appens sidebjaelke er fast (fixed); her strakt i fuld hoejde, saa et helsidebillede viser den hele vejen ned */}
      <aside className="hidden md:block w-52 shrink-0 bg-cz-sidebar border-r border-cz-sidebar-border" aria-label="App sidebar">
        <div className="sticky top-0 h-screen flex flex-col"><Sidebar /></div>
      </aside>
      <main className="flex-1 min-w-0 min-h-screen">
        <div className="md:hidden flex items-center justify-between px-4 bg-cz-sidebar border-b border-cz-sidebar-border">
          <span className="inline-flex min-h-12 min-w-12 items-center justify-center text-cz-sidebar-2">
            <span className="relative">
              <MenuIcon aria-hidden="true" className="w-6 h-6" />
              <span aria-hidden="true" className="absolute -top-0.5 -right-0.5 block w-2 h-2 rounded-full bg-cz-warning" />
            </span>
          </span>
          <span className="flex min-h-12 items-center"><Wordmark forceDark className="h-5 w-auto" alt="" /></span>
          <span className="inline-flex min-h-12 min-w-12 items-center justify-center"><BellIcon aria-hidden="true" className="w-5 h-5 text-cz-sidebar-2" /></span>
        </div>
        {/* side-padding som Layout.jsx (#2849): pt-7 px-8 pb-16 paa computer, 16 px paa telefon */}
        <div className="pt-4 px-4 pb-8 md:pt-7 md:px-8 md:pb-16 mx-auto max-w-full">{children}</div>
        {/* appens hurtig-navigation er fast i bunden; i skitsen staar den sidst i siden (ikke fast), saa et helsidebillede viser den nederst */}
        <nav className="md:hidden bg-cz-sidebar border-t border-cz-sidebar-border flex" style={{ height: 56 }} aria-label="Quick navigation">
          {QUICK.map(([l, icon]) => (
            <span key={l} className="flex-1 min-w-0 flex flex-col items-center justify-center gap-0.5 px-0.5 text-3xs font-medium text-cz-sidebar-2">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-5 h-5">{icon}</svg>
              <span>{l}</span>
            </span>
          ))}
        </nav>
      </main>
    </div>
  );
}
