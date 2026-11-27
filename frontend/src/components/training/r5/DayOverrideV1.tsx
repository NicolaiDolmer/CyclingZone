// #8592 · "Kun denne dag" i dagsvælgeren (ejerbeslutning 26/11, seks punkter). Et pas for én
// rytter, flere eller en hel gruppe, kun på én dato i den rullende uge. Ugeplanen ændres aldrig,
// og et løb vinder altid. Kontakten training_day_override_8592 afgøres på serveren: svarer GET
// enabled:false, tegnes intet herfra, og dagsvælgeren er præcis som før.
// #8819: virker også uden program; træthedsgrænsens markering for i morgen vises, og et valg
// truffet efter den går forud (serveren afgør det); hvad der skete med valget vises i dag og
// efter datoen.
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import ModalBase from "../../ui/Modal.jsx";
import ButtonBase from "../../ui/Button.jsx";
import { CalendarIcon, UndoIcon } from "../../ui/icons/index.jsx";
import { authHeaders } from "../../../lib/supabase";
import { apiFetch } from "../../../lib/apiFetch.ts";
import { SKILL_SESSIONS, sessionsByLevelFor } from "../../../lib/trainingDayTypes.js";
import { isDisplayCatalogV3 } from "../../../lib/training.js";
import {
  outcomeLineKey, overrideSessionGroups, recentByDate, selectedRiderIds, todayOverrides,
  type DayOverride, type RecentOverride, type RuleMark, type TodayOverride,
} from "./dayOverrideModel.ts";

const API = "/api/training/programs/day-overrides";
const HEAD = "font-data text-2xs font-semibold uppercase tracking-[.06em] text-cz-3";

// Primitiverne i components/ui er .jsx uden typer (samme greb som RacePeekCard.tsx).
const Modal = ModalBase as unknown as ComponentType<{
  open: boolean; onClose: () => void; title?: ReactNode; description?: ReactNode; footer?: ReactNode;
  closeLabel?: string; titleId?: string; children?: ReactNode;
}>;
const Button = ButtonBase as unknown as ComponentType<{
  variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md"; loading?: boolean; disabled?: boolean;
  iconLeft?: ReactNode; onClick?: () => void; children?: ReactNode; "data-testid"?: string;
}>;

type Rider = { id: string; firstname?: string | null; lastname?: string | null };
type Group = { id: string; name: string; members: ReadonlyArray<{ riderId: string }> };
export type DayOverrideStatus = { enabled: boolean; recent: RecentOverride[] };

const riderName = (r: Rider | undefined) => `${r?.firstname ?? ""} ${r?.lastname ?? ""}`.trim();

/** Kontakten og de seneste valgs udfald (DO-12). null = ikke svaret endnu eller slukket. */
export function useDayOverrideStatus(): DayOverrideStatus | null {
  const [status, setStatus] = useState<DayOverrideStatus | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await apiFetch(API, { headers }, { source: "training-day-override" });
      const data = res.data as { enabled?: boolean; recent?: RecentOverride[] } | null;
      if (alive && res.ok && data?.enabled === true) setStatus({ enabled: true, recent: Array.isArray(data.recent) ? data.recent : [] });
    })();
    return () => { alive = false; };
  }, []);
  return status;
}

async function send(method: "PUT" | "DELETE", body: Record<string, unknown>): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers) return false;
  const res = await apiFetch(API, { method, headers, body: JSON.stringify(body) }, { source: "training-day-override" });
  return res.ok;
}

/** DO-10: grænsens markering for i morgen, som serveren også afgør valget efter. */
function RuleMarkLine({ mark, beatsRule = false, chosen }: { mark?: RuleMark; beatsRule?: boolean; chosen: boolean }) {
  const { t } = useTranslation("trainingR5");
  if (beatsRule || !mark) return <span className="block text-cz-2" data-testid="r5-day-override-beats">{t("dayOverride.beatsRule")}</span>;
  const line = mark.kind === "after_stage"
    ? t("dayOverride.ruleAfterStage")
    : t("dayOverride.ruleAhead", { fallback: t(`dayOverride.fallback_${mark.fallback}`) });
  return (
    <span className="block text-cz-2" data-testid="r5-day-override-rule">
      {line} {t(chosen ? "dayOverride.ruleChooseAgain" : "dayOverride.ruleChoose")}
    </span>
  );
}

