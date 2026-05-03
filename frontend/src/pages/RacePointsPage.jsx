import { useState, useEffect } from "react";
import { supabase } from "../lib/supabase";

const PRIZE_PER_POINT = 1_500;

const CLASS_ORDER = [
  "TourFrance", "GiroVuelta", "Monuments",
  "OtherWorldTourA", "OtherWorldTourB", "OtherWorldTourC",
  "ProSeries", "Class1", "Class2",
];

const CLASS_META = {
  TourFrance:      { label: "Tour de France", badge: "Grand Tour" },
  GiroVuelta:      { label: "Giro / Vuelta",  badge: "Grand Tour" },
  Monuments:       { label: "Monuments",      badge: "Endagsløb" },
  OtherWorldTourA: { label: "WorldTour A",    badge: "WorldTour" },
  OtherWorldTourB: { label: "WorldTour B",    badge: "WorldTour" },
  OtherWorldTourC: { label: "WorldTour C",    badge: "WorldTour" },
  ProSeries:       { label: "ProSeries",      badge: "Continental" },
  Class1:          { label: "Klasse 1",       badge: "Continental" },
  Class2:          { label: "Klasse 2",       badge: "Continental" },
};

const TYPE_ORDER = [
  "Klassement", "Klassiker", "Etapeplacering",
  "Pointtroje", "Bjergtroje", "Ungdomstroje",
  "EtapelobHold", "KlassikerHold", "Forertroje",
];

const TYPE_META = {
  Klassement:     { label: "Samlet klassement", desc: "GC-placering i etapeløb" },
  Klassiker:      { label: "Klassiker",          desc: "Samlet placering i endagsløb" },
  Etapeplacering: { label: "Etapeplacering",     desc: "Pr. etape i etapeløb" },
  Pointtroje:     { label: "Pointtrøje",         desc: "Top 3 i pointkonkurrencen" },
  Bjergtroje:     { label: "Bjergtrøje",         desc: "Top 3 i bjergkonkurrencen" },
  Ungdomstroje:   { label: "Ungdomstrøje",       desc: "Top 3 i U25-konkurrencen" },
  EtapelobHold:   { label: "Hold (etapeløb)",    desc: "Bedste hold i etapeløb" },
  KlassikerHold:  { label: "Hold (klassiker)",   desc: "Bedste hold i klassiker" },
  Forertroje:     { label: "Førertrøje",         desc: "Pr. dag i førerposition" },
};

const PRIZE_EXAMPLES = [
  { label: "Tour de France-sejr", points: 1300 },
  { label: "Monument-sejr",       points: 800 },
  { label: "Etapesejr (TdF)",     points: 210 },
  { label: "ProSeries-sejr",      points: 200 },
  { label: "Klasse 1-sejr",       points: 125 },
  { label: "Klasse 2-sejr",       points: 40 },
];

function fmt(n) {
  return n.toLocaleString("da-DK");
}

function fmtPrize(pts) {
  return (pts * PRIZE_PER_POINT).toLocaleString("da-DK") + " CZ$";
}

