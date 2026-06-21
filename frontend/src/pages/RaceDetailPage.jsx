import { useState, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import { Link, useParams, useSearchParams } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import RaceSelectionPanel from "../components/race/RaceSelectionPanel.jsx";
import StageScheduleCard from "../components/race/StageScheduleCard.jsx";
import { Flag } from "../components/Flag";
import { FlagIcon } from "../components/ui";
import { formatNumber } from "../lib/intl";
import { fetchAllRows } from "../lib/supabasePagination";
import { logEvent } from "../lib/logEvent";
import { profileShape, profileLabelKey, finaleLabelKey } from "../lib/stageProfileConfig";

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

export default function RaceDetailPage() {
  const { t } = useTranslation("races");
  const { raceId } = useParams();

  const [race, setRace] = useState(null);
  const [results, setResults] = useState([]);
  const [stageProfiles, setStageProfiles] = useState([]);
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
        .select("id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, finish_time, points_earned, prize_money, in_breakaway, breakaway_caught, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name))")
        .eq("race_id", raceId)
        .order("id")
    );

    // #1484 Stiliseret terræn-indikator. race_stage_profiles er læsbar for
    // authenticated (siden er auth-gated via ProtectedRoute). Degraderer pænt:
    // en fejl/tom tabel → ingen profil-badges, ingen fejl-UI.
    const { data: profiles } = await supabase
      .from("race_stage_profiles")
      .select("stage_number, profile_type, finale_type")
      .eq("race_id", raceId)
      .order("stage_number");

    setRace(raceRow);
    setResults(rows);
    setStageProfiles(profiles ?? []);
    setLoading(false);
  }, [raceId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (race?.id) logEvent("race_viewed", { race_id: race.id });
  }, [race?.id]);

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
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  if (notFound) return (
    <div className="max-w-4xl mx-auto">
      <Link to="/races?tab=library" className="text-xs text-cz-accent-t hover:underline mb-4 inline-block">{t("detail.backToLibrary")}</Link>
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
        <Link to="/races?tab=library" className="text-xs text-cz-accent-t hover:underline mb-2 inline-block">{t("detail.backToLibrary")}</Link>
        <h1 className="text-xl font-bold text-cz-1">{race.name}</h1>
        <p className="text-cz-3 text-sm">
          {race.race_type === "stage_race"
            ? t("raceType.stageRaceWithStages", { count: race.stages })
            : t("raceType.oneDay")}
          {race.season?.number != null && ` · ${t("library.seasonOption", { number: race.season.number })}`}
          {race.pool_race?.date_text && ` · ${race.pool_race.date_text}`}
        </p>
      </div>

      {/* #1597: synlig etape-kalender for kommende løb — kortet henter
          race_stage_schedule selv og skjuler sig hvis der ikke findes en
          kalender (gamle/PCM-løb, eller scheduler ikke aktiveret). */}
      {race.status === "scheduled" && (
        <StageScheduleCard raceId={race.id} stagesCompleted={race.stages_completed ?? 0} />
      )}

      {/* #1307: holdudtagelse for kommende løb — panelet gater selv på
          race-engine-flaget (renderer intet når backend siger enabled=false). */}
      {race.status === "scheduled" && <RaceSelectionPanel raceId={race.id} />}

      {!hasAnyResults && (
        <div className="bg-cz-card border border-cz-border rounded-cz p-10 text-center text-cz-3">
          <FlagIcon className="w-8 h-8 mx-auto mb-3" aria-hidden="true" />
          <p className="text-sm">{t("empty.noResultsImportedRace")}</p>
        </div>
      )}

      {hasAnyResults && isStageRace && (
        <>
          {/* Tabs: Samlet + Etape 1..N */}
          <div className="flex gap-2 flex-wrap">
            <TabButton active={activeTab === "samlet"} onClick={() => changeTab("samlet")}>
              {t("detail.tabOverall")}
            </TabButton>
            {stageNumbers.map(n => (
              <TabButton key={n} active={activeTab === `stage-${n}`} onClick={() => changeTab(`stage-${n}`)}>
                {t("detail.tabStage", { number: n })}
              </TabButton>
            ))}
          </div>

          {activeTab === "samlet" && <OverallTab finalByType={finalByType} />}
          {stageNumbers.map(n => activeTab === `stage-${n}` && (
            <StageTab key={n} stage={n} results={results} profile={profileByStage[n]} />
          ))}
        </>
      )}

      {/* Enkeltdagsløb — ingen faner, bare måltavlen (+ holdklassement hvis det findes) */}
      {hasAnyResults && !isStageRace && (
        <div className="space-y-5">
          <StageProfileCard profile={profileByStage[1]} />
          <ResultTable
            title={t("detail.tableResult")}
            rows={(finalByType.gc?.length ? finalByType.gc : results.filter(r => r.result_type === "stage").sort(byRank))}
          />
          {finalByType.team?.length > 0 && (
            <ResultTable title={t("detail.classification.team")} rows={finalByType.team} />
          )}
        </div>
      )}
    </div>
  );
}

function TabButton({ active, onClick, children }) {
  return (
    <button onClick={onClick}
      className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
        ${active ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
      {children}
    </button>
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
        return <ResultTable key={c.key} title={t(`detail.classification.${c.key}`)} rows={rows} />;
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
function StageProfileCard({ profile }) {
  const { t } = useTranslation("races");
  const labelKey = profile && profileLabelKey(profile.profile_type);
  if (!labelKey) return null;

  const finaleKey = finaleLabelKey(profile.finale_type);

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-4 flex items-center gap-4">
      <StageProfileSilhouette profileType={profile.profile_type} />
      <div className="min-w-0">
        <p className="text-cz-3 text-[10px] uppercase tracking-wider font-semibold">
          {t("detail.stageProfile.label")}
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

function ResultTable({ title, rows }) {
  const { t } = useTranslation("races");
  const showPoints = rows.some(r => (r.points_earned ?? 0) > 0);
  // Gap-kolonne kun når motoren har skrevet tider (stage/gc fra Race Engine v2);
  // gamle PCM-løb og point/bjerg/ungdom/hold-klassementer har tom finish_time.
  const showTime = rows.some(r => r.finish_time);
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
            {rows.map(r => (
              <tr key={r.id} className="hover:bg-cz-subtle transition-colors">
                <td className="px-4 py-2 w-10 text-cz-3 font-mono text-xs">{r.rank ?? "—"}</td>
                <td className="px-2 py-2">
                  <RiderLink id={r.rider?.id}
                    className="cursor-pointer hover:text-cz-accent-t transition-colors block">
                    <span className="text-cz-1">
                      {r.rider?.nationality_code && (
                        <Flag code={r.rider.nationality_code} className="me-1" />
                      )}
                      {riderName(r)}
                      <BreakawayMarker result={r} t={t} />
                    </span>
                  </RiderLink>
                </td>
                <td className="px-2 py-2 text-cz-3 text-xs">
                  <TeamLink id={r.rider?.team?.id} className="hover:text-cz-accent-t transition-colors">
                    {r.rider?.team?.name || r.team_name || t("common.free")}
                  </TeamLink>
                </td>
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
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
