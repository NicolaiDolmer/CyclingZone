import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import TeamLink from "../components/TeamLink";
import { logEvent } from "../lib/logEvent";
import { formatNumber } from "../lib/intl";
import { TrophyIcon, LightningIcon, CrownIcon, PageLoader } from "../components/ui";

const CATEGORIES = [
  { key: "most_points_season", Icon: TrophyIcon, unitKey: "points" },
  { key: "most_stage_wins_season", Icon: LightningIcon, unitKey: "wins" },
  { key: "most_div1_titles", Icon: CrownIcon, unitKey: "titles" },
];

// #1580: 2-farve-disciplin — niveau-tier mappes til en monokrom intensitet via
// cz-tekst-tokens (lav tier dæmpet, top tier guld) i stedet for 10 regnbue-hex.
const LEVEL_TITLES = [
  { min: 1,  max: 4,  key: "rookie",      cls: "text-cz-3" },
  { min: 5,  max: 9,  key: "amateur",     cls: "text-cz-3" },
  { min: 10, max: 14, key: "continental", cls: "text-cz-2" },
  { min: 15, max: 19, key: "pro",         cls: "text-cz-2" },
  { min: 20, max: 24, key: "proTeam",     cls: "text-cz-2" },
  { min: 25, max: 29, key: "worldTour",   cls: "text-cz-1" },
  { min: 30, max: 34, key: "monument",    cls: "text-cz-1" },
  { min: 35, max: 39, key: "gcContender", cls: "text-cz-accent-t" },
  { min: 40, max: 44, key: "grandTour",   cls: "text-cz-accent-t" },
  { min: 45, max: 50, key: "legend",      cls: "text-cz-accent-t" },
];

export function getLevelInfo(level) {
  return LEVEL_TITLES.find(l => level >= l.min && level <= l.max) || LEVEL_TITLES[0];
}

