import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { Card } from "./ui";
import RiderLink from "./RiderLink";
import { Flag } from "./Flag";
import { formatNumber } from "../lib/intl";
import { buildRaceRecap } from "../lib/raceRecap.js";
import { supabase } from "../lib/supabase";

// #2466 — "How your team did": resultat-push for holdets seneste finaliserede
// løb. Modsat "Seneste resultater"-kortet (løbets VINDER) viser dette kort DINE
// rytteres placeringer: topresultatet fremhævet (Bebas-placeringstal, samme
// display-font som rytter-profilen), resten kompakt, plus løbs-recap-momentet
// fra den eksisterende buildRaceRecap() og totaler (point/præmie).
//
// data-kontrakt (GET /api/dashboard/my-latest-result):
//   null      → fetch ikke landet (eller fejlet) → render intet (ingen død boks)
//   race:null → holdet har ingen finaliserede løb endnu → empty state m. kalender-CTA
//   ellers    → { race: { ..., seen }, placements, stage_wins, totals, recap }

const API = import.meta.env.VITE_API_URL;
const MAX_SECONDARY_ROWS = 4;

function placementName(p) {
  if (p.firstname || p.lastname) return `${p.firstname ?? ""} ${p.lastname ?? ""}`.trim();
  return p.rider_name || "—";
}

// "Nyt"-markering indtil set (#2593 del 2): SERVER-flaget (race.seen) er nu
// sandheden, ikke det device-scopede localStorage-flag fra #2466 — det
// nulstillede sig ved enhedsskifte (54,9% af besøg er mobil), så badgen
// dukkede falsk op igen på en anden enhed for et løb manageren allerede havde
// set. Ingen localStorage-fallback: featuren er en "nyt siden sidst"-badge,
// ikke en kritisk sti, så en ekstra offline-cache ville kun tilføje endnu en
// sandhedskilde at holde synkron for lidt gevinst. race.seen mangler kolonnen
// endnu (før ejer anvender migrationen) → undefined → behandles som usét
// (samme adfærd som badgen altid havde ved allerførste besøg).
function useSeenBadge(race) {
  const [isNew, setIsNew] = useState(false);
  const markedRef = useRef(null);
  useEffect(() => {
    const raceId = race?.id;
    if (!raceId) return;
    setIsNew(!race.seen);
    if (race.seen || markedRef.current === raceId) return;
    markedRef.current = raceId;
    // Fire-and-forget, samme mønster som DashboardPage.dismissOnboarding: lokal
    // badge-visning venter ikke på roundtrippen, og fejl er stille (badgen
    // dukker blot op igen næste besøg — ingen død funktionalitet).
    (async () => {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        const token = session?.access_token;
        if (!token) return;
        await fetch(`${API}/api/dashboard/my-latest-result/seen`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ race_id: raceId }),
        });
      } catch {
        // best-effort — badgen markeres blot set igen ved næste visning
      }
    })();
  }, [race?.id, race?.seen]);
  return isNew;
}

