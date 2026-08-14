// FocusPanel — fokus-vælgeren som panel (#3721, ejer-godkendt 16/8).
//
// Erstatter <select>'en begge steder man vælger fokus: /training-rosterets
// fokus-celle og rytterprofilens Træning-fane. Ét sted, én komponent, så de to
// flader ikke kan komme til at sige forskellige ting om samme rytter.
//
// HVORFOR PANEL OG IKKE SELECT (den bærende beslutning i #3721):
// <select>'en bar allerede fire signaler i 184 px — fokussets navn, et
// trænbarheds-mærke klistret ind i option-teksten (som klippede: "Threshold /
// TT (X very lir"), en to-linjers chip under cellen, og assistentens hint.
// Trin 2 lægger et syvende fokus i den. Trin 4 (spec §5.2) lægger point pr.
// sæson pr. fokus i den. Et panel har en række pr. fokus og kan tage en
// kolonne mere hver gang der kommer en; en <select> kan ikke.
//
// Kolonnerne er derfor bevidst DATASTYREDE (se lib/trainingFocus.js):
// signal-kolonnen findes kun når rytteren har mindst ét fokus med en påstand,
// og point-pr-sæson-kolonnen findes først når trin 4 (#3741) leverer tallene.
// En tom kolonne ser ud som om noget mangler, så den renderes ikke.
//
// Panelet ejer IKKE noget state der overlever lukning: draft'en nulstilles ved
// hver åbning, så "Fortryd" altid er sandt.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TRAINING_INTENSITIES, TRAINING_SETBACK_PCT } from "../../lib/training.js";
import { focusPanelRows, hasAnySignal, hasAnyPerSeason, FOCUS_SIGNAL } from "../../lib/trainingFocus.js";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import RiderBadges from "../rider/RiderBadges.jsx";
import { Modal, Button } from "../ui";

// Signal-mærket. `strong` er den eneste positive påstand vi kan stå inde for
// før trin 4; `none` renderer bevidst ingenting (se focusSignal-kommentaren).
//
// BEVIDST STILLE, ikke en farvet pille. `strength` er sand for 305 af 384 målte
// type-kombinationer (79 %), så et grønt stempel ville stå på de fleste rækker
// i de fleste paneler og bære næsten ingen information. Mærket er derfor en
// fodnote i tekst-vægt: det er kontrasten til de rækker der IKKE har det, der
// er signalet. Når trin 4 (#3741) fylder point-pr-sæson-kolonnen, er det tallet
// der bærer beslutningen, og dette mærke kan forsvinde helt.
function SignalMark({ signal, t }) {
  if (signal === FOCUS_SIGNAL.STRONG) {
    return (
      <span
        className="font-data text-3xs font-semibold uppercase tracking-[.07em] text-cz-2"
        title={t("focusPanel.signalStrongTitle")}
      >
        {t("focusPanel.signalStrong")}
      </span>
    );
  }
  if (signal === FOCUS_SIGNAL.WEAK) {
    return (
      <span
        className="font-data text-3xs font-semibold uppercase tracking-[.07em] text-cz-3"
        title={t("focusPanel.signalWeakTitle")}
      >
        {t("focusPanel.signalWeak")}
      </span>
    );
  }
  return <span className="text-cz-3" aria-hidden="true">—</span>;
}

