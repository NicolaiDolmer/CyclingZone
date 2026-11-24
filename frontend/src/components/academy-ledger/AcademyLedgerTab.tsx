// #8060: fanen "Akademi-regnskab" til akademisiden udgave A (#8081, ejervalg 16/11).
// Regnskabet pr. sæson: denne sæson øverst, tidligere sæsoner under og en samlet
// linje nederst. Køb er delt i "hentet fra tilbud" og "købt på ungdomsauktion",
// og salget tæller de samme ryttere (reglen bor i backend/lib/academyPnl.ts).
//
// Begge tabeller bruger DataTable, inkl. kolonnevalget på mobil.
// Udgifter står med minus, så farven aldrig er eneste signal.
//
// Namespacet academyLedger lazy-loades (INLINE_EXEMPT), derfor ready-gaten.
// Fanen monteres i udgave A (academy-v2) når den er merget; uden kontakten
// academy_page_v2_8081 har svaret intet `ledger`, og fanen tegner intet.
import { useState } from "react";
import type { ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router";
import type { TFunction } from "i18next";
import { Button, SectionHeader as SectionHeaderJs, SkeletonLines } from "../ui/index.js";
import { DataTable, EmptyState, ErrorState, RiderLink, type DataTableColumn } from "../squad/squadUi.ts";
import TableTitleBar from "../ui/TableTitleBar.tsx";
import { useTableSort } from "../../lib/useTableSort.js";
import { buttonClass } from "../ui/buttonStyles.js";
import { formatCz } from "../../lib/marketValues.js";
import { formatDate } from "../../lib/intl.js";
import { useAcademyLedger } from "./useAcademyLedger.ts";

// #8060 review 4: titler fra det faelles SectionHeader (skabelonens 15px/600), ingen egne maal.
const SectionHeader = SectionHeaderJs as unknown as (props: { title: ReactNode; as?: string; className?: string }) => ReactNode;
import { SALES_PREVIEW, ledgerLines, netTone, signedAmount } from "./academyLedgerModel.ts";
import type { AcademyLedger, LedgerSale, LedgerSeasonRow, LineDef } from "./academyLedgerModel.ts";

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

type SeasonRow = LedgerSeasonRow & { isTotal?: boolean };

function SeasonTable({ t, ledger, lines }: { t: TFunction; ledger: AcademyLedger; lines: LineDef[] }) {
  const total = { ...ledger.total, seasonId: null, seasonNumber: null, isCurrent: false, isTotal: true };
  const rows: SeasonRow[] = [...ledger.seasons, total];
  const columns: DataTableColumn<SeasonRow>[] = [
    {
      key: "season",
      header: t("colSeason"),
      sticky: true,
      render: (row) => (
        <span className={row.isTotal || row.isCurrent ? "font-semibold text-cz-1" : "text-cz-2"}>
          {row.isTotal ? t("total") : seasonLabel(t, row)}
        </span>
      ),
    },
    ...lines.map((line): DataTableColumn<SeasonRow> => ({
      key: line.key,
      header: t(line.labelKey),
      numeric: true,
      render: (row) => (
        <>
          <Money value={signedAmount(row[line.key], line.sign)} />
          {line.key === "salesProceeds" && row.salesCount > 0 && (
            <span className="block text-3xs text-cz-3">{t("salesCount", { count: row.salesCount })}</span>
          )}
        </>
      ),
    })),
    { key: "net", header: t("net"), numeric: true, render: (row) => <Money value={row.net} net /> },
  ];

  return (
    <DataTable
      label={t("title")}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.isTotal ? "total" : row.seasonId ?? "none"}
      rowProps={(row) => row.isTotal ? { className: "bg-cz-subtle" } : {}}
      titleBar={(columns) => columns && <TableTitleBar page="academy-ledger-seasons" columns={columns} />}
      mobileDefaults={["offerSignings", "youthAuctionBuys", "net"]}
      data-sort-exempt="Current season first, all-seasons total last"
      dense
    />
  );
}

function SalesTable({ t, sales }: { t: TFunction; sales: LedgerSale[] }) {
  const [showAll, setShowAll] = useState(false);
  const { rows, sort, sortDir, handleSort } = useTableSort(sales, {
    rider: (sale) => sale.riderName,
    date: (sale) => sale.soldAt,
    origin: (sale) => t(`origin.${sale.origin}`),
    via: (sale) => t(`via.${sale.via}`),
    price: (sale) => sale.price,
  }, { initialSort: "date" });

  if (sales.length === 0) {
    return (
      <EmptyState
        title={t("emptySalesTitle")}
        description={t("emptySalesBody")}
        action={<Link to="/team" className={buttonClass({ variant: "secondary", size: "sm" })}>{t("emptySalesAction")}</Link>}
      />
    );
  }

  const columns: DataTableColumn<LedgerSale>[] = [
    {
      key: "rider", header: t("colRider"), sortKey: "rider", sticky: true,
      render: (sale) => (
        <RiderLink id={sale.riderId} className="text-cz-1 hover:text-cz-accent-t">
          {sale.riderName ?? t("unknownRider")}
        </RiderLink>
      ),
    },
    {
      key: "date", header: t("colDate"), sortKey: "date",
      render: (sale) => (
        <div className="font-data tabular-nums text-cz-2">
          {sale.soldAt ? formatDate(sale.soldAt) : "–"}
          {sale.seasonNumber != null && <span className="block text-3xs text-cz-3">{t("season", { n: sale.seasonNumber })}</span>}
        </div>
      ),
    },
    { key: "origin", header: t("colOrigin"), sortKey: "origin", render: (sale) => t(`origin.${sale.origin}`) },
    { key: "via", header: t("colVia"), sortKey: "via", render: (sale) => t(`via.${sale.via}`) },
    { key: "price", header: t("colPrice"), sortKey: "price", numeric: true, render: (sale) => <Money value={sale.price} /> },
  ];

  return (
    <div className="flex flex-col items-stretch gap-2">
      <DataTable
        label={t("salesTitle")}
        columns={columns}
        rows={showAll ? rows : rows.slice(0, SALES_PREVIEW)}
        rowKey={(sale, index) => `${sale.riderId}-${sale.soldAt ?? index}`}
        titleBar={(columns) => columns && <TableTitleBar page="academy-ledger-sales" columns={columns} />}
        mobileDefaults={["date", "via", "price"]}
        sort={sort}
        sortDir={sortDir}
        onSort={handleSort}
        dense
      />
      {sales.length > SALES_PREVIEW && !showAll && (
        <Button className="self-start" size="sm" variant="ghost" onClick={() => setShowAll(true)}>
          {t("allSales", { count: sales.length })}
        </Button>
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
      <SectionHeader title={t("salesTitle")} as="h3" className="!mb-0 pt-2" />
      <SalesTable t={t} sales={ledger.sales} />
    </section>
  );
}
