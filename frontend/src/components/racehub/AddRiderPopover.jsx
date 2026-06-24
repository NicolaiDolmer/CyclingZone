// Race Hub Fase 1 — "tilføj til hvilket løb?"-popover. Viser kun dagens kolonne-løb
// hvor rytteren ikke er bundet og ikke allerede er udtaget.
import { useTranslation } from "react-i18next";
import { isRiderBound } from "../../lib/raceHubLogic.js";

export default function AddRiderPopover({ rider, columns, bindingMap, onPick, onClose }) {
  const { t } = useTranslation("races");
  const targets = columns.filter(
    (c) =>
      !c.withdrawn &&
      !isRiderBound({ bindingMap, riderId: rider.id, forRaceId: c.id }) &&
      !(c.selection?.rider_ids || []).includes(rider.id)
  );
  return (
    <div className="absolute z-dropdown mt-1 bg-cz-elevated border border-cz-border rounded-cz shadow-overlay p-2 min-w-[200px]">
      <p className="text-xs text-cz-3 px-2 py-1">{t("racehub.popover.title")}</p>
      {targets.length === 0 && <p className="text-xs text-cz-3 px-2 py-1.5">{t("racehub.popover.none")}</p>}
      {targets.map((c) => (
        <button
          key={c.id}
          type="button"
          onClick={() => { onPick(c.id); onClose(); }}
          className="block w-full text-left text-sm text-cz-1 px-2 py-1.5 rounded hover:bg-cz-subtle"
        >
          {c.name}
        </button>
      ))}
    </div>
  );
}
