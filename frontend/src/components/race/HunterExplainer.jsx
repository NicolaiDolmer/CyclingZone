// Race Hub S5 (Lag 3) — udbrudsjaeger-rollen i udtagelses-panelet.
// Surfacer den EKSISTERENDE motor-mekanik (raceSimulator: hunter = altid udbruds-
// kandidat): at jaegeren proever at komme med i morgenudbruddet, og hvilke ryttere
// der er bedst egnede (rangeret efter aggression). Ingen motor-aendring. #6912: den
// faste "Breakaway odds"-label er fjernet, fordi den ikke kom fra motoren.
//
// #1884 (S5-opfoelgning): jaegeren VAELGES nu her. Foer stod der en separat
// "Udbruds-jaeger"-dropdown i rolle-raekken OG denne forklaring lige under — to
// kilder til det samme valg, og forklaringen var ren prosa under tabellen
// (audit 2026-09 raekke #4, TASTE P9). Nu er kandidat-listen selve kontrollen:
// eet sted, og den viser hvorfor mens man vaelger. Mekanikkens fulde forklaring
// bor i Hjaelp (help.json, "A breakaway hunter is always sent into the day's
// breakaway...") — fladen holder sig til en linje kontekst.
import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router";
import { useTranslation } from "react-i18next";
import { stageHasBreakaway } from "../../lib/roleHint.js";
import { rankHunterCandidates } from "../../lib/hunterRanking.js";
import { outlookLine } from "../../lib/breakawayOutlook.ts";
import { authHeaders } from "../../lib/supabase";
import { apiFetch } from "../../lib/apiFetch.ts";

// Raekke-opskrift for baade "ingen jaeger" og rytterne: samme hoejde, samme
// markering af det valgte (TASTE P8 — eet sprog for status).
const ROW_BASE = "w-full flex items-center justify-between gap-2 text-2xs px-2 py-1 rounded-cz border transition-colors";
const ROW_ON = "border-cz-accent bg-cz-accent/6 text-cz-accent-t font-medium";
const ROW_OFF = "border-transparent text-cz-1 hover:border-cz-border hover:bg-cz-card";

export default function HunterExplainer({
  riders = [],
  profileType = null,
  hunterId = null,
  onSelect = null,
  disabled = false,
}) {
  const { t } = useTranslation("races");
  // #6912: ingen fast udbrudschance her (den kom fra en tabel, ikke fra motoren).
  // Linjeløb: jægeren prøver at komme med, feltet afgør på dagen. Tidskørsel: intet udbrud.
  // Uden indlæst profil vises linjeløbs-teksten, fordi den er sand for langt de fleste etaper.
  const isTimeTrial = profileType != null && !stageHasBreakaway(profileType);

  // #6912 B: motorens chance for løbets næste etape. Backend svarer available:false
  // når flaget er slukket eller motoren ikke kan stå inde for tallet; så vises intet.
  const { raceId } = useParams();
  const [outlook, setOutlook] = useState(null);
  useEffect(() => {
    if (!raceId || isTimeTrial) { setOutlook(null); return undefined; }
    let alive = true;
    (async () => {
      try {
        const headers = await authHeaders();
        if (!headers) return;
        const res = await apiFetch(`/api/races/${raceId}/breakaway-outlook`, { headers });
        if (alive) setOutlook(res.ok ? res.data : null);
      } catch {
        // best-effort: uden svar vises blot ingen chance (linjen over står alene).
        if (alive) setOutlook(null);
      }
    })();
    return () => { alive = false; };
  }, [raceId, isTimeTrial]);
  const line = isTimeTrial ? null : outlookLine(outlook);

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
      <p className="text-2xs leading-snug text-cz-3 mt-1">
        {isTimeTrial ? t("racehub.roleCard.hunter.hint.itt") : t("racehub.hunterExplainer.dayLine")}
      </p>
      {line && (
        <p data-testid="hunter-breakaway-outlook" className="text-2xs leading-snug text-cz-2 mt-1">
          {line.stageNumber != null && <span className="text-cz-3">{t("racehub.hunterExplainer.outlook.stage", { stage: line.stageNumber })} · </span>}
          <span className="font-semibold tabular-nums">{t(line.oddsKey, line.oddsParams)}</span>
          {line.reasonKey && <span className="text-cz-3"> {t(line.reasonKey)}</span>}
        </p>
      )}

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
                  <span className="text-2xs truncate">{t("racehub.hunterExplainer.noHunter")}</span>
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
                      <span className="text-2xs truncate">{r.name}</span>
                      <span className="text-2xs font-mono tabular-nums text-cz-2 shrink-0">
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