/** En rytter uden valg på datoen, men med grænsens markering (i morgen). */
export function DayOverrideRuleNote({ mark }: { mark: RuleMark }) {
  return (
    <span className="mt-0.5 block text-xs" data-testid="r5-day-override-rule-note">
      <RuleMarkLine mark={mark} chosen={false} />
    </span>
  );
}

/** Rækkens linje: "Kun tirsdag 24 · Tilbage til planen", og hvad et løb eller grænsen tog (ejer punkt 2 og 4). */
export function DayOverrideRowNote({
  riderId, date, dayLabel, weekdayWord, replaced, beatsRule = false, ruleMark = null, onChanged,
}: {
  riderId: string; date: string; dayLabel: string; weekdayWord: string;
  replaced: "all" | "some" | "rest" | null; beatsRule?: boolean; ruleMark?: RuleMark | null; onChanged?: () => void;
}) {
  const { t } = useTranslation("trainingR5");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const back = async () => {
    setBusy(true);
    setFailed(false);
    const ok = await send("DELETE", { riderIds: [riderId], date });
    setBusy(false);
    if (ok) onChanged?.(); else setFailed(true);
  };
  return (
    <span className="mt-0.5 block text-xs text-cz-2" data-testid="r5-day-override-note">
      <span className="font-medium text-cz-accent-t">{t("dayOverride.only", { day: dayLabel })}</span>
      <span className="px-1 text-cz-3" aria-hidden="true">·</span>
      <button type="button" onClick={back} disabled={busy} data-testid="r5-day-override-back"
        className="inline-flex min-h-11 items-center gap-0.5 font-medium text-cz-accent-t hover:underline disabled:opacity-50 md:min-h-0">
        <UndoIcon size={11} aria-hidden="true" />{t("dayOverride.back")}
      </button>
      {replaced === "all" && <span className="block text-cz-2" data-testid="r5-day-override-replaced">{t("dayOverride.replaced", { weekday: weekdayWord })}</span>}
      {replaced === "rest" && <span className="block text-cz-2" data-testid="r5-day-override-replaced">{t("dayOverride.replacedRest", { weekday: weekdayWord })}</span>}
      {replaced === "some" && <span className="block text-cz-2" data-testid="r5-day-override-replaced">{t("dayOverride.replacedSome")}</span>}
      {replaced !== "all" && replaced !== "rest" && beatsRule && <RuleMarkLine beatsRule chosen />}
      {replaced !== "all" && replaced !== "rest" && !beatsRule && ruleMark && <RuleMarkLine mark={ruleMark} chosen />}
      {failed && <span className="block text-cz-danger" role="alert">{t("dayOverride.error")}</span>}
    </span>
  );
}

/**
 * I dag (dag 0, #8819 fund 1): dagens valg og hvad der sker med dem, og hvordan de seneste dages
 * valg gik. Tegnes kun med kontakten og kun, når der er noget at sige.
 */
