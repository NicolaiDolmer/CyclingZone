// Race Hub S5 (Lag 3) — forklarer "Udbrudsjæger"-rollen i udtagelses-panelet.
// Surfacer den EKSISTERENDE motor-mekanik (raceSimulator: hunter = altid udbruds-
// kandidat, HUNTER_WEIGHT_MULTIPLIER, terræn-kalibreret BREAKAWAY_BONUS): hvad rollen
// gør, hvor stærk udbruds-chancen er på dette terræn, og hvilke ryttere der er bedst
// egnede (rangeret efter aggression — evnen der driver udbruds-CHANCEN). Ingen motor-
// ændring. Editorial navy/guld, ingen slop.
import { useTranslation } from "react-i18next";
import { hunterBreakawayStrength } from "../../lib/roleHint.js";
import { rankHunterCandidates } from "../../lib/hunterRanking.js";

const STRENGTH_CLASS = {
  high: "text-cz-accent-t",
  medium: "text-cz-2",
  low: "text-cz-3",
  none: "text-cz-3",
};

export default function HunterExplainer({ riders = [], profileType = null, finaleType = null, hunterId = null }) {
  const { t } = useTranslation("races");
  const strength = hunterBreakawayStrength(profileType, finaleType);
  const candidates = rankHunterCandidates(riders);
  const strengthWord = t(`racehub.breakawayStrength.${strength}`).toLowerCase();

  return (
    <section className="bg-cz-subtle border-t border-cz-border px-4 py-3">
      <h3 className="text-xs font-semibold text-cz-1">{t("racehub.hunterExplainer.title")}</h3>
      <p className="text-[11px] leading-snug text-cz-3 mt-1">{t("racehub.hunterExplainer.body")}</p>
      <p className="text-[11px] leading-snug mt-1.5">
        <span className="text-cz-3">{t("racehub.breakawayStrength.label")}: </span>
        <span className={`font-semibold ${STRENGTH_CLASS[strength]}`}>
          {t(`racehub.breakawayStrength.${strength}`)}
        </span>
        <span className="text-cz-3"> · {t("racehub.hunterExplainer.strengthLine", { strength: strengthWord })}</span>
      </p>

      <div className="mt-2.5">
        <p className="text-[10px] uppercase tracking-wide text-cz-3">{t("racehub.hunterExplainer.candidatesTitle")}</p>
        {candidates.length === 0 ? (
          <p className="text-[11px] text-cz-3 mt-1">{t("racehub.hunterExplainer.noCandidates")}</p>
        ) : (
          <>
            <ul className="mt-1 space-y-0.5">
              {candidates.map((r) => (
                <li key={r.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className={`truncate ${r.id === hunterId ? "text-cz-accent-t font-medium" : "text-cz-1"}`}>{r.name}</span>
                  <span className="font-mono tabular-nums text-cz-2 flex-shrink-0">
                    {t("racehub.hunterExplainer.aggression")} {r.aggression}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-[10px] text-cz-3 mt-1">{t("racehub.hunterExplainer.candidatesHint")}</p>
          </>
        )}
      </div>
    </section>
  );
}
