import { useTranslation } from "react-i18next";
import { profileShape, profileLabelKey, finaleLabelKey } from "../../lib/stageProfileConfig.js";
import { hasRouteData, finaleFactorPct } from "../../lib/stageRouteProfile.js";
import StageProfileCard from "./StageProfileCard.jsx";
import TerrainDNABar from "./TerrainDNABar.jsx";
import Tooltip from "../ui/Tooltip.jsx";

// Valgt-etape-panel for et KOMMENDE loeb: ruten + finale-typen + terraen-DNA i
// EET kort. profile mangler/ukendt terraen → null (graceful, som StageProfileCard).
//
// #4628 (audit 2026-09 raekke #4): panelet tegnede FOER sin egen kopi af
// etapeprofilen (compact 430x150) og StageProfileCard tegnede den SAMME profil
// igen lige under, over holdudtagelsen. To grafer af samme etape = 1.754 px foer
// foerste rytterraekke. Nu bruger panelet StageProfileCard's krop direkte
// (`asCard={false}`), saa profilen findes praecis eet sted paa fladen.
//
// #2810 (ejer-fund fra Sub-4, PR #2790): den KOMMENDE etape - der hvor man
// planlaegger - faar `tier="full"`, saa hver stignings navn, laengde og gradient
// kan aflaeses mens man udtager. Den KOERTE etape faar `tier="compact"` (se
// RaceDetailPage's StageProfileSlot); foer var det stik modsat.
export default function StageDetailPanel({
  profile,
  stageLabel,
  passages = [],
  tier = "full",
  hasClassifications = true,
}) {
  const { t } = useTranslation("races");
  const labelKey = profile && profileLabelKey(profile.profile_type);
  if (!labelKey) return null;
  const finaleKey = finaleLabelKey(profile.finale_type);
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
        />
      ) : (
        <div className="relative">
          <svg viewBox="0 0 100 26" preserveAspectRatio="none" className="w-full h-24 block text-cz-1" aria-hidden="true">
            <polyline points={`${points} 100,24 0,24`} fill="currentColor" fillOpacity="0.06" stroke="none" />
            <polyline points={points} fill="none" stroke="currentColor" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeLinejoin="round" />
          </svg>
          {/* Finale-markoer ved maalet (hoejre ende). #2756: title viser FORKLARINGEN,
              ikke bare gentager label-teksten — "Breakaway" alene forklarede intet
              (Discord-feedback, thelamba 20/7). */}
          <span
            className="absolute -top-0.5 right-0 text-cz-accent-t"
            aria-hidden="true"
            title={finaleKey ? t(`detail.finaleTypeHint.${profile.finale_type}`) : ""}
          >
            <svg width="14" height="14" viewBox="0 0 14 14">
              <path d="M3 1 V13" stroke="currentColor" strokeWidth="1.5" />
              <path d="M3.6 1.5 L11 3.2 L7 5 L11 6.8 L3.6 5" fill="currentColor" fillOpacity="0.85" />
            </svg>
          </span>
        </div>
      )}
      <div className="flex items-center justify-between mt-2 gap-2 flex-wrap">
        {/* #4628: etape-nummeret staar allerede i graf-kortets overskrift naar
            ruten findes — gentag det ikke her (PAGE_TEMPLATES: "Nothing appears
            twice"). Uden rutedata er denne linje eneste sted det staar. */}
        <p className="text-cz-1 text-sm font-semibold">
          {!routed && stageLabel && <span className="text-cz-3 font-normal me-1.5">{stageLabel} ·</span>}
          {t(`detail.${labelKey}`)}
        </p>
        {/* #2756: uforklarede stage-ending-typer ("Summit"/"Downhill" var indlysende,
            "Breakaway" var det ikke — Discord-feedback, thelamba 20/7). Tooltippen
            forklarer HVAD finalen betyder; en <button> (ikke <span>) goer den
            tap-tilgaengelig paa mobil via focus-within, ikke kun hover. */}
        {finaleKey && (
          <Tooltip label={t(`detail.finaleTypeHint.${profile.finale_type}`)}>
            <button
              type="button"
              className="inline-flex items-center gap-1 text-2xs px-2 py-0.5 rounded-full bg-cz-accent/10 text-cz-accent-t border border-cz-accent/30 cursor-help"
            >
              {t(`detail.${finaleKey}`)}
            </button>
          </Tooltip>
        )}
      </div>
      <div className="mt-3">
        <TerrainDNABar demandVector={profile.demand_vector} finaleFactorPct={finaleFactorPct(profile)} />
      </div>
      {/* #4628 (TASTE P9, "kort paa fladen"): noten forklarer det INDIKATIVE
          terraen-piktogram. Har etapen aegte rutedata, er kategorien ikke laengere
          et skoen, og linjen er ren prosa paa en flade der skal vaere kort. */}
      {!routed && <p className="text-cz-3 text-2xs mt-2">{t("detail.stageProfile.note")}</p>}
    </div>
  );
}