export default function MyLatestResultCard({ data }) {
  const { t } = useTranslation(["dashboard", "races"]);
  const isNew = useSeenBadge(data?.race);

  // Recap-momentet genbruger den eksisterende fortælle-logik + races-namespacets
  // oversættelser 1:1 (ingen dublerede strenge). Backend har trimmet rækkerne
  // til det recap'en faktisk læser (top-10 + udbrud) — se trimRecapRows.
  const recapMoment = useMemo(() => {
    if (!data?.recap?.results?.length) return null;
    const moments = buildRaceRecap({
      results: data.recap.results,
      scope: { type: "overall" },
      incidents: data.recap.incidents || [],
    });
    return moments[0] || null;
  }, [data]);

  if (!data) return null;

  const { race, placements = [], stage_wins: stageWins = 0, totals } = data;

  return (
    <Card className="p-5 mb-4">
      {/* flex-wrap: på smalle skærme må linket falde ned på egen linje frem for
          at trunkere modultitlen (54,9% af trafikken er mobil). */}
      <div className="flex items-center justify-between gap-x-3 gap-y-1 mb-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm">{t("dashboard:cards.myResult.title")}</h2>
          {race && isNew && (
            <span className="text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 flex-shrink-0">
              {t("dashboard:cards.myResult.newBadge")}
            </span>
          )}
        </div>
        {race && (
          <Link to={`/races/${race.id}`} state={{ from: "dashboard" }}
            className="text-xs text-cz-accent-t hover:underline flex-shrink-0">
            {t("dashboard:cards.myResult.linkFull")}
          </Link>
        )}
      </div>

      {!race ? (
        <div className="text-center py-4">
          <p className="text-cz-3 text-sm">{t("dashboard:cards.myResult.empty")}</p>
          <Link to="/calendar" className="text-cz-accent-t text-xs hover:underline mt-1 inline-block">
            {t("dashboard:cards.myResult.emptyCta")}
          </Link>
        </div>
      ) : (
        <>
          <p className="text-cz-3 text-xs mb-3">
            {race.name}
            {" · "}
            {race.race_type === "stage_race"
              ? t("dashboard:cards.myResult.stagesCount", { count: race.stages })
              : t("dashboard:cards.myResult.oneDay")}
          </p>

          {placements.length > 0 && (
            <div className="flex flex-col">
              {/* Topresultat — fremhævet med Bebas-placeringstal (ægte cykel-
                  resultat-æstetik, samme font-display som rytter-profilen). */}
              {placements.slice(0, 1).map((p) => (
                <div key={`top-${p.rider_id ?? p.rider_name ?? "0"}`} className="flex items-baseline gap-3 pb-2.5 border-b border-cz-border">
                  <span className={`font-display text-3xl leading-none ${p.rank === 1 ? "text-cz-accent-t" : "text-cz-1"}`}>
                    #{p.rank ?? "—"}
                  </span>
                  <div className="flex-1 min-w-0">
                    {p.rider_id ? (
                      <RiderLink id={p.rider_id} className="text-cz-1 text-sm font-medium hover:underline inline-flex items-center gap-1 max-w-full">
                        {p.nationality_code && <Flag code={p.nationality_code} />}
                        <span className="truncate">{placementName(p)}</span>
                      </RiderLink>
                    ) : (
                      <span className="text-cz-1 text-sm font-medium truncate">{placementName(p)}</span>
                    )}
                  </div>
                  {p.finish_time && (
                    <span className="font-mono text-xs text-cz-3 tabular-nums flex-shrink-0">{p.finish_time}</span>
                  )}
                </div>
              ))}
              {/* Resten af holdets ryttere — kompakte rækker, samme #rank-idiom
                  som holdets resultat-fane. */}
              {placements.slice(1, 1 + MAX_SECONDARY_ROWS).map((p, i) => (
                <div key={p.rider_id ?? `${p.rider_name}-${i}`} className="flex items-center gap-3 py-1.5 border-b border-cz-border last:border-0">
                  <span className="font-mono text-xs w-8 text-right text-cz-3 flex-shrink-0">#{p.rank ?? "—"}</span>
                  <div className="flex-1 min-w-0">
                    {p.rider_id ? (
                      <RiderLink id={p.rider_id} className="text-cz-2 text-sm hover:underline truncate block">
                        {placementName(p)}
                      </RiderLink>
                    ) : (
                      <span className="text-cz-2 text-sm truncate block">{placementName(p)}</span>
                    )}
                  </div>
                  {p.finish_time && (
                    <span className="font-mono text-xs text-cz-3 tabular-nums flex-shrink-0">{p.finish_time}</span>
                  )}
                </div>
              ))}
              {placements.length > 1 + MAX_SECONDARY_ROWS && (
                <Link to={`/races/${race.id}`} state={{ from: "dashboard" }}
                  className="text-cz-accent-t text-xs hover:underline pt-2">
                  {t("dashboard:cards.myResult.moreRiders", { count: placements.length - 1 - MAX_SECONDARY_ROWS })}
                </Link>
              )}
            </div>
          )}

          {recapMoment && (
            <p className="text-cz-2 text-xs mt-3">
              {t(`races:detail.recap.${recapMoment.key}`, recapMoment.params)}
            </p>
          )}

          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-3 pt-3 border-t border-cz-border">
            {stageWins > 0 && (
              <span className="text-xs text-cz-1 font-medium">
                {t("dashboard:cards.myResult.stageWins", { count: stageWins })}
              </span>
            )}
            <span className="text-xs text-cz-3">
              {t("dashboard:cards.myResult.points")}{" "}
              <span className="font-mono font-bold text-cz-1">{formatNumber(totals?.points || 0)}</span>
            </span>
            {(totals?.prize_money || 0) > 0 && (
              <span className="text-xs text-cz-3">
                {t("dashboard:cards.myResult.prize")}{" "}
                <span className="font-mono font-bold text-cz-accent-t">{formatNumber(totals.prize_money)} CZ$</span>
              </span>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
