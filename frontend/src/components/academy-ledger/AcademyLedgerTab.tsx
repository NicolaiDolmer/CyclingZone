// #8060: fanen "Akademi-regnskab" til akademisiden udgave A (#8081, ejervalg 16/11).
// Regnskabet pr. sæson: denne sæson øverst, tidligere sæsoner under og en samlet
// linje nederst. Køb er delt i "hentet fra tilbud" og "købt på ungdomsauktion",
// og salget tæller de samme ryttere (reglen bor i backend/lib/academyPnl.ts).
//
// Desktop: én tabel med kolonneoverskrifter. Mobil: ét kort pr. sæson.
// Udgifter står med minus, så farven aldrig er eneste signal.
//
// Namespacet academyLedger lazy-loades (INLINE_EXEMPT), derfor ready-gaten.
// Fanen monteres i udgave A (academy-v2) når den er merget; uden kontakten
// academy_page_v2_8081 har svaret intet `ledger`, og fanen tegner intet.
import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TFunction } from "i18next";
import RiderLink from "../RiderLink.jsx";
import { Button, EmptyState, ErrorState as ErrorStateJs, SectionHeader as SectionHeaderJs, SkeletonLines } from "../ui/index.js";
import { buttonClass } from "../ui/buttonStyles.js";
import { formatCz } from "../../lib/marketValues.js";
import { formatDate } from "../../lib/intl.js";
import { useAcademyLedger } from "./useAcademyLedger.ts";

// #8060 review 4: titler fra det faelles SectionHeader (skabelonens 15px/600), ingen egne maal.
const SectionHeader = SectionHeaderJs as unknown as (props: { title: ReactNode; as?: string; className?: string }) => ReactNode;
import { SALES_PREVIEW, ledgerLines, netTone, signedAmount } from "./academyLedgerModel.ts";
import type { AcademyLedger, LedgerSale, LedgerSeasonRow, LedgerTotals, LineDef } from "./academyLedgerModel.ts";

// Kit-primitiverne er utypede .jsx; kontrakten skrives ned her (samme greb som AcademyProfileCard.tsx).
const ErrorState = ErrorStateJs as unknown as ComponentType<{ title: ReactNode; description?: ReactNode; action?: ReactNode }>;

const TH = "px-3 py-2 font-data text-2xs font-semibold uppercase tracking-wide text-cz-3";
// whitespace-nowrap: et beløb må aldrig knække over to linjer (390 px, 17/11).
const TDN = "px-3 py-[7px] text-right font-data tabular-nums whitespace-nowrap";

const TONE = { positive: "text-cz-success", negative: "text-cz-danger", neutral: "text-cz-2" } as const;

function Money({ value, net = false }: { value: number; net?: boolean }) {
  if (!net) return <span className="text-cz-1">{formatCz(value)}</span>;
  return (
    <span className={`font-semibold ${TONE[netTone(value)]}`}>
      {value > 0 ? "+" : ""}{formatCz(value)}
    </span>
  );
}

function seasonLabel(t: TFunction, row: LedgerSeasonRow): string {
  if (row.isCurrent) return t("thisSeason");
  return row.seasonNumber != null ? t("season", { n: row.seasonNumber }) : t("noSeason");
}

/** Én sæson som definitionsliste (mobil). */
function SeasonCard({ t, lines, row, title, muted = false }: {
  t: TFunction; lines: LineDef[]; row: LedgerTotals; title: string; muted?: boolean;
}) {
  return (
    <div className={`rounded-cz border border-cz-border p-4 ${muted ? "bg-cz-subtle" : "bg-cz-card"}`}>
      <dl className="space-y-1.5 text-sm">
        <dt className="pb-1 font-data text-2xs font-semibold uppercase tracking-wide text-cz-3">{title}</dt>
        {lines.map((l) => (
          <div key={l.key} className="flex items-baseline justify-between gap-3">
            <dt className="text-cz-2">
              {t(l.labelKey)}
              {l.key === "salesProceeds" && row.salesCount > 0 && (
                <span className="text-cz-3"> · {t("salesCount", { count: row.salesCount })}</span>
              )}
            </dt>
            <dd className="font-data tabular-nums"><Money value={signedAmount(row[l.key], l.sign)} /></dd>
          </div>
        ))}
        <div className="flex items-baseline justify-between gap-3 border-t border-cz-border pt-1.5">
          <dt className="font-semibold text-cz-1">{t("net")}</dt>
          <dd className="font-data tabular-nums"><Money value={row.net} net /></dd>
        </div>
      </dl>
    </div>
  );
}

