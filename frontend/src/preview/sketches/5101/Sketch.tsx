// #5101 skitse: indsatskortet pr. rytter efter en etape, i tre varianter plus
// "Nu" (Taktik paa en koert etape bag race_page_v6 i dag). Kortet bor i Taktik,
// fordi ejeren 11/11 lagde "plan mod det der skete" dér (valg 11 paa #7778).
//
// Faste rammer fra ejeren, som alle tre varianter holder:
//   - ordren, hvad han gjorde (2-4 oejeblikke med km) og hvorfor planen skiftede (4/11);
//   - ingen samlet dom eller karakter, ingen traethed paa kortet (4/11 og 5/11);
//   - "ikke set" er aldrig "mislykket", og en ukendt aarsag staar som ukendt;
//   - uden gemt plan vises ingen opdigtet plan.
// Intet her er produktkode; siden loeber ikke fra appen og laeser intet netvaerk.

import type { ReactNode } from "react";
import { COPY, type VariantId } from "./copy.ts";
import { RIDERS, STAGE, type Lang, type PlanStep, type RideEvent, type SketchRider, type StepMark, type Txt } from "./data.ts";

type Props = { variant: VariantId; lang: Lang; open: string[] };

// --- Stroke-ikoner (P7: streger, aldrig tegn) --------------------------------

