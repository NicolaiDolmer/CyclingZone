// #8853 · Løbsniveau-mærket: ejeren (26/11) vil se det tydeligt ALLE steder et
// løb vises, om det er et U23- eller juniorløb (indbakke, løbsside, palmarès).
//
// Ét fælles mærke, så niveauet ser ens ud overalt. Afgøres UDELUKKENDE af
// løbets eget squad-felt (races.squad: senior | u23 | junior) — aldrig af
// navnet, og aldrig af rytterens trup (rytter-mærkerne er #8587/#7233).
// Seniorløb og ukendt niveau viser intet: fraværet betyder "seniorløb".
//
// TASTE: hairline-pille med 5px radius som CategoryTag, ingen skygge, ingen
// emoji, ikke guld (guld er rationeret). Info-tonen skiller det ud fra de
// neutrale klasse-/type-mærker ved siden af, så det faktisk ER tydeligt.
// Fuld tekst (ingen forkortelser): "U23" er kategoriens navn, ikke en forkortelse.
import { useTranslation } from "react-i18next";
import { squadBadgeKey } from "../../lib/squadBadge.ts";

export interface RaceLevelBadgeProps {
  /** races.squad — kun "u23" og "junior" giver et mærke. */
  squad?: string | null;
  className?: string;
}

export default function RaceLevelBadge({ squad, className = "" }: RaceLevelBadgeProps) {
  const { t } = useTranslation("races");
  const level = squadBadgeKey(squad);
  if (!level) return null;
  return (
    <span
      data-race-level={level}
      title={t(`raceLevel.${level}Title`)}
      className={`inline-flex items-center rounded-cz border border-cz-info/30 bg-cz-info/10 px-1.5 py-0.5 font-data text-3xs font-semibold uppercase tracking-[.08em] leading-none whitespace-nowrap text-cz-info align-middle ${className}`}
    >
      {t(`raceLevel.${level}`)}
    </span>
  );
}
