import { useTranslation } from "react-i18next";
import SurveyPicksTab from "./SurveyPicksTab.jsx";
import SurveyTextTab from "./SurveyTextTab.jsx";

// #4943 · Pro samlet ét sted: hvad der hører hjemme i Pro, om de ville betale
// for netop det, og hvad der skal holdes UDE. De tre spørgsmål læses altid
// sammen, og et "ja" til at betale betyder ikke det samme uden listen ved siden af.
export default function SurveyProTab({ data }) {
  const { t } = useTranslation("admin");

  return (
    <div className="space-y-[14px]">
      <div className="grid gap-[14px] lg:grid-cols-2">
        <SurveyPicksTab
          data={data}
          questionKey="pro_contents"
          title={t("surveyResults.pro.contents")}
          testId="survey-pro-contents"
        />
        <SurveyPicksTab
          data={data}
          questionKey="pro_would_pay"
          title={t("surveyResults.pro.wouldPay")}
          testId="survey-pro-would-pay"
        />
      </div>
      <div>
        <h2 className="mb-2 text-[15px] font-semibold text-cz-1">{t("surveyResults.pro.exclusions")}</h2>
        <SurveyTextTab data={data} questionKeys={["pro_exclusions"]} />
      </div>
    </div>
  );
}
