// Race Hub Fase 1 — "ledige ryttere"-pulje. 12-truppen som chips; bundne ryttere
// grånet + lås (én rytter/ét overlappende løb). Klik en ledig chip → popover med
// hvilket løb. "Auto-udfyld igen" gen-kører assistenten for dagens løb.
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddRiderPopover from "./AddRiderPopover.jsx";
import { LockIcon } from "../ui";

export default function AvailableRidersPool({ roster, columns, bindingMap, onAddRiderToRace, onRegenerate, busy }) {
  const { t } = useTranslation("races");
  const [openRiderId, setOpenRiderId] = useState(null);
  const selectedAnywhere = new Set(columns.flatMap((c) => c.selection?.rider_ids || []));
  const isBound = (id) => Array.isArray(bindingMap?.[id]) && bindingMap[id].length > 0;
  return (
    <div className="border border-cz-border rounded-cz bg-cz-subtle">
      <div className="px-3 py-2 border-b border-cz-border flex items-center justify-between">
        <span className="text-[11px] uppercase tracking-wide text-cz-2">{t("racehub.pool.title", { count: roster.length })}</span>
        <button type="button" onClick={onRegenerate} disabled={busy}
          className="text-xs text-cz-accent-t hover:underline disabled:opacity-50">{t("racehub.pool.autofill")}</button>
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        {roster.map((r) => {
          const placed = selectedAnywhere.has(r.id);
          if (placed) return null;
          const bound = isBound(r.id);
          return (
            <div key={r.id} className="relative">
              <button
                type="button"
                disabled={bound || busy}
                title={bound ? t("racehub.pool.bound") : undefined}
                onClick={() => setOpenRiderId(openRiderId === r.id ? null : r.id)}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                  bound
                    ? "border-dashed border-cz-border text-cz-3 opacity-50 cursor-not-allowed"
                    : "border-cz-border bg-cz-card text-cz-1 hover:border-cz-accent/40"
                }`}
              >
                {bound && <LockIcon size={11} aria-hidden="true" />}
                {r.name} <span className="font-mono text-cz-3">{r.form ?? "—"}</span>
              </button>
              {openRiderId === r.id && !bound && (
                <AddRiderPopover rider={r} columns={columns} bindingMap={bindingMap}
                  onPick={(raceId) => onAddRiderToRace(raceId, r.id)} onClose={() => setOpenRiderId(null)} />
              )}
            </div>
          );
        })}
      </div>
      <p className="px-3 pb-2 text-[10px] text-cz-3 flex items-center gap-1">
        <LockIcon size={10} aria-hidden="true" /> {t("racehub.pool.bound")}
      </p>
    </div>
  );
}
