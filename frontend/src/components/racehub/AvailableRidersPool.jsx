// Race Hub Fase 1 — "ledige ryttere"-pulje. Hele truppen som chips; ryttere udtaget til
// et af dagens (overlappende) løb er grånet + låst (én rytter/ét løb, inkl. frosne løb).
// Klik en ledig chip → smart popover. Auto-udfyld er to-tilstands (#1823 D1): "Udfyld
// manglende" (bevarer manuelle) eller "Genopbyg alt" (overskriver alt).
// #2599: "Genopbyg alt" (den gamle mode=all-overskrivning der selv fyldte bredt ud med
// nye AI-forslag) er erstattet af en eksplicit "Ryd dag"-knap — rydder til TOM i stedet
// for at gætte for spilleren. "Ryd alt" (season-bred) er tilføjet ved siden af. Begge
// kræver en bekræftelses-dialog (onClearSquad i RaceHubBoard).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddRiderPopover from "./AddRiderPopover.jsx";
import { LockIcon } from "../ui";
import { encodeDrag } from "../../lib/raceHubDnd.js";
import { canAddRiderToColumn } from "../../lib/raceHubLogic.js";

export default function AvailableRidersPool({ roster, columns, bindingMap, onAddRiderToRace, onRegenerate, onClearSquad, busy, onDropRider }) {
  const { t } = useTranslation("races");
  const [openRiderId, setOpenRiderId] = useState(null);
  const [dragOver, setDragOver] = useState(false); // #1925: pulje-drop-zone (fjern rytter ved drop)
  // Hvilket løb kører rytteren (til lås-titlen)? Første ikke-afmeldte kolonne han er i.
  // Rod A (#1823): afmeldte kolonner låser IKKE. Kronologi-rebuild: en rytter er kun LÅST
  // i puljen hvis han ikke kan tilføjes NOGEN kolonne — dvs. game-dag-bundet i alle dagens
  // løb. Er der en game-dag-fri kolonne (samme IRL-dag, anden in-game-dag) er chippen aktiv.
  const raceByRider = new Map();
  for (const c of columns) {
    if (c.withdrawn) continue;
    for (const id of c.selection?.rider_ids || []) if (!raceByRider.has(id)) raceByRider.set(id, c.name);
  }
  const isLocked = (riderId) => !columns.some((c) => canAddRiderToColumn({ column: c, bindingMap, riderId }));
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
          <button type="button" onClick={() => onClearSquad?.("day")} disabled={busy}
            className="text-xs text-cz-3 hover:text-cz-1 hover:underline disabled:opacity-50">{t("racehub.pool.clearDay")}</button>
          <span className="text-cz-border" aria-hidden="true">·</span>
          <button type="button" onClick={() => onClearSquad?.("all")} disabled={busy}
            className="text-xs text-cz-3 hover:text-cz-1 hover:underline disabled:opacity-50">{t("racehub.pool.clearAllSeason")}</button>
        </span>
      </div>
      {/* #1925: puljen er en drop-zone — slip en rytter her for at fjerne ham fra hans løb. */}
      <div
        className={`flex flex-wrap items-start gap-2 p-3 transition-colors ${dragOver ? "bg-cz-accent/10" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onDropRider?.(e.dataTransfer.getData("text/plain")); }}
      >
        {roster.map((r) => {
          const locked = isLocked(r.id);
          // #1984: låst chip kan stadig klikkes → popoveren forklarer HVORFOR (overlappende løb).
          // Lås-grunden vises også inline (ikke kun som hover-titel), så det er synligt med det samme.
          // #2256: er lås-grunden et løb UDEN FOR brættet (ekstern binding), står navnet på
          // binding-entry'en i stedet for i en kolonne.
          const externalName = (bindingMap?.[r.id] || []).find((e) => e.name)?.name ?? null;
          const boundRace = locked ? (raceByRider.get(r.id) ?? externalName) : null;
          return (
            <div key={r.id} className="relative flex flex-col items-start gap-0.5">
              <button
                type="button"
                disabled={busy}
                draggable={!locked && !busy}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", encodeDrag({ riderId: r.id, fromRaceId: null }))}
                title={boundRace ? t("racehub.boundNamed", { race: boundRace }) : undefined}
                onClick={() => setOpenRiderId(openRiderId === r.id ? null : r.id)}
                className={`flex items-center gap-1 text-xs px-2.5 py-1 rounded-full border ${
                  locked
                    ? "border-dashed border-cz-border text-cz-3 opacity-60 hover:opacity-90"
                    : "border-cz-border bg-cz-card text-cz-1 hover:border-cz-accent/40"
                }`}
              >
                {locked && <LockIcon size={11} aria-hidden="true" />}
                {r.name} <span className="font-mono text-cz-3">{r.form ?? "—"}</span>
              </button>
              {boundRace && (
                <span className="pl-1.5 text-[9px] text-cz-3 flex items-center gap-1 max-w-[160px] truncate">
                  <LockIcon size={9} aria-hidden="true" />{t("racehub.boundNamed", { race: boundRace })}
                </span>
              )}
              {openRiderId === r.id && (
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
