// #7535 runde 3 · Taktik-visningen paa planlaegningssiden. Det ER loebssidens taktik-fane (RaceTacticsTab
// med etapeplanen StagePlanBoard, spec 2026-10-25-taktik-roller-design §11): samme endpoints, samme
// gem og samme validering. En plan lavet her staar paa loebssiden, og omvendt. Ingen ny formel, intet
// nyt skema. Etapen foelger ruteprofilen over visningen (pile og prikker), saa der kun er én etapevaelger.
//
// Taktikken bygger paa den GEMTE trup (serveren laeser holdets udtagelse). Har spilleren ugemte
// aendringer i truppen, siger visningen det, foer der saettes taktik paa en trup der ikke findes endnu.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { RaceTacticsTab, Button } from "./primitives.ts";
import type { StageProfileRow } from "../../lib/planningWorkbenchData.ts";

export default function TacticsView({
  raceId,
  profiles,
  stageIndex,
  isStageRace,
  squadDirty,
  savedCount,
  onShowSquad,
}: {
  raceId: string;
  profiles: StageProfileRow[];
  /** Etapen ruteprofilen viser (0-baseret). */
  stageIndex: number;
  isStageRace: boolean;
  squadDirty: boolean;
  /** Antal ryttere i den gemte trup. */
  savedCount: number;
  onShowSquad: () => void;
}) {
  const { t } = useTranslation("planning");
  const profileByStage = useMemo(() => {
    const out: Record<number, StageProfileRow> = {};
    for (const p of profiles) out[Number(p.stage_number ?? 1)] = p;
    return out;
  }, [profiles]);
  const stageNumber = Number(profiles[stageIndex]?.stage_number ?? stageIndex + 1);

  if (savedCount === 0) {
    return (
      <div className="border-t border-cz-border px-4 py-5" data-testid="planning-tactics-empty">
        <p className="text-sm font-semibold text-cz-1">{t("tactics.noSquad.title")}</p>
        <p className="mt-0.5 text-xs text-cz-2">{t("tactics.noSquad.description")}</p>
        <Button variant="secondary" size="sm" className="mt-3" onClick={onShowSquad}>
          {t("views.squad")}
        </Button>
      </div>
    );
  }

  return (
    <div className="border-t border-cz-border" data-testid="planning-tactics">
      {squadDirty && (
        <p className="border-b border-cz-border px-4 py-2 text-xs text-cz-warning" role="status">
          {t("tactics.squadUnsaved")}
        </p>
      )}
      <p className="border-b border-cz-border px-4 py-2 text-2xs leading-snug text-cz-3">{t("tactics.shared")}</p>
      <RaceTacticsTab
        key={raceId}
        raceId={raceId}
        profileByStage={profileByStage}
        stage={isStageRace ? stageNumber : null}
        hideStagePicker={isStageRace}
      />
    </div>
  );
}
