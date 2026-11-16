// #7947 runde 2: fire et-tryks-forslag (D1-D4) og den gamle flade, genskabt
// fra koden. Ejeren 16/11: A/B/C i runde 1 var for tunge; det almindelige valg
// pr. rytter skal vaere et tryk, og aktiv restitution bor under Hvile.
// Intet her er produktkode; siden loeber ikke fra appen og gemmer intet.

import { useState, type ReactNode } from "react";
import Segmented from "../../../../components/ui/Segmented.jsx";
import Button from "../../../../components/ui/Button.jsx";
import type { Lang } from "../copy.ts";
import { RIDERS, type SketchRider } from "../data.ts";
import { COPY } from "../copy.ts";
import {
  EFFORTS,
  effortForSession,
  planFromChoice,
  sessionsForEffort,
  type Effort,
  type Plan,
} from "../effortModel.ts";
import { COPY2, effortName, sessionName, type VariantId } from "./copy2.ts";
import { EXTRA, TONE_TEXT } from "./picks.ts";
import {
  HOME,
  choiceForQuick,
  effortOf,
  isActiveRecovery,
  ownTraining,
  planForQuick,
  sessionOf,
  type Quick,
} from "./quickModel.ts";

type Props = { variant: VariantId; lang: Lang; openId: string | null };

const SKILL = ["technique", "aero", "loebslaere"];
const SEG_ON = "cursor-default bg-cz-accent/10 font-semibold text-cz-accent-t";
const SEG_OFF = "bg-cz-card text-cz-2 hover:text-cz-1";
const SEG_BTN =
  "min-h-9 font-medium transition-colors duration-150 [@media(max-width:640px),(pointer:coarse)]:min-h-11";

// --- Faelles ---------------------------------------------------------------

function usePlans(map: (p: Plan) => Plan = (p) => p) {
  const [plans, setPlans] = useState<Record<string, Plan>>(() =>
    Object.fromEntries(RIDERS.map((r) => [r.id, map(r.plan)])),
  );
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const save = (id: string, plan: Plan) => {
    setPlans((p) => ({ ...p, [id]: plan }));
    setJustSaved(id);
  };
  return { plans, save, justSaved };
}

function Banner({ variant, lang }: { variant: VariantId; lang: Lang }) {
  const c = COPY2[lang];
  const b = c.banners[variant];
  return (
    <header data-testid="sketch-banner" className="border-b-2 border-cz-accent bg-cz-subtle">
      <div className="mx-auto max-w-[1600px] px-4 py-4 sm:px-8">
        <div className="font-data text-2xs uppercase tracking-wide text-cz-3">{c.sketch}</div>
        <h2 className="mt-1 text-xl font-bold leading-tight text-cz-1 sm:text-2xl">{b.name}</h2>
        <p className="mt-1.5 max-w-[920px] text-sm text-cz-1">{b.what}</p>
        <p className="mt-1.5 font-data text-xs font-semibold tabular-nums text-cz-accent-t">{b.taps}</p>
      </div>
    </header>
  );
}

function RiderCell({ r, lang }: { r: SketchRider; lang: Lang }) {
  const c = COPY2[lang];
  const tone = EXTRA[r.id].tone;
  return (
    <div className="min-w-0">
      <div className="truncate text-[13.5px] font-medium text-cz-1">
        {c.rider} {r.label}
      </div>
      <div className="truncate font-data text-3xs uppercase tracking-wide text-cz-3">
        {COPY[lang].types[r.type]} · {c.fatigue}{" "}
        <span className={`font-semibold tabular-nums ${TONE_TEXT[tone]}`}>{r.fatigue}</span>
      </div>
    </div>
  );
}

function Saved({ lang, show }: { lang: Lang; show: boolean }) {
  if (!show) return null;
  return (
    <span role="status" className="inline-flex items-center gap-1 text-2xs font-semibold text-cz-success">
      <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
        <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      {COPY2[lang].saved}
    </span>
  );
}

