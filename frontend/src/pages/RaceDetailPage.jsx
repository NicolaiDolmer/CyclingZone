import { useState, useEffect, useCallback, useMemo } from "react";
import { supabase } from "../lib/supabase";
import { Link, useParams } from "react-router-dom";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import { Flag } from "../components/Flag";
import { formatNumber } from "../lib/intl";
import { fetchAllRows } from "../lib/supabasePagination";

// #959 Etape-resultater V1 — detaljeret pr.-etape-visning.
//
// Data-virkelighed (verificeret mod prod 2026-06-03): race_results gemmer kun
// PR. ETAPE: result_type="stage" (fuld målrækkefølge) + de daglige trøjebærere
// (leader/points_day/mountain_day/young_day, én række pr. etape). De samlede
// klassementer (gc/points/mountain/young/team) gemmes KUN ved sidste etape =
// det endelige resultat. finish_time er tom overalt → ingen tider/gaps i V1.
// V2 (efter launch) udvider importen så pr.-etape-klassementer + tider gemmes.

// De endelige klassementer ("Samlet"-fanen), i visnings-rækkefølge.
const CLASSIFICATIONS = [
  { key: "gc",       label: "Samlet (GC)" },
  { key: "points",   label: "Pointkonkurrence" },
  { key: "mountain", label: "Bjergkonkurrence" },
  { key: "young",    label: "Ungdom" },
  { key: "team",     label: "Holdkonkurrence" },
];

// Daglige trøjebærere — vist som badges på hver etape-fane.
const JERSEYS = [
  { dayType: "leader",       label: "Fører",  bg: "#e8c547", fg: "#1a1a1a" },
  { dayType: "points_day",   label: "Point",  bg: "#22c55e", fg: "#052e16" },
  { dayType: "mountain_day", label: "Bjerg",  bg: "#ef4444", fg: "#ffffff" },
  { dayType: "young_day",    label: "Ungdom", bg: "#f1f5f9", fg: "#1a1a1a" },
];

function riderName(res) {
  if (res.rider) return `${res.rider.firstname} ${res.rider.lastname}`;
  return res.rider_name || "—";
}

function byRank(a, b) {
  return (a.rank ?? 9999) - (b.rank ?? 9999);
}

