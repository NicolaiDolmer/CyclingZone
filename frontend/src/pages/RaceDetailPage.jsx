import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useParams, useSearchParams, useLocation } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import RaceSelectionPanel from "../components/race/RaceSelectionPanel.jsx";
import StageRoleMatrix from "../components/race/StageRoleMatrix.jsx";
import StageStripe from "../components/race/StageStripe.jsx";
import StageDetailPanel from "../components/race/StageDetailPanel.jsx";
import { Flag } from "../components/Flag";
import { FlagIcon, PageLoader } from "../components/ui";
import { formatNumber } from "../lib/intl";
import { resultEntity } from "../lib/raceResultEntity.js";
import { buildRaceRecap } from "../lib/raceRecap.js";
import { fetchAllRows } from "../lib/supabasePagination";
import { logEvent } from "../lib/logEvent";
import { deriveRaceStatus } from "../lib/raceHubLogic.js";
import { buildLiveStandings } from "../lib/raceLiveStandings.js";
import { classificationRowsForStage } from "../lib/raceStageClassifications.js";
import { bucketCounts, terrainBucket } from "../lib/stageTerrain.js";
import { RACE_TIMEZONE, countdownParts, countdownSegments } from "../lib/stageScheduleConfig.js";
import { whyBeatsForStage, storyTagsForRider } from "../lib/raceStageMoments.js";
import { groupPassagesForStage } from "../lib/raceStagePassages.js";
import { hasRouteData } from "../lib/stageRouteProfile.js";
import StageProfileCard from "../components/race/StageProfileCard.jsx";
import LegacyStageProfileCard from "../components/race/LegacyStageProfileCard.jsx";

// #959 Etape-resultater V1 — detaljeret pr.-etape-visning.
//
// Data-virkelighed: race_results gemmer pr. ETAPE: result_type="stage" (fuld
// målrækkefølge) + de daglige trøjebærere (leader/points_day/mountain_day/
// young_day, én række pr. etape). De samlede klassementer (gc/points/mountain/
// young/team) gemmes ved sidste etape = det endelige resultat.
//
// Gaps (#959 V1, ejer-valgt 2026-06-17): Race Engine v2 (#1102) skriver nu
// finish_time som et "+M:SS"-gab — pr.-etape-gab på "stage"-rækker og kumulativt
// GC-gab på "gc"-rækker (de øvrige klassementer har det ikke). Bunch-finish giver
// korrekt "+0:00" for hele feltet (s.t.). Gamle PCM-importerede løb har tom
// finish_time → gap-kolonnen vises kun når data findes. (V2 efter launch: pr.-
// etape-klassement-snapshots + bonussekunder.)

// De endelige klassementer ("Samlet"-fanen), i visnings-rækkefølge.
// Label kommer fra t(`detail.classification.${key}`).
const CLASSIFICATIONS = [
  { key: "gc" },
  { key: "points" },
  { key: "mountain" },
  { key: "young" },
  { key: "team" },
];

// #2081: klassement-sub-faner INDE i en etape-fane (Stage · Overall · Points ·
// Mountain · Youth · Teams) — samme 5 nøgler som CLASSIFICATIONS + 'stage'.
const STAGE_CLASS_TABS = ["stage", "gc", "points", "mountain", "young", "team"];

// Daglige trøjebærere — vist som badges på hver etape-fane.
// Label kommer fra t(`detail.jersey.${dayType}`).
// Trøjefarver kommer fra navngivne CSS-tokens i index.css (--jersey-*), så
// callsiten ikke baerer raa hex (#671 anti-drift). Ægte cykel-jersey-hues.
const JERSEYS = [
  { dayType: "leader",       bg: "rgb(var(--jersey-leader-bg))",   fg: "rgb(var(--jersey-leader-fg))" },
  { dayType: "points_day",   bg: "rgb(var(--jersey-points-bg))",   fg: "rgb(var(--jersey-points-fg))" },
  { dayType: "mountain_day", bg: "rgb(var(--jersey-mountain-bg))", fg: "rgb(var(--jersey-mountain-fg))" },
  { dayType: "young_day",    bg: "rgb(var(--jersey-young-bg))",    fg: "rgb(var(--jersey-young-fg))" },
];

// Sub-4 (#2448): ét sted der afgør om en etape får den ægte rute-graf eller
// #1484-piktogrammet. Ingen rutedata → ingen syntetisk kurve (ejer-princip).
function StageProfileSlot({ profile, stageLabel, passages, tier }) {
  if (hasRouteData(profile)) {
    return <StageProfileCard profile={profile} stageLabel={stageLabel} passages={passages} tier={tier} />;
  }
  return <LegacyStageProfileCard profile={profile} stageLabel={stageLabel} />;
}

function riderName(res) {
  if (res.rider) return `${res.rider.firstname} ${res.rider.lastname}`;
  return res.rider_name || "—";
}

// #1499 Deskriptiv udbruds-markør: vises kun for ryttere der var i (morgen-)udbruddet.
// Holdt hjem (survived) = accent-toned; indhentet (caught) = dæmpet. Tooltip via title.
function BreakawayMarker({ result, t }) {
  if (!result?.in_breakaway) return null;
  const caught = !!result.breakaway_caught;
  const label = caught ? t("detail.breakaway.caught") : t("detail.breakaway.survived");
  return (
    <span
      className={`ms-1 inline-flex align-middle ${caught ? "text-cz-3" : "text-cz-accent-t"}`}
      title={`${t("detail.breakaway.label")} — ${label}`}
      aria-label={`${t("detail.breakaway.label")} — ${label}`}
    >
      <FlagIcon size={13} />
    </span>
  );
}

function byRank(a, b) {
  return (a.rank ?? 9999) - (b.rank ?? 9999);
}

// #2081 Discord-ønske: holdfilter (alle / mit hold / vælg hold) — delt af Samlet-
// og etape-fanerne, så filteret følger med når man skifter etape.
function TeamFilterSelect({ value, onChange, teamOptions, hasMyTeam, t }) {
  return (
    <select
      value={value}
      onChange={e => onChange(e.target.value)}
      aria-label={t("detail.teamFilter.label")}
      className={`px-3 py-2 rounded-lg text-sm font-medium transition-all border max-w-[14rem] cursor-pointer
        focus:outline-none focus:ring-1 focus:ring-cz-accent
        ${value !== "all" ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t" : "bg-cz-card border-cz-border text-cz-2"}`}>
      <option value="all">{t("detail.teamFilter.all")}</option>
      {hasMyTeam && <option value="mine">{t("detail.teamFilter.mine")}</option>}
      {teamOptions.map(team => (
        <option key={team.id} value={team.id}>{team.name}</option>
      ))}
    </select>
  );
}

