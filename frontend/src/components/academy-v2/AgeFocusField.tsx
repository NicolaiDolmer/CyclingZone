// #8081 / #6944 (skitse B fra PR #8185, ejervalg 16/11): aldersfokus som fjerde felt i
// akademiets profil. Ét valg: Blandet eller 16, 17, 18, 19. Gemmes med profilens Gem-knap og
// virker efter samme 14 dage.
//
// Skitse A: under valget står fordelingen pr. alder i ORD (mange / nogle / få) og den trup
// alderen lander på, og den følger det valgte fokus. Aldrig tal, vægte eller procenter: de
// hører til motorbyggeriet (vægtningen af ugens kandidater er ikke bygget endnu, og kontakten
// tændes først, når den er).
import { useTranslation } from "react-i18next";
import { Segmented } from "../squad/squadUi.ts";
import { labelClass } from "../ui/fieldStyles.js";
import { AGE_FOCUS_MIXED, AGE_FOCUS_OPTIONS, ageFocusDistribution } from "./academyV2Model.ts";

export default function AgeFocusField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation(["academy", "academyV2"]);
  const options = AGE_FOCUS_OPTIONS.map((v) => ({ value: v, label: v === AGE_FOCUS_MIXED ? t("academyV2:v2.age.mixed") : v }));
  const distribution = ageFocusDistribution(value);
  return (
    <div className="flex flex-col" data-testid="academy-age-focus">
      <span className={labelClass()}>{t("academyV2:v2.age.label")}</span>
      <Segmented label={t("academyV2:v2.age.label")} value={value} onChange={onChange} options={options} className="self-start" />
      <ul
        className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-data text-2xs tabular-nums text-cz-2"
        aria-label={t("academyV2:v2.age.distributionLabel")}
        data-testid="academy-age-distribution"
      >
        {distribution.map((row) => (
          <li key={row.age} className={row.share === "many" ? "font-semibold text-cz-1" : undefined}>
            {t("academyV2:v2.age.row", { age: row.age, share: t(`academyV2:v2.age.share.${row.share}`) })}
            <span className="font-normal text-cz-2"> · {t(`academyV2:v2.squad.${row.squad}`)}</span>
          </li>
        ))}
      </ul>
      {/* A3: hjælpelinjerne i --text-2 (kontrast >= 4,5:1 på kortet). */}
      <p className="mt-1.5 text-xs text-cz-2">{t("academyV2:v2.age.intro")}</p>
      <p className="mt-0.5 text-xs text-cz-2">{t("academyV2:v2.age.toU23")}</p>
    </div>
  );
}
