// Import the same ESM implementations directly; the package barrel retains
// additional chart initialization in the measured client build (#6165).
import { Line } from "recharts/es6/cartesian/Line.js";
import { LineChart } from "recharts/es6/chart/LineChart.js";
import { XAxis } from "recharts/es6/cartesian/XAxis.js";
import { YAxis } from "recharts/es6/cartesian/YAxis.js";
import { CartesianGrid } from "recharts/es6/cartesian/CartesianGrid.js";
import { Tooltip } from "recharts/es6/component/Tooltip.js";
import { Legend } from "recharts/es6/component/Legend.js";
import { ResponsiveContainer } from "recharts/es6/component/ResponsiveContainer.js";

// Delt linjediagram-komponent til vækst-dashboardets trend-visninger (DAU/WAU/
// MAU, D1/D7/D30, NPS-score over tid). recharts er allerede en frontend-dep
// (v3.10.1, se AdminEconomyTab/SeasonFinanceReportPanel) — INGEN nye deps.
// Farver kommer fra chartPalette.js's CSS-var-tokens (rgb(var(--cz-chart-N))),
// samme mønster som eksisterende donut-brug, så farverne themer korrekt i
// både lys og mørk visning uden separat dark-mode-gren.
function formatDateTick(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit" });
}

function formatDateFull(dateStr) {
  const d = new Date(`${dateStr}T00:00:00Z`);
  return d.toLocaleDateString("da-DK", { day: "2-digit", month: "2-digit", year: "numeric" });
}

export default function TrendLineChart({ data, lines, xKey = "snapshot_date", height = 260, yFormatter }) {
  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 4, right: 8, left: -16, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
          <XAxis
            dataKey={xKey}
            tickFormatter={formatDateTick}
            tick={{ fill: "var(--text-3)", fontSize: 11 }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={{ stroke: "var(--border)" }}
            minTickGap={24}
          />
          <YAxis
            tick={{ fill: "var(--text-3)", fontSize: 11 }}
            axisLine={{ stroke: "var(--border)" }}
            tickLine={{ stroke: "var(--border)" }}
            width={40}
            tickFormatter={yFormatter}
          />
          <Tooltip
            labelFormatter={formatDateFull}
            contentStyle={{
              background: "var(--bg-card)",
              border: "1px solid var(--border)",
              borderRadius: 5,
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--text-1)" }}
          />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--text-3)" }} />
          {lines.map(line => (
            <Line
              key={line.key}
              type="monotone"
              dataKey={line.key}
              name={line.label}
              stroke={line.color}
              strokeWidth={2}
              dot={false}
              connectNulls
              isAnimationActive={false}
            />
          ))}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
