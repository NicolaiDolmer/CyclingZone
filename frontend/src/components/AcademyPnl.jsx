// AcademyPnl — akademi-regnskabet (#2485, addendum V3): en simpel P&L-flade
// pr. akademi. Ren visning, ingen handlinger. Viser KUN realiseret markedsværdi
// (faktiske salg) — aldrig projektion af fremtidig værdi (#2100 er ejer-udskudt).

import { useTranslation } from "react-i18next";
import { useAcademyPnl } from "../lib/useAcademyPnl.js";
import RiderLink from "./RiderLink.jsx";
import { formatNumber, formatDate } from "../lib/intl.js";

function Amount({ value }) {
  return <span className="font-mono">{formatNumber(value)} CZ$</span>;
}

export default function AcademyPnl() {
  const { t } = useTranslation("academy");
  const { data, enabled, loading } = useAcademyPnl();

  if (!enabled) return null;

  if (loading) {
    return (
      <section>
        <h2 className="font-data text-[11px] font-semibold uppercase tracking-[.1em] text-cz-3 mb-3">{t("pnl.heading")}</h2>
        <div className="bg-cz-card border border-cz-border rounded-cz px-6 py-8 text-center">
          <p className="text-cz-3 text-sm">{t("pnl.loadingNote")}</p>
        </div>
      </section>
    );
  }

  if (!data) return null;

  const { current, cumulative, sales } = data;
  const netPositive = cumulative.netCashFlow >= 0;

  return (
    <section>
      <h2 className="font-data text-[11px] font-semibold uppercase tracking-[.1em] text-cz-3 mb-1">{t("pnl.heading")}</h2>
      <p className="text-xs text-cz-3 mb-3">{t("pnl.subtitle")}</p>

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        {/* Kumulativt regnskab: ægte pengebevægelser, hele holdets historik. */}
        <div className="bg-cz-card border border-cz-border rounded-cz p-4">
          <h3 className="text-xs font-semibold text-cz-3 uppercase tracking-wide mb-3">{t("pnl.cumulativeHeading")}</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-cz-2">{t("pnl.driftPaid")}</dt>
              <dd className="text-cz-1"><Amount value={-cumulative.driftPaid} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-cz-2">{t("pnl.signingFeesPaid")}</dt>
              <dd className="text-cz-1"><Amount value={-cumulative.signingFeesPaid} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-cz-2">{t("pnl.salesProceeds")}</dt>
              <dd className="text-cz-1"><Amount value={cumulative.salesProceeds} /></dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-cz-2">{t("pnl.valueCreation")}</dt>
              <dd className="text-cz-1"><Amount value={cumulative.valueCreation} /></dd>
            </div>
            <div className="flex items-center justify-between pt-2 border-t border-cz-border">
              <dt className="text-cz-1 font-semibold">{t("pnl.netCashFlow")}</dt>
              <dd className={`font-mono font-semibold ${netPositive ? "text-cz-success" : "text-cz-danger"}`}>
                {formatNumber(cumulative.netCashFlow)} CZ$
              </dd>
            </div>
          </dl>
          <p className="text-[11px] text-cz-3 mt-3">{t("pnl.premiumCaption")}</p>
        </div>

        {/* Nuværende trup: øjebliksbillede, ikke kumulativt betalt-til-dato. */}
        <div className="bg-cz-card border border-cz-border rounded-cz p-4">
          <h3 className="text-xs font-semibold text-cz-3 uppercase tracking-wide mb-3">{t("pnl.currentHeading")}</h3>
          <dl className="space-y-2 text-sm">
            <div className="flex items-center justify-between">
              <dt className="text-cz-2">{t("pnl.slotsLabel")}</dt>
              <dd className="text-cz-1 font-mono">{current.slotsUsed} / {current.slotsMax}</dd>
            </div>
            <div className="flex items-center justify-between">
              <dt className="text-cz-2">{t("pnl.payrollLabel")}</dt>
              <dd className="text-cz-1"><Amount value={-current.payroll} /></dd>
            </div>
          </dl>
          <p className="text-[11px] text-cz-3 mt-3">{t("pnl.currentCaption")}</p>
        </div>
      </div>

      {/* Seneste salg — transparens: hvilke ryttere, hvornår, for hvor meget. */}
      <div className="mt-4 bg-cz-card border border-cz-border rounded-cz overflow-hidden">
        <h3 className="text-xs font-semibold text-cz-3 uppercase tracking-wide px-4 pt-4 pb-1">{t("pnl.salesHeading")}</h3>
        {sales.length === 0 ? (
          <div className="px-6 py-8 text-center">
            <p className="text-cz-3 text-sm">{t("pnl.emptySales")}</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table data-sort-exempt="Akademi-salgshistorik, samme begraensning som roster" className="w-full text-sm">
              <thead>
                <tr className="border-b border-cz-border">
                  <th className="px-4 py-2 text-left text-cz-3 font-medium text-xs uppercase">{t("pnl.colRider")}</th>
                  <th className="px-4 py-2 text-left text-cz-3 font-medium text-xs uppercase">{t("pnl.colDate")}</th>
                  <th className="px-4 py-2 text-right text-cz-3 font-medium text-xs uppercase">{t("pnl.colPrice")}</th>
                  <th className="px-4 py-2 text-right text-cz-3 font-medium text-xs uppercase">{t("pnl.colPremium")}</th>
                </tr>
              </thead>
              <tbody>
                {sales.map((s) => (
                  <tr key={`${s.riderId}-${s.soldAt}`} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
                    <td className="px-4 py-2">
                      {s.riderId ? (
                        <RiderLink id={s.riderId} className="text-cz-1 font-medium hover:text-cz-accent-t transition-colors">
                          {s.riderName || t("pnl.unknownRider")}
                        </RiderLink>
                      ) : (
                        <span className="text-cz-1">{s.riderName || t("pnl.unknownRider")}</span>
                      )}
                    </td>
                    <td className="px-4 py-2 text-cz-2">{s.soldAt ? formatDate(s.soldAt) : "–"}</td>
                    <td className="px-4 py-2 text-right"><Amount value={s.price} /></td>
                    <td className="px-4 py-2 text-right">
                      <span className={`font-mono ${s.premium >= 0 ? "text-cz-success" : "text-cz-danger"}`}>
                        {formatNumber(s.premium)} CZ$
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </section>
  );
}
