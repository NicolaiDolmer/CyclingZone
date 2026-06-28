import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useParams, useSearchParams, useLocation } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import RaceSelectionPanel from "../components/race/RaceSelectionPanel.jsx";
import StageStripe from "../components/race/StageStripe.jsx";
import StageDetailPanel from "../components/race/StageDetailPanel.jsx";
import { Flag } from "../components/Flag";
import { FlagIcon, PageLoader } from "../components/ui";
import { formatNumber } from "../lib/intl";
import { resultEntity } from "../lib/raceResultEntity.js";
import { buildRaceRecap } from "../lib/raceRecap.js";
import { fetchAllRows } from "../lib/supabasePagination";
import { logEvent } from "../lib/logEvent";
import { profileShape, profileLabelKey, finaleLabelKey } from "../lib/stageProfileConfig";
import { deriveRaceStatus } from "../lib/raceHubLogic.js";
import { bucketCounts, terrainBucket } from "../lib/stageTerrain.js";
import { RACE_TIMEZONE, countdownParts, countdownSegments } from "../lib/stageScheduleConfig.js";

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
  const [nowMs, setNowMs] = useState(() => Date.now());
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
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

    const rows = await fetchAllRows(() =>
      supabase
        .from("race_results")
        .select("id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, finish_time, points_earned, prize_money, in_breakaway, breakaway_caught, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name)), team:team_id(id, name)")
        .eq("race_id", raceId)
        .order("id")
    );

    // #1484 Stiliseret terræn-indikator. race_stage_profiles er læsbar for
    // authenticated (siden er auth-gated via ProtectedRoute). Degraderer pænt:
    // en fejl/tom tabel → ingen profil-badges, ingen fejl-UI.
    const { data: profiles } = await supabase
      .from("race_stage_profiles")
      .select("stage_number, profile_type, finale_type, demand_vector")
      .eq("race_id", raceId)
      .order("stage_number");

    // #1597 → S4: etape-kalenderen foldes ind i etape-striben (per-etape-tid) +
    // næste-start-countdown i headeren. Degraderer pænt (tom = ingen tider).
    const { data: scheduleRows } = await supabase
      .from("race_stage_schedule")
      .select("stage_number, scheduled_at")
      .eq("race_id", raceId)
      .order("stage_number", { ascending: true });

    setRace(raceRow);
    setResults(rows);
    setStageProfiles(profiles ?? []);
    setSchedule(scheduleRows ?? []);
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

  // Sørg for at active tab altid er gyldig når data skifter.
  useEffect(() => {
    if (!isStageRace) return;
    const valid = ["samlet", ...stageNumbers.map(n => `stage-${n}`)];
    if (!valid.includes(activeTab)) setActiveTab("samlet");
  }, [isStageRace, stageNumbers, activeTab]);

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
    <div className="max-w-4xl mx-auto space-y-5">
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
          {race.pool_race?.date_text && ` · ${race.pool_race.date_text}`}
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
          S4: per-etape rute-match mod den valgte etape. */}
      {race.status === "scheduled" && (
        deriveRaceStatus(race.status, race.stages_completed, race.stages) === "live"
          ? (
            <div className="bg-cz-card border border-cz-border rounded-cz px-4 py-3">
              <p className="text-sm font-semibold text-cz-1">{t("racehub.lineupLocked.title")}</p>
              <p className="text-xs text-cz-3 mt-0.5">{t("racehub.lineupLocked.note")}</p>
            </div>
          )
          : (
            <RaceSelectionPanel
              raceId={race.id}
              selectedStageIndex={scheduledStageNums.indexOf(scheduledStage) >= 0 ? scheduledStageNums.indexOf(scheduledStage) : 0}
              selectedStageBucket={terrainBucket(profileByStage[scheduledStage]?.profile_type)}
              selectedStageProfileType={profileByStage[scheduledStage]?.profile_type ?? null}
              selectedStageFinaleType={profileByStage[scheduledStage]?.finale_type ?? null}
            />
          )
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

          {activeTab === "samlet" && (
            <div className="space-y-5">
              <RaceRecap results={results} scopeType="overall" />
              <OverallTab finalByType={finalByType} />
            </div>
          )}
          {stageNumbers.map(n => activeTab === `stage-${n}` && (
            <StageTab key={n} stage={n} results={results} profile={profileByStage[n]} />
          ))}
        </>
      )}

      {/* Enkeltdagsløb — ingen faner, bare måltavlen (+ holdklassement hvis det findes) */}
      {hasAnyResults && !isStageRace && (
        <div className="space-y-5">
          <StageProfileCard profile={profileByStage[1]} />
          <RaceRecap results={results} scopeType="overall" />
          <ResultTable
            title={t("detail.tableResult")}
            rows={(finalByType.gc?.length ? finalByType.gc : results.filter(r => r.result_type === "stage").sort(byRank))}
          />
          {finalByType.team?.length > 0 && (
            <ResultTable title={t("detail.classification.team")} rows={finalByType.team} highlightWinner />
          )}
        </div>
      )}
    </div>
  );
}

