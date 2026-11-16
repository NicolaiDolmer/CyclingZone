// #8081 / #8060: akademi-regnskabet pr. sæson. Denne sæson øverst, tidligere
// sæsoner under, og en samlet linje nederst. Køb er delt i "hentet fra tilbud"
// og "købt på ungdomsauktion"; salget tæller de samme ryttere (academyLedger.js).
//
// mode="full": hele tabellen + salgslisten (udgave A og C).
// mode="compact": kun denne sæson, tidligere sæsoner bag en fold (udgave B's sidekolonne).
import { useState } from "react";
import type { ComponentType, ReactNode } from "react";
import { Link } from "react-router";
import RiderLink from "../RiderLink.jsx";
import Button from "../ui/Button.jsx";
import EmptyState from "../ui/EmptyState.jsx";
import ErrorStateJs from "../ui/ErrorState.jsx";
import CollapsibleSectionJs from "../ui/CollapsibleSection.jsx";

import { SkeletonLines } from "../ui/Skeleton.jsx";
import { buttonClass } from "../ui/buttonStyles.js";
import { formatCz } from "../../lib/marketValues.js";
import { formatDate } from "../../lib/intl.js";
import { useDesignCopy } from "./copy.ts";
import type { CopyFn } from "./copy.ts";
import type { LedgerRow, LedgerSale, LedgerTotals, SeasonLedger } from "./academyLedger.ts";
import type { LedgerState } from "./useAcademyLedger8081.ts";

type LineKey = "offerSignings" | "youthAuctionBuys" | "drift" | "salesProceeds";

// Kit-primitiverne er utypede .jsx; kontrakten skrives ned her (samme greb som AcademyProfileCard.tsx).
const ErrorState = ErrorStateJs as unknown as ComponentType<{ title: ReactNode; description?: ReactNode; action?: ReactNode }>;
const CollapsibleSection = CollapsibleSectionJs as unknown as ComponentType<{ title: ReactNode; meta?: ReactNode; defaultOpen?: boolean; children?: ReactNode }>;

const TH = "px-3 py-2 font-data text-2xs font-semibold uppercase tracking-wide text-cz-3";
const TDN = "px-3 py-[9px] text-right font-data tabular-nums";

function Money({ value, signed = false, strong = false }: { value: number; signed?: boolean; strong?: boolean }) {
  const tone = !signed ? "text-cz-1" : value > 0 ? "text-cz-success" : value < 0 ? "text-cz-danger" : "text-cz-2";
  return <span className={`${tone} ${strong ? "font-semibold" : ""}`}>{formatCz(value)}</span>;
}

function seasonLabel(c: CopyFn, row: LedgerRow) {
  if (row.isCurrent) return c("ledger.thisSeason");
  return row.seasonNumber != null ? c("ledger.season", { n: row.seasonNumber }) : "–";
}

function lineDefs(c: CopyFn, ledger: SeasonLedger): { key: LineKey; label: string; sign: number }[] {
  return [
    { key: "offerSignings", label: c("ledger.offerSignings"), sign: -1 },
    { key: "youthAuctionBuys", label: c("ledger.youthAuctionBuys"), sign: -1 },
    ...(ledger.showDrift ? [{ key: "drift" as const, label: c(ledger.driftIsHistoric ? "ledger.driftHistoric" : "ledger.drift"), sign: -1 }] : []),
    { key: "salesProceeds", label: c("ledger.sales"), sign: 1 },
  ];
}

