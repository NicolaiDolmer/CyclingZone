// #7535 skitse: DEN faelles taktik-komponent (TaktikPanel), som loebssidens
// Taktik-fane (v6) og planlaegningssidens Taktik-visning begge viser.
//
// Ejervalg 16/11 paa #7535: én komponent, ingen egen planlaegnings-udgave, med
// v6-valg 15 (mobil: kort pr. rytter, redigering i et ark fra bunden) og 16
// (Haard/Normal/Let som faste indstillinger, detaljerne bagefter).
//
// Panelet ejer IKKE: etapevalget, ruteprofilen og den gyldne gem-knap. Dem ejer
// vaerten (loebshovedet / planlaegningens loebshoved), praecis som StagePlanBoard
// i dag ikke har en guldknap. Saa bliver der én guld pr. visning i begge sammenhaenge.
//
// Panelet tilpasser sig den bredde, det faar (container queries), ikke skaermen:
//   bred (fra 64rem):   tabel med alle kolonner (loebssiden paa computer)
//   mellem (42-64rem):  tabel, rating/form/traethed/rute samles under navnet
//                       (planlaegningssidens hoejre kolonne paa computer)
//   smal (under 42rem): et kort pr. rytter (begge sider paa telefonen, valg 15)
//
// Intet her er produktkode; siden laeser intet netvaerk.

import { useEffect, useRef, useState, type ReactNode } from "react";
import { taskCostWord, type TaskCostWord } from "../../../components/race/tacticsReady7864.ts";
import { buttonClass } from "../../../components/ui/buttonStyles.js";
import { COPY } from "./copy.ts";
import { PROFILE, RIDERS, ROUTE, type Effort, type Lang, type Leg, type SketchRider, type Stance, type TeamPlanKey, type Tonight, type Trigger } from "./data.ts";

// --- Stroke-ikoner (P7) -------------------------------------------------------

