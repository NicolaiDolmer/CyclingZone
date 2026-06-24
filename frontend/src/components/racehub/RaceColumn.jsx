// Race Hub Fase 1 — ét overlap-løb som kolonne: header + status-chip + udtagne
// ryttere (tap → fjern) + tilføj-genvej + afmeld/deltag.
import { useTranslation } from "react-i18next";
import { computeColumnStatus } from "../../lib/raceHubLogic.js";

const STATUS_CLASS = {
  full: "bg-cz-success-bg text-cz-success border-cz-success/30",
  understaffed: "bg-cz-warning-bg text-cz-warning border-cz-warning/40",
  withdrawn: "bg-cz-subtle text-cz-3 border-cz-border",
};

const ROLE_KEY = { captain: "captain", sprint_captain: "sprintCaptain", hunter: "hunter" };

export default function RaceColumn({ column, onRemoveRider, onToggleWithdraw, busy }) {
  const { t } = useTranslation("races");
  const selectedIds = column.selection?.rider_ids || [];
  const ridersById = new Map(column.riders.map((r) => [r.id, r]));
  const roleOf = (id) => {
    const s = column.selection;
    if (!s) return null;
    if (id === s.captain_id) return "captain";
    if (id === s.sprint_captain_id) return "sprint_captain";
    if (id === s.hunter_id) return "hunter";
    return null;
  };
  const status = computeColumnStatus({ selected: column.counts.selected, target: column.counts.target, withdrawn: column.withdrawn });
  return (
    <div className="border border-cz-border rounded-cz bg-cz-card flex flex-col">
      <div className="p-3 border-b border-cz-border">
        <p className="text-sm font-semibold text-cz-1">{column.name}</p>
        <p className="text-[11px] text-cz-3 mt-0.5">
          {column.race_type === "stage_race" ? t("raceType.stages", { count: column.stages }) : t("raceType.oneDay")} · {t(`classOption.${column.race_class}`)}
        </p>
        <span className={`inline-block mt-2 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border ${STATUS_CLASS[status.kind]}`}>
          {t(`racehub.status.${status.kind}`, { selected: status.selected, target: status.target })}
        </span>
      </div>
      {!column.withdrawn && (
        <div className="py-1 flex-1">
          {selectedIds.map((id) => {
            const r = ridersById.get(id);
            if (!r) return null;
            const role = roleOf(id);
            return (
              <button key={id} type="button" onClick={() => onRemoveRider(column.id, id)} disabled={busy}
                className="w-full flex items-center justify-between px-3 py-1.5 text-left hover:bg-cz-subtle disabled:opacity-50">
                <span className="text-xs text-cz-1">
                  {r.name}
                  {role && (
                    <span className="text-[9px] uppercase text-cz-accent-t border border-cz-accent/40 px-1.5 py-px rounded ms-1.5">
                      {t(`selection.${ROLE_KEY[role]}`)}
                    </span>
                  )}
                </span>
                <span className={`text-[11px] font-mono ${r.fatigue > 50 ? "text-cz-warning" : "text-cz-3"}`}>{r.form ?? "—"}</span>
              </button>
            );
          })}
          {selectedIds.length === 0 && (
            <p className="text-xs text-cz-3 px-3 py-2">{t("racehub.status.understaffed", { selected: 0, target: column.counts.target })}</p>
          )}
        </div>
      )}
      <div className="p-2 border-t border-cz-border flex items-center justify-end">
        <button type="button" onClick={() => onToggleWithdraw(column.id, !column.withdrawn)} disabled={busy}
          className="text-xs text-cz-3 hover:text-cz-1 disabled:opacity-50">
          {column.withdrawn ? t("racehub.column.reenter") : t("racehub.column.withdraw")}
        </button>
      </div>
    </div>
  );
}
