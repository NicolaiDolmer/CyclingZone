// #6150: typede indgange til de kit-primitiver roadmap-fanerne bruger.
//
// Primitiverne i components/ui er .jsx uden egne typer (hard rule 31 gælder kun
// NYE filer). Samme greb som components/squad/squadUi.ts: kontrakten skrives
// ned her, læst direkte af de enkelte .jsx-filer, og castes ét sted.
import type { ReactNode } from "react";
import {
  Section as SectionJs,
  SectionHeader as SectionHeaderJs,
  SectionStack as SectionStackJs,
  StatusBadge as StatusBadgeJs,
  CategoryTag as CategoryTagJs,
  Button as ButtonJs,
  CollapsibleSection as CollapsibleSectionJs,
  EmptyState as EmptyStateJs,
  Skeleton as SkeletonJs,
  Segmented as SegmentedJs,
} from "../ui/index.js";

interface SectionProps { className?: string; children: ReactNode; "aria-busy"?: boolean }
interface SectionHeaderProps { title: ReactNode; as?: string; action?: ReactNode; meta?: ReactNode; className?: string }
interface SectionStackProps { className?: string; children: ReactNode }
// STATUS_TONE i ui/badgeStyles.js: closing = warning, won = success, info = info.
interface StatusBadgeProps { state: "closing" | "won" | "info" | "live" | "outbid"; emphasis?: boolean; className?: string; children: ReactNode }
interface CategoryTagProps { dense?: boolean; className?: string; children: ReactNode }
interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  "aria-pressed"?: boolean;
  children: ReactNode;
}
interface CollapsibleSectionProps { title: ReactNode; defaultOpen?: boolean; meta?: ReactNode; className?: string; children: ReactNode }
interface EmptyStateProps { icon?: ReactNode; title: ReactNode; description?: ReactNode; action: ReactNode; className?: string }
interface SkeletonProps { className?: string; rounded?: string }
interface SegmentedOption { value: string; label: ReactNode; title?: string; disabled?: boolean }
interface SegmentedProps { label: string; value: string; onChange: (next: string) => void; options: SegmentedOption[]; className?: string }

export const Section = SectionJs as unknown as (props: SectionProps) => ReactNode;
export const SectionHeader = SectionHeaderJs as unknown as (props: SectionHeaderProps) => ReactNode;
export const SectionStack = SectionStackJs as unknown as (props: SectionStackProps) => ReactNode;
export const StatusBadge = StatusBadgeJs as unknown as (props: StatusBadgeProps) => ReactNode;
export const CategoryTag = CategoryTagJs as unknown as (props: CategoryTagProps) => ReactNode;
export const Button = ButtonJs as unknown as (props: ButtonProps) => ReactNode;
export const CollapsibleSection = CollapsibleSectionJs as unknown as (props: CollapsibleSectionProps) => ReactNode;
export const EmptyState = EmptyStateJs as unknown as (props: EmptyStateProps) => ReactNode;
export const Skeleton = SkeletonJs as unknown as (props: SkeletonProps) => ReactNode;
export const Segmented = SegmentedJs as unknown as (props: SegmentedProps) => ReactNode;