export default function RacePointsPage() {
  const [grouped, setGrouped] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeClass, setActiveClass] = useState("TourFrance");
  const [expanded, setExpanded] = useState({});

  useEffect(() => { loadData(); }, []);

  async function loadData() {
    const { data: rows } = await supabase
      .from("race_points")
      .select("race_class, result_type, rank, points")
      .order("rank");

    const g = {};
    for (const row of rows || []) {
      if (!g[row.race_class]) g[row.race_class] = {};
      if (!g[row.race_class][row.result_type]) g[row.race_class][row.result_type] = [];
      g[row.race_class][row.result_type].push(row);
    }
    setGrouped(g);
    setLoading(false);
  }

  function toggleExpand(key) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }

  if (loading) return (
    <div className="flex justify-center py-16">
      <div className="w-6 h-6 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
    </div>
  );

  const classData = grouped[activeClass] || {};
  const availableTypes = TYPE_ORDER.filter(t => classData[t]?.length > 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div>
        <h1 className="text-xl font-bold text-cz-1">Point- og præmieoversigt</h1>
        <p className="text-cz-3 text-sm">Sådan beregnes dine løbspræmier fra UCI-placeringer</p>
      </div>

      {/* Prize formula */}
      <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-xl p-4 space-y-3">
        <div className="flex items-center gap-2">
          <span className="text-lg">💰</span>
          <span className="font-semibold text-cz-1">Præmieformlen: 1 UCI-point = 1.500 CZ$</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PRIZE_EXAMPLES.map(ex => (
            <div key={ex.label} className="bg-cz-card rounded-lg px-3 py-2 border border-amber-100">
              <p className="text-xs text-cz-2 truncate">{ex.label}</p>
              <p className="font-mono font-bold text-cz-accent-t text-sm">{fmt(ex.points)} pt</p>
              <p className="text-xs text-cz-3">{fmtPrize(ex.points)}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Class selector */}
      <div className="flex gap-2 overflow-x-auto pb-1 -mx-1 px-1">
        {CLASS_ORDER.filter(c => grouped[c]).map(c => (
          <button
            key={c}
            onClick={() => setActiveClass(c)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-sm font-medium transition-colors whitespace-nowrap
              ${activeClass === c
                ? "bg-cz-accent-t text-white"
                : "bg-cz-card border border-cz-border text-cz-2 hover:border-cz-accent/30 hover:text-cz-accent-t"
              }`}
          >
            {CLASS_META[c]?.label ?? c}
          </button>
        ))}
      </div>

      {/* Active class subtitle */}
      {CLASS_META[activeClass] && (
        <p className="text-xs text-cz-3 -mt-2">
          {CLASS_META[activeClass].badge} · {CLASS_META[activeClass].label}
        </p>
      )}

      {/* Result type tables */}
      {availableTypes.length === 0 ? (
        <div className="text-center py-12 text-cz-3">
          <p>Ingen pointdata for denne klasse</p>
        </div>
      ) : (
        <div className="space-y-4">
          {availableTypes.map(rType => {
            const rows = classData[rType] || [];
            const meta = TYPE_META[rType] || { label: rType, desc: "" };
            const expandKey = `${activeClass}__${rType}`;
            const isExpanded = expanded[expandKey];
            const displayRows = isExpanded ? rows : rows.slice(0, 15);
            const hasMore = rows.length > 15;

            if (rType === "Forertroje" && rows.length === 1) {
              const pt = rows[0].points;
              return (
                <div key={rType} className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
                  <div className="px-4 py-3 border-b border-cz-border flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-cz-1 text-sm">{meta.label}</h3>
                      <p className="text-xs text-cz-3">{meta.desc}</p>
                    </div>
                  </div>
                  <div className="px-4 py-4 flex items-center justify-between">
                    <p className="text-cz-2 text-sm">Pr. dag i førerposition</p>
                    <div className="text-right">
                      <p className="font-mono font-bold text-cz-accent-t">{fmt(pt)} pt</p>
                      <p className="text-xs text-cz-3">{fmtPrize(pt)}</p>
                    </div>
                  </div>
                </div>
              );
            }

            return (
              <div key={rType} className="bg-cz-card border border-cz-border rounded-xl overflow-hidden">
                <div className="px-4 py-3 border-b border-cz-border">
                  <h3 className="font-semibold text-cz-1 text-sm">{meta.label}</h3>
                  <p className="text-xs text-cz-3">{meta.desc}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-cz-border text-left">
                        <th className="px-4 py-2 font-medium text-cz-2 text-xs w-14">Plads</th>
                        <th className="px-4 py-2 font-medium text-cz-2 text-xs">UCI-point</th>
                        <th className="px-4 py-2 font-medium text-cz-2 text-xs text-right">Præmie</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-cz-border">
                      {displayRows.map(row => (
                        <tr key={row.rank} className="hover:bg-cz-subtle">
                          <td className={`px-4 py-2 font-mono font-bold text-sm
                            ${row.rank === 1 ? "text-cz-accent-t"
                              : row.rank <= 3 ? "text-cz-2"
                              : "text-cz-3"}`}>
                            {row.rank}
                          </td>
                          <td className="px-4 py-2 font-mono text-cz-1">
                            {fmt(row.points)}
                          </td>
                          <td className="px-4 py-2 text-right text-cz-2 text-xs tabular-nums">
                            {fmtPrize(row.points)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {hasMore && (
                  <div className="px-4 py-2 border-t border-cz-border">
                    <button
                      onClick={() => toggleExpand(expandKey)}
                      className="text-xs text-cz-accent-t hover:underline"
                    >
                      {isExpanded ? "Skjul ↑" : `Vis alle ${rows.length} pladser ↓`}
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
