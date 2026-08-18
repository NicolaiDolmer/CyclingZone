import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import { Card } from "./ui";
import { buttonClass } from "./ui/buttonStyles.js";
import RiderLink from "./RiderLink";
import { Flag } from "./Flag";
import { formatNumber } from "../lib/intl";
import { buildRaceRecap } from "../lib/raceRecap.js";
import { supabase } from "../lib/supabase";
import { logFirstEvent } from "../lib/logEvent";
import { isFirstRaceMoment } from "../lib/firstRaceMoment.js";
import { ConfettiModal } from "./ConfettiModal";

// #2466 — "How your team did": resultat-push for holdets seneste finaliserede
// løb. Modsat "Seneste resultater"-kortet (løbets VINDER) viser dette kort DINE
// rytteres placeringer: topresultatet fremhævet (Bebas-placeringstal, samme
// display-font som rytter-profilen), resten kompakt, plus løbs-recap-momentet
// fra den eksisterende buildRaceRecap() og totaler (point/præmie).
//
// #2886 (spillerønske, Discord 24/7 — "Any chance we can get the results like
// that more than just the last race?"): kortet viser nu også de FOREGÅENDE løb i
// sæsonen (bedste placering + point + præmiepenge pr. løb) og en sæson-total i
// bunden. Formatet er bevidst det samme som det roste: placering + point + penge
// i ét blik, ikke en fuld resultattabel. Aggregeringen sker i Postgres
// (dashboard_my_team_season_races), ikke her.
//
// data-kontrakt (GET /api/dashboard/my-latest-result):
//   null      → fetch ikke landet (eller fejlet) → render intet (ingen død boks)
//   race:null → holdet har ingen finaliserede løb endnu → empty state m. kalender-CTA
//   ellers    → { race: { ..., seen }, placements, stage_wins, totals,
//                 history: [{ race_id, name, best_rank, points, prize_money }],
//                 season_totals: { points, prize_money, races } | null,
//                 recap }
//   history: [] / season_totals: null → sektionerne udelades (fx før RPC-
//   migrationen er anvendt) uden at røre det oprindelige seneste-løb-kort.

const API = import.meta.env.VITE_API_URL;
const MAX_SECONDARY_ROWS = 4;
// Foldet historik: 5 rækker holder kortet på dashboard-højde; resten er ét klik
// væk (samme "Show all N"-idiom som løbssidens resultattabeller, #2081).
const COLLAPSED_HISTORY_ROWS = 5;

// Meta-label-opskriften fra docs/design/PAGE_TEMPLATES.md (card meta label:
// data-font, text-2xs, uppercase, tracking .08em, --text-3).
const META_LABEL = "font-data text-2xs uppercase tracking-[.08em] text-cz-3";

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
    // #3243 — funnel-event: dashboardet EKSPONERER hermed et usét løbsresultat.
    // logFirstEvent de-dup'er pr. bruger, så kun den allerførste eksponering
    // logges (samme "first"-idiom som team_drafted/first_bid).
    logFirstEvent("first_race_result_shown", { race_id: raceId });
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

// #3398 (Maiden Win Engine, item 4 — "fejring af løbssejre"): ConfettiModal har
// hidtil ALDRIG fyret i race-paths (0 hits, audit 5/8 — kun Auctions/Transfers/
// RiderStats). Genbruger DENNE komponents allerede-eksisterende "nyt uset
// resultat"-datastrøm (isNew, samme #2593-server-flag som badgen ovenfor) i
// stedet for en ny detektions-sti: placements er allerede holdets ENDELIGE
// resultat for løbet (GC for etapeløb, ellers etapen — summarizeTeamRace,
// backend/lib/myTeamLatestResult.js), så rank===1 for den bedste placering ER
// definitionen af "din rytter vandt løbet/GC'en". Fyrer PRÆCIS én gang pr. nyt
// løb (raceId-ref-gate, samme engangs-mønster som useSeenBadge's egen effekt).
function useWinCelebration(data, isNew) {
  const [show, setShow] = useState(false);
  const shownForRaceIdRef = useRef(null);

  useEffect(() => {
    const raceId = data?.race?.id;
    if (!raceId || !isNew) return;
    if (shownForRaceIdRef.current === raceId) return;
    const won = (data?.placements || []).some((p) => p.rank === 1);
    if (!won) return;
    shownForRaceIdRef.current = raceId;
    setShow(true);
  }, [data, isNew]);

  return [show, () => setShow(false)];
}

