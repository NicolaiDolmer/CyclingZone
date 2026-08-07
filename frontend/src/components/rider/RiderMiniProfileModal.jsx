// RiderMiniProfileModal — #3520 (spillerforslag): holdudtagelsens navneklik åbner nu
// en rytterprofil-popup i stedet for at (dobbelt-)fungere som vælger. Checkboxen er
// eneste vælger (RaceSelectionPanel); denne modal er ren visning og ændrer ALDRIG
// udtagelsen — den læser kun de felter RaceSelectionPanel allerede har hentet
// (ingen ny API-kilde, #1747/#3115/#2637-feltsættet: type, form, træthed, aggression,
// tactics, rute-fit). Kan lukkes med Escape eller klik udenfor (useModalA11y).
//
// T3-hero-anatomi i mini-format (docs/design/PAGE_TEMPLATES.md): foto-slot + Bebas-
// navn + type-badge (metadata under navnet) + stat-række (label uppercase / value
// data-font tabular) + 2px guld-keyline på kortets top-kant. På mobil (<640px) er
// panelet en fuld-skærms sheet (edge-to-edge, ingen ramme) — ejer-AC.
import { useTranslation } from "react-i18next";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import Portal from "../ui/Portal.jsx";
import { XIcon } from "../ui/index.js";
import RiderTypeBadge from "./RiderTypeBadge.jsx";
import FitBar from "../racehub/FitBar.jsx";
import { effectiveStageFit } from "../../lib/lineupInsight.js";

function StatBlock({ label, value }) {
  return (
    <div className="min-w-0">
      <p className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3 mb-1">{label}</p>
      <div className="font-data text-[20px] font-[650] leading-tight text-cz-1 tabular-nums">{value ?? "—"}</div>
    </div>
  );
}

export default function RiderMiniProfileModal({ rider, selectedStageIndex = null, bound = null, fitLabel, onClose }) {
  const { t } = useTranslation(["races", "common"]);
  const active = Boolean(rider);
  const ref = useModalA11y(active ? onClose : null, active);
  if (!rider) return null;

  const fitScore = effectiveStageFit(rider, selectedStageIndex);
  const initials = rider.name
    ? rider.name.split(" ").filter(Boolean).map((p) => p[0]).slice(0, 2).join("").toUpperCase()
    : "";

  return (
    <Portal>
      <div className="fixed inset-0 z-modal flex items-center justify-center p-0 sm:p-4">
        <div className="absolute inset-0 bg-black/60" aria-hidden="true" onClick={onClose} />
        <div
          ref={ref}
          tabIndex={-1}
          role="dialog"
          aria-modal="true"
          aria-labelledby="rider-mini-profile-title"
          data-testid="rider-mini-profile-modal"
          className="relative w-full h-full sm:h-auto sm:w-full sm:max-w-md sm:max-h-[calc(100dvh-2rem)]
            bg-cz-card border-t-2 border-t-cz-accent sm:border sm:border-cz-border sm:rounded-cz
            overflow-y-auto outline-none"
        >
          <button
            type="button"
            onClick={onClose}
            aria-label={t("common:actions.close")}
            className="absolute right-3 top-3 inline-flex h-9 w-9 items-center justify-center rounded-cz text-cz-3 transition-colors hover:bg-cz-subtle hover:text-cz-1"
          >
            <XIcon size={18} aria-hidden="true" />
          </button>

          <div className="px-5 py-6 sm:p-6">
            <div className="flex items-start gap-4">
              <div
                aria-hidden="true"
                className="mt-1 w-16 h-16 flex-none bg-cz-subtle border border-cz-border rounded-cz flex items-center justify-center"
              >
                <span className="font-display text-2xl leading-none text-cz-2">{initials}</span>
              </div>
              <div className="min-w-0 pr-8">
                <h2 id="rider-mini-profile-title" className="font-display text-[28px] leading-[.92] uppercase text-cz-1 break-words">
                  {rider.name}
                </h2>
                <div className="flex items-center gap-2 mt-2 flex-wrap">
                  {rider.primaryType && <RiderTypeBadge primaryType={rider.primaryType} secondaryType={rider.secondaryType} size="md" />}
                  {rider.injured && (
                    <span className="text-3xs px-2 py-0.5 rounded-full bg-cz-danger/10 text-cz-danger border border-cz-danger/20">
                      {t("selection.injured")}
                    </span>
                  )}
                  {bound && (
                    <span className="text-3xs px-2 py-0.5 rounded-full border bg-cz-subtle text-cz-3 border-cz-border whitespace-nowrap">
                      {t("selection.boundIn", { race: bound.bound_race_name ?? "" })}
                    </span>
                  )}
                </div>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-x-6 gap-y-4 mt-5 pt-4 border-t border-cz-border">
              <div className="min-w-0">
                <p className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3 mb-1">{fitLabel}</p>
                <FitBar score={fitScore} />
              </div>
              <StatBlock label={t("selection.form")} value={rider.form} />
              <StatBlock label={t("selection.fatigue")} value={rider.fatigue} />
              <StatBlock label={t("selection.riderProfile.aggression")} value={rider.aggression} />
              <StatBlock label={t("selection.riderProfile.tactics")} value={rider.tactics} />
            </div>

            <p className="mt-5 pt-4 border-t border-cz-border text-2xs text-cz-3 leading-snug">
              {t("selection.riderProfile.hint")}
            </p>
          </div>
        </div>
      </div>
    </Portal>
  );
}
