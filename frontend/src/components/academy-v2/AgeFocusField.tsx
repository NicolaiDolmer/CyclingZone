// #8081 / #6944 (skitse B fra PR #8185, ejervalg 16/11): aldersfokus som fjerde felt i
// akademiets profil. Ét valg: Blandet eller 16, 17, 18, 19. Gemmes med profilens Gem-knap og
// virker efter samme 14 dage. Ingen fordeling i tal eller ord: vægtningen af ugens kandidater
// er motor/balance og er ikke bygget endnu (kontakten tændes først, når den er).
import { useTranslation } from "react-i18next";
import { Segmented } from "../squad/squadUi.ts";
import { labelClass } from "../ui/fieldStyles.js";
import { AGE_FOCUS_MIXED, AGE_FOCUS_OPTIONS } from "./academyV2Model.ts";

export default function AgeFocusField({ value, onChange }: { value: string; onChange: (next: string) => void }) {
  const { t } = useTranslation("academy");
  const options = AGE_FOCUS_OPTIONS.map((v) => ({ value: v, label: v === AGE_FOCUS_MIXED ? t("v2.age.mixed") : v }));
  return (
    <div className="flex flex-col" data-testid="academy-age-focus">
      <span className={labelClass()}>{t("v2.age.label")}</span>
      <Segmented label={t("v2.age.label")} value={value} onChange={onChange} options={options} className="self-start" />
      {/* A3: hjælpelinjerne i --text-2 (kontrast >= 4,5:1 på kortet). */}
      <p className="mt-1.5 text-xs text-cz-2">{t("v2.age.intro")}</p>
      <p className="mt-0.5 text-xs text-cz-2">{t("v2.age.toU23")}</p>
    </div>
  );
}