// #2886 — én række pr. tidligere løb: bedste placering, løbsnavn, point og
// præmiepenge. Tallene står i en fast højre-kolonne (point over præmie) så de
// flugter lodret på tværs af rækker og aldrig konkurrerer med løbsnavnet om
// pladsen: på 320px mobil truncater navnet i stedet for at skubbe tal ud i
// vandret scroll (54,9% af besøg er mobil).
function HistoryRow({ entry, t }) {
  return (
    <li className="flex items-center gap-3 py-1.5 border-b border-cz-border last:border-0">
      <span className="font-data text-xs w-8 text-right text-cz-3 tabular-nums flex-shrink-0">
        {entry.best_rank != null ? `#${entry.best_rank}` : "—"}
      </span>
      <Link
        to={`/races/${entry.race_id}`}
        state={{ from: "dashboard" }}
        className="flex-1 min-w-0 text-cz-2 text-sm hover:text-cz-accent-t transition-colors truncate"
      >
        {entry.name || "—"}
      </Link>
      <span className="flex-shrink-0 text-right leading-tight">
        <span className="block font-data text-xs font-bold text-cz-1 tabular-nums">
          {t("dashboard:cards.myResult.pointsShort", { value: formatNumber(entry.points) })}
        </span>
        <span className="block font-data text-3xs text-cz-3 tabular-nums">
          {formatNumber(entry.prize_money)} CZ$
        </span>
      </span>
    </li>
  );
}