function Svg({ size = 14, children }: { size?: number; children: ReactNode }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const IconCheck = () => <Svg><path d="M3 8.5l3.2 3L13 4.5" /></Svg>;
const IconDiffers = () => <Svg><path d="M4 4l8 8M12 4l-8 8" /></Svg>;
const IconMinus = () => <Svg><path d="M4 8h8" /></Svg>;
const IconInfo = () => <Svg><circle cx="8" cy="8" r="6" /><path d="M8 7.2V11M8 5h.01" /></Svg>;
const IconSwitch = () => <Svg><path d="M3 3v5a2 2 0 002 2h8M10 7l3 3-3 3" /></Svg>;
const IconChevronRight = ({ size = 12 }: { size?: number }) => <Svg size={size}><path d="M6 3.5L10.5 8 6 12.5" /></Svg>;
const IconChevronDown = () => <Svg><path d="M3.5 6L8 10.5 12.5 6" /></Svg>;

const MARK: Record<StepMark, { Icon: () => ReactNode; tone: string }> = {
  seen: { Icon: IconCheck, tone: "text-cz-success" },
  differs: { Icon: IconDiffers, tone: "text-cz-warning" },
  fact: { Icon: IconInfo, tone: "text-cz-3" },
  not_reached: { Icon: IconMinus, tone: "text-cz-3" },
  not_seen: { Icon: IconMinus, tone: "text-cz-3" },
};

// --- Smaating ---------------------------------------------------------------

const tx = (lang: Lang, t: Txt) => t[lang];

function RiderName({ r, lang, className = "" }: { r: SketchRider; lang: Lang; className?: string }) {
  const c = COPY[lang];
  // P12: navnet er et link til profilen, samme udseende som resten af spillet.
  return (
    <a href={`#rider-${r.id}`} className={`text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t ${className}`}>
      {c.rider(r.no)}
    </a>
  );
}

function RiderMeta({ r, lang }: { r: SketchRider; lang: Lang }) {
  return (
    <span className="font-data text-3xs uppercase tracking-wide text-cz-3 tabular-nums">
      {tx(lang, r.role)} · {tx(lang, r.finish)}
    </span>
  );
}

function KmTag({ km, lang, strong = false }: { km: number; lang: Lang; strong?: boolean }) {
  return (
    <span className={`font-data text-2xs tabular-nums whitespace-nowrap ${strong ? "font-semibold text-cz-1" : "text-cz-3"}`}>
      {COPY[lang].km(km)}
    </span>
  );
}

/** Hvornaar et trin begyndte: planens skiftpunkt, og km hvis det faktisk skete et andet sted. */
function StepFrom({ s, lang }: { s: PlanStep; lang: Lang }) {
  const c = COPY[lang];
  if (!s.plannedFrom && s.actualFromKm == null) return null;
  if (s.actualFromKm != null && s.plannedFrom) {
    return (
      <span className="text-xs text-cz-3">
        {c.startedAt(s.actualFromKm)} <span className="whitespace-nowrap">({c.planned(tx(lang, s.plannedFrom))})</span>
      </span>
    );
  }
  return <span className="text-xs text-cz-3">{tx(lang, s.plannedFrom as Txt)}</span>;
}

function MarkIcon({ mark }: { mark: StepMark }) {
  const { Icon, tone } = MARK[mark];
  return <span className={`inline-flex w-4 flex-none pt-[3px] ${tone}`}><Icon /></span>;
}

function ReasonLine({ r, lang, compact = false }: { r: SketchRider; lang: Lang; compact?: boolean }) {
  const c = COPY[lang];
  const ch = r.change;
  if (ch.source === "record") {
    return (
      <span className="flex items-start gap-2 text-sm text-cz-1">
        <span className="inline-flex w-4 flex-none pt-[3px] text-cz-warning"><IconSwitch /></span>
        <span className="min-w-0">
          {!compact && <span className="me-1.5 font-semibold">{c.change}</span>}
          {ch.km != null && <><KmTag km={ch.km} lang={lang} strong />{" · "}</>}
          {tx(lang, ch.text)}
        </span>
      </span>
    );
  }
  if (ch.source === "unknown") {
    return (
      <span className="flex items-start gap-2 text-sm text-cz-3">
        <span className="inline-flex w-4 flex-none pt-[3px]"><IconInfo /></span>
        <span className="min-w-0">
          {!compact && <span className="block text-cz-2">{c.unknownReason}</span>}
          {tx(lang, ch.text)}
        </span>
      </span>
    );
  }
  return (
    <span className="flex items-start gap-2 text-sm text-cz-2">
      <span className="inline-flex w-4 flex-none pt-[3px] text-cz-3"><IconMinus /></span>
      <span className="min-w-0">{tx(lang, ch.text)}</span>
    </span>
  );
}

function EventList({ events, lang, numbered = false }: { events: RideEvent[]; lang: Lang; numbered?: boolean }) {
  return (
    <ol className="m-0 list-none p-0">
      {events.map((e, i) => (
        <li key={i} className="grid grid-cols-[3.25rem_1fr] gap-x-2 py-0.5 text-sm">
          <span className="pt-px">
            {numbered && <span className="me-1 font-data text-2xs font-semibold tabular-nums text-cz-1">{i + 1}</span>}
            <KmTag km={e.km} lang={lang} strong={e.trigger} />
          </span>
          <span className={e.trigger ? "font-medium text-cz-1" : "text-cz-1"}>{tx(lang, e.text)}</span>
        </li>
      ))}
    </ol>
  );
}

function NoPlan({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  return (
    <span className="flex items-start gap-2 text-sm text-cz-3">
      <span className="inline-flex w-4 flex-none pt-[3px]"><IconMinus /></span>
      <span>{c.noPlan}. {c.rodeOnRole}.</span>
    </span>
  );
}

// --- Nu: Taktik paa en koert etape bag race_page_v6 ---------------------------

function eventsInSpan(r: SketchRider, s: PlanStep) {
  if (!s.span) return [];
  const [a, b] = s.span;
  return r.events.filter((e) => e.km > a && e.km <= b);
}

function VariantNow({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  return (
    <>
      <div aria-hidden="true" className="hidden gap-x-6 border-t border-cz-border py-2 font-data text-2xs uppercase tracking-wider text-cz-3 md:grid md:grid-cols-2">
        <span>{c.colPlan}</span>
        <span>{c.colRecord}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {RIDERS.map((r) => (
          <li key={r.id} className="border-t border-cz-border pb-1 pt-3">
            <div className="flex min-h-11 items-baseline gap-2">
              <RiderName r={r} lang={lang} className="font-semibold" />
              <span className="text-xs text-cz-3">{tx(lang, r.role)}</span>
            </div>
            {r.planned ? (
              <ol className="m-0 list-none p-0">
                {r.steps.map((s, i) => {
                  // I dag viser optegnelsen kun trinnets udfald: sidste linje i trinnets km-spand.
                  const last = eventsInSpan(r, s).slice(-1);
                  return (
                    <li key={i} className="grid gap-x-6 gap-y-1 border-t border-cz-border py-2.5 md:grid-cols-2">
                      <div className="min-w-0">
                        <span className="block font-data text-2xs uppercase tracking-wider text-cz-3 tabular-nums">
                          {c.step(i + 1)}
                          {s.plannedFrom && <span className="normal-case tracking-normal"> · {tx(lang, s.plannedFrom)}</span>}
                        </span>
                        <span className="block text-sm font-semibold text-cz-1">{tx(lang, s.task)}</span>
                      </div>
                      <div className="flex min-w-0 items-start gap-2 text-sm">
                        <MarkIcon mark={s.mark} />
                        <span className={s.mark === "not_seen" ? "text-cz-3" : "text-cz-1"}>
                          {s.mark === "not_seen" ? c.notSeen : last.map((e, j) => <span key={j} className="block">{tx(lang, e.text)} <KmTag km={e.km} lang={lang} /></span>)}
                        </span>
                      </div>
                    </li>
                  );
                })}
              </ol>
            ) : (
              <div className="border-t border-cz-border py-2.5"><NoPlan lang={lang} /></div>
            )}
          </li>
        ))}
      </ul>
    </>
  );
}

// --- A: tre spoergsmaal paa en raekke ---------------------------------------

function OrderChainList({ r, lang }: { r: SketchRider; lang: Lang }) {
  if (!r.planned) return <NoPlan lang={lang} />;
  return (
    <ol className="m-0 list-none p-0">
      {r.steps.map((s, i) => (
        <li key={i} className="flex items-start gap-2 py-0.5">
          <MarkIcon mark={s.mark} />
          <span className="min-w-0">
            <span className="text-sm font-medium text-cz-1">
              <span className="me-1.5 font-data text-2xs tabular-nums text-cz-3">{i + 1}</span>
              {tx(lang, s.task)}
            </span>
            {(s.plannedFrom || s.actualFromKm != null) && <span className="block ps-[18px]"><StepFrom s={s} lang={lang} /></span>}
          </span>
        </li>
      ))}
    </ol>
  );
}

function VariantA({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const grid = "md:grid md:grid-cols-[minmax(150px,0.8fr)_minmax(0,1.2fr)_minmax(0,1.6fr)_minmax(0,1.2fr)] md:gap-x-6";
  const label = "mb-1 block font-data text-3xs uppercase tracking-wider text-cz-3 md:hidden";
  return (
    <>
      <div aria-hidden="true" className={`hidden border-t border-cz-border py-2 font-data text-2xs uppercase tracking-wider text-cz-3 ${grid}`}>
        <span>{c.colRider}</span>
        <span>{c.colOrder}</span>
        <span>{c.colDid}</span>
        <span>{c.colWhy}</span>
      </div>
      <ul className="m-0 list-none p-0">
        {RIDERS.map((r) => (
          <li key={r.id} className={`space-y-3 border-t border-cz-border py-3 md:space-y-0 ${grid}`}>
            <div className="flex min-h-11 flex-col justify-start md:min-h-0">
              <RiderName r={r} lang={lang} className="font-semibold" />
              <RiderMeta r={r} lang={lang} />
            </div>
            <div className="min-w-0">
              <span className={label}>{c.colOrder}</span>
              <OrderChainList r={r} lang={lang} />
            </div>
            <div className="min-w-0">
              <span className={label}>{c.colDid}</span>
              <EventList events={r.events} lang={lang} />
            </div>
            <div className="min-w-0">
              <span className={label}>{c.colWhy}</span>
              <ReasonLine r={r} lang={lang} />
            </div>
          </li>
        ))}
      </ul>
    </>
  );
}

// --- B: rute-strimmel ------------------------------------------------------

const pct = (km: number) => `${(km / STAGE.lengthKm) * 100}%`;

function ProfileStrip({ r, lang }: { r: SketchRider; lang: Lang }) {
  const c = COPY[lang];
  const maxM = 2200;
  const pts = STAGE.profile.map(([km, m]) => `${(km / STAGE.lengthKm) * 1000},${60 - (m / maxM) * 56}`).join(" ");
  return (
    <div className="min-w-0">
      {/* Profilen: én rolig tone, rød prik ved hver kategoriseret stigning (P19, lille). */}
      <div className="relative h-[64px]">
        <svg viewBox="0 0 1000 60" preserveAspectRatio="none" className="absolute inset-0 h-full w-full" aria-hidden="true">
          <polygon points={`0,60 ${pts} 1000,60`} fill="var(--color-cz-subtle)" />
          <polyline points={pts} fill="none" stroke="var(--color-cz-2)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
        </svg>
        {STAGE.climbs.map((cl) => (
          <span key={cl.name} title={`${cl.name} · ${tx(lang, cl.cat)}`} className="absolute top-[2px] h-[7px] w-[7px] -translate-x-1/2 rounded-full bg-cz-danger" style={{ left: pct(cl.crestKm) }} />
        ))}
        {r.change.km != null && (
          <span className="absolute inset-y-0 w-px bg-cz-warning" style={{ left: pct(r.change.km) }} />
        )}
        {r.events.map((e, i) => (
          <span
            key={i}
            className={`absolute bottom-[3px] flex h-[18px] min-w-[18px] -translate-x-1/2 items-center justify-center rounded-full border font-data text-3xs font-semibold tabular-nums ${
              e.trigger ? "border-cz-warning bg-cz-card text-cz-1" : "border-cz-border-strong bg-cz-card text-cz-1"
            }`}
            style={{ left: `min(max(9px, ${pct(e.km)}), calc(100% - 9px))` }}
          >
            {i + 1}
          </span>
        ))}
      </div>
      {/* Planens trin som baand under ruten, med nummer; navnet staar i listen under. */}
      {r.planned ? (
        <div className="relative mt-1 h-[22px]">
          {r.steps.map((s, i) =>
            s.span ? (
              <span
                key={i}
                className="absolute inset-y-0 flex items-center gap-1 overflow-hidden border border-cz-border bg-cz-subtle px-1.5 text-2xs text-cz-1 first:rounded-s-cz last:rounded-e-cz"
                style={{ left: pct(s.span[0]), width: pct(s.span[1] - s.span[0]) }}
              >
                <span className={MARK[s.mark].tone}><IconCheckOrMark mark={s.mark} /></span>
                <span className="font-data font-semibold tabular-nums">{i + 1}</span>
                <span className="truncate">{tx(lang, s.task)}</span>
              </span>
            ) : null,
          )}
        </div>
      ) : (
        <div className="mt-1 flex h-[22px] items-center border border-dashed border-cz-border px-2 text-2xs text-cz-3">{c.noPlan}</div>
      )}
      <div className="mt-1 flex justify-between font-data text-3xs uppercase tracking-wide text-cz-3 tabular-nums">
        <span>{c.km(0)}</span>
        <span>{c.stageFinish} · {c.km(STAGE.lengthKm)}</span>
      </div>
    </div>
  );
}

function IconCheckOrMark({ mark }: { mark: StepMark }) {
  const { Icon } = MARK[mark];
  return <span className="inline-flex"><Icon /></span>;
}

function VariantB({ lang }: { lang: Lang }) {
  return (
    <ul className="m-0 list-none p-0">
      {RIDERS.map((r) => (
        <li key={r.id} className="grid gap-x-8 gap-y-3 border-t border-cz-border py-4 md:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <div className="mb-2 flex min-h-11 flex-wrap items-baseline gap-x-2 md:min-h-0">
              <RiderName r={r} lang={lang} className="font-semibold" />
              <RiderMeta r={r} lang={lang} />
            </div>
            <ProfileStrip r={r} lang={lang} />
          </div>
          <div className="min-w-0 space-y-2 md:pt-7">
            <EventList events={r.events} lang={lang} numbered />
            <div className="border-t border-cz-border pt-2"><ReasonLine r={r} lang={lang} /></div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// --- C: planen foerst, fold ud ----------------------------------------------

function ChainInline({ r, lang }: { r: SketchRider; lang: Lang }) {
  const c = COPY[lang];
  if (!r.planned) return <NoPlan lang={lang} />;
  return (
    <span className="flex flex-wrap items-center gap-x-1.5 gap-y-1 text-sm">
      {r.steps.map((s, i) => (
        <span key={i} className="inline-flex items-center gap-1.5">
          {i > 0 && <span className="text-cz-3"><IconChevronRight /></span>}
          <span className={`inline-flex ${MARK[s.mark].tone}`}><IconCheckOrMark mark={s.mark} /></span>
          <span className={s.mark === "not_seen" ? "text-cz-3" : "font-medium text-cz-1"}>{tx(lang, s.task)}</span>
          {s.actualFromKm != null && s.plannedFrom && (
            <span className="font-data text-2xs tabular-nums text-cz-3">{c.km(s.actualFromKm)}</span>
          )}
        </span>
      ))}
    </span>
  );
}

function StepTimeline({ r, lang }: { r: SketchRider; lang: Lang }) {
  const c = COPY[lang];
  if (!r.planned) {
    return (
      <div className="space-y-2">
        <EventList events={r.events} lang={lang} />
      </div>
    );
  }
  return (
    <ol className="m-0 list-none p-0">
      {r.steps.map((s, i) => {
        const evs = eventsInSpan(r, s);
        const switchHere = i > 0 && r.change.source === "record" && r.change.km != null && s.span && s.span[0] === r.change.km;
        return (
          <li key={i} className="border-t border-cz-border py-2.5 first:border-t-0 first:pt-0">
            {switchHere && (
              <div className="mb-2"><ReasonLine r={r} lang={lang} /></div>
            )}
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-data text-2xs uppercase tracking-wider text-cz-3 tabular-nums">{c.step(i + 1)}</span>
              <span className="text-sm font-semibold text-cz-1">{tx(lang, s.task)}</span>
              <StepFrom s={s} lang={lang} />
            </div>
            <div className="mt-1 ps-0 md:ps-14">
              {s.mark === "not_seen" ? (
                <span className="flex items-start gap-2 text-sm text-cz-3"><MarkIcon mark="not_seen" />{c.notSeen}</span>
              ) : evs.length ? (
                <EventList events={evs} lang={lang} />
              ) : (
                <span className="text-sm text-cz-3">{c.notSeen}</span>
              )}
            </div>
          </li>
        );
      })}
      {r.change.source !== "record" && (
        <li className="border-t border-cz-border pt-2.5"><ReasonLine r={r} lang={lang} /></li>
      )}
    </ol>
  );
}

function VariantC({ lang, open }: { lang: Lang; open: string[] }) {
  const c = COPY[lang];
  return (
    <ul className="m-0 list-none p-0">
      {RIDERS.map((r) => (
        <li key={r.id} className="border-t border-cz-border">
          <details open={open.includes(r.id)} className="group">
            <summary className="grid min-h-11 cursor-pointer list-none grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 py-3 md:grid-cols-[minmax(150px,0.7fr)_minmax(0,2fr)_minmax(0,1.6fr)_auto] md:items-start [&::-webkit-details-marker]:hidden">
              <span className="flex min-w-0 flex-col">
                <RiderName r={r} lang={lang} className="font-semibold" />
                <RiderMeta r={r} lang={lang} />
              </span>
              <span className="col-span-2 row-start-2 min-w-0 md:col-span-1 md:row-start-auto"><ChainInline r={r} lang={lang} /></span>
              {/* Aaben: aarsagen flytter ned til det trin, hvor skiftet skete, saa den ikke staar to gange. */}
              <span className={`col-span-2 row-start-3 min-w-0 md:col-span-1 md:row-start-auto ${r.change.source === "record" ? "max-md:group-open:hidden md:group-open:invisible" : ""}`}><ReasonLine r={r} lang={lang} compact /></span>
              <span className="col-start-2 row-start-1 inline-flex items-center gap-1 self-start whitespace-nowrap pt-0.5 text-xs font-medium text-cz-2 md:col-start-auto md:row-start-auto">
                <span className="hidden sm:inline">{c.events(r.events.length)}</span>
                <span className="sm:hidden font-data tabular-nums">{r.events.length}</span>
                <span className="transition-transform group-open:rotate-180"><IconChevronDown /></span>
              </span>
            </summary>
            <div className="mb-3 rounded-cz border border-cz-border bg-cz-subtle px-4 py-3 md:ms-[calc(min(150px,12%)+1rem)]">
              <StepTimeline r={r} lang={lang} />
            </div>
          </details>
        </li>
      ))}
    </ul>
  );
}

// --- Siden ------------------------------------------------------------------

function RaceFrame({ lang, today, children }: { lang: Lang; today: boolean; children: ReactNode }) {
  const c = COPY[lang];
  return (
    <div className="mx-auto max-w-[1600px] px-4 pb-16 pt-4 md:px-8 md:pt-6">
      {/* Loebshovedet: kort med guld-streg oeverst (TASTE 12/11 regel 7), kun antydet. */}
      <div className="rounded-cz border border-cz-border border-t-2 border-t-cz-accent bg-cz-card px-5 py-4">
        <div className="font-display text-[32px] uppercase leading-[0.92] text-cz-1">{c.raceName}</div>
        <div className="mt-1.5 font-data text-2xs uppercase tracking-wide text-cz-3">{c.raceMeta}</div>
      </div>
      <div role="tablist" className="mt-4 flex gap-5 overflow-x-auto border-b border-cz-border">
        {c.tabs.map((tab, i) => (
          <span
            key={tab}
            role="tab"
            aria-selected={i === c.activeTab}
            className={`-mb-px inline-flex min-h-11 items-center whitespace-nowrap border-b-2 text-sm font-medium ${i === c.activeTab ? "border-cz-accent text-cz-1" : "border-transparent text-cz-2"}`}
          >
            {tab}
          </span>
        ))}
      </div>
      <section className="mt-4 rounded-cz border border-cz-border bg-cz-card p-4 md:p-5">
        <div className="mb-3 flex items-baseline justify-between gap-4">
          <h2 className="m-0 text-[15px] font-semibold text-cz-1">{c.sectionTitle}</h2>
          <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3 tabular-nums">{c.sectionMeta}</span>
        </div>
        <p className="m-0 pb-2.5 text-sm text-cz-2">{today ? c.introToday : c.intro}</p>
        {children}
      </section>
    </div>
  );
}

export default function Sketch({ variant, lang, open }: Props) {
  return (
    <RaceFrame lang={lang} today={variant === "now"}>
      {variant === "now" && <VariantNow lang={lang} />}
      {variant === "a" && <VariantA lang={lang} />}
      {variant === "b" && <VariantB lang={lang} />}
      {variant === "c" && <VariantC lang={lang} open={open} />}
    </RaceFrame>
  );
}
