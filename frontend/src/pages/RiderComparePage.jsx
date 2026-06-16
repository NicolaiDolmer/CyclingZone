import { useState, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "../lib/supabase";
import RiderLink from "../components/RiderLink";
import TeamLink from "../components/TeamLink";
import { Flag } from "../components/Flag";
import { formatCz, getRiderMarketValue } from "../lib/marketValues";
import ScoutablePotentiale from "../components/rider/ScoutablePotentiale";
import { useScouting } from "../lib/useScouting";
import { statColor, statStyle } from "../lib/statColor";

const MAX_COMPARE = 3;

// #1162: riders-kolonner er klient-læsbare via eksplicit kolonne-GRANT (potentiale
// er server-skjult) — `select=*` afvises af PostgREST, så listen skal være eksplicit.
const COMPARE_RIDER_COLUMNS = `id, firstname, lastname, birthdate, market_value, base_value,
  prize_earnings_bonus, salary, is_u25, nationality_code, team_id, primary_type, secondary_type,
  stat_fl, stat_bj, stat_kb, stat_bk, stat_tt, stat_prl, stat_bro, stat_sp, stat_acc, stat_ned,
  stat_udh, stat_mod, stat_res, stat_ftr`;

// Skill labels reuse the shared rider:skills.{slug}.long translations (same as RiderStatsPage).
const STATS = [
  { key: "stat_fl",  slug: "fl",  icon: "═" },
  { key: "stat_bj",  slug: "bj",  icon: "▲" },
  { key: "stat_kb",  slug: "kb",  icon: "△" },
  { key: "stat_bk",  slug: "bk",  icon: "∧" },
  { key: "stat_tt",  slug: "tt",  icon: "⏱" },
  { key: "stat_prl", slug: "prl", icon: "◷" },
  { key: "stat_bro", slug: "bro", icon: "⬡" },
  { key: "stat_sp",  slug: "sp",  icon: "⚡" },
  { key: "stat_acc", slug: "acc", icon: "▶" },
  { key: "stat_ned", slug: "ned", icon: "↓" },
  { key: "stat_udh", slug: "udh", icon: "◎" },
  { key: "stat_mod", slug: "mod", icon: "◈" },
  { key: "stat_res", slug: "res", icon: "↺" },
  { key: "stat_ftr", slug: "ftr", icon: "★" },
];

function RiderSearch({ onSelect, excluded }) {
  const { t } = useTranslation("rider");
  const [q, setQ] = useState("");
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (q.length < 2) { setResults([]); return; }
    const timeout = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase
        .from("riders")
        .select("id, firstname, lastname, market_value, team:team_id(name)")
        .or(`firstname.ilike.%${q}%,lastname.ilike.%${q}%`)
        .eq("is_retired", false)
        .order("market_value", { ascending: false })
        .limit(8);
      setResults((data || []).filter(r => !excluded.includes(r.id)));
      setLoading(false);
    }, 300);
    return () => clearTimeout(timeout);
  }, [q, excluded]);

  return (
    <div className="relative">
      <input
        type="text"
        value={q}
        onChange={e => setQ(e.target.value)}
        placeholder={t("compare.searchPlaceholder")}
        className="w-full bg-cz-subtle border border-cz-border rounded-lg px-4 py-2.5
          text-cz-1 text-sm placeholder-cz-3 focus:outline-none focus:border-cz-accent"
      />
      {(results.length > 0 || loading) && (
        <div className="absolute top-full left-0 right-0 mt-1 bg-cz-card border border-cz-border
          rounded-cz shadow-2xl z-20 overflow-hidden">
          {loading ? (
            <div className="p-3 text-center text-cz-3 text-sm">{t("compare.searching")}</div>
          ) : (
            results.map(r => (
              <div key={r.id}
                className="flex items-center justify-between px-4 py-2.5 hover:bg-cz-subtle
                  cursor-pointer border-b border-cz-border last:border-0"
                onClick={() => { onSelect(r); setQ(""); setResults([]); }}>
                <div>
                  <p className="text-cz-1 text-sm font-medium">{r.firstname} {r.lastname}</p>
                  <p className="text-cz-3 text-xs">{r.team?.name || t("compare.teamFree")}</p>
                </div>
                <span className="text-cz-accent-t font-mono text-xs">
                  {formatCz(getRiderMarketValue(r))}
                </span>
              </div>
            ))
          )}
        </div>
      )}
    </div>
  );
}