// #1311 Tekst-recap: skabelon-fortælling udledt af persisterede race_results (ren
// præsentation, ingen ny sim-mekanik). Renderer intet hvis intet kan udledes ærligt.
function RaceRecap({ results, scopeType, stageNumber }) {
  const { t } = useTranslation("races");
  const moments = useMemo(
    () => buildRaceRecap({ results, scope: { type: scopeType, stageNumber } }),
    [results, scopeType, stageNumber],
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

function OverallTab({ finalByType }) {
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
        const rows = finalByType[c.key];
        if (!rows?.length) return null;
        return <ResultTable key={c.key} title={t(`detail.classification.${c.key}`)} rows={rows} highlightWinner={c.key === "team"} />;
      })}
    </div>
  );
}

function StageTab({ stage, results, profile }) {
  const { t } = useTranslation("races");
  const rows = results
    .filter(r => r.result_type === "stage" && (r.stage_number ?? 1) === stage)
    .sort(byRank);

  const jerseys = JERSEYS
    .map(j => ({ ...j, holder: results.find(r => r.result_type === j.dayType && (r.stage_number ?? 1) === stage) }))
    .filter(j => j.holder);

  return (
    <div className="space-y-5">
      <StageProfileCard profile={profile} />
      <RaceRecap results={results} scopeType="stage" stageNumber={stage} />
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

      <ResultTable title={t("detail.stageFinishOrder", { number: stage })} rows={rows} />
    </div>
  );
}

// #1484 — stiliseret terræn-indikator pr. etape. ÆRLIG: kategori-piktogram fra
// race_stage_profiles.profile_type, IKKE en målt højdeprofil (#1021). Degraderer
// til intet hvis profil mangler eller terrænet er ukendt — ingen tom/falsk visning.
function StageProfileCard({ profile, stageLabel }) {
  const { t } = useTranslation("races");
  const labelKey = profile && profileLabelKey(profile.profile_type);
  if (!labelKey) return null;

  const finaleKey = finaleLabelKey(profile.finale_type);

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4 flex items-center gap-4">
      <StageProfileSilhouette profileType={profile.profile_type} />
      <div className="min-w-0">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider font-semibold">
          {stageLabel || t("detail.stageProfile.label")}
        </p>
        <p className="text-cz-1 text-sm font-semibold leading-tight">
          {t(`detail.${labelKey}`)}
          {finaleKey && (
            <span className="text-cz-3 font-normal"> · {t(`detail.${finaleKey}`)}</span>
          )}
        </p>
        <p className="text-cz-3 text-[11px] mt-0.5">{t("detail.stageProfile.note")}</p>
      </div>
    </div>
  );
}

// Lille deterministisk silhuet (sparkline) — currentColor + cz-tokens, ingen slop.
function StageProfileSilhouette({ profileType }) {
  const { points, baseY, width, height } = profileShape(profileType);
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      className="w-14 h-7 shrink-0 text-cz-accent-t"
      role="presentation"
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      {/* Havniveau-hårlinje */}
      <line x1="0" y1={baseY} x2={width} y2={baseY}
        stroke="currentColor" strokeOpacity="0.25" strokeWidth="0.75" />
      {/* Terræn-silhuet */}
      <polyline points={points}
        fill="none" stroke="currentColor" strokeWidth="1.5"
        strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}

// #1485 Holdklassement-række: holdet ER entiteten (ingen rytter, ingen flag/breakaway).
// highlightWinner = true på holdklassementet → rank 1 får accent + "Winner"-markør,
// så man kan SE hvem der vandt holdkonkurrencen i stedet for at grave i en tabel.
function ResultEntityCell({ row, highlightWinner, t }) {
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
      </span>
    </RiderLink>
  );
}

function ResultTable({ title, rows, highlightWinner = false }) {
  const { t } = useTranslation("races");
  const showPoints = rows.some(r => (r.points_earned ?? 0) > 0);
  // Gap-kolonne kun når motoren har skrevet tider (stage/gc fra Race Engine v2);
  // gamle PCM-løb og point/bjerg/ungdom/hold-klassementer har tom finish_time.
  const showTime = rows.some(r => r.finish_time);
  // Holdklassement (rider_id=null) har ingen rytter-team-kolonne at vise.
  const showTeamCol = rows.some(r => resultEntity(r).kind === "rider");
  return (
    <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border">
        <h2 className="font-semibold text-cz-1 text-sm">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-cz-3 text-sm">{t("detail.noResults")}</div>
      ) : (
        <table className="w-full text-sm">
          <tbody className="divide-y divide-cz-border">
            {rows.map(r => {
              const isWinner = highlightWinner && r.rank === 1;
              return (
              <tr key={r.id} className={`transition-colors ${isWinner ? "bg-cz-accent/10" : "hover:bg-cz-subtle"}`}>
                <td className={`px-4 py-2 w-10 font-mono text-xs ${isWinner ? "text-cz-accent-t" : "text-cz-3"}`}>{r.rank ?? "—"}</td>
                <td className="px-2 py-2">
                  <ResultEntityCell row={r} highlightWinner={highlightWinner} t={t} />
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
