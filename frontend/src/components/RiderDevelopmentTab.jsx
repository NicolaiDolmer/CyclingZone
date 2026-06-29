import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { formatDate } from "../lib/intl";
import { riderTypeRating } from "../lib/riderRating.js";

// #2000 Part 2 / #918: Udvikling-fanen viser nu udviklingen i rytterens OVERALL-
// rating PR. RYTTERTYPE over tid — én 1-99-linje pr. type, alle synlige med et
// klikbart type-filter. Data = evnevektor-snapshots fra GET /api/riders/:id/
// development; rating beregnes pr. snapshot via riderTypeRating (rating-SSOT,
// riderRating.js) → ingen PCM, ingen duplikat-rating-formel.

function formatHistoryDate(value, options = { day: "numeric", month: "short" }) {
  if (!value) return "—";
  return formatDate(value, null, options);
}

// Byg Recharts-data: ét punkt pr. snapshot med en rating pr. type (dataKey=type-key).
function buildChartData(history, types) {
  return history.map((row) => {
    const point = {
      dateLabel: formatHistoryDate(row.snapshot_date),
      tooltipDate: formatHistoryDate(row.snapshot_date, { day: "numeric", month: "short", year: "numeric" }),
      source: row.source,
    };
    for (const t of types) point[t.key] = riderTypeRating(row.abilities, t.key);
    return point;
  });
}

function RatingTooltip({ active, payload, types, hidden }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  const visible = types.filter((t) => !hidden.has(t.key));
  return (
    <div className="bg-cz-card border border-cz-border rounded-lg shadow-sm px-3 py-2 min-w-[9rem]">
      <p className="text-cz-3 text-xs mb-1">{point?.tooltipDate}</p>
      <div className="space-y-0.5">
        {visible.map((t) => (
          <div key={t.key} className="flex items-center justify-between gap-3 text-xs">
            <span className="flex items-center gap-1.5">
              <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: t.color }} />
              <span className="text-cz-2">{t.label}</span>
            </span>
            <span className="font-mono font-bold text-cz-1">{point?.[t.key] ?? "-"}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function RiderDevelopmentTab({ history = [], types = [] }) {
  const { t } = useTranslation("rider");
  const [hidden, setHidden] = useState(() => new Set());

  const chartData = buildChartData(history, types);
  const visibleTypes = types.filter((tp) => !hidden.has(tp.key));

  function toggle(key) {
    setHidden((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5">
      {history.length === 0 ? (
        <p className="text-cz-3 text-center py-8">{t("development.empty")}</p>
      ) : (
        <section>
          <div className="mb-3">
            <h3 className="font-semibold text-cz-1 text-sm">{t("development.statsTitle")}</h3>
            <p className="text-cz-3 text-xs mt-0.5">{t("development.statsSubtitle")}</p>
          </div>

          {/* Type-filter: klik for at vise/skjule en types linje. */}
          <div className="flex flex-wrap gap-2 mb-2">
            {types.map((tp) => {
              const off = hidden.has(tp.key);
              return (
                <button
                  key={tp.key}
                  type="button"
                  onClick={() => toggle(tp.key)}
                  className={`inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full border transition-all ${off ? "border-cz-border text-cz-3 opacity-60" : "text-cz-1"}`}
                  style={off ? undefined : { borderColor: tp.color }}
                  aria-pressed={!off}
                >
                  <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: tp.color }} />
                  {tp.label}
                </button>
              );
            })}
          </div>
          <div className="flex gap-3 mb-3">
            <button type="button" onClick={() => setHidden(new Set())}
              className="text-xs text-cz-2 hover:text-cz-1 underline-offset-2 hover:underline">
              {t("development.filterAll")}
            </button>
            <button type="button" onClick={() => setHidden(new Set(types.map((x) => x.key)))}
              className="text-xs text-cz-2 hover:text-cz-1 underline-offset-2 hover:underline">
              {t("development.filterNone")}
            </button>
          </div>

          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
                <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
                <XAxis
                  dataKey="dateLabel"
                  tick={{ fill: "var(--text-3)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={{ stroke: "var(--border)" }}
                  minTickGap={16}
                />
                <YAxis
                  tick={{ fill: "var(--text-3)", fontSize: 11 }}
                  tickLine={false}
                  axisLine={false}
                  allowDecimals={false}
                  domain={[
                    (dataMin) => Math.max(0, Math.floor(dataMin) - 5),
                    (dataMax) => Math.min(99, Math.ceil(dataMax) + 5),
                  ]}
                />
                <Tooltip content={<RatingTooltip types={types} hidden={hidden} />} />
                {visibleTypes.map((tp) => (
                  <Line
                    key={tp.key}
                    type="monotone"
                    dataKey={tp.key}
                    name={tp.label}
                    stroke={tp.color}
                    strokeWidth={2}
                    dot={{ r: 2, strokeWidth: 0, fill: tp.color }}
                    activeDot={{ r: 4 }}
                    connectNulls
                    isAnimationActive={false}
                  />
                ))}
              </LineChart>
            </ResponsiveContainer>
          </div>
        </section>
      )}
    </div>
  );
}
