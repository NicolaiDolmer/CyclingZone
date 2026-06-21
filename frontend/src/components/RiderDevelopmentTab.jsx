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
import { formatDate, formatNumber } from "../lib/intl";

function formatHistoryDate(value, options = { day: "numeric", month: "short" }) {
  if (!value) return "—";
  return formatDate(value, null, options);
}

function toHistoryPoint(row, valueKey) {
  return {
    ...row,
    dateLabel: formatHistoryDate(row.synced_at),
    tooltipDate: formatHistoryDate(row.synced_at, { day: "numeric", month: "short", year: "numeric" }),
    value: row[valueKey] ?? null,
  };
}

function HistoryTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  const point = payload[0]?.payload;
  return (
    <div className="bg-cz-card border border-cz-border rounded-lg shadow-sm px-3 py-2">
      <p className="text-cz-3 text-xs">{point?.tooltipDate || label}</p>
      <p className="text-cz-1 text-sm font-mono font-bold">{formatNumber(payload[0].value)}</p>
    </div>
  );
}

function DevelopmentChart({ title, subtitle, data, color }) {
  return (
    <div>
      {(title || subtitle) && (
        <div className="mb-3">
          {title && <h3 className="font-semibold text-cz-1 text-sm">{title}</h3>}
          {subtitle && <p className="text-cz-3 text-xs mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
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
            />
            <Tooltip content={<HistoryTooltip />} />
            <Line
              type="monotone"
              dataKey="value"
              stroke={color}
              strokeWidth={2.5}
              dot={{ r: 3, strokeWidth: 2, fill: "var(--bg-card)" }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// #1101 cutover: UCI-point-grafen er fjernet — uci_points er afkoblet og må ikke
// vises player-facing. Tab'en viser kun stats-udvikling (rider_stat_history).
export default function RiderDevelopmentTab({ statHistory, stats }) {
  const { t } = useTranslation("rider");
  const [selectedStat, setSelectedStat] = useState(stats[0].key);

  const selectedStatMeta = stats.find(s => s.key === selectedStat) || stats[0];
  const statChartData = statHistory.map(row => toHistoryPoint(row, selectedStat));
  const recentDevelopmentRows = [...statHistory]
    .sort((a, b) => new Date(b.synced_at) - new Date(a.synced_at))
    .slice(0, 8)
    .map(row => ({ synced_at: row.synced_at, stat_value: row[selectedStat] }));

  return (
    <div className="bg-cz-card border border-cz-border rounded-cz p-5">
      {statHistory.length === 0 ? (
        <p className="text-cz-3 text-center py-8">{t("development.empty")}</p>
      ) : (
        <div className="space-y-6">
          {statHistory.length > 0 && (
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-semibold text-cz-1 text-sm">{t("development.statsTitle")}</h3>
                  <p className="text-cz-3 text-xs mt-0.5">{t("development.statsSubtitle")}</p>
                </div>
                <select
                  value={selectedStat}
                  onChange={e => setSelectedStat(e.target.value)}
                  className="bg-cz-subtle border border-cz-border rounded-lg px-3 py-2 text-cz-2 text-sm focus:outline-none focus:border-cz-accent"
                >
                  {stats.map(stat => (
                    <option key={stat.key} value={stat.key}>{stat.label}</option>
                  ))}
                </select>
              </div>
              <DevelopmentChart
                title=""
                subtitle=""
                data={statChartData}
                color="rgb(var(--accent-t))"
              />
            </section>
          )}

          {recentDevelopmentRows.length > 0 && (
            <section className="border-t border-cz-border pt-4 overflow-x-auto">
              <div className="px-4 py-3 border-b border-cz-border">
                <h3 className="font-semibold text-cz-1 text-sm">{t("development.recentTitle")}</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-cz-border">
                    <th className="px-4 py-2 text-left text-cz-3 text-[10px] uppercase">{t("development.table.date")}</th>
                    <th className="px-4 py-2 text-right text-cz-3 text-[10px] uppercase">{selectedStatMeta.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDevelopmentRows.map(row => (
                    <tr key={row.synced_at} className="border-b border-cz-border last:border-0">
                      <td className="px-4 py-2 text-cz-2">{formatHistoryDate(row.synced_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td className="px-4 py-2 text-right text-cz-info font-mono">{row.stat_value ?? t("development.fallbackDash")}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </div>
      )}
    </div>
  );
}
