// Typed boundary for canonical JSX primitives whose null defaults infer overly narrow props.
// Rendering remains owned by components/ui; this module adds no markup or behaviour.
import type { ReactNode, ChangeEvent } from "react";
import {
  PageHeader as Header,
  FilterBar as Filters,
  DataTable as Table,
  ErrorState as Error,
} from "../ui/index.js";
export const PageHeader = Header as unknown as (props: {
  title: ReactNode;
  subtitle?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) => ReactNode;
export interface LibrarySelectFilter {
  key: string;
  value: string;
  onChange: (event: ChangeEvent<HTMLSelectElement>) => void;
  ariaLabel: string;
  options: { value: string; label: string }[];
}
export const FilterBar = Filters as unknown as (props: {
  search?: {
    value: string;
    onChange: (event: ChangeEvent<HTMLInputElement>) => void;
    placeholder: string;
    ariaLabel: string;
  };
  filters?: LibrarySelectFilter[];
  moreLabel?: string;
  meta?: ReactNode;
  children?: ReactNode;
}) => ReactNode;
export interface LibraryColumn<T> {
  key: string;
  header: ReactNode;
  render?: (row: T, index: number) => ReactNode;
  sticky?: boolean;
  numeric?: boolean;
  subline?: (row: T) => ReactNode;
  sortKey?: string;
  mobileLabel?: string;
}
export const DataTable = Table as unknown as <T>(props: {
  columns: LibraryColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  label: string;
  dense?: boolean;
  mobileDefaults?: string[];
  empty?: ReactNode;
  toolbar?: ReactNode;
  fullTable?: boolean;
  onFullTableChange?: (value: boolean) => void;
  sort?: string;
  sortDir?: string;
  onSort?: (key: string) => void;
}) => ReactNode;
export const ErrorState = Error as unknown as (props: {
  title?: ReactNode;
  description: ReactNode;
  action: ReactNode;
}) => ReactNode;
