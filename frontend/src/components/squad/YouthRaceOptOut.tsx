// #5944: "Enter races" / "Train only" på U23-/Junior-siden.
//
// Ejer-godkendt skitse 1/10 (docs/design/mockups-5944-youth-opt-out-2026-10-01):
//   1. Ét valg i sidehovedet: lille "Races"-etikette over en Segmented
//      (kanonisk kontrol: hairline, 5px, aktivt segment = guld-tekst på 10 %
//      guld, ingen udfyldt guld-knap). Mobil: fuld bredde under titlen.
//   2. En kort note mens truppen er sat til Train only, med link til Hjælp.
//   3. Kalenderen viser kommende ungdomsløb som "Not entered · training"
//      (YouthRacesTab).
import { Link } from "react-router";
import { useTranslation } from "react-i18next";
import { InfoIcon } from "../ui/index.js";
import { Segmented } from "./squadUi.ts";
import type { YouthRaceMode } from "./YouthRaceOptOutState.ts";
import type { YouthSquad } from "../../lib/youthSquadPages.ts";

interface ControlProps {
  trainOnly: boolean;
  saving: boolean;
  onChange: (mode: YouthRaceMode) => void;
  /** "header" = i PageHeader (sm og op); "mobile" = fuld bredde under titlen. */
  variant: "header" | "mobile";
}

export function YouthRaceOptOutControl({ trainOnly, saving, onChange, variant }: ControlProps) {
  const { t } = useTranslation("squad");
  const mobile = variant === "mobile";
  return (
    <div
      className={mobile ? "mb-4 flex flex-col gap-1.5 sm:hidden" : "hidden sm:flex flex-col items-end gap-1.5"}
      data-testid={`youth-race-opt-out-${variant}`}
    >
      <span className="text-2xs font-medium uppercase tracking-[0.06em] text-cz-3">{t("optOut.label")}</span>
      <Segmented
        label={t("optOut.label")}
        value={trainOnly ? "train_only" : "enter"}
        onChange={(next) => onChange(next as YouthRaceMode)}
        className={mobile ? "w-full [&>button]:flex-1" : ""}
        options={[
          { value: "enter", label: t("optOut.enter"), disabled: saving },
          { value: "train_only", label: t("optOut.trainOnly"), disabled: saving },
        ]}
      />
    </div>
  );
}

export function YouthRaceOptOutNote({ squad, effectiveFromDay }: { squad: YouthSquad; effectiveFromDay: number | null }) {
  const { t } = useTranslation("squad");
  return (
    <div
      role="status"
      data-testid="youth-race-opt-out-note"
      className="mb-5 flex items-start gap-2 rounded-cz border border-cz-warning/30 bg-cz-warning-bg/40 px-3 py-2.5 text-[13px] text-cz-2"
    >
      <InfoIcon size={14} aria-hidden="true" className="mt-[2px] shrink-0 text-cz-warning" />
      <p className="min-w-0 tabular-nums">
        <span className="font-medium text-cz-1">{t(`optOut.noteTitle.${squad}`)}</span>{" "}
        {t("optOut.noteBody")}
        {effectiveFromDay != null && <> {t("optOut.fromDay", { day: effectiveFromDay })}</>}{" "}
        <Link to="/help?section=youthSquads" className="underline hover:text-cz-1">{t("optOut.help")}</Link>
      </p>
    </div>
  );
}

export function YouthRaceOptOutError({ message }: { message: string }) {
  return <p role="alert" className="mb-4 text-[13px] text-cz-danger" data-testid="youth-race-opt-out-error">{message}</p>;
}
