import { useTranslation } from "react-i18next";
import IconBase from "../ui/icons/IconBase.jsx";
import { profileLabelKey } from "../../lib/stageProfileConfig.js";
import { terrainGlyph, terrainDisplayType, terrainColorVar } from "../../lib/terrainTypeIcons";

// #6683: DEN eneste komponent der tegner en etapetype (ejer-beslutning 15/10).
// Ét farvet streg-ikon pr. profile_type, det samme overalt: kalender-chip og
// -forklaring, forside (dagens etaper), planlaegning, etapeside, etape-navigation,
// holdudtagelse og loebskort. Figur + farve-token bor i lib/terrainTypeIcons.ts
// (ren data, hard rule 31); her bor kun tegningen.
//
// Farven kommer ALTID fra terraenet (`--terrain-*`), aldrig fra forælderens
// tekstfarve: den viser svaerhed. Derfor staar navnet altid i title/aria-label
// (IconBase's egen mekanisme -> role="img"), og med `showLabel` ogsaa som synlig
// tekst, saa farven aldrig staar alene.
//
// `classic` er ikke en rutetype og vises (ikon + navn) som kuperet.
//
// Bevidst .jsx, ikke .tsx: @types/react er ikke en devDependency (fjernet af #4685).
//
// Ukendt/manglende profile_type -> null (vis intet frem for et forkert ikon).
export default function TerrainTypeGlyph({
  profileType,
  size = 13,
  className = "",
  iconClassName = "shrink-0",
  showLabel = false,
  labelClassName = "text-2xs",
}) {
  const { t } = useTranslation("races");
  const glyph = terrainGlyph(profileType);
  const displayType = terrainDisplayType(profileType);
  const labelKey = profileLabelKey(displayType);
  if (!glyph || !labelKey) return null;
  const label = t(`detail.${labelKey}`);

  return (
    <span className={`inline-flex items-center gap-1 ${className}`}>
      <IconBase
        size={size}
        title={label}
        className={iconClassName}
        strokeWidth={1.7}
        style={{ color: terrainColorVar(glyph) }}
        data-terrain={displayType}
      >
        {glyph.shapes.map((s, i) => {
          if (s.t === "circle") return <circle key={i} cx={s.cx} cy={s.cy} r={s.r} />;
          if (s.t === "rect") return <rect key={i} x={s.x} y={s.y} width={s.w} height={s.h} rx={s.rx} />;
          return <path key={i} d={s.d} />;
        })}
      </IconBase>
      {showLabel && <span className={labelClassName}>{label}</span>}
    </span>
  );
}
