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
// #4323-opfølgning (akse-konvertering, seasonMatrix.js kontrakt #7, ejer-låst
// 27-28/8): hver kolonne tilhører nu ENTYDIGT ét løb, så popoveren tager
// `race` direkte (ikke længere en `candidates`-liste + løbsvælger — se
// seasonMatrix.js's fil-header for hvorfor den vælger blev overflødig).
//
// Låst løb (refutations-fund #4323, 27/8 — reproduceret empirisk, still
// gyldig efter akse-konverteringen): overlapper `race`s spænd rytterens
// eksisterende udtagelse et andet sted (conflictingEntryForRace,
// seasonMatrix.js), vises løbet låst med navngivet årsag i stedet for at
// kunne vælges tavst — den gamle bug lod rytteren ende i to overlappende løb
// på én gang, opdaget først af serverens deferred constraint ved gem.
// Årsagsteksten (`conflict` → seasonMatrix.js's raceLockLabel) er PRÆCIS
// samme i18n-nøgler som rytterpuljens #3410-fix (racehub.boundNamed/
// lockBoundUnnamed) — ikke en matrix-egen formulering (spillertest-punkt 2+3,
// Discord 29/8: den gamle tekst var utydelig subtekst under et forvirrende
// kandidat-navn; nu er årsagen selve popoverens hovedindhold).
import { useCallback, useLayoutEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useTranslation } from "react-i18next";
import { useModalA11y } from "../../hooks/useModalA11y.js";
import { riderSuitability } from "../../lib/suitability.js";
import { ROLE_LETTER, ROLE_ORDER, roleBadgeClass, raceLockLabel } from "../../lib/seasonMatrix.js";
import { LockIcon, CheckIcon, XIcon } from "../ui";
import FitBar from "./FitBar.jsx";

const GAP = 6;
const PANEL_WIDTH = 240;

export default function SeasonMatrixCellPopover({
  anchorEl, onClose, rider, race, fixed, currentRole, lockedReasonText, conflict, onSelectRole, onRemove,
}) {
  const { t } = useTranslation("races");
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
  if (!race && !lockedReasonText) return null;

  const ariaLabel = lockedReasonText
    ? lockedReasonText
    : fixed
      ? t("matrix.cellFilledAria", { rider: rider.name, race: race.name, role: t(`tacticsOrders.roleLabel.${currentRole}`) })
      : t("matrix.cellEmptyAria", { rider: rider.name, race: race.name });

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
            <p className="truncate text-3xs text-cz-3">{race.name}</p>
          </div>

          {/* Løbet er selv låst (kontrakt #6, spillertest-punkt 2+3): overlapper
              dets spænd rytterens EKSISTERENDE udtagelse et andet sted, vises
              årsagen HER — som popoverens hovedindhold, ikke skjult som
              undertekst under et forvirrende kandidat-navn (den gamle bug,
              Discord 29/8) — i stedet for rollevalget; der er intet lovligt
              rollevalg at tilbyde. Samme i18n-nøgler som rytterpuljens
              #3410-fix (raceLockLabel, seasonMatrix.js), ikke en matrix-egen
              formulering. */}
          {conflict ? (
            <p className="flex items-start gap-1.5 rounded-cz bg-cz-subtle px-2 py-1.5 text-xs text-cz-1">
              <LockIcon size={13} className="mt-0.5 shrink-0 text-cz-3" aria-hidden="true" />
              <span>{raceLockLabel(conflict, t)}</span>
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
                  onClick={() => onSelectRole(role)}
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