// Etape-tid i København-tid (HH:MM) — kompakt til stribe-chip + header.
function formatStageTime(date, locale) {
  try {
    return new Intl.DateTimeFormat(locale || "en", { timeZone: RACE_TIMEZONE, hour: "2-digit", minute: "2-digit" }).format(date);
  } catch { return ""; }
}

// Live countdown-tekst ("in 2h 14m") — genbruger stageScheduleConfig-helpers + i18n.
function countdownText(date, nowMs, t) {
  const parts = countdownParts(date.getTime() - nowMs);
  if (!parts) return t("detail.stageSchedule.startingNow");
  const segments = countdownSegments(parts).map((s) =>
    t(`detail.stageSchedule.countdown${s.unit[0].toUpperCase()}${s.unit.slice(1)}`, { count: s.count }));
  return `${t("detail.stageSchedule.countdownPrefix")} ${segments.join(" ")}`;
}

export default function RaceDetailPage() {
  const { t, i18n } = useTranslation("races");
  const { raceId } = useParams();
  const location = useLocation();

  const [race, setRace] = useState(null);
  const [results, setResults] = useState([]);
  const [stageProfiles, setStageProfiles] = useState([]);
  const [schedule, setSchedule] = useState([]);
  const [incidents, setIncidents] = useState([]);
  const [moments, setMoments] = useState([]);
  const [passages, setPassages] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [teamFilter, setTeamFilter] = useState("all"); // "all" | "mine" | teamId
  const [myTeamId, setMyTeamId] = useState(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const [activeTab, setActiveTab] = useState(() => {
    const s = searchParams.get("stage");
    return s ? `stage-${s}` : "samlet";
  });

  // #1500: deep-link til en bestemt etape via ?stage=N. Hold activeTab og URL i
  // sync, så et link fra holdresultater åbner den rigtige etape — og fanen kan
  // deles/bogmærkes. Validerings-effekten nedenfor falder tilbage til "samlet"
  // hvis etapen ikke findes når data er hentet.
  const changeTab = useCallback((tab) => {
    setActiveTab(tab);
    const next = new URLSearchParams(searchParams);
    if (tab.startsWith("stage-")) next.set("stage", tab.slice("stage-".length));
    else next.delete("stage");
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setNotFound(false);

    const { data: raceRow, error } = await supabase
      .from("races")
      .select("id, name, race_type, race_class, stages, stages_completed, edition_year, status, season:season_id(id, number), pool_race:pool_race_id(date_text)")
      .eq("id", raceId)
      .single();

    if (error || !raceRow) {
      setNotFound(true);
      setLoading(false);
      return;
    }

    // #2081 code-review: myTeamId ikke afhængig af raceRow og bruges først ved
    // render — kør den SAMTIDIG med de øvrige uafhængige queries (ikke sekventielt
    // foran race_results) for at undgå en ekstra round-trip i critical path.
    const myTeamPromise = (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) return null;
      const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).maybeSingle();
      return myTeam?.id ?? null;
    })();

    const rowsPromise = fetchAllRows(() =>
      supabase
        .from("race_results")
        .select("id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, finish_time, points_earned, prize_money, in_breakaway, breakaway_caught, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name)), team:team_id(id, name)")
        .eq("race_id", raceId)
        .order("id")
    );

    // #1484 Stiliseret terræn-indikator. race_stage_profiles er læsbar for
    // authenticated (siden er auth-gated via ProtectedRoute). Degraderer pænt:
    // en fejl/tom tabel → ingen profil-badges, ingen fejl-UI.
    // Sub-4 (#2448): rute-felterne (Sub-1) hentes med, så etapeprofil-grafen kan
    // tegnes 1:1 fra rækken. race_id følger med, fordi silhuet-syntesens seed
    // bruger den (deterministisk pr. løb+etape). Løb uden rutedata får null/[]
    // og falder tilbage til #1484-piktogrammet — degraderer som før.
    const profilesPromise = supabase
      .from("race_stage_profiles")
      .select("race_id, stage_number, profile_type, finale_type, demand_vector, distance_km, elevation_gain_m, climbs, sprints, sectors")
      .eq("race_id", raceId)
      .order("stage_number");

    // #1597 → S4: etape-kalenderen foldes ind i etape-striben (per-etape-tid) +
    // næste-start-countdown i headeren. Degraderer pænt (tom = ingen tider).
    const schedulePromise = supabase
      .from("race_stage_schedule")
      .select("stage_number, scheduled_at")
      .eq("race_id", raceId)
      .order("stage_number", { ascending: true });

    // S4 (#1176): race_incidents (styrt/mekanisk defekt/DNF). Tabellen committes
    // som .sql men anvendes først af ejeren POST-merge — degradér ærligt: en fejl
    // (tabel findes ikke endnu, RLS afviser) må ALDRIG vælte race-siden, kun logges
    // + falde tilbage til tom liste (samme mønster som profiles/schedule ovenfor,
    // her med et eksplicit warn fordi det er en helt ny tabel under udrulning).
    const incidentsPromise = supabase
      .from("race_incidents")
      .select("id, stage_number, rider_id, kind, outcome, time_loss_seconds, rider:rider_id(id, firstname, lastname)")
      .eq("race_id", raceId);

    // S6 (#2355): race_stage_moments (why-rapport + story-tags). Samme degradér-
    // ærligt-mønster som incidents ovenfor — tabellen committes som .sql men
    // anvendes først af ejeren POST-merge, og v3-scoring var allerede ON i prod
    // FØR denne migration, så en fejl her er FORVENTET indtil ejeren har anvendt
    // den. Må ALDRIG vælte race-siden.
    const momentsPromise = supabase
      .from("race_stage_moments")
      .select("id, stage_number, moment_key, params, significance, rider_ids, team_ids")
      .eq("race_id", raceId);

    // Sub-2 (#2770): passage-detaljer (KOM/mellemsprint-krydsninger) pr. etape.
    // Samme degradér-ærligt-mønster som incidents/moments ovenfor — tabellen
    // committes som .sql men anvendes først af ejeren POST-merge. fetchAllRows
    // bruges (som race_results) fordi et langt etapeløb kan overstige 1000
    // passage-rækker; fejl fanges lokalt så den ALDRIG vælter race-siden.
    const passagesPromise = fetchAllRows(() =>
      supabase
        .from("race_stage_passages")
        .select("*")
        .eq("race_id", raceId)
        .order("stage_number")
        .order("waypoint_km")
    ).catch((err) => {
      console.warn("race_stage_passages fetch failed (table may not be migrated yet):", err.message);
      return [];
    });

    const [myTeamId, rows, { data: profiles }, { data: scheduleRows }, { data: incidentRows, error: incidentsError }, { data: momentRows, error: momentsError }, passageRows] = await Promise.all([
      myTeamPromise, rowsPromise, profilesPromise, schedulePromise, incidentsPromise, momentsPromise, passagesPromise,
    ]);
    if (incidentsError) {
      console.warn("race_incidents fetch failed (table may not be migrated yet):", incidentsError.message);
    }
    if (momentsError) {
      console.warn("race_stage_moments fetch failed (table may not be migrated yet):", momentsError.message);
    }

    setMyTeamId(myTeamId);
    setRace(raceRow);
    setResults(rows);
    setStageProfiles(profiles ?? []);
    setSchedule(scheduleRows ?? []);
    setIncidents(incidentRows ?? []);
    setMoments(momentRows ?? []);
    setPassages(passageRows ?? []);
    setLoading(false);
  }, [raceId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (race?.id) logEvent("race_viewed", { race_id: race.id });
  }, [race?.id]);

  // Et 30s-tick rækker til en kalender-countdown (vi viser ikke sekunder).
  useEffect(() => {
    const id = setInterval(() => setNowMs(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);

  // Etaper med faktiske etape-data (result_type="stage"), sorteret.
  const stageNumbers = useMemo(() => {
    const set = new Set(
      results.filter(r => r.result_type === "stage").map(r => r.stage_number ?? 1)
    );
    return [...set].sort((a, b) => a - b);
  }, [results]);

  const isStageRace = race?.race_type === "stage_race" && stageNumbers.length > 0;

  // stage_number → { profile_type, finale_type } for terræn-indikatoren (#1484).
  const profileByStage = useMemo(() => {
    const out = {};
    for (const p of stageProfiles) out[p.stage_number ?? 1] = p;
    return out;
  }, [stageProfiles]);

  const locale = i18n.language || "en";

  // S4: valgt etape på kommende-fladen (delelig via ?stage=N; default = laveste etape).
  const scheduledStageNums = useMemo(
    () => stageProfiles.map((p) => p.stage_number ?? 1),
    [stageProfiles],
  );
  const stageParam = Number(searchParams.get("stage"));
  const scheduledStage = scheduledStageNums.includes(stageParam) ? stageParam : (scheduledStageNums[0] ?? 1);
  const changeStage = useCallback((n) => {
    const next = new URLSearchParams(searchParams);
    next.set("stage", String(n));
    setSearchParams(next, { replace: true });
  }, [searchParams, setSearchParams]);

  // Etape-tider til striben + næste-start til headeren (København-tid).
  const stripeTimes = useMemo(() => {
    const out = {};
    for (const s of schedule) {
      const d = new Date(s.scheduled_at);
      if (!Number.isNaN(d.getTime())) out[s.stage_number] = { timeLabel: formatStageTime(d, locale) };
    }
    return out;
  }, [schedule, locale]);

  const nextStart = useMemo(() => {
    const next = schedule.find((s) => (s.stage_number ?? 1) > (race?.stages_completed ?? 0));
    if (!next) return null;
    const d = new Date(next.scheduled_at);
    return Number.isNaN(d.getTime()) ? null : { stageNumber: next.stage_number, date: d };
  }, [schedule, race?.stages_completed]);

  // Kontekst-bevarende tilbage-link (board/dashboard/bibliotek).
  const backFrom = location.state?.from;
  const backTo = backFrom === "board" ? "/races" : backFrom === "dashboard" ? "/dashboard" : "/races?tab=library";
  const backLabel = backFrom ? t("detail.back") : t("detail.backToLibrary");

  // Endeligt klassement pr. type = rækkerne ved højeste etape-nummer for den type
  // (robust mod fremtidige pr.-etape-snapshots; i dag findes kun det endelige).
  const finalByType = useMemo(() => {
    const out = {};
    for (const c of CLASSIFICATIONS) {
      const rows = results.filter(r => r.result_type === c.key);
      if (!rows.length) { out[c.key] = []; continue; }
      const maxStage = Math.max(...rows.map(r => r.stage_number ?? 1));
      out[c.key] = rows.filter(r => (r.stage_number ?? 1) === maxStage).sort(byRank);
    }
    return out;
  }, [results]);

  // #2081: løbende stilling mens etapeløbet er i gang — fra de fulde dag-rækker
  // ved seneste kørte etape. Når slut-klassementet findes (gc skrevet), viger den.
  const liveStandings = useMemo(() => {
    if (race?.race_type !== "stage_race" || finalByType.gc?.length) return null;
    return buildLiveStandings(results);
  }, [race?.race_type, finalByType, results]);

  // #2081: "mit hold" løses til den faktiske team_id (kan være ukendt hvis ikke logget
  // ind endnu ved første render) — "all" og en eksplicit team_id går uændret igennem.
  const resolvedTeamFilter = teamFilter === "mine" ? myTeamId : (teamFilter === "all" ? null : teamFilter);

  // Holdfilter-valgmuligheder: unikke {id, name} par fundet i de indlæste resultater.
  const teamOptions = useMemo(() => {
    const byId = new Map();
    for (const r of results) {
      const id = r.rider?.team?.id ?? r.team_id;
      const name = r.rider?.team?.name ?? r.team_name;
      if (id != null && name && !byId.has(String(id))) byId.set(String(id), { id, name });
    }
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [results]);

  // S6 (#2355): why-rapport-momenter refererer kun til rider_id/team_id (samme
  // let-payload-mønster som race_incidents) — navnene slås op klient-side af
  // de rytter/hold-embeds vi allerede har hentet med resultaterne. Manglende
  // opslag → riderId/teamId vises råt (degraderer læseligt, aldrig et kast).
  const riderNameById = useMemo(() => {
    const out = new Map();
    for (const r of results) {
      if (r.rider_id && r.rider && !out.has(r.rider_id)) {
        out.set(r.rider_id, `${r.rider.firstname ?? ""} ${r.rider.lastname ?? ""}`.trim());
      }
    }
    return out;
  }, [results]);

  function filterRowsByTeam(rows) {
    if (resolvedTeamFilter == null) return rows;
    return (rows || []).filter(r => String(r.team_id ?? r.rider?.team?.id) === String(resolvedTeamFilter));
  }

  // #2081 code-review: samme TeamFilterSelect-wiring optrådte identisk i både
  // etapeløbs- og enkeltdagsløbs-render-grenen — udtrukket én gang her.
  const teamFilterBar = (
    <div className="flex justify-end">
      <TeamFilterSelect value={teamFilter} onChange={setTeamFilter} teamOptions={teamOptions} hasMyTeam={myTeamId != null} t={t} />
    </div>
  );

  // Sørg for at active tab altid er gyldig når data skifter.
  useEffect(() => {
    if (!isStageRace) return;
    const valid = ["samlet", ...stageNumbers.map(n => `stage-${n}`)];
    if (!valid.includes(activeTab)) setActiveTab("samlet");
  }, [isStageRace, stageNumbers, activeTab]);

  // #2288 F — dashboard-CTA'er (TeamSelectionCtaCard, "Næste træk") linker til
  // /races/:id#selection, så manageren lander PÅ udtagelses-panelet i stedet for
  // øverst på siden. RaceSelectionPanel renderes altid nederst uanset aktiv fane
  // (se JSX nedenfor), så et enkelt scroll-into-view efter load er nok — ingen
  // tab-omskrivning nødvendig.
  useEffect(() => {
    if (loading || location.hash !== "#selection") return;
    const id = requestAnimationFrame(() => {
      document.getElementById("race-selection-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
    return () => cancelAnimationFrame(id);
  }, [loading, location.hash]);

  if (loading) return (
    <PageLoader />
  );

  if (notFound) return (
    <div className="max-w-4xl mx-auto">
      <Link to={backTo} className="text-xs text-cz-accent-t hover:underline mb-4 inline-block">{backLabel}</Link>
      <div className="text-center py-16 text-cz-3">
        <FlagIcon className="w-8 h-8 mx-auto mb-3" aria-hidden="true" />
        <p>{t("empty.raceNotFound")}</p>
      </div>
    </div>
  );

  const hasAnyResults = results.length > 0;

  return (
    // #2253: translate="no" — race-resultat-listerne opdaterer live under løb;
    // browser-oversættere der muterer tekst-noderne er samme crash-klasse som de
    // Sentry-dokumenterede NotFoundError-flader. Se PR #2272.
    <div translate="no" className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <Link to={backTo} className="text-xs text-cz-accent-t hover:underline mb-2 inline-block">{backLabel}</Link>
        <div className="flex items-center gap-2 flex-wrap">
          <h1 className="text-xl font-bold text-cz-1">{race.name}</h1>
          {(() => {
            // Visnings-status (#1828): igangværende etapeløb vises "Live" + etape-fremdrift.
            const ds = deriveRaceStatus(race.status, race.stages_completed, race.stages);
            return (
              <span className={`inline-flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-2 py-0.5 rounded-full border
                ${ds === "completed" ? "bg-cz-success-bg text-cz-success border-cz-success/30"
                  : ds === "live" ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30"
                  : "bg-cz-subtle text-cz-3 border-cz-border"}`}>
                {t(`status.${ds}`)}
                {ds === "live" && race.race_type === "stage_race" && (
                  <span className="font-mono normal-case tracking-normal">· {t("liveProgress", { done: race.stages_completed ?? 0, total: race.stages })}</span>
                )}
              </span>
            );
          })()}
        </div>
        <p className="text-cz-3 text-sm">
          {race.race_type === "stage_race"
            ? t("raceType.stageRaceWithStages", { count: race.stages })
            : t("raceType.oneDay")}
          {race.season?.number != null && ` · ${t("library.seasonOption", { number: race.season.number })}`}
        </p>
        {race.status === "scheduled" && nextStart && (
          <p className="text-cz-accent-t text-xs font-mono mt-1 tabular-nums">
            {t("detail.stageSchedule.nextStageLabel")}: {formatStageTime(nextStart.date, locale)} · {countdownText(nextStart.date, nowMs, t)}
          </p>
        )}
      </div>

      {/* S4: kommende løb — race-DNA-gestalt + etape-stribe + valgt-etape-panel
          (silhuet + finale-markør + terrain-DNA). Erstatter de stablede profilkort
          + det separate skema-kort (tider foldet ind i striben). Degraderer pænt
          hvis profilen mangler (gamle/PCM-løb → StageDetailPanel renderer intet). */}
      {race.status === "scheduled" && (
        <div className="space-y-3">
          {scheduledStageNums.length > 1 && (() => {
            const counts = bucketCounts(stageProfiles);
            return counts.length ? (
              <p className="text-cz-3 text-[11px]">
                <span className="uppercase tracking-wider font-semibold">{t("detail.raceDnaLabel")}</span>
                {" "}
                {counts.map((c, i) => (
                  <span key={c.bucket}>{i > 0 && " · "}{c.count} {t(`strategy.buckets.${c.bucket}`)}</span>
                ))}
              </p>
            ) : null;
          })()}
          <StageStripe stages={stageProfiles} activeStage={scheduledStage} onSelect={changeStage} times={stripeTimes} />
          <StageDetailPanel
            profile={profileByStage[scheduledStage]}
            stageLabel={scheduledStageNums.length > 1 ? t("detail.tabStage", { number: scheduledStage }) : undefined}
          />
        </div>
      )}

      {/* #1307: holdudtagelse for kommende løb — panelet gater selv på
          race-engine-flaget (renderer intet når backend siger enabled=false).
          S4: per-etape rute-match mod den valgte etape.
          #2288 F: id'et er scroll-målet for /races/:id#selection-dybt-links.
          #2637: panelet vises nu OGSÅ mens løbet er "live" (0 < stages_completed <
          stages) — status forbliver 'scheduled' hele afviklingen (#1825). Tidligere
          skjulte vi hele panelet bag en statisk "trup låst"-besked her, så en skadet
          rytter der blev udtaget FØR skaden ikke kunne fjernes midt i etapeløbet
          (Discord-bug). Panelet selv forhindrer stadig TILFØJELSER til en frosset
          trup (frozen-bevidst disabled-logik); kun fjernelse er tilladt, og backend
          accepterer nu en ren fjernelse selv når stages_completed>0. */}
      {race.status === "scheduled" && (
        <div id="race-selection-anchor">
          {/* Sub-4 (#2448): ruten SKAL være synlig mens man udtager — man udtager
              til et parcours, ikke til et navn. Kompakt tier: bånd, kategori-chips,
              km-akse og race-read, men ingen højdeakse eller navne (pladsen bruges
              på selve udtagelsen). Ingen rutedata → intet kort, panelet står som før. */}
          {hasRouteData(profileByStage[scheduledStage]) && (
            <div className="mb-3">
              <StageProfileCard
                profile={profileByStage[scheduledStage]}
                stageLabel={scheduledStageNums.length > 1 ? t("detail.tabStage", { number: scheduledStage }) : undefined}
                tier="compact"
              />
            </div>
          )}
          <RaceSelectionPanel
            raceId={race.id}
            selectedStageIndex={scheduledStageNums.indexOf(scheduledStage) >= 0 ? scheduledStageNums.indexOf(scheduledStage) : 0}
            selectedStageBucket={terrainBucket(profileByStage[scheduledStage]?.profile_type)}
            selectedStageProfileType={profileByStage[scheduledStage]?.profile_type ?? null}
            selectedStageFinaleType={profileByStage[scheduledStage]?.finale_type ?? null}
          />
        </div>
      )}

      {/* #2034 (Race Engine v3 S3): etape-taktik pr. rytter/etape. Vises BÅDE
          når løbet endnu ikke er startet OG mens det er live — taktik-skift
          undervejs (roller/effort for KOMMENDE etaper) er hele pointen, og
          lineup-frysningen ovenfor gælder kun startfeltet. Komponenten gater
          selv på race-engine-v3-scoring-flaget og på om holdet har ryttere i
          løbet (renderer intet ellers). */}
      {race.status === "scheduled" && race.race_type === "stage_race" && race.stages > 1 && (
        <StageRoleMatrix
          raceId={race.id}
          profileByStage={profileByStage}
          gcRows={liveStandings?.byType?.gc ?? []}
        />
      )}

      {!hasAnyResults && race.status !== "scheduled" && (
        <div className="bg-cz-card border border-cz-border rounded-cz p-10 text-center text-cz-3">
          <FlagIcon className="w-8 h-8 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm">{t("empty.noResultsImportedRace")}</p>
        </div>
      )}

      {hasAnyResults && isStageRace && (
        <>
          {/* S4: visuel etape-stribe erstatter tekst-fanerne — ét navigations-mønster
              på kommende OG kørte løb (terræn synligt pr. etape før klik). */}
          <StageStripe
            stages={stageNumbers.map((n) => profileByStage[n] || { stage_number: n, profile_type: "flat" })}
            activeStage={activeTab === "samlet" ? "overall" : Number(activeTab.slice("stage-".length))}
            showOverall
            onSelect={(v) => changeTab(v === "overall" ? "samlet" : `stage-${v}`)}
          />

          {teamFilterBar}

          {activeTab === "samlet" && (
            <div className="space-y-5">
              <RaceRecap results={results} scopeType="overall" incidents={incidents} />
              <WhyPanel moments={moments} stageNumber={stageNumbers[stageNumbers.length - 1]} mode="finalOnly" riderNameById={riderNameById} t={t} />
              <DnfSection incidents={incidents} scopeType="overall" t={t} />
              {liveStandings
                ? <LiveOverallTab byType={liveStandings.byType} stage={liveStandings.stage} filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} moments={moments} />
                : <OverallTab finalByType={finalByType} filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} moments={moments} />}
            </div>
          )}
          {stageNumbers.map(n => activeTab === `stage-${n}` && (
            <StageTab key={n} stage={n} results={results} profile={profileByStage[n]}
              filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} incidents={incidents}
              moments={moments} riderNameById={riderNameById} passages={passages} t={t} />
          ))}
        </>
      )}

      {/* Enkeltdagsløb — ingen faner, bare måltavlen (+ holdklassement hvis det findes) */}
      {hasAnyResults && !isStageRace && (
        <div className="space-y-5">
          <StageProfileSlot profile={profileByStage[1]} passages={passages} tier="full" />
          <RaceRecap results={results} scopeType="overall" incidents={incidents} />
          <WhyPanel moments={moments} stageNumber={1} mode="full" riderNameById={riderNameById} t={t} />
          <DnfSection incidents={incidents} scopeType="overall" t={t} />
          {teamFilterBar}
          <ResultTable
            title={t("detail.tableResult")}
            rows={filterRowsByTeam(finalByType.gc?.length ? finalByType.gc : results.filter(r => r.result_type === "stage").sort(byRank))}
            highlightTeamId={resolvedTeamFilter}
            moments={moments}
            stageNumber={1}
          />
          {finalByType.team?.length > 0 && (
            <ResultTable title={t("detail.classification.team")} rows={filterRowsByTeam(finalByType.team)} highlightWinner highlightTeamId={resolvedTeamFilter} />
          )}
        </div>
      )}
    </div>
  );
}

// #1311 Tekst-recap: skabelon-fortælling udledt af persisterede race_results (ren
// præsentation, ingen ny sim-mekanik). Renderer intet hvis intet kan udledes ærligt.
// S4 (#1176): incidents er optional — [] (flag off/tabel ikke migreret) giver
// samme output som før S4 (ingen abandon/notableCrash-momenter).
function RaceRecap({ results, scopeType, stageNumber, incidents }) {
  const { t } = useTranslation("races");
  const moments = useMemo(
    () => buildRaceRecap({ results, scope: { type: scopeType, stageNumber }, incidents }),
    [results, scopeType, stageNumber, incidents],
  );
  if (!moments.length) return null;
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <div className="flex items-center gap-2 mb-2">
        <FlagIcon size={14} className="text-cz-3" aria-hidden="true" />
        <p className="text-cz-2 text-xs uppercase tracking-wider font-semibold">{t("detail.recap.title")}</p>
      </div>
      <ul className="space-y-1.5">
        {moments.map((m, i) => (
          <li key={`${m.key}-${i}`} className="text-cz-1 text-sm leading-relaxed">
            {t(`detail.recap.${m.key}`, m.params)}
          </li>
        ))}
      </ul>
    </div>
  );
}

// S4 (#1176): kompakt DNF-liste — supplerer referatets (maks 2) abandon-momenter
// med den FULDE liste af udgåede for den valgte etape/hele løbet (navn, etape,
// årsag). Dormant hvis incidents=[] (flag off/tabel ikke migreret endnu) —
// ingen fejl-UI, bare intet render (samme mønster som RaceRecap).
function DnfSection({ incidents, scopeType, stageNumber, t }) {
  const rows = useMemo(() => {
    const abandons = (incidents || []).filter((inc) => inc.outcome === "abandon");
    const scoped = scopeType === "stage"
      ? abandons.filter((inc) => (inc.stage_number ?? 1) === stageNumber)
      : abandons;
    return [...scoped].sort((a, b) => (a.stage_number ?? 1) - (b.stage_number ?? 1));
  }, [incidents, scopeType, stageNumber]);

  if (!rows.length) return null;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <p className="text-cz-2 text-xs uppercase tracking-wider mb-2 font-semibold">{t("detail.incidents.title")}</p>
      <ul className="space-y-1.5">
        {rows.map((inc) => {
          const name = inc.rider ? `${inc.rider.firstname ?? ""} ${inc.rider.lastname ?? ""}`.trim() : null;
          return (
            <li key={inc.id} className="text-sm flex items-center justify-between gap-3">
              <RiderLink id={inc.rider?.id} className="text-cz-1 hover:text-cz-accent-t transition-colors truncate">
                {name || "—"}
              </RiderLink>
              <span className="text-cz-3 text-xs shrink-0 font-mono">
                {scopeType !== "stage" && `${t("detail.tabStage", { number: inc.stage_number ?? 1 })} · `}
                {t(`detail.incidents.${inc.kind === "crash" ? "crash" : "mechanical"}`)}
              </span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

// S6 (#2355): why-rapport — de Tier1 komponent-afledte beats v1-referatet
// ALDRIG kunne vise (helper-ofring, favorit-nedtur, formtop, GC-lederskifte).
// mode="full" (etape-fane): alle 5 beat-nøgler for DENNE etape. mode="finalOnly"
// ("samlet"-fanen på et etapeløb): kun final_gc — de øvrige beats er etape-
// specifikke og ville virke løsrevet uden etape-kontekst på oversigten.
// Dormant (renderer intet) hvis moments=[] (tabel ikke migreret/tom) — samme
// ærlig-degraderings-regel som RaceRecap/DnfSection.
function WhyPanel({ moments, stageNumber, mode = "full", riderNameById, t }) {
  const beats = useMemo(() => {
    if (mode === "finalOnly") return (moments || []).filter((m) => m.moment_key === "final_gc");
    return whyBeatsForStage(moments, stageNumber);
  }, [moments, stageNumber, mode]);

  const rendered = useMemo(() => {
    const riderName = (id) => (id ? riderNameById.get(id) || "—" : "—");
    return beats.map((m) => {
      const p = m.params || {};
      switch (m.moment_key) {
        case "gc_takeover":
          return { key: `${m.moment_key}-${m.stage_number}`, text: t("detail.why.gcTakeover", { rider: riderName(p.riderId), previousLeader: riderName(p.previousLeaderId) }) };
        case "final_gc": {
          const [first, second, third] = p.riderIds || [];
          return { key: `${m.moment_key}-${m.stage_number}`, text: t("detail.why.finalGc", { first: riderName(first), second: riderName(second), third: riderName(third) }) };
        }
        case "helper_shift":
          return { key: `${m.moment_key}-${m.stage_number}`, text: t("detail.why.helperShift", { captain: riderName(p.captainId), count: p.helperIds?.length ?? 0 }) };
        case "favorite_off_day":
          return { key: `${m.moment_key}-${m.stage_number}`, text: t("detail.why.favoriteOffDay", { rider: riderName(p.riderId), reason: p.reason }) };
        case "form_peak":
          return { key: `${m.moment_key}-${m.stage_number}`, text: t("detail.why.formPeak", { rider: riderName(p.riderId) }) };
        default:
          return null;
      }
    }).filter(Boolean);
  }, [beats, riderNameById, t]);

  if (!rendered.length) return null;

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <div className="flex items-center gap-2 mb-2">
        <FlagIcon size={14} className="text-cz-3" aria-hidden="true" />
        <p className="text-cz-2 text-xs uppercase tracking-wider font-semibold">{t("detail.why.title")}</p>
      </div>
      <ul className="space-y-1.5">
        {rendered.map((r) => (
          <li key={r.key} className="text-cz-1 text-sm leading-relaxed">{r.text}</li>
        ))}
      </ul>
    </div>
  );
}

// S6 (#2355): story-tag-badges — kompakte per-rytter-mærker ("offer", "peak",
// "outsider" ...) med den fulde forklaring i title-tooltippet (samme mønster
// som BreakawayMarker). stageNumber=null aggregerer på tværs af HELE løbet
// (bruges på "samlet"-fanen). Maks 2 badges pr. række — flere ville støje mere
// end de forklarer.
const MAX_STORY_TAGS_PER_ROW = 2;
function StoryTagBadges({ moments, riderId, stageNumber, t }) {
  const tags = storyTagsForRider(moments, riderId, stageNumber).slice(0, MAX_STORY_TAGS_PER_ROW);
  if (!tags.length) return null;
  return (
    <span className="inline-flex items-center gap-1 ms-1.5 align-middle">
      {tags.map((tag) => (
        <span
          key={tag.moment_key}
          title={t(`detail.storyTags.${tag.moment_key}.tooltip`)}
          className="inline-flex items-center rounded-full border border-cz-border bg-cz-subtle px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-cz-3"
        >
          {t(`detail.storyTags.${tag.moment_key}.label`)}
        </span>
      ))}
    </span>
  );
}

function OverallTab({ finalByType, filterRows, myTeamId, moments }) {
  const { t } = useTranslation("races");
  const any = CLASSIFICATIONS.some(c => finalByType[c.key]?.length > 0);
  if (!any) return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-8 text-center text-cz-3 text-sm">
      {t("detail.noOverall")}
    </div>
  );
  return (
    <div className="space-y-5">
      {CLASSIFICATIONS.map(c => {
        const rows = filterRows(finalByType[c.key]);
        if (!rows?.length) return null;
        return <ResultTable key={c.key} title={t(`detail.classification.${c.key}`)} rows={rows} highlightWinner={c.key === "team"} highlightTeamId={myTeamId} moments={moments} />;
      })}
    </div>
  );
}

// #2081: løbende klassementer for et igangværende etapeløb — samme tabeller som
// det endelige klassement, med eksplicit "stillingen efter etape N"-ramme så
// ingen forveksler den med slutresultatet.
function LiveOverallTab({ byType, stage, filterRows, myTeamId, moments }) {
  const { t } = useTranslation("races");
  return (
    <div className="space-y-5">
      <div className="bg-cz-card border border-cz-border rounded-cz px-4 py-3">
        <p className="text-sm font-semibold text-cz-1">{t("detail.liveStandings.title", { number: stage })}</p>
        <p className="text-xs text-cz-3 mt-0.5">{t("detail.liveStandings.note")}</p>
      </div>
      {CLASSIFICATIONS.map(c => {
        const rows = filterRows(byType[c.key]);
        if (!rows?.length) return null;
        return <ResultTable key={c.key} title={t(`detail.classification.${c.key}`)} rows={rows} highlightWinner={c.key === "team"} highlightTeamId={myTeamId} moments={moments} />;
      })}
    </div>
  );
}

function StageTab({ stage, results, profile, filterRows, myTeamId, incidents, moments, riderNameById, passages, t }) {
  const [classTab, setClassTab] = useState("stage");

  const rows = filterRows(classificationRowsForStage(results, stage, classTab));

  // Sub-2 (#2770): passage-grupper (KOM/mellemsprint) for DENNE etape — kun
  // relevante i "stage"-sub-fanen (måltavlen), ikke under de øvrige klassement-
  // linser (gc/points/mountain/young/team ser samme etape gennem et andet filter).
  const passageGroups = useMemo(
    () => (classTab === "stage" ? groupPassagesForStage(passages, stage) : []),
    [passages, stage, classTab],
  );

  // #2081: dag-rækkerne er nu FULDE klassementer (rank 1..N pr. etape) — trøje-
  // bæreren er eksplicit rank 1 (legacy-etaper har kun rank-1-rækker; samme filter).
  const jerseys = JERSEYS
    .map(j => ({ ...j, holder: results.find(r => r.result_type === j.dayType && (r.stage_number ?? 1) === stage && (r.rank ?? 1) === 1) }))
    .filter(j => j.holder);

  const title = classTab === "stage"
    ? t("detail.stageFinishOrder", { number: stage })
    : `${t(`detail.classTab.${classTab}`)} — ${t("detail.liveStandings.title", { number: stage })}`;

  return (
    <div className="space-y-5">
      <StageProfileSlot profile={profile} passages={passages} tier="full" />
      <RaceRecap results={results} scopeType="stage" stageNumber={stage} incidents={incidents} />
      <WhyPanel moments={moments} stageNumber={stage} mode="full" riderNameById={riderNameById} t={t} />
      <DnfSection incidents={incidents} scopeType="stage" stageNumber={stage} t={t} />
      {jerseys.length > 0 && (
        <div className="bg-cz-card border border-cz-border rounded-cz p-4">
          <p className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">{t("detail.jerseysAfterStage")}</p>
          <div className="flex flex-wrap gap-2">
            {jerseys.map(j => (
              <div key={j.dayType}
                className="flex items-center gap-2 rounded-full border border-cz-border bg-cz-subtle ps-2 pe-3 py-1">
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: j.bg, color: j.fg }}>
                  {t(`detail.jersey.${j.dayType}`)}
                </span>
                <RiderLink id={j.holder.rider?.id}
                  className="text-cz-1 text-xs font-medium hover:text-cz-accent-t transition-colors">
                  {j.holder.rider?.nationality_code && (
                    <Flag code={j.holder.rider.nationality_code} className="me-1" />
                  )}
                  {riderName(j.holder)}
                </RiderLink>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* #2081: klassement-sub-faner — samme etape, forskellig klassement-linse. */}
      <div className="flex gap-1.5 flex-wrap">
        {STAGE_CLASS_TABS.map(key => (
          <button key={key} type="button" onClick={() => setClassTab(key)}
            aria-pressed={classTab === key}
            className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all border
              ${classTab === key ? "bg-cz-accent/10 border-cz-accent/30 text-cz-accent-t" : "bg-cz-card border-cz-border text-cz-2 hover:text-cz-1"}`}>
            {t(`detail.classTab.${key}`)}
          </button>
        ))}
      </div>

      <ResultTable title={title} rows={rows} highlightWinner={classTab === "team"} highlightTeamId={myTeamId} moments={moments} stageNumber={stage} />
      {passageGroups.length > 0 && <PassageList groups={passageGroups} t={t} />}
    </div>
  );
}

// Sub-2 (#2770): passage-liste — KOM/mellemsprint-krydsninger UNDER etapens
// måltavle. Kompakt blok pr. waypoint (samme kort-stil som DnfSection/WhyPanel
// ovenfor), ikke en ny tabel — waypoints har typisk 3-6 pointerende ryttere,
// en fuld tabel ville være overkill. Top-3 pr. waypoint (matcher hvor mange
// der reelt scorer i racePassages.js's skalaer for de fleste kategorier).
const PASSAGE_TOP_N = 3;
function PassageList({ groups, t }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4">
      <p className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">{t("detail.passages.title")}</p>
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={`${g.waypoint_kind}:${g.waypoint_index}`}>
            <p className="text-cz-3 text-[11px] mb-1">
              <span className="uppercase tracking-wide font-semibold text-cz-2">
                {t(`detail.passages.${g.waypoint_kind}`)}
              </span>
              {" · "}
              {g.waypoint_kind === "kom" && g.climb_category
                ? `${g.waypoint_name} (${t("detail.passages.category", { cat: g.climb_category })}) — km ${formatNumber(g.waypoint_km)}`
                : `${g.waypoint_name} — km ${formatNumber(g.waypoint_km)}`}
            </p>
            <ul className="space-y-0.5">
              {g.results.slice(0, PASSAGE_TOP_N).map((r) => (
                <li key={`${r.rider_id}-${r.passage_rank}`} className="text-cz-1 text-sm flex items-baseline gap-2">
                  <span className="text-cz-3 font-mono text-xs w-4 shrink-0">{r.passage_rank}.</span>
                  <RiderLink id={r.rider_id} className="hover:text-cz-accent-t transition-colors truncate">
                    {r.rider_name || "—"}
                  </RiderLink>
                  <span className="text-cz-3 text-xs shrink-0 ms-auto font-mono">
                    {r.points > 0 && t("detail.passages.points", { count: r.points })}
                    {r.points > 0 && r.bonus_seconds > 0 && " "}
                    {r.bonus_seconds > 0 && t("detail.passages.bonus", { count: r.bonus_seconds })}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

// #1485 Holdklassement-række: holdet ER entiteten (ingen rytter, ingen flag/breakaway).
// highlightWinner = true på holdklassementet → rank 1 får accent + "Winner"-markør,
// så man kan SE hvem der vandt holdkonkurrencen i stedet for at grave i en tabel.
function ResultEntityCell({ row, highlightWinner, t, moments, stageNumber }) {
  const entity = resultEntity(row);
  const isWinner = highlightWinner && row.rank === 1;
  if (entity.kind === "team") {
    return (
      <span className="inline-flex items-center gap-2">
        <TeamLink id={entity.linkId}
          className={`hover:text-cz-accent-t transition-colors ${isWinner ? "text-cz-accent-t font-semibold" : "text-cz-1"}`}>
          {entity.name || "—"}
        </TeamLink>
        {isWinner && (
          <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-wide text-cz-accent-t"
            aria-label={t("detail.team.winner")}>
            <FlagIcon size={11} aria-hidden="true" />{t("detail.team.winner")}
          </span>
        )}
      </span>
    );
  }
  return (
    <RiderLink id={entity.linkId}
      className="cursor-pointer hover:text-cz-accent-t transition-colors block">
      <span className="text-cz-1">
        {entity.nationality && (<Flag code={entity.nationality} className="me-1" />)}
        {entity.name || "—"}
        <BreakawayMarker result={row} t={t} />
        {entity.linkId && <StoryTagBadges moments={moments} riderId={entity.linkId} stageNumber={stageNumber} t={t} />}
      </span>
    </RiderLink>
  );
}

function ResultTable({ title, rows, highlightWinner = false, highlightTeamId = null, defaultLimit = 10, moments = [], stageNumber = null }) {
  const { t } = useTranslation("races");
  const [expanded, setExpanded] = useState(false);
  const showPoints = rows.some(r => (r.points_earned ?? 0) > 0);
  // Gap-kolonne kun når motoren har skrevet tider (stage/gc fra Race Engine v2);
  // gamle PCM-løb og point/bjerg/ungdom/hold-klassementer har tom finish_time.
  const showTime = rows.some(r => r.finish_time);
  // Holdklassement (rider_id=null) har ingen rytter-team-kolonne at vise.
  const showTeamCol = rows.some(r => resultEntity(r).kind === "rider");
  // #2081 (Discord-ønske): top-10 default + "Show all N"-knap, når feltet er stort.
  const collapsible = rows.length > defaultLimit;
  const visibleRows = collapsible && !expanded ? rows.slice(0, defaultLimit) : rows;
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border flex items-center justify-between gap-3">
        <h2 className="font-semibold text-cz-1 text-sm">{title}</h2>
        {collapsible && (
          <button type="button" onClick={() => setExpanded(e => !e)}
            aria-pressed={expanded}
            className="text-xs text-cz-accent-t hover:underline shrink-0">
            {expanded ? t("detail.showLess") : t("detail.showAll", { count: rows.length })}
          </button>
        )}
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-cz-3 text-sm">{t("detail.noResults")}</div>
      ) : (
        <table data-sort-exempt="Loebsresultat, sorteret paa placering (rank)" className="w-full text-sm">
          <tbody className="divide-y divide-cz-border">
            {visibleRows.map(r => {
              const isWinner = highlightWinner && r.rank === 1;
              const isMyTeam = highlightTeamId != null && String(r.team_id) === String(highlightTeamId);
              return (
              <tr key={r.id} className={`transition-colors ${isWinner ? "bg-cz-accent/10" : isMyTeam ? "bg-cz-accent/5" : "hover:bg-cz-subtle"}`}>
                <td className={`px-4 py-2 w-10 font-mono text-xs ${isWinner ? "text-cz-accent-t" : "text-cz-3"}`}>{r.rank ?? "—"}</td>
                <td className="px-2 py-2">
                  <ResultEntityCell row={r} highlightWinner={highlightWinner} t={t} moments={moments} stageNumber={stageNumber} />
                </td>
                {showTeamCol && (
                  <td className="px-2 py-2 text-cz-3 text-xs">
                    {resultEntity(r).kind === "rider" && (
                      <TeamLink id={r.rider?.team?.id} className="hover:text-cz-accent-t transition-colors">
                        {r.rider?.team?.name || r.team_name || t("common.free")}
                      </TeamLink>
                    )}
                  </td>
                )}
                {showTime && (
                  <td className="px-3 py-2 text-right text-cz-2 font-mono text-xs whitespace-nowrap tabular-nums">
                    {r.finish_time || ""}
                  </td>
                )}
                {showPoints && (
                  <td className="px-4 py-2 text-right text-cz-accent-t font-mono text-xs whitespace-nowrap">
                    {(r.points_earned ?? 0) > 0 ? `${formatNumber(r.points_earned)} pt` : ""}
                  </td>
                )}
              </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}
