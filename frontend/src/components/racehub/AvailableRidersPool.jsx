// Race Hub Fase 1 — "ledige ryttere"-pulje. Hele truppen som en liste; en 16px lodret
// glyf-rende FOR navnet viser dagens tilstand (#4259: koerer / blokeret / skadet), saa
// signalet altid staar ved samme x-position uanset navnelaengde. Klik en fri/koerende
// raekke → smart popover. Auto-udfyld er to-tilstands (#1823 D1): "Udfyld manglende"
// (bevarer manuelle) eller "Genopbyg alt" (overskriver alt).
// #2599: "Genopbyg alt" (den gamle mode=all-overskrivning der selv fyldte bredt ud med
// nye AI-forslag) er erstattet af en eksplicit "Ryd dag"-knap — rydder til TOM i stedet
// for at gætte for spilleren. "Ryd alt" (season-bred) er tilføjet ved siden af. Begge
// kræver en bekræftelses-dialog (onClearSquad i RaceHubBoard).
import { useState } from "react";
import { useTranslation } from "react-i18next";
import AddRiderPopover from "./AddRiderPopover.jsx";
import { LockIcon, CheckIcon, AlertTriangleIcon } from "../ui";
import { encodeDrag } from "../../lib/raceHubDnd.js";
import { overlapConflictColumn, riderDayState } from "../../lib/raceHubLogic.js";

