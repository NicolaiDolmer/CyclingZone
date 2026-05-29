import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { supabase } from "../lib/supabase";
import { formatNumber, formatDate as formatDateIntl } from "../lib/intl";

const API = import.meta.env.VITE_API_URL;

// Slice 07h · Sæson-finansrapport per hold.
//
// Læs-kun reproduktion af én sæsons cashflow for ÉT hold. Rapporten viser hero-
// kort (totalt ind/ud/net), to donuts (indtægt/udgift fordelt på reason_code),
// top-3 transaktioner i hver retning og aktiv loan-portfolio.
//
// Privatliv: backend håndhæver auth-gate (team-owner ELLER admin). Frontend
// kalder kun for ét teamId — ingen cross-team aggregering.

const DONUT_COLORS = [
  "#60a5fa", // blue
  "#a78bfa", // violet
  "#34d399", // emerald
  "#fbbf24", // amber
  "#f87171", // red
  "#22d3ee", // cyan
  "#f472b6", // pink
  "#facc15", // yellow
  "#94a3b8", // slate
];

function formatCZ(amount) {
  const n = Math.round(amount || 0);
  return `${formatNumber(n)} CZ$`;
}

function formatDate(iso) {
  if (!iso) return "—";
  return formatDateIntl(iso, null, {
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function DonutTooltip({ active, payload, total }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  const pct = total > 0 ? ((p.value / total) * 100).toFixed(1) : "0";
  return (
    <div className="bg-cz-card border border-cz-border rounded-lg shadow-sm px-3 py-2">
      <p className="text-cz-1 text-sm font-bold">{p.label}</p>
      <p className="text-cz-2 text-xs font-mono">
        {formatCZ(p.value)} · {pct}%
      </p>
    </div>
  );
}

function Donut({ title, data, emptyLabel }) {
  const { t } = useTranslation("finance");
  const total = data.reduce((sum, d) => sum + d.value, 0);
  if (!data.length) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-xl p-6">
        <h3 className="text-cz-1 font-semibold mb-4">{title}</h3>
        <div className="h-[260px] flex items-center justify-center text-cz-3 text-sm">
          {emptyLabel}
        </div>
      </div>
    );
  }
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-6">
      <h3 className="text-cz-1 font-semibold mb-4">{title}</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
        <div className="h-[200px] relative">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={data}
                dataKey="value"
                nameKey="label"
                innerRadius={50}
                outerRadius={80}
                paddingAngle={2}
                isAnimationActive={false}
              >
                {data.map((_, i) => (
                  <Cell key={i} fill={DONUT_COLORS[i % DONUT_COLORS.length]} />
                ))}
              </Pie>
              <Tooltip content={<DonutTooltip total={total} />} />
            </PieChart>
          </ResponsiveContainer>
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
            <span className="text-cz-3 text-xs uppercase tracking-wide">{t("report.total")}</span>
            <span className="text-cz-1 font-mono font-bold">{formatCZ(total)}</span>
          </div>
        </div>
        <ul className="space-y-1.5 text-sm">
          {data.map((d, i) => {
            const pct = total > 0 ? ((d.value / total) * 100).toFixed(1) : "0";
            return (
              <li key={d.reason_code} className="flex items-center justify-between gap-2">
                <span className="flex items-center gap-2 text-cz-2 truncate">
                  <span
                    className="w-3 h-3 rounded-sm shrink-0"
                    style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
                  />
                  <span className="truncate">{d.label}</span>
                </span>
                <span className="text-cz-1 font-mono shrink-0">
                  {formatCZ(d.value)}{" "}
                  <span className="text-cz-3 text-xs">({pct}%)</span>
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}

function HeroCard({ hero, season }) {
  const { t } = useTranslation("finance");
  const netClass =
    hero.net > 0 ? "text-cz-success" : hero.net < 0 ? "text-cz-danger" : "text-cz-2";
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
        <div>
          <p className="text-cz-3 text-xs uppercase tracking-wide">
            {t("report.season", { n: season?.number ?? "—" })}
            {season?.status === "active" && t("report.livePreview")}
          </p>
          <h2 className="text-cz-1 text-2xl font-bold">{t("report.cashflowOverview")}</h2>
          <p className="text-cz-3 text-xs mt-1">
            {formatDate(season?.start_date)}
            {season?.end_date ? ` – ${formatDate(season.end_date)}` : t("report.ongoing")}
          </p>
        </div>
        <div className="text-right">
          <p className="text-cz-3 text-xs uppercase tracking-wide">{t("report.netCashflow")}</p>
          <p className={`text-3xl font-mono font-bold ${netClass}`}>
            {hero.net > 0 ? "+" : ""}
            {formatCZ(hero.net)}
          </p>
          <p className="text-cz-3 text-xs">
            {t("report.transactionCount", { count: hero.transaction_count })}
          </p>
        </div>
      </div>
      <div className="grid grid-cols-2 gap-4 mt-6 pt-6 border-t border-cz-border">
        <div>
          <p className="text-cz-3 text-xs uppercase tracking-wide">{t("report.income")}</p>
          <p className="text-cz-success text-xl font-mono font-bold">
            +{formatCZ(hero.total_in)}
          </p>
        </div>
        <div className="text-right">
          <p className="text-cz-3 text-xs uppercase tracking-wide">{t("report.expense")}</p>
          <p className="text-cz-danger text-xl font-mono font-bold">
            {formatCZ(hero.total_out)}
          </p>
        </div>
      </div>
    </div>
  );
}

function TopTransactionsCard({ title, items, emptyLabel, isPositive }) {
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-6">
      <h3 className="text-cz-1 font-semibold mb-4">{title}</h3>
      {items.length === 0 ? (
        <p className="text-cz-3 text-sm">{emptyLabel}</p>
      ) : (
        <ul className="space-y-3">
          {items.map((tx) => (
            <li key={tx.id} className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="text-cz-1 text-sm truncate">{tx.description || tx.label}</p>
                <p className="text-cz-3 text-xs">
                  {tx.label} · {formatDate(tx.created_at)}
                </p>
              </div>
              <p
                className={`font-mono font-bold shrink-0 ${
                  isPositive ? "text-cz-success" : "text-cz-danger"
                }`}
              >
                {isPositive ? "+" : ""}
                {formatCZ(tx.amount)}
              </p>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

const LOAN_TYPE_KEYS = { short: "report.loanShort", long: "report.loanLong", emergency: "report.loanEmergency" };

function LoanPortfolioCard({ loans }) {
  const { t } = useTranslation("finance");
  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-6">
      <h3 className="text-cz-1 font-semibold mb-4">{t("report.activeLoans")}</h3>
      {loans.length === 0 ? (
        <p className="text-cz-3 text-sm">{t("report.noActiveLoans")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-cz-3 text-xs uppercase tracking-wide border-b border-cz-border">
                <th className="text-left py-2">{t("report.loanType")}</th>
                <th className="text-right py-2">{t("report.loanRemaining")}</th>
                <th className="text-right py-2">{t("report.loanInterest")}</th>
                <th className="text-right py-2">{t("report.loanSeasons")}</th>
                <th className="text-right py-2">{t("report.loanNextInterest")}</th>
              </tr>
            </thead>
            <tbody>
              {loans.map((l) => (
                <tr key={l.id} className="border-b border-cz-border/50 last:border-0">
                  <td className="py-2 text-cz-2">
                    {LOAN_TYPE_KEYS[l.loan_type] ? t(LOAN_TYPE_KEYS[l.loan_type]) : l.loan_type}
                  </td>
                  <td className="py-2 text-right text-cz-1 font-mono">
                    {formatCZ(l.amount_remaining)}
                  </td>
                  <td className="py-2 text-right text-cz-2 font-mono">
                    {(l.interest_rate * 100).toFixed(1)}%
                  </td>
                  <td className="py-2 text-right text-cz-2 font-mono">
                    {l.seasons_remaining}
                  </td>
                  <td className="py-2 text-right text-cz-danger font-mono">
                    {formatCZ(l.next_season_interest)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export default function SeasonFinanceReport() {
  const { seasonId, teamId } = useParams();
  const navigate = useNavigate();
  const { t } = useTranslation("finance");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      setLoading(true);
      setError(null);
      const {
        data: { session },
      } = await supabase.auth.getSession();
      if (!session) {
        if (!cancelled) {
          setError(t("report.mustLogin"));
          setLoading(false);
        }
        return;
      }
      const url = `${API}/api/teams/${teamId}/finance-report?seasonId=${seasonId}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      if (cancelled) return;
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.error || t("report.errorStatus", { status: res.status }));
        setLoading(false);
        return;
      }
      const data = await res.json();
      setReport(data);
      setLoading(false);
    }
    load();
    return () => {
      cancelled = true;
    };
  }, [seasonId, teamId, t]);

  if (loading) {
    return (
      <div className="min-h-[50vh] flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-cz-accent border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="max-w-3xl mx-auto p-6">
        <div className="bg-cz-card border border-cz-danger/30 rounded-xl p-6">
          <h2 className="text-cz-danger font-semibold mb-2">{t("report.loadError")}</h2>
          <p className="text-cz-2 text-sm">{error}</p>
          <button
            onClick={() => navigate(-1)}
            className="mt-4 text-cz-accent text-sm hover:underline"
          >
            {t("report.back")}
          </button>
        </div>
      </div>
    );
  }

  if (!report) return null;

  return (
    <div className="max-w-5xl mx-auto p-4 md:p-6 space-y-4">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div>
          <h1 className="text-cz-1 text-xl font-bold">
            {report.team.name}
          </h1>
          <p className="text-cz-3 text-xs">
            {t("report.title", { n: report.season.number })}
            {report.viewer?.is_admin && !report.viewer?.is_owner && t("report.adminView")}
          </p>
        </div>
        <button
          onClick={() => navigate(-1)}
          className="text-cz-accent text-sm hover:underline"
        >
          {t("report.back")}
        </button>
      </div>

      <HeroCard hero={report.hero} season={report.season} />

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Donut
          title={t("report.donutIncomeTitle")}
          data={report.donuts.income}
          emptyLabel={t("report.donutIncomeEmpty")}
        />
        <Donut
          title={t("report.donutExpenseTitle")}
          data={report.donuts.expense}
          emptyLabel={t("report.donutExpenseEmpty")}
        />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <TopTransactionsCard
          title={t("report.topInTitle")}
          items={report.top.top_in}
          emptyLabel={t("report.topInEmpty")}
          isPositive={true}
        />
        <TopTransactionsCard
          title={t("report.topOutTitle")}
          items={report.top.top_out}
          emptyLabel={t("report.topOutEmpty")}
          isPositive={false}
        />
      </div>

      <LoanPortfolioCard loans={report.loans} />

      {/* Sponsor-modifier-kurve: tilgængelig når board_plan_snapshots populeres
          (sæson 2 og frem). Vi viser eksplicit placeholder så vi ikke render'er
          vildledende eller tom-data widget. */}
      <div className="bg-cz-card border border-cz-border border-dashed rounded-xl p-6">
        <h3 className="text-cz-2 font-semibold mb-2">{t("report.sponsorTitle")}</h3>
        <p className="text-cz-3 text-sm">
          {t("report.sponsorBody")}
        </p>
      </div>
    </div>
  );
}
