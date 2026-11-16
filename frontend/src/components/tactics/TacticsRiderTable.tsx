// #8297 · Rytternes tabel i det fælles taktikpanel (wireframe v6c), når etapen ikke har
// en etapeplan langs ruten (dér tegner StagePlanBoard rækkerne, uændret).
//
// Computer: Rytter · Rolle · Rute-match · I dag · Indsats · Ordrer. Indsatsen er ÉN
// linje (ejer 16/11, #7535), så rækken er ca. 44 px. Rollens vælger folder ud under
// rækken som før. Kun rute-match kan sorteres (samme regel som før, #4992).
// Telefon (under sm): ét kort pr. rytter med samme indhold under hinanden; ingen
// vandret scroll (#1834), indsatsen fylder kortets bredde.
//
// Tabellen ejer intet: cellerne kommer færdige fra værten, så reglerne (hvem må hvad,
// låst etape, udgået rytter) bor ét sted.
import type { ReactNode } from "react";
import SortableThJs from "../ui/SortableTh.jsx";
import { RiderLink } from "../race/stagePageV2/ui.ts";

type SortDir = "asc" | "desc";
const SortableTh = SortableThJs as unknown as (props: {
  children: ReactNode; sortKey: string; sort: string | null | undefined; sortDir: string;
  onSort: (key: string) => void; className?: string; title?: string;
}) => ReactNode;

export interface TacticsRiderRow {
  id: string;
  name: string | null;
  role: ReactNode;
  roleMobile: ReactNode;
  routeMatch: ReactNode;
  routeMatchNumber: ReactNode;
  timeLimitMark: ReactNode | null;
  today: ReactNode;
  effort: ReactNode;
  effortMobile: ReactNode;
  orders: ReactNode | null;
  /** Rollens vælger (folder ud under rækken), eller null. */
  expanded: ReactNode | null;
}

export interface TacticsRiderTableProps {
  rows: TacticsRiderRow[];
  showOrders: boolean;
  columns: { rider: string; role: string; routeMatch: string; today: string; effort: string; orders: string };
  routeMatchTitle: string;
  mobileRouteMatchLabel: string;
  sortDir: SortDir | null;
  onSort: () => void;
}

const TH = "px-2 py-1.5 text-left text-2xs font-medium uppercase tracking-wider text-cz-3 whitespace-nowrap";
const TD = "px-2 py-2 align-top";

export default function TacticsRiderTable({ rows, showOrders, columns, routeMatchTitle, mobileRouteMatchLabel, sortDir, onSort }: TacticsRiderTableProps) {
  const span = showOrders ? 6 : 5;
  return (
    <>
      <div className="hidden overflow-x-auto sm:block">
        <table data-sortable className="w-full border-collapse text-sm">
          <thead>
            <tr className="border-b border-cz-border">
              <th className={TH}>{columns.rider}</th>
              <th className={TH}>{columns.role}</th>
              <SortableTh sortKey="routeMatch" sort={sortDir ? "routeMatch" : null} sortDir={sortDir ?? "desc"} onSort={onSort} title={routeMatchTitle} className={TH}>
                {columns.routeMatch}
              </SortableTh>
              <th className={TH}>{columns.today}</th>
              <th className={TH}>{columns.effort}</th>
              {showOrders && <th className={TH}>{columns.orders}</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => [
              <tr key={row.id} data-tactics-rider={row.id} className="border-b border-cz-border">
                <td className={`${TD} font-medium text-cz-1`}>
                  <RiderLink id={row.id} className="text-cz-1 hover:text-cz-accent-t">{row.name || "—"}</RiderLink>
                </td>
                <td className={TD}>{row.role}</td>
                <td className={TD}>{row.routeMatch}</td>
                <td className={`${TD} text-xs text-cz-2`}>{row.today}</td>
                <td className={TD}>{row.effort}</td>
                {showOrders && <td className={TD}>{row.orders}</td>}
              </tr>,
              row.expanded ? (
                <tr key={`${row.id}-picker`} className="border-b border-cz-border bg-cz-subtle">
                  <td colSpan={span} className="px-2 pb-3 pt-0">{row.expanded}</td>
                </tr>
              ) : null,
            ])}
          </tbody>
        </table>
      </div>

      <ul className="m-0 -mx-4 list-none divide-y divide-cz-border border-y border-cz-border p-0 sm:hidden">
        {rows.map((row) => (
          <li key={row.id} data-tactics-rider={row.id} className="flex flex-col gap-2 px-4 py-3">
            <div className="flex items-baseline justify-between gap-3">
              <RiderLink id={row.id} className="min-w-0 truncate text-sm font-medium text-cz-1">{row.name || "—"}</RiderLink>
              <span className="flex shrink-0 items-baseline gap-1.5 whitespace-nowrap">
                <span className="text-3xs uppercase tracking-wider text-cz-3">{mobileRouteMatchLabel}</span>
                {row.routeMatchNumber}
              </span>
            </div>
            <div>{row.roleMobile}</div>
            {row.timeLimitMark && <div>{row.timeLimitMark}</div>}
            <div>{row.effortMobile}</div>
            <div className="text-xs text-cz-2">{row.today}</div>
            {showOrders && row.orders && <div>{row.orders}</div>}
            {row.expanded && <div>{row.expanded}</div>}
          </li>
        ))}
      </ul>
    </>
  );
}
