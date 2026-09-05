import { useTranslation } from "react-i18next";
import { RoadIcon, RollingIcon, MountainIcon, TimeTrialIcon, TeamIcon, CobblesIcon } from "../ui/icons/index.jsx";
import { profileLabelKey } from "../../lib/stageProfileConfig.js";
import { terrainTypeIconName } from "../../lib/terrainTypeIcons";

// #4748/#4487: DEN eneste flade der oversaetter et ikon-navn (terrainTypeIcons.ts,
// hard rule 31: den rene data-tabel bor i .ts) til et rigtigt React-ikon. Bruges
// af StageStripe (etape-navigation), StageDetailPanel (holdudtagelsens etape-
// profil) og RaceDetailPage's StageTerrainTag (resultat-fanens metadata-linje) —
// samme glyf + samme label alle tre steder, i stedet for tre lokale kopier af
// "hvilket ikon hoerer til hvilken profile_type" (foer laa TERRAIN_ICON_BY_PROFILE
// kun i RaceDetailPage.jsx).
//
// Bevidst .jsx, ikke .tsx (afvigelse fra hard rule 31, begrundet i PR-body):
// @types/react/@types/react-dom er IKKE devDependencies (fjernet af #4685 da den
// daekkede .tsx-fil blev slettet) — `npx tsc -p tsconfig.json` paa en .tsx-fil i
// dette repo fejler i dag med "Cannot find namespace 'JSX'" uden dem. Data-
// tabellen (terrainTypeIcons.ts) er stadig ren TS; kun selve React-komponenten
// er .jsx, indtil @types/react generhverves i sit eget spor.
//
// a11y: ikonet baerer ALTID en `title` (IconBase's egen mekanisme -> role="img"
// + aria-label), ogsaa naar der staar synlig tekst ved siden af — en redundant
// skaermlaeser-label er harmlos, en manglende er ikke.
const ICONS = {
  RoadIcon,
  RollingIcon,
  MountainIcon,
  TimeTrialIcon,
  TeamIcon,
  CobblesIcon,
};

// Ukendt/manglende profile_type -> null (graceful degrade, samme princip som
// profileLabelKey/StageDetailPanel: vis intet frem for et forkert badge).
export default function TerrainTypeGlyph({
  profileType,
  size = 13,
  className = "",
  iconClassName = "shrink-0",
  showLabel = false,
  labelClassName = "text-2xs",
}) {
  const { t } = useTranslation("races");
  const labelKey = profileLabelKey(profileType);
  if (!labelKey) return null;
  const label = t(`detail.${labelKey}`);
  const Icon = ICONS[terrainTypeIconName(profileType)] || RoadIcon;

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <Icon size={size} title={label} className={iconClassName} />
      {showLabel && <span className={labelClassName}>{label}</span>}
    </span>
  );
}
