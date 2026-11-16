// Skitse #7638: prisordet (Let / Middel / Hård / Meget hård) de tre steder, hvor det mangler i dag:
// enkeltstartens indsatstrin, holdets udbrudsholdning og de gamle ordreknapper. Tre varianter (A/B/C).
// Ingen produktkode: siden genbruger kun spillets tokens, ikoner og tekster.
import type { ReactNode } from "react";
import { CheckIcon, ChevronRightIcon } from "../../../components/ui/index.js";
import type { TaskCostWord } from "../../../components/race/tacticsReady7864.ts";
import {
  ITT_OPEN,
  ITT_RIDERS,
  ITT_STEPS,
  ORDER_RIDERS,
  PLAN_LINE,
  PRICE_LEVEL,
  STANCES,
  STANCE_PRICE,
  T,
  TOGGLE_PRICE,
  TRAIN_LINE,
  ittPrice,
  ittWhy,
  type IttStep,
  type SketchRider,
  type Stance,
  type Variant,
} from "./data.ts";

type V = Variant["id"];

/** Variant B: fire små firkanter, fyldt op til prisens trin. Ordet bærer betydningen; trappen er pynt for øjet. */
function Stairs({ word }: { word: TaskCostWord }) {
  const level = PRICE_LEVEL[word];
  return (
    <span aria-hidden="true" className="inline-flex items-end gap-[2px]">
      {[1, 2, 3, 4].map((i) => (
        <span
          key={i}
          style={{ height: 3 + i * 2 }}
          className={`block w-[4px] ${i <= level ? "bg-cz-2" : "border border-cz-border"}`}
        />
      ))}
    </span>
  );
}

/** Prisordet inde i en kontrol (variant A og B). C viser intet her. */
function InlinePrice({ v, word }: { v: V; word: TaskCostWord }) {
  if (v === "c") return null;
  return (
    <span className="inline-flex items-center gap-1.5 font-normal normal-case tracking-normal text-cz-2" data-price={word}>
      {v === "b" && <Stairs word={word} />}
      {T.price[word]}
    </span>
  );
}

function Caption({ variant }: { variant: Variant }) {
  return (
    <header className="border-b-2 border-cz-1 bg-cz-card px-4 py-4 sm:px-8">
      <div className="mx-auto flex max-w-[1600px] items-baseline gap-4">
        <span className="font-data text-[40px] font-bold leading-none text-cz-1">{variant.letter}</span>
        <div className="min-w-0">
          <h1 className="m-0 flex flex-wrap items-baseline gap-x-3 font-data text-[20px] font-bold tracking-[-0.01em] text-cz-1">
            {variant.name}
            {variant.recommended && (
              <span className="rounded-cz border border-cz-border px-1.5 py-0.5 text-2xs font-semibold text-cz-1">Anbefalet</span>
            )}
          </h1>
          <p className="m-0 mt-1 text-[13px] text-cz-2">{variant.line}</p>
        </div>
      </div>
    </header>
  );
}

function Card({ title, meta, children }: { title: string; meta?: string; children: ReactNode }) {
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card">
      <div className="flex items-baseline justify-between gap-4 px-4 pt-4 sm:px-5 sm:pt-5">
        <h2 className="m-0 text-[15px] font-semibold text-cz-1">{title}</h2>
        {meta && <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">{meta}</span>}
      </div>
      <div className="mt-4">{children}</div>
    </section>
  );
}

/** Etapeplanens opgave-chip som den ser ud i dag (StagePlanBoard TaskChip). Referencen alle tre steder retter sig efter. */
function TaskChip({ task, word }: { task: string; word: TaskCostWord }) {
  return (
    <span className="inline-flex items-center rounded-cz border border-cz-border bg-cz-subtle px-2 py-0.5 text-2xs font-medium whitespace-nowrap text-cz-1">
      {task}
      <span className="ml-1 text-cz-2">{T.price[word]}</span>
    </span>
  );
}

