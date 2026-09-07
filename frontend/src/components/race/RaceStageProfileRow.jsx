import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import StageProfileGraph from "./StageProfileGraph.jsx";
import TerrainTypeGlyph from "./TerrainTypeGlyph.jsx";
import { hasRouteData, waypointsFor } from "../../lib/stageRouteProfile.js";
import { profileLabelKey } from "../../lib/stageProfileConfig.js";
import { formatNumber } from "../../lib/intl.js";

// #4979 (spillerønske thelamba/egomadsen 7/9, ejer-skitseret): etapeprofilen i
// EN tynd række lige under fanelinjen, over fanens kort — i Taktik- og Hold-
// fanen. Man skulle før over i Etaper-fanen for at se hvad man overhovedet
// satte taktik til.
//
// EN ad gangen: rækken viser præcis den etape fanen handler om (Taktik: den
// åbne etape i vælgeren; Hold: den aktuelle/næste, samme som hero'ens
// "Stage N locks"). Ingen thumbnail-stribe, ingen anden profil på samme skærm —
// Etaper-fanen har sin egen fulde profil (StageDetailPanel), og de to faner er
// aldrig synlige samtidig, så TASTE P2's "profilen tegnes tre gange"-fund
// gentages ikke.
//
// Tynd og uden sektionsoverskrift (fold-disciplin, PAGE_TEMPLATES): ét kort med
// hairline + 5 px radius, en meta-linje i mikro-typografi og grafen i compact
// tier. Ingen knapper, ingen guld, intet at klikke på.
//
// Uden rutedata renderer den INTET (samme gate som StageProfileCard) — ingen
// syntetisk profil, og fanen står som før.
export default function RaceStageProfileRow({ profile, stageLabel = null, hasClassifications = true }) {
  const { t } = useTranslation("races");
  const climbCount = useMemo(
    () => waypointsFor(profile).filter((w) => w.kind === "kom").length,
    [profile],
  );
  if (!profile || !hasRouteData(profile)) return null;

  const terrainKey = profileLabelKey(profile.profile_type);
  const stageNumber = profile.stage_number ?? 1;

  return (
    <div
      data-testid="race-stage-profile-row"
      className="bg-cz-card border border-cz-border rounded-cz px-4 pt-2.5 pb-2"
    >
      <div className="flex items-baseline justify-between gap-3 flex-wrap">
        <p className="text-cz-2 text-3xs uppercase tracking-wider font-semibold inline-flex items-center gap-1.5">
          <TerrainTypeGlyph profileType={profile.profile_type} size={12} />
          {stageLabel ? `${stageLabel} · ` : ""}
          {terrainKey ? t(`detail.${terrainKey}`) : ""}
        </p>
        {/* Tallene er de SAMME tre som etape-kortets stat-linje, i mikro-format:
            distance, højdemeter, antal stigninger. Ingen nye ord, ingen nye tal. */}
        <p className="font-data text-3xs uppercase tracking-wider text-cz-3 tabular-nums">
          {formatNumber(profile.distance_km)} {t("detail.route.stats.km")}
          {profile.elevation_gain_m > 0 && ` · ${formatNumber(profile.elevation_gain_m)} ${t("detail.route.stats.elevation")}`}
          {climbCount > 0 && ` · ${climbCount} ${t("detail.route.stats.climbs")}`}
        </p>
      </div>
      <StageProfileGraph
        profile={profile}
        tier="compact"
        width={900}
        height={150}
        uid={`race-row-${stageNumber}`}
        hasClassifications={hasClassifications}
      />
    </div>
  );
}
