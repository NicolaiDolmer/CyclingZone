// FocusPanel — dagstype først, session derefter (#3762, ejer-besluttet 14/8).
//
// Panelet hed engang det samme som det valgte: et fokus. Det gør det ikke
// længere. Man vælger nu HVAD DET ER FOR EN DAG (hvile · aktiv restitution ·
// færdighedsdag · træning) og derefter hvilken session der findes på den dag.
//
// HVORFOR MODELLEN BLEV VENDT OM (målt mod prod 14/8, 4.588 planer):
// fokus og intensitet var to frie akser, 6 × 4 = 24 kombinationer, og mindst en
// tredjedel af dem var meningsløse. 623 planer (13,6 %) stod på fokus + hvile,
// hvor motoren giver 0 vækst for ALLE evner — spilleren havde valgt et fokus,
// siden gemte det uden indvending, og motoren ignorerede det hver eneste dag.
// Yderligere ~5 % stod på fysiologiske selvmodsigelser (hård udholdenhed, let
// sprint). Nu findes de kombinationer ikke: intensiteten er ikke et valg
// ovenpå, den er en EGENSKAB ved sessionen.
//
// Sessionerne og deres niveauer kommer fra lib/trainingDayTypes.js, som er
// spejlet af backendens egen liste og vogtet af en drift-vagt. Panelet opfinder
// intet selv — det tegner det serveren vil acceptere.
//
// Kolonnerne er stadig datastyrede (se lib/trainingFocus.js): signal-kolonnen
// findes kun når rytteren har mindst ét fokus med en påstand, og
// point-pr-sæson-kolonnen først når trin 4's tal er wiret ind. En tom kolonne
// ser ud som om noget mangler, så den renderes ikke.
//
// Panelet ejer IKKE state der overlever lukning: draft'en nulstilles ved hver
// åbning, så "Fortryd" altid er sandt.

import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { TRAINING_SETBACK_PCT } from "../../lib/training.js";
import {
  DAY_TYPES,
  DAY_TYPES_WITHOUT_SESSION,
  SESSION_INTENSITY,
  dayTypeForProgram,
  sessionForProgram,
  sessionGroupsForDayType,
} from "../../lib/trainingDayTypes.js";
import { focusPanelRows, hasAnySignal, hasAnyPerSeason, FOCUS_SIGNAL } from "../../lib/trainingFocus.js";
import RiderTypeBadge from "../rider/RiderTypeBadge.jsx";
import RiderBadges from "../rider/RiderBadges.jsx";
import { Modal, Button } from "../ui";

