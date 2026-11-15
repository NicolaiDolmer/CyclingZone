// #7947 skitse: tre levende varianter af "vaelg en indsats, saa en traening".
// Layout A er valgt af ejeren 10/11: indsats og traening direkte ved rytteren,
// gemt samlet via "Save day". Varianterne svarer paa de aabne punkter paa tre
// forskellige maader. Intet her er produktkode; siden loeber ikke fra appen.

import { useMemo, useState } from "react";
import Segmented from "../../../components/ui/Segmented.jsx";
import Button from "../../../components/ui/Button.jsx";
import { COPY, type Lang } from "./copy.ts";
import { RIDERS, type SketchRider } from "./data.ts";
import {
  EFFORTS,
  RECOVERY_SESSION,
  choiceFromPlan,
  isValidChoice,
  sessionsForEffort,
  transitionRow,
  type Choice,
  type Effort,
  type RecoveryHome,
} from "./effortModel.ts";

export type VariantId = "now" | "a" | "b" | "c";

const VARIANTS: Record<VariantId, { home: RecoveryHome }> = {
  now: { home: "easy" },
  a: { home: "easy" },
  b: { home: "rest" },
  c: { home: "rest" },
};

const SKILL = ["technique", "aero", "loebslaere"];

type Props = { variant: VariantId; lang: Lang; openId: string | null };

// --- Faelles smaating -------------------------------------------------------

function useDrafts(home: RecoveryHome) {
  const initial = useMemo(() => {
    const m: Record<string, Choice> = {};
    for (const r of RIDERS) m[r.id] = choiceFromPlan(r.plan, { recoveryHome: home });
    return m;
  }, [home]);
  const [saved, setSaved] = useState<Record<string, Choice>>(initial);
  const [draft, setDraft] = useState<Record<string, Choice>>(initial);
  const [justSaved, setJustSaved] = useState<string | null>(null);
  const set = (id: string, c: Choice) => setDraft((d) => ({ ...d, [id]: c }));
  const save = (id: string) => {
    setSaved((s) => ({ ...s, [id]: draft[id] }));
    setJustSaved(id);
  };
  const dirty = (id: string) => draft[id].effort !== saved[id].effort || draft[id].session !== saved[id].session;
  return { draft, set, save, dirty, justSaved };
}

function RiderCell({ r, lang }: { r: SketchRider; lang: Lang }) {
  const c = COPY[lang];
  return (
    <div className="min-w-0">
      <div className="truncate text-[13.5px] font-medium text-cz-1">
        {lang === "da" ? "Rytter" : "Rider"} {r.label}
      </div>
      <div className="truncate font-data text-3xs uppercase tracking-wide text-cz-3">
        {c.types[r.type]} · {c.fatigue} <span className="tabular-nums">{r.fatigue}</span> · {c.form}{" "}
        <span className="tabular-nums">{r.form}</span>
      </div>
    </div>
  );
}

function SaveCell({ lang, enabled, saved, onSave }: { lang: Lang; enabled: boolean; saved: boolean; onSave: () => void }) {
  const c = COPY[lang];
  return (
    <div className="flex items-center gap-2">
      <Button variant="secondary" size="sm" disabled={!enabled} onClick={onSave}>
        {c.saveDay}
      </Button>
      {saved && !enabled && (
        <span role="status" className="inline-flex items-center gap-1 text-2xs font-semibold text-cz-success">
          <svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M3 8.5l3.2 3L13 4.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
          {c.saved}
        </span>
      )}
    </div>
  );
}

function optionLabel(lang: Lang, s: string) {
  return COPY[lang].sessions[s] ?? s;
}

// Gruppering i en traeningsvaelger: kun den let indsats har to grupper.
function SessionOptions({ lang, effort, home }: { lang: Lang; effort: Effort; home: RecoveryHome }) {
  const c = COPY[lang];
  const list = sessionsForEffort(effort, { recoveryHome: home });
  if (effort !== "easy") {
    return (
      <>
        {list.map((s) => (
          <option key={s} value={s}>{optionLabel(lang, s)}</option>
        ))}
      </>
    );
  }
  return (
    <>
      <optgroup label={c.groupRide}>
        {list.filter((s) => !SKILL.includes(s)).map((s) => (
          <option key={s} value={s}>{optionLabel(lang, s)}</option>
        ))}
      </optgroup>
      <optgroup label={c.groupSkill}>
        {list.filter((s) => SKILL.includes(s)).map((s) => (
          <option key={s} value={s}>{optionLabel(lang, s)}</option>
        ))}
      </optgroup>
    </>
  );
}

