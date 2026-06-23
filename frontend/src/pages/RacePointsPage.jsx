import { useState, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/intl";
import { Card, PageLoader, CoinIcon, InfoIcon } from "../components/ui";
// Frontend single source of truth for PRIZE_PER_POINT (mirrors backend economyConstants.js).
import { PRIZE_PER_POINT } from "../lib/expectedPrizeCalculator";

const CLASS_ORDER = [
  "TourFrance", "GiroVuelta", "Monuments",
  "OtherWorldTourA", "OtherWorldTourB", "OtherWorldTourC",
  "ProSeries", "Class1", "Class2",
];

// Badge-i18n-nøgle pr. klasse (label kommer fra t(`classOption.${c}`)).
const CLASS_BADGE = {
  TourFrance:      "grandTour",
  GiroVuelta:      "grandTour",
  Monuments:       "oneDay",
  OtherWorldTourA: "worldTour",
  OtherWorldTourB: "worldTour",
  OtherWorldTourC: "worldTour",
  ProSeries:       "continental",
  Class1:          "continental",
  Class2:          "continental",
};

const TYPE_ORDER = [
  "Klassement", "Klassiker", "Etapeplacering",
  "Pointtroje", "Bjergtroje", "Ungdomstroje",
  "EtapelobHold", "KlassikerHold",
  "Forertroje", "PointtrojeDag", "BjergtrojeDag", "UngdomstrojeDag",
];

// Per-day jersey types: each has exactly one rank=1 row and renders as a compact single-row card.
const PER_DAY_JERSEY_TYPES = new Set([
  "Forertroje", "PointtrojeDag", "BjergtrojeDag", "UngdomstrojeDag",
]);

const PRIZE_EXAMPLES = [
  { key: "tourWin",      points: 1300 },
  { key: "monumentWin",  points: 800 },
  { key: "tourStageWin", points: 210 },
  { key: "proSeriesWin", points: 200 },
  { key: "class1Win",    points: 125 },
  { key: "class2Win",    points: 40 },
];

function fmt(n) {
  return formatNumber(n);
}

function fmtPrize(pts) {
  return formatNumber(pts * PRIZE_PER_POINT) + " CZ$";
}

export default function RacePointsPage() {
  const { t } = useTranslation("races");
  const [grouped, setGrouped] = useState({});
  const [loading, setLoading] = useState(true);
  const [activeClass, setActiveClass] = useState("TourFrance");
  const [expanded, setExpanded] = useState({});

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

  useEffect(() => { loadData(); }, []);

  function toggleExpand(key) {
    setExpanded(prev => ({ ...prev, [key]: !prev[key] }));
  }

  if (loading) return (
    <PageLoader />
  );

  const classData = grouped[activeClass] || {};
  const availableTypes = TYPE_ORDER.filter(type => classData[type]?.length > 0);

  return (
    <div className="max-w-4xl mx-auto space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-xl font-bold text-cz-1">{t("points.title")}</h1>
          <p className="text-cz-3 text-sm">{t("points.subtitle")}</p>
        </div>
        <Link
          to="/help"
          className="flex-shrink-0 flex items-center gap-1.5 text-xs text-cz-3 hover:text-cz-2 transition-colors mt-1"
          title={t("points.help")}
        >
          <InfoIcon size={16} className="text-cz-3 flex-shrink-0" aria-hidden="true" />
          <span className="hidden sm:inline">{t("points.help")}</span>
        </Link>
      </div>

      {/* Prize formula */}
      <div className="bg-cz-accent/10 border border-cz-accent/30 rounded-cz p-4 space-y-3">
        <div className="flex items-center gap-2">
          <CoinIcon size={18} className="text-cz-accent-t flex-shrink-0" />
          <span className="font-semibold text-cz-1">{t("points.formula", { amount: fmt(PRIZE_PER_POINT) })}</span>
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {PRIZE_EXAMPLES.map(ex => (
            <div key={ex.key} className="bg-cz-card rounded-lg px-3 py-2 border border-cz-accent/30">
              <p className="text-xs text-cz-2 truncate">{t(`points.prizeExample.${ex.key}`)}</p>
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
                ? "bg-cz-accent-t text-cz-on-accent"
                : "bg-cz-card border border-cz-border text-cz-2 hover:border-cz-accent/30 hover:text-cz-accent-t"
              }`}
          >
            {t(`classOption.${c}`)}
          </button>
        ))}
      </div>

      {/* Active class subtitle */}
      {CLASS_BADGE[activeClass] && (
        <p className="text-xs text-cz-3 -mt-2">
          {t(`classBadge.${CLASS_BADGE[activeClass]}`)} · {t(`classOption.${activeClass}`)}
        </p>
      )}

      {/* Result type tables */}
      {availableTypes.length === 0 ? (
        <div className="text-center py-12 text-cz-3">
          <p>{t("points.noClassData")}</p>
        </div>
      ) : (
        <div className="space-y-4">
          {availableTypes.map(rType => {
            const rows = classData[rType] || [];
            const label = t(`points.type.${rType}.label`);
            const desc = t(`points.type.${rType}.desc`);
            const expandKey = `${activeClass}__${rType}`;
            const isExpanded = expanded[expandKey];
            const displayRows = isExpanded ? rows : rows.slice(0, 15);
            const hasMore = rows.length > 15;

            if (PER_DAY_JERSEY_TYPES.has(rType) && rows.length === 1) {
              const pt = rows[0].points;
              return (
                <Card key={rType} className="overflow-hidden">
                  <div className="px-4 py-3 border-b border-cz-border flex items-center justify-between">
                    <div>
                      <h3 className="font-semibold text-cz-1 text-sm">{label}</h3>
                      <p className="text-xs text-cz-3">{desc}</p>
                    </div>
                  </div>
                  <div className="px-4 py-4 flex items-center justify-between">
                    <p className="text-cz-2 text-sm">{desc}</p>
                    <div className="text-right">
                      <p className="font-mono font-bold text-cz-accent-t">{fmt(pt)} pt</p>
                      <p className="text-xs text-cz-3">{fmtPrize(pt)}</p>
                    </div>
                  </div>
                </Card>
              );
            }

            return (
              <Card key={rType} className="overflow-hidden">
                <div className="px-4 py-3 border-b border-cz-border">
                  <h3 className="font-semibold text-cz-1 text-sm">{label}</h3>
                  <p className="text-xs text-cz-3">{desc}</p>
                </div>
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-cz-border text-left">
                        <th className="px-4 py-2 font-medium text-cz-2 text-xs w-14">{t("points.thRank")}</th>
                        <th className="px-4 py-2 font-medium text-cz-2 text-xs">{t("points.thPoints")}</th>
                        <th className="px-4 py-2 font-medium text-cz-2 text-xs text-right">{t("points.thPrize")}</th>
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
                      {isExpanded ? t("points.showLess") : t("points.showAll", { count: rows.length })}
                    </button>
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}