export function DayOverrideTodayNotes({
  todayRiders, recent, riders, sessionLabel, dateLabel,
}: {
  todayRiders: Record<string, { dateOverride?: TodayOverride | null } | undefined> | null | undefined;
  recent: RecentOverride[];
  riders: Rider[];
  sessionLabel: (session: string) => string;
  dateLabel: (ymd: string) => string;
}) {
  const { t } = useTranslation("trainingR5");
  const byId = useMemo(() => new Map(riders.map((r) => [r.id, r])), [riders]);
  const today = todayOverrides(todayRiders, riders);
  const past = recentByDate(recent, riders).map(({ date, entries }) => ({
    date,
    told: entries.filter((e) => outcomeLineKey(e) != null),
    trained: entries.filter((e) => outcomeLineKey(e) == null).length,
  })).filter((d) => d.told.length > 0 || d.trained > 0);
  if (today.length === 0 && past.length === 0) return null;
  const row = (key: string, name: string, session: string, line: string) => (
    <li key={key} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-t border-cz-border px-3 py-2 text-xs first:border-t-0" data-testid="r5-day-override-outcome">
      <span className="text-[13px] font-medium text-cz-1">{name}</span>
      <span className="text-cz-3">{sessionLabel(session)}</span>
      <span className="basis-full text-cz-2 md:basis-auto">{line}</span>
    </li>
  );
  return (
    <section className="rounded-cz border border-cz-border bg-cz-card" data-testid="r5-day-override-today">
      <h3 className={`border-b border-cz-border bg-cz-subtle px-3 py-2 ${HEAD}`}>{t("dayOverride.notesTitle")}</h3>
      {today.length > 0 && (
        <div>
          <p className="px-3 pt-2 text-xs font-semibold text-cz-2">{t("dayOverride.todayHeading")}</p>
          <ul>
            {today.map((o) => {
              const key = outcomeLineKey(o);
              return row(`today-${o.riderId}`, riderName(byId.get(o.riderId)), o.session, key ? t(key) : t("dayOverride.outcome.trainedToday"));
            })}
          </ul>
        </div>
      )}
      {past.map(({ date, told, trained }) => (
        <div key={date} className="border-t border-cz-border">
          <p className="px-3 pt-2 text-xs font-semibold text-cz-2">{t("dayOverride.pastHeading", { day: dateLabel(date) })}</p>
          <ul>
            {told.map((e) => row(`${date}-${e.riderId}`, riderName(byId.get(e.riderId)), e.session, t(outcomeLineKey(e) as string)))}
          </ul>
          {trained > 0 && (
            <p className="px-3 pb-2 pt-1 text-xs text-cz-2" data-testid="r5-day-override-trained-count">
              {told.length > 0 ? t("dayOverride.trainedOthers", { n: trained }) : t("dayOverride.trainedAll", { n: trained })}
            </p>
          )}
        </div>
      ))}
    </section>
  );
}

/** Knappen over rækkerne og dialogen: hvem (ryttere, flere eller grupper) og hvilket pas. */
export function DayOverrideAction({
  date, dayLabel, riders, groups, overrides, ruleMarks, sessionLabel, onChanged,
}: {
  date: string; dayLabel: string; riders: Rider[]; groups: Group[];
  overrides: Record<string, DayOverride>; ruleMarks: Record<string, RuleMark>; sessionLabel: (session: string) => string; onChanged?: () => void;
}) {
  const { t } = useTranslation("trainingR5");
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} iconLeft={<CalendarIcon size={14} aria-hidden="true" />}
        data-testid="r5-day-override-open">
        {t("dayOverride.action", { day: dayLabel })}
      </Button>
      {open && (
        <DayOverrideDialog date={date} dayLabel={dayLabel} riders={riders} groups={groups} overrides={overrides} ruleMarks={ruleMarks}
          sessionLabel={sessionLabel} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChanged?.(); }} />
      )}
    </>
  );
}

