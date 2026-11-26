// GroupsTabV2 — Traeningssidens egen Grupper-fane (#7947 W1 v2, #8686), bag kontakten
// training_w1_v2. Ejerens design 26/11: rytterlisten flyttes vaek fra Program og faar sin
// egen fane med grupper, ryttere, flyt rytter og ny gruppe. Intet forsvinder (#8631):
// alt, Program R5's bibliotek kunne med grupper, kan fanen her:
//   - ny gruppe (navn, ryttere, gruppens traethedsgraense);
//   - medlemmer, omdoeb, graense og slet pr. gruppe;
//   - flyt en rytter til en anden gruppe, tilfoej en rytter uden gruppe;
//   - foelg gruppen igen (en rytter eller alle med egen plan);
//   - aabn en gruppes eller rytters uge i Program.
// Kun de eksisterende API'er (useTrainingGroups) og de samme dialoger som R5.
import { useMemo, useRef, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import { useTranslation } from "react-i18next";
import Button from "../../ui/Button.jsx";
import EmptyState from "../../ui/EmptyState.jsx";
import Modal from "../../ui/Modal.jsx";
import Segmented from "../../ui/Segmented.jsx";
import { Menu, MenuItem } from "../../ui/Menu.jsx";
import { useDismiss } from "../../ui/useDismiss.js";
import { MoreIcon, PlusIcon, TeamIcon } from "../../ui/icons/index.jsx";
import { FATIGUE_FALLBACKS } from "../FatigueRuleModel.ts";
import TrainingGroupDialog from "../groups/TrainingGroupDialog.tsx";
import type { TrainingGroup } from "../groups/trainingGroupsModel.ts";
import type { TrainingGroupsClient } from "../groups/useTrainingGroups.ts";
import type { FatigueRulesClient } from "../useFatigueRules.ts";
import { programName, type CatalogProgram, type ProgramWeekDays } from "../../../lib/trainingPrograms.ts";
import {
  buildLibrary, createdGroupId, dropDrafts, followAgainTarget, groupAfterPatch, groupLimitDraft, groupLimitValid,
  groupLimitWrite, groupMenuActions, groupMovePatch, groupPatch, subjectKey, GROUP_LIMIT_MODES,
  type GroupLimitDraft, type GroupMenuAction, type R5Group, type R5Rider, type Subject,
} from "./programR5Model.ts";
import { MoveRiderDialog } from "./ProgramR5.tsx";

type RawRider = { id: string; firstname?: string | null; lastname?: string | null; primary_type?: string | null };
type ProgramsLike = {
  catalog: CatalogProgram[];
  assigned: Record<string, string>;
  rotationEnabled?: boolean;
  weekPriorityEnabled?: boolean;
  reload?: () => Promise<unknown> | void;
};
type DraftSetter = Dispatch<SetStateAction<Record<string, unknown>>>;

// #8560: "Egen" starter som graense-kortets gruppe-undtagelse (som R5).
const GROUP_LIMIT_DEFAULTS = { threshold: 70, fallback: "light" };

export default function GroupsTabV2({
  riders: rawRiders, riderWeekPlans, programs, groups, fatigueRules, mobile, setDrafts, setRotationDrafts, setWeekDrafts, onOpenWeek,
}: {
  riders: RawRider[];
  riderWeekPlans: Record<string, ProgramWeekDays | null | undefined>;
  programs: ProgramsLike;
  groups: TrainingGroupsClient;
  fatigueRules: FatigueRulesClient;
  mobile: boolean;
  setDrafts: DraftSetter;
  setRotationDrafts: DraftSetter;
  setWeekDrafts: DraftSetter;
  onOpenWeek: (subject: Subject) => void;
}) {
  const { t, i18n } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  const tTypes = useTranslation("riderTypes").t;
  const lang = i18n.language;

  const riders: R5Rider[] = useMemo(() => [...rawRiders]
    .sort((a, b) => `${a.lastname ?? ""} ${a.firstname ?? ""}`.localeCompare(`${b.lastname ?? ""} ${b.firstname ?? ""}`))
    .map((r) => ({ id: r.id, name: `${r.firstname ?? ""} ${r.lastname ?? ""}`.trim(), type: r.primary_type ?? null })), [rawRiders]);
  const riderById = useMemo(() => new Map(riders.map((r) => [r.id, r])), [riders]);
  const groupList: R5Group[] = useMemo(() => (groups.enabled ? groups.groups : []), [groups.enabled, groups.groups]);
  const ownPlanIds = useMemo(
    () => new Set(Object.keys(riderWeekPlans).filter((id) => riderWeekPlans[id] != null)),
    [riderWeekPlans],
  );
  const library = useMemo(() => buildLibrary({
    catalog: programs.catalog, groups: groupList, riders, ownPlanIds, assigned: programs.assigned,
  }), [programs.catalog, groupList, riders, ownPlanIds, programs.assigned]);

  const [saving, setSaving] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [dialogError, setDialogError] = useState(false);
  const [moveRider, setMoveRider] = useState<{ id: string; add: boolean } | null>(null);
  const [groupDialog, setGroupDialog] = useState<{ group: TrainingGroup | null } | null>(null);
  const [limitDraft, setLimitDraft] = useState<GroupLimitDraft>(() => groupLimitDraft(null, GROUP_LIMIT_DEFAULTS));
  const [deleting, setDeleting] = useState<TrainingGroup | null>(null);
  const busy = groups.busy || saving;
  const planKindMatters = programs.rotationEnabled === true || programs.weekPriorityEnabled === true;
  const menuActions = groupMenuActions({ limitEnabled: fatigueRules.enabled }).filter((action) => action !== "members");

  const programLabel = (key: string | null) => {
    const p = programs.catalog.find((c) => c.key === key);
    return p ? programName(p, lang) : tR5("programR5.ownWeek");
  };
  const dropPlanDrafts = (keys: string[]) => {
    setDrafts((prev) => dropDrafts(prev, keys));
    setRotationDrafts((prev) => dropDrafts(prev, keys));
    setWeekDrafts((prev) => dropDrafts(prev, keys));
  };

  const openGroupDialog = (target: TrainingGroup | null) => {
    setLimitDraft(groupLimitDraft(target?.fatigue, GROUP_LIMIT_DEFAULTS));
    setGroupDialog({ group: target });
  };
  const groupAction = (id: string, action: GroupMenuAction) => {
    const target = groups.groups.find((g) => g.id === id);
    if (!target) return;
    if (action === "delete") setDeleting(target);
    else openGroupDialog(target);
  };
  const saveGroup = async (name: string, riderIds: string[]): Promise<boolean> => {
    const editing = groupDialog?.group ?? null;
    let id = editing?.id ?? null;
    if (editing) {
      const patch = groupPatch(editing, name, riderIds);
      if (patch) {
        const updated = await groups.update(editing.id, patch);
        if (!updated.ok) return false;
        if (patch.riderIds) {
          const existing = new Set(editing.members.map((member) => member.riderId));
          dropPlanDrafts(patch.riderIds.filter((riderId) => !existing.has(riderId)).map((riderId) => subjectKey({ kind: "rider", id: riderId })));
          await programs.reload?.();
        }
        // Fejler graensen bagefter, skal et nyt Gem sammenligne med det gemte (som R5).
        setGroupDialog({ group: groupAfterPatch(editing, patch, updated.groups) });
      }
    } else {
      const before = groups.groups.map((g) => g.id);
      const created = await groups.create(name, riderIds);
      if (!created.ok) return false;
      id = createdGroupId(before, created.groups);
      // Gruppen findes nu: et nyt tryk paa Gem maa ikke oprette den igen, hvis graensen fejler.
      const made = created.groups?.find((g) => g.id === id) ?? null;
      if (made) setGroupDialog({ group: made });
    }
    if (fatigueRules.enabled && id) {
      const write = groupLimitWrite(limitDraft, editing?.fatigue);
      if (!write.ok) return false;
      if (write.change && !(await groups.setFatigue(id, write.change.mode, write.change.own)).ok) return false;
    }
    setGroupDialog(null);
    setNote(null);
    return true;
  };
  const deleteGroup = async () => {
    if (!deleting) return;
    const key = subjectKey({ kind: "group", id: deleting.id });
    const result = await groups.remove(deleting.id);
    setDeleting(null);
    if (!result.ok) { setNote(tR5("programR5.saveError")); return; }
    dropPlanDrafts([key]);
    setNote(null);
  };
  const moveToGroup = async (groupId: string) => {
    if (!moveRider || busy) return;
    const target = groupList.find((g) => g.id === groupId);
    const patch = target && groupMovePatch(target, moveRider.id);
    if (!patch) return;
    setSaving(true);
    setDialogError(false);
    try {
      const result = await groups.update(groupId, patch);
      if (!result.ok) { setDialogError(true); return; }
      if (planKindMatters) {
        dropPlanDrafts([subjectKey({ kind: "rider", id: moveRider.id })]);
        await programs.reload?.();
      }
      setMoveRider(null);
    } catch {
      setDialogError(true);
    } finally {
      setSaving(false);
    }
  };
  const followAgain = async (subject: Subject) => {
    const follow = followAgainTarget(subject, groupList);
    if (!follow) return;
    const result = await groups.follow(follow.groupId, follow.riderIds);
    if (!result.ok) { setNote(tR5("programR5.saveError")); return; }
    // Rytterens egne rettelser gaelder ikke laengere: han koerer gruppens uge igen.
    dropPlanDrafts(follow.riderIds.map((id) => subjectKey({ kind: "rider", id })));
    await programs.reload?.();
    setNote(null);
  };
  const otherGroupsFor = (riderId: string) => groupList.filter((g) => !g.members.some((m) => m.riderId === riderId));

  const tap = mobile ? "min-h-11" : "";
  const rowCls = "flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-cz-border px-3 py-2";
  const riderRow = (riderId: string, plan: string, actions: ReactNode) => {
    const rider = riderById.get(riderId);
    return (
      <li key={riderId} className={rowCls} data-testid="groups-v2-rider">
        <span className="min-w-0 flex-1">
          <button type="button" onClick={() => onOpenWeek({ kind: "rider", id: riderId })}
            className={`${tap} text-start text-[13px] font-medium text-cz-1 hover:underline`}
            aria-label={tR5("programW1.openWeek", { name: rider?.name ?? "" })}>
            {rider?.name ?? ""}
          </button>
          <span className="block text-2xs text-cz-2">
            {[rider?.type ? tTypes(`types.${rider.type}`) : null, plan].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="flex flex-wrap items-center gap-1.5">{actions}</span>
      </li>
    );
  };
  const moveButton = (riderId: string, add: boolean) => (
    <Button variant="secondary" size="sm" className={tap} disabled={busy || otherGroupsFor(riderId).length === 0}
      onClick={() => { setDialogError(false); setMoveRider({ id: riderId, add }); }} data-testid="groups-v2-move">
      {tR5(add ? "programR5.manage.addToGroup" : "programR5.manage.moveToGroup")}
    </Button>
  );

  if (!groups.enabled) {
    return (
      <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={tR5("programW1.groups.offTitle")}
        description={tR5("programW1.groups.offBody")} action={null} />
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="groups-v2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-cz-2">{tR5("programR5.ownWins")}</p>
        <Button variant="secondary" size="md" className="min-h-11" disabled={busy} onClick={() => openGroupDialog(null)} data-testid="groups-v2-new">
          <PlusIcon size={13} aria-hidden="true" />{tR5("programR5.manage.newGroup")}
        </Button>
      </div>

      {library.groups.length === 0 && (
        <EmptyState icon={<TeamIcon size={26} aria-hidden="true" />} title={tR5("programW1.groups.emptyTitle")}
          description={tR5("programW1.groups.emptyBody")}
          action={(
            <Button variant="secondary" size="sm" className="min-h-11" disabled={busy} onClick={() => openGroupDialog(null)} data-testid="groups-v2-empty-new">
              {tR5("programR5.manage.newGroup")}
            </Button>
          )} />
      )}

      {library.groups.map((g) => {
        const full = groups.groups.find((x) => x.id === g.id) ?? null;
        const followAll = followAgainTarget({ kind: "group", id: g.id }, groupList);
        return (
          <section key={g.id} className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="groups-v2-group"
            aria-label={g.name}>
            <header className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-cz-subtle px-3 py-2">
              <span className="min-w-0 flex-1">
                <button type="button" onClick={() => onOpenWeek({ kind: "group", id: g.id })}
                  className={`${tap} text-start text-[15px] font-semibold text-cz-1 hover:underline`}
                  aria-label={tR5("programW1.openWeek", { name: g.name })}>
                  {g.name}
                </button>
                <span className="block text-2xs text-cz-2">
                  {programLabel(g.programKey)} · <span className="font-data tabular-nums">{t("groups.count", { n: g.members.length })}</span>
                </span>
              </span>
              <span className="flex flex-wrap items-center gap-1.5">
                {followAll && (
                  <button type="button" disabled={busy} onClick={() => followAgain({ kind: "group", id: g.id })}
                    className={`${tap} inline-flex items-center text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50`}
                    data-testid="groups-v2-follow-all">
                    {tR5("programR5.manage.followAgainAll", { n: followAll.riderIds.length })}
                  </button>
                )}
                <Button variant="secondary" size="sm" className={tap} disabled={busy || !full}
                  onClick={() => full && openGroupDialog(full)} data-testid="groups-v2-members">
                  {tR5("programR5.manage.members")}
                </Button>
                <GroupMenuV2 name={g.name} actions={menuActions} touch={mobile} disabled={busy} onPick={(action) => groupAction(g.id, action)} />
              </span>
            </header>
            {g.members.length === 0 ? (
              <p className="border-t border-cz-border px-3 py-3 text-xs text-cz-3">{t("groups.emptyHint")}</p>
            ) : (
              <ul>
                {g.members.map((m) => riderRow(
                  m.riderId,
                  m.own ? tR5("programR5.ownPlan", { name: programLabel(m.ownProgramKey) }) : tR5("programW1.groups.follows"),
                  <>
                    {m.own && (
                      <button type="button" disabled={busy} onClick={() => followAgain({ kind: "rider", id: m.riderId })}
                        className={`${tap} inline-flex items-center text-xs font-medium text-cz-accent-t hover:underline disabled:opacity-50`}
                        data-testid="groups-v2-follow-again">
                        {tR5("programR5.manage.followAgain")}
                      </button>
                    )}
                    {moveButton(m.riderId, false)}
                  </>,
                ))}
              </ul>
            )}
          </section>
        );
      })}

      {(library.ownOnly.length > 0 || library.noProgram.length > 0) && (
        <section className="overflow-hidden rounded-cz border border-cz-border bg-cz-card" data-testid="groups-v2-ungrouped"
          aria-label={tR5("programW1.groups.withoutGroup")}>
          <header className="bg-cz-subtle px-3 py-2">
            <h3 className="text-[15px] font-semibold text-cz-1">{tR5("programW1.groups.withoutGroup")}</h3>
            <span className="block font-data text-2xs tabular-nums text-cz-2">
              {t("groups.count", { n: library.ownOnly.length + library.noProgram.length })}
            </span>
          </header>
          <ul>
            {library.ownOnly.map((r) => riderRow(r.riderId, tR5("programR5.ownPlan", { name: programLabel(r.programKey) }), moveButton(r.riderId, true)))}
            {library.noProgram.map((id) => riderRow(id, tR5("programR5.noProgram"), moveButton(id, true)))}
          </ul>
        </section>
      )}

      {note && <p role="status" className="text-xs text-cz-danger">{note}</p>}

      {groupDialog && (
        <TrainingGroupDialog
          open
          group={groupDialog.group}
          riders={riders}
          groups={groups.groups}
          busy={groups.busy}
          onClose={() => setGroupDialog(null)}
          onSave={saveGroup}
          canSave={!fatigueRules.enabled || groupLimitValid(limitDraft)}
          extra={fatigueRules.enabled ? <GroupLimitFieldsV2 draft={limitDraft} busy={groups.busy} onChange={setLimitDraft} /> : null}
        />
      )}
      {deleting && (
        <Modal
          open
          onClose={() => setDeleting(null)}
          size="sm"
          title={tR5("programR5.manage.deleteTitle", { name: deleting.name })}
          titleId="groups-v2-delete-title"
          ariaLabelledby={undefined}
          description={null}
          closeLabel={tR5("programR5.cancel")}
          footer={(
            <>
              <Button variant="secondary" className="min-h-11" onClick={() => setDeleting(null)}>{tR5("programR5.cancel")}</Button>
              <Button variant="danger" className="min-h-11" disabled={busy} onClick={deleteGroup} data-testid="groups-v2-delete-go">
                {tR5("programR5.manage.deleteGo")}
              </Button>
            </>
          )}
        >
          <p className="text-xs text-cz-2">{tR5("programR5.manage.deleteBody")}</p>
        </Modal>
      )}
      {moveRider && (
        <MoveRiderDialog
          name={riderById.get(moveRider.id)?.name ?? ""}
          add={moveRider.add}
          targets={otherGroupsFor(moveRider.id)}
          busy={busy}
          saving={saving}
          error={dialogError}
          onClose={() => { if (!saving) setMoveRider(null); }}
          onMove={moveToGroup}
        />
      )}
    </div>
  );
}

function GroupMenuV2({
  name, actions, touch, disabled, onPick,
}: {
  name: string;
  actions: readonly GroupMenuAction[];
  touch: boolean;
  disabled: boolean;
  onPick: (action: GroupMenuAction) => void;
}) {
  const { t: tR5 } = useTranslation("trainingR5");
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement | null>(null);
  useDismiss(ref, () => setOpen(false), open);
  const label = tR5("programR5.manage.menu", { name });
  return (
    <div ref={ref} className="relative shrink-0">
      <button type="button" aria-haspopup="menu" aria-expanded={open} aria-label={label} title={label} disabled={disabled}
        onClick={() => setOpen((v) => !v)} data-testid="groups-v2-menu"
        className="inline-flex h-11 w-11 items-center justify-center rounded-cz text-cz-3 hover:bg-cz-card hover:text-cz-1 disabled:opacity-50">
        <MoreIcon size={14} aria-hidden="true" />
      </button>
      {open && (
        <div className="absolute end-0 z-dropdown mt-1 min-w-[168px]">
          <Menu aria-label={label}>
            {actions.map((action) => (
              <MenuItem key={action} danger={action === "delete"} className={touch ? "min-h-11" : ""}
                onClick={() => { setOpen(false); onPick(action); }} data-testid={`groups-v2-${action}`}>
                {tR5(`programR5.manage.${action}`)}
              </MenuItem>
            ))}
          </Menu>
        </div>
      )}
    </div>
  );
}

// Gruppens traethedsgraense i gruppedialogen (som R5, med en sentence case-etiket).
function GroupLimitFieldsV2({
  draft, busy, onChange,
}: {
  draft: GroupLimitDraft;
  busy: boolean;
  onChange: (next: GroupLimitDraft) => void;
}) {
  const { t } = useTranslation("training");
  const { t: tR5 } = useTranslation("trainingR5");
  const valid = groupLimitValid(draft);
  const control = "min-h-11 rounded-cz border border-cz-border bg-cz-card px-2 text-[13px] text-cz-1 disabled:opacity-50 sm:min-h-9";
  const label = tR5("programR5.manage.limitLabel");
  return (
    <div className="flex flex-col gap-2 border-t border-cz-border pt-3" data-testid="groups-v2-limit-fields">
      <span className="text-xs font-medium text-cz-2">{label}</span>
      <Segmented label={label} value={draft.mode} onChange={(mode: GroupLimitDraft["mode"]) => onChange({ ...draft, mode })}
        options={GROUP_LIMIT_MODES.map((m) => ({ value: m, label: tR5(`programR5.manage.limit_${m}`), disabled: busy }))} />
      {draft.mode === "own" ? (
        <span className="flex flex-wrap items-center gap-2 text-[13px] text-cz-1">
          <span>{tR5("programR5.manage.limitAbove")}</span>
          <input type="number" inputMode="numeric" min={0} max={100} step={1} value={draft.threshold} disabled={busy}
            onChange={(e) => onChange({ ...draft, threshold: e.target.value })}
            aria-label={t("fatigueRule.aboveLabel")} aria-invalid={!valid}
            className={`${control} w-16 font-data tabular-nums`} />
          <span>{tR5("programR5.manage.limitRun")}</span>
          <select value={draft.fallback} disabled={busy} onChange={(e) => onChange({ ...draft, fallback: e.target.value })}
            aria-label={t("fatigueRule.insteadLabel")} className={control}>
            {FATIGUE_FALLBACKS.map((f) => <option key={f} value={f}>{t(`fatigueRule.fallback_${f}`)}</option>)}
          </select>
          <span>{tR5("programR5.manage.limitInstead")}</span>
        </span>
      ) : (
        <p className="text-xs text-cz-2">{tR5(draft.mode === "team" ? "programR5.manage.limitTeamNote" : "programR5.manage.limitOffNote")}</p>
      )}
      <p className="text-2xs text-cz-3">{t("groups.fatigueLadder")}</p>
    </div>
  );
}