function Svg({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
export const IconChevronRight = ({ size = 12 }: { size?: number }) => <Svg size={size}><path d="M6 3.5L10.5 8 6 12.5" /></Svg>;
export const IconChevronDown = ({ size = 12 }: { size?: number }) => <Svg size={size}><path d="M3.5 6L8 10.5 12.5 6" /></Svg>;
export const IconLock = ({ size = 12 }: { size?: number }) => <Svg size={size}><rect x="3.5" y="7" width="9" height="6.5" rx="1" /><path d="M5.5 7V5a2.5 2.5 0 015 0v2" /></Svg>;
const IconX = () => <Svg><path d="M4 4l8 8M12 4l-8 8" /></Svg>;
const IconPlus = () => <Svg size={12}><path d="M8 3.5v9M3.5 8h9" /></Svg>;
const IconMessage = () => <Svg size={11}><path d="M3 3.5h10v7H7l-3 2.5v-2.5H3z" /></Svg>;
const IconPerson = () => <Svg size={12}><circle cx="8" cy="5.5" r="2.5" /><path d="M3.5 13.5c.6-2.4 2.4-3.7 4.5-3.7s3.9 1.3 4.5 3.7" /></Svg>;

// --- Smaating -----------------------------------------------------------------

export function Flag({ code }: { code: string }) {
  return <span className={`fi fi-${code} shrink-0`} role="img" aria-label={code.toUpperCase()} />;
}

/** Navnecellen i fast raekkefoelge (P12): nation · hover-ikon · navn (link). */
function RiderName({ r, className = "" }: { r: SketchRider; className?: string }) {
  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <Flag code={r.nat} />
      <span className="shrink-0 text-cz-3"><IconPerson /></span>
      <a href={`#rider-${r.id}`} className="min-w-0 truncate text-[13.5px] font-medium text-cz-1 underline decoration-cz-border underline-offset-2 hover:text-cz-accent-t">
        {r.name}
      </a>
    </span>
  );
}

/** Rollen som lille 5px-maerke ved navnet; et tryk aabner rollevaelgeren (ikke tegnet). */
function RoleChip({ lang, r }: { lang: Lang; r: SketchRider }) {
  return (
    <button
      type="button"
      className="inline-flex items-center gap-1 rounded-cz border border-cz-border bg-cz-card px-1.5 py-0.5 text-2xs font-medium text-cz-2 hover:text-cz-1 [@media(max-width:640px),(pointer:coarse)]:min-h-11"
      aria-label={`${COPY[lang].col.role}: ${COPY[lang].role[r.role]}, ${r.name}`}
    >
      {COPY[lang].role[r.role]}
      <IconChevronDown size={10} />
    </button>
  );
}

const TONIGHT_TONE: Record<Tonight, string> = {
  fresh: "text-cz-success",
  ok: "text-cz-2",
  tired: "text-cz-warning",
  very_tired: "text-cz-danger",
};

function triggerKm(from: Trigger | undefined): number | null {
  if (!from) return 0;
  if (from.at === "kom") return ROUTE.climbs[from.climb]?.km ?? null;
  if (from.at === "final_km") return ROUTE.distance - ROUTE.finalKm;
  return null; // "naar han er sat/hentet": ingen fast km
}

function triggerText(lang: Lang, from: Trigger | undefined): string {
  const c = COPY[lang];
  if (!from) return "";
  if (from.at === "kom") return c.from.kom(ROUTE.climbs[from.climb]?.name ?? "");
  return c.from[from.at];
}

/** Opgavens pris som graa-trin: moerkere = haardere (prisordene fra #7864). */
const COST_FILL: Record<TaskCostWord, string> = {
  easy: "bg-cz-1/15",
  medium: "bg-cz-1/35",
  hard: "bg-cz-1/60",
  veryHard: "bg-cz-1/85",
};

// --- Ruten som kolonnehoved og som spor pr. rytter -----------------------------

/** Lille profil i én rolig tone med en roed prik ved hver stigning (P19, lille). */
export function MiniProfile({ height = 28, axis = false, lang }: { height?: number; axis?: boolean; lang: Lang }) {
  const w = 1000;
  const maxM = 2200;
  const pts = PROFILE.map(([km, m]) => `${(km / ROUTE.distance) * w},${height - (m / maxM) * (height - 4)}`).join(" ");
  return (
    <span className="block w-full">
      <svg viewBox={`0 0 ${w} ${height}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden="true">
        <polygon points={`0,${height} ${pts} ${w},${height}`} className="fill-cz-subtle" />
        <polyline points={pts} fill="none" className="stroke-cz-3" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
      </svg>
      {axis && (
        <span className="relative mt-0.5 block h-3.5 font-data text-3xs tabular-nums text-cz-3">
          <span className="absolute left-0">0</span>
          {ROUTE.climbs.map((cl) => (
            <span key={cl.name} className="absolute -translate-x-1/2 whitespace-nowrap last:-translate-x-full" style={{ left: `${(cl.km / ROUTE.distance) * 100}%` }}>
              <span className="me-1 inline-block size-1.5 rounded-full bg-cz-danger align-middle" aria-hidden="true" />
              {COPY[lang].routeAxis(cl.km)}
            </span>
          ))}
        </span>
      )}
    </span>
  );
}

type Seg = { from: number; to: number; cost: TaskCostWord; open: boolean };

function segments(plan: Leg[]): Seg[] {
  // Kun led med fast km faar et stykke af sporet. Et led der begynder "naar han er
  // sat" har ingen km; det forrige led faar en aaben ende i stedet for et gaet punkt.
  const fixed = plan.map((leg) => ({ leg, km: triggerKm(leg.from) }));
  const out: Seg[] = [];
  fixed.forEach(({ leg, km }, i) => {
    if (km == null) return;
    const next = fixed.slice(i + 1).find((f) => f.km != null);
    const hasConditionalAfter = fixed.slice(i + 1, next ? fixed.indexOf(next) : undefined).some((f) => f.km == null);
    out.push({ from: km, to: next?.km ?? ROUTE.distance, cost: taskCostWord(leg.task), open: hasConditionalAfter });
  });
  return out;
}

/** Planens spor langs ruten, paa samme km-skala som kolonnehovedet. */
function PlanTrack({ plan, dashed = false }: { plan: Leg[]; dashed?: boolean }) {
  return (
    <span className="relative block h-1.5 w-full bg-cz-subtle" aria-hidden="true">
      {segments(plan).map((s, i) => (
        <span
          key={i}
          className={`absolute inset-y-0 border-cz-card ${i > 0 ? "border-s-2" : ""} ${dashed ? "bg-transparent outline-1 -outline-offset-1 outline-dashed outline-cz-3" : COST_FILL[s.cost]} `}
          style={{ left: `${(s.from / ROUTE.distance) * 100}%`, width: `${((s.to - s.from) / ROUTE.distance) * 100}%` }}
        >
          {/* Aaben ende: sidste stykke lysere, fordi skiftet sker naar det sker (ingen gaettet km). */}
          {s.open && !dashed && <span className="absolute inset-y-0 right-0 w-1/4 bg-cz-card/70" />}
        </span>
      ))}
    </span>
  );
}

/** Kaeden som chips med skiftet imellem (samme ord som StagePlanBoard). */
function PlanChips({ lang, plan, dashed = false }: { lang: Lang; plan: Leg[]; dashed?: boolean }) {
  const c = COPY[lang];
  return (
    <span className="flex min-w-0 flex-wrap items-center gap-x-1.5 gap-y-1">
      {plan.map((leg, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && (
            <span className="inline-flex items-center gap-1 text-3xs text-cz-3 whitespace-nowrap">
              <IconChevronRight size={11} />
              {triggerText(lang, leg.from)}
            </span>
          )}
          <span className={`inline-flex items-center rounded-cz border px-1.5 py-0.5 text-2xs font-medium whitespace-nowrap ${dashed ? "border-dashed border-cz-3 text-cz-2" : "border-cz-border bg-cz-subtle text-cz-1"}`}>
            {c.task[leg.task]}
          </span>
        </span>
      ))}
    </span>
  );
}

function SuggestionTag({ lang }: { lang: Lang }) {
  return (
    <span className="inline-flex items-center gap-1 rounded-cz border border-dashed border-cz-3 px-1.5 py-0.5 text-3xs font-medium text-cz-2 whitespace-nowrap">
      <IconMessage />
      {COPY[lang].suggestion}
    </span>
  );
}

// --- Faste indstillinger: Haard / Normal / Let (valg 16) ----------------------

/**
 * Tre faste valg som en rigtig radiogruppe (piletaster virker af sig selv).
 * Aktivt valg er moerk flade som i wireframe v5 (valg 16: "ligesom i v5"), ikke guld:
 * syv raekker med guld ville bryde rationeringen. Forslag til Segmented: `tone="ink"`.
 */
function EffortChoice({ lang, r, value, onChange, stretch = false }: { lang: Lang; r: SketchRider; value: Effort; onChange: (e: Effort) => void; stretch?: boolean }) {
  const c = COPY[lang];
  return (
    <fieldset className={`m-0 flex min-w-0 border-0 p-0 ${stretch ? "w-full" : ""}`}>
      <legend className="sr-only">{`${c.effortLabel}, ${r.name}`}</legend>
      <span className={`inline-flex overflow-hidden rounded-cz border border-cz-border ${stretch ? "w-full" : ""}`}>
        {(["hard", "normal", "easy"] as Effort[]).map((e) => (
          <label
            key={e}
            className={`relative flex cursor-pointer items-center justify-center border-s border-cz-border px-2.5 py-1 text-xs first:border-s-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-cz-1 [@media(max-width:640px),(pointer:coarse)]:min-h-11 ${stretch ? "flex-1" : ""} ${
              value === e ? "bg-cz-1 font-semibold text-cz-body" : "bg-cz-card font-medium text-cz-2 hover:text-cz-1"
            }`}
          >
            <input type="radio" name={`effort-${r.id}`} value={e} checked={value === e} onChange={() => onChange(e)} className="sr-only" />
            {c.effort[e]}
          </label>
        ))}
      </span>
    </fieldset>
  );
}

// --- Holdets valg: holdplan + jagten paa udbruddet -----------------------------

function TeamChoices({ lang, plan, onPlan, stance, onStance }: { lang: Lang; plan: TeamPlanKey; onPlan: (k: TeamPlanKey) => void; stance: Stance; onStance: (s: Stance) => void }) {
  const c = COPY[lang];
  const captain = RIDERS.find((r) => r.role === "captain");
  const sprinter = RIDERS.find((r) => r.role === "sprint_captain");
  const label = (k: TeamPlanKey) => {
    const p = c.teamPlan[k];
    const who = k === "gc" ? captain : k === "sprint" ? sprinter : null;
    return who && p.named ? p.named(who.name.split(" ").slice(-1)[0]) : p.name;
  };
  return (
    <div className="grid gap-x-6 gap-y-3 border-b border-cz-border px-4 py-3 @5xl:grid-cols-[1fr_auto]">
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1.5 text-2xs font-medium uppercase tracking-[.06em] text-cz-3">{c.teamPlanLabel}</legend>
        <span className="grid grid-cols-2 overflow-hidden rounded-cz border border-cz-border @2xl:flex">
          {(["gc", "stage", "sprint", "break", "save"] as TeamPlanKey[]).map((k, i) => (
            <label
              key={k}
              className={`relative flex cursor-pointer items-center border-cz-border px-3 py-1.5 text-xs has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-cz-1 [@media(max-width:640px),(pointer:coarse)]:min-h-11 @2xl:flex-1 @2xl:justify-center @2xl:border-s @2xl:first:border-s-0 ${
                i % 2 === 1 ? "border-s" : ""
              } ${i > 1 ? "border-t @2xl:border-t-0" : ""} ${k === "save" ? "col-span-2 @2xl:col-span-1" : ""} ${
                plan === k ? "bg-cz-accent/10 font-semibold text-cz-accent-t" : "bg-cz-card font-medium text-cz-2 hover:text-cz-1"
              }`}
            >
              <input type="radio" name="team-plan" value={k} checked={plan === k} onChange={() => onPlan(k)} className="sr-only" />
              <span className="truncate">{label(k)}</span>
            </label>
          ))}
        </span>
        <p className="m-0 mt-1.5 text-xs text-cz-2">{c.teamPlan[plan].desc}</p>
      </fieldset>
      <fieldset className="m-0 min-w-0 border-0 p-0">
        <legend className="mb-1.5 text-2xs font-medium uppercase tracking-[.06em] text-cz-3">{c.stanceLabel}</legend>
        <span className="flex overflow-hidden rounded-cz border border-cz-border">
          {(["chase", "neutral", "let_go"] as Stance[]).map((s) => (
            <label
              key={s}
              className={`relative flex flex-1 cursor-pointer items-center justify-center border-s border-cz-border px-3 py-1.5 text-center text-xs leading-tight first:border-s-0 has-[:focus-visible]:outline-2 has-[:focus-visible]:-outline-offset-2 has-[:focus-visible]:outline-cz-1 [@media(max-width:640px),(pointer:coarse)]:min-h-11 ${
                stance === s ? "bg-cz-1 font-semibold text-cz-body" : "bg-cz-card font-medium text-cz-2 hover:text-cz-1"
              }`}
            >
              <input type="radio" name="stance" value={s} checked={stance === s} onChange={() => onStance(s)} className="sr-only" />
              {c.stance[s]}
            </label>
          ))}
        </span>
        <p className="m-0 mt-1.5 text-xs text-cz-2">{c.stanceNote}</p>
      </fieldset>
    </div>
  );
}

// --- Editoren: samme indhold i et svaevende kort (computer) og et ark (telefon) -

function EditorBody({ lang, r }: { lang: Lang; r: SketchRider }) {
  const c = COPY[lang];
  return (
    <>
      {r.suggestion && (
        <div className="flex flex-wrap items-center gap-2 border-b border-cz-border px-4 py-2.5">
          <SuggestionTag lang={lang} />
          <span className="text-2xs text-cz-2">{c.suggestionWhy}</span>
        </div>
      )}
      <ol className="m-0 list-none p-0">
        {r.plan.map((leg, i) => (
          <li key={i} className="grid grid-cols-[3.25rem_1fr] items-center gap-x-2 gap-y-1.5 border-b border-cz-border px-4 py-2.5">
            <span className="text-3xs font-medium uppercase tracking-[.06em] text-cz-3">{c.step(i + 1)}</span>
            <span className="flex min-w-0 flex-wrap items-center gap-2">
              {i > 0 && (
                <label className="min-w-0 flex-1">
                  <span className="sr-only">{`${c.switchAt}, ${c.step(i + 1)}`}</span>
                  <select defaultValue={triggerText(lang, leg.from)} className="w-full rounded-cz border border-cz-border bg-cz-card px-2 py-1.5 text-xs text-cz-1 [@media(max-width:640px),(pointer:coarse)]:min-h-11">
                    {[...ROUTE.climbs.slice(0, 2).map((cl) => c.from.kom(cl.name)), c.from.final_km, c.from.dropped].map((o) => <option key={o}>{o}</option>)}
                    {leg.from?.at === "caught" && <option>{c.from.caught}</option>}
                  </select>
                </label>
              )}
              <label className="min-w-0 flex-[1.4]">
                <span className="sr-only">{`${c.task1}, ${c.step(i + 1)}`}</span>
                <select defaultValue={leg.task} className="w-full rounded-cz border border-cz-border bg-cz-card px-2 py-1.5 text-xs text-cz-1 [@media(max-width:640px),(pointer:coarse)]:min-h-11">
                  {(Object.keys(c.task) as Array<keyof typeof c.task>).map((tk) => (
                    <option key={tk} value={tk}>{`${c.task[tk]} · ${c.price[taskCostWord(tk)]}`}</option>
                  ))}
                </select>
              </label>
              {i > 0 && (
                <button type="button" aria-label={`${c.clearPlan}: ${c.step(i + 1)}`} className="inline-flex size-8 items-center justify-center rounded-cz text-cz-3 hover:text-cz-1 [@media(max-width:640px),(pointer:coarse)]:size-11">
                  <IconX />
                </button>
              )}
            </span>
          </li>
        ))}
      </ol>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2">
        <button type="button" className="inline-flex items-center gap-1 text-xs font-medium text-cz-accent-t hover:underline [@media(max-width:640px),(pointer:coarse)]:min-h-11">
          <IconPlus />
          {c.addStep}
        </button>
        {!r.suggestion && <button type="button" className="text-xs font-medium text-cz-accent-t hover:underline [@media(max-width:640px),(pointer:coarse)]:min-h-11">{c.useSuggestion}</button>}
        <button type="button" className="text-xs font-medium text-cz-2 hover:text-cz-1 hover:underline [@media(max-width:640px),(pointer:coarse)]:min-h-11">{c.clearPlan}</button>
      </div>
      <p className="m-0 border-t border-cz-border px-4 py-2 text-2xs text-cz-2">{c.priceNote}</p>
      <p className="m-0 border-t border-cz-border px-4 py-2 text-2xs text-cz-3">{c.rulesNote}</p>
    </>
  );
}

/** Computer (P18): et svaevende kort ved siden af knappen; listen bliver staaende. */
function EditorPopover({ lang, r, anchorId, onClose }: { lang: Lang; r: SketchRider; anchorId: string; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const c = COPY[lang];
  useEffect(() => {
    const el = ref.current;
    const anchor = document.getElementById(anchorId);
    if (!el || !anchor) return undefined;
    const place = () => {
      const a = anchor.getBoundingClientRect();
      const width = Math.min(384, window.innerWidth - 16);
      el.style.inset = "auto";
      el.style.width = `${width}px`;
      el.style.left = `${Math.max(8, Math.min(a.right - width, window.innerWidth - width - 8))}px`;
      el.style.top = `${a.bottom + 6}px`;
    };
    place();
    el.showPopover();
    const toggle = (e: Event) => { if ((e as Event & { newState?: string }).newState === "closed") onClose(); };
    el.addEventListener("toggle", toggle);
    window.addEventListener("resize", place);
    return () => { el.removeEventListener("toggle", toggle); window.removeEventListener("resize", place); };
  }, [anchorId, onClose]);
  return (
    <dialog
      ref={ref}
      popover="auto"
      aria-labelledby={`editor-title-${r.id}`}
      className="fixed m-0 overflow-hidden rounded-cz border border-cz-border bg-cz-card p-0 text-cz-1 shadow-overlay"
    >
      <div className="flex items-center justify-between gap-3 border-b border-cz-border px-4 py-2.5">
        <h3 id={`editor-title-${r.id}`} className="m-0 text-sm font-semibold">{c.editTitle(r.name)}</h3>
        <button type="button" onClick={() => ref.current?.hidePopover()} aria-label={c.close} className="inline-flex size-8 items-center justify-center rounded-cz text-cz-3 hover:text-cz-1">
          <IconX />
        </button>
      </div>
      <EditorBody lang={lang} r={r} />
    </dialog>
  );
}

/** Telefon (valg 15, P18): et ark fra bunden. Native <dialog> med showModal. */
function EditorSheet({ lang, r, onClose }: { lang: Lang; r: SketchRider; onClose: () => void }) {
  const ref = useRef<HTMLDialogElement>(null);
  const c = COPY[lang];
  useEffect(() => {
    const d = ref.current;
    if (!d) return undefined;
    if (!d.open) d.showModal();
    const close = () => onClose();
    d.addEventListener("close", close);
    // Uden closedby (Safari): luk ved tryk paa baggrunden, naar baade tryk og slip er udenfor.
    let downOutside = false;
    const outside = (e: PointerEvent) => {
      const b = d.getBoundingClientRect();
      return e.clientX < b.left || e.clientX > b.right || e.clientY < b.top || e.clientY > b.bottom;
    };
    const down = (e: PointerEvent) => { downOutside = outside(e); };
    const up = (e: PointerEvent) => { if (downOutside && outside(e)) d.close(); };
    const needsFallback = !("closedBy" in HTMLDialogElement.prototype);
    if (needsFallback) { d.addEventListener("pointerdown", down); d.addEventListener("pointerup", up); }
    return () => {
      d.removeEventListener("close", close);
      if (needsFallback) { d.removeEventListener("pointerdown", down); d.removeEventListener("pointerup", up); }
    };
  }, [onClose]);
  return (
    <dialog
      ref={ref}
      {...{ closedby: "any" }}
      aria-labelledby={`sheet-title-${r.id}`}
      className="m-0 mt-auto max-h-[85dvh] w-full max-w-none overflow-y-auto overscroll-contain rounded-t-cz border border-b-0 border-cz-border bg-cz-card p-0 text-cz-1 shadow-overlay backdrop:bg-black/40 backdrop:overscroll-contain"
    >
      <div className="sticky top-0 z-10 flex items-center justify-between gap-3 border-b border-cz-border bg-cz-card px-4 py-2">
        <div className="min-w-0">
          <h3 id={`sheet-title-${r.id}`} className="m-0 truncate text-sm font-semibold">{c.editTitle(r.name)}</h3>
          <p className="m-0 font-data text-3xs uppercase tracking-[.06em] text-cz-3">{`${c.role[r.role]} · ${c.effortLabel} ${c.effort[r.effort]}`}</p>
        </div>
        <form method="dialog">
          <button className="inline-flex size-11 items-center justify-center rounded-cz text-cz-3 hover:text-cz-1" aria-label={c.close}><IconX /></button>
        </form>
      </div>
      <EditorBody lang={lang} r={r} />
      <form method="dialog" className="sticky bottom-0 border-t border-cz-border bg-cz-card px-4 py-3">
        <button className={buttonClass({ variant: "secondary", size: "md", fullWidth: true })}>{c.done}</button>
      </form>
    </dialog>
  );
}

// --- Panelet -------------------------------------------------------------------

function MutedStats({ lang, r }: { lang: Lang; r: SketchRider }) {
  const s = COPY[lang].short;
  return (
    <span className="font-data text-3xs uppercase tracking-[.04em] text-cz-3 tabular-nums">
      {`${s.rating} ${r.rating} · ${s.form} ${r.form} · ${s.fatigue} ${r.fatigue} · ${s.match} ${r.match}`}
    </span>
  );
}

const TH = "px-3 py-2 text-left text-2xs font-medium uppercase tracking-[.06em] text-cz-3 whitespace-nowrap";
const THN = `${TH} text-right`;
const TD = "px-3 py-2.5 align-top";
const TDN = `${TD} text-right font-data tabular-nums text-cz-1`;

export default function TaktikPanel({ lang, stage, edit, bare = false }: { lang: Lang; stage: number; edit: string | null; /** I et kort der allerede har ramme (planlaegningen): ingen egen ramme, ingen kasse i kasse. */ bare?: boolean }) {
  const c = COPY[lang];
  const [plan, setPlan] = useState<TeamPlanKey>("gc");
  const [stance, setStance] = useState<Stance>("neutral");
  const [efforts, setEfforts] = useState<Record<string, Effort>>(() => Object.fromEntries(RIDERS.map((r) => [r.id, r.effort])));
  const [open, setOpen] = useState<{ id: string; mode: "popover" | "sheet" } | null>(() => {
    if (!edit) return null;
    return { id: edit, mode: window.innerWidth < 640 ? "sheet" : "popover" };
  });
  const setEffort = (id: string) => (e: Effort) => setEfforts((m) => ({ ...m, [id]: e }));
  const openRider = open ? RIDERS.find((r) => r.id === open.id) ?? null : null;
  const closeEditor = useRef(() => setOpen(null)).current;

  return (
    <section aria-label={`${c.col.plan}, ${c.stage(stage)}`} className={`@container overflow-hidden bg-cz-card ${bare ? "" : "rounded-cz border border-cz-border"}`}>
      <TeamChoices lang={lang} plan={plan} onPlan={setPlan} stance={stance} onStance={setStance} />

      {/* Bred og mellem: én tabel. Kolonneoverskrifter altid med (ejer 16/11). */}
      <div className="hidden @2xl:block">
        <table className="w-full table-fixed border-collapse text-sm" data-sortable>
          <colgroup>
            <col className="w-[30%] @5xl:w-[17%]" />
            <col className="hidden w-[9%] @5xl:table-column" />
            <col className="hidden w-[5%] @5xl:table-column" />
            <col className="hidden w-[5%] @5xl:table-column" />
            <col className="hidden w-[6%] @5xl:table-column" />
            <col className="hidden w-[5%] @5xl:table-column" />
            <col className="w-[22%] @5xl:w-[15%]" />
            <col />
            <col className="w-[13%] @5xl:w-[8%]" />
          </colgroup>
          <thead>
            <tr className="border-b border-cz-border">
              <th scope="col" className={TH}>{c.col.rider}</th>
              <th scope="col" className={`${TH} hidden @5xl:table-cell`}>{c.col.role}</th>
              <th scope="col" className={`${THN} hidden @5xl:table-cell`}>{c.col.rating}</th>
              <th scope="col" className={`${THN} hidden @5xl:table-cell`}>{c.col.form}</th>
              <th scope="col" className={`${THN} hidden @5xl:table-cell`}>{c.col.fatigue}</th>
              <th scope="col" className={`${THN} hidden @5xl:table-cell`}>{c.col.match}</th>
              <th scope="col" className={TH}>{c.col.effort}</th>
              <th scope="col" className={`${TH} pb-1`}>
                <span className="flex items-baseline justify-between gap-2">
                  <span>{c.col.plan}</span>
                  <span className="font-data text-3xs normal-case tracking-normal tabular-nums">{c.routeAxis(ROUTE.distance)}</span>
                </span>
                <span className="mt-1 block font-normal normal-case tracking-normal"><MiniProfile lang={lang} height={22} axis /></span>
              </th>
              <th scope="col" className={TH}>{c.col.tonight}</th>
            </tr>
          </thead>
          <tbody>
            {RIDERS.map((r) => (
              <tr key={r.id} className="border-b border-cz-border last:border-b-0">
                <td className={TD}>
                  <RiderName r={r} className="max-w-full" />
                  <span className="mt-1 flex flex-wrap items-center gap-1.5 @5xl:hidden">
                    <RoleChip lang={lang} r={r} />
                    <MutedStats lang={lang} r={r} />
                  </span>
                </td>
                <td className={`${TD} hidden @5xl:table-cell`}><RoleChip lang={lang} r={r} /></td>
                <td className={`${TDN} hidden @5xl:table-cell`}>{r.rating}</td>
                <td className={`${TDN} hidden @5xl:table-cell`}>{r.form}</td>
                <td className={`${TDN} hidden @5xl:table-cell`}>{r.fatigue}</td>
                <td className={`${TDN} hidden @5xl:table-cell`}>{r.match}</td>
                <td className={TD}><EffortChoice lang={lang} r={r} value={efforts[r.id]} onChange={setEffort(r.id)} /></td>
                <td className={TD}>
                  <span className="flex items-start gap-3">
                    <span className="min-w-0 flex-1">
                      <PlanTrack plan={r.plan} dashed={r.suggestion} />
                      <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                        {r.suggestion && <SuggestionTag lang={lang} />}
                        <PlanChips lang={lang} plan={r.plan} dashed={r.suggestion} />
                      </span>
                    </span>
                    <button
                      id={`edit-${r.id}`}
                      type="button"
                      aria-haspopup="dialog"
                      aria-expanded={open?.id === r.id}
                      onClick={() => setOpen({ id: r.id, mode: "popover" })}
                      className="shrink-0 text-xs font-medium text-cz-accent-t hover:underline"
                    >
                      {c.change}
                    </button>
                  </span>
                </td>
                <td className={`${TD} text-xs font-medium ${TONIGHT_TONE[r.tonight]}`}>{c.tonight[r.tonight]}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Smal (valg 15): et kort pr. rytter; redigering i et ark fra bunden. */}
      <ul className="m-0 list-none divide-y divide-cz-border p-0 @2xl:hidden">
        {RIDERS.map((r) => (
          <li key={r.id} className="px-4 py-3">
            <div className="flex items-start justify-between gap-2">
              <span className="min-w-0">
                <RiderName r={r} className="max-w-full" />
                <span className="mt-0.5 block"><MutedStats lang={lang} r={r} /></span>
              </span>
              <RoleChip lang={lang} r={r} />
            </div>
            <div className="mt-2.5">
              <PlanTrack plan={r.plan} dashed={r.suggestion} />
              <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                {r.suggestion && <SuggestionTag lang={lang} />}
                <PlanChips lang={lang} plan={r.plan} dashed={r.suggestion} />
              </span>
            </div>
            <div className="mt-2.5 flex items-center gap-2">
              <span className="min-w-0 flex-1"><EffortChoice lang={lang} r={r} value={efforts[r.id]} onChange={setEffort(r.id)} stretch /></span>
              <button
                type="button"
                aria-haspopup="dialog"
                onClick={() => setOpen({ id: r.id, mode: "sheet" })}
                className={buttonClass({ variant: "secondary", size: "sm" })}
              >
                {c.editPlan}
              </button>
            </div>
            <p className={`m-0 mt-1.5 text-2xs ${TONIGHT_TONE[r.tonight]}`}>
              <span className="text-cz-3">{c.col.tonight}: </span>
              <span className="font-medium">{c.tonight[r.tonight]}</span>
            </p>
          </li>
        ))}
      </ul>

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-cz-border px-4 py-2.5 text-2xs text-cz-3">
        <span className="inline-flex items-center gap-1.5">
          {(["easy", "medium", "hard", "veryHard"] as TaskCostWord[]).map((w) => (
            <span key={w} className="inline-flex items-center gap-1">
              <span className={`inline-block h-1.5 w-3 ${COST_FILL[w]}`} aria-hidden="true" />
              {c.price[w]}
            </span>
          ))}
        </span>
        <span>{c.legendDarker}</span>
        <span>{c.legendOpen}</span>
        {/* Holdplanen til naeste etape er panelets egen, sekundaere handling; gem er vaertens. */}
        <button type="button" className={`${buttonClass({ variant: "secondary", size: "sm" })} ms-auto`}>{c.copyTo(stage + 1)}</button>
      </div>

      {openRider && open?.mode === "popover" && <EditorPopover lang={lang} r={openRider} anchorId={`edit-${openRider.id}`} onClose={closeEditor} />}
      {openRider && open?.mode === "sheet" && <EditorSheet lang={lang} r={openRider} onClose={closeEditor} />}
    </section>
  );
}
