import { useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

function formatHistoryDate(value, options = { day: "numeric", month: "short" }) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("da-DK", options);
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
    <div className="bg-white border border-slate-200 rounded-lg shadow-sm px-3 py-2">
      <p className="text-slate-400 text-xs">{point?.tooltipDate || label}</p>
      <p className="text-slate-900 text-sm font-mono font-bold">{payload[0].value?.toLocaleString("da-DK")}</p>
    </div>
  );
}

function DevelopmentChart({ title, subtitle, data, color }) {
  return (
    <div>
      {(title || subtitle) && (
        <div className="mb-3">
          {title && <h3 className="font-semibold text-slate-900 text-sm">{title}</h3>}
          {subtitle && <p className="text-slate-400 text-xs mt-0.5">{subtitle}</p>}
        </div>
      )}
      <div className="h-56">
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -18 }}>
            <CartesianGrid stroke="#e2e8f0" strokeDasharray="3 3" vertical={false} />
            <XAxis
              dataKey="dateLabel"
              tick={{ fill: "#94a3b8", fontSize: 11 }}
              tickLine={false}
              axisLine={{ stroke: "#e2e8f0" }}
              minTickGap={16}
            />
            <YAxis
              tick={{ fill: "#94a3b8", fontSize: 11 }}
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
              dot={{ r: 3, strokeWidth: 2, fill: "#fff" }}
              activeDot={{ r: 5 }}
              connectNulls
            />
          </LineChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

export default function RiderDevelopmentTab({ uciHistory, statHistory, stats }) {
  const [selectedStat, setSelectedStat] = useState(stats[0].key);

  const selectedStatMeta = stats.find(s => s.key === selectedStat) || stats[0];
  const uciChartData = uciHistory.map(row => toHistoryPoint(row, "uci_points"));
  const statChartData = statHistory.map(row => toHistoryPoint(row, selectedStat));
  const recentDevelopmentRows = [...new Set([
    ...uciHistory.map(row => row.synced_at),
    ...statHistory.map(row => row.synced_at),
  ])]
    .sort((a, b) => new Date(b) - new Date(a))
    .slice(0, 8)
    .map(date => ({
      synced_at: date,
      uci_points: uciHistory.find(row => row.synced_at === date)?.uci_points,
      stat_value: statHistory.find(row => row.synced_at === date)?.[selectedStat],
    }));

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5">
      {uciHistory.length === 0 && statHistory.length === 0 ? (
        <p className="text-slate-300 text-center py-8">Ingen historik endnu — data akkumuleres fra næste ugentlige sync</p>
      ) : (
        <div className="space-y-6">
          {uciHistory.length > 0 && (
            <section>
              <DevelopmentChart
                title="UCI-point over tid"
                subtitle="Seneste historiske syncs for rytterens pointtotal"
                data={uciChartData}
                color="#e8c547"
              />
            </section>
          )}

          {statHistory.length > 0 && (
            <section>
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-3">
                <div>
                  <h3 className="font-semibold text-slate-900 text-sm">Stats-udvikling</h3>
                  <p className="text-slate-400 text-xs mt-0.5">Vælg evne og se ændringen over tid</p>
                </div>
                <select
                  value={selectedStat}
                  onChange={e => setSelectedStat(e.target.value)}
                  className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-slate-700 text-sm focus:outline-none focus:border-amber-400"
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
                color="#60a5fa"
              />
            </section>
          )}

          {recentDevelopmentRows.length > 0 && (
            <section className="border-t border-slate-100 pt-4 overflow-x-auto">
              <div className="px-4 py-3 border-b border-slate-100">
                <h3 className="font-semibold text-slate-900 text-sm">Seneste datapunkter</h3>
              </div>
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-slate-100">
                    <th className="px-4 py-2 text-left text-slate-400 text-[10px] uppercase">Dato</th>
                    <th className="px-4 py-2 text-right text-slate-400 text-[10px] uppercase">UCI</th>
                    <th className="px-4 py-2 text-right text-slate-400 text-[10px] uppercase">{selectedStatMeta.label}</th>
                  </tr>
                </thead>
                <tbody>
                  {recentDevelopmentRows.map(row => (
                    <tr key={row.synced_at} className="border-b border-slate-100 last:border-0">
                      <td className="px-4 py-2 text-slate-500">{formatHistoryDate(row.synced_at, { day: "numeric", month: "short", year: "numeric" })}</td>
                      <td className="px-4 py-2 text-right text-amber-700 font-mono">{row.uci_points ?? "—"}</td>
                      <td className="px-4 py-2 text-right text-blue-500 font-mono">{row.stat_value ?? "—"}</td>
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
