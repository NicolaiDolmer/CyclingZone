import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { profileShape } from "../../lib/stageProfileConfig.js";
import { hasRouteData } from "../../lib/stageRouteProfile.js";
import { stageAxes, decisiveClimb, dayDemands } from "../../lib/stageAxes";
import StageProfileCard from "./StageProfileCard.jsx";
import StageAxesStrip from "./StageAxesStrip";
import StageDecidedDemands from "./StageDecidedDemands";

// Valgt-etape-panel for et KOMMENDE loeb: ETAPEKORTET (#6364, S5-spec §6). Ét kort pr.
// etape: de tre akser (terraen, afslutning, underlag) hver for sig, profilen EN gang med
// den afgoerende stigning markeret, "her afgoeres etapen" og "dagen kraever" som
// hoej/mid/lav. Erstatter den gamle ene etiket + finale-pille + terraen-DNA-stribe.
// Akserne laeses af etapens raekke via lib/stageAxes.ts (spejl af backendens legacy-
// mapping), saa S1-S4-etaper vises korrekt. Ukendt terraen -> null (graceful, som
// StageProfileCard).
//
// #4628 (audit 2026-09 raekke #4): profilen findes praecis eet sted paa fladen. Panelet
// bruger StageProfileCard's krop direkte (`asCard={false}`).
//
// #2810 (ejer-fund fra Sub-4, PR #2790): den KOMMENDE etape - der hvor man
// planlaegger - faar `tier="full"`, saa hver stignings navn, laengde og gradient
// kan aflaeses mens man udtager. Den KOERTE etape faar `tier="compact"` (se
// RaceDetailPage's StageProfileSlot); foer var det stik modsat.
// Route-reads som "her afgoeres etapen" allerede siger: bjergtop, og nedkoersel efter den
// sidste stigning. Er der ingen afgoerende stigning, beholdes alle reads.
const NO_READS = [];
const READS_COVERED_BY_SUMMIT = ["summit"];
const READS_COVERED_BY_DESCENT = ["valley"];

export default function StageDetailPanel({
  profile,
  stageLabel,
  passages = [],
  tier = "full",
  hasClassifications = true,
}) {
  const { t } = useTranslation("races");
  const axes = useMemo(() => stageAxes(profile), [profile]);
  const decisive = useMemo(() => decisiveClimb(profile), [profile]);
  const demands = useMemo(() => dayDemands(profile?.demand_vector), [profile]);
  if (!axes) return null;
  const { points } = profileShape(profile.profile_type);
  const routed = hasRouteData(profile);

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      {routed ? (
        // Sub-4 (#2448): aegte rute i stedet for kategori-piktogrammet — grafen
        // tegner selv maalflag, stignings-etiketter og waypoint-markoerer.
        <StageProfileCard
          profile={profile}
          stageLabel={stageLabel}
          passages={passages}
          tier={tier}
          hasClassifications={hasClassifications}
          asCard={false}
          beforeGraph={<StageAxesStrip axes={axes} />}
          decisiveCrestKm={decisive ? decisive.crestKm : null}
          hideReads={!decisive ? NO_READS : decisive.summit ? READS_COVERED_BY_SUMMIT : decisive.isLast ? READS_COVERED_BY_DESCENT : NO_READS}
        />
      ) : (
        <>
          {stageLabel && (
            <p className="text-cz-3 text-3xs uppercase tracking-wider font-semibold border-b border-cz-border pb-2">
              {stageLabel}
            </p>
          )}
          <StageAxesStrip axes={axes} />
          <div className="relative mt-3">
            <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="w-full h-24 block text-cz-1" aria-hidden="true">
              <polyline points={`${points} 100,24 0,24`} fill="currentColor" fillOpacity="0.06" stroke="none" />
              <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
            </svg>
            {/* Maalflag ved maalet (hoejre ende). Forklaringen af afslutningen (#2756)
                bor i akse-feltet ovenfor som tooltip, saa flaget er rent dekorativt. */}
            <span className="absolute -top-0.5 right-0 text-cz-accent-t" aria-hidden="true">
              <svg width="14" height="14" viewBox="0 0 14 14">
                <path d="M3 1 V13" stroke="currentColor" strokeWidth="1.5" />
                <path d="M3.6 1.5 L11 3.2 L7 5 L11 6.8 L3.6 5" fill="currentColor" fillOpacity="0.85" />
              </svg>
            </span>
          </div>
        </>
      )}
      <StageDecidedDemands decisive={routed ? decisive : null} demands={demands} finish={axes.finish} />
      {/* #4628 (TASTE P9, "kort paa fladen"): noten forklarer det INDIKATIVE
          terraen-piktogram. Har etapen aegte rutedata, er kategorien ikke laengere
          et skoen, og linjen er ren prosa paa en flade der skal vaere kort. */}
      {!routed && <p className="text-cz-3 text-2xs mt-2">{t("detail.stageProfile.note")}</p>}
    </div>
  );
}
