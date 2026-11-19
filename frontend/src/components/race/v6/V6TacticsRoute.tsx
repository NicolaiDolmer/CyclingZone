// Taktik-fanens rute på løbssiden v6 (ejer 18/11: "tjek at ruten på taktik-fanen er den rigtige").
// Samme farvede rute som Etape-fanen og wireframe v6c (V6Route), med km, stigning og antal stigninger
// i overskriften. Erstatter den gamle profil (StageProfileCard), som taktik-editoren ellers tegner.
import { useTranslation } from "react-i18next";
import { formatNumber } from "../../../lib/intl.js";
import { sortedClimbs, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";
import { Section } from "../stagePageV2/ui.ts";
import V6Route from "./V6Route.tsx";

export default function V6TacticsRoute({ profile }: { profile: StageProfile }) {
  const { t } = useTranslation("races");
  const km = formatNumber(Math.round(Number(profile.distance_km) || 0));
  const gain = formatNumber(Math.round(Number(profile.elevation_gain_m) || 0));
  const climbs = sortedClimbs(profile).length;
  return (
    <div data-race-section="tactics-route" className="mb-[14px]">
      <Section aria-label={t("racePageV6.route.aria")}>
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1">
          <h2 className="m-0 text-[15px] font-semibold text-cz-1">{t("racePageV6.route.profileTitle")}</h2>
          <span className="font-data text-xs tabular-nums text-cz-3">
            {t("racePageV6.route.km", { km })} · {t("racePageV6.route.gain", { gain })} · {t("racePageV6.route.climbs", { count: climbs })}
          </span>
        </div>
        <div className="mt-3"><V6Route profile={profile} /></div>
      </Section>
    </div>
  );
}
