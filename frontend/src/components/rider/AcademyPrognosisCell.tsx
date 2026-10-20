import { useTranslation } from "react-i18next";

export type AcademyPrognosis = {
  stage: string;
  nextStageDays: number | null;
  band: { lo: number; hi: number | null } | null;
};

export default function AcademyPrognosisCell({ prognosis }: { prognosis: AcademyPrognosis }) {
  const { t } = useTranslation("academy");
  const { stage, band, nextStageDays } = prognosis;
  // Kort på fladen (mobilens smalle kolonne); forklaringen og dage til næste
  // trin står i tooltip'en.
  const title = [
    t("prognosis.tooltip"),
    nextStageDays != null ? t(band ? "prognosis.nextDays" : "prognosis.learningDays", { days: nextStageDays }) : null,
  ].filter(Boolean).join(" ");
  if (!band) {
    return (
      <span className="flex flex-col leading-tight" title={title} data-testid="academy-prognosis-learning">
        <span className="text-xs text-cz-2">{t("prognosis.learning")}</span>
        {nextStageDays != null && (
          <span className="text-3xs text-cz-3 tabular-nums whitespace-nowrap">{t("prognosis.daysLeft", { days: nextStageDays })}</span>
        )}
      </span>
    );
  }
  return (
    <span className="flex flex-col leading-tight" title={title} data-testid="academy-prognosis-band">
      <span className="font-mono tabular-nums text-[13px] text-cz-1">{band.lo}–{band.hi}</span>
      <span className="text-3xs text-cz-3 whitespace-nowrap">{t(`prognosis.${stage}`)}</span>
    </span>
  );
}