function DayOverrideDialog({
  date, dayLabel, riders, groups, overrides, ruleMarks, sessionLabel, onClose, onSaved,
}: {
  date: string; dayLabel: string; riders: Rider[]; groups: Group[]; overrides: Record<string, DayOverride>;
  ruleMarks: Record<string, RuleMark>; sessionLabel: (session: string) => string; onClose: () => void; onSaved: () => void;
}) {
  const { t } = useTranslation("trainingR5");
  const [picked, setPicked] = useState<Set<string>>(() => new Set());
  const [pickedGroups, setPickedGroups] = useState<Set<string>>(() => new Set());
  const [session, setSession] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  const sessionGroups = useMemo(() => overrideSessionGroups({
    skill: SKILL_SESSIONS, byLevel: sessionsByLevelFor({ catalogV3: isDisplayCatalogV3() }) as Record<string, readonly string[]>,
  }), []);
  const ids = useMemo(() => selectedRiderIds({ riderIds: picked, groupIds: pickedGroups, groups, roster: riders }),
    [picked, pickedGroups, groups, riders]);
  const markedPicked = ids.filter((id) => ruleMarks[id]).length;
  const toggle = useCallback((set: Set<string>, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  }, []);
  const save = async () => {
    if (!session || ids.length === 0) return;
    setSaving(true);
    setFailed(false);
    const ok = await send("PUT", { riderIds: ids, date, session });
    setSaving(false);
    if (ok) onSaved(); else setFailed(true);
  };
  const footer = (
    <>
      <Button variant="secondary" onClick={onClose}>{t("dayOverride.cancel")}</Button>
      <Button onClick={save} loading={saving} disabled={!session || ids.length === 0} data-testid="r5-day-override-save">
        {t("dayOverride.save", { day: dayLabel })}
      </Button>
    </>
  );
  return (
    <Modal open onClose={onClose} title={t("dayOverride.title", { day: dayLabel })} description={t("dayOverride.description")}
      footer={footer} closeLabel={t("dayOverride.cancel")} titleId="r5-day-override-title">
      <div className="space-y-5" data-testid="r5-day-override-dialog">
        {groups.length > 0 && (
          <fieldset>
            <legend className="mb-2 text-xs font-semibold text-cz-2">{t("dayOverride.groups")}</legend>
            <div className="flex flex-wrap gap-2">
              {groups.map((g) => {
                const on = pickedGroups.has(g.id);
                return (
                  <button key={g.id} type="button" aria-pressed={on} onClick={() => setPickedGroups((s) => toggle(s, g.id))}
                    className={`min-h-11 rounded-cz border px-3 text-xs ${on ? "border-cz-1 bg-cz-subtle font-semibold text-cz-1" : "border-cz-border text-cz-2 hover:border-cz-3"}`}>
                    {g.name} <span className="font-data tabular-nums text-cz-3">{g.members.length}</span>
                  </button>
                );
              })}
            </div>
          </fieldset>
        )}
        <fieldset>
          <legend className="mb-2 flex w-full items-center justify-between text-xs font-semibold text-cz-2">
            <span>{t("dayOverride.riders")} <span className="font-data font-normal tabular-nums text-cz-3">{t("dayOverride.selected", { n: ids.length })}</span></span>
            <span className="flex gap-3 font-medium">
              <button type="button" className="text-cz-accent-t hover:underline" onClick={() => setPicked(new Set(riders.map((r) => r.id)))}>{t("dayOverride.selectAll")}</button>
              <button type="button" className="text-cz-accent-t hover:underline" onClick={() => { setPicked(new Set()); setPickedGroups(new Set()); }}>{t("dayOverride.clear")}</button>
            </span>
          </legend>
          <div className="max-h-56 overflow-y-auto rounded-cz border border-cz-border">
            {riders.map((r) => {
              const on = ids.includes(r.id);
              const current = overrides[r.id];
              return (
                <label key={r.id} className="flex min-h-11 cursor-pointer items-center gap-2 border-t border-cz-border px-3 first:border-t-0">
                  <input type="checkbox" className="h-4 w-4 rounded-[3px] accent-cz-accent" checked={on}
                    onChange={() => setPicked((s) => toggle(s, r.id))} data-testid="r5-day-override-rider" />
                  <span className="min-w-0 flex-1 truncate text-[13px] text-cz-1">{riderName(r)}</span>
                  {ruleMarks[r.id] && <span className="shrink-0 text-xs text-cz-2" data-testid="r5-day-override-rider-rule">{t("dayOverride.ruleBadge")}</span>}
                  {current && <span className="shrink-0 text-xs text-cz-3">{sessionLabel(current.session)}</span>}
                </label>
              );
            })}
          </div>
        </fieldset>
        <fieldset>
          <legend className="mb-2 text-xs font-semibold text-cz-2">{t("dayOverride.session")}</legend>
          <div className="space-y-2">
            {sessionGroups.map((group) => (
              <div key={group.key} className="flex flex-wrap gap-2">
                {group.sessions.map((s) => (
                  <button key={s} type="button" aria-pressed={session === s} onClick={() => setSession(s)} data-testid="r5-day-override-session"
                    className={`min-h-11 rounded-cz border px-3 text-xs ${session === s ? "border-cz-1 bg-cz-subtle font-semibold text-cz-1" : "border-cz-border text-cz-2 hover:border-cz-3"}`}>
                    {sessionLabel(s)}
                  </button>
                ))}
              </div>
            ))}
          </div>
        </fieldset>
        <p className="text-xs text-cz-2">{t("dayOverride.raceWins")}</p>
        {markedPicked > 0 ? (
          <p className="text-xs text-cz-2" data-testid="r5-day-override-beats-note">{t("dayOverride.beatsRuleNote", { n: markedPicked })}</p>
        ) : (
          <p className="text-xs text-cz-2">{t("dayOverride.ruleWins")}</p>
        )}
        {failed && <p className="text-xs text-cz-danger" role="alert">{t("dayOverride.error")}</p>}
      </div>
    </Modal>
  );
}