export default function MyLatestResultCard({ data, nextRace = null, nextRaceStartAtMs = null, nowMs = null }) {
  const { t, i18n } = useTranslation(["dashboard", "races"]);
  const isNew = useSeenBadge(data?.race);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  // #3310 comeback-buen: uset første resultat → dashboardets landings-øjeblik.
  const firstRaceMoment = isFirstRaceMoment(data);
  // #3398: løbssejr/GC-sejr-fejring for egne ryttere (se useWinCelebration).
  const [showWinConfetti, closeWinConfetti] = useWinCelebration(data, isNew);

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

  const {
    race,
    placements = [],
    stage_wins: stageWins = 0,
    totals,
    history = [],
    season_totals: seasonTotals = null,
  } = data;
  const visibleHistory = historyExpanded ? history : history.slice(0, COLLAPSED_HISTORY_ROWS);
  // #3398: GC-sejr (etapeløb) vs. løbssejr (endagsløb) — samme skelnen som
  // resten af kortet allerede bruger (race.race_type === "stage_race").
  const winConfettiTitle = race?.race_type === "stage_race"
    ? t("dashboard:cards.myResult.confettiTitleGc")
    : t("dashboard:cards.myResult.confettiTitleRace");

  return (
    <>
      <ConfettiModal
        show={showWinConfetti}
        onClose={closeWinConfetti}
        title={winConfettiTitle}
        subtitle={race?.name}
        amount={totals?.prize_money}
      />
    <Card className="p-5 mb-4">
      {/* flex-wrap: på smalle skærme må linket falde ned på egen linje frem for
          at trunkere modultitlen (54,9% af trafikken er mobil). */}
      <div className="flex items-center justify-between gap-x-3 gap-y-1 mb-1 flex-wrap">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="font-semibold text-cz-1 text-sm">
            {firstRaceMoment ? t("dashboard:cards.myResult.firstRaceTitle") : t("dashboard:cards.myResult.title")}
          </h2>
          {race && isNew && (
            <span className="text-3xs uppercase tracking-wide px-2 py-0.5 rounded-full border bg-cz-accent/10 text-cz-accent-t border-cz-accent/30 flex-shrink-0">
              {t("dashboard:cards.myResult.newBadge")}
            </span>
          )}
        </div>
        {race && !firstRaceMoment && (
          <Link to={`/races/${race.id}`} state={{ from: "dashboard" }}
            className="text-xs text-cz-accent-t hover:underline flex-shrink-0">
            {t("dashboard:cards.myResult.linkFull")}
          </Link>
        )}
      </div>

      {!race ? (
        <div className="text-center py-4">
          <p className="text-cz-3 text-sm">{t("dashboard:cards.myResult.empty")}</p>
          <Link to="/planning?tab=calendar" className="text-cz-accent-t text-xs hover:underline mt-1 inline-block">
            {t("dashboard:cards.myResult.emptyCta")}
          </Link>
        </div>
      ) : (
        <>
          {/* #3310 — landings-øjeblikkets intro: hvornår løbet blev afsluttet,
              med "while you were away"-framingen fra design-specen (S1). */}
          {firstRaceMoment && race && (
            <p className="text-cz-2 text-xs mb-3">
              {race.last_import
                ? t("dashboard:cards.myResult.firstRaceIntroAt", {
                    time: new Date(race.last_import).toLocaleTimeString(i18n.language, { hour: "2-digit", minute: "2-digit" }),
                  })
                : t("dashboard:cards.myResult.firstRaceIntro")}
            </p>
          )}
          {/* #2886 — sæsonen til dato ØVERST, som issuet foreskriver: den er
              rammen om resten af kortet ("hvor står jeg?"), ikke facit efter
              detaljerne. Labelen er kort ("Denne sæson") og spejler
              "Dette løb"-labelen længere nede, så de to talpar aldrig kan
              forveksles. */}
          {seasonTotals && (
            <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-2 pb-3 mb-3 border-b border-cz-border">
              {/* Løbstallet hører til rammen (hvor meget sæson er der bag
                  tallene?), ikke til halen: målt på 360px endte det ellers som
                  et løsrevet element efter præmiepengene på linje 2. */}
              <span className={META_LABEL}>{t("dashboard:cards.myResult.season")}</span>
              <span className="text-3xs text-cz-3">
                {t("dashboard:cards.myResult.seasonRaces", { count: seasonTotals.races })}
              </span>
              <span className="text-xs text-cz-3">
                {t("dashboard:cards.myResult.points")}{" "}
                <span className="font-data font-bold text-cz-1 tabular-nums">{formatNumber(seasonTotals.points)}</span>
              </span>
              <span className="text-xs text-cz-3">
                {t("dashboard:cards.myResult.prize")}{" "}
                <span className="font-data font-bold text-cz-accent-t tabular-nums">{formatNumber(seasonTotals.prize_money)} CZ$</span>
              </span>
            </div>
          )}

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

          {/* Totalerne for DETTE løb. Meta-labelen er ny med #2886: uden den
              stod to identiske "Points / Prize money"-par i samme kort (løbet og
              sæsonen) uden at sige hvad der var hvad. */}
          <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1 mt-3 pt-3 border-t border-cz-border">
            <span className={META_LABEL}>{t("dashboard:cards.myResult.thisRace")}</span>
            {stageWins > 0 && (
              <span className="text-xs text-cz-1 font-medium">
                {t("dashboard:cards.myResult.stageWins", { count: stageWins })}
              </span>
            )}
            <span className="text-xs text-cz-3">
              {t("dashboard:cards.myResult.points")}{" "}
              <span className="font-data font-bold text-cz-1 tabular-nums">{formatNumber(totals?.points || 0)}</span>
            </span>
            {(totals?.prize_money || 0) > 0 && (
              <span className="text-xs text-cz-3">
                {t("dashboard:cards.myResult.prize")}{" "}
                <span className="font-data font-bold text-cz-accent-t tabular-nums">{formatNumber(totals.prize_money)} CZ$</span>
              </span>
            )}
          </div>

          {/* #2886 — de foregående løb. Det viste løb er allerede filtreret fra
              server-side, så listen starter ved løbet FØR det. */}
          {history.length > 0 && (
            <div className="mt-3 pt-3 border-t border-cz-border">
              <div className="flex items-baseline justify-between gap-3 mb-1">
                <span className={META_LABEL}>{t("dashboard:cards.myResult.earlier")}</span>
                {history.length > COLLAPSED_HISTORY_ROWS && (
                  <button
                    type="button"
                    onClick={() => setHistoryExpanded((v) => !v)}
                    aria-expanded={historyExpanded}
                    className="text-xs font-medium text-cz-accent-t hover:underline flex-shrink-0"
                  >
                    {historyExpanded
                      ? t("dashboard:cards.myResult.showLess")
                      : t("dashboard:cards.myResult.showAll", { count: history.length })}
                  </button>
                )}
              </div>
              <ul className="flex flex-col">
                {visibleHistory.map((h) => (
                  <HistoryRow key={h.race_id} entry={h} t={t} />
                ))}
              </ul>
            </div>
          )}

          {/* #3310 — viewets ene guldknap: fuld etaperapport ER historien.
              TeamSelectionCtaCard's CTA nedgraderes til sekundær mens denne
              variant er aktiv (guld-rationen, PAGE_TEMPLATES). */}
          {firstRaceMoment && race && (
            <div className="mt-4 pt-3.5 border-t border-cz-border flex flex-wrap items-center justify-between gap-3">
              <Link
                to={`/races/${race.id}`}
                state={{ from: "dashboard" }}
                className={buttonClass({ variant: "primary", size: "sm" })}
              >
                {t("dashboard:cards.myResult.firstRaceCta")}
              </Link>
              {nextRace && nextRaceStartAtMs && nowMs && nextRaceStartAtMs > nowMs && (
                <span className="text-xs text-cz-3">
                  {t("dashboard:cards.myResult.firstRaceNext", {
                    race: nextRace.name,
                    count: Math.max(1, Math.ceil((nextRaceStartAtMs - nowMs) / 86400000)),
                  })}
                </span>
              )}
            </div>
          )}
        </>
      )}
    </Card>
    </>
  );
}