function Reference() {
  return (
    <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-cz border border-dashed border-cz-border px-4 py-3 text-xs text-cz-2">
      <span className="text-cz-1 font-medium">Etapeplanen i dag:</span>
      <span className="inline-flex flex-wrap items-center gap-1.5">
        <TaskChip task="Bliv i læ" word="easy" />
        <ChevronRightIcon size={12} aria-hidden="true" className="text-cz-3" />
        <span className="text-3xs text-cz-3">sidste 10 km</span>
        <TaskChip task="Angrib" word="veryHard" />
      </span>
      <TaskChip task="Hold lederen fremme" word="medium" />
      <span className="basis-full text-3xs text-cz-3 sm:basis-auto">Samme fire ord og samme rækkefølge bruges alle tre steder nedenfor.</span>
    </div>
  );
}

// ---------- 1) Enkeltstartens indsatstrin ----------

function IntentionChip({ v, step }: { v: V; step: IttStep }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-cz border border-cz-accent/30 bg-cz-accent/10 px-2 py-0.5 text-2xs font-semibold whitespace-nowrap text-cz-accent-t">
      {T.step[step]}
      <InlinePrice v={v} word={ittPrice(step)} />
    </span>
  );
}

function IntentionPicker({ v, rider, mobile }: { v: V; rider: SketchRider; mobile: boolean }) {
  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" role="group" aria-label={`Indsats for ${rider.name}`}>
      <div className="flex items-baseline justify-between gap-3 border-b border-cz-border px-3.5 py-2">
        <span className="text-xs font-semibold text-cz-1">{rider.name} · etape 4</span>
        <span className="whitespace-nowrap text-3xs text-cz-3">Gælder kun denne etape</span>
      </div>
      {ITT_STEPS.map((step) => {
        const on = step === rider.effort;
        const word = ittPrice(step);
        return (
          <button
            key={step}
            type="button"
            aria-pressed={on}
            className={`flex w-full flex-wrap items-center gap-x-3 gap-y-1 border-b border-cz-border px-3.5 py-2 text-left last:border-b-0 ${
              mobile ? "min-h-11" : ""
            } ${on ? "bg-cz-accent/10" : "hover:bg-cz-subtle"} focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cz-accent`}
          >
            <span className="w-3.5 shrink-0 text-cz-accent-t">{on && <CheckIcon size={14} aria-hidden="true" />}</span>
            <span className={`flex shrink-0 items-center gap-2 text-xs ${v === "c" ? "sm:w-32" : "sm:w-48"} ${on ? "font-semibold text-cz-accent-t" : "font-medium text-cz-1"}`}>
              {T.step[step]}
              <InlinePrice v={v} word={word} />
            </span>
            <span className="basis-full ps-[26px] text-xs text-cz-2 sm:basis-auto sm:ps-0">{ittWhy(step)}</span>
            {v === "c" ? (
              <span className="basis-full ps-[26px] text-3xs text-cz-2 sm:ms-auto sm:basis-auto sm:ps-0 whitespace-nowrap" data-price={word}>
                Pris i benene: <span className="font-semibold text-cz-1">{T.price[word]}</span>
              </span>
            ) : (
              step === "normal" && <span className="text-3xs uppercase tracking-wider whitespace-nowrap text-cz-3 sm:ms-auto">Rollens standard</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function IttRow({ v, rider, mobile }: { v: V; rider: SketchRider; mobile: boolean }) {
  const open = rider.id === ITT_OPEN;
  const word = ittPrice(rider.effort);
  const change = (
    <button type="button" aria-expanded={open} className={`whitespace-nowrap text-xs font-medium text-cz-accent-t hover:underline ${mobile ? "min-h-11 min-w-11 px-2" : ""}`}>
      {open ? "Luk" : "Ændr"}
    </button>
  );
  const line = (
    <p className="m-0 mt-1 text-3xs text-cz-3">
      {rider.role.toLowerCase()}, i dag: {T.step[rider.effort].toLowerCase()}
      {v === "c" && (
        <>
          {". "}
          <span className="text-cz-2">
            Pris i benene: <span className="font-semibold text-cz-1">{T.price[word]}</span>
          </span>
        </>
      )}
    </p>
  );
  return (
    <li className="border-t border-cz-border px-4 py-3 sm:px-5">
      {mobile ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-cz-1">{rider.name}</span>
            <span className="text-xs text-cz-2">{rider.role}</span>
          </div>
          <div className="mt-2 flex items-center justify-between gap-2">
            <div className="min-w-0">
              <IntentionChip v={v} step={rider.effort} />
              {line}
            </div>
            {change}
          </div>
        </>
      ) : (
        <div className="grid grid-cols-[220px_140px_1fr] items-start gap-4">
          <span className="text-[13.5px] font-medium text-cz-1">{rider.name}</span>
          <span className="text-xs text-cz-1">{rider.role}</span>
          <div>
            <div className="flex flex-wrap items-center gap-2.5">
              <IntentionChip v={v} step={rider.effort} />
              {change}
            </div>
            {line}
          </div>
        </div>
      )}
      {open && (
        <div className={mobile ? "mt-2.5" : "mt-3 sm:ms-[376px]"}>
          <IntentionPicker v={v} rider={rider} mobile={mobile} />
        </div>
      )}
    </li>
  );
}

function IttSection({ v, mobile }: { v: V; mobile: boolean }) {
  return (
    <Card title="Sted 1: enkeltstartens indsatstrin" meta="Etape 4, enkeltstart">
      <p className="m-0 px-4 pb-3 text-xs text-cz-2 sm:px-5">Tidskørsler køres mod uret. Dine indsatsvalg gælder stadig.</p>
      <ul className="m-0 list-none p-0">
        {ITT_RIDERS.map((r) => (
          <IttRow key={r.id} v={v} rider={r} mobile={mobile} />
        ))}
      </ul>
    </Card>
  );
}

// ---------- 2) Holdets udbrudsholdning ----------

function StanceGroup({ v, active, mobile }: { v: V; active: Stance; mobile: boolean }) {
  return (
    <div>
      <div role="group" aria-label="Holdets udbruds-holdning" className="flex w-full overflow-hidden rounded-cz border border-cz-border">
        {STANCES.map((s) => {
          const on = s === active;
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              className={`flex flex-1 flex-col items-center justify-center gap-0.5 border-s border-cz-border px-2 py-1.5 text-center leading-tight first:border-s-0 focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-cz-accent ${
                mobile ? "min-h-11" : ""
              } ${on ? "bg-cz-accent/10 text-cz-accent-t" : "bg-cz-card text-cz-2 hover:text-cz-1"}`}
            >
              <span className={`text-2xs ${on ? "font-semibold" : "font-medium"}`}>{T.stance[s]}</span>
              {v !== "c" && (
                <span className="text-3xs">
                  <InlinePrice v={v} word={STANCE_PRICE[s]} />
                </span>
              )}
            </button>
          );
        })}
      </div>
      {v === "c" && (
        <p className="m-0 mt-1.5 text-3xs text-cz-2" data-price={STANCE_PRICE[active]}>
          Pris for dem, der jager: <span className="font-semibold text-cz-1">{T.price[STANCE_PRICE[active]]}</span>
        </p>
      )}
      {v !== "c" && <p className="m-0 mt-1.5 text-3xs text-cz-3">Prisen gælder de ryttere, der jager.</p>}
      <p className="m-0 mt-1 text-2xs leading-snug text-cz-3">{T.gcNote}</p>
    </div>
  );
}

function StanceSection({ v, mobile }: { v: V; mobile: boolean }) {
  return (
    <Card title="Sted 2: holdets udbrudsholdning" meta="Etape 5, bakket">
      <div className="grid grid-cols-1 gap-4 border-t border-cz-border px-4 py-4 sm:grid-cols-[1fr_1.4fr_1fr] sm:px-5">
        <div>
          <p className="m-0 text-3xs uppercase tracking-wide text-cz-3">{T.planLabel}</p>
          <p className="m-0 mt-0.5 text-xs leading-snug text-cz-1">{PLAN_LINE}</p>
        </div>
        <div>
          <p className="m-0 mb-1 text-3xs uppercase tracking-wide text-cz-3">{T.stanceLabel}</p>
          <StanceGroup v={v} active="neutral" mobile={mobile} />
        </div>
        <div>
          <p className="m-0 text-3xs uppercase tracking-wide text-cz-3">{T.leadout}</p>
          <p className="m-0 mt-0.5 text-xs leading-snug text-cz-1">{TRAIN_LINE}</p>
        </div>
      </div>
      <p className="m-0 mx-4 mb-4 rounded-cz border border-dashed border-cz-border px-3 py-2 text-3xs leading-snug text-cz-2 sm:mx-5">
        Åbent spørgsmål: holdningen har intet prisord i spillet i dag. Skitsen foreslår Jag = Hård, Vurder undervejs = Middel og Overlad jagten til andre = Let for de ryttere, der jager. Det skal bekræftes mod motoren før byg.
      </p>
    </Card>
  );
}

// ---------- 3) De gamle ordreknapper ----------

function Toggle({ v, label, word, active, hidden = false, mobile }: { v: V; label: string; word: TaskCostWord; active: boolean; hidden?: boolean; mobile: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      aria-hidden={hidden || undefined}
      tabIndex={hidden ? -1 : undefined}
      className={`inline-flex shrink-0 items-center gap-1.5 rounded-cz border px-2 py-1 text-3xs font-medium uppercase tracking-wide ${
        mobile ? "min-h-11" : ""
      } ${hidden ? "invisible" : ""} ${active ? "border-cz-accent bg-cz-accent/10 text-cz-accent-t" : "border-cz-accent/40 bg-transparent text-cz-accent-t hover:bg-cz-accent/5"} focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cz-accent`}
    >
      <CheckIcon size={10} aria-hidden="true" className={active ? "" : "invisible"} />
      {label}
      <InlinePrice v={v} word={word} />
    </button>
  );
}

function OrderRow({ v, rider, mobile }: { v: V; rider: SketchRider; mobile: boolean }) {
  const toggles = (
    <span className="flex flex-wrap items-center gap-2">
      <Toggle v={v} mobile={mobile} label={T.tryBreak} word={TOGGLE_PRICE.tryBreak} active={rider.tryBreak === true} />
      {!(mobile && rider.sprintCaptain) && (
        <Toggle v={v} mobile={mobile} label={T.leadout} word={TOGGLE_PRICE.leadout} active={rider.leadout === true} hidden={rider.sprintCaptain} />
      )}
      {v === "c" && (
        <span className="basis-full text-3xs text-cz-2">
          Pris: {T.tryBreak.toLowerCase()} <span className="font-semibold text-cz-1">{T.price[TOGGLE_PRICE.tryBreak]}</span>
          {!rider.sprintCaptain && (
            <>
              , sprint-tog <span className="font-semibold text-cz-1">{T.price[TOGGLE_PRICE.leadout]}</span>
            </>
          )}
        </span>
      )}
    </span>
  );
  const chip = <IntentionChip v={v} step={rider.effort} />;
  return (
    <li className="border-t border-cz-border px-4 py-3 sm:px-5">
      {mobile ? (
        <>
          <div className="flex items-baseline justify-between gap-3">
            <span className="min-w-0 truncate text-sm font-medium text-cz-1">{rider.name}</span>
            <span className="text-xs text-cz-2">{rider.role}</span>
          </div>
          <div className="mt-2">{chip}</div>
          <div className="mt-2">{toggles}</div>
        </>
      ) : (
        <div className="grid grid-cols-[220px_140px_minmax(180px,240px)_1fr] items-center gap-4">
          <span className="text-[13.5px] font-medium text-cz-1">{rider.name}</span>
          <span className="text-xs text-cz-1">{rider.role}</span>
          <span>{chip}</span>
          {toggles}
        </div>
      )}
    </li>
  );
}

function OrdersSection({ v, mobile }: { v: V; mobile: boolean }) {
  return (
    <Card title="Sted 3: de gamle ordreknapper" meta="Etape 2, flad, uden etapeplan">
      <ul className="m-0 list-none p-0">
        {ORDER_RIDERS.map((r) => (
          <OrderRow key={r.id} v={v} rider={r} mobile={mobile} />
        ))}
      </ul>
    </Card>
  );
}

export function SketchPage({ variant, mobile }: { variant: Variant; mobile: boolean }) {
  return (
    <div className="min-h-screen bg-cz-body">
      <Caption variant={variant} />
      <main className="mx-auto flex max-w-[1600px] flex-col gap-[14px] px-4 pt-7 pb-16 sm:px-8">
        <Reference />
        <IttSection v={variant.id} mobile={mobile} />
        <StanceSection v={variant.id} mobile={mobile} />
        <OrdersSection v={variant.id} mobile={mobile} />
      </main>
    </div>
  );
}
