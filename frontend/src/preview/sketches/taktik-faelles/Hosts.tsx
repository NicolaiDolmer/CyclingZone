// #7535 skitse: de to vaerter omkring det faelles TaktikPanel.
//
// Loebssiden (v6, valg 2, 8, 20-22): hovedkortet med guld-streg, talraekken med
// frist og sidens ene guld-knap, etapestriben som kortets bund, fanerne under.
// Planlaegningssiden (#7535 punkt 1, 2, 3, 8): loebsliste med status pr. loeb,
// loebets hoved hvis guld foelger visningen ("Gem taktik"), faste faner
// Trup/Taktik/Formtop, profilen foldet.
//
// Vaerterne er tegnet groft; det der skal bedoemmes er panelet i midten.

import type { ReactNode } from "react";
import { buttonClass } from "../../../components/ui/buttonStyles.js";
import { COPY } from "./copy.ts";
import { PLAN_RACES, STAGES, type Lang } from "./data.ts";
import TaktikPanel, { IconChevronDown, IconChevronRight, IconLock, MiniProfile } from "./Panel.tsx";

const STAGE = 2;

/** Skitsens markering af det faelles panel. Kun etiket, ikke en del af produktet. */
function SharedMark({ lang, notes, children }: { lang: Lang; notes: boolean; children: ReactNode }) {
  if (!notes) return <>{children}</>;
  return (
    <div className="relative rounded-cz outline-2 outline-offset-4 outline-dashed outline-cz-3/60">
      <span className="absolute -top-3 right-3 z-10 bg-cz-body px-1.5 font-data text-3xs font-semibold uppercase tracking-[.08em] text-cz-2">
        {COPY[lang].shared}
      </span>
      {children}
    </div>
  );
}