export default function HallOfFamePage() {
  const { t } = useTranslation("halloffame");
  const [records, setRecords] = useState({});
  const [standings, setStandings] = useState([]);
  const [managers, setManagers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState("hof");

  async function loadAll() {
    setLoading(true);
    const [hofRes, standingsRes, managersRes] = await Promise.all([
      supabase.from("hall_of_fame").select("*, team:team_id(id, name)").order("value", { ascending: false }),
      supabase.from("season_standings")
        .select("*, team:team_id(id, name, is_ai), season:season_id(number)")
        .order("total_points", { ascending: false }),
      supabase.from("teams")
        .select("id, name, division, manager_name, user:user_id(id, username, level, xp, role)")
        .eq("is_ai", false)
        .eq("is_test_account", false)
        .eq("is_frozen", false)
        .order("name"),
    ]);

    // Group HoF by category
    const grouped = {};
    (hofRes.data || []).forEach(r => {
      if (!grouped[r.category]) grouped[r.category] = [];
      grouped[r.category].push(r);
    });
    setRecords(grouped);
    setStandings(standingsRes.data || []);
    // Flatten team + user data for managers tab
    setManagers((managersRes.data || [])
      .map(t => ({ ...t.user, team_id: t.id, team_name: t.name, team_division: t.division, manager_name: t.manager_name }))
      .filter(m => m.id && (m.manager_name || m.team_name))
      .sort((a, b) => (b.level || 1) - (a.level || 1) || (b.xp || 0) - (a.xp || 0)));
    setLoading(false);
  }

  useEffect(() => { loadAll(); logEvent("feature_hall_of_fame_opened"); }, []);

  // Calculate all-time stats from standings if no HoF records yet
  function getBestFromStandings(category) {
    if (records[category]?.length) return records[category].slice(0, 5);
    if (category === "most_points_season") {
      return standings
        .filter(s => !s.team?.is_ai)
        .sort((a, b) => b.total_points - a.total_points)
        .slice(0, 5)
        .map(s => ({
          team_name: s.team?.name,
          team: s.team,
          value: s.total_points || 0,
          season_number: s.season?.number,
        }));
    }
    if (category === "most_stage_wins_season") {
      return standings
        .filter(s => !s.team?.is_ai)
        .sort((a, b) => (b.stage_wins || 0) - (a.stage_wins || 0))
        .slice(0, 5)
        .map(s => ({
          team_name: s.team?.name,
          team: s.team,
          value: s.stage_wins || 0,
          season_number: s.season?.number,
        }));
    }
    return [];
  }

  // Division history from standings
  const divHistory = {};
  standings.filter(s => !s.team?.is_ai && s.division === 1).forEach(s => {
    const key = s.season?.number;
    if (!divHistory[key]) divHistory[key] = [];
    divHistory[key].push(s);
  });

  if (loading) return (
    <PageLoader />
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-6">
        <h1 className="text-xl font-bold text-cz-1">{t("title")}</h1>
        <p className="text-cz-3 text-sm">{t("subtitle")}</p>
      </div>

      {/* Tabs */}
      <div className="flex gap-2 mb-6">
        {[
          { key: "hof", label: t("tabRecords") },
          { key: "managers", label: t("tabManagers") },
          { key: "divhistory", label: t("tabDivHistory") },
        ].map(tabItem => (
          <button key={tabItem.key} onClick={() => setTab(tabItem.key)}
            className={`px-3 py-1.5 rounded-lg text-sm font-medium transition-all border
              ${tab === tabItem.key ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/30" : "text-cz-2 hover:text-cz-1 bg-cz-card border-cz-border"}`}>
            {tabItem.label}
          </button>
        ))}
      </div>

      {/* Records tab */}
      {tab === "hof" && (
        <div className="flex flex-col gap-6">
          {CATEGORIES.map(cat => {
            const entries = getBestFromStandings(cat.key);
            return (
              <div key={cat.key} className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
                <div className="flex items-center gap-3 px-5 py-4 border-b border-l-[3px] border-cz-border border-l-cz-accent">
                  <cat.Icon size={20} className="text-cz-accent-t" aria-hidden="true" />
                  <h2 className="text-cz-1 font-semibold text-sm">{t(`categories.${cat.key}`)}</h2>
                </div>
                {entries.length === 0 ? (
                  <div className="px-5 py-8 text-center text-cz-3 text-sm">
                    {t("noRecords")}
                  </div>
                ) : (
                  <table className="w-full text-sm">
                    <tbody>
                      {entries.map((e, i) => (
                        <tr key={i} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
                          <td className="px-5 py-3 w-8">
                            <span className={`font-mono font-bold text-sm
                              ${i === 0 ? "text-cz-accent-t" : i === 1 ? "text-cz-2" : i === 2 ? "text-cz-warning/60" : "text-cz-3"}`}>
                              #{i + 1}
                            </span>
                          </td>
                          <td className="px-3 py-3">
                            <TeamLink id={e.team?.id} className="text-cz-1 font-medium hover:text-cz-accent-t">
                              {e.team_name || e.team?.name || "—"}
                            </TeamLink>
                            {e.season_number && (
                              <p className="text-cz-3 text-xs">{t("season", { n: e.season_number })}</p>
                            )}
                          </td>
                          <td className="px-5 py-3 text-right">
                            <span className="font-mono font-bold text-lg text-cz-accent-t">
                              {formatNumber(e.value)}
                            </span>
                            <span className="text-cz-3 text-xs ms-1">{t(`units.${cat.unitKey}`)}</span>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Managers tab */}
      {tab === "managers" && (
        <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-cz-border">
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">#</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("thManager")}</th>
                <th className="px-4 py-3 text-left text-cz-3 font-medium text-xs uppercase">{t("thTitle")}</th>
                <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">{t("thLevel")}</th>
                <th className="px-4 py-3 text-right text-cz-3 font-medium text-xs uppercase">{t("thXp")}</th>
              </tr>
            </thead>
            <tbody>
              {managers.map((m, i) => {
                const levelInfo = getLevelInfo(m.level || 1);
                const xpProgress = ((m.xp || 0) % 100);
                return (
                  <tr key={m.id} className="border-b border-cz-border hover:bg-cz-subtle">
                    <td className="px-4 py-3 text-cz-2 font-mono text-sm">#{i + 1}</td>
                    <td className="px-4 py-3">
                      <TeamLink id={m.team_id} className="text-cz-1 font-medium hover:text-cz-accent-t">
                        {m.manager_name || m.team_name || "—"}
                      </TeamLink>
                      {m.manager_name && m.team_name && m.manager_name !== m.team_name && (
                        <p className="text-cz-3 text-xs">{m.team_name}</p>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className={`text-xs font-medium px-2 py-0.5 rounded-full bg-cz-subtle ${levelInfo.cls}`}>
                        {t(`level.${levelInfo.key}`)}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <span className={`font-mono font-bold ${levelInfo.cls}`}>
                        {m.level || 1}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <div className="w-16 bg-cz-subtle rounded-full h-1.5">
                          <div className="h-1.5 rounded-full bg-cz-accent"
                            style={{ width: `${Math.min(xpProgress, 100)}%` }} />
                        </div>
                        <span className="text-cz-2 font-mono text-xs">{m.xp || 0}</span>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Division history tab */}
      {tab === "divhistory" && (
        <div>
          {Object.keys(divHistory).length === 0 ? (
            <div className="text-center py-16 text-cz-3">
              <TrophyIcon size={32} className="mx-auto mb-3" aria-hidden="true" />
              <p>{t("noDivHistory")}</p>
              <p className="text-sm mt-2">{t("noDivHistoryHint")}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {Object.entries(divHistory).sort((a, b) => parseInt(b[0]) - parseInt(a[0])).map(([season, entries]) => (
                <div key={season} className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
                  <div className="px-5 py-3 border-b border-cz-border flex items-center gap-2">
                    <span className="text-cz-accent-t font-bold text-sm">{t("season", { n: season })}</span>
                    <span className="text-cz-3 text-xs">{t("division1")}</span>
                  </div>
                  <table className="w-full text-sm">
                    <tbody>
                      {entries.sort((a, b) => b.total_points - a.total_points).map((s, i) => (
                        <tr key={s.id} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
                          <td className="px-5 py-2.5 w-8">
                            <span className={`font-mono font-bold ${i === 0 ? "text-cz-accent-t" : "text-cz-2"}`}>
                              #{i + 1}
                            </span>
                          </td>
                          <td className="px-3 py-2.5">
                            <TeamLink id={s.team?.id} className="text-cz-1 font-medium hover:text-cz-accent-t">
                              {s.team?.name}
                            </TeamLink>
                          </td>
                          <td className="px-5 py-2.5 text-right text-cz-accent-t font-mono font-bold">
                            {formatNumber(s.total_points)} {t("ptSuffix")}
                          </td>
                          <td className="px-5 py-2.5 text-right text-cz-2 text-xs">
                            {t("stageWins", { count: s.stage_wins || 0 })}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