// Signal-mærket. `strong` er den eneste positive påstand vi kan stå inde for;
// `none` renderer bevidst ingenting (se focusSignal-kommentaren i libbet).
//
// BEVIDST STILLE, ikke en farvet pille. `strength` er sand for 305 af 384 målte
// type-kombinationer (79 %), så et grønt stempel ville stå på de fleste rækker
// i de fleste paneler og bære næsten ingen information. Det er kontrasten til
// de rækker der IKKE har det, der er signalet.
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

  // Den gemte plan oversættes til modellen ved åbning. En umigreret plan (fx
  // `endurance` + hård) vises derfor som dét den ER under den nye model, ikke
  // som en tilstand der ikke findes. Samme funktion som serveren migrerer med.
  const savedProgram = focus ? { focus, intensity } : null;
  const savedDayType = savedProgram ? dayTypeForProgram(savedProgram) : null;
  const savedSession = savedProgram ? sessionForProgram(savedProgram) : null;

  const [draftDayType, setDraftDayType] = useState(savedDayType);
  const [draftSession, setDraftSession] = useState(savedSession);

  useEffect(() => {
    if (open) {
      setDraftDayType(savedDayType);
      setDraftSession(savedSession);
    }
    // savedDayType/savedSession er udledt af focus+intensity; de er med som
    // deps for at panelet følger med hvis planen ændrer sig mens det er åbent.
  }, [open, savedDayType, savedSession]);

  const needsSession = draftDayType != null && !DAY_TYPES_WITHOUT_SESSION.includes(draftDayType);
  const groups = sessionGroupsForDayType(draftDayType);

  // Rækkerne bygges kun for de sessioner den valgte dagstype tilbyder, men
  // signal/point-kolonnerne skal afgøres af HELE panelet — ellers kan en
  // kolonne komme og gå mens man klikker rundt mellem dagstyper.
  const allRows = focusPanelRows({ trainability, activeFocus: draftSession, assistantFocus, perSeason });
  const rowByFocus = new Map(allRows.map((row) => [row.focus, row]));
  const showSignal = hasAnySignal(allRows);
  const showPerSeason = hasAnyPerSeason(allRows);

  const chosenIntensity = needsSession && draftSession ? SESSION_INTENSITY[draftSession] : null;
  const risk = chosenIntensity ? (TRAINING_SETBACK_PCT[chosenIntensity] ?? 0) : 0;

  const complete = draftDayType != null && (!needsSession || draftSession != null);
  const dirty = draftDayType !== savedDayType || draftSession !== savedSession;

  const cols = ["18px", "minmax(96px,1fr)", "minmax(0,1.6fr)"];
  if (showPerSeason) cols.push("minmax(96px,auto)");
  if (showSignal) cols.push("minmax(72px,auto)");
  const gridStyle = { "--focus-cols": cols.join(" ") };
  const gridClass = "grid grid-cols-[18px_minmax(0,1fr)] sm:grid-cols-[var(--focus-cols)]";

  // Når dagstypen skifter, må sessionen ikke blive hængende fra den forrige:
  // "Sprint" er ikke et gyldigt valg på en færdighedsdag. Vi vælger heller ikke
  // en for spilleren — trin 2 står tomt, og Gem er deaktiveret indtil han vælger.
  function chooseDayType(dayType) {
    setDraftDayType(dayType);
    const sessions = sessionGroupsForDayType(dayType).flatMap((g) => g.sessions);
    setDraftSession(sessions.includes(draftSession) ? draftSession : null);
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      size="lg"
      title={t("dayPanel.title", { name: riderName })}
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
          {/* Risikoen hører til en valgt session. Uden et valg ville en
              risiko-procent beskrive noget der ikke sker endnu. */}
          {complete && needsSession && (
            <span className="text-2xs text-cz-2">
              {risk > 0 ? t("focusPanel.risk", { risk }) : t("focusPanel.noRisk")}
            </span>
          )}

          <div className="ms-auto flex items-center gap-2">
            {focus && (
              <Button type="button" variant="ghost" size="sm" disabled={saving} onClick={onClear}>
                {t("dayPanel.clear")}
              </Button>
            )}
            <Button type="button" variant="secondary" size="sm" disabled={saving} onClick={onClose}>
              {t("focusPanel.cancel")}
            </Button>
            <Button
              type="button"
              variant="primary"
              size="sm"
              disabled={saving || !complete || !dirty}
              onClick={() => onSave(draftDayType, needsSession ? draftSession : null)}
            >
              {saving ? t("loading") : t("dayPanel.save")}
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

      <p className="mb-2 font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
        {t("dayPanel.step1")}
      </p>
      <div role="radiogroup" aria-label={t("dayPanel.step1")} className="grid gap-2 sm:grid-cols-2">
        {DAY_TYPES.map((dayType) => {
          const active = dayType === draftDayType;
          return (
            <button
              key={dayType}
              type="button"
              role="radio"
              aria-checked={active}
              // Det tilgængelige navn er DAGEN. Uden det bliver navnet
              // "RestFatigue drops the most…" — beskrivelsen hører til
              // beskrivelsen, ikke til navnet (og en skærmlæser skal kunne
              // sige "Hvile, valgt" uden at læse hele noten op).
              aria-label={t(`dayPanel.dayType_${dayType}`)}
              disabled={saving}
              onClick={() => chooseDayType(dayType)}
              className={`rounded-cz border px-3 py-2 text-start transition-colors disabled:opacity-50
                ${active ? "border-cz-accent bg-cz-accent/10" : "border-cz-border hover:bg-cz-subtle"}`}
            >
              <span className={`block text-[13px] ${active ? "font-semibold text-cz-1" : "text-cz-1"}`}>
                {t(`dayPanel.dayType_${dayType}`)}
              </span>
              <span className="mt-0.5 block text-2xs leading-snug text-cz-2">
                {t(`dayPanel.dayTypeNote_${dayType}`)}
              </span>
            </button>
          );
        })}
      </div>

      {draftDayType && !needsSession && (
        <p className="mt-4 border-t border-cz-border pt-3 text-2xs leading-snug text-cz-2">
          {t(`dayPanel.noSession_${draftDayType}`)}
        </p>
      )}

      {needsSession && (
        <>
          <p className="mb-2 mt-5 font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3">
            {t("dayPanel.step2")}
          </p>
          <div
            className={`${gridClass} items-center gap-2.5 border-b border-cz-border pb-2 font-data text-3xs font-semibold uppercase tracking-[.07em] text-cz-3 max-sm:hidden`}
            style={gridStyle}
          >
            <span aria-hidden="true" />
            <span>{t("dayPanel.colSession")}</span>
            <span>{t("focusPanel.colTrains")}</span>
            {showPerSeason && <span>{t("focusPanel.colPerSeason")}</span>}
            {showSignal && <span>{t("focusPanel.colSignal")}</span>}
          </div>

          <div role="radiogroup" aria-label={t("dayPanel.step2")}>
            {groups.map((group) => (
              <div key={group.level ?? "skill"}>
                {/* Niveauet er en overskrift, ikke et valg. Det er hele pointen:
                    "intervaller er hårde" er ikke længere noget spilleren skal
                    vide og kunne modsige — det er indbygget i sessionen. */}
                {group.level && (
                  <p className="mt-3 font-data text-3xs uppercase tracking-[.07em] text-cz-3">
                    {t(`dayPanel.level_${group.level}`)}
                  </p>
                )}
                {group.sessions.map((session) => {
                  const row = rowByFocus.get(session);
                  if (!row) return null;
                  const active = session === draftSession;
                  return (
                    <button
                      key={session}
                      type="button"
                      role="radio"
                      aria-checked={active}
                      disabled={saving}
                      onClick={() => setDraftSession(session)}
                      className={`${gridClass} w-full items-center gap-x-2.5 gap-y-1 border-b border-cz-border py-2.5 text-start transition-colors disabled:opacity-50
                        ${active ? "bg-cz-accent/10" : "hover:bg-cz-subtle"}`}
                      style={gridStyle}
                    >
                      <span
                        aria-hidden="true"
                        className={`inline-block h-3 w-3 rounded-cz-pill border ${
                          active ? "border-cz-accent bg-cz-accent" : "border-cz-3"
                        }`}
                      />
                      <span className="min-w-0">
                        <span className={`block truncate text-[13px] ${active ? "font-semibold text-cz-1" : "text-cz-1"}`}>
                          {t(`dayPanel.session_${session}`)}
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
                  );
                })}
              </div>
            ))}
          </div>
        </>
      )}

      <p className="mt-3 text-2xs leading-snug text-cz-2">{t("dayPanel.note")}</p>
    </Modal>
  );
}
