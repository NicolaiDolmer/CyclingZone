// Race Hub Fase 1 — "tilføj til hvilket løb?"-popover. Viser dagens kolonne-løb hvor
// rytteren ikke er bundet, ikke allerede udtaget og ikke frosset. Smart (#1823 WC):
// rangeret efter rytterens egnethed (fit) for hvert løb + flag for underbemandede.
import { useTranslation } from "react-i18next";
import { isRiderBound } from "../../lib/raceHubLogic.js";
import FitBar from "./FitBar.jsx";

export default function AddRiderPopover({ rider, columns, bindingMap, onPick, onClose }) {
  const { t } = useTranslation("races");
  const targets = columns
    .filter(
      (c) =>
        !c.withdrawn &&
        !c.lineup_locked &&
        !isRiderBound({ bindingMap, riderId: rider.id, forRaceId: c.id }) &&
        !(c.selection?.rider_ids || []).includes(rider.id)
    )
    .map((c) => ({
      c,
      fit: c.riders.find((x) => x.id === rider.id)?.suitability ?? null,
      understaffed: (c.counts?.selected ?? 0) < (c.counts?.target ?? 0),
    }))
    .sort((a, b) => (b.fit ?? -1) - (a.fit ?? -1)); // bedste fit øverst
  return (
    <div className="absolute z-dropdown mt-1 bg-cz-elevated border border-cz-border rounded-cz shadow-overlay p-2 min-w-[230px]">
      <p className="text-xs text-cz-3 px-2 py-1">{t("racehub.popover.title")}</p>
      {targets.length === 0 && <p className="text-xs text-cz-3 px-2 py-1.5">{t("racehub.popover.none")}</p>}
      {targets.map(({ c, fit, understaffed }) => (
        <button
          key={c.id}
          type="button"
          onClick={() => { onPick(c.id); onClose(); }}
          className="flex w-full items-center justify-between gap-2 text-left px-2 py-1.5 rounded hover:bg-cz-subtle"
        >
          <span className="min-w-0">
            <span className="block text-sm text-cz-1 truncate">{c.name}</span>
            {understaffed && <span className="text-[10px] text-cz-warning">{t("racehub.popover.understaffed")}</span>}
          </span>
          <FitBar score={fit} />
        </button>
      ))}
    </div>
  );
}