/** Én sæson som definitionsliste (mobil og sidekolonnen). */
function SeasonBlock({ c, ledger, row, title }: { c: CopyFn; ledger: SeasonLedger; row: LedgerTotals & Partial<LedgerRow>; title?: string }) {
  return (
    <dl className="space-y-1.5 text-sm">
      {title && <dt className="pb-1 font-data text-2xs font-semibold uppercase tracking-wide text-cz-3">{title}</dt>}
      {lineDefs(c, ledger).map((l) => (
        <div key={l.key} className="flex items-baseline justify-between gap-3">
          <dt className="text-cz-2">
            {l.label}
            {l.key === "salesProceeds" && row.salesCount > 0 && (
              <span className="text-cz-3"> · {c("ledger.salesCount", { count: row.salesCount })}</span>
            )}
          </dt>
          <dd className="font-data tabular-nums"><Money value={l.sign * row[l.key]} /></dd>
        </div>
      ))}
      <div className="flex items-baseline justify-between gap-3 border-t border-cz-border pt-1.5">
        <dt className="font-semibold text-cz-1">{c("ledger.net")}</dt>
        <dd className="font-data tabular-nums"><Money value={row.net} signed strong /></dd>
      </div>
    </dl>
  );
}

function SeasonTable({ c, ledger }: { c: CopyFn; ledger: SeasonLedger }) {
  const lines = lineDefs(c, ledger);
  return (
    <div className="hidden overflow-hidden rounded-cz border border-cz-border bg-cz-card sm:block">
      <table data-sort-exempt="Regnskab pr. saeson, fast raekkefoelge: denne saeson oeverst" className="w-full border-collapse text-sm">
        <thead className="bg-cz-subtle">
          <tr className="border-b border-cz-border">
            <th className={`${TH} text-left`}>{c("ledger.colSeason")}</th>
            {lines.map((l) => <th key={l.key} className={`${TH} text-right`}>{l.label}</th>)}
            <th className={`${TH} text-right`}>{c("ledger.net")}</th>
          </tr>
        </thead>
        <tbody>
          {ledger.rows.map((row) => (
            <tr key={row.seasonId ?? "none"} className="border-b border-cz-border hover:bg-cz-subtle">
              <td className={`px-3 py-[9px] ${row.isCurrent ? "font-semibold text-cz-1" : "text-cz-2"}`}>{seasonLabel(c, row)}</td>
              {lines.map((l) => (
                <td key={l.key} className={TDN}>
                  <Money value={l.sign * row[l.key]} />
                  {l.key === "salesProceeds" && row.salesCount > 0 && (
                    <span className="block text-3xs text-cz-3">{c("ledger.salesCount", { count: row.salesCount })}</span>
                  )}
                </td>
              ))}
              <td className={TDN}><Money value={row.net} signed strong /></td>
            </tr>
          ))}
          <tr className="bg-cz-subtle">
            <td className="px-3 py-[9px] font-semibold text-cz-1">{c("ledger.total")}</td>
            {lines.map((l) => <td key={l.key} className={TDN}><Money value={l.sign * ledger.total[l.key]} /></td>)}
            <td className={TDN}><Money value={ledger.total.net} signed strong /></td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function SalesList({ c, sales }: { c: CopyFn; sales: LedgerSale[] }) {
  const [all, setAll] = useState(false);
  if (sales.length === 0) {
    return (
      <EmptyState
        title={c("ledger.emptySalesTitle")}
        description={c("ledger.emptySalesBody")}
        action={<Link to="/squads/u23" className={buttonClass({ variant: "secondary", size: "sm" })}>{c("ledger.emptySalesAction")}</Link>}
      />
    );
  }
  const shown = all ? sales : sales.slice(0, 8);
  return (
    <div className="overflow-hidden rounded-cz border border-cz-border bg-cz-card">
      <table data-sort-exempt="Salgshistorik, nyeste foerst" className="w-full border-collapse text-sm">
        <thead className="bg-cz-subtle">
          <tr className="border-b border-cz-border">
            <th className={`${TH} text-left`}>{c("talents.colRider")}</th>
            <th className={`${TH} text-left`}>{c("ledger.colDate")}</th>
            <th className={`${TH} hidden text-left sm:table-cell`}>{c("ledger.colVia")}</th>
            <th className={`${TH} text-right`}>{c("ledger.colPrice")}</th>
          </tr>
        </thead>
        <tbody>
          {shown.map((s) => (
            <tr key={`${s.riderId}-${s.soldAt}`} className="border-b border-cz-border last:border-0 hover:bg-cz-subtle">
              <td className="px-3 py-[9px]">
                <RiderLink id={s.riderId} className="text-[13.5px] font-medium text-cz-1 hover:text-cz-accent-t">{s.riderName ?? "–"}</RiderLink>
              </td>
              <td className="px-3 py-[9px] text-cz-2">
                <span className="font-data tabular-nums">{s.soldAt ? formatDate(s.soldAt) : "–"}</span>
                {s.seasonNumber != null && <span className="block text-3xs text-cz-3">{c("ledger.season", { n: s.seasonNumber })}</span>}
              </td>
              <td className="hidden px-3 py-[9px] text-xs text-cz-2 sm:table-cell">{c(`origin.${s.origin}`)}</td>
              <td className={TDN}><Money value={s.price} /></td>
            </tr>
          ))}
        </tbody>
      </table>
      {sales.length > 8 && !all && (
        <div className="border-t border-cz-border px-3 py-2">
          <Button size="sm" variant="ghost" onClick={() => setAll(true)}>{c("ledger.allSales", { count: sales.length })}</Button>
        </div>
      )}
    </div>
  );
}

export default function SeasonLedger8081({ state, mode = "full" }: { state: LedgerState & { reload: () => void }; mode?: "full" | "compact" }) {
  const c = useDesignCopy();
  const { loading, error, ledger, sales, reload } = state;
  if (loading && !ledger) return <SkeletonLines lines={mode === "compact" ? 5 : 6} />;
  if (error) {
    return (
      <ErrorState
        title={c("ledger.errorTitle")}
        description={c("ledger.errorBody")}
        action={<Button size="sm" variant="secondary" onClick={reload}>{c("ledger.retry")}</Button>}
      />
    );
  }
  if (!ledger) return null;

  if (mode === "compact") {
    const current = ledger.current ?? ledger.rows[0];
    const earlier = ledger.rows.filter((r) => r !== current);
    return (
      <div className="flex flex-col gap-3" data-testid="design8081-ledger-compact">
        {current && <SeasonBlock c={c} ledger={ledger} row={current} title={seasonLabel(c, current)} />}
        {earlier.length > 0 && (
          <CollapsibleSection title={c("ledger.earlier")} meta={c("ledger.total")}>
            <div className="flex flex-col gap-4 pt-2">
              {earlier.map((row) => <SeasonBlock key={row.seasonId ?? "none"} c={c} ledger={ledger} row={row} title={seasonLabel(c, row)} />)}
              <SeasonBlock c={c} ledger={ledger} row={ledger.total} title={c("ledger.total")} />
            </div>
          </CollapsibleSection>
        )}
        <p className="text-3xs text-cz-3">{c("ledger.caption")}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4" data-testid="design8081-ledger">
      <p className="text-xs text-cz-2">{c("ledger.caption")}</p>
      <SeasonTable c={c} ledger={ledger} />
      <div className="flex flex-col gap-4 sm:hidden">
        {ledger.rows.map((row) => (
          <div key={row.seasonId ?? "none"} className="rounded-cz border border-cz-border bg-cz-card p-4">
            <SeasonBlock c={c} ledger={ledger} row={row} title={seasonLabel(c, row)} />
          </div>
        ))}
        <div className="rounded-cz border border-cz-border bg-cz-subtle p-4">
          <SeasonBlock c={c} ledger={ledger} row={ledger.total} title={c("ledger.total")} />
        </div>
      </div>
      <h3 className="pt-2 text-[15px] font-semibold text-cz-1">{c("ledger.salesTitle")}</h3>
      <SalesList c={c} sales={sales} />
    </div>
  );
}