const SELECT_CLS =
  "w-full rounded-cz border border-cz-border bg-cz-card px-2.5 py-1.5 text-xs text-cz-1 hover:border-cz-2/40 disabled:opacity-50 [@media(max-width:640px),(pointer:coarse)]:min-h-11";

// --- Variant A: to felter i samme raekke ------------------------------------

function VariantA({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const home = VARIANTS.a.home;
  const { draft, set, save, dirty, justSaved } = useDrafts(home);
  const opts = EFFORTS.map((e) => ({ value: e, label: c.efforts[e] }));
  return (
    <ul className="divide-y divide-cz-border">
      {RIDERS.map((r) => {
        const d = draft[r.id];
        const valid = isValidChoice(d.effort, d.session, { recoveryHome: home });
        const rest = d.effort === "rest";
        return (
          <li key={r.id} className="grid gap-2 py-3 lg:grid-cols-[210px_300px_240px_1fr] lg:items-center lg:gap-4">
            <RiderCell r={r} lang={lang} />
            <Segmented
              label={`${c.colEffort} ${r.label}`}
              value={d.effort ?? ""}
              options={opts}
              onChange={(e: string) => set(r.id, { effort: e as Effort, session: null })}
              className="w-full lg:w-auto [&>button]:flex-1"
            />
            {rest ? (
              <div className="text-xs text-cz-3">{c.noSession}</div>
            ) : (
              <select
                aria-label={`${c.colTraining} ${r.label}`}
                value={d.session ?? ""}
                onChange={(e) => set(r.id, { effort: d.effort, session: e.target.value })}
                className={`${SELECT_CLS} ${d.session ? "" : "border-dashed font-semibold text-cz-accent-t"}`}
              >
                <option value="" disabled>{d.effort ? c.chooseTraining : c.chooseEffortFirst}</option>
                {d.effort && <SessionOptions lang={lang} effort={d.effort} home={home} />}
              </select>
            )}
            <SaveCell lang={lang} enabled={valid && dirty(r.id)} saved={justSaved === r.id} onSave={() => save(r.id)} />
          </li>
        );
      })}
    </ul>
  );
}

// --- Variant B: indsats x traening som matrix, ét tryk saetter begge ---------

function MatrixCell({ active, onClick, children }: { active: boolean; onClick: () => void; children: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={`w-full rounded-cz border px-2.5 py-1.5 text-start text-xs transition-colors duration-150 [@media(max-width:640px),(pointer:coarse)]:min-h-11 ${
        active
          ? "border-cz-accent/50 bg-cz-accent/10 font-medium text-cz-accent-t"
          : "border-cz-border bg-cz-card text-cz-2 hover:border-cz-2/40 hover:text-cz-1"
      }`}
    >
      {children}
    </button>
  );
}

function Matrix({ lang, d, onPick, home }: { lang: Lang; d: Choice; onPick: (c: Choice) => void; home: RecoveryHome }) {
  const c = COPY[lang];
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
      {EFFORTS.map((e) => {
        const list = sessionsForEffort(e, { recoveryHome: home });
        const colActive = d.effort === e;
        return (
          <div key={e} role="group" aria-label={c.efforts[e]} className="min-w-0">
            <div className={`mb-2 border-b pb-1.5 ${colActive ? "border-cz-accent/50" : "border-cz-border"}`}>
              <div className={`text-[13px] font-semibold ${colActive ? "text-cz-accent-t" : "text-cz-1"}`}>{c.efforts[e]}</div>
              <div className="text-2xs text-cz-3">{c.effortNotes[e]}</div>
            </div>
            <div className="flex flex-col gap-1.5">
              {e === "rest" && (
                <MatrixCell active={d.effort === "rest" && d.session == null} onClick={() => onPick({ effort: "rest", session: null })}>
                  {c.fullRest}
                </MatrixCell>
              )}
              {list.map((s) => (
                <MatrixCell key={s} active={d.effort === e && d.session === s} onClick={() => onPick({ effort: e, session: s })}>
                  {s === RECOVERY_SESSION ? c.activeRecovery : optionLabel(lang, s)}
                </MatrixCell>
              ))}
              {e === "normal" && <div className="text-2xs text-cz-3">{c.mediumNote}</div>}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function summary(lang: Lang, ch: Choice) {
  const c = COPY[lang];
  if (!ch.effort) return "-";
  if (ch.effort === "rest" && ch.session == null) return `${c.efforts.rest} · ${c.fullRest}`;
  return `${c.efforts[ch.effort]} · ${ch.session === RECOVERY_SESSION ? c.activeRecovery : optionLabel(lang, ch.session ?? "")}`;
}

function VariantB({ lang, openId }: { lang: Lang; openId: string | null }) {
  const c = COPY[lang];
  const home = VARIANTS.b.home;
  const { draft, set, save, dirty, justSaved } = useDrafts(home);
  const [open, setOpen] = useState<string | null>(openId);
  return (
    <ul className="divide-y divide-cz-border">
      {RIDERS.map((r) => {
        const d = draft[r.id];
        const isOpen = open === r.id;
        const valid = isValidChoice(d.effort, d.session, { recoveryHome: home });
        return (
          <li key={r.id} className="py-3">
            <div className="grid grid-cols-[1fr_auto] items-center gap-3 lg:grid-cols-[210px_1fr_auto_auto] lg:gap-4">
              <RiderCell r={r} lang={lang} />
              <div className="col-span-2 order-3 text-xs text-cz-1 lg:order-none lg:col-span-1">
                <span className="font-medium">{summary(lang, d)}</span>
              </div>
              <div className="flex items-center gap-2">
                {justSaved === r.id && !dirty(r.id) && (
                  <span role="status" className="text-2xs font-semibold text-cz-success">{c.saved}</span>
                )}
              </div>
              <Button variant="secondary" size="sm" aria-expanded={isOpen} onClick={() => setOpen(isOpen ? null : r.id)}>
                {isOpen ? c.cancel : c.change}
              </Button>
            </div>
            {isOpen && (
              <div className="mt-3 rounded-cz border border-cz-border bg-cz-subtle p-4">
                <Matrix lang={lang} d={d} home={home} onPick={(ch) => set(r.id, ch)} />
                <div className="mt-4 flex items-center gap-3 border-t border-cz-border pt-3">
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={!valid || !dirty(r.id)}
                    onClick={() => { save(r.id); setOpen(null); }}
                  >
                    {c.saveDay}
                  </Button>
                  <span className="text-2xs text-cz-3">{summary(lang, d)}</span>
                </div>
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}

// --- Variant C: indsats foerst, traening foelger assistentens valg -----------

function VariantC({ lang, openId }: { lang: Lang; openId: string | null }) {
  const c = COPY[lang];
  const home = VARIANTS.c.home;
  const { draft, set, save, dirty, justSaved } = useDrafts(home);
  const [custom, setCustom] = useState<Record<string, boolean>>(openId ? { [openId]: true } : {});
  const opts = EFFORTS.map((e) => ({ value: e, label: c.efforts[e] }));
  return (
    <ul className="divide-y divide-cz-border">
      {RIDERS.map((r) => {
        const d = draft[r.id];
        const valid = isValidChoice(d.effort, d.session, { recoveryHome: home });
        const picking = custom[r.id] === true;
        const pickFor = (e: Effort): Choice => (e === "rest" ? { effort: e, session: null } : { effort: e, session: r.suggest[e] });
        const isAssistant = d.effort && d.effort !== "rest" && d.session === r.suggest[d.effort];
        return (
          <li key={r.id} className="grid gap-2 py-3 lg:grid-cols-[210px_300px_240px_1fr] lg:items-center lg:gap-4">
            <RiderCell r={r} lang={lang} />
            <Segmented
              label={`${c.colEffort} ${r.label}`}
              value={d.effort ?? ""}
              options={opts}
              onChange={(e: string) => { set(r.id, pickFor(e as Effort)); setCustom((m) => ({ ...m, [r.id]: false })); }}
              className="w-full lg:w-auto [&>button]:flex-1"
            />
            <div className="min-w-0 text-xs">
              {d.effort === "rest" ? (
                <Segmented
                  label={c.colDay}
                  value={d.session === RECOVERY_SESSION ? "active" : "full"}
                  options={[{ value: "full", label: c.fullRest }, { value: "active", label: c.activeRecovery }]}
                  onChange={(v: string) => set(r.id, { effort: "rest", session: v === "active" ? RECOVERY_SESSION : null })}
                />
              ) : picking && d.effort ? (
                <select
                  aria-label={`${c.colTraining} ${r.label}`}
                  value={d.session ?? ""}
                  onChange={(e) => set(r.id, { effort: d.effort, session: e.target.value })}
                  className={SELECT_CLS}
                >
                  <SessionOptions lang={lang} effort={d.effort} home={home} />
                </select>
              ) : d.effort ? (
                <div className="flex items-baseline gap-2">
                  <span className="truncate font-medium text-cz-1">{optionLabel(lang, d.session ?? "")}</span>
                  {isAssistant && <span className="font-data text-3xs uppercase tracking-wide text-cz-3">{c.assistantPick}</span>}
                  <button
                    type="button"
                    onClick={() => setCustom((m) => ({ ...m, [r.id]: true }))}
                    className="ms-auto text-2xs font-medium text-cz-accent-t hover:underline [@media(max-width:640px),(pointer:coarse)]:min-h-11"
                  >
                    {c.change}
                  </button>
                </div>
              ) : null}
            </div>
            <SaveCell lang={lang} enabled={valid && dirty(r.id)} saved={justSaved === r.id} onSave={() => save(r.id)} />
          </li>
        );
      })}
    </ul>
  );
}

// --- Foer: dagens ene vaelger (samme opbygning som TrainingDaySelect) ---------

function VariantNow({ lang }: { lang: Lang }) {
  const c = COPY[lang];
  const [vals, setVals] = useState<Record<string, string>>(() => {
    const m: Record<string, string> = {};
    for (const r of RIDERS) {
      const ch = choiceFromPlan(r.plan, { recoveryHome: "easy" });
      m[r.id] = ch.effort === "rest" ? "rest" : ch.session === RECOVERY_SESSION ? "recovery" : (ch.session ?? "");
    }
    return m;
  });
  const levels: Effort[] = ["easy", "normal", "hard"];
  return (
    <ul className="divide-y divide-cz-border">
      {RIDERS.map((r) => (
        <li key={r.id} className="grid gap-2 py-3 lg:grid-cols-[210px_240px_1fr] lg:items-center lg:gap-4">
          <RiderCell r={r} lang={lang} />
          <select
            aria-label={`${c.colDay} ${r.label}`}
            value={vals[r.id]}
            onChange={(e) => setVals((v) => ({ ...v, [r.id]: e.target.value }))}
            className={SELECT_CLS}
          >
            <optgroup label={lang === "da" ? "Hele dagen" : "Whole day"}>
              <option value="rest">{c.efforts.rest}</option>
              <option value="recovery">{c.activeRecovery}</option>
            </optgroup>
            {levels.map((lv) => (
              <optgroup key={lv} label={`${lang === "da" ? "Træning" : "Training"} · ${c.efforts[lv]}`}>
                {sessionsForEffort(lv, { recoveryHome: "rest" }).filter((s) => !SKILL.includes(s)).map((s) => (
                  <option key={s} value={s}>{optionLabel(lang, s)}</option>
                ))}
              </optgroup>
            ))}
            <optgroup label={c.groupSkill}>
              {SKILL.map((s) => (
                <option key={s} value={s}>{optionLabel(lang, s)}</option>
              ))}
            </optgroup>
          </select>
        </li>
      ))}
    </ul>
  );
}

// --- Overgang og aabne punkter ----------------------------------------------

const STANCE: Record<Lang, Record<Exclude<VariantId, "now">, { rec: string; tac: string; cool: string; merge: string }>> = {
  en: {
    a: {
      rec: "A session under Easy, next to Long ride.",
      tac: "Not in the training row. Race tactics stay on the race page.",
      cool: "Not a choice. Shown as a note under a Hard day.",
      merge: "Nothing merged. Medium has one training and Hard has thirteen.",
    },
    b: {
      rec: "Under Rest, as a second option next to Full rest, so Rest never means growth-free only.",
      tac: "Not in the training row. Race tactics stay on the race page.",
      cool: "Not a choice. Shown as a note under a Hard day.",
      merge: "The matrix makes the lopsided counts visible: one under Medium, thirteen under Hard.",
    },
    c: {
      rec: "Under Rest, as a small switch next to Full rest.",
      tac: "Not in the training row. Race tactics stay on the race page.",
      cool: "Not a choice. The assistant would take the day after a Hard day into account.",
      merge: "Fewer visible choices by default, so merging matters less.",
    },
  },
  da: {
    a: {
      rec: "En træning under Let, ved siden af Lang tur.",
      tac: "Ikke i træningsrækken. Løbstaktik bliver på løbssiden.",
      cool: "Ikke et valg. Vises som en note under en hård dag.",
      merge: "Intet slås sammen. Mellem har én træning og Hård har tretten.",
    },
    b: {
      rec: "Under Hvile, som valg nummer to ved siden af Fuld hvile, så Hvile ikke kun betyder uden udvikling.",
      tac: "Ikke i træningsrækken. Løbstaktik bliver på løbssiden.",
      cool: "Ikke et valg. Vises som en note under en hård dag.",
      merge: "Matrixen gør den skæve fordeling synlig: én under Mellem, tretten under Hård.",
    },
    c: {
      rec: "Under Hvile, som en lille kontakt ved siden af Fuld hvile.",
      tac: "Ikke i træningsrækken. Løbstaktik bliver på løbssiden.",
      cool: "Ikke et valg. Assistenten ville tage højde for dagen efter en hård dag.",
      merge: "Færre synlige valg som standard, så sammenlægning betyder mindre.",
    },
  },
};

function legacyName(lang: Lang, focus: string | null | undefined, intensity: string | null | undefined) {
  const c = COPY[lang];
  if (intensity === "rest") return c.efforts.rest;
  if (intensity === "recovery") return c.activeRecovery;
  return optionLabel(lang, focus ?? "");
}

function Transition({ lang, variant }: { lang: Lang; variant: VariantId }) {
  const c = COPY[lang];
  const home = VARIANTS[variant].home;
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
      <header className="mb-1 flex items-baseline justify-between">
        <h2 className="text-[15px] font-semibold text-cz-1">{c.transitionTitle}</h2>
        <span className="font-data text-2xs uppercase tracking-wide text-cz-3">{c.transitionKept}</span>
      </header>
      <p className="mb-3 text-xs text-cz-2">{c.transitionSub}</p>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-xs">
          <thead>
            <tr className="border-b border-cz-border text-2xs uppercase tracking-wide text-cz-3">
              {c.transitionCols.map((h) => (
                <th key={h} className="py-2 pe-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {RIDERS.map((r) => {
              const t = transitionRow(r.plan, { recoveryHome: home });
              return (
                <tr key={r.id} className="border-b border-cz-border last:border-0">
                  <td className="py-2 pe-3 text-cz-1">{lang === "da" ? "Rytter" : "Rider"} {r.label}</td>
                  <td className="py-2 pe-3 text-cz-2">{legacyName(lang, r.plan?.focus, r.plan?.intensity)}</td>
                  <td className="py-2 pe-3 text-cz-1">
                    {summary(lang, { effort: t.effort, session: t.session })}
                    {t.focusIgnored && <span className="block text-3xs text-cz-3">{c.transitionRestFocus}</span>}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function Decisions({ lang, variant }: { lang: Lang; variant: VariantId }) {
  const c = COPY[lang];
  const s = STANCE[lang][variant as Exclude<VariantId, "now">];
  const rows: [string, string][] = [
    [c.recoveryQ, s.rec],
    [c.tacticsQ, s.tac],
    [c.cooldownQ, s.cool],
    [c.mergeQ, s.merge],
  ];
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
      <h2 className="mb-1 text-[15px] font-semibold text-cz-1">{c.decisionsTitle}</h2>
      <p className="mb-3 text-xs text-cz-2">{c.decisionsSub}</p>
      <dl className="divide-y divide-cz-border text-xs">
        {rows.map(([k, v]) => (
          <div key={k} className="grid gap-1 py-2 sm:grid-cols-[180px_1fr]">
            <dt className="font-medium text-cz-1">{k}</dt>
            <dd className="text-cz-2">{v}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

// --- Side -------------------------------------------------------------------

export default function Sketch({ variant, lang, openId }: Props) {
  const c = COPY[lang];
  return (
    <div className="mx-auto w-full max-w-[1600px] px-4 pb-16 pt-7 sm:px-8">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-4">
        <div className="min-w-0">
          <h1 className="font-data text-xl font-bold tracking-tight text-cz-1">{c.pageTitle}</h1>
          <p className="mt-1 text-[13px] text-cz-2">{c.pageSub}</p>
        </div>
        <div className="flex flex-col items-end gap-1">
          <Button variant="primary" size="sm" disabled>{c.trainToday}</Button>
          <span className="text-3xs text-cz-3">{c.trainTodayNote}</span>
        </div>
      </div>
      <div className="flex flex-col gap-3.5">
        <section className="rounded-cz border border-cz-border bg-cz-card p-4 sm:p-5">
          {(variant === "a" || variant === "c") && (
            <div className="mb-2 hidden grid-cols-[210px_300px_240px_1fr] gap-4 font-data text-2xs uppercase tracking-wide text-cz-3 lg:grid">
              <span>{c.colRider}</span>
              <span>{c.colEffort}</span>
              <span>{c.colTraining}</span>
              <span>{c.colDay}</span>
            </div>
          )}
          {variant === "now" && <VariantNow lang={lang} />}
          {variant === "a" && <VariantA lang={lang} />}
          {variant === "b" && <VariantB lang={lang} openId={openId} />}
          {variant === "c" && <VariantC lang={lang} openId={openId} />}
        </section>
        {variant !== "now" && <Transition lang={lang} variant={variant} />}
        {variant !== "now" && <Decisions lang={lang} variant={variant} />}
      </div>
    </div>
  );
}