export default function RaceDetailPage() {
  const { raceId } = useParams();

  const [race, setRace] = useState(null);
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);
  const [activeTab, setActiveTab] = useState("samlet");

  const loadAll = useCallback(async () => {
    setLoading(true);
    setNotFound(false);

    const { data: raceRow, error } = await supabase
      .from("races")
      .select("id, name, race_type, race_class, stages, edition_year, status, season:season_id(id, number), pool_race:pool_race_id(date_text)")
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
        .select("id, stage_number, result_type, rank, rider_id, rider_name, team_id, team_name, points_earned, prize_money, rider:rider_id(id, firstname, lastname, nationality_code, team:team_id(id, name))")
        .eq("race_id", raceId)
        .order("id")
    );

    setRace(raceRow);
    setResults(rows);
    setLoading(false);
  }, [raceId]);

  useEffect(() => { loadAll(); }, [loadAll]);

  // Etaper med faktiske etape-data (result_type="stage"), sorteret.
  const stageNumbers = useMemo(() => {
    const set = new Set(
      results.filter(r => r.result_type === "stage").map(r => r.stage_number ?? 1)
    );
    return [...set].sort((a, b) => a - b);
  }, [results]);

  const isStageRace = race?.race_type === "stage_race" && stageNumbers.length > 0;

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
      <Link to="/races?tab=library" className="text-xs text-cz-accent-t hover:underline mb-4 inline-block">← Løbsbibliotek</Link>
      <div className="text-center py-16 text-cz-3">
        <p className="text-4xl mb-3">🏁</p>
        <p>Løbet blev ikke fundet</p>
      </div>
    </div>
  );

  const hasAnyResults = results.length > 0;

  return (
    <div className="max-w-4xl mx-auto space-y-5">
      {/* Header */}
      <div>
        <Link to="/races?tab=library" className="text-xs text-cz-accent-t hover:underline mb-2 inline-block">← Løbsbibliotek</Link>
        <h1 className="text-xl font-bold text-cz-1">{race.name}</h1>
        <p className="text-cz-3 text-sm">
          {race.race_type === "stage_race"
            ? `Etapeløb · ${race.stages} ${race.stages === 1 ? "etape" : "etaper"}`
            : "Enkeltdagsløb"}
          {race.season?.number != null && ` · Sæson ${race.season.number}`}
          {race.edition_year && ` · ${race.edition_year}-udgave`}
          {race.pool_race?.date_text && ` · ${race.pool_race.date_text}`}
        </p>
      </div>

      {!hasAnyResults && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-10 text-center text-cz-3">
          <p className="text-4xl mb-3">🏁</p>
          <p className="text-sm">Ingen resultater importeret for dette løb endnu</p>
        </div>
      )}

      {hasAnyResults && isStageRace && (
        <>
          {/* Tabs: Samlet + Etape 1..N */}
          <div className="flex gap-2 flex-wrap">
            <TabButton active={activeTab === "samlet"} onClick={() => setActiveTab("samlet")}>
              Samlet
            </TabButton>
            {stageNumbers.map(n => (
              <TabButton key={n} active={activeTab === `stage-${n}`} onClick={() => setActiveTab(`stage-${n}`)}>
                Etape {n}
              </TabButton>
            ))}
          </div>

          {activeTab === "samlet" && <OverallTab finalByType={finalByType} />}
          {stageNumbers.map(n => activeTab === `stage-${n}` && (
            <StageTab key={n} stage={n} results={results} />
          ))}
        </>
      )}

      {/* Enkeltdagsløb — ingen faner, bare måltavlen (+ holdklassement hvis det findes) */}
      {hasAnyResults && !isStageRace && (
        <div className="space-y-5">
          <ResultTable
            title="Resultat"
            rows={(finalByType.gc?.length ? finalByType.gc : results.filter(r => r.result_type === "stage").sort(byRank))}
          />
          {finalByType.team?.length > 0 && (
            <ResultTable title="Holdkonkurrence" rows={finalByType.team} />
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
  const any = CLASSIFICATIONS.some(c => finalByType[c.key]?.length > 0);
  if (!any) return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-8 text-center text-cz-3 text-sm">
      Ingen samlede klassementer registreret
    </div>
  );
  return (
    <div className="space-y-5">
      {CLASSIFICATIONS.map(c => {
        const rows = finalByType[c.key];
        if (!rows?.length) return null;
        return <ResultTable key={c.key} title={c.label} rows={rows} />;
      })}
    </div>
  );
}

function StageTab({ stage, results }) {
  const rows = results
    .filter(r => r.result_type === "stage" && (r.stage_number ?? 1) === stage)
    .sort(byRank);

  const jerseys = JERSEYS
    .map(j => ({ ...j, holder: results.find(r => r.result_type === j.dayType && (r.stage_number ?? 1) === stage) }))
    .filter(j => j.holder);

  return (
    <div className="space-y-5">
      {jerseys.length > 0 && (
        <div className="bg-cz-card border border-cz-border rounded-xl p-4">
          <p className="text-cz-2 text-xs uppercase tracking-wider mb-3 font-semibold">Trøjer efter etapen</p>
          <div className="flex flex-wrap gap-2">
            {jerseys.map(j => (
              <div key={j.dayType}
                className="flex items-center gap-2 rounded-full border border-cz-border bg-cz-subtle ps-2 pe-3 py-1">
                <span className="text-[10px] font-bold uppercase px-1.5 py-0.5 rounded-full"
                  style={{ backgroundColor: j.bg, color: j.fg }}>
                  {j.label}
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

      <ResultTable title={`Etape ${stage} — målrækkefølge`} rows={rows} />
    </div>
  );
}

function ResultTable({ title, rows }) {
  const showPoints = rows.some(r => (r.points_earned ?? 0) > 0);
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
      <div className="px-4 py-3 border-b border-cz-border">
        <h2 className="font-semibold text-cz-1 text-sm">{title}</h2>
      </div>
      {rows.length === 0 ? (
        <div className="px-4 py-8 text-center text-cz-3 text-sm">Ingen resultater</div>
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
                    </span>
                  </RiderLink>
                </td>
                <td className="px-2 py-2 text-cz-3 text-xs">
                  <TeamLink id={r.rider?.team?.id} className="hover:text-cz-accent-t transition-colors">
                    {r.rider?.team?.name || r.team_name || "Fri"}
                  </TeamLink>
                </td>
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
