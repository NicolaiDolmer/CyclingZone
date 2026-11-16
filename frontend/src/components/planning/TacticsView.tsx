// #7535 runde 3 · Taktik-visningen paa planlaegningssiden. Det ER loebssidens taktik-fane (RaceTacticsTab
// med etapeplanen StagePlanBoard, spec 2026-10-25-taktik-roller-design §11): samme endpoints, samme
// gem og samme validering. En plan lavet her staar paa loebssiden, og omvendt. Ingen ny formel, intet
// nyt skema. Etapen foelger ruteprofilen over visningen (pile og prikker), saa der kun er én etapevaelger.
//
// Taktikken bygger paa den GEMTE trup (serveren laeser holdets udtagelse). Har spilleren ugemte
// aendringer i truppen, siger visningen det, foer der saettes taktik paa en trup der ikke findes endnu.
// Fladen holder visningen monteret, naar spilleren skifter til Trup eller Formtop, saa en taktik-kladde
// overlever et visningsskift; et loebsskift med en kladde fanges af sidens bjaelke for ugemte aendringer.
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
  squadVersion,
  onShowSquad,
}: {
  /** Taeller op ved hvert gemt trup-skift, saa fanen henter den nye trup. */
  squadVersion: number;
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
    <div
      // Ruteprofilen staar allerede over visningen: fanens egen tynde profilraekke skjules (etapeplanens
      // profil med stigningsvalg bliver, den er en del af planen). Fanens kort faar ingen ekstra ramme.
      className="border-t border-cz-border [&_[data-testid=race-stage-profile-row].rounded-cz]:hidden [&_[data-testid=race-tactics-tab]]:rounded-none [&_[data-testid=race-tactics-tab]]:border-0"
      data-testid="planning-tactics"
    >
      {squadDirty && (
        <p className="border-b border-cz-border px-4 py-2 text-xs text-cz-warning" role="status">
          {t("tactics.squadUnsaved")}
        </p>
      )}
      {/* Mens truppen er ugemt, skjules fanen (den viser den gemte trup), men den forbliver monteret, saa
          en taktik-kladde ikke forsvinder. Et gem af truppen henter fanen paa ny (squadVersion). */}
      <div hidden={squadDirty}>
        <p className="border-b border-cz-border px-4 py-2 text-2xs leading-snug text-cz-3">{t("tactics.shared")}</p>
        <RaceTacticsTab
          key={`${raceId}:${squadVersion}`}
          raceId={raceId}
          profileByStage={profileByStage}
          stage={isStageRace ? stageNumber : null}
          hideStagePicker={isStageRace}
        />
      </div>
    </div>
  );
}
