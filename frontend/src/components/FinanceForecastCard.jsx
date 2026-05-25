import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { formatNumber } from "../lib/intl";

const TIER_BADGE_CLASS = {
  green: "bg-cz-success-bg text-cz-success border-cz-success/30",
  yellow: "bg-cz-warning-bg text-cz-warning border-cz-warning/30",
  red: "bg-cz-danger-bg text-cz-danger border-cz-danger/30",
};

const TIER_ICON = {
  green: "🟢",
  yellow: "🟡",
  red: "🔴",
};

function getTierMeta(t, riskTier) {
  const tier = TIER_BADGE_CLASS[riskTier] ? riskTier : "yellow";
  return {
    key: tier,
    label: t(`forecast.tier.${tier}.label`),
    headline: t(`forecast.tier.${tier}.headline`),
    summary: t(`forecast.tier.${tier}.summary`),
    icon: TIER_ICON[tier],
    badge: TIER_BADGE_CLASS[tier],
  };
}

function formatSigned(value) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : value < 0 ? "−" : "";
  return `${sign}${formatNumber(Math.abs(value))} CZ$`;
}

function Row({ label, value, accent, detail }) {
  return (
    <div className="flex items-center justify-between py-1.5 border-b border-cz-border last:border-0">
      <div className="min-w-0 pr-3">
        <p className="text-cz-2 text-xs">{label}</p>
        {detail && <p className="text-cz-3 text-[11px] mt-0.5 truncate">{detail}</p>}
      </div>
      <p className={`font-mono text-sm font-bold ${accent}`}>
        {formatSigned(value)}
      </p>
    </div>
  );
}

