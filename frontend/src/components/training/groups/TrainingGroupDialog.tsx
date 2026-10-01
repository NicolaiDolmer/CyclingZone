// TrainingGroupDialog — "New group" / "Edit group" (#6000, mockup pin 4).
//
// Et lille vindue: navn, "Start from" (rytter-type eller vaelg selv), rytterne
// som afkrydsning. En rytter er i hoejst een gruppe: vaelges en rytter der
// allerede er i en anden gruppe, flyttes han (noten siger det).
//
// TASTE: hairlines, rounded-cz, stroke-ikoner, ingen skygger i indholdet.
import { useMemo, useState } from "react";
import { useTranslation } from "react-i18next";
import Modal from "../../ui/Modal.jsx";
import Button from "../../ui/Button.jsx";
import { CheckIcon } from "../../ui/icons/index.jsx";
import { riderTypesInSquad, type TrainingGroup } from "./trainingGroupsModel.ts";

export type GroupRider = { id: string; name: string; type: string | null };

export default function TrainingGroupDialog({
  open,
  group,
  riders,
  groups,
  busy,
  onClose,
  onSave,
  onDelete,
}: {
  open: boolean;
  group: TrainingGroup | null;
  riders: GroupRider[];
  groups: TrainingGroup[];
  busy: boolean;
  onClose: () => void;
  onSave: (name: string, riderIds: string[]) => Promise<boolean>;
  onDelete?: () => Promise<boolean>;
}) {
  const { t } = useTranslation("training");
  const tTypes = useTranslation("riderTypes").t;
  const [name, setName] = useState(group?.name ?? "");
  const [startType, setStartType] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set(group?.members.map((m) => m.riderId) ?? []));
  const [error, setError] = useState<string | null>(null);
  const types = useMemo(() => riderTypesInSquad(riders), [riders]);
  const otherGroupOf = useMemo(() => {
    const out = new Map<string, string>();
    for (const g of groups) if (g.id !== group?.id) for (const m of g.members) out.set(m.riderId, g.name);
    return out;
  }, [groups, group?.id]);

  const trimmed = name.trim();
  const valid = trimmed.length >= 1 && trimmed.length <= 40;
  const moving = [...selected].filter((id) => otherGroupOf.has(id)).length;

  function pickType(type: string | null) {
    setStartType(type);
    if (type) setSelected(new Set(riders.filter((r) => r.type === type).map((r) => r.id)));
    if (type && !trimmed) setName(tTypes(`types.${type}`));
  }

  function toggle(id: string) {
    setStartType(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  async function save() {
    if (!valid) return;
    setError(null);
    const ok = await onSave(trimmed, [...selected]);
    if (!ok) setError(t("groups.error"));
  }

  const chip = (active: boolean) =>
    `min-h-11 rounded-cz-pill border px-2.5 text-xs sm:min-h-0 sm:py-0.5 ${
      active ? "border-cz-1 bg-cz-subtle text-cz-1" : "border-cz-border text-cz-2 hover:bg-cz-subtle"
    }`;

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="md"
      title={group ? t("groups.editTitle") : t("groups.newTitle")}
      titleId="training-group-dialog-title"
      ariaLabelledby={undefined}
      description={null}
      closeLabel={t("groups.close")}
      footer={(
        <>
          {group && onDelete && (
            <button
              type="button"
              disabled={busy}
              onClick={async () => { if (!(await onDelete())) setError(t("groups.error")); }}
              className="me-auto text-xs font-medium text-cz-danger hover:underline disabled:opacity-50"
              data-testid="training-group-delete"
            >
              {t("groups.delete")}
            </button>
          )}
          <Button variant="primary" size="sm" disabled={!valid} loading={busy} onClick={save} data-testid="training-group-save">
            {group ? t("groups.save") : t("groups.create")}
          </Button>
        </>
      )}
    >
      <div className="space-y-4" data-testid="training-group-dialog">
        <label className="flex flex-col gap-1">
          <span className="font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3">{t("groups.name")}</span>
          <input
            type="text"
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            placeholder={t("groups.namePlaceholder")}
            className="min-h-11 rounded-cz border border-cz-border bg-cz-card px-2.5 text-[13px] text-cz-1 sm:min-h-9"
            data-testid="training-group-name"
          />
        </label>

        {!group && types.length > 0 && (
          <div className="flex flex-col gap-1.5">
            <span className="font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3">{t("groups.startFrom")}</span>
            <div className="flex flex-wrap gap-1.5">
              {types.map((type) => (
                <button key={type} type="button" aria-pressed={startType === type} onClick={() => pickType(type)} className={chip(startType === type)}>
                  {t("groups.riderType", { type: tTypes(`types.${type}`) })}
                </button>
              ))}
              <button type="button" aria-pressed={startType == null} onClick={() => pickType(null)} className={chip(startType == null)}>
                {t("groups.pickByHand")}
              </button>
            </div>
          </div>
        )}

        <fieldset className="flex flex-col gap-1.5">
          <legend className="mb-1.5 font-data text-2xs font-semibold uppercase tracking-[.04em] text-cz-3">
            {t("groups.riders", { n: selected.size })}
          </legend>
          <ul className="max-h-64 divide-y divide-cz-border overflow-y-auto rounded-cz border border-cz-border">
            {riders.map((rider) => {
              const checked = selected.has(rider.id);
              const other = otherGroupOf.get(rider.id);
              return (
                <li key={rider.id}>
                  <label className="flex min-h-11 cursor-pointer items-center gap-2.5 px-2.5 text-[13px] hover:bg-cz-subtle sm:min-h-9">
                    <input type="checkbox" checked={checked} onChange={() => toggle(rider.id)} className="sr-only" />
                    <span
                      aria-hidden="true"
                      className={`flex h-4 w-4 flex-none items-center justify-center rounded-cz border ${checked ? "border-cz-1 bg-cz-1 text-cz-card" : "border-cz-border"}`}
                    >
                      {checked && <CheckIcon size={11} />}
                    </span>
                    <span className="min-w-0 flex-1 truncate text-cz-1">{rider.name}</span>
                    {other && <span className="flex-none truncate text-2xs text-cz-3">{other}</span>}
                  </label>
                </li>
              );
            })}
          </ul>
        </fieldset>

        <p className="text-2xs text-cz-3">
          {moving > 0 ? t("groups.movingNote", { n: moving }) : t("groups.oneGroupNote")}
        </p>
        {error && <p role="alert" className="text-xs text-cz-danger">{error}</p>}
      </div>
    </Modal>
  );
}
