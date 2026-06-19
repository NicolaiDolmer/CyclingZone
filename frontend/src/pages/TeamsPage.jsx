import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";
import { Card, Input, Spinner, EmptyState } from "../components/ui";

// Divisions-farver via design-tokens (ingen raa hex): D1 = accent-guld,
// D2 = chart-1 (blaa), D3 = chart-2 (violet). Brugt inline til prik + label.
const DIV_COLORS = {
  1: "rgb(var(--accent))",
  2: "rgb(var(--cz-chart-1))",
  3: "rgb(var(--cz-chart-2))",
};

export default function TeamsPage() {
  const navigate = useNavigate();
  const { t } = useTranslation("team");
  const [teams, setTeams] = useState([]);
  const [loading, setLoading] = useState(true);
  const [myTeamId, setMyTeamId] = useState(null);
  const [search, setSearch] = useState("");
  const [divFilter, setDivFilter] = useState("all");
  const [riderCounts, setRiderCounts] = useState({});
  const [standings, setStandings] = useState({});

  async function loadAll() {
    const { data: { user } } = await supabase.auth.getUser();
    const { data: myTeam } = await supabase.from("teams").select("id").eq("user_id", user.id).single();
    if (myTeam) setMyTeamId(myTeam.id);

    const { data: activeSeason } = await supabase
      .from("seasons").select("id")
      .eq("status", "active")
      .single();

    const [teamsRes, ridersRes, standingsRes] = await Promise.all([
      supabase.from("teams")
        .select("id, name, division, balance, sponsor_income, manager_name, user:user_id(last_seen)")
        .eq("is_ai", false)
        .eq("is_test_account", false)
        .eq("is_frozen", false)
        .order("division").order("name"),
      supabase.from("riders").select("team_id").not("team_id", "is", null),
      activeSeason
        ? supabase.from("season_standings")
            .select("team_id, total_points, stage_wins, gc_wins")
            .eq("season_id", activeSeason.id)
        : Promise.resolve({ data: [] }),
    ]);

    const counts = {};
    (ridersRes.data || []).forEach(r => {
      counts[r.team_id] = (counts[r.team_id] || 0) + 1;
    });
    setRiderCounts(counts);

    const smap = {};
    (teamsRes.data || []).forEach(team => {
      smap[team.id] = { total_points: 0, stage_wins: 0, gc_wins: 0 };
    });
    (standingsRes.data || []).forEach(s => {
      smap[s.team_id] = s;
    });
    setStandings(smap);
    setTeams(teamsRes.data || []);
    setLoading(false);
  }

  useEffect(() => { loadAll(); }, []);

  const filtered = teams.filter(t => {
    const matchSearch = !search || t.name.toLowerCase().includes(search.toLowerCase());
    const matchDiv = divFilter === "all" || t.division === parseInt(divFilter);
    return matchSearch && matchDiv;
  });

  if (loading) return (
    <div className="flex justify-center py-16">
      <Spinner />
    </div>
  );

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-cz-1">{t("list.title")}</h1>
        <p className="text-cz-3 text-sm">{t("list.managerCount", { count: teams.length })}</p>
      </div>

      {/* Filters */}
      <div className="flex gap-2 mb-5 flex-wrap">
        <Input type="text" placeholder={t("list.searchPlaceholder")} value={search}
          onChange={e => setSearch(e.target.value)}
          className="w-48" />
        {["all","1","2","3"].map(d => (
          <button key={d} onClick={() => setDivFilter(d)}
            className={`px-3 py-2 rounded-cz text-sm font-medium transition-all border
              ${divFilter === d
                ? "bg-cz-accent/10 text-cz-accent-t border-cz-accent/40"
                : "bg-cz-card text-cz-2 border-cz-border hover:text-cz-1"}`}>
            {d === "all" ? t("list.filterAll") : t("list.divisionShort", { n: d })}
          </button>
        ))}
      </div>

      {/* Teams by division */}
      {[1,2,3].map(div => {
        const divTeams = filtered.filter(t => t.division === div);
        if (!divTeams.length) return null;
        return (
          <div key={div} className="mb-6">
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2 h-2 rounded-cz-pill" style={{ background: DIV_COLORS[div] }} />
              <span className="text-xs uppercase tracking-widest font-medium"
                style={{ color: DIV_COLORS[div] }}>
                {t("list.divisionName", { n: div })}
              </span>
              <span className="text-cz-3 text-xs">— {t("list.teamsCount", { count: divTeams.length })}</span>
            </div>
            <div className="grid sm:grid-cols-2 gap-3">
              {divTeams.map(team => {
                const isMe = team.id === myTeamId;
                const riderCount = riderCounts[team.id] || 0;
                const standing = standings[team.id];
                const lastSeen = team.user?.last_seen;
                const isOnline = lastSeen && (Date.now() - new Date(lastSeen).getTime()) < 5 * 60 * 1000;
                return (
                  <Card key={team.id} interactive
                    onClick={() => navigate(`/teams/${team.id}`)}
                    style={isMe ? { boxShadow: "inset 0 0 0 1.5px rgb(var(--me-ring) / 0.5)" } : undefined}
                    className="p-4 cursor-pointer group">

                    {/* Header */}
                    <div className="flex items-start justify-between mb-3">
                      <div>
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="font-semibold text-sm group-hover:text-cz-accent-t transition-colors text-cz-1">
                            {team.name}
                          </p>
                          {isMe && (
                            <span className="text-[9px] font-bold uppercase px-1.5 py-0.5 rounded-cz-pill"
                              style={{ backgroundColor: "rgb(var(--me-badge-bg))", color: "rgb(var(--me-badge-fg))" }}>{t("list.youBadge")}</span>
                          )}
                        </div>
                        {team.manager_name && (
                          <p className="text-cz-2 text-xs mt-0.5">{team.manager_name}</p>
                        )}
                        <div className="flex items-center gap-1.5 mt-0.5">
                          <span className={`w-1.5 h-1.5 rounded-cz-pill flex-shrink-0 ${isOnline ? "bg-cz-success" : "bg-cz-subtle"}`} />
                          <p className="text-cz-3 text-xs">{t("list.ridersCount", { count: riderCount })}</p>
                        </div>
                      </div>

                    </div>

                    {/* Stats */}
                    <div className="grid grid-cols-3 gap-2">
                      <div className="bg-cz-subtle rounded-cz p-2 text-center">
                        <p className="text-cz-3 text-[9px] uppercase tracking-wider">{t("list.statPoints")}</p>
                        <p className="text-cz-1 font-mono font-bold text-xs mt-0.5">
                          {formatNumber(standing?.total_points) || 0}
                        </p>
                      </div>
                      <div className="bg-cz-subtle rounded-cz p-2 text-center">
                        <p className="text-cz-3 text-[9px] uppercase tracking-wider">{t("list.statStageWins")}</p>
                        <p className="text-cz-1 font-mono font-bold text-xs mt-0.5">
                          {standing?.stage_wins || 0}
                        </p>
                      </div>
                      <div className="bg-cz-subtle rounded-cz p-2 text-center">
                        <p className="text-cz-3 text-[9px] uppercase tracking-wider">{t("list.statGcWins")}</p>
                        <p className="text-cz-1 font-mono font-bold text-xs mt-0.5">
                          {standing?.gc_wins || 0}
                        </p>
                      </div>
                    </div>
                  </Card>
                );
              })}
            </div>
          </div>
        );
      })}

      {filtered.length === 0 && (
        <EmptyState
          icon={<span aria-hidden="true" className="text-3xl text-cz-3">◈</span>}
          title={t("list.noMatch")}
        />
      )}
    </div>
  );
}
