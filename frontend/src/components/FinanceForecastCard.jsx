import { Link } from "react-router-dom";

const TIER_META = {
  green: {
    label: "Grøn",
    icon: "🟢",
    badge: "bg-cz-success-bg text-cz-success border-cz-success/30",
    headline: "Sund økonomi",
    summary: "Forventet overskud og gæld under kontrol — du kan satse offensivt.",
  },
  yellow: {
    label: "Gul",
    icon: "🟡",
    badge: "bg-cz-warning-bg text-cz-warning border-cz-warning/30",
    headline: "Pres på",
    summary: "Underskud eller stigende gæld — overvej salg eller lavere løn.",
  },
  red: {
    label: "Rød",
    icon: "🔴",
    badge: "bg-cz-danger-bg text-cz-danger border-cz-danger/30",
    headline: "Konkurs-risiko",
    summary: "Kraftigt underskud eller gæld nær loftet — handl nu.",
  },
};

function formatSigned(value) {
  if (value == null) return "—";
  const sign = value > 0 ? "+" : "";
  return `${sign}${value.toLocaleString("da-DK")} CZ$`;
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

export default function FinanceForecastCard({ forecast, loading }) {
  if (loading) {
    return (
      <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
        <div className="flex items-center gap-2">
          <div className="w-4 h-4 border-2 border-cz-border border-t-cz-accent rounded-full animate-spin" />
          <p className="text-cz-3 text-sm">Beregner forecast…</p>
        </div>
      </div>
    );
  }
  if (!forecast) return null;

  const tier = TIER_META[forecast.risk_tier] || TIER_META.yellow;
  const netAccent =
    forecast.projected_net >= 0 ? "text-cz-success" : "text-cz-danger";
  const sponsorBreakdown = forecast.inputs?.sponsor_breakdown;
  const sponsorDetail = sponsorBreakdown?.mode === "variable"
    ? `Base ${sponsorBreakdown.base.toLocaleString("da-DK")} + variabel ${sponsorBreakdown.variable.toLocaleString("da-DK")} fra sidste sæsons rang/point`
    : sponsorBreakdown?.mode === "intro"
      ? "Introsæson: variabel sponsor starter fra sæson 2"
      : "Fallback: mangler standings for forrige sæson";

  return (
    <div className="bg-cz-card border border-cz-border rounded-xl p-5 mb-4">
      <div className="flex items-start justify-between mb-4 gap-3">
        <div>
          <h2 className="text-cz-1 font-semibold text-sm">Næste sæson — prognose</h2>
          <p className="text-cz-3 text-xs mt-0.5">
            Forventet cashflow baseret på roster + lån + sponsor
          </p>
        </div>
        <span
          className={`px-2.5 py-1 rounded-full border text-xs font-medium flex items-center gap-1.5 ${tier.badge}`}
        >
          <span aria-hidden="true">{tier.icon}</span>
          <span>{tier.label}</span>
        </span>
      </div>

      <div className="bg-cz-subtle border border-cz-border rounded-lg p-4 mb-4">
        <p className="text-cz-3 text-xs uppercase tracking-wider mb-1">
          Forventet net næste sæson
        </p>
        <p className={`font-mono font-bold text-2xl ${netAccent}`}>
          {formatSigned(forecast.projected_net)}
        </p>
        <p className="text-cz-3 text-xs mt-1">
          Spænd: {formatSigned(forecast.confidence_low)} til{" "}
          {formatSigned(forecast.confidence_high)} (±20% på præmie-estimat)
        </p>
        <p className="text-cz-2 text-xs mt-2 leading-snug">
          <strong>{tier.headline}.</strong> {tier.summary}
        </p>
      </div>

      <div className="mb-3">
        <Row
          label="Sponsor"
          value={forecast.projected_sponsor}
          accent="text-cz-success"
          detail={sponsorDetail}
        />
        <Row
          label="Præmiepenge (estimat)"
          value={forecast.projected_prize}
          accent="text-cz-success"
        />
        <Row
          label="Løn"
          value={forecast.projected_salary}
          accent="text-cz-danger"
        />
        {forecast.projected_loan_interest !== 0 && (
          <Row
            label="Lånerenter"
            value={forecast.projected_loan_interest}
            accent="text-cz-danger"
          />
        )}
        {forecast.projected_loan_fees !== 0 && (
          <Row
            label="Lejegebyr (lejer)"
            value={forecast.projected_loan_fees}
            accent="text-cz-danger"
          />
        )}
        {forecast.projected_loan_fees_received !== 0 && (
          <Row
            label="Lejegebyr modtaget"
            value={forecast.projected_loan_fees_received}
            accent="text-cz-success"
          />
        )}
      </div>

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
        Prognose, ikke kontrakt. Tal kan ændre sig pga. salg, lån eller
        bestyrelsens nye plan.{" "}
        <Link to="/help?section=finance" className="underline hover:text-cz-1">
          Hvordan beregnes prognosen?
        </Link>
      </p>
    </div>
  );
}

export function FinanceForecastBadge({ forecast, compact = false }) {
  if (!forecast) return null;
  const tier = TIER_META[forecast.risk_tier] || TIER_META.yellow;
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
            Forecast næste sæson
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
