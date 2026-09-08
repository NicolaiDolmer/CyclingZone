import { useTranslation } from "react-i18next";
import { Section, SectionHeader } from "../../ui";
import { optionLabel } from "../../../lib/survey.js";
import { BarList, fmtInt, fmtPct } from "./surveyCharts.jsx";
import { questionByKey } from "./surveyLabels.js";

// #4943 · Én bar-liste for et afkrydsnings- eller enkeltvalgs-spørgsmål.
// Genbruges af "Fungerer dårligst"-fanen og af Pro-fanen: de tre spørgsmål er
// den samme figur med forskellige valg, og tre kopier ville drifte fra hinanden.
export default function SurveyPicksTab({ data, questionKey, title, meta, emptyLabel, testId }) {
  const { t, i18n } = useTranslation("admin");
  const question = questionByKey(data, questionKey);
  const answered = question?.n ?? 0;

  return (
    <Section>
      <SectionHeader
        title={title}
        meta={meta ?? t("surveyResults.overview.answers", { n: fmtInt(answered) })}
      />
      <BarList
        testId={testId}
        emptyLabel={emptyLabel ?? t("surveyResults.overview.noAnswers")}
        items={(question?.options ?? []).map((option) => ({
          key: option.key,
          label: optionLabel(option, i18n.language),
          value: option.count,
          valueLabel: fmtInt(option.count),
          meta: fmtPct(option.pct),
        }))}
      />
    </Section>
  );
}
