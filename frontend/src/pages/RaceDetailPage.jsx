import { useState, useEffect, useCallback, useMemo, lazy, Suspense } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useParams, useSearchParams, useLocation } from "react-router";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import CareerFirstMomentRow from "../components/CareerFirstMomentRow";
import RaceSelectionPanel from "../components/race/RaceSelectionPanel.jsx";
import StageRoleMatrix from "../components/race/StageRoleMatrix.jsx";
import StageStripe from "../components/race/StageStripe.jsx";
import StageDetailPanel from "../components/race/StageDetailPanel.jsx";
import { Flag } from "../components/Flag";
import {
  FlagIcon,
  PageLoader,
  Button,
  CategoryTag,
  Section,
  SectionStack,
  SectionHeader,
  EmptyState,
  ErrorState,
  Tabs,
  TabList,
  Tab,
  CollapsibleSection,
} from "../components/ui";
import { WRAP, SCROLLER } from "../components/ui/dataTableStyles.js";
import { formatNumber } from "../lib/intl";
import { resultEntity } from "../lib/raceResultEntity.js";
import { buildRaceRecap } from "../lib/raceRecap.js";
import { buildRaceReport } from "../lib/raceReport.js";
import { fetchAllRows } from "../lib/supabasePagination";
import { logEvent } from "../lib/logEvent";
import { deriveRaceStatus } from "../lib/raceHubLogic.js";
import { buildLiveStandings } from "../lib/raceLiveStandings.js";
import { classificationRowsForStage } from "../lib/raceStageClassifications.js";
import { bucketCounts, terrainBucket } from "../lib/stageTerrain.js";
import { RACE_TIMEZONE, countdownParts, countdownSegments } from "../lib/stageScheduleConfig.js";
import { whyBeatsForStage, storyTagsForRider } from "../lib/raceStageMoments.js";
import { groupPassagesForStage } from "../lib/raceStagePassages.js";
import { classificationPointTotals } from "../lib/raceClassificationTotals.js";
import { hasRouteData } from "../lib/stageRouteProfile.js";
import { buildFinalKilometrePlayback } from "../lib/finalKilometre.js";
import StageProfileCard from "../components/race/StageProfileCard.jsx";
import LegacyStageProfileCard from "../components/race/LegacyStageProfileCard.jsx";
import StoryOfTheStageSection from "../components/race/StoryOfTheStageSection.jsx";

