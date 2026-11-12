// #7778 · Ruteprofilen i højre kolonne (layout B) med fast højde (valg 3).
// Samme tegning som resten af løbssiden (StageProfileGraph, P19), tegnet i den
// bredde kolonnen faktisk har, så tekst og stigninger aldrig skaleres.
import { useTranslation } from "react-i18next";
import { useMeasuredWidth } from "../stagePageV2/StageProfileV2.tsx";
import { Section, SectionHeader } from "../stagePageV2/ui.ts";
import type { StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { StageProfileGraph } from "./v6Ui.ts";

/** Fast højde, så listen ved siden af ikke hopper, når profilen tegnes. */
export const V6_PROFILE_HEIGHT = 150;

export default function V6RouteProfile({ id, profile, hasClassifications }: { id: string; profile: StageProfile; hasClassifications: boolean }) {
  const { t } = useTranslation("races");
  const [ref, width] = useMeasuredWidth<HTMLDivElement>();
  return (
    <div id={id} data-race-section="route">
      <Section aria-label={t("racePageV6.route.profileTitle")}>
        <SectionHeader title={t("racePageV6.route.profileTitle")} />
        <div ref={ref} className="h-[150px] min-w-0">
          {width > 0 && (
            <StageProfileGraph
              profile={profile}
              tier="compact"
              width={Math.round(width)}
              height={V6_PROFILE_HEIGHT}
              heightClass="h-[150px]"
              uid={`v6-${profile.stage_number ?? 1}`}
              hasClassifications={hasClassifications}
            />
          )}
        </div>
      </Section>
    </div>
  );
}
