// Race Hub S5 (Lag 3) — udbrudsjaeger-rollen i udtagelses-panelet.
// Surfacer den EKSISTERENDE motor-mekanik (raceSimulator: hunter = altid udbruds-
// kandidat, terraen-kalibreret udbruds-chance): hvor staerk udbruds-chancen er paa
// dette terraen, og hvilke ryttere der er bedst egnede (rangeret efter aggression —
// evnen der driver udbruds-CHANCEN). Ingen motor-aendring.
//
// #1884 (S5-opfoelgning): jaegeren VAELGES nu her. Foer stod der en separat
// "Udbruds-jaeger"-dropdown i rolle-raekken OG denne forklaring lige under — to
// kilder til det samme valg, og forklaringen var ren prosa under tabellen
// (audit 2026-09 raekke #4, TASTE P9). Nu er kandidat-listen selve kontrollen:
// eet sted, og den viser hvorfor mens man vaelger. Mekanikkens fulde forklaring
// bor i Hjaelp (help.json, "A breakaway hunter is always sent into the day's
// breakaway...") — fladen holder sig til en linje kontekst.
import { useMemo } from "react";
import { useTranslation } from "react-i18next";
import { hunterBreakawayStrength } from "../../lib/roleHint.js";
import { rankHunterCandidates } from "../../lib/hunterRanking.js";

const STRENGTH_CLASS = {
  high: "text-cz-accent-t",
  medium: "text-cz-2",
  low: "text-cz-3",
  none: "text-cz-3",
};

// Raekke-opskrift for baade "ingen jaeger" og rytterne: samme hoejde, samme
// markering af det valgte (TASTE P8 — eet sprog for status).
const ROW_BASE = "w-full flex items-center justify-between gap-2 text-2xs px-2 py-1 rounded-cz border transition-colors";
const ROW_ON = "border-cz-accent bg-cz-accent/[0.06] text-cz-accent-t font-medium";
const ROW_OFF = "border-transparent text-cz-1 hover:border-cz-border hover:bg-cz-card";

export default function HunterExplainer({
  riders = [],
  profileType = null,
  finaleType = null,
  hunterId = null,
  onSelect = null,
  disabled = false,
}) {
  const { t } = useTranslation("races");
  const strength = hunterBreakawayStrength(profileType, finaleType);
  const strengthWord = t(`racehub.breakawayStrength.${strength}`).toLowerCase();

  // #1884: HELE den udtagne trup skal kunne vaelges (dropdownen kunne det), ikke
  // kun de tre bedste. Rangeringen er stadig aggression desc — den er selve
  // anbefalingen — og ryttere uden beregnet aggression staar sidst i stedet for
  // at forsvinde (rankHunterCandidates filtrerer dem bevidst fra sin top-liste).
  const ranked = useMemo(() => {
    const withAggression = rankHunterCandidates(riders, riders.length);
    const rest = (riders || []).filter((r) => !Number.isFinite(r?.aggression));
    return [...withAggression, ...rest];
  }, [riders]);

  const pick = (id) => {
    if (!onSelect || disabled) return;
    onSelect(id === hunterId ? "" : String(id ?? ""));
  };

  return (
    <section className="bg-cz-subtle border-t border-cz-border px-4 py-3">
      <h3 className="text-xs font-semibold text-cz-1">{t("racehub.hunterExplainer.pickTitle")}</h3>
      <p className="text-2xs leading-snug mt-1">
        <span className="text-cz-3">{t("racehub.breakawayStrength.label")}: </span>
        <span className={`font-semibold ${STRENGTH_CLASS[strength]}`}>
          {t(`racehub.breakawayStrength.${strength}`)}
        </span>
        <span className="text-cz-3"> · {t("racehub.hunterExplainer.strengthLine", { strength: strengthWord })}</span>
      </p>

      <div className="mt-2.5">
        {ranked.length === 0 ? (
          <p className="text-2xs text-cz-3">{t("racehub.hunterExplainer.noCandidates")}</p>
        ) : (
          <>
            <ul className="space-y-0.5">
              <li>
                <button
                  type="button"
                  onClick={() => pick(null)}
                  disabled={disabled}
                  aria-pressed={hunterId == null}
                  className={`${ROW_BASE} ${hunterId == null ? ROW_ON : ROW_OFF} disabled:opacity-50 disabled:cursor-not-allowed`}
                >
                  <span className="truncate">{t("racehub.hunterExplainer.noHunter")}</span>
                </button>
              </li>
              {ranked.map((r) => {
                const on = String(r.id) === String(hunterId);
                return (
                  <li key={r.id}>
                    <button
                      type="button"
                      onClick={() => pick(r.id)}
                      disabled={disabled}
                      aria-pressed={on}
                      className={`${ROW_BASE} ${on ? ROW_ON : ROW_OFF} disabled:opacity-50 disabled:cursor-not-allowed`}
                    >
                      <span className="truncate">{r.name}</span>
                      <span className="font-mono tabular-nums text-cz-2 flex-shrink-0">
                        {t("racehub.hunterExplainer.aggression")} {Number.isFinite(r.aggression) ? r.aggression : "—"}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="text-3xs text-cz-3 mt-1.5">{t("racehub.hunterExplainer.candidatesHint")}</p>
          </>
        )}
      </div>
    </section>
  );
}
