import { useTranslation } from "react-i18next";
import { Section, SectionHeader } from "../../ui";
import { optionLabel } from "../../../lib/survey.js";
import { BarList, DayBars, StatTile, fmtInt, fmtNum, fmtPct } from "./surveyCharts.jsx";
import { questionByKey } from "./surveyLabels.js";

// #4943 · Overblik: svarprocent, svar over tid, tilfredshed og fog of war.
// Overblik FØRST (ejer-regel 2/9): første skærm svarer på "hvordan går det"
// uden scroll, og alt detaljeret bor i de øvrige faner.
export default function SurveyOverviewTab({ data }) {
  const { t, i18n } = useTranslation("admin");
  const language = i18n.language;
  const totals = data.totals;

  const satisfaction = questionByKey(data, "satisfaction");
  const fog = questionByKey(data, "fog_more");

  return (
    <div className="space-y-[14px]">
      <div className="grid grid-cols-2 gap-[14px] lg:grid-cols-4">
        <StatTile
          label={t("surveyResults.totals.invited")}
          value={fmtInt(totals.invited)}
          testId="survey-total-invited"
        />
        <StatTile
          label={t("surveyResults.totals.started")}
          value={fmtInt(totals.started)}
          sub={t("surveyResults.totals.ofInvited", { pct: fmtPct(totals.startedPct) })}
          testId="survey-total-started"
        />
        <StatTile
          label={t("surveyResults.totals.completed")}
          value={fmtInt(totals.completed)}
          sub={t("surveyResults.totals.ofStarted", { pct: fmtPct(totals.finishPct) })}
          testId="survey-total-completed"
        />
        <StatTile
          label={t("surveyResults.totals.avgMinutes")}
          value={totals.avgMinutes == null ? "—" : t("surveyResults.totals.minutes", { value: fmtNum(totals.avgMinutes) })}
          testId="survey-total-minutes"
        />
      </div>

      <Section>
        <SectionHeader title={t("surveyResults.overview.timeline")} meta={t("surveyResults.overview.timelineMeta")} />
        <DayBars
          data={data.timeline}
          label={t("surveyResults.overview.timeline")}
          emptyLabel={t("surveyResults.overview.timelineEmpty")}
        />
      </Section>

      <div className="grid gap-[14px] lg:grid-cols-2">
        <Section>
          <SectionHeader
            title={t("surveyResults.overview.satisfaction")}
            meta={satisfaction?.avg == null
              ? t("surveyResults.overview.answers", { n: 0 })
              : t("surveyResults.overview.average", { value: fmtNum(satisfaction.avg) })}
          />
          <BarList
            testId="survey-satisfaction"
            emptyLabel={t("surveyResults.overview.noAnswers")}
            items={(satisfaction?.distribution ?? []).map((step) => ({
              key: String(step.value),
              label: t("surveyResults.overview.scaleValue", { value: step.value }),
              value: step.count,
              valueLabel: fmtInt(step.count),
              meta: fmtPct(step.pct),
            }))}
          />
        </Section>

        <Section>
          <SectionHeader
            title={t("surveyResults.overview.fog")}
            meta={t("surveyResults.overview.answers", { n: fmtInt(fog?.n ?? 0) })}
          />
          <BarList
            testId="survey-fog"
            emptyLabel={t("surveyResults.overview.noAnswers")}
            items={(fog?.options ?? []).map((option) => ({
              key: option.key,
              label: optionLabel(option, language),
              value: option.count,
              valueLabel: fmtInt(option.count),
              meta: fmtPct(option.pct),
            }))}
          />
        </Section>
      </div>
    </div>
  );
}