export default function FinanceForecastCard({
  forecast,
  loading,
  seasonsAhead = 1,
  onSeasonsAheadChange,
}) {
  const { t } = useTranslation("dashboard");

  if (loading) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
          <p className="text-cz-3 text-sm">{t("forecast.loading")}</p>
        </div>
      </div>
    );
  }
  if (!forecast) return null;

  const multiSeason = Array.isArray(forecast.forecasts) && forecast.forecasts.length > 1;

  const tier = getTierMeta(t, forecast.risk_tier);
  const netAccent =
    forecast.projected_net >= 0 ? "text-cz-success" : "text-cz-danger";
  const sponsorBreakdown = forecast.inputs?.sponsor_breakdown;
  const sponsorDetail = sponsorBreakdown?.mode === "variable"
    ? t("forecast.sponsorDetail.variable", {
        base: formatNumber(sponsorBreakdown.base),
        variable: formatNumber(sponsorBreakdown.variable),
      })
    : sponsorBreakdown?.mode === "intro"
      ? t("forecast.sponsorDetail.intro")
      : t("forecast.sponsorDetail.fallback");

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-cz-1 font-semibold text-sm">{t("forecast.title")}</h2>
          <p className="text-cz-3 text-xs mt-0.5">{t("forecast.subtitle")}</p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full border text-xs font-medium flex items-center gap-1.5 ${tier.badge}`}
        >
          <span aria-hidden="true">{tier.icon}</span>
          <span>{tier.label}</span>
        </span>
      </div>

      {/* 2026-05-21: Sæsons-horisont selector (1-5) */}
      {typeof onSeasonsAheadChange === "function" && (
        <div className="flex items-center gap-2 mb-3">
          <label className="text-cz-3 text-xs">{t("forecast.horizon.label")}</label>
          <select
            value={seasonsAhead}
            onChange={(e) => onSeasonsAheadChange(Number.parseInt(e.target.value, 10))}
            className="bg-cz-subtle border border-cz-border text-cz-1 text-xs rounded-md px-2 py-1"
          >
            {[1, 2, 3, 4, 5].map((n) => (
              <option key={n} value={n}>{t("forecast.horizon.option", { count: n })}</option>
            ))}
          </select>
          {multiSeason && forecast.summary && (
            <span className="text-cz-3 text-xs">
              {t("forecast.horizon.rangeSuffix", {
                from: forecast.summary.from_season ?? "?",
                to: forecast.summary.to_season ?? "?",
              })}
            </span>
          )}
        </div>
      )}

      <div className="bg-cz-subtle border border-cz-border rounded-lg p-4 mb-4">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">
          {t("forecast.projectedLabel")}
        </p>
        <p className={`font-mono font-bold text-2xl ${netAccent}`}>
          {formatSigned(forecast.projected_net)}
        </p>
        <p className="text-cz-3 text-xs mt-1">
          {t("forecast.rangeLine", {
            low: formatSigned(forecast.confidence_low),
            high: formatSigned(forecast.confidence_high),
          })}
        </p>
        <p className="text-cz-2 text-xs mt-2 leading-snug">
          <strong>{tier.headline}.</strong> {tier.summary}
        </p>
      </div>

      <div className="mb-3">
        <Row
          label={t("forecast.row.sponsor")}
          value={forecast.projected_sponsor}
          accent="text-cz-success"
          detail={sponsorDetail}
        />
        <Row
          label={t("forecast.row.prize")}
          value={forecast.projected_prize}
          accent="text-cz-success"
        />
        <Row
          label={t("forecast.row.salary")}
          value={forecast.projected_salary}
          accent="text-cz-danger"
        />
        {forecast.projected_loan_interest !== 0 && (
          <Row
            label={t("forecast.row.loanInterest")}
            value={forecast.projected_loan_interest}
            accent="text-cz-danger"
          />
        )}
        {forecast.projected_loan_fees !== 0 && (
          <Row
            label={t("forecast.row.loanFees")}
            value={forecast.projected_loan_fees}
            accent="text-cz-danger"
          />
        )}
        {forecast.projected_loan_fees_received !== 0 && (
          <Row
            label={t("forecast.row.loanFeesReceived")}
            value={forecast.projected_loan_fees_received}
            accent="text-cz-success"
          />
        )}
      </div>

      {multiSeason && (
        <div className="bg-cz-subtle border border-cz-border rounded-lg p-3 mb-3">
          <p className="text-cz-2 font-medium text-xs mb-2">
            {t("forecast.multiSeason.title", { from: forecast.forecasts[1]?.season_number ?? "?" })}
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-cz-3 text-start">
                  <th className="py-1 pe-2">{t("forecast.multiSeason.headers.season")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.sponsor")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.prize")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.salary")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.interest")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.net")}</th>
                  <th className="py-1 px-2 text-end">{t("forecast.multiSeason.headers.endBalance")}</th>
                  <th className="py-1 ps-2 text-end">{t("forecast.multiSeason.headers.risk")}</th>
                </tr>
              </thead>
              <tbody>
                {forecast.forecasts.map((row) => {
                  const rowTier = getTierMeta(t, row.risk_tier);
                  return (
                    <tr key={row.season_number} className="border-t border-cz-border">
                      <td className="py-1 pe-2 text-cz-1 font-medium">
                        S{row.season_number}
                        {row.is_estimate && (
                          <span className="text-cz-3 text-[10px] ms-1" title={t("forecast.multiSeason.estimateTooltip")}>{t("forecast.multiSeason.estimateMark")}</span>
                        )}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-success">
                        {formatSigned(row.projected_sponsor)}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-success">
                        {formatSigned(row.projected_prize)}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-danger">
                        {formatSigned(row.projected_salary)}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-danger">
                        {formatSigned(row.projected_loan_interest)}
                      </td>
                      <td className={`py-1 px-2 text-end font-mono font-bold ${row.projected_net >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
                        {formatSigned(row.projected_net)}
                      </td>
                      <td className="py-1 px-2 text-end font-mono text-cz-1">
                        {formatNumber(row.ending_balance)} CZ$
                      </td>
                      <td className="py-1 ps-2 text-end" title={rowTier.summary}>
                        {rowTier.icon}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-cz-border font-semibold">
                  <td className="py-1 pe-2 text-cz-1">{t("forecast.multiSeason.total")}</td>
                  <td colSpan={4}></td>
                  <td className={`py-1 px-2 text-end font-mono ${forecast.summary?.total_net >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
                    {formatSigned(forecast.summary?.total_net ?? 0)}
                  </td>
                  <td className="py-1 px-2 text-end font-mono text-cz-1">
                    {formatNumber(forecast.summary?.ending_balance ?? 0)} CZ$
                  </td>
                  <td className="py-1 ps-2 text-end">
                    {getTierMeta(t, forecast.summary?.worst_risk_tier).icon}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
          <p className="text-cz-3 text-[11px] mt-2">
            {t("forecast.multiSeason.estimateNote")}
          </p>
        </div>
      )}

      {(forecast.warnings || []).length > 0 && (
        <div className="flex flex-col gap-2">
          {forecast.warnings.map((warn) => (
            <div
              key={warn.code}
              className={`px-3 py-2 rounded-lg text-xs leading-snug border
                ${warn.severity === "high"
                  ? "bg-cz-danger-bg text-cz-danger border-cz-danger/30"
                  : "bg-cz-warning-bg text-cz-warning border-cz-warning/30"}`}
            >
              <span className="font-medium">⚠️ </span>
              {warn.message}
            </div>
          ))}
        </div>
      )}

      <p className="text-cz-3 text-xs mt-4 leading-snug">
        {t("forecast.footnote")}{" "}
        <Link to="/help?section=finance" className="underline hover:text-cz-1">
          {t("forecast.footnoteLink")}
        </Link>
      </p>
    </div>
  );
}

export function FinanceForecastBadge({ forecast, compact = false }) {
  const { t } = useTranslation("dashboard");
  if (!forecast) return null;
  const tier = getTierMeta(t, forecast.risk_tier);
  const netAccent =
    forecast.projected_net >= 0 ? "text-cz-success" : "text-cz-danger";

  if (compact) {
    return (
      <span
        className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border text-[10px] font-medium ${tier.badge}`}
        title={tier.summary}
      >
        <span aria-hidden="true">{tier.icon}</span>
        <span className="font-mono">{formatSigned(forecast.projected_net)}</span>
      </span>
    );
  }

  return (
    <Link
      to="/finance"
      className="block bg-cz-card border border-cz-border rounded-xl px-4 py-3 hover:bg-cz-subtle transition-all"
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-cz-3 text-xs uppercase tracking-wider mb-0.5">
            {t("forecast.badge.label")}
          </p>
          <p className={`font-mono font-bold text-base truncate ${netAccent}`}>
            {formatSigned(forecast.projected_net)}
          </p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full border text-xs font-medium flex items-center gap-1.5 flex-shrink-0 ${tier.badge}`}
        >
          <span aria-hidden="true">{tier.icon}</span>
          <span>{tier.label}</span>
        </span>
      </div>
      {forecast.warnings?.length > 0 && (
        <p className="text-cz-3 text-xs mt-1.5 truncate">
          {forecast.warnings[0].message}
        </p>
      )}
    </Link>
  );
}