export default function FocusPanel({
  open,
  onClose,
  rider = null,
  badges = [],
  focus = null,
  intensity = "normal",
  trainability = null,
  assistantFocus = null,
  perSeason,
  saving = false,
  error = null,
  onSave,
  onClear,
}) {
  const { t } = useTranslation("training");
  const tRider = useTranslation("rider").t;
  const riderName = rider ? `${rider.firstname} ${rider.lastname}` : "";

  const [draftFocus, setDraftFocus] = useState(focus);
  const [draftIntensity, setDraftIntensity] = useState(intensity);

  // Nulstil draft'en hver gang panelet åbnes, så "Fortryd" er sandt og et
  // panel der åbnes for rytter B ikke bærer rytter A's ugemte valg med sig.
  useEffect(() => {
    if (open) {
      setDraftFocus(focus);
      setDraftIntensity(intensity);
    }
  }, [open, focus, intensity]);

  const rows = focusPanelRows({ trainability, activeFocus: draftFocus, assistantFocus, perSeason });
  const showSignal = hasAnySignal(rows);
  const showPerSeason = hasAnyPerSeason(rows);
  const risk = TRAINING_SETBACK_PCT[draftIntensity] ?? 0;
  const dirty = draftFocus !== focus || draftIntensity !== intensity;

  // Kolonne-skabelonen er datastyret, så den kan ikke være en statisk Tailwind-
  // klasse. Den leveres som CSS-variabel og bruges KUN fra sm og op; under sm
  // stabler rækken i to kolonner (prik + indhold) via en almindelig klasse, så
  // en inline-style aldrig skal overstyres med !important.
  const cols = ["18px", "minmax(96px,1fr)", "minmax(0,1.6fr)"];
  if (showPerSeason) cols.push("minmax(96px,auto)");
  if (showSignal) cols.push("minmax(72px,auto)");
  const gridStyle = { "--focus-cols": cols.join(" ") };
  const gridClass = "grid grid-cols-[18px_minmax(0,1fr)] sm:grid-cols-[var(--focus-cols)]";

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t("focusPanel.title", { name: riderName })}
      // Ejer-krav 16/8: rytterens type og status skal bruge de SAMME
      // komponenter som resten af siden, ikke en tekst-streng bygget her.
      // RiderTypeBadge/RiderBadges returnerer selv null uden data.
      description={
        rider ? (
          <span className="flex flex-wrap items-center gap-1.5">
            <RiderTypeBadge primaryType={rider.primary_type} secondaryType={rider.secondary_type} />
            <RiderBadges badges={badges} />
          </span>
        ) : undefined
      }
      closeLabel={t("focusPanel.close")}
      footer={
        <div className="flex w-full flex-wrap items-center gap-3">
          <span className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
            {tRider("training.intensity")}
          </span>
          <div
            role="group"
            aria-label={tRider("training.intensity")}
            className="inline-flex overflow-hidden rounded-cz border border-cz-border"
          >
            {TRAINING_INTENSITIES.map((key) => (
              <button
                key={key}
                type="button"
                disabled={saving || !draftFocus}
                aria-pressed={draftIntensity === key && !!draftFocus}
                onClick={() => setDraftIntensity(key)}
                className={`px-2.5 py-1 text-xs transition-colors disabled:opacity-40 ${
                  draftIntensity === key && draftFocus
                    ? "bg-cz-accent text-cz-on-accent font-semibold"
                    : "text-cz-2 hover:bg-cz-subtle"
                }`}
              >
                {tRider(`training.intensity_${key}`)}
              </button>
            ))}
          </div>
          {/* Risikoen hører til et VALGT fokus. Uden et valg er intensiteten
              deaktiveret, og en risiko-procent ville beskrive noget der ikke
              sker endnu. */}
          {draftFocus && (
            <span className="text-2xs text-cz-2">
              {risk > 0 ? t("focusPanel.risk", { risk }) : t("focusPanel.noRisk")}
            </span>
          )}

          <div className="ms-auto flex items-center gap-2">
            {focus && (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClear}>
                {t("focusPanel.clear")}
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onClose}>
              {t("focusPanel.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={saving || !draftFocus || !dirty}
              onClick={() => onSave(draftFocus, draftIntensity)}
            >
              {saving ? t("loading") : t("focusPanel.save")}
            </Button>
          </div>
        </div>
      }
    >
      {error && (
        <div role="alert" className="mb-3 rounded-cz border border-cz-danger/30 bg-cz-danger/10 px-3 py-2 text-2xs text-cz-danger">
          {t([`planActionError_${error}`, "planActionErrorGeneric"])}
        </div>
      )}

      <div role="radiogroup" aria-label={t("focusPanel.title", { name: riderName })}>
        <div
          className={`${gridClass} items-center gap-2.5 border-b border-cz-border pb-2 font-data text-3xs font-semibold uppercase tracking-[.07em] text-cz-3 max-sm:hidden`}
          style={gridStyle}
        >
          <span aria-hidden="true" />
          <span>{t("focusPanel.colFocus")}</span>
          <span>{t("focusPanel.colTrains")}</span>
          {showPerSeason && <span>{t("focusPanel.colPerSeason")}</span>}
          {showSignal && <span>{t("focusPanel.colSignal")}</span>}
        </div>

        {rows.map((row) => (
          <button
            key={row.focus}
            type="button"
            role="radio"
            aria-checked={row.active}
            disabled={saving}
            onClick={() => setDraftFocus(row.focus)}
            className={`${gridClass} w-full items-center gap-x-2.5 gap-y-1 border-b border-cz-border py-2.5 text-start transition-colors disabled:opacity-50
              ${row.active ? "bg-cz-accent/10" : "hover:bg-cz-subtle"}`}
            style={gridStyle}
          >
            <span
              aria-hidden="true"
              className={`inline-block h-3 w-3 rounded-cz-pill border ${
                row.active ? "border-cz-accent bg-cz-accent" : "border-cz-3"
              }`}
            />
            <span className="min-w-0">
              <span className={`block truncate text-[13px] ${row.active ? "font-semibold text-cz-1" : "text-cz-1"}`}>
                {tRider(`training.focus_${row.focus}`)}
              </span>
              {row.isAssistantDefault && (
                <span className="mt-0.5 block font-data text-3xs uppercase tracking-[.06em] text-cz-3">
                  {t("focusPanel.assistantPicks")}
                </span>
              )}
            </span>
            <span className="min-w-0 text-2xs text-cz-2 max-sm:col-start-2">
              {row.abilities.map((a) => tRider(`racePreview.derived.${a}`)).join(" · ")}
            </span>
            {showPerSeason && (
              <span className="font-data text-2xs tabular-nums text-cz-1 max-sm:col-start-2">
                {row.abilities
                  .map((a) => (row.perSeason?.[a] != null ? `+${Number(row.perSeason[a]).toFixed(1)}` : "—"))
                  .join(" ")}
              </span>
            )}
            {showSignal && (
              <span className="max-sm:col-start-2">
                <SignalMark signal={row.signal} t={t} />
              </span>
            )}
          </button>
        ))}
      </div>

      <p className="mt-3 text-2xs leading-snug text-cz-2">{t("focusPanel.note")}</p>
    </Modal>
  );
}