export default function AvailableRidersPool({ roster, columns, bindingMap, seasonLoadByRider = {}, dayClearImpact = null, onAddRiderToRace, onRegenerate, onClearSquad, busy, onDropRider }) {
  const { t } = useTranslation("races");
  const [openRiderId, setOpenRiderId] = useState(null);
  const [dragOver, setDragOver] = useState(false); // #1925: pulje-drop-zone (fjern rytter ved drop)
  // Hvilket løb kører rytteren (til "riding"-årsagen)? Første ikke-afmeldte kolonne han er i.
  const raceByRider = new Map();
  for (const c of columns) {
    if (c.withdrawn) continue;
    for (const id of c.selection?.rider_ids || []) if (!raceByRider.has(id)) raceByRider.set(id, c.name);
  }
  // #4259: én dags-tilstand pr. rytter (out/riding/free/blocked), rullet op over ALLE
  // dagens kolonner af riderDayState — erstatter den grovere isLocked-boolean der kollapsede
  // fire tilstande til én hængelås og derfor intet tegnede på en dag med to ikke-overlappende løb.
  const stateOf = (rider) => riderDayState({ rider, columns, bindingMap });
  // Årsags-opslag (spec §4): out → skadet; riding → løbsnavn; blocked → navngivet
  // overlap-løb, ELLER "dagen lukket" hvis intet navn men noget er afmeldt/låst, ELLER ukendt.
  const reasonFor = (rider, state) => {
    if (state === "out") return t("racehub.day.injured");
    if (state === "riding") return null; // #4259 graft 9: flertals-tilstanden får ingen linje.
    if (state === "blocked") {
      const named = (() => {
        for (const c of columns) {
          const hit = overlapConflictColumn({ column: c, columns, bindingMap, riderId: rider.id })?.name;
          if (hit) return hit;
        }
        return bindingMap?.[rider.id]?.find((e) => e.name)?.name ?? null;
      })();
      if (named) return t("racehub.day.busyIn", { race: named });
      if (columns.some((c) => c.withdrawn || c.lineup_locked)) return t("racehub.day.dayClosed");
      return t("racehub.day.busyUnknown");
    }
    return null;
  };
  let free = 0, racing = 0, out = 0;
  for (const r of roster) {
    const s = stateOf(r);
    if (s === "free") free++;
    else if (s === "riding") racing++;
    else out++; // blocked + out betyder begge "kan ikke bruges i dag" (spec §5c).
  }
  const tally = [
    free > 0 && t("racehub.pool.tallyFree", { count: free }),
    racing > 0 && t("racehub.pool.tallyRacing", { count: racing }),
    out > 0 && t("racehub.pool.tallyOut", { count: out }),
  ].filter(Boolean).join(" · ");
  return (
    /* #2819: tour-anker — trin 2 i /races-rundvisningen peger på puljen. */
    <div data-tour="races-pool" className="border border-cz-border rounded-cz bg-cz-subtle">
      <div className="px-3 py-2 border-b border-cz-border flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-2xs uppercase tracking-wide text-cz-2">
          {t("racehub.pool.title", { count: roster.length })}
          {tally && <span className="font-data tabular-nums text-cz-3"> · {tally}</span>}
        </span>
        {/* #1919: "Auto-udfyld"-labelen var en død <span> (Clarity dead-clicks) — den er nu
            selve den primære knap (udfyld manglende), så begge handlinger er ægte knapper. */}
        <span className="flex items-center gap-1.5">
          <button type="button" onClick={() => onRegenerate("missing")} disabled={busy}
            className="text-2xs uppercase tracking-wide font-medium text-cz-accent-t hover:underline disabled:opacity-50">{t("racehub.pool.autofill")}</button>
          <span className="text-cz-border" aria-hidden="true">·</span>
          {/* #3428: "Ryd dag" rammer ALLE overlappende løb vist på boardet lige nu — uklart
              før. Tooltip navngiver præcis hvor mange løb/ryttere den rydder. */}
          <button type="button" onClick={() => onClearSquad?.("day")} disabled={busy || dayClearImpact?.races === 0}
            title={dayClearImpact ? t("racehub.pool.clearDayTooltip", dayClearImpact) : undefined}
            className="text-xs text-cz-3 hover:text-cz-1 hover:underline disabled:opacity-50">{t("racehub.pool.clearDay")}</button>
          <span className="text-cz-border" aria-hidden="true">·</span>
          <button type="button" onClick={() => onClearSquad?.("all")} disabled={busy}
            className="text-xs text-cz-3 hover:text-cz-1 hover:underline disabled:opacity-50">{t("racehub.pool.clearAllSeason")}</button>
        </span>
      </div>
      {/* #1925: puljen er en drop-zone — slip en rytter her for at fjerne ham fra hans løb. */}
      <div
        className={`grid grid-cols-1 sm:grid-cols-[repeat(auto-fill,minmax(210px,1fr))] sm:gap-x-4 -mt-px transition-colors ${dragOver ? "bg-cz-accent/10" : ""}`}
        onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => { e.preventDefault(); setDragOver(false); onDropRider?.(e.dataTransfer.getData("text/plain")); }}
      >
        {roster.map((r) => {
          const state = stateOf(r);
          const reason = reasonFor(r, state);
          const load = seasonLoadByRider[r.id] ?? null;
          return (
            <div key={r.id} className="relative">
              <button
                type="button"
                disabled={busy}
                draggable={(state === "free" || state === "riding") && !busy}
                onDragStart={(e) => e.dataTransfer.setData("text/plain", encodeDrag({ riderId: r.id, fromRaceId: null }))}
                onClick={() => setOpenRiderId(openRiderId === r.id ? null : r.id)}
                title={reason ?? undefined}
                aria-label={state === "free" ? r.name : t("racehub.day.riderAria", { name: r.name, state: reason })}
                className="w-full flex items-start gap-2 px-3 py-1.5 min-h-[32px] text-left border-t border-cz-border hover:bg-cz-subtle disabled:opacity-50"
              >
                {/* RENDEN — 16px, fast, altid til stede før navnet (#4259 spec §2). */}
                <span className="w-4 shrink-0 flex items-center justify-center pt-px" aria-hidden="true">
                  {state === "out" && <AlertTriangleIcon size={11} className="text-cz-danger" />}
                  {state === "riding" && <CheckIcon size={11} className="text-cz-2" />}
                  {state === "blocked" && <LockIcon size={11} className="text-cz-3" />}
                </span>
                <span className="min-w-0 flex-1">
                  <span className={`block text-[13px] leading-[18px] truncate ${state === "blocked" || state === "out" ? "text-cz-3" : "text-cz-1"}`}
                        title={r.name}>
                    {r.name}
                  </span>
                  {reason && state !== "riding" && (
                    <span className={`block font-data text-3xs uppercase tracking-[.05em] truncate ${state === "out" ? "text-cz-danger" : "text-cz-3"}`}>{reason}</span>
                  )}
                </span>
                <span className="w-6 shrink-0 pt-px text-end font-data text-2xs tabular-nums text-cz-2">{r.form ?? ""}</span>
                <span className="w-7 shrink-0 pt-0.5 text-end font-data text-3xs tabular-nums text-cz-3"
                      title={load?.raceDays > 0 ? t("racehub.pool.loadTitle", { races: load.races, days: load.raceDays }) : undefined}>
                  {load?.raceDays > 0 ? t("racehub.pool.loadShort", { days: load.raceDays }) : ""}
                </span>
              </button>
              {openRiderId === r.id && (
                <AddRiderPopover rider={r} columns={columns} bindingMap={bindingMap}
                  onPick={(raceId) => onAddRiderToRace(raceId, r.id)} onClose={() => setOpenRiderId(null)} />
              )}
            </div>
          );
        })}
      </div>
      <p className="px-3 pt-1.5 pb-2 text-3xs text-cz-3 flex flex-wrap items-center gap-x-1.5 gap-y-0.5">
        <CheckIcon size={10} aria-hidden="true" /> {t("racehub.day.legendRacing")}
        <span className="text-cz-border" aria-hidden="true">·</span>
        <LockIcon size={10} aria-hidden="true" /> {t("racehub.day.legendBlocked")}
        <span className="text-cz-border" aria-hidden="true">·</span>
        <AlertTriangleIcon size={10} className="text-cz-danger" aria-hidden="true" /> {t("racehub.day.injured")}
      </p>
    </div>
  );
}
