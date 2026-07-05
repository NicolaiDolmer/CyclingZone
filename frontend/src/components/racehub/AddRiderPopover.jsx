// Race Hub Fase 1 — "tilføj til hvilket løb?"-popover. #1984: nu grupperet, så manageren
// kan SE forskellen på samme-dags-løb der er ledige vs. optaget pga. ægte overlap:
//   • "Ledig til"            — dagens løb hvor rytteren kan tilføjes (rangeret efter fit, #1823 WC)
//   • "Optaget i overlappende løb" — løb han er låst fra, MED hvilket løb der binder ham (grunden)
// Åbnes også for låste ryttere (kan ikke tilføjes nogen) → de ser stadig HVORFOR.
import { useTranslation } from "react-i18next";
import { canAddRiderToColumn, overlapConflictColumn, sameDayCompatibilityHint } from "../../lib/raceHubLogic.js";
import { LockIcon } from "../ui";
import FitBar from "./FitBar.jsx";

export default function AddRiderPopover({ rider, columns, bindingMap, onPick, onClose }) {
  const { t } = useTranslation("races");
  const targets = columns
    .filter((c) => canAddRiderToColumn({ column: c, bindingMap, riderId: rider.id }))
    .map((c) => ({
      c,
      fit: c.riders.find((x) => x.id === rider.id)?.suitability ?? null,
      understaffed: (c.counts?.selected ?? 0) < (c.counts?.target ?? 0),
      // #1984/#2195: er rytteren allerede i et andet (ikke-overlappende) samme-dags-løb? Så
      // forklar HVORFOR genbrug er tilladt i stedet for at lade det se vilkårligt ud.
      compat: sameDayCompatibilityHint({ column: c, columns, riderId: rider.id }),
    }))
    .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1)); // bedste fit øverst
  // #1984: løb rytteren er optaget i pga. ægte game-dag-overlap (ikke afmeldt/startet, ikke
  // allerede udtaget her) + HVILKET løb der binder ham (grunden).
  const blocked = columns
    .filter((c) => !c.withdrawn && !c.lineup_locked && !(c.selection?.rider_ids || []).includes(rider.id))
    .map((c) => ({ c, conflict: overlapConflictColumn({ column: c, columns, bindingMap, riderId: rider.id }) }))
    .filter((x) => x.conflict);
  return (
    <div className="absolute z-dropdown mt-1 bg-cz-elevated border border-cz-border rounded-cz shadow-overlay p-2 min-w-[230px]">
      <p className="text-xs text-cz-3 px-2 py-1">{t("racehub.popover.title")}</p>
      {targets.length === 0 && blocked.length === 0 && <p className="text-xs text-cz-3 px-2 py-1.5">{t("racehub.popover.none")}</p>}
      {targets.length > 0 && <p className="text-[10px] uppercase tracking-wide text-cz-success px-2 pt-1 pb-0.5">{t("racehub.popover.availableGroup")}</p>}
      {targets.map(({ c, fit, understaffed, compat }) => (
        <button
          key={c.id}
          type="button"
          onClick={() => { onPick(c.id); onClose(); }}
          className="flex w-full items-center justify-between gap-2 text-left px-2 py-1.5 rounded hover:bg-cz-subtle"
        >
          <span className="min-w-0">
            <span className="block text-sm text-cz-1 truncate">{c.name}</span>
            {compat && (
              <span className="block text-[10px] text-cz-success truncate">
                {Number.isFinite(compat.gameDay)
                  ? t("racehub.popover.compatibleHint", { race: compat.name, day: compat.gameDay })
                  : t("racehub.popover.compatibleHintNoDay", { race: compat.name })}
              </span>
            )}
            {understaffed && <span className="text-[10px] text-cz-warning">{t("racehub.popover.understaffed")}</span>}
          </span>
          <FitBar score={fit} />
        </button>
      ))}
      {blocked.length > 0 && <p className="text-[10px] uppercase tracking-wide text-cz-danger px-2 pt-2 pb-0.5">{t("racehub.popover.blockedGroup")}</p>}
      {blocked.map(({ c, conflict }) => (
        <div key={c.id} className="flex w-full items-start gap-2 px-2 py-1.5 text-cz-3">
          <span className="min-w-0">
            <span className="block text-sm truncate">{c.name}</span>
            <span className="text-[10px] flex items-center gap-1">
              <LockIcon size={10} aria-hidden="true" />{t("racehub.popover.blockedReason", { race: conflict.name })}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
}
