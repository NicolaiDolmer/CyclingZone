// #8592 · "Kun denne dag" i dagsvælgeren (ejerbeslutning 26/11, seks punkter). Et pas for én
// rytter, flere eller en hel gruppe, kun på én dato i den rullende uge. Ugeplanen ændres aldrig,
// og et løb vinder altid. Kontakten training_day_override_8592 afgøres på serveren: svarer GET
// enabled:false, tegnes intet herfra, og dagsvælgeren er præcis som før.
import { useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../../ui/Modal.jsx";
import Button from "../../ui/Button.jsx";
import { CalendarIcon, UndoIcon } from "../../ui/icons/index.jsx";
import { authHeaders } from "../../../lib/supabase";
import { apiFetch } from "../../../lib/apiFetch.ts";
import { SKILL_SESSIONS, sessionsByLevelFor } from "../../../lib/trainingDayTypes.js";
import { isDisplayCatalogV3 } from "../../../lib/training.js";
import { overrideSessionGroups, selectedRiderIds, type DayOverride } from "./dayOverrideModel.ts";

const API = "/api/training/programs/day-overrides";

type Rider = { id: string; firstname?: string | null; lastname?: string | null };
type Group = { id: string; name: string; members: ReadonlyArray<{ riderId: string }> };
export type DayOverrideStatus = { enabled: boolean; programRequired: boolean };

const riderName = (r: Rider) => `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim();

/** Kontakten og om holdet har et program (DO-11). null = ikke svaret endnu eller slukket. */
export function useDayOverrideStatus(): DayOverrideStatus | null {
  const [status, setStatus] = useState<DayOverrideStatus | null>(null);
  useEffect(() => {
    let alive = true;
    (async () => {
      const headers = await authHeaders();
      if (!headers) return;
      const res = await apiFetch(API, { headers }, { source: "training-day-override" });
      const data = res.data as { enabled?: boolean; programRequired?: boolean } | null;
      if (alive && res.ok && data?.enabled === true) setStatus({ enabled: true, programRequired: data.programRequired === true });
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

/** Rækkens linje: "Kun tirsdag 24 · Tilbage til planen", og hvad et løb tog (ejer punkt 2 og 4). */
export function DayOverrideRowNote({
  riderId, date, dayLabel, weekdayWord, replaced, onChanged,
}: {
  riderId: string; date: string; dayLabel: string; weekdayWord: string;
  replaced: "all" | "some" | null; onChanged?: () => void;
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
      {replaced === "some" && <span className="block text-cz-2" data-testid="r5-day-override-replaced">{t("dayOverride.replacedSome")}</span>}
      {failed && <span className="block text-cz-danger" role="alert">{t("dayOverride.error")}</span>}
    </span>
  );
}

/** Knappen over rækkerne og dialogen: hvem (ryttere, flere eller grupper) og hvilket pas. */
export function DayOverrideAction({
  status, date, dayLabel, riders, groups, overrides, sessionLabel, onChanged,
}: {
  status: DayOverrideStatus; date: string; dayLabel: string; riders: Rider[]; groups: Group[];
  overrides: Record<string, DayOverride>; sessionLabel: (session: string) => string; onChanged?: () => void;
}) {
  const { t } = useTranslation("trainingR5");
  const [open, setOpen] = useState(false);
  if (status.programRequired) {
    return <p className="text-xs text-cz-2" data-testid="r5-day-override-program">{t("dayOverride.programRequired")}</p>;
  }
  return (
    <>
      <Button variant="secondary" size="sm" onClick={() => setOpen(true)} iconLeft={<CalendarIcon size={14} aria-hidden="true" />}
        data-testid="r5-day-override-open">
        {t("dayOverride.action", { day: dayLabel })}
      </Button>
      {open && (
        <DayOverrideDialog date={date} dayLabel={dayLabel} riders={riders} groups={groups} overrides={overrides}
          sessionLabel={sessionLabel} onClose={() => setOpen(false)} onSaved={() => { setOpen(false); onChanged?.(); }} />
      )}
    </>
  );
}

function DayOverrideDialog({
  date, dayLabel, riders, groups, overrides, sessionLabel, onClose, onSaved,
}: {
  date: string; dayLabel: string; riders: Rider[]; groups: Group[]; overrides: Record<string, DayOverride>;
  sessionLabel: (session: string) => string; onClose: () => void; onSaved: () => void;
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
        {failed && <p className="text-xs text-cz-danger" role="alert">{t("dayOverride.error")}</p>}
      </div>
    </Modal>
  );
}