// Knapgruppe med valgfri overskrift; et tryk paa en knap ER valget (ingen gem).
function Group({
  caption,
  captionClass = "",
  items,
  className = "",
}: {
  caption?: string;
  captionClass?: string;
  items: { key: string; label: ReactNode; on: boolean; onClick: () => void }[];
  className?: string;
}) {
  return (
    <div className={`min-w-0 ${className}`}>
      {caption && <div className={`mb-1 font-data text-3xs uppercase tracking-wide text-cz-3 ${captionClass}`}>{caption}</div>}
      <div role="group" aria-label={caption} className="flex overflow-hidden rounded-cz border border-cz-border">
        {items.map((it, i) => (
          <button
            key={it.key}
            type="button"
            aria-pressed={it.on}
            onClick={it.on ? undefined : it.onClick}
            className={`${SEG_BTN} min-w-0 flex-1 px-1.5 py-1 text-2xs leading-tight break-words lg:px-3 lg:text-xs lg:truncate lg:whitespace-nowrap ${i > 0 ? "border-s border-cz-border" : ""} ${it.on ? SEG_ON : SEG_OFF}`}
          >
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// Den naturlige liste til "en anden traening": grupperet efter indsats.
function TrainingSelect({
  lang,
  value,
  onPick,
  only,
  label,
  compact,
}: {
  lang: Lang;
  value: string;
  onPick: (session: string) => void;
  only?: Effort;
  label: string;
  // compact: kort "Skift"-felt til telefonens navnelinje i stedet for en hel raekke.
  compact?: string;
}) {
  const levels = (only ? [only] : (["easy", "normal", "hard"] as Effort[])).filter((e) => e !== "rest");
  return (
    <div className={`relative min-w-0 ${compact ? "w-24 flex-none" : ""}`}>
      <select
        aria-label={label}
        value={value}
        onChange={(e) => onPick(e.target.value)}
        className="w-full appearance-none rounded-cz border border-cz-border bg-cz-card py-1.5 pe-7 ps-2.5 text-xs text-cz-2 hover:border-cz-2/40 [@media(max-width:640px),(pointer:coarse)]:min-h-11"
      >
        <option value="">{compact ?? label}</option>
        {levels.map((lv) => (
          <optgroup key={lv} label={effortName(lang, lv)}>
            {sessionsForEffort(lv, HOME).map((s) => (
              <option key={s} value={s}>
                {sessionName(lang, s)}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
      <svg
        className="pointer-events-none absolute inset-e-2 top-1/2 -translate-y-1/2 text-cz-3"
        width="12"
        height="12"
        viewBox="0 0 16 16"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        aria-hidden="true"
      >
        <path d="M4 6l4 4 4-4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}

// Rytterens navn med en hoejre-plads, saa telefonen kan have "Skift" (og i D3
// "Hvil i dag") i samme linje som navnet i stedet for en ekstra raekke.
function Head({ r, lang, right }: { r: SketchRider; lang: Lang; right?: ReactNode }) {
  return (
    <div className="flex min-w-0 items-center justify-between gap-2">
      <RiderCell r={r} lang={lang} />
      {right && <div className="flex flex-none items-center gap-2 lg:hidden">{right}</div>}
    </div>
  );
}

const planForSession = (s: string): Plan => {
  const e = effortForSession(s) as Effort;
  return planFromChoice(e, s);
};

function EffortTag({ lang, session }: { lang: Lang; session: string | null }) {
  const e = effortForSession(session);
  if (!e) return null;
  return <span className="ms-1.5 hidden font-data text-3xs uppercase tracking-wide opacity-70 lg:inline">{effortName(lang, e)}</span>;
}

// --- D1: som foer, bare bedre -----------------------------------------------

function d1Buttons(plan: Plan, fallback: string) {
  const own = ownTraining(plan, fallback);
  const ownEffort = effortForSession(own);
  return {
    easy: ownEffort === "easy" ? own : "endurance",
    train: ownEffort === "easy" ? fallback : own,
  };
}

function D1({ lang }: { lang: Lang }) {
  const c = COPY2[lang];
  const { plans, save, justSaved } = usePlans();
  const GRID = "lg:grid-cols-[200px_minmax(0,600px)_200px_1fr]";
  return (
    <>
    <div className={`mb-1 hidden gap-4 font-data text-2xs uppercase tracking-wide text-cz-3 lg:grid ${GRID}`}>
      <span>{c.rider}</span>
      <span className="grid grid-cols-[1fr_1.9fr] gap-2 lg:grid-cols-[2fr_3fr]">
        <span>{c.restGroup}</span>
        <span>{c.trainGroup}</span>
      </span>
      <span>{c.changeTraining}</span>
      <span />
    </div>
    <ul className="divide-y divide-cz-border">
      {RIDERS.map((r) => {
        const plan = plans[r.id];
        const fb = r.suggest.hard;
        const { easy, train } = d1Buttons(plan, fb);
        const eff = effortOf(plan);
        const sess = sessionOf(plan);
        const keep = ownTraining(plan, fb);
        const pick = (s: string) => s && save(r.id, planForSession(s));
        return (
          <li key={r.id} className={`grid gap-2 py-3 lg:items-center lg:gap-4 ${GRID}`}>
            <Head
              r={r}
              lang={lang}
              right={<TrainingSelect lang={lang} value="" label={c.changeTraining} compact={c.change} onPick={pick} />}
            />
            <div className="grid grid-cols-[1fr_1.9fr] gap-2 lg:grid-cols-[2fr_3fr]">
              <Group
                caption={c.restGroup}
                captionClass="lg:hidden"
                items={[
                  {
                    key: "rest",
                    label: (
                      <>
                        <span className="lg:hidden">{c.full}</span>
                        <span className="hidden lg:inline">{c.fullRest}</span>
                      </>
                    ),
                    on: eff === "rest" && !isActiveRecovery(plan),
                    onClick: () => save(r.id, planForQuick("rest", plan, fb)),
                  },
                  { key: "active", label: c.active, on: isActiveRecovery(plan), onClick: () => save(r.id, planForQuick("active", plan, fb)) },
                ]}
              />
              <Group
                caption={c.trainGroup}
                captionClass="lg:hidden"
                items={[
                  { key: "easy", label: sessionName(lang, easy), on: eff !== "rest" && sess === easy, onClick: () => save(r.id, planFromChoice("easy", easy, { keepFocus: keep })) },
                  {
                    key: "train",
                    label: (
                      <span className="inline-flex items-baseline">
                        <span className="lg:truncate">{sessionName(lang, train)}</span>
                        <EffortTag lang={lang} session={train} />
                      </span>
                    ),
                    on: eff !== "rest" && sess === train,
                    onClick: () => save(r.id, planForSession(train)),
                  },
                ]}
              />
            </div>
            <div className="hidden lg:block">
              <TrainingSelect lang={lang} value="" label={c.changeTraining} onPick={pick} />
            </div>
            <div className="hidden lg:block">
              <Saved lang={lang} show={justSaved === r.id} />
            </div>
          </li>
        );
      })}
    </ul>
    </>
  );
}

// --- D2: fire indsatser, et tryk --------------------------------------------

function D2({ lang, openId }: { lang: Lang; openId: string | null }) {
  const c = COPY2[lang];
  const { plans, save, justSaved } = usePlans();
  const [open, setOpen] = useState<string | null>(openId);
  return (
    <ul className="divide-y divide-cz-border">
      {RIDERS.map((r) => {
        const plan = plans[r.id];
        const fb = r.suggest.hard;
        const eff = effortOf(plan);
        const sess = sessionOf(plan);
        const opts = EFFORTS.map((e) => ({ value: e, label: effortName(lang, e) }));
        const isOpen = open === r.id;
        return (
          <li key={r.id} className="grid gap-2 py-3 lg:grid-cols-[200px_340px_minmax(0,1fr)_90px] lg:items-center lg:gap-4">
            <RiderCell r={r} lang={lang} />
            <Segmented
              label={`${c.rider} ${r.label}`}
              value={eff ?? ""}
              options={opts}
              onChange={(e: string) => {
                setOpen(null);
                save(r.id, planForQuick(e as Quick, plan, fb));
              }}
              className="w-full [&>button]:flex-1"
            />
            <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs">
              {eff === "rest" ? (
                <Group
                  className="w-full sm:w-auto"
                  items={[
                    { key: "full", label: c.fullRest, on: !isActiveRecovery(plan), onClick: () => save(r.id, planForQuick("rest", plan, fb)) },
                    { key: "active", label: c.activeLong, on: isActiveRecovery(plan), onClick: () => save(r.id, planForQuick("active", plan, fb)) },
                  ]}
                />
              ) : isOpen && eff ? (
                <div className="w-full max-w-[260px]">
                  <TrainingSelect lang={lang} only={eff} value={sess ?? ""} label={c.changeTraining} onPick={(s) => { if (s) { save(r.id, planForSession(s)); setOpen(null); } }} />
                </div>
              ) : (
                <>
                  <span className="truncate font-medium text-cz-1">{sessionName(lang, sess)}</span>
                  <button
                    type="button"
                    onClick={() => setOpen(r.id)}
                    className="text-2xs font-medium text-cz-accent-t hover:underline [@media(max-width:640px),(pointer:coarse)]:min-h-11"
                  >
                    {c.change}
                  </button>
                </>
              )}
            </div>
            <div className="hidden lg:block">
              <Saved lang={lang} show={justSaved === r.id} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

// --- D3: holdets dag plus undtagelser ---------------------------------------

function D3({ lang }: { lang: Lang }) {
  const c = COPY2[lang];
  const [team, setTeam] = useState<Effort>("hard");
  const [own, setOwn] = useState<Record<string, string>>(() =>
    Object.fromEntries(RIDERS.map((r) => [r.id, ownTraining(r.plan, r.suggest.hard)])),
  );
  // Undtagelser: hvem hviler i dag, og hvordan. Start: de to mest traette.
  const [resting, setResting] = useState<Record<string, "full" | "active">>({ r4: "active", r7: "full" });
  const [custom, setCustom] = useState<Record<string, string>>({});
  const teamOpts = (["easy", "normal", "hard"] as Effort[]).map((e) => ({ value: e, label: effortName(lang, e) }));
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center gap-x-4 gap-y-2 rounded-cz border border-cz-border bg-cz-subtle p-3">
        <div className="text-[13px] font-semibold text-cz-1">{c.teamDay}</div>
        <Segmented label={c.teamDay} value={team} options={teamOpts} onChange={(e: string) => setTeam(e as Effort)} />
        <div className="text-2xs text-cz-3">{c.teamDayNote}</div>
      </div>
      <ul className="divide-y divide-cz-border">
        {RIDERS.map((r) => {
          const rest = resting[r.id];
          const basePlan: Plan = { focus: own[r.id], intensity: effortForSession(own[r.id]) };
          // En traening valgt i listen er en undtagelse: den koeres paa sin egen
          // indsats, ogsaa naar den ikke passer til holdets dag.
          const isCustom = r.id in custom;
          const today = isCustom
            ? { session: custom[r.id], effort: effortForSession(custom[r.id]) }
            : choiceForQuick(team as Quick, basePlan, r.suggest.hard);
          const toggle = () =>
            setResting((m) => {
              const n = { ...m };
              if (n[r.id]) delete n[r.id];
              else n[r.id] = "full";
              return n;
            });
          const restBtn = (
            <button
              type="button"
              aria-pressed={Boolean(rest)}
              onClick={toggle}
              className={`whitespace-nowrap rounded-cz border px-3 text-xs font-medium transition-colors duration-150 min-h-9 [@media(max-width:640px),(pointer:coarse)]:min-h-11 ${
                rest ? `border-cz-accent/50 ${SEG_ON}` : `border-cz-border ${SEG_OFF}`
              }`}
            >
              {c.restToday}
            </button>
          );
          const pick = (s: string) => {
            if (!s) return;
            setOwn((m) => ({ ...m, [r.id]: s }));
            setCustom((m) => ({ ...m, [r.id]: s }));
          };
          return (
            <li key={r.id} className="grid gap-2 py-3 lg:grid-cols-[200px_minmax(0,1fr)_150px_200px] lg:items-center lg:gap-4">
              <Head
                r={r}
                lang={lang}
                right={restBtn}
              />
              <div className="min-w-0 text-xs">
                {rest ? (
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium text-cz-1">{c.resting}</span>
                    <Group
                      items={[
                        { key: "full", label: c.fullRest, on: rest === "full", onClick: () => setResting((m) => ({ ...m, [r.id]: "full" })) },
                        { key: "active", label: c.activeLong, on: rest === "active", onClick: () => setResting((m) => ({ ...m, [r.id]: "active" })) },
                      ]}
                    />
                  </div>
                ) : (
                  <div className="flex items-center justify-between gap-2">
                    <span className="min-w-0">
                      <span className="font-medium text-cz-1">{sessionName(lang, today.session)}</span>
                      <span className="text-cz-3"> · {effortName(lang, today.effort as Effort)} · {isCustom ? c.yours.toLowerCase() : c.followsTeam}</span>
                    </span>
                    <div className="lg:hidden">
                      <TrainingSelect lang={lang} value="" label={c.changeTraining} compact={c.change} onPick={pick} />
                    </div>
                  </div>
                )}
              </div>
              <div className="hidden lg:grid">{restBtn}</div>
              <div className="hidden lg:block">
                <TrainingSelect lang={lang} value="" label={c.changeTraining} onPick={pick} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// --- D4: assistenten foreslaar, du retter -----------------------------------

function D4({ lang }: { lang: Lang }) {
  const c = COPY2[lang];
  const [accepted, setAccepted] = useState(false);
  // Dine rettelser pr. rytter. Start: en rettet rytter, saa billedet viser begge tilstande.
  const [mine, setMine] = useState<Record<string, Plan>>(() => {
    const r6 = RIDERS.find((r) => r.id === "r6");
    return r6 ? { r6: planForQuick("hard", r6.plan, r6.suggest.hard) } : {};
  });
  const opts = EFFORTS.map((e) => ({ value: e, label: effortName(lang, e) }));
  const label = (plan: Plan) =>
    isActiveRecovery(plan)
      ? c.activeLong
      : effortOf(plan) === "rest"
        ? c.fullRest
        : `${sessionName(lang, sessionOf(plan))} · ${effortName(lang, effortOf(plan) as Effort)}`;
  return (
    <>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 rounded-cz border border-cz-border bg-cz-subtle p-3">
        <div className="min-w-0">
          <div className="text-[13px] font-semibold text-cz-1">{c.assistantTitle}</div>
          <div className="text-2xs text-cz-3">{c.assistantNote}</div>
        </div>
        <Button variant="primary" size="sm" disabled={accepted} onClick={() => setAccepted(true)}>
          {c.useAll(RIDERS.length)}
        </Button>
      </div>
      <ul className="divide-y divide-cz-border">
        {RIDERS.map((r) => {
          const fb = r.suggest.hard;
          const x = EXTRA[r.id];
          const plan = mine[r.id] ?? planForQuick(x.pick, r.plan, fb);
          const isMine = r.id in mine;
          const settled = accepted || isMine;
          const pick = (s: string) => s && setMine((m) => ({ ...m, [r.id]: planForSession(s) }));
          return (
            <li key={r.id} className="grid gap-2 py-3 lg:grid-cols-[200px_minmax(0,1fr)_340px_160px] lg:items-center lg:gap-4">
              <Head
                r={r}
                lang={lang}
                right={<TrainingSelect lang={lang} value="" label={c.changeTraining} compact={c.change} onPick={pick} />}
              />
              <div
                className={`flex min-w-0 flex-wrap items-baseline gap-x-2 rounded-cz border px-2.5 py-1.5 text-xs ${
                  settled ? "border-transparent" : "border-dashed border-cz-border"
                }`}
              >
                <span className="font-medium text-cz-1">{label(plan)}</span>
                <span className="text-cz-3">
                  {isMine ? c.yours : `${c.assistant}: ${c.reasons[x.reason]}`}
                </span>
                {settled && <Saved lang={lang} show />}
              </div>
              <div className="flex min-w-0 flex-col gap-1.5">
                <Segmented
                  label={`${c.rider} ${r.label}`}
                  value={effortOf(plan) ?? ""}
                  options={opts}
                  onChange={(e: string) => setMine((m) => ({ ...m, [r.id]: planForQuick(e as Quick, plan, fb) }))}
                  className="w-full [&>button]:flex-1"
                />
                {effortOf(plan) === "rest" && (
                  <Group
                    items={[
                      { key: "full", label: c.fullRest, on: !isActiveRecovery(plan), onClick: () => setMine((m) => ({ ...m, [r.id]: planForQuick("rest", plan, fb) })) },
                      { key: "active", label: c.activeLong, on: isActiveRecovery(plan), onClick: () => setMine((m) => ({ ...m, [r.id]: planForQuick("active", plan, fb) })) },
                    ]}
                  />
                )}
              </div>
              <div className="hidden lg:block">
                <TrainingSelect lang={lang} value="" label={c.changeTraining} onPick={pick} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// --- Den gamle flade: pc foer 23/9, telefon fra 1/10 -------------------------

// Katalog v3 kom foerst 29/10. Den gamle flade viser derfor rytternes traening
// med det katalog, der fandtes dengang (naermeste gamle session).
const PRE_V3: Record<string, string> = {
  long_climbs: "vo2max_climb",
  lead_out: "sprint",
  itt_short: "threshold",
  itt_long: "threshold",
  cobbled_classic: "cobbled_sectors",
};
const preV3 = (s: string) => PRE_V3[s] ?? s;
const toPreV3 = (p: Plan): Plan => (p?.focus ? { ...p, focus: preV3(p.focus) } : p);

function Then({ lang }: { lang: Lang }) {
  const c = COPY2[lang];
  const { plans, save } = usePlans(toPreV3);
  const OLD_ON = "bg-cz-accent text-white";
  const OLD_OFF = "text-cz-2 hover:bg-cz-subtle";
  return (
    <>
      <div className="mb-2 hidden grid-cols-[200px_150px_minmax(0,1fr)_200px] gap-4 font-data text-2xs uppercase tracking-wide text-cz-3 lg:grid">
        <span>{c.rider}</span>
        <span>{c.thenFocus}</span>
        <span>{lang === "da" ? "Skift dag" : "Change day"}</span>
        <span>{c.thenSeason}</span>
      </div>
      <ul className="divide-y divide-cz-border">
        {RIDERS.map((r) => {
          const plan = plans[r.id];
          const fb = preV3(r.suggest.hard);
          const own = ownTraining(plan, fb);
          const eff = effortOf(plan);
          const active = isActiveRecovery(plan);
          const x = EXTRA[r.id];
          const quick = [
            { k: "rest", label: effortName(lang, "rest"), on: eff === "rest" && !active, q: "rest" as Quick },
            { k: "active", label: c.activeLong, on: active, q: "active" as Quick },
            { k: "own", label: sessionName(lang, own), on: eff !== "rest", q: "own" as Quick },
          ];
          const phone = [
            { k: "rest", label: effortName(lang, "rest"), on: eff === "rest" && !active, q: "rest" as Quick },
            { k: "rec", label: c.thenRecovery, on: active, q: "active" as Quick },
            { k: "prog", label: c.thenProgram, on: eff !== "rest", q: "own" as Quick },
          ];
          return (
            <li key={r.id} className="py-3">
              {/* Pc, foer 23/9: fokusknap + tre hurtigknapper + saesonens fremgang */}
              <div className="hidden grid-cols-[200px_150px_minmax(0,1fr)_200px] items-center gap-4 lg:grid">
                <RiderCell r={r} lang={lang} />
                <button type="button" className="truncate rounded-cz border border-cz-border px-2.5 py-1.5 text-start text-xs text-cz-1">
                  {sessionName(lang, own)} ▾
                </button>
                <div className="inline-flex w-fit overflow-hidden rounded-cz border border-cz-border">
                  {quick.map((b) => (
                    <button
                      key={b.k}
                      type="button"
                      aria-pressed={b.on}
                      onClick={() => save(r.id, planForQuick(b.q, plan, fb))}
                      className={`px-2 py-1 text-xs transition-colors ${b.on ? OLD_ON : OLD_OFF}`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
                <div className="flex flex-col gap-0.5">
                  {x.season.map(([ab, pts]) => (
                    <div key={ab} className="flex items-center gap-2 text-2xs text-cz-2">
                      <span className="w-20 truncate">{ab}</span>
                      <span className="h-1.5 flex-1 rounded-cz bg-cz-border">
                        <span className="block h-1.5 rounded-cz bg-cz-accent" style={{ width: `${pts * 25}%` }} />
                      </span>
                      <span className="font-data tabular-nums">+{pts}</span>
                    </div>
                  ))}
                </div>
              </div>
              {/* Telefon, fra 1/10: Hvile / Restitution / Program med et tryk */}
              <div className="lg:hidden">
                <div className="flex items-start justify-between gap-2">
                  <RiderCell r={r} lang={lang} />
                  <span className="pt-0.5 text-xs text-cz-2">
                    {c.tonight}{" "}
                    <span className={`font-data font-semibold tabular-nums ${TONE_TEXT[x.tone]}`}>~{r.fatigue}</span>
                  </span>
                </div>
                <div className="mt-2 grid grid-cols-3 overflow-hidden rounded-cz border border-cz-border">
                  {phone.map((b, i) => (
                    <button
                      key={b.k}
                      type="button"
                      aria-pressed={b.on}
                      onClick={() => save(r.id, planForQuick(b.q, plan, fb))}
                      className={`min-h-10 px-2 text-xs font-medium ${i > 0 ? "border-s border-cz-border" : ""} ${b.on ? SEG_ON : SEG_OFF}`}
                    >
                      {b.label}
                    </button>
                  ))}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

// --- Saadan foeles det --------------------------------------------------------

function Feel({ lang, variant }: { lang: Lang; variant: Exclude<VariantId, "then"> }) {
  const c = COPY2[lang];
  const vals = c.feel[variant];
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
      <h2 className="mb-2 text-[15px] font-semibold text-cz-1">{c.feelTitle}</h2>
      <dl className="divide-y divide-cz-border text-xs">
        {c.feelRows.map((k, i) => (
          <div key={k} className="grid gap-1 py-2 sm:grid-cols-[200px_1fr]">
            <dt className="font-medium text-cz-1">{k}</dt>
            <dd className="tabular-nums text-cz-2">{vals[i]}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// --- Side --------------------------------------------------------------------

export default function Round2({ variant, lang, openId }: Props) {
  const c = COPY2[lang];
  return (
    <>
      <Banner variant={variant} lang={lang} />
      <div className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-6 sm:px-8">
        <div className="mb-5 flex flex-wrap items-center justify-between gap-4">
          <div className="min-w-0">
            <h1 className="font-data text-xl font-bold tracking-tight text-cz-1">{c.pageTitle}</h1>
            <p className="mt-1 text-[13px] text-cz-2">{c.pageSub}</p>
          </div>
          <div className="flex flex-col items-end gap-1">
            <Button variant="secondary" size="sm" disabled>{c.trainNow}</Button>
            <span className="text-3xs text-cz-3">{c.trainNowNote}</span>
          </div>
        </div>
        <div className="flex flex-col gap-3.5">
          <section className="rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
            {variant === "then" && <Then lang={lang} />}
            {variant === "d1" && <D1 lang={lang} />}
            {variant === "d2" && <D2 lang={lang} openId={openId} />}
            {variant === "d3" && <D3 lang={lang} />}
            {variant === "d4" && <D4 lang={lang} />}
          </section>
          {variant !== "then" && <Feel lang={lang} variant={variant} />}
        </div>
      </div>
    </>
  );
}
