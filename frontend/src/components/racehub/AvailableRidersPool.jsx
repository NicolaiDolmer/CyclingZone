// Race Hub Fase 1 — "ledige ryttere"-pulje. Hele truppen som chips; ryttere udtaget til
// et af dagens (overlappende) løb er grånet + låst (én rytter/ét løb, inkl. frosne løb).
// Klik en ledig chip → smart popover. Auto-udfyld er to-tilstands (#1823 D1): "Udfyld
// manglende" (bevarer manuelle) eller "Genopbyg alt" (overskriver alt).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddRiderPopover from "./AddRiderPopover.jsx";
import { LockIcon } from "../ui";

export default function AvailableRidersPool({ roster, columns, bindingMap, onAddRiderToRace, onRegenerate, busy }) {
  const { t } = useTranslation("races");
  const [openRiderId, setOpenRiderId] = useState(null);
  // Låst i puljen = udtaget til et af dagens løb (committed → bundet væk fra de øvrige).
  // Navngiv bindingen (#1823 WC): hvilket løb kører rytteren? (første kolonne han er i).
  // Rod A (#1823): afmeldte kolonner låser IKKE — rytterne er frie til de øvrige løb.
  const raceByRider = new Map();
  for (const c of columns) {
    if (c.withdrawn) continue;
    for (const id of c.selection?.rider_ids || []) if (!raceByRider.has(id)) raceByRider.set(id, c.name);
  }
  const lockedIds = new Set(raceByRider.keys());
  return (
    <div className="border border-cz-border rounded-cz bg-cz-subtle">
      <div className="px-3 py-2 border-b border-cz-border flex items-center justify-between gap-2">
        <span className="text-[11px] uppercase tracking-wide text-cz-2">{t("racehub.pool.title", { count: roster.length })}</span>
        {/* #1919: "Auto-udfyld"-labelen var en død <span> (Clarity dead-clicks) — den er nu
            selve den primære knap (udfyld manglende), så begge handlinger er ægte knapper. */}
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => onRegenerate("missing")} disabled={busy}
            className="text-[11px] uppercase tracking-wide font-medium text-cz-accent-t hover:underline disabled:opacity-50">{t("racehub.pool.autofill")}</button>
          <span className="text-cz-border" aria-hidden="true">·</span>
          <button type="button" onClick={() => onRegenerate("all")} disabled={busy}
            className="text-xs text-cz-3 hover:text-cz-1 hover:underline disabled:opacity-50">{t("racehub.pool.fillAll")}</button>
        </span>
      </div>
      <div className="flex flex-wrap gap-2 p-3">
        {roster.map((r) => {
          const locked = lockedIds.has(r.id);
          return (
            <div key={r.id} className="relative">
              <button
                type="button"
                disabled={locked || busy}
                title={locked ? t("racehub.boundNamed", { race: raceByRider.get(r.id) }) : undefined}
                onClick={() => setOpenRiderId(openRiderId === r.id ? null : r.id)}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                  locked
                    ? "border-dashed border-cz-border text-cz-3 opacity-50 cursor-not-allowed"
                    : "border-cz-border bg-cz-card text-cz-1 hover:border-cz-accent/40"
                }`}
              >
                {locked && <LockIcon size={11} aria-hidden="true" />}
                {r.name} <span className="font-mono text-cz-3">{r.form ?? "—"}</span>
              </button>
              {openRiderId === r.id && !locked && (
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
