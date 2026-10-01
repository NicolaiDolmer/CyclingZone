// FatigueRuleSummary — traethedsgraensen som EEN linje i Today-fanens overblik
// (#5932, ejer-godkendt mockup 1/10, pin 8). Intet nyt kort: linjen staar i
// den eksisterende resume-raekke over rytterlisten, saa reglen kan ses uden at
// skifte fane. "Edit" aabner under-fanen Fatigue limit.
//
// Tallet "i dag" er antallet af ryttere over deres graense paa traethed efter
// seneste opgoerelse, samme stige som motoren (FatigueRuleModel.effectiveLimit).
import { useTranslation } from "react-i18next";
import { ChevronRightIcon } from "../ui/icons/index.jsx";
import { isFallback, isThreshold, ridersOverLimit, type FatigueRulesResponse } from "./FatigueRuleModel.ts";

export default function FatigueRuleSummary({
  data,
  onEdit,
}: {
  data: FatigueRulesResponse | null;
  onEdit: () => void;
}) {
  const { t } = useTranslation("training");
  if (!data?.enabled) return null;
  const team = data.team ?? null;
  const limitOn = !!team && isThreshold(team.threshold) && isFallback(team.fallback);
  const afterStage = team?.recoveryAfterStage === true;
  const riders = data.riders ?? {};
  const hasExceptions = Object.keys(riders).length > 0;
  const count = ridersOverLimit(data.roster ?? [], team, riders);
  const isSet = limitOn || afterStage || hasExceptions;

  const rule = limitOn
    ? t("fatigueRule.summaryRule", { threshold: team!.threshold, fallback: t(`fatigueRule.fallback_${team!.fallback}`) })
    : afterStage
      ? t("fatigueRule.summaryAfterStage")
      : hasExceptions
        ? t("fatigueRule.summaryExceptionsOnly")
        : t("fatigueRule.summaryOff");

  return (
    <div
      className="flex min-w-0 items-center justify-between gap-3 border-t border-cz-border px-4 py-2 text-xs"
      data-testid="fatigue-rule-summary"
    >
      <span className="min-w-0 truncate text-cz-2">
        <b className="font-semibold text-cz-1">{t("fatigueRule.title")}</b>
        {" · "}{rule}
        {isSet && (
          <>
            {" · "}
            <b className="font-semibold tabular-nums text-cz-1">{t("fatigueRule.summaryToday", { count })}</b>
          </>
        )}
      </span>
      <button
        type="button"
        onClick={onEdit}
        className="inline-flex min-h-11 flex-none items-center gap-0.5 font-medium text-cz-accent-t hover:underline sm:min-h-0"
        data-testid="fatigue-rule-summary-edit"
      >
        {isSet ? t("fatigueRule.summaryEdit") : t("fatigueRule.summarySet")}
        <ChevronRightIcon size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
