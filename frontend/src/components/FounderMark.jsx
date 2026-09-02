import { useTranslation } from "react-i18next";
import { TrophyIcon } from "./ui/icons/index.jsx";
import { useFounderNumber } from "../lib/useFounderTeams.js";

// #4649 · Synligt Founder-mærke (Pro v1.1, del A). ANDRE spillere skal kunne se
// hvem der er Founder — modsat ProBadge.jsx (kun i egen sidebar). Stroke-ikon
// (TrophyIcon, aldrig emoji) + tekst, hairline i stedet for fyld — matcher
// ProBadge's anatomi, men bruges alle steder et holdnavn vises, ikke kun eget.
//
// Returnerer null indtil listen er hentet ELLER hvis holdet ikke er Founder —
// kaldere kan derfor rende komponenten ubetinget uden selv at tjekke loading.
export default function FounderMark({ teamId, className = "" }) {
  const { t } = useTranslation("pro");
  const { founderNumber, founderCap } = useFounderNumber(teamId);
  if (founderNumber == null) return null;
  return (
    <span
      className={`inline-flex items-center gap-1 border border-cz-accent rounded-cz px-1.5 py-0.5 text-3xs font-bold uppercase tracking-wider text-cz-accent-t shrink-0 ${className}`}
      title={t("founderMark.aria", { n: founderNumber, cap: founderCap })}
      aria-label={t("founderMark.aria", { n: founderNumber, cap: founderCap })}
    >
      <TrophyIcon size={11} className="text-cz-accent-t" aria-hidden="true" />
      {t("founderMark.label")}
    </span>
  );
}

// Ren tekstlinje-variant til T3-heroen ("Founder no. N of 50" under navnet) —
// ikke en pille, fordi hero-meta-linjen allerede er tekst (division/manager),
// ikke badges.
export function FounderHeroLine({ teamId, className = "" }) {
  const { t } = useTranslation("pro");
  const { founderNumber, founderCap } = useFounderNumber(teamId);
  if (founderNumber == null) return null;
  return (
    <span className={`inline-flex items-center gap-1 font-data text-2xs uppercase tracking-[.08em] text-cz-accent-t ${className}`}>
      <TrophyIcon size={11} className="text-cz-accent-t" aria-hidden="true" />
      {t("founderMark.heroLine", { n: founderNumber, cap: founderCap })}
    </span>
  );
}