function SeasonTable({ t, ledger, lines }: { t: TFunction; ledger: AcademyLedger; lines: LineDef[] }) {
  return (
    <div className="hidden overflow-x-auto rounded-cz border border-cz-border bg-cz-card sm:block">
      <table data-sort-exempt="Regnskab pr. saeson, fast raekkefoelge: denne saeson oeverst" className="w-full border-collapse text-sm">
        <thead className="bg-cz-subtle">
          <tr className="border-b border-cz-border">
            <th scope="col" className={`${TH} text-left`}>{t("colSeason")}</th>
            {lines.map((l) => <th key={l.key} scope="col" className={`${TH} text-right`}>{t(l.labelKey)}</th>)}
            <th scope="col" className={`${TH} text-right`}>{t("net")}</th>
          </tr>
        </thead>
        <tbody>
          {ledger.seasons.map((row) => (
            <tr key={row.seasonId ?? "none"} className="border-b border-cz-border hover:bg-cz-subtle">
              <th scope="row" className={`px-3 py-[7px] text-left font-normal ${row.isCurrent ? "font-semibold text-cz-1" : "text-cz-2"}`}>
                {seasonLabel(t, row)}
              </th>
              {lines.map((l) => (
                <td key={l.key} className={TDN}>
                  <Money value={signedAmount(row[l.key], l.sign)} />
                  {l.key === "salesProceeds" && row.salesCount > 0 && (
                    <span className="block text-3xs text-cz-3">{t("salesCount", { count: row.salesCount })}</span>
                  )}
                </td>
              ))}
              <td className={TDN}><Money value={row.net} net /></td>
            </tr>
          ))}
          <tr className="bg-cz-subtle">
            <th scope="row" className="px-3 py-[7px] text-left font-semibold text-cz-1">{t("total")}</th>
            {lines.map((l) => (
              <td key={l.key} className={TDN}>
                <Money value={signedAmount(ledger.total[l.key], l.sign)} />
                {l.key === "salesProceeds" && ledger.total.salesCount > 0 && (
                  <span className="block text-3xs text-cz-3">{t("salesCount", { count: ledger.total.salesCount })}</span>
                )}
              </td>
            ))}
            <td className={TDN}><Money value={ledger.total.net} net /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SalesTable({ t, sales }: { t: TFunction; sales: LedgerSale[] }) {
  const [showAll, setShowAll] = useState(false);
  if (sales.length === 0) {
    return (
      <EmptyState
        title={t("emptySalesTitle")}
        description={t("emptySalesBody")}
        action={<Link to="/team" className={buttonClass({ variant: "secondary", size: "sm" })}>{t("emptySalesAction")}</Link>}
      />
    );
  }
  const shown = showAll ? sales : sales.slice(0, SALES_PREVIEW);
  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
      <table data-sort-exempt="Salgshistorik, nyeste foerst" className="w-full border-collapse text-sm">
        <thead className="bg-cz-subtle">
          <tr className="border-b border-cz-border">
            <th scope="col" className={`${TH} text-left`}>{t("colRider")}</th>
            <th scope="col" className={`${TH} text-left`}>{t("colDate")}</th>
            <th scope="col" className={`${TH} hidden text-left sm:table-cell`}>{t("colOrigin")}</th>
            <th scope="col" className={`${TH} hidden text-left sm:table-cell`}>{t("colVia")}</th>
            <th scope="col" className={`${TH} text-right`}>{t("colPrice")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s, i) => (
            <tr key={`${s.riderId}-${s.soldAt ?? i}`} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
              <td className="px-3 py-[7px]">
                <RiderLink id={s.riderId} className="text-sm font-medium text-cz-1 hover:text-cz-accent-t">
                  {s.riderName ?? t("unknownRider")}
                </RiderLink>
              </td>
              <td className="px-3 py-[7px] text-cz-2">
                <span className="font-data tabular-nums">{s.soldAt ? formatDate(s.soldAt) : "–"}</span>
                {s.seasonNumber != null && <span className="block text-3xs text-cz-3">{t("season", { n: s.seasonNumber })}</span>}
              </td>
              <td className="hidden px-3 py-[7px] text-xs text-cz-2 sm:table-cell">{t(`origin.${s.origin}`)}</td>
              <td className="hidden px-3 py-[7px] text-xs text-cz-2 sm:table-cell">{t(`via.${s.via}`)}</td>
              <td className={TDN}><Money value={s.price} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {sales.length > SALES_PREVIEW && !showAll && (
        <div className="border-t border-cz-border px-3 py-2">
          <Button size="sm" variant="ghost" onClick={() => setShowAll(true)}>{t("allSales", { count: sales.length })}</Button>
        </div>
      )}
    </div>
  );
}

/**
 * Fanen "Akademi-regnskab". Henter selv fra GET /api/academy/pnl.
 * Montering i udgave A: `{tab === "ledger" && <AcademyLedgerTab />}`.
 */
export default function AcademyLedgerTab() {
  const { t, ready } = useTranslation("academyLedger");
  const { loading, error, ledger, reload } = useAcademyLedger();

  if (!ready || (loading && !ledger)) return <SkeletonLines lines={6} />;
  if (error) {
    return (
      <ErrorState
        title={t("errorTitle")}
        description={t("errorBody")}
        action={<Button size="sm" variant="secondary" onClick={() => { void reload(); }}>{t("retry")}</Button>}
      />
    );
  }
  // #8060 review 3: intet regnskab (akademiet er lukket for holdet) = et forklarende felt, aldrig tomt.
  if (!ledger) {
    return (
      <EmptyState
        title={t("noLedgerTitle")}
        description={t("noLedgerBody")}
        action={<Link to="/team" className={buttonClass({ variant: "secondary", size: "sm" })}>{t("noLedgerAction")}</Link>}
      />
    );
  }

  const lines = ledgerLines(ledger);
  return (
    <section className="flex flex-col gap-4" data-testid="academy-ledger-tab" aria-labelledby="academy-ledger-title">
      <div id="academy-ledger-title">
        <SectionHeader title={t("title")} className="!mb-1" />
        <p className="text-xs text-cz-2">{t("caption")}</p>
      </div>
      <SeasonTable t={t} ledger={ledger} lines={lines} />
      <div className="flex flex-col gap-3 sm:hidden">
        {ledger.seasons.map((row) => (
          <SeasonCard key={row.seasonId ?? "none"} t={t} lines={lines} row={row} title={seasonLabel(t, row)} />
        ))}
        <SeasonCard t={t} lines={lines} row={ledger.total} title={t("total")} muted />
      </div>
      <SectionHeader title={t("salesTitle")} as="h3" className="!mb-0 pt-2" />
      <SalesTable t={t} sales={ledger.sales} />
    </section>
  );
}
