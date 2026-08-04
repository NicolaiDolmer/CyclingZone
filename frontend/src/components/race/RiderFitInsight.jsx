// #3115 Gap 1b (ejer-forslag 3/8): kompakt "hvorfor passer rytteren til løbet"-
// affordance i selve rytterrækken (mobil-kort + desktop-tabel). Suppleres af den
// eksisterende FitBar (typematch/rute-match) med de to signaler FitBar ikke
// dækker: udbruds-chance (aggression) og taktisk rute-bidrag (tactics) — begge
// KUN vist når de reelt er relevante for den valgte etape (selectionDrivers.js
// riderFitDrivers). Intet at vise → renderer intet (samme graceful-degrade som
// FitBar/effectiveStageFit). Native title/aria-label — samme mønster som FitBar,
// intet nyt tooltip-primitiv.
import { useTranslation } from "react-i18next";
import { riderFitDrivers } from "../../lib/selectionDrivers.js";
import { InfoIcon } from "../ui/index.js";

export default function RiderFitInsight({ rider, profileType, breakawayStrength, className = "" }) {
  const { t } = useTranslation("races");
  const lines = riderFitDrivers(rider, { profileType, breakawayStrength });
  if (!lines.length) return null;

  const text = lines
    .map((l) => t(`selection.driverInsight.${l.kind}.${l.band}`))
    .join("\n");

  return (
    <span
      role="img"
      aria-label={text}
      title={text}
      className={`inline-flex items-center text-cz-3 hover:text-cz-2 transition-colors ${className}`}
    >
      <InfoIcon size={13} aria-hidden="true" />
    </span>
  );
}