// #3914: FinalKilometrePlayback vises nu bag en stille knap (StoryOfTheStage-
// Section, "The Final Kilometre") i stedet for altid-øverst — lazy-loadet
// (eget chunk) så bundle-vagtens luft holder uanset hvor mange der besøger
// etape-fanen uden nogensinde at åbne afspilningen.
const FinalKilometrePlayback = lazy(() => import("../components/race/FinalKilometrePlayback.jsx"));

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
//
// #2849 bølge 3: migreret til T3 (profil/detail-skabelonen, docs/design/
// PAGE_TEMPLATES.md) — hero-bånd (tilbage-link → kategori-tags/meta → titel →
// primary-CTA → stat-række) + max-w-5xl indhold. FØRSTE T3-migrering i repoet.
// StageStripe (etape-navigation) migreres BEVIDST IKKE til ui/Tabs — den bærer
// terræn-/tids-information pr. etape som almindelige tekst-faner ville tabe;
// se PR-beskrivelsen for begrundelsen. classTab-under-fanerne (stage/gc/points/
// mountain/young/team, fast kardinalitet 6) migreres derimod til ui/Tabs.

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
// #2818: hasClassifications = findes bjerg-/pointkonkurrencen overhovedet i
// dette løb? I virkelig cykelsport gør den KUN det i etapeløb — de er per
// definition akkumulerende konkurrencer over flere dage. Paris-Roubaix og
// Milano-Sanremo har ingen prikket trøje, kun én vinder. Ruten må gerne vise
// kategoriserede stigninger (det gør ægte klassikere også — Koppenberg, Poggio),
// men der må ikke stå point på spil. Backendens racePassages.js gater allerede
// korrekt på isStageRace; det var kun fladen der lovede noget den ikke indfrier.
function StageProfileSlot({ profile, stageLabel, passages, tier, hasClassifications = true }) {
  if (hasRouteData(profile)) {
    return <StageProfileCard profile={profile} stageLabel={stageLabel} passages={passages} tier={tier} hasClassifications={hasClassifications} />;
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

// #2849 bølge 3 — T3 hero stat-blok (label 10px uppercase · value 20px/650
// data-font tabular · optional 11px sub). Sidste blok i rækken udelader
// højre-rule (spec: "24px padding/margin"-adskillelse mellem blokke).
function HeroStatBlock({ label, value, sub, last = false }) {
  return (
    <div className={`shrink-0 ${last ? "" : "pe-6 me-6 border-e border-cz-border"}`}>
      <div className="font-data text-3xs font-semibold uppercase tracking-[.1em] text-cz-3 mb-1">{label}</div>
      <div className="font-data text-[20px] font-[650] leading-tight text-cz-1 tabular-nums whitespace-nowrap">{value}</div>
      {sub && <div className="font-data text-2xs text-cz-3 mt-0.5 whitespace-nowrap">{sub}</div>}
    </div>
  );
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
  const [careerEvents, setCareerEvents] = useState([]);
  const [passages, setPassages] = useState([]);
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  // #2849 bølge 3: adskiller "løbet findes ikke" fra "hentningen fejlede" —
  // tidligere blev BEGGE vist som "Race not found" uden nogen retry-mulighed,
  // hvilket skjulte en ægte netværks-/query-fejl bag en misvisende besked
  // (audit-fund: silent degradation on fetch error).
  const [loadError, setLoadError] = useState(false);
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
    setLoadError(false);

    // #3197: pool_race:pool_race_id(date_text) blev tidligere hentet med her men
    // ALDRIG rendert nogen steder på siden — ren over-fetch. date_text er en rå
    // "dd/mm"-dato importeret fra et real-world løbskalender-regneark (ingen
    // forbindelse til spillets faktiske kalender, se lib/raceCompletionDate.js);
    // fjernet som del af dato-oprydningen på resultat-fladen.
    const { data: raceRow, error } = await supabase
      .from("races")
      .select("id, name, race_type, race_class, stages, stages_completed, edition_year, status, season:season_id(id, number)")
      .eq("id", raceId)
      .single();

    // #2849 bølge 3: en ægte query-/netværksfejl (error != null) er noget andet
    // end en gyldig "løbet findes ikke" (error null, raceRow null — fx forkert
    // id). Kun sidstnævnte er notFound; førstnævnte får en retry-mulighed.
    if (error) {
      console.warn("RaceDetailPage: races fetch failed:", error.message);
      setLoadError(true);
      setLoading(false);
      return;
    }
    if (!raceRow) {
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
        .select("id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, finish_time, points_earned, prize_money, sprint_points, kom_points, in_breakaway, breakaway_caught, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name)), team:team_id(id, name)")
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

    // #3398 (Maiden Win Engine): career-firsts for DETTE løb (maiden win/første
    // podium/første trøje/klub-milepæl). Samme degradér-ærligt-mønster —
    // tabellen committes som .sql men anvendes først af ejeren POST-merge.
    const careerEventsPromise = supabase
      .from("rider_career_events")
      .select("id, event_type, rider_id, rider_name, team_name, params, significance")
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

    const [myTeamId, rows, { data: profiles }, { data: scheduleRows }, { data: incidentRows, error: incidentsError }, { data: momentRows, error: momentsError }, { data: careerEventRows, error: careerEventsError }, passageRows] = await Promise.all([
      myTeamPromise, rowsPromise, profilesPromise, schedulePromise, incidentsPromise, momentsPromise, careerEventsPromise, passagesPromise,
    ]);
    if (incidentsError) {
      console.warn("race_incidents fetch failed (table may not be migrated yet):", incidentsError.message);
    }
    if (momentsError) {
      console.warn("race_stage_moments fetch failed (table may not be migrated yet):", momentsError.message);
    }
    if (careerEventsError) {
      console.warn("rider_career_events fetch failed (table may not be migrated yet):", careerEventsError.message);
    }

    setMyTeamId(myTeamId);
    setRace(raceRow);
    setResults(rows);
    setStageProfiles(profiles ?? []);
    setSchedule(scheduleRows ?? []);
    setIncidents(incidentRows ?? []);
    setMoments(momentRows ?? []);
    setCareerEvents(careerEventRows ?? []);
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

  // Kontekst-bevarende tilbage-link (board/dashboard/arkiv).
  // #3102 etape 2: arkivet er en fane i Resultat-hubben nu, ikke på /races.
  const backFrom = location.state?.from;
  const backTo = backFrom === "board" ? "/races" : backFrom === "dashboard" ? "/dashboard" : "/resultater?tab=archive";
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

  // #3519: sprint-/bjergkonkurrence-point-TOTALER pr. rytter — mountain_day/
  // points_day-rækkerne (liveStandings) bærer kun rangen, ikke pointtallet bag
  // den, så en spiller kan ikke se HVOR TÆT/LANGT han er fra podiet. Live =
  // "efter seneste kørte etape" (samme etape som liveStandings.stage); Final =
  // alle etaper (løbet er afgjort). Begge kun relevante mens der er resultater.
  const liveClassificationTotals = useMemo(
    () => (liveStandings ? classificationPointTotals(results, profileByStage, liveStandings.stage) : null),
    [results, profileByStage, liveStandings],
  );
  const finalClassificationTotals = useMemo(
    () => classificationPointTotals(results, profileByStage, null),
    [results, profileByStage],
  );

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

  // #2356 (S2: race-recap v2) — samme opslags-mønster som riderNameById lige
  // ovenfor, blot for hold (moments refererer kun team_id, aldrig navnet).
  const teamNameById = useMemo(() => {
    const out = new Map();
    for (const r of results) {
      const id = r.rider?.team?.id ?? r.team_id;
      const name = r.rider?.team?.name ?? r.team_name;
      if (id != null && name && !out.has(String(id))) out.set(String(id), name);
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

  // #2849 bølge 3: hero-CTA'en ("Set your line-up") scroller til samme anker som
  // #selection-dybt-linket ovenfor — samme mål, blot udløst af et klik i stedet
  // for en URL-hash ved load.
  const scrollToSelection = useCallback(() => {
    document.getElementById("race-selection-anchor")?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // Full-bleed-ruten får ingen Layout-padding — loading/fejl/not-found-grenene
  // sætter derfor selv side-padding, nu efter T3-kort-revisionens ydre
  // container-opskrift (#2849 bølge 5c: pt-4 md:pt-6, samme som kortet nedenfor).
  if (loading) return (
    <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
      <PageLoader />
    </div>
  );

  if (loadError) return (
    <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
      <Link to={backTo} className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3">{backLabel}</Link>
      <ErrorState
        description={t("detail.loadError.message")}
        action={<Button size="sm" variant="secondary" onClick={loadAll}>{t("detail.loadError.retry")}</Button>}
      />
    </div>
  );

  if (notFound) return (
    <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
      <Link to={backTo} className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3">{backLabel}</Link>
      <EmptyState icon={<FlagIcon size={26} aria-hidden="true" />} title={t("empty.raceNotFound")} />
    </div>
  );

  const hasAnyResults = results.length > 0;
  const ds = deriveRaceStatus(race.status, race.stages_completed, race.stages);

  // #2849 bølge 3: hero stat-række — statisk sammensat efter hvad der findes
  // (stage-only felter udelades for endagsløb, næste-etape kun mens scheduled).
  // Sidste blok markeres `last` (ingen højre-rule) af render-loopet nedenfor.
  const statBlocks = [
    {
      label: t("detail.stat.status"),
      value: t(`status.${ds}`),
      sub: ds === "live" && race.race_type === "stage_race"
        ? t("liveProgress", { done: race.stages_completed ?? 0, total: race.stages })
        : null,
    },
    ...(race.race_type === "stage_race" ? [{ label: t("detail.stat.stages"), value: String(race.stages) }] : []),
    ...(race.season?.number != null ? [{ label: t("detail.stat.season"), value: String(race.season.number) }] : []),
    ...(race.status === "scheduled" && nextStart ? [{
      label: t("detail.stat.nextStage"),
      value: formatStageTime(nextStart.date, locale),
      sub: countdownText(nextStart.date, nowMs, t),
    }] : []),
  ];

  return (
    // #2253: translate="no" — race-resultat-listerne opdaterer live under løb;
    // browser-oversættere der muterer tekst-noderne er samme crash-klasse som de
    // Sentry-dokumenterede NotFoundError-flader. Se PR #2272.
    <div translate="no">
      {/* #2849 bølge 5c: T3-revision (ejer 24/7, 2. iteration) — hero'en er et KORT,
          ikke et full-bleed bånd. Layout's full-bleed-route-bucket giver stadig denne
          rute ingen padding/cap; siden ejer selv back-link + kort-ramme + indre
          max-w-5xl. Løb har ingen portrætter → intet identitets-slot (spec: entity
          pages without portraits omit the slot). Navn FØRST, tags/meta UNDER (samme
          princip som RiderProfileHero: navnet er sidens vigtigste ord, tags er
          metadata). */}
      <div className="max-w-5xl mx-auto pt-4 md:pt-6 px-4 md:px-8">
        <Link to={backTo} className="inline-flex items-center gap-1 text-xs font-medium text-cz-2 hover:text-cz-1 transition-colors mb-3">
          {backLabel}
        </Link>

        <section className="bg-cz-card border border-cz-border border-t-2 border-t-cz-accent rounded-cz overflow-hidden px-4 md:px-6 pt-5 pb-5">
          <div className="flex items-start justify-between gap-4 flex-wrap sm:flex-nowrap">
            <div className="min-w-0">
              <h1 className="font-display text-[40px] leading-[.92] uppercase text-cz-1 break-words">{race.name}</h1>
              <div className="flex items-center gap-2 flex-wrap mt-2.5">
                {race.race_class && <CategoryTag>{t(`classOption.${race.race_class}`)}</CategoryTag>}
                <CategoryTag>{race.race_type === "stage_race" ? t("raceType.stageRace") : t("raceType.oneDayShort")}</CategoryTag>
                <span className="font-data text-2xs uppercase tracking-[.08em] text-cz-3">
                  {race.race_type === "stage_race" ? t("raceType.stages", { count: race.stages }) : t("raceType.oneDayShort")}
                  {race.season?.number != null && ` · ${t("library.seasonOption", { number: race.season.number })}`}
                </span>
              </div>
            </div>
            {/* #3914: sidens ENE gold-knap FØR resultater findes — "Review tactics"
                (genbruger discoverCta-scroll-mekanikken, ny tekst). Når løbet har
                resultater flytter gold-rollen til "Watch the race film" på
                etape-fanen i stedet (se StoryOfTheStageSection) — aldrig begge
                samtidig (PAGE_TEMPLATES.md: én gold primary-knap pr. view). */}
            {!hasAnyResults && race.status === "scheduled" && (
              <div className="flex gap-2 flex-none">
                <Button size="sm" onClick={scrollToSelection}>{t("raceCentre.action.reviewTactics")}</Button>
              </div>
            )}
          </div>
          <div className="flex mt-5 pt-4 border-t border-cz-border overflow-x-auto">
            {statBlocks.map((b, i) => (
              <HeroStatBlock key={b.label} label={b.label} value={b.value} sub={b.sub} last={i === statBlocks.length - 1} />
            ))}
          </div>
        </section>

        {/* #3398 (Maiden Win Engine): career-first-momentkort for DETTE løb —
            placeret UNDER hero'en, over StageStripen, så det er synligt uanset
            hvilken etape-fane der er valgt (momenterne er hele-løbs-begivenheder,
            ikke etape-scopede tabs). Renderer intet uden data. */}
        {careerEvents.length > 0 && (
          <div className="mt-5 bg-cz-card border border-cz-border rounded-cz p-4">
            {careerEvents.map((event) => (
              <CareerFirstMomentRow key={event.id} event={event} t={t} showRaceLink={false} />
            ))}
          </div>
        )}

        {/* StageStripe: placeret mellem kort og indhold (ikke i kortets bund) — den er
            sidens primære sub-navigation for etapeløb (kommende-etape-vælger eller
            Overall/etape-N), samme position som RiderProfileTabs indtager under
            rytterkortet. Migreres BEVIDST ikke til tekst-faner (bærer terræn-/
            tidsinformation pr. etape som ui/Tabs ville tabe — se filens toppkommentar). */}
        {race.status === "scheduled" && (
          <div className="mt-5 flex flex-col gap-3">
            {scheduledStageNums.length > 1 && (() => {
              const counts = bucketCounts(stageProfiles);
              return counts.length ? (
                <p className="text-cz-3 text-2xs">
                  <span className="uppercase tracking-wider font-semibold">{t("detail.raceDnaLabel")}</span>
                  {" "}
                  {counts.map((c, i) => (
                    <span key={c.bucket}>{i > 0 && " · "}{c.count} {t(`strategy.buckets.${c.bucket}`)}</span>
                  ))}
                </p>
              ) : null;
            })()}
            <StageStripe stages={stageProfiles} activeStage={scheduledStage} onSelect={changeStage} times={stripeTimes} />
          </div>
        )}
        {hasAnyResults && isStageRace && (
          <div className="mt-5">
            <StageStripe
              stages={stageNumbers.map((n) => profileByStage[n] || { stage_number: n, profile_type: "flat" })}
              activeStage={activeTab === "samlet" ? "overall" : Number(activeTab.slice("stage-".length))}
              showOverall
              onSelect={(v) => changeTab(v === "overall" ? "samlet" : `stage-${v}`)}
            />
          </div>
        )}
      </div>

      <div className="max-w-5xl mx-auto pt-5 px-4 md:px-8 pb-24 md:pb-16">
        <div className="flex flex-col gap-[14px]">

          {/* #3914 (ejer-godkendt 18/8, #3859-kontrakt): FØR-tilstand — løbet
              har endnu INGEN resultater. Rute-nøglepunkter + opstilling/taktik
              vises ÅBNE (uændret indhold fra før #3914). Scopet eksplicit til
              !hasAnyResults nu — tidligere brugte disse tre blokke det bredere
              race.status==="scheduled" (som OGSÅ dækker et løb der er live,
              #1825), hvilket stablede dem oven på resultat-fanerne. Se
              resultat-tilstanden længere nede for den nye rækkefølge. */}
          {!hasAnyResults && race.status === "scheduled" && (
            <StageDetailPanel
              profile={profileByStage[scheduledStage]}
              stageLabel={scheduledStageNums.length > 1 ? t("detail.tabStage", { number: scheduledStage }) : undefined}
            />
          )}

          {/* #1307: holdudtagelse for kommende løb — panelet gater selv på
              race-engine-flaget (renderer intet når backend siger enabled=false).
              S4: per-etape rute-match mod den valgte etape.
              #2288 F: id'et er scroll-målet for /races/:id#selection-dybt-links +
              hero-CTA'en ovenfor. */}
          {!hasAnyResults && race.status === "scheduled" && (
            <div id="race-selection-anchor" className="flex flex-col gap-3">
              {/* Sub-4 (#2448): ruten SKAL være synlig mens man udtager — man udtager
                  til et parcours, ikke til et navn. Kompakt tier: bånd, kategori-chips,
                  km-akse og race-read, men ingen højdeakse eller navne (pladsen bruges
                  på selve udtagelsen). Ingen rutedata → intet kort, panelet står som før. */}
              {hasRouteData(profileByStage[scheduledStage]) && (
                <StageProfileCard
                  profile={profileByStage[scheduledStage]}
                  stageLabel={scheduledStageNums.length > 1 ? t("detail.tabStage", { number: scheduledStage }) : undefined}
                  tier="compact"
                />
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

          {/* #2034 (Race Engine v3 S3): etape-taktik pr. rytter/etape. */}
          {!hasAnyResults && race.status === "scheduled" && race.race_type === "stage_race" && race.stages > 1 && (
            <StageRoleMatrix
              raceId={race.id}
              profileByStage={profileByStage}
              gcRows={liveStandings?.byType?.gc ?? []}
            />
          )}

          {!hasAnyResults && race.status !== "scheduled" && (
            <EmptyState icon={<FlagIcon size={28} aria-hidden="true" />} title={t("empty.noResultsImportedRace")} />
          )}

          {/* #3914: LØB MED RESULTATER (live eller completed) — resultatet
              vises DIREKTE (faner + tabel FØRST, se StageTab/OverallTab), de
              tidligere altid-åbne panellerne (opstilling, taktik) flyttet ned i
              foldede sektioner nedenfor. */}
          {hasAnyResults && isStageRace && (
            <div className="flex flex-col gap-[14px]">
              {/* Etape-stribe (Overall/etape-N) sidder under kortet, se ovenfor. */}
              {teamFilterBar}

              {activeTab === "samlet" && (
                <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[14px] items-start">
                  <SectionStack>
                    {liveStandings
                      ? <LiveOverallTab byType={liveStandings.byType} stage={liveStandings.stage} filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} myOwnTeamId={myTeamId} moments={moments} pointsTotals={liveClassificationTotals} />
                      : <OverallTab finalByType={finalByType} filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} myOwnTeamId={myTeamId} moments={moments} pointsTotals={finalClassificationTotals} />}
                  </SectionStack>
                  <SectionStack>
                    <RaceRecap results={results} scopeType="overall" incidents={incidents} />
                    <WhyPanel moments={moments} stageNumber={stageNumbers[stageNumbers.length - 1]} mode="finalOnly" riderNameById={riderNameById} t={t} />
                    <DnfSection incidents={incidents} scopeType="overall" t={t} />
                  </SectionStack>
                </div>
              )}
              {stageNumbers.map(n => activeTab === `stage-${n}` && (
                <StageTab key={n} stage={n} results={results} profile={profileByStage[n]} profileByStage={profileByStage}
                  filterRows={filterRowsByTeam} myTeamId={resolvedTeamFilter} myOwnTeamId={myTeamId} incidents={incidents}
                  moments={moments} riderNameById={riderNameById} teamNameById={teamNameById}
                  raceId={race.id} raceName={race.name} passages={passages} t={t} />
              ))}
            </div>
          )}

          {/* Enkeltdagsløb — ingen faner, bare måltavlen (+ holdklassement hvis det findes) */}
          {hasAnyResults && !isStageRace && (
            <div className="flex flex-col gap-[14px]">
              <StageProfileSlot profile={profileByStage[1]} passages={passages} tier="full" hasClassifications={false} />
              {teamFilterBar}
              <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[14px] items-start">
                <SectionStack>
                  <ResultTable
                    title={t("detail.tableResult")}
                    rows={filterRowsByTeam(finalByType.gc?.length ? finalByType.gc : results.filter(r => r.result_type === "stage").sort(byRank))}
                    highlightTeamId={resolvedTeamFilter}
                    myOwnTeamId={myTeamId}
                    moments={moments}
                    stageNumber={1}
                  />
                  {finalByType.team?.length > 0 && (
                    <ResultTable title={t("detail.classification.team")} rows={filterRowsByTeam(finalByType.team)} highlightWinner highlightTeamId={resolvedTeamFilter} myOwnTeamId={myTeamId} />
                  )}
                </SectionStack>
                <SectionStack>
                  <RaceRecap results={results} scopeType="overall" incidents={incidents} />
                  <WhyPanel moments={moments} stageNumber={1} mode="full" riderNameById={riderNameById} t={t} />
                  <DnfSection incidents={incidents} scopeType="overall" t={t} />
                </SectionStack>
              </div>
            </div>
          )}

          {/* #3914: FOLDEDE sektioner (skjult som default) — kun mens løbet
              stadig er "i gang" (race.status forbliver "scheduled" gennem hele
              afviklingen, #1825; bliver noget andet først når det er 100%
              færdigt). Opstilling + etape-taktik flyttet hertil FRA toppen af
              siden — samme paneler/props som FØR-tilstanden ovenfor, blot
              collapsed. `defaultOpen` på udtagelses-sektionen respekterer et
              /races/:id#selection-dybt-link (samme scroll-mål/anker som før,
              #2288 F — CollapsibleSection's <details> udfoldes automatisk når
              linket peger direkte på den). #2637: fjernelse af skadede ryttere
              er fortsat muligt fra en frosset trup — panelet selv håndterer det. */}
          {hasAnyResults && race.status === "scheduled" && (
            <div id="race-selection-anchor" className="flex flex-col gap-[14px]">
              <CollapsibleSection title={t("selection.title")} defaultOpen={location.hash === "#selection"}>
                <div className="flex flex-col gap-3">
                  {hasRouteData(profileByStage[scheduledStage]) && (
                    <StageProfileCard
                      profile={profileByStage[scheduledStage]}
                      stageLabel={scheduledStageNums.length > 1 ? t("detail.tabStage", { number: scheduledStage }) : undefined}
                      tier="compact"
                    />
                  )}
                  <RaceSelectionPanel
                    raceId={race.id}
                    selectedStageIndex={scheduledStageNums.indexOf(scheduledStage) >= 0 ? scheduledStageNums.indexOf(scheduledStage) : 0}
                    selectedStageBucket={terrainBucket(profileByStage[scheduledStage]?.profile_type)}
                    selectedStageProfileType={profileByStage[scheduledStage]?.profile_type ?? null}
                    selectedStageFinaleType={profileByStage[scheduledStage]?.finale_type ?? null}
                  />
                </div>
              </CollapsibleSection>
              {race.race_type === "stage_race" && race.stages > 1 && (
                <CollapsibleSection title={t("stageTactics.title")}>
                  <StageRoleMatrix
                    raceId={race.id}
                    profileByStage={profileByStage}
                    gcRows={liveStandings?.byType?.gc ?? []}
                  />
                </CollapsibleSection>
              )}
            </div>
          )}
        </div>
      </div>
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
    <Section>
      <SectionHeader title={
        <span className="inline-flex items-center gap-2">
          <FlagIcon size={14} className="text-cz-3" aria-hidden="true" />
          {t("detail.recap.title")}
        </span>
      } />
      <ul className="space-y-1.5">
        {moments.map((m, i) => (
          <li key={`${m.key}-${i}`} className="text-cz-1 text-sm leading-relaxed">
            {t(`detail.recap.${m.key}`, m.params)}
          </li>
        ))}
      </ul>
    </Section>
  );
}

// #2356 (S2: race-recap v2) — sekunder → "M:SS", samme afrunding som
// raceRecap.js's private formatClock (duplikeret bevidst, ren præsentation).
function formatMarginSeconds(sec) {
  const s = Math.max(0, Math.round(Number(sec) || 0));
  const m = Math.floor(s / 60);
  const rem = s % 60;
  return `${m}:${String(rem).padStart(2, "0")}`;
}

// #2356: params pr. moment_key til report.headline.*/lede.*/beat.* — samme
// switch-mønster som WhyPanel nedenfor, blot for de flere skabelon-familier
// raceReport.js's plan producerer. Fog-gate: interpolerer UDELUKKENDE navne
// (opslået lokalt) + de samme allerede-offentlige numeriske felter WhyPanel/
// StoryTagBadges/raceRecap.js allerede bruger (count, gapSeconds→marginText,
// rank) — aldrig et rå komponent-tal.
function headlineParamsFor(moment, { riderName, raceName }) {
  const p = moment.params || {};
  switch (moment.moment_key) {
    case "close_win":
    case "solo_win":
      return { rider: riderName(p.riderId), marginText: formatMarginSeconds(p.gapSeconds) };
    case "final_gc": {
      const [first] = p.riderIds || [];
      return { rider: riderName(first), race: raceName || "" };
    }
    case "sprint_win":
    case "breakaway_survived":
    case "gc_takeover":
    default:
      return { rider: riderName(p.riderId) };
  }
}

function ledeParamsFor(winMoment, ledeKey, { riderName, teamName }) {
  const p = winMoment.params || {};
  const base = { rider: riderName(p.riderId), team: teamName(winMoment.team_ids?.[0]) };
  return ledeKey === "solo" ? { ...base, marginText: formatMarginSeconds(p.gapSeconds) } : base;
}

function beatParamsFor(moment, { riderName, teamName }) {
  const p = moment.params || {};
  switch (moment.moment_key) {
    case "breakaway_caught":
    case "breakaway_survived":
      return { count: p.count ?? 0 };
    case "helper_shift":
      return { team: teamName(p.teamId), captain: riderName(p.captainId), count: p.helperIds?.length ?? 0 };
    case "gc_takeover":
      return { rider: riderName(p.riderId), previousLeader: riderName(p.previousLeaderId) };
    case "team_day":
      return { team: teamName(p.teamId), count: p.count ?? 0 };
    case "form_peak":
    case "favorite_off_day":
    case "tag_aggression_no_cost":
    case "tag_saved_effort":
    case "tag_gave_everything":
    default:
      return { rider: riderName(p.riderId) };
  }
}

// #2356 (S2: race-recap v2) — dramaturgisk etaperapport oven på de persisterede
// race_stage_moments (raceReport.js VÆLGER/ORDNER/VARIERER, denne komponent
// interpolerer). Erstatter v1 (RaceRecap) på etape-fanen NÅR momenter findes for
// etapen; degraderer ærligt til v1 for gamle/PCM-løb (buildRaceReport → null,
// spec A4 "v1-koden genbruges som fallback-udleder"). "Dit hold" er klient-side
// personalisering — ingen ny persistering, ingen data forlader klienten.
function RaceReportPanel({ raceId, raceName, stageNumber, moments, results, incidents, myTeamId, riderNameById, teamNameById, t }) {
  const report = useMemo(
    () => buildRaceReport({ raceId, stageNumber, moments }),
    [raceId, stageNumber, moments],
  );

  const riderName = (id) => (id ? riderNameById.get(id) || "—" : "—");
  const teamName = (id) => (id ? teamNameById.get(String(id)) || "—" : "—");

  const myTeamBlock = useMemo(() => {
    if (myTeamId == null || !report) return null;
    const stageRows = (results || []).filter((r) =>
      r.result_type === "stage" && (r.stage_number ?? 1) === stageNumber
      && String(r.team_id ?? r.rider?.team?.id) === String(myTeamId)
    );
    if (!stageRows.length) return { none: true };
    const best = [...stageRows].sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))[0];
    const inBreakRow = stageRows.find((r) => r.in_breakaway);
    const helperShift = (moments || []).find((mo) =>
      mo.moment_key === "helper_shift" && (mo.stage_number ?? 1) === stageNumber
      && (mo.team_ids || []).map(String).includes(String(myTeamId))
    );
    return {
      none: false,
      bestRider: riderName(best.rider_id ?? best.rider?.id),
      bestRank: best.rank,
      inBreakRider: inBreakRow ? riderName(inBreakRow.rider_id ?? inBreakRow.rider?.id) : null,
      helperShift,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- riderName lukker over riderNameById (prop), ikke state
  }, [results, moments, myTeamId, stageNumber, report]);

  if (!report) {
    return <RaceRecap results={results} scopeType="stage" stageNumber={stageNumber} incidents={incidents} />;
  }

  const ctx = { riderName, teamName, raceName };
  const headlineKey = report.headline.moment.moment_key;
  const ledeKey = report.lede.key;

  return (
    <Section>
      <SectionHeader title={
        <span className="inline-flex items-center gap-2">
          <FlagIcon size={14} className="text-cz-3" aria-hidden="true" />
          {t("detail.report.title", { number: stageNumber })}
        </span>
      } />
      <h3 className="text-cz-1 font-bold text-[15px] leading-snug">
        {t(`detail.report.headline.${headlineKey}.v${report.headline.variant + 1}`, headlineParamsFor(report.headline.moment, ctx))}
      </h3>
      <p className="text-cz-2 text-sm leading-relaxed mt-1">
        {t(`detail.report.lede.${ledeKey}.v${report.lede.variant + 1}`, ledeParamsFor(report.lede.winMoment, ledeKey, ctx))}
      </p>
      {report.beats.length > 0 && (
        <ul className="space-y-1.5 mt-2">
          {report.beats.map((b) => (
            <li key={b.moment.moment_key} className="text-cz-1 text-sm leading-relaxed">
              {t(`detail.report.beat.${b.beatKey}.v${b.variant + 1}`, beatParamsFor(b.moment, ctx))}
            </li>
          ))}
        </ul>
      )}
      {myTeamBlock && (
        <div className="mt-3 pt-3 border-t border-cz-border space-y-1">
          <div className="text-3xs font-bold uppercase tracking-wide text-cz-3">{t("detail.report.yourTeam.title")}</div>
          {myTeamBlock.none ? (
            <p className="text-cz-2 text-sm">{t("detail.report.yourTeam.none")}</p>
          ) : (
            <ul className="space-y-1">
              <li className="text-cz-1 text-sm tabular-nums">{t("detail.report.yourTeam.bestResult", { rider: myTeamBlock.bestRider, rank: myTeamBlock.bestRank })}</li>
              {myTeamBlock.inBreakRider && (
                <li className="text-cz-1 text-sm">{t("detail.report.yourTeam.inBreak", { rider: myTeamBlock.inBreakRider })}</li>
              )}
              {myTeamBlock.helperShift && (
                <li className="text-cz-1 text-sm">
                  {t("detail.report.yourTeam.helperWork", {
                    count: myTeamBlock.helperShift.params?.helperIds?.length ?? 0,
                    captain: riderName(myTeamBlock.helperShift.params?.captainId),
                  })}
                </li>
              )}
            </ul>
          )}
        </div>
      )}
    </Section>
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
    <Section>
      <SectionHeader title={t("detail.incidents.title")} />
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
    </Section>
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
    <Section>
      <SectionHeader title={
        <span className="inline-flex items-center gap-2">
          <FlagIcon size={14} className="text-cz-3" aria-hidden="true" />
          {t("detail.why.title")}
        </span>
      } />
      <ul className="space-y-1.5">
        {rendered.map((r) => (
          <li key={r.key} className="text-cz-1 text-sm leading-relaxed">{r.text}</li>
        ))}
      </ul>
    </Section>
  );
}

// S6 (#2355): story-tag-badges — kompakte per-rytter-mærker ("offer", "peak",
// "outsider" ...) med den fulde forklaring i title-tooltippet (samme mønster
// som BreakawayMarker). stageNumber=null aggregerer på tværs af HELE løbet
// (bruges på "samlet"-fanen). Maks 2 badges pr. række — flere ville støje mere
// end de forklarer.
//
// #3336: t()-kaldene sendte INGEN interpolations-variabler, så en ICU-
// parametreret storyTags-streng (fx tag_favorite_collapse.tooltip's
// {reason, select, ...}) aldrig kunne modtage sin faktiske værdi — badgen
// for en favorit-nedtur viste derfor altid den samme jour_sans-tekst uanset
// tag.params.reason. tag.params (rå moment-params fra raceStageMoments.js)
// sendes nu med, så enhver fremtidig/eksisterende ICU-parametreret tag-streng
// interpolerer korrekt.
const MAX_STORY_TAGS_PER_ROW = 2;
function StoryTagBadges({ moments, riderId, stageNumber, t }) {
  const tags = storyTagsForRider(moments, riderId, stageNumber).slice(0, MAX_STORY_TAGS_PER_ROW);
  if (!tags.length) return null;
  return (
    <span className="inline-flex items-center gap-1 ms-1.5 align-middle">
      {tags.map((tag) => (
        <span
          key={tag.moment_key}
          title={t(`detail.storyTags.${tag.moment_key}.tooltip`, tag.params || {})}
          className="inline-flex items-center rounded-full border border-cz-border bg-cz-subtle px-1.5 py-0.5 text-3xs font-semibold uppercase tracking-wide text-cz-3"
        >
          {t(`detail.storyTags.${tag.moment_key}.label`, tag.params || {})}
        </span>
      ))}
    </span>
  );
}

// #3519: mountain/points-klassementerne er point-baserede (ikke tids-baserede)
// — rangordenen alene fortæller ikke en spiller HVOR TÆT/LANGT han er fra
// podiet. pointsTotals={mountain,sprint} (raceClassificationTotals.js) bærer
// de faktiske løbende totaler; denne helper vælger den rigtige Map pr.
// klassement-nøgle (gc/young/team har ingen point-total at vise → undefined).
function pointsTotalMapForKey(pointsTotals, key) {
  if (!pointsTotals) return undefined;
  if (key === "mountain") return pointsTotals.mountain;
  if (key === "points") return pointsTotals.sprint;
  return undefined;
}

function OverallTab({ finalByType, filterRows, myTeamId, myOwnTeamId, moments, pointsTotals }) {
  const { t } = useTranslation("races");
  const any = CLASSIFICATIONS.some(c => finalByType[c.key]?.length > 0);
  if (!any) return (
    <EmptyState title={t("detail.noOverall")} />
  );
  return (
    <SectionStack>
      {CLASSIFICATIONS.map(c => {
        const rows = filterRows(finalByType[c.key]);
        if (!rows?.length) return null;
        return <ResultTable key={c.key} title={t(`detail.classification.${c.key}`)} rows={rows} highlightWinner={c.key === "team"} highlightTeamId={myTeamId} myOwnTeamId={myOwnTeamId} moments={moments} pointsTotalByRider={pointsTotalMapForKey(pointsTotals, c.key)} />;
      })}
    </SectionStack>
  );
}

// #2081: løbende klassementer for et igangværende etapeløb — samme tabeller som
// det endelige klassement, med eksplicit "stillingen efter etape N"-ramme så
// ingen forveksler den med slutresultatet.
function LiveOverallTab({ byType, stage, filterRows, myTeamId, myOwnTeamId, moments, pointsTotals }) {
  const { t } = useTranslation("races");
  return (
    <SectionStack>
      <Section>
        <SectionHeader title={t("detail.liveStandings.title", { number: stage })} />
        <p className="text-[13px] text-cz-2">{t("detail.liveStandings.note")}</p>
      </Section>
      {CLASSIFICATIONS.map(c => {
        const rows = filterRows(byType[c.key]);
        if (!rows?.length) return null;
        return <ResultTable key={c.key} title={t(`detail.classification.${c.key}`)} rows={rows} highlightWinner={c.key === "team"} highlightTeamId={myTeamId} myOwnTeamId={myOwnTeamId} moments={moments} pointsTotalByRider={pointsTotalMapForKey(pointsTotals, c.key)} />;
      })}
    </SectionStack>
  );
}

function StageTab({ stage, results, profile, profileByStage, filterRows, myTeamId, myOwnTeamId, incidents, moments, riderNameById, teamNameById, raceId, raceName, passages, t }) {
  const [classTab, setClassTab] = useState("stage");
  const [finalKmOpen, setFinalKmOpen] = useState(false);

  const rows = filterRows(classificationRowsForStage(results, stage, classTab));

  // #3519: point-totaler "efter etape {stage}" for mountain/points-sub-fanen —
  // samme SSOT-genbrug som Overall-fanerne (raceClassificationTotals.js).
  const stagePointsTotals = useMemo(
    () => classificationPointTotals(results, profileByStage, stage),
    [results, profileByStage, stage],
  );

  // Sub-2 (#2770): passage-grupper (KOM/mellemsprint) for DENNE etape — kun
  // relevante i "stage"-sub-fanen (måltavlen), ikke under de øvrige klassement-
  // linser (gc/points/mountain/young/team ser samme etape gennem et andet filter).
  const passageGroups = useMemo(
    () => (classTab === "stage" ? groupPassagesForStage(passages, stage) : []),
    [passages, stage, classTab],
  );

  // #3396/#3914: "The Final Kilometre" er nu skjult bag en stille knap i
  // StoryOfTheStageSection ("ved siden af Watch the race film") i stedet for
  // altid-øverst. Rows/availability udledes lokalt for DENNE etape — uafhængig
  // af classTab (playbacken viser altid etapens egen målrækkefølge, ikke det
  // valgte klassement-sub-view).
  const finalKmRows = useMemo(
    () => results.filter(r => r.result_type === "stage" && (r.stage_number ?? 1) === stage),
    [results, stage],
  );
  const finalKmPlayback = useMemo(
    () => buildFinalKilometrePlayback({ rows: finalKmRows, moments, stageNumber: stage }),
    [finalKmRows, moments, stage],
  );

  // #2081: dag-rækkerne er nu FULDE klassementer (rank 1..N pr. etape) — trøje-
  // bæreren er eksplicit rank 1 (legacy-etaper har kun rank-1-rækker; samme filter).
  const jerseys = JERSEYS
    .map(j => ({ ...j, holder: results.find(r => r.result_type === j.dayType && (r.stage_number ?? 1) === stage && (r.rank ?? 1) === 1) }))
    .filter(j => j.holder);

  const title = classTab === "stage"
    ? t("detail.stageFinishOrder", { number: stage })
    : `${t(`detail.classTab.${classTab}`)} — ${t("detail.liveStandings.title", { number: stage })}`;
  const stageLabel = t("detail.tabStage", { number: stage });

  return (
    <div className="flex flex-col gap-[14px]">
      {/* #3914 (bølge 3): resultatet FØRST — klassement-sub-faner + tabel før
          alt andet på etape-fanen. #2849 bølge 5c: sub-fanerne sidder flush på
          sidens baggrund (ikke i en card-kolonne), samme border-b + guld-
          underline-opskrift som RiderProfileTabs (delt Tabs/TabList/Tab-komponent,
          tabsStyles.js — identisk recipe, intet nyt CSS). #2081: samme etape,
          forskellig klassement-linse. Fast kardinalitet (6) → ui/Tabs (#2849 bølge 3). */}
      <Tabs value={classTab} onChange={setClassTab}>
        <TabList label={t("detail.classTab.ariaLabel")}>
          {STAGE_CLASS_TABS.map(key => (
            <Tab key={key} value={key}>{t(`detail.classTab.${key}`)}</Tab>
          ))}
        </TabList>
      </Tabs>

      <div className="grid grid-cols-1 lg:grid-cols-[1.55fr_1fr] gap-[14px] items-start">
        <SectionStack>
          <ResultTable title={title} rows={rows} highlightWinner={classTab === "team"} highlightTeamId={myTeamId} myOwnTeamId={myOwnTeamId} moments={moments} stageNumber={stage} pointsTotalByRider={pointsTotalMapForKey(stagePointsTotals, classTab)} />
          {passageGroups.length > 0 && <PassageList groups={passageGroups} t={t} />}
        </SectionStack>
        <SectionStack>
          {/* #3859 (bølge 2, mockup godkendt 17/8) + #3914 (bølge 3): "The story
              of the stage" — 3-5 kuraterede nøgle-events + gold "Watch the race
              film", nu MED en stille "The Final Kilometre"-knap ved siden af.
              Gater selv på tidslinje-data OG Final Kilometre-availability
              (renderer kun helt intet hvis INGEN af de to findes). */}
          <StoryOfTheStageSection
            raceId={raceId} stageNumber={stage} profile={profile}
            riderNameById={riderNameById} teamNameById={teamNameById}
            stageLabel={stageLabel}
            finalKmAvailable={finalKmPlayback.available}
            finalKmOpen={finalKmOpen}
            onToggleFinalKm={() => setFinalKmOpen(o => !o)}
          />
          {finalKmOpen && finalKmPlayback.available && (
            <Suspense fallback={null}>
              <FinalKilometrePlayback rows={finalKmRows} moments={moments} stageNumber={stage} stageLabel={stageLabel} />
            </Suspense>
          )}
          <RaceReportPanel
            raceId={raceId} raceName={raceName} stageNumber={stage} moments={moments}
            results={results} incidents={incidents} myTeamId={myTeamId}
            riderNameById={riderNameById} teamNameById={teamNameById} t={t}
          />
          <WhyPanel moments={moments} stageNumber={stage} mode="full" riderNameById={riderNameById} t={t} />
          <DnfSection incidents={incidents} scopeType="stage" stageNumber={stage} t={t} />
          {jerseys.length > 0 && (
            <Section>
              <SectionHeader title={t("detail.jerseysAfterStage")} />
              <div className="flex flex-wrap gap-2">
                {jerseys.map(j => (
                  <div key={j.dayType}
                    className="flex items-center gap-2 rounded-full border border-cz-border bg-cz-subtle ps-2 pe-3 py-1">
                    <span className="text-3xs font-bold uppercase px-1.5 py-0.5 rounded-full"
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
            </Section>
          )}
        </SectionStack>
      </div>

      {/* #3914 (bølge 3, point 3 i kontrakten): fuld profilgraf flyttet NED i
          en foldet (default lukket) sektion — resultatet er etapens vigtigste
          indhold nu, ikke ruten. */}
      <CollapsibleSection title={t("detail.stageProfile.sectionTitle")} defaultOpen={false}>
        <StageProfileSlot profile={profile} passages={passages} tier="full" />
      </CollapsibleSection>
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
    <Section>
      <SectionHeader title={t("detail.passages.title")} />
      <div className="space-y-4">
        {groups.map((g) => (
          <div key={`${g.waypoint_kind}:${g.waypoint_index}`}>
            <p className="text-cz-3 text-2xs mb-1">
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
    </Section>
  );
}

// #1485 Holdklassement-række: holdet ER entiteten (ingen rytter, ingen flag/breakaway).
// highlightWinner = true på holdklassementet → rank 1 får accent + "Winner"-markør,
// så man kan SE hvem der vandt holdkonkurrencen i stedet for at grave i en tabel.
// #3914 (kontrakt-punkt 4): "You"-badge — samme mønster/CSS-tokens som
// StandingsPage's egen dig-markering (--me-badge-bg/--me-badge-fg), kun for
// rytter-rækker (holdklassementets rækker ER holdet, ringen på <tr> alene
// bærer "dette er dit hold"-signalet der, uden en forvirrende "You"-tekst).
function YouBadge({ t }) {
  return (
    <span
      className="ms-1.5 inline-flex items-center rounded-full px-1.5 py-0.5 text-3xs font-bold uppercase align-middle"
      style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}
    >
      {t("detail.youBadge")}
    </span>
  );
}

function ResultEntityCell({ row, highlightWinner, isMine, t, moments, stageNumber }) {
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
          <span className="inline-flex items-center gap-1 text-3xs uppercase tracking-wide text-cz-accent-t"
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
        {isMine && <YouBadge t={t} />}
      </span>
    </RiderLink>
  );
}

// #2849 bølge 3 — kanonisk section-card header (SectionHeader) + WRAP/SCROLLER
// (dataTableStyles) i stedet for en bespoke border-b-header og `overflow-hidden`
// UDEN scroller. Audit-fund: tabellen manglede en horizontal-scroll-wrapper, så
// et bredt felt (5 kolonner: rank/rytter/hold/tid/point) kunne klippes af på
// mobil i stedet for at scrolle — body må ALDRIG scrolle horisontalt ved 375px.
function ResultTable({ title, rows, highlightWinner = false, highlightTeamId = null, myOwnTeamId = null, defaultLimit = 10, moments = [], stageNumber = null, pointsTotalByRider = undefined }) {
  const { t } = useTranslation("races");
  const [expanded, setExpanded] = useState(false);
  // #3913: points_earned er PRÆMIEpoint for at ramme podiet i DENNE klassement
  // (fx top-3 i point- eller bjergkonkurrencen), ikke antallet af trøje-point
  // rytteren faktisk har samlet i jagten på trøjen. Uden kolonneoverskrifter
  // læste spillere dette tal som trøje-stillingen — se #3913. Kolonnen hedder
  // nu eksplicit "Præmiepoint" og er nedtonet i styling.
  const showPoints = rows.some(r => (r.points_earned ?? 0) > 0);
  // #3519: mountain/points-klassementernes FAKTISKE løbende total (sprint_points/
  // kom_points summeret pr. rytter, raceClassificationTotals.js) — DETTE er
  // tallet der forklarer rangordenen i point-/bjergkonkurrencen, altså trøje-
  // point. Vises nu som "Trøjepoint", med den fremhævede accent-styling der
  // tidligere fejlagtigt sad på præmiepoint-kolonnen (#3913).
  const showPointsTotal = pointsTotalByRider != null && rows.some(r => (pointsTotalByRider.get(r.rider_id) ?? 0) > 0);
  // Gap-kolonne kun når motoren har skrevet tider (stage/gc fra Race Engine v2);
  // gamle PCM-løb og point/bjerg/ungdom/hold-klassementer har tom finish_time.
  const showTime = rows.some(r => r.finish_time);
  // Holdklassement (rider_id=null) har ingen rytter-team-kolonne at vise.
  const showTeamCol = rows.some(r => resultEntity(r).kind === "rider");
  // #2081 (Discord-ønske): top-10 default + "Show all N"-knap, når feltet er stort.
  const collapsible = rows.length > defaultLimit;
  const visibleRows = collapsible && !expanded ? rows.slice(0, defaultLimit) : rows;
  return (
    <Section>
      <SectionHeader
        title={title}
        action={collapsible && (
          <button type="button" onClick={() => setExpanded(e => !e)}
            aria-pressed={expanded}
            className="text-xs font-medium text-cz-accent-t hover:underline shrink-0">
            {expanded ? t("detail.showLess") : t("detail.showAll", { count: rows.length })}
          </button>
        )}
      />
      {rows.length === 0 ? (
        <p className="text-center text-cz-3 text-sm py-6">{t("detail.noResults")}</p>
      ) : (
        <div className={WRAP}>
          <div className={SCROLLER}>
            <table data-sort-exempt="Loebsresultat, sorteret paa placering (rank)" className="w-full text-sm">
              {(showPoints || showPointsTotal) && (
                // #3913: kun de to point-kolonner har brug for en overskrift —
                // det er dem der ellers er umulige at kende fra hinanden.
                // Rank/navn/hold/tid er selvforklarende ved deres placering.
                <thead>
                  <tr className="text-3xs uppercase tracking-wide text-cz-3">
                    <th className="px-4 py-1 font-medium" scope="col"></th>
                    <th className="px-2 py-1 font-medium" scope="col"></th>
                    {showTeamCol && <th className="px-2 py-1 font-medium" scope="col"></th>}
                    {showTime && <th className="px-3 py-1 font-medium" scope="col"></th>}
                    {showPointsTotal && (
                      <th className="px-4 py-1 text-right font-medium whitespace-nowrap" scope="col">
                        {t("detail.table.jerseyPoints")}
                      </th>
                    )}
                    {showPoints && (
                      <th className="px-4 py-1 text-right font-medium whitespace-nowrap" scope="col">
                        {t("detail.table.prizePoints")}
                      </th>
                    )}
                  </tr>
                </thead>
              )}
              <tbody className="divide-y divide-cz-border">
                {visibleRows.map(r => {
                  const isWinner = highlightWinner && r.rank === 1;
                  const rowTeamId = r.team_id ?? r.rider?.team?.id;
                  const isMyTeam = highlightTeamId != null && String(rowTeamId) === String(highlightTeamId);
                  // #3914 (kontrakt-punkt 4): egen-hold-fremhævning, UAFHÆNGIG af
                  // filteret ovenfor (highlightTeamId) — den kan være null (intet
                  // filter valgt) eller pege på et andet hold end mit eget, og
                  // spilleren skal altid kunne se hvor HANS ryttere ligger. Ring i
                  // stedet for solid baggrund så den ikke kolliderer visuelt med
                  // vinder-/filter-tint (samme --me-ring-token som StandingsPage).
                  const isMine = myOwnTeamId != null && String(rowTeamId) === String(myOwnTeamId);
                  return (
                  <tr key={r.id}
                    className={`transition-colors ${isWinner ? "bg-cz-accent/10" : isMyTeam ? "bg-cz-accent/5" : "hover:bg-cz-subtle"}`}
                    style={isMine ? { boxShadow: "inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)" } : undefined}
                  >
                    <td className={`px-4 py-2 w-10 font-mono text-xs ${isWinner ? "text-cz-accent-t" : "text-cz-3"}`}>{r.rank ?? "—"}</td>
                    <td className="px-2 py-2">
                      <ResultEntityCell row={r} highlightWinner={highlightWinner} isMine={isMine} t={t} moments={moments} stageNumber={stageNumber} />
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
                    {showPointsTotal && (
                      <td className="px-4 py-2 text-right text-cz-accent-t font-mono text-xs whitespace-nowrap tabular-nums">
                        {(pointsTotalByRider.get(r.rider_id) ?? 0) > 0
                          ? t("detail.passages.points", { count: pointsTotalByRider.get(r.rider_id) })
                          : ""}
                      </td>
                    )}
                    {showPoints && (
                      <td className="px-4 py-2 text-right text-cz-3 font-mono text-xs whitespace-nowrap">
                        {(r.points_earned ?? 0) > 0 ? `${formatNumber(r.points_earned)} pt` : ""}
                      </td>
                    )}
                  </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </Section>
  );
}