export default function RiderComparePage() {
  const { t } = useTranslation("rider");
  const [searchParams, setSearchParams] = useSearchParams();
  const scouting = useScouting();
  const [fullRiders, setFullRiders] = useState([]);
  const initialIdsRef = useRef(searchParams.get("ids") || "");

  // Deep-link: load ?ids=uuid1,uuid2 on mount (snapshot — does not refetch when URL changes).
  useEffect(() => {
    const raw = initialIdsRef.current;
    if (!raw) return;
    const ids = raw.split(",").map(s => s.trim()).filter(Boolean).slice(0, MAX_COMPARE);
    if (ids.length === 0) return;
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("riders")
        .select(`${COMPARE_RIDER_COLUMNS}, team:team_id(id, name)`)
        .in("id", ids);
      if (cancelled || !data) return;
      const ordered = ids.map(id => data.find(r => r.id === id)).filter(Boolean);
      setFullRiders(ordered);
    })();
    return () => { cancelled = true; };
  }, []);

  // Sync URL whenever the selected riders change so the view is shareable/back-navigable.
  useEffect(() => {
    const ids = fullRiders.map(r => r.id).join(",");
    const current = searchParams.get("ids") || "";
    if (ids === current) return;
    const next = new URLSearchParams(searchParams);
    if (ids) next.set("ids", ids); else next.delete("ids");
    setSearchParams(next, { replace: true });
  }, [fullRiders, searchParams, setSearchParams]);

  async function addRider(rider) {
    if (fullRiders.length >= MAX_COMPARE) return;
    if (fullRiders.find(r => r.id === rider.id)) return;

    const { data } = await supabase
      .from("riders")
      .select(`${COMPARE_RIDER_COLUMNS}, team:team_id(id, name)`)
      .eq("id", rider.id)
      .single();
    if (data) setFullRiders(prev => [...prev, data]);
  }

  function removeRider(id) {
    setFullRiders(prev => prev.filter(r => r.id !== id));
  }

  function getBestForStat(statKey) {
    if (fullRiders.length < 2) return null;
    return fullRiders.reduce((best, r) =>
      (r[statKey] || 0) > (best[statKey] || 0) ? r : best
    ).id;
  }

  return (
    <div className="max-w-4xl mx-auto">
      <div className="mb-5">
        <h1 className="text-xl font-bold text-cz-1">{t("compare.title")}</h1>
        <p className="text-cz-3 text-sm">{t("compare.subtitle")}</p>
      </div>

      {/* Search */}
      {fullRiders.length < MAX_COMPARE && (
        <div className="mb-5">
          <RiderSearch onSelect={addRider} excluded={fullRiders.map(r => r.id)} />
        </div>
      )}

      {fullRiders.length === 0 ? (
        <div className="text-center py-16 text-cz-3">
          <p className="text-4xl mb-3">◈</p>
          <p>{t("compare.empty")}</p>
        </div>
      ) : (
        <>
          {/* Rider headers */}
          <div className="grid gap-3 mb-5" style={{ gridTemplateColumns: `200px repeat(${fullRiders.length}, 1fr)` }}>
            <div /> {/* Empty cell for label column */}
            {fullRiders.map((r) => (
              <div key={r.id} className="bg-cz-card border border-cz-border rounded-cz p-4 text-center">
                <button
                  onClick={() => removeRider(r.id)}
                  className="float-right text-cz-3 hover:text-cz-2 text-sm -mt-1 -me-1">×</button>
                <RiderLink id={r.id}
                  className="font-bold text-cz-1 text-sm cursor-pointer hover:text-cz-accent-t block">
                  {r.nationality_code && <Flag code={r.nationality_code} className="me-1" />}{r.firstname} {r.lastname}
                </RiderLink>
                <p className="text-cz-3 text-xs mt-1">
                  <TeamLink id={r.team?.id} className="hover:text-cz-accent-t transition-colors">{r.team?.name || t("compare.teamFree")}</TeamLink>
                </p>
                <p className="font-mono font-bold mt-2 text-sm text-cz-1">
                  {formatCz(getRiderMarketValue(r))}
                </p>
                {r.is_u25 && (
                  <span className="text-[9px] uppercase bg-cz-info-bg0/20 text-cz-info
                    px-1.5 py-0.5 rounded mt-1 inline-block">U25</span>
                )}
              </div>
            ))}
          </div>

          {/* Stats comparison */}
          <div className="bg-cz-card border border-cz-border rounded-cz overflow-hidden">
            {/* Potentiale row */}
            {fullRiders.some(r => scouting.estimateFor(r.id) !== null) && (
              <div className="grid items-center py-3 px-4 border-b border-cz-border bg-cz-accent/10"
                style={{ gridTemplateColumns: `200px repeat(${fullRiders.length}, 1fr)` }}>
                <div className="flex items-center gap-2">
                  <span className="text-cz-3 w-4 text-center">◆</span>
                  <span className="text-cz-2 text-sm font-medium">{t("compare.potential")}</span>
                </div>
                {fullRiders.map(r => (
                  <div key={r.id} className="px-2">
                    <ScoutablePotentiale rider={r} scouting={scouting} />
                  </div>
                ))}
              </div>
            )}
            {STATS.map((stat, idx) => {
              const bestId = getBestForStat(stat.key);
              return (
                <div key={stat.key}
                  className={`grid items-center py-3 px-4 border-b border-cz-border last:border-0
                    ${idx % 2 === 0 ? "bg-transparent" : ""}`}
                  style={{ gridTemplateColumns: `200px repeat(${fullRiders.length}, 1fr)` }}>
                  <div className="flex items-center gap-2">
                    <span className="text-cz-3 w-4 text-center">{stat.icon}</span>
                    <span className="text-cz-2 text-sm">{t(`skills.${stat.slug}.long`)}</span>
                  </div>
                  {fullRiders.map((r) => {
                    const val = r[stat.key];
                    const isBest = r.id === bestId;
                    return (
                      <div key={r.id} className="px-2">
                        <div className="flex items-center gap-2">
                          <div className="flex-1 bg-cz-subtle rounded-full h-2">
                            <div className="h-2 rounded-full transition-all duration-500"
                              style={{
                                width: `${Math.round(((val || 0) / 99) * 100)}%`,
                                backgroundColor: statColor(val),
                                opacity: isBest ? 1 : 0.4,
                              }} />
                          </div>
                          {isBest ? (
                            <span className="font-mono text-xs font-extrabold flex-shrink-0 inline-block min-w-[28px] text-center rounded px-1 py-0.5"
                              style={statStyle(val)}>
                              {val ?? "—"}
                            </span>
                          ) : (
                            <span className="font-mono text-xs font-medium w-7 text-right flex-shrink-0"
                              style={{ color: statColor(val) }}>
                              {val ?? "—"}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
