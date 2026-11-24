import { useTranslation } from "react-i18next";
import { Segmented } from "../squad/squadUi.ts";
import { labelClass } from "../ui/fieldStyles.js";
import { AGE_FOCUS_MIXED, AGE_FOCUS_OPTIONS } from "./academyV2Model.ts";

export default function AgeFocusField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation(["academy", "academyV2"]);
  const options = AGE_FOCUS_OPTIONS.map((v) => ({ value: v, label: v === AGE_FOCUS_MIXED ? t("academyV2:v2.age.mixed") : v }));
  return (
    <div className="flex flex-col" data-testid="academy-age-focus">
      <span className={labelClass()}>{t("academyV2:v2.age.label")}</span>
      <Segmented label={t("academyV2:v2.age.label")} value={value} onChange={onChange} options={options} className="self-start" />
      {/* A3: hjælpelinjerne i --text-2 (kontrast >= 4,5:1 på kortet). */}
      <p className="mt-1.5 text-xs text-cz-2">{t("academyV2:v2.age.intro")}</p>
    </div>
  );
}
