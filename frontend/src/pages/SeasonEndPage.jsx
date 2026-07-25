import { useState, useEffect, Fragment, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { useNavigate, useParams } from "react-router-dom";
import { computeExpectedRacePrize, formatExpectedPrize } from "../lib/expectedPrizeCalculator";
import { formatNumber } from "../lib/intl";
import { dateTextToDayOfYear } from "../lib/raceCalendar";
import LeaderBadge from "../components/LeaderBadge";
import { RULES_NUMBERS } from "../lib/rulesNumbers";
import { divColor } from "../lib/divisionColors.js";
import {
  CoinIcon, BriefcaseIcon, ExchangeIcon, BikeIcon, FlagIcon, PageLoader,
  PageHeader, Section, SectionHeader, Card, Table, Th, Td, EmptyState, ErrorState,
  Button, Select, ZonePill,
} from "../components/ui";

// #2908: division-farven kommer nu fra den delte anti-drift-vokabular
// (divisionColors.js, #671) i stedet for en lokal DIV_COLORS der stoppede ved 3 —
// samme kilde som StandingsPage + race-hub, så en 4. tier ikke kræver en ny
// hardcodet farve her.
//
// #2908: ALL_DIVISIONS dækker MIN_DIVISION..MAX_DIVISION (nu 4, #1608-pyramiden)
// i stedet for et hardcodet [1, 2, 3] — samme mønster som StandingsPage.jsx.
// Uden dette forsvandt division 4 (57 af 153 ægte hold) helt fra præcis den side
// season_ended-notifikationen sender alle managere til.
const ALL_DIVISIONS = Array.from(
  { length: RULES_NUMBERS.maxDivision - RULES_NUMBERS.minDivision + 1 },
  (_, i) => RULES_NUMBERS.minDivision + i,
);

// Label resolves via t("status.<key>") ved render — se seasonEnd-namespacet.
const RACE_STATUS_CLS = {
  completed: "bg-cz-success-bg text-cz-success border-cz-success/30",
  active:    "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30",
  scheduled: "bg-cz-subtle text-cz-3 border-cz-border",
};

function formatCZ(amount) {
  return `${formatNumber(amount || 0)} CZ$`;
}

function MiniLineChart({ data, color }) {
  if (!data || data.length < 2) return <span className="text-cz-3 text-xs">—</span>;
  const max = Math.max(...data, 1);
  const min = Math.min(...data);
  const range = max - min || 1;
  const w = 80, h = 30, pad = 3;
  const pts = data.map((v, i) => {
    const x = pad + (i / (data.length - 1)) * (w - pad * 2);
    const y = h - pad - ((v - min) / range) * (h - pad * 2);
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width={w} height={h} className="overflow-visible">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts.split(" ").pop().split(",")[0]} cy={pts.split(" ").pop().split(",")[1]}
        r="2.5" fill={color} />
    </svg>
  );
}

export default function SeasonEndPage() {
  const { t } = useTranslation("seasonEnd");
  const navigate = useNavigate();
  const { seasonId: urlSeasonId } = useParams();
  const [seasons, setSeasons] = useState([]);
  const [selectedSeason, setSelectedSeason] = useState(null);
  const [standings, setStandings] = useState([]);
  const [races, setRaces] = useState([]);
  const [racePoints, setRacePoints] = useState([]);
  const [pointsByTeam, setPointsByTeam] = useState({});
  const [winners, setWinners] = useState({ prize: null, biggestTransfer: null, mostActive: null, stageKing: null });
  const [myTeamId, setMyTeamId] = useState(null);
  const [loading, setLoading] = useState(true);
  // #2849 bølge 3 — canonisk ErrorState i stedet for stille fejl-degradering.
  // { type: "init" } = sæson-listen kunne ikke hentes; { type: "season", season } =
  // den valgte sæsons data fejlede (headeren/sæson-vælgeren forbliver synlig).
  const [error, setError] = useState(null);

  const loadInit = async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: { user } } = await supabase.auth.getUser();
      // #1792: udløbet/ugyldig session → user=null; stop før user.id (auth-flow redirecter til /login)
      if (!user) { setLoading(false); return; }
      const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
      setMyTeamId(myTeam?.id);

      // #2763: sæson 0 (åbne-beta-fasens bogførings-sæson, 0 løb) er ikke en rigtig
      // spillesæson og må aldrig tilbydes i spillerens sæson-vælger (samme
      // diskriminator som #2600's .gt("number", 0) i backend/routes/api.js).
      const { data: seasonsData } = await supabase.from("seasons")
        .select("*").gt("number", 0).order("number", { ascending: false });
      setSeasons(seasonsData || []);
      setLoading(false);
    } catch (e) {
      console.error("SeasonEndPage: failed to load seasons", e);
      setError({ type: "init" });
      setLoading(false);
    }
  };

  const changeSeason = (season) => {
    if (!season) return;
    navigate(`/seasons/${season.id}`);
  };

  const loadSeason = async (season) => {
    setSelectedSeason(season);
    setError(null);
    try {
      const [standingsRes, racesRes, racePointsRes] = await Promise.all([
        supabase.from("season_standings")
          // #2908: team.division fjernet — grupperingen bruger nu standings-
          // rækkens EGEN division (season_standings.division = tieren holdet
          // faktisk kørte i under den afsluttede sæson), ikke holdets nuværende
          // division (team.division), som "Afslut sæson" allerede har flyttet.
          .select("*, team:team_id(id, name, is_ai)")
          .eq("season_id", season.id)
          .order("division").order("total_points", { ascending: false }),
        supabase.from("races")
          .select("id, name, race_type, race_class, stages, status, edition_year, pool_race:pool_race_id(date_text)")
          .eq("season_id", season.id)
          .order("name"),
        supabase.from("race_points").select("race_class, result_type, rank, points"),
      ]);
      setRacePoints(racePointsRes.data || []);

      const allStandings = standingsRes.data || [];
      const standings = allStandings.filter(s => !s.team?.is_ai);
      const humanTeamIds = new Set(standings.map(s => s.team_id));
      setStandings(standings);

      // Kalenderen sorteres kronologisk (efter løbsdato), ikke alfabetisk (#823).
      // Datoen ligger i pool_race.date_text ("D/M…") → sortér klient-side som på
      // dashboardet. Samme rækkefølge bruges til pointudviklings-grafen nedenfor,
      // så graf-labels (races.map(r => r.name)) ikke desynker fra data-punkterne.
      const sortedRaces = [...(racesRes.data || [])].sort(
        (a, b) => dateTextToDayOfYear(a.pool_race?.date_text) - dateTextToDayOfYear(b.pool_race?.date_text)
      );
      setRaces(sortedRaces);

      // #2891: aggregeringen sker server-side. Før hentede vi HELE race_results
      // for sæsonen med fetchAllRows (459.347 rækker = 459 OFFSET-sider, hvor
      // hver side er dyrere end den forrige → ~9,5 minutters DB-tid pr.
      // sidevisning, og et kast fra supabasePagination når 8 s-loftet rammes).
      // De rå rækker blev udelukkende brugt til tre aggregeringer, som RPC'en
      // nu leverer direkte: præmie pr. hold pr. løb, præmie-leder (= sum heraf)
      // og etapesejre pr. rytter. ~4.756 rækker, ~510 ms i ét kald.
      const { data: recap, error: recapError } = await supabase
        .rpc("get_season_recap", { p_season_id: season.id });
      // Kast eksplicit (#1851-klassen): et tavst `|| []` ville vise en tom
      // recap som om sæsonen ingen resultater havde.
      if (recapError) throw new Error(`get_season_recap: ${recapError.message}`);

      // { race_id: { team_id: prize } } — allerede i opslags-form fra serveren.
      const prizeByRace = recap?.team_race_prize || {};
      const stageKings = recap?.stage_kings || [];

      if (racesRes.data?.length) {
        const prog = {};
        const cumulative = {};
        standings.forEach(s => { prog[s.team_id] = []; cumulative[s.team_id] = 0; });

        sortedRaces.forEach(race => {
          // Løb uden resultater for menneskehold har ingen nøgle → flad kurve,
          // men stadig ét punkt, så graf-labels (races.map) ikke desynker.
          const racePrize = prizeByRace[race.id] || {};
          standings.forEach(s => {
            cumulative[s.team_id] = (cumulative[s.team_id] || 0) + (Number(racePrize[s.team_id]) || 0);
            if (prog[s.team_id]) prog[s.team_id].push(cumulative[s.team_id]);
          });
        });

        setPointsByTeam(prog);
      }

      // Vindere
      const teamMeta = Object.fromEntries(allStandings.map(s => [s.team_id, s.team]));

      // 1. Præmie-leader: sum af aggregatet per menneskehold.
      const prizeByTeam = {};
      Object.values(prizeByRace).forEach(perTeam => {
        Object.entries(perTeam || {}).forEach(([teamId, prize]) => {
          if (!humanTeamIds.has(teamId)) return;
          prizeByTeam[teamId] = (prizeByTeam[teamId] || 0) + (Number(prize) || 0);
        });
      });
      const prizeTop = Object.entries(prizeByTeam).sort((a, b) => b[1] - a[1])[0];
      const prizeWinner = prizeTop ? { team: teamMeta[prizeTop[0]], amount: prizeTop[1] } : null;

      // 2+3. Transfers: finance_transactions type=transfer_in/out for season
      const { data: txData } = await supabase
        .from("finance_transactions")
        .select("team_id, amount, description, created_at, type, team:team_id(id, name, is_ai)")
        .eq("season_id", season.id)
        .in("type", ["transfer_in", "transfer_out"]);

      const txs = (txData || []).filter(t => !t.team?.is_ai);

      // Største enkelt-transfer = max ABS(amount), but use type='transfer_in' to count seller's perspective (avoids double-count of same transfer)
      const sells = txs.filter(t => t.type === "transfer_in");
      const biggest = sells.sort((a, b) => Math.abs(b.amount) - Math.abs(a.amount))[0];
      const biggestTransfer = biggest ? {
        team: biggest.team, amount: Math.abs(biggest.amount), description: biggest.description,
      } : null;

      // Mest aktive: count transactions per team (in + out)
      const activeByTeam = {};
      txs.forEach(t => { activeByTeam[t.team_id] = (activeByTeam[t.team_id] || 0) + 1; });
      const activeTop = Object.entries(activeByTeam).sort((a, b) => b[1] - a[1])[0];
      const mostActive = activeTop ? { team: teamMeta[activeTop[0]] || txs.find(t => t.team_id === activeTop[0])?.team, count: activeTop[1] } : null;

      // 4. Stage-king: RPC'en returnerer top 5 sorteret faldende, så [0] er
      //    vinderen. Bevidst UDEN is_ai-filter, præcis som før — en AI-rytter
      //    kan stadig vinde flest etaper.
      const stageTop = stageKings[0];
      const stageKing = stageTop
        ? {
            rider: {
              id: stageTop.rider_id,
              firstname: stageTop.firstname,
              lastname: stageTop.lastname,
            },
            count: stageTop.wins,
          }
        : null;

      setWinners({ prize: prizeWinner, biggestTransfer, mostActive, stageKing });
    } catch (e) {
      console.error("SeasonEndPage: failed to load season data", e);
      setError({ type: "season", season });
    }
  };

  useEffect(() => { loadInit(); }, []);

  useEffect(() => {
    if (!seasons.length) return;
    let target = null;
    if (urlSeasonId) target = seasons.find(s => s.id === urlSeasonId);
    if (!target) target = seasons.find(s => s.status === "active") || seasons[0];
    if (target && target.id !== selectedSeason?.id) loadSeason(target);
  }, [urlSeasonId, seasons]); // eslint-disable-line react-hooks/exhaustive-deps

  // #2849 bølge 3 — canonisk retry: kører PRÆCIS den samme fetch der fejlede
  // (loadInit for sæson-listen, loadSeason(season) for den valgte sæsons data).
  const retryLoad = () => {
    if (error?.type === "season" && error.season) loadSeason(error.season);
    else loadInit();
  };

  const seasonExpectedTotal = useMemo(() => {
    if (!races.length || !racePoints.length) return 0;
    return races.reduce((sum, race) => sum + computeExpectedRacePrize({
      raceClass: race.race_class,
      raceType: race.race_type,
      stages: race.stages,
      racePoints,
    }), 0);
  }, [races, racePoints]);

  // #2908: gruppér på standings-rækkens EGEN division (den tier holdet faktisk
  // sluttede sæsonen i), ikke s.team?.division (holdets NUVÆRENDE division efter
  // en evt. op-/nedrykning). "Afslut sæson" flytter teams.division med det samme,
  // så et oprykket hold ville ellers vise sig under sin NYE division i en
  // slutstilling der hører til den gamle sæson.
  const byDiv = standings.reduce((acc, s) => {
    const div = s.division ?? RULES_NUMBERS.maxDivision;
    if (!acc[div]) acc[div] = [];
    acc[div].push(s);
    return acc;
  }, {});

  if (loading) return (
    <PageLoader />
  );

  // #2849 bølge 3 — sæson-listen kunne ikke hentes: ingen sæson-vælger at vise endnu,
  // så hele siden bliver ErrorState under en minimal header.
  if (error?.type === "init") {
    return (
      <div className="max-w-4xl mx-auto">
        <PageHeader title={t("titleFallback")} />
        <ErrorState
          title={t("loadError")}
          action={<Button variant="secondary" size="sm" onClick={retryLoad}>{t("retry")}</Button>}
        />
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto">
      <PageHeader
        title={selectedSeason ? t("title", { number: selectedSeason.number }) : t("titleFallback")}
        subtitle={t("subtitle", { status: selectedSeason?.status === "active" ? t("statusOngoing") : t("statusCompleted") })}
        actions={
          <>
            {selectedSeason && myTeamId && (
              <Button
                variant="secondary" size="sm"
                onClick={() => navigate(`/finance?tab=history&season=${selectedSeason.id}`)}>
                {t("financeReport")}
              </Button>
            )}
            <Select
              size="sm"
              value={selectedSeason?.id || ""}
              onChange={e => {
                const s = seasons.find(s => s.id === e.target.value);
                changeSeason(s);
              }}
              aria-label={t("common:a11y.selectSeason")}
            >
              {seasons.map(s => (
                <option key={s.id} value={s.id}>
                  {t("seasonOption", { number: s.number, status: s.status === "active" ? t("statusOngoing") : t("statusCompleted") })}
                </option>
              ))}
            </Select>
          </>
        }
      />

      {error?.type === "season" ? (
        <ErrorState
          title={t("loadError")}
          action={<Button variant="secondary" size="sm" onClick={retryLoad}>{t("retry")}</Button>}
        />
      ) : standings.length === 0 ? (
        <EmptyState
          icon={<FlagIcon size={26} aria-hidden="true" />}
          title={t("empty.title")}
          description={t("empty.body")}
        />
      ) : (
        <div className="flex flex-col gap-[14px]">
          {/* Sæsonens vindere */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <WinnerCard
              icon={CoinIcon}
              title={t("winners.prize.title")}
              primary={winners.prize?.team?.name || "—"}
              secondary={winners.prize ? t("winners.prize.secondary", { amount: formatCZ(winners.prize.amount) }) : t("winners.prize.empty")}
              hasData={!!winners.prize?.team?.id}
              onClick={() => winners.prize?.team?.id && navigate(`/teams/${winners.prize.team.id}`)}
            />
            <WinnerCard
              icon={BriefcaseIcon}
              title={t("winners.transfer.title")}
              primary={winners.biggestTransfer ? formatCZ(winners.biggestTransfer.amount) : "—"}
              secondary={winners.biggestTransfer
                ? (winners.biggestTransfer.description || winners.biggestTransfer.team?.name || t("winners.transfer.fallback"))
                : t("winners.transfer.empty")}
              hasData={!!winners.biggestTransfer?.team?.id}
              onClick={() => winners.biggestTransfer?.team?.id && navigate(`/teams/${winners.biggestTransfer.team.id}`)}
            />
            <WinnerCard
              icon={ExchangeIcon}
              title={t("winners.active.title")}
              primary={winners.mostActive?.team?.name || "—"}
              secondary={winners.mostActive ? t("winners.active.secondary", { count: winners.mostActive.count }) : t("winners.active.empty")}
              hasData={!!winners.mostActive?.team?.id}
              onClick={() => winners.mostActive?.team?.id && navigate(`/teams/${winners.mostActive.team.id}`)}
            />
            <WinnerCard
              icon={BikeIcon}
              title={t("winners.stageKing.title")}
              primary={winners.stageKing?.rider
                ? `${winners.stageKing.rider.firstname} ${winners.stageKing.rider.lastname}`
                : "—"}
              secondary={winners.stageKing
                ? t("winners.stageKing.secondary", { count: winners.stageKing.count })
                : t("winners.stageKing.empty")}
              hasData={!!winners.stageKing?.rider?.id}
              onClick={() => winners.stageKing?.rider?.id && navigate(`/riders/${winners.stageKing.rider.id}`)}
            />
          </div>

          {/* Kalender */}
          {races.length > 0 && (
            <Section>
              <SectionHeader
                title={t("calendar.heading", { count: races.length })}
                meta={t("calendar.summary", {
                  completed: races.filter(r => r.status === "completed").length,
                  scheduled: races.filter(r => r.status === "scheduled").length,
                })}
              />
              {seasonExpectedTotal > 0 && (
                <p className="text-cz-3 text-xs mb-4" title={t("calendar.expectedTotalTooltip")}>
                  {t("calendar.expectedTotal")} <span className="text-cz-2 font-mono">{formatExpectedPrize(seasonExpectedTotal)}</span>
                </p>
              )}
              <div className="flex flex-col">
                {races.map(race => {
                  const statusKey = RACE_STATUS_CLS[race.status] ? race.status : "scheduled";
                  const expectedPrize = computeExpectedRacePrize({
                    raceClass: race.race_class,
                    raceType: race.race_type,
                    stages: race.stages,
                    racePoints,
                  });
                  return (
                    <div key={race.id}
                      onClick={() => navigate(`/race-archive/${encodeURIComponent(race.name)}`)}
                      className="flex items-center gap-3 py-2.5 border-b border-cz-border last:border-0 -mx-1 px-1 rounded hover:bg-cz-subtle cursor-pointer transition-colors">
                      <div className="flex-1 min-w-0">
                        <p className="text-cz-1 text-sm font-medium truncate">{race.name}</p>
                        <p className="text-cz-3 text-xs">
                          {race.race_type === "stage_race" ? t("calendar.stageRace", { count: race.stages }) : t("calendar.oneDay")}
                          {expectedPrize > 0 ? <span className="text-cz-2 font-mono"> · {formatExpectedPrize(expectedPrize)}</span> : ""}
                        </p>
                      </div>
                      <span className={`text-3xs uppercase px-2 py-0.5 rounded-full border flex-shrink-0 ${RACE_STATUS_CLS[statusKey]}`}>
                        {t(`status.${statusKey}`)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </Section>
          )}

          {/* Slutstilling. #2908: alle fire divisioner (ALL_DIVISIONS = MIN..MAX_DIVISION,
              tidligere hardcodet [1, 2, 3] — division 4 vistes slet ikke). */}
          {ALL_DIVISIONS.map(div => {
            const divStandings = byDiv[div] || [];
            if (!divStandings.length) return null;
            const color = divColor(div);
            const isCompleted = selectedSeason?.status === "completed";
            return (
              <Card key={div} className="overflow-hidden">
                <div className="flex items-center justify-between px-5 py-4 border-b border-cz-border"
                  style={{ borderLeft: `3px solid ${color}` }}>
                  <h2 className="font-bold text-sm" style={{ color }}>{t("division", { div })}</h2>
                  {/* #2908: retningen var byttet om siden dag ét (div 1 = toppen, viste
                      fejlagtigt "promoted"; bunden viste fejlagtigt "relegated" — se
                      economyConstants.js "Div 1 = toppen, MAX_DIVISION = bunden").
                      Ufarligt mens kun div 1-3 rendrede (div 2 dækkede begge betingelser
                      korrekt), men uden rettelsen ville den nyligt synlige division 4
                      vise en falsk nedrykningsadvarsel til bundtieren, som ikke kan rykke
                      længere ned. */}
                  {isCompleted && div > RULES_NUMBERS.minDivision && (
                    <span className="text-xs text-cz-3">{t("promotionNote")}</span>
                  )}
                  {isCompleted && div < RULES_NUMBERS.maxDivision && (
                    <span className="text-xs text-cz-3">{t("relegationNote")}</span>
                  )}
                </div>
                <Table data-sort-exempt="Slutstilling, iboende point-orden + op/nedryknings-zoner">
                  <thead>
                    <tr className="border-b border-cz-border">
                      <Th className="w-8">{t("table.rank")}</Th>
                      <Th>{t("table.team")}</Th>
                      <Th numeric className="hidden sm:table-cell">{t("table.stageWins")}</Th>
                      <Th numeric>{t("table.points")}</Th>
                      <Th numeric className="hidden md:table-cell">{t("table.progression")}</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {divStandings.map((s, i) => {
                      const isMe = s.team_id === myTeamId;
                      const isPromotion = isCompleted && i < 2 && div > RULES_NUMBERS.minDivision;
                      const isRelegation = isCompleted && i >= divStandings.length - 2 && div < RULES_NUMBERS.maxDivision;
                      const isLeader = i === 0;
                      const prog = pointsByTeam[s.team_id] || [];
                      // Zone bar + neutral "you" ring co-exist; gold = the leader chip (PF2 B).
                      const bars = [];
                      if (isPromotion) bars.push("inset 3px 0 0 rgb(var(--success))");
                      else if (isRelegation) bars.push("inset 3px 0 0 rgb(var(--danger))");
                      if (isMe) bars.push("inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)");
                      const rowStyle = bars.length ? { boxShadow: bars.join(", ") } : {};
                      return (
                        <Fragment key={s.id}>
                          {/* Separator before relegation zone */}
                          {isCompleted && i === divStandings.length - 2 && div < RULES_NUMBERS.maxDivision && divStandings.length > 4 && (
                            <tr aria-hidden="true">
                              <td colSpan={5} className="p-0 leading-[0] border-0">
                                <div className="border-t border-cz-danger/30" />
                              </td>
                            </tr>
                          )}
                          <tr
                            style={rowStyle}
                            className={`border-b border-cz-border last:border-0 hover:bg-cz-subtle cursor-pointer transition-colors
                              ${isLeader ? "bg-cz-accent/[0.08]" : isPromotion ? "bg-cz-success-bg" : isRelegation ? "bg-cz-danger-bg" : ""}`}
                            onClick={() => navigate(`/teams/${s.team_id}`)}>
                            <Td>
                              <span className={`font-mono font-bold text-sm
                                ${i === 0 ? "text-cz-accent-t" : i === 1 ? "text-cz-2" : "text-cz-3"}`}>
                                #{i + 1}
                              </span>
                            </Td>
                            <Td>
                              <div className="flex items-center gap-2">
                                <span className="font-medium text-cz-1">
                                  {s.team?.name}
                                </span>
                                {isLeader && <LeaderBadge />}
                                {isMe && <span className="text-3xs font-bold uppercase px-1.5 py-0.5 rounded-full" style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>{t("you")}</span>}
                                {isPromotion && <ZonePill tone="success">{t("promotion")}</ZonePill>}
                                {isRelegation && <ZonePill tone="danger">{t("relegation")}</ZonePill>}
                              </div>
                            </Td>
                            <Td numeric className="hidden sm:table-cell">
                              {s.stage_wins || 0}
                            </Td>
                            <Td numeric>
                              <span className="font-mono font-bold" style={{ color }}>
                                {formatNumber(s.total_points) || 0}
                              </span>
                            </Td>
                            <Td numeric className="hidden md:table-cell">
                              <MiniLineChart data={prog} color={color} />
                            </Td>
                          </tr>
                          {/* Separator after promotion zone */}
                          {isCompleted && i === 1 && div > RULES_NUMBERS.minDivision && divStandings.length > 2 && (
                            <tr aria-hidden="true">
                              <td colSpan={5} className="p-0 leading-[0] border-0">
                                <div className="border-t border-cz-success/30" />
                              </td>
                            </tr>
                          )}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </Table>
              </Card>
            );
          })}

          {/* Full point progression for my team */}
          {myTeamId && pointsByTeam[myTeamId]?.length > 1 && races.length > 1 && (
            <Section>
              <SectionHeader title={t("myProgression")} />
              <PointChart
                data={pointsByTeam[myTeamId]}
                labels={races.map(r => r.name)}
                color="rgb(var(--accent))" />
            </Section>
          )}
        </div>
      )}
    </div>
  );
}

function WinnerCard({ icon: Icon, title, primary, secondary, onClick, hasData }) {
  return (
    <button
      onClick={onClick}
      disabled={!hasData}
      className={`bg-cz-card border border-cz-border rounded-cz p-3 text-left transition-colors ${
        hasData ? "hover:border-cz-accent/30 cursor-pointer" : "cursor-default"
      }`}>
      <div className="flex items-center gap-1.5 mb-1.5">
        {Icon && <Icon size={15} className="text-cz-accent flex-shrink-0" aria-hidden="true" />}
        <span className="text-cz-3 text-3xs uppercase tracking-wider font-semibold">{title}</span>
      </div>
      <p className="text-cz-1 font-bold text-sm truncate">{primary}</p>
      <p className="text-cz-3 text-xs truncate mt-0.5">{secondary}</p>
    </button>
  );
}

function PointChart({ data, labels, color }) {
  if (!data || data.length < 2) return null;
  const max = Math.max(...data, 1);
  const w = 100, h = 80, padX = 5, padY = 8;
  const pts = data.map((v, i) => {
    const x = padX + (i / (data.length - 1)) * (w - padX * 2);
    const y = h - padY - (v / max) * (h - padY * 2);
    return { x, y, v, label: labels[i] };
  });
  const polyline = pts.map(p => `${p.x},${p.y}`).join(" ");

  return (
    <div>
      <svg viewBox={`0 0 ${w} ${h}`} className="w-full h-32" preserveAspectRatio="none">
        {/* Grid lines */}
        {[0, 0.25, 0.5, 0.75, 1].map(t => (
          <line key={t} x1={padX} x2={w - padX}
            y1={padY + t * (h - padY * 2)} y2={padY + t * (h - padY * 2)}
            className="stroke-cz-border" strokeWidth="0.5" />
        ))}
        {/* Area fill */}
        <polygon
          points={`${pts[0].x},${h - padY} ${polyline} ${pts[pts.length-1].x},${h - padY}`}
          fill={color} fillOpacity="0.08" />
        {/* Line */}
        <polyline points={polyline} fill="none" stroke={color} strokeWidth="1.5"
          strokeLinecap="round" strokeLinejoin="round" />
        {/* Dots */}
        {pts.map((p, i) => (
          <circle key={i} cx={p.x} cy={p.y} r="2" fill={color} />
        ))}
      </svg>
      {/* X-axis labels */}
      <div className="flex justify-between mt-1 px-1">
        {labels.map((l, i) => (
          <span key={i} className="font-data text-3xs text-cz-3 truncate max-w-16 text-center"
            style={{ width: `${100 / labels.length}%` }}>
            {l.length > 8 ? l.slice(0, 8) + "…" : l}
          </span>
        ))}
      </div>
      {/* Values */}
      <div className="flex justify-between mt-2">
        {data.map((v, i) => (
          <span key={i} className="text-3xs font-mono text-center"
            style={{ color, width: `${100 / data.length}%` }}>
            {v > 0 ? formatNumber(v) : ""}
          </span>
        ))}
      </div>
    </div>
  );
}
