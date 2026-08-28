// Sæsonmatrix — celle-popover (#4323, ejer-beslutning 27/8). Erstatter den
// blinde klik-cyklus (klik -> C->S->H->F->D uden forklaring, som ejeren fandt
// uforstaaelig) med en klik-aabnet popover forankret ved cellen. Designforlaeg:
// spillerprototypens rolle-picker (frontend/public/race-planning-preview.html,
// openPicker) — position:fixed + portal, samme viewport-flip-matematik.
//
// Genbrug: positionerings-/dismiss-/fokus-mønsteret er LanguageSwitcher.jsx's
// (portal + fixed + reposition on resize/scroll + click-away mod anchor+panel).
// Fokus-trap/Escape/fokus-ind/fokus-retur er useModalA11y (samme hook Modal.jsx
// bruger) — ingen ny fokuslogik opfundet.
//
// Låst celle (readOnly — browser en anden sæson): viser KUN årsagen, samme
// tekst som SeasonView's read-only-banner (seasonView.readOnlyHint) — der
// findes ingen anden "hvorfor er cellen låst"-tekst i dag (ingen per-celle
// hviledag/binding-årsag i /races/selection/season-payloaden endnu).
//
// Låst KANDIDAT-løb (refutations-fund #4323, 27/8 — reproduceret empirisk):
// et løb i løbsvælgeren hvis spænd overlapper rytterens eksisterende
// udtagelse et andet sted (conflictingEntryForRace, seasonMatrix.js) vises
// låst med navngivet årsag (matrix.cellPopover.raceLocked) i stedet for at
// kunne vælges tavst — den gamle bug lod rytteren ende i to overlappende løb
// på én gang, opdaget først af serverens deferred constraint ved gem.
import { useCallback, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import { riderSuitability } from "../../lib/suitability.js";
import { ROLE_LETTER, ROLE_ORDER, roleBadgeClass } from "../../lib/seasonMatrix.js";
import { LockIcon, CheckIcon, XIcon } from "../ui";
import FitBar from "./FitBar.jsx";

const GAP = 6;
const PANEL_WIDTH = 240;

const NO_CONFLICTS = new Map();

export default function SeasonMatrixCellPopover({
  anchorEl, onClose, rider, candidates, fixed, currentRole, lockedReasonText, onSelectRole, onRemove,
  conflictsByRaceId = NO_CONFLICTS,
}) {
  const { t } = useTranslation("races");
  const [chosenRaceId, setChosenRaceId] = useState(candidates[0]?.id ?? null);
  const [coords, setCoords] = useState(null);
  const panelRef = useModalA11y(onClose, true);

  const reposition = useCallback(() => {
    const panel = panelRef.current;
    if (!anchorEl || !panel) return;
    const r = anchorEl.getBoundingClientRect();
    const panelRect = panel.getBoundingClientRect();
    const panelH = panelRect.height || 160;
    const panelW = panelRect.width || PANEL_WIDTH;
    const spaceBelow = window.innerHeight - r.bottom;
    const openUp = spaceBelow < panelH + GAP && r.top > spaceBelow;
    const left = Math.min(Math.max(GAP, r.left), window.innerWidth - panelW - GAP);
    setCoords({
      left,
      top: openUp ? null : r.bottom + GAP,
      bottom: openUp ? window.innerHeight - r.top + GAP : null,
    });
  }, [anchorEl, panelRef]);

  useLayoutEffect(() => {
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [reposition]);

  // Klik udenfor lukker (kontrakt #3) — sammenligner mod BÅDE ankeret (cellen)
  // og selve panelet, samme mønster som LanguageSwitcher.jsx. Escape + fokus-
  // trap/retur dækkes af useModalA11y ovenfor.
  useLayoutEffect(() => {
    const onPointer = (e) => {
      const inAnchor = anchorEl && anchorEl.contains(e.target);
      const inPanel = panelRef.current && panelRef.current.contains(e.target);
      if (!inAnchor && !inPanel) onClose();
    };
    document.addEventListener("mousedown", onPointer);
    return () => document.removeEventListener("mousedown", onPointer);
  }, [anchorEl, panelRef, onClose]);

  if (typeof document === "undefined" || !anchorEl) return null;

  const race = candidates.find((c) => c.id === chosenRaceId) ?? candidates[0];
  if (!race && !lockedReasonText) return null;

  const ariaLabel = lockedReasonText
    ? lockedReasonText
    : fixed
      ? t("matrix.cellFilledAria", { rider: rider.name, race: race.name, role: t(`tacticsOrders.roleLabel.${currentRole}`) })
      : t("matrix.cellEmptyAria", { rider: rider.name, race: race.name });

  // Refutations-fund #4323 (27/8): det VALGTE løb kan selv være låst (dets
  // spænd overlapper rytterens eksisterende udtagelse et andet sted) — da
  // vises årsagen i stedet for rollevalget, uanset om der var ét eller flere
  // kandidatløb at vælge imellem (kontrakt #6, conflictingEntryForRace).
  const conflict = !fixed ? conflictsByRaceId.get(race?.id) ?? null : null;

  const fit = !conflict && race?.demandVector && rider.abilities ? riderSuitability(rider.abilities, race.demandVector).score : null;

  return createPortal(
    <div
      ref={panelRef}
      role="dialog"
      aria-label={ariaLabel}
      tabIndex={-1}
      className="fixed z-overlay rounded-cz border border-cz-border bg-cz-elevated shadow-overlay p-2.5 outline-none"
      style={{
        width: PANEL_WIDTH,
        left: coords?.left ?? -9999,
        top: coords?.top ?? undefined,
        bottom: coords?.bottom ?? undefined,
        visibility: coords ? "visible" : "hidden",
      }}
    >
      {lockedReasonText ? (
        <p className="flex items-start gap-1.5 text-xs text-cz-3">
          <LockIcon size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
          <span>{lockedReasonText}</span>
        </p>
      ) : (
        <>
          <div className="mb-2 border-b border-cz-border pb-1.5">
            <p className="truncate text-xs font-semibold text-cz-1">{rider.name}</p>
            {(fixed || candidates.length === 1) && <p className="truncate text-3xs text-cz-3">{race.name}</p>}
          </div>

          {/* Løbsvalg (kontrakt 2a) — kun når dagen reelt har mere end ét
              valgbart løb (fx et endagsløb inde i et GT-spænd). Ét løb → ingen
              vælger, kun løbsnavnet i headeren ovenfor. */}
          {!fixed && candidates.length > 1 && (
            <div role="listbox" aria-label={t("matrix.cellPopover.raceChoice")} className="mb-2 flex flex-col gap-1">
              {candidates.map((c) => {
                const cConflict = conflictsByRaceId.get(c.id);
                if (cConflict) {
                  return (
                    <button
                      key={c.id}
                      type="button"
                      role="option"
                      aria-selected={false}
                      disabled
                      title={t("matrix.cellPopover.raceLocked", { race: cConflict.name })}
                      className="w-full cursor-not-allowed rounded-cz border border-transparent px-2 py-1 text-left text-cz-3 opacity-60"
                    >
                      <span className="flex items-center gap-1.5 truncate text-xs">
                        <LockIcon size={11} className="shrink-0" aria-hidden="true" />
                        <span className="truncate">{c.name}</span>
                      </span>
                      <span className="block truncate pl-[18px] text-3xs">{t("matrix.cellPopover.raceLocked", { race: cConflict.name })}</span>
                    </button>
                  );
                }
                return (
                  <button
                    key={c.id}
                    type="button"
                    role="option"
                    aria-selected={c.id === race.id}
                    onClick={() => setChosenRaceId(c.id)}
                    className={`w-full truncate rounded-cz border px-2 py-1 text-left text-xs transition-colors ${
                      c.id === race.id ? "border-cz-accent bg-cz-accent/10 text-cz-1" : "border-transparent text-cz-2 hover:bg-cz-subtle"
                    }`}
                  >
                    {c.name}
                  </button>
                );
              })}
            </div>
          )}

          {/* Det VALGTE løb er selv låst (kontrakt #6) — vis årsagen i stedet
              for rollevalget; der er intet lovligt rollevalg at tilbyde. */}
          {conflict ? (
            <p className="flex items-start gap-1.5 rounded-cz bg-cz-subtle px-2 py-1.5 text-xs text-cz-3">
              <LockIcon size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
              <span>{t("matrix.cellPopover.raceLocked", { race: conflict.name })}</span>
            </p>
          ) : (
            /* De fem roller, fulde navne (kontrakt 2b) — genbruger de eksisterende
               tacticsOrders.roleLabel-i18n-nøgler, ikke nye ord. */
            <div role="listbox" aria-label={t("matrix.cellPopover.roleChoice")} className="flex flex-col gap-1">
              {ROLE_ORDER.map((role) => (
                <button
                  key={role}
                  type="button"
                  role="option"
                  aria-selected={role === currentRole}
                  onClick={() => onSelectRole(race.id, role)}
                  className={`flex w-full items-center gap-2 rounded-cz border px-2 py-1.5 text-left transition-colors ${
                    role === currentRole ? "border-cz-accent bg-cz-accent/10" : "border-transparent hover:bg-cz-subtle"
                  }`}
                >
                  <span className={`inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-3xs font-semibold ${roleBadgeClass(role)}`}>
                    {ROLE_LETTER[role]}
                  </span>
                  <span className="flex-1 text-xs text-cz-1">{t(`tacticsOrders.roleLabel.${role}`)}</span>
                  {role === currentRole && <CheckIcon size={13} className="shrink-0 text-cz-accent-t" aria-hidden="true" />}
                </button>
              ))}
            </div>
          )}

          {/* Fjern fra løbet (kontrakt 2c) — kun når rytteren reelt er udtaget. */}
          {fixed && currentRole != null && (
            <button
              type="button"
              onClick={() => onRemove(race.id)}
              className="mt-1.5 flex w-full items-center gap-1.5 rounded-cz px-2 py-1.5 text-left text-xs text-cz-danger hover:bg-cz-danger/10"
            >
              <XIcon size={13} aria-hidden="true" />
              {t("matrix.cellPopover.remove")}
            </button>
          )}

          {/* Rute-match (kontrakt 2d) — samme FitBar-mønster som AddRiderPopover. */}
          {fit != null && (
            <div className="mt-2 flex items-center justify-between gap-2 border-t border-cz-border pt-2">
              <span className="text-3xs uppercase tracking-wide text-cz-3">{t("matrix.lens.routeMatch")}</span>
              <FitBar score={fit} />
            </div>
          )}
        </>
      )}
    </div>,
    document.body
  );
}
