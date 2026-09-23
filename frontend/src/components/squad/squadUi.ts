// #5519: typede indgange til de kit-primitiver trup-siderne bruger.
//
// Primitiverne i components/ui er .jsx uden egne typer (hard rule 31 gælder kun
// NYE filer). Uden typer udleder TS deres props af default-VÆRDIERNE, så helt
// lovlige kald afvises (fx `rowProps = null` gør en funktion ulovlig). Samme
// greb som GraduationDayPage.tsx: kontrakten skrives ned her, læst direkte af
// DataTable.jsx, EmptyState.jsx, ErrorState.jsx, PageHeader.jsx, Tabs.jsx og
// RiderLink.jsx, og castes ét sted.
import type { ReactNode } from "react";
import {
  DataTable as DataTableJs,
  EmptyState as EmptyStateJs,
  ErrorState as ErrorStateJs,
  PageHeader as PageHeaderJs,
  Tabs as TabsJs,
  TabList as TabListJs,
  Tab as TabJs,
} from "../ui/index.js";
import RiderLinkJs from "../RiderLink.jsx";
import { WithBestRole as WithBestRoleJs } from "../rider/BestRoleTag.jsx";

export interface DataTableColumn<Row> {
  key: string;
  header: ReactNode;
  render: (row: Row) => ReactNode;
  sortKey?: string;
  numeric?: boolean;
  compact?: boolean;
  tight?: boolean;
  sticky?: boolean;
  fold?: boolean;
  foldValue?: (row: Row) => string;
  mobileLabel?: string;
}

export interface DataTableProps<Row> {
  columns: DataTableColumn<Row>[];
  rows: Row[];
  rowKey: (row: Row) => string;
  rowProps?: (row: Row) => Record<string, unknown>;
  sort?: string | null;
  sortDir?: "asc" | "desc";
  onSort?: (key: string) => void;
  count?: ReactNode;
  label?: string;
  dense?: boolean;
  mobileDefaults?: string[];
  empty?: ReactNode;
  toolbar?: ReactNode;
}

interface EmptyStateProps { icon?: ReactNode; title: ReactNode; description?: ReactNode; action: ReactNode; className?: string }
interface ErrorStateProps { title?: ReactNode; description?: ReactNode; action?: ReactNode; className?: string }
interface PageHeaderProps { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; className?: string }
interface TabsProps { value: string; onChange: (next: string) => void; className?: string; children: ReactNode }
interface TabListProps { label: string; className?: string; children: ReactNode }
interface TabProps { value: string; className?: string; children: ReactNode }
interface RiderLinkProps { id: string; className?: string; stopPropagation?: boolean; children: ReactNode }
interface WithBestRoleProps { rider: object; children: ReactNode }

export const DataTable = DataTableJs as unknown as <Row>(props: DataTableProps<Row>) => ReactNode;
export const EmptyState = EmptyStateJs as unknown as (props: EmptyStateProps) => ReactNode;
export const ErrorState = ErrorStateJs as unknown as (props: ErrorStateProps) => ReactNode;
export const PageHeader = PageHeaderJs as unknown as (props: PageHeaderProps) => ReactNode;
export const Tabs = TabsJs as unknown as (props: TabsProps) => ReactNode;
export const TabList = TabListJs as unknown as (props: TabListProps) => ReactNode;
export const Tab = TabJs as unknown as (props: TabProps) => ReactNode;
export const RiderLink = RiderLinkJs as unknown as (props: RiderLinkProps) => ReactNode;
export const WithBestRole = WithBestRoleJs as unknown as (props: WithBestRoleProps) => ReactNode;
