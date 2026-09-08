import { useTranslation } from "react-i18next";
import { Section, SectionHeader } from "../../ui";
import { optionLabel } from "../../../lib/survey.js";
import { BarList, fmtInt, fmtNum } from "./surveyCharts.jsx";
import { questionByKey, segmentLabel } from "./surveyLabels.js";

// #4943 · Segmenter: den samme tilfredshed og de samme idéer, delt op efter
// division, sprog eller aktivitet. Vælgeren står i sidehovedet og gælder ALLE
// faner; denne fane er der hvor opdelingen er selve pointen.
//
// Under tre svar vises intet indhold, kun en linje der siger hvorfor
// (MIN_SEGMENT_N i backend/lib/surveyResults.js). Et gennemsnit af to svar er
// et tal man kan læse forkert, ikke et segment.
export default function SurveySegmentsTab({ data }) {
  const { t, i18n } = useTranslation("admin");
  const language = i18n.language;

  if (!data.segment) {
    return <p className="text-[13px] text-cz-2" data-testid="survey-segments-hint">{t("surveyResults.segments.pick")}</p>;
  }

  const satisfaction = questionByKey(data, "satisfaction");
  const axes = questionByKey(data, "feature_axes");
  const satisfactionBySegment = new Map((satisfaction?.bySegment ?? []).map((b) => [b.segment, b]));
  const axesBySegment = new Map((axes?.bySegment ?? []).map((b) => [b.segment, b]));
  const optionByKey = new Map((axes?.options ?? []).map((option) => [option.key, option]));

  const segments = data.segmentValues ?? [];
  if (segments.length === 0) {
    return <p className="text-[13px] text-cz-2">{t("surveyResults.segments.empty")}</p>;
  }

  return (
    <div className="space-y-[14px]">
      <Section>
        <SectionHeader title={t("surveyResults.segments.satisfaction")} />
        <BarList
          testId="survey-segment-satisfaction"
          max={5}
          emptyLabel={t("surveyResults.segments.empty")}
          items={segments.map((segment) => {
            const bucket = satisfactionBySegment.get(segment.segment);
            return {
              key: segment.segment,
              label: segmentLabel(t, segment.segment),
              value: bucket?.avg ?? 0,
              valueLabel: fmtNum(bucket?.avg ?? null, 2),
              meta: t("surveyResults.segment.respondents", { n: fmtInt(segment.started) }),
            };
          })}
        />
      </Section>

      <div className="grid gap-[14px] lg:grid-cols-2">
        {segments.map((segment) => {
          const bucket = axesBySegment.get(segment.segment);
          const top = (bucket?.options ?? []).slice(0, 5);
          return (
            <Section key={segment.segment}>
              <SectionHeader
                title={`${t("surveyResults.segments.topIdeas")}: ${segmentLabel(t, segment.segment)}`}
                meta={t("surveyResults.segment.respondents", { n: fmtInt(segment.started) })}
              />
              {top.length === 0 ? (
                <p className="text-[13px] text-cz-3">{t("surveyResults.segments.tooFew")}</p>
              ) : (
                <BarList
                  max={25}
                  items={top.map((option) => ({
                    key: option.key,
                    label: optionLabel(optionByKey.get(option.key) ?? { label_en: option.key, label_da: option.key }, language),
                    value: option.priority ?? 0,
                    valueLabel: fmtNum(option.priority, 2),
                    meta: `n ${fmtInt(option.n)}`,
                  }))}
                />
              )}
            </Section>
          );
        })}
      </div>
    </div>
  );
}