function Tabs({ items, active, sticky = false }: { items: string[]; active: number; sticky?: boolean }) {
  return (
    <div role="tablist" className={`flex gap-5 overflow-x-auto border-b border-cz-border ${sticky ? "sticky top-0 z-20 bg-cz-card px-4" : ""}`}>
      {items.map((label, i) => (
        <button
          key={label}
          role="tab"
          type="button"
          aria-selected={i === active}
          tabIndex={i === active ? 0 : -1}
          className={`-mb-px whitespace-nowrap border-b-2 py-2.5 text-sm font-medium [@media(max-width:640px),(pointer:coarse)]:min-h-11 ${
            i === active ? "border-cz-accent text-cz-1" : "border-transparent text-cz-2 hover:text-cz-1"
          }`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}

// --- Loebssiden ------------------------------------------------------------------

export function RaceHost({ lang, edit, notes }: { lang: Lang; edit: string | null; notes: boolean }) {
  const c = COPY[lang];
  return (
    <div className="mx-auto max-w-[1600px] px-4 pt-4 pb-16 md:px-8">
      <article className="overflow-hidden rounded-cz border border-cz-border border-t-2 border-t-cz-accent bg-cz-card">
        <div className="px-4 pt-4 md:px-6 md:pt-5">
          <h1 className="m-0 font-display text-[40px] leading-[.92] tracking-[.01em] text-cz-1 uppercase">Giro delle Valli</h1>
          <p className="m-0 mt-1.5 font-data text-2xs uppercase tracking-[.06em] text-cz-3">{c.race.meta}</p>
          <div className="mt-4 flex flex-col gap-3 border-t border-cz-border pt-3 md:flex-row md:items-end md:justify-between">
            <dl className="m-0 grid grid-cols-2 gap-x-6 gap-y-2 sm:flex sm:gap-8">
              {c.race.stats.map(([k, v]) => (
                <div key={k}>
                  <dt className="text-3xs font-medium uppercase tracking-[.1em] text-cz-3">{k}</dt>
                  <dd className="m-0 font-data text-[20px] font-[650] tabular-nums text-cz-1">{v}</dd>
                </div>
              ))}
            </dl>
            <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
              <span className="font-data text-xs tabular-nums text-cz-2">{c.locks("16:55")}</span>
              <span className="text-xs font-medium text-cz-warning">{c.notSaved}</span>
              <button type="button" className={`${buttonClass({ variant: "primary", size: "sm" })} max-sm:w-full`}>{c.saveStage(STAGE)}</button>
            </div>
          </div>
        </div>
        {/* Etapestriben som kortets bund (valg 20-22): den valgte etape har moerk kant, aldrig guld. */}
        <ol className="m-0 mt-4 flex list-none gap-0 overflow-x-auto border-t border-cz-border p-0">
          {STAGES.map((s) => (
            <li key={s.n} className="min-w-[8.5rem] flex-1 border-s border-cz-border first:border-s-0">
              <button
                type="button"
                aria-current={s.n === STAGE ? "true" : undefined}
                className={`block w-full px-3 py-2 text-left ${s.n === STAGE ? "outline-2 -outline-offset-2 outline-cz-1" : "hover:bg-cz-subtle"}`}
              >
                <span className="flex items-baseline justify-between gap-2 font-data text-xs tabular-nums">
                  <span className="font-semibold text-cz-1">{s.n}</span>
                  <span className="text-cz-3">{`${c.day[s.day]} ${s.time}`}</span>
                </span>
                <span className="mt-1 block"><MiniProfile lang={lang} height={14} /></span>
                <span className={`mt-1 block text-2xs ${s.state === "unsaved" ? "font-medium text-cz-warning" : "text-cz-2"}`}>
                  {s.state === "ridden" && <span className="me-1 inline-flex align-[-1px] text-cz-3"><IconLock size={10} /></span>}
                  {c.stateWord[s.state]}
                </span>
              </button>
            </li>
          ))}
        </ol>
      </article>

      <div className="mt-4"><Tabs items={c.race.tabs} active={2} /></div>

      <div className="mt-4 flex flex-col gap-[14px]">
        <section className="rounded-cz border border-cz-border bg-cz-card px-4 py-3">
          <div className="flex items-baseline justify-between gap-3">
            <h2 className="m-0 text-[15px] font-semibold text-cz-1">{`${c.stage(STAGE)} · Monte Ferro`}</h2>
            <button type="button" className="text-xs font-medium text-cz-accent-t hover:underline [@media(max-width:640px),(pointer:coarse)]:min-h-11">{c.race.hideRoute}</button>
          </div>
          <div className="mt-2"><MiniProfile lang={lang} height={56} axis /></div>
        </section>
        <SharedMark lang={lang} notes={notes}>
          <TaktikPanel lang={lang} stage={STAGE} edit={edit} />
        </SharedMark>
      </div>
    </div>
  );
}

// --- Planlaegningssiden ------------------------------------------------------------

function StatusWord({ ok, label }: { ok: boolean; label: string }) {
  return <span className={ok ? "text-cz-2" : "font-medium text-cz-warning"}>{label}</span>;
}

export function PlanHost({ lang, edit, notes }: { lang: Lang; edit: string | null; notes: boolean }) {
  const c = COPY[lang];
  const p = c.plan;
  const tacticsWord = { unsaved: c.notSaved, default: c.defaultPlan, saved: c.saved } as const;
  return (
    <div className="flex min-h-screen">
      <nav aria-label="App" className="hidden w-52 shrink-0 bg-cz-sidebar px-3 py-5 md:block">
        <p className="m-0 mb-4 px-2 font-display text-[22px] leading-none text-cz-accent">Cycling Zone</p>
        <ul className="m-0 list-none space-y-0.5 p-0">
          {p.nav.map((n, i) => (
            <li key={n}>
              <a href="#nav" aria-current={i === 3 ? "page" : undefined} className={`block rounded-cz px-2 py-1.5 text-sm ${i === 3 ? "bg-cz-sidebar-hover text-cz-sidebar-1" : "text-cz-sidebar-2 hover:text-cz-sidebar-1"}`}>{n}</a>
            </li>
          ))}
        </ul>
      </nav>

      <main className="min-w-0 flex-1 px-4 pt-5 pb-16 md:px-8 md:pt-7">
        <header className="mb-5 flex flex-wrap items-end justify-between gap-x-4 gap-y-1">
          <div>
            <h1 className="m-0 font-data text-[20px] font-bold tracking-[-.01em] text-cz-1">{p.title}</h1>
            <p className="m-0 mt-1 text-[13px] text-cz-2">{p.subtitle}</p>
          </div>
          <p className="m-0 font-data text-xs tabular-nums text-cz-warning">{p.weekLine}</p>
        </header>

        <div className="grid items-start gap-[14px] lg:grid-cols-[18rem_minmax(0,1fr)]">
          {/* Loebslisten: status pr. loeb (punkt 3, valg B). Paa telefonen foldet til én raekke. */}
          <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
            <div className="flex items-center justify-between border-b border-cz-border px-4 py-2.5">
              <h2 className="m-0 text-[15px] font-semibold text-cz-1">{p.next7}</h2>
              <span className="font-data text-2xs tabular-nums text-cz-3 lg:hidden">1 / 4</span>
            </div>
            <ul className="m-0 list-none divide-y divide-cz-border p-0">
              {PLAN_RACES.map((r) => (
                <li key={r.id} className={`${r.active ? "" : "max-lg:hidden"}`}>
                  <a href={`#race-${r.id}`} aria-current={r.active ? "true" : undefined} className={`block px-4 py-2.5 ${r.active ? "bg-cz-subtle" : "hover:bg-cz-subtle"}`}>
                    <span className="flex items-center justify-between gap-2">
                      <span className={`text-[13.5px] text-cz-1 ${r.active ? "font-semibold" : "font-medium"}`}>{r.name}</span>
                      {r.active && <span className="text-cz-3 lg:hidden"><IconChevronDown /></span>}
                    </span>
                    <span className="mt-0.5 block font-data text-3xs uppercase tracking-[.06em] text-cz-3 tabular-nums">
                      {`${c.day[r.day]} ${r.date} · ${r.stages > 1 ? p.stages(r.stages) : p.oneDay}`}
                    </span>
                    <span className="mt-1 flex gap-3 text-2xs">
                      <StatusWord ok={r.squad === "ok"} label={r.squad === "ok" ? p.squadOk : p.squadMissing} />
                      <span>
                        <span className="text-cz-3">{`${p.tactics}: `}</span>
                        <StatusWord ok={r.tactics !== "unsaved"} label={tacticsWord[r.tactics]} />
                      </span>
                    </span>
                  </a>
                </li>
              ))}
            </ul>
          </section>

          <section className="min-w-0 overflow-hidden rounded-cz border border-cz-border bg-cz-card">
            <div className="flex flex-col gap-3 px-4 pt-3.5 pb-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h2 className="m-0 text-[18px] font-bold text-cz-1">Giro delle Valli</h2>
                <p className="m-0 mt-0.5 font-data text-2xs uppercase tracking-[.06em] text-cz-3 tabular-nums">{p.raceMeta}</p>
              </div>
              {/* Guld foelger visningen (punkt 8): i Taktik gemmer den taktikken. */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <span className="font-data text-xs tabular-nums text-cz-2">{c.locks("16:55")}</span>
                <span className="text-xs font-medium text-cz-warning">{c.notSaved}</span>
                <button type="button" className={`${buttonClass({ variant: "primary", size: "sm" })} max-sm:w-full`}>{p.saveTactics}</button>
              </div>
            </div>
            <Tabs items={p.views} active={1} sticky />
            <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-b border-cz-border px-4 py-2">
              <span className="inline-flex items-center gap-1">
                <button type="button" aria-label="Forrige etape" className="inline-flex size-8 rotate-180 items-center justify-center rounded-cz border border-cz-border text-cz-2 [@media(max-width:640px),(pointer:coarse)]:size-11"><IconChevronRight size={14} /></button>
                <span className="px-2 text-sm font-semibold tabular-nums text-cz-1">{c.stageOf(STAGE, 7)}</span>
                <button type="button" aria-label="Næste etape" className="inline-flex size-8 items-center justify-center rounded-cz border border-cz-border text-cz-2 [@media(max-width:640px),(pointer:coarse)]:size-11"><IconChevronRight size={14} /></button>
              </span>
              {/* Profilen foldet som standard (punkt 2, 4): en lille streg og "Vis profil". */}
              <span className="flex min-w-0 flex-1 items-center gap-3 sm:max-w-[22rem]">
                <span className="min-w-0 flex-1"><MiniProfile lang={lang} height={18} /></span>
                <button type="button" className="shrink-0 text-xs font-medium text-cz-accent-t hover:underline [@media(max-width:640px),(pointer:coarse)]:min-h-11">{p.showProfile}</button>
              </span>
            </div>
            <SharedMark lang={lang} notes={notes}>
              <TaktikPanel lang={lang} stage={STAGE} edit={edit} bare />
            </SharedMark>
          </section>
        </div>
      </main>
    </div>
  );
}
