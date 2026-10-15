// #6570: typede indgange til de kit-primitiver etapeside 2.0 bruger. Samme
// greb som components/roadmap/roadmapUi.ts: primitiverne er .jsx uden egne
// typer, kontrakten skrives ned her og castes et sted.
import type { ReactNode } from "react";
import {
  Section as SectionJs,
  SectionHeader as SectionHeaderJs,
  SectionStack as SectionStackJs,
  Button as ButtonJs,
  Segmented as SegmentedJs,
  SkeletonLines as SkeletonLinesJs,
  Tabs as TabsJs,
  TabList as TabListJs,
  Tab as TabJs,
} from "../../ui/index.js";
import { Flag as FlagJs } from "../../Flag.jsx";
import RiderLinkJs from "../../RiderLink.jsx";

interface SectionProps { className?: string; children: ReactNode; "aria-label"?: string }
interface SectionHeaderProps { title: ReactNode; action?: ReactNode; meta?: ReactNode; className?: string }
interface SectionStackProps { className?: string; children: ReactNode }
interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  type?: "button" | "submit";
  disabled?: boolean;
  onClick?: () => void;
  className?: string;
  children: ReactNode;
}
interface SegmentedOption { value: string; label: ReactNode; title?: string; disabled?: boolean }
interface SegmentedProps { label: string; value: string; onChange: (next: string) => void; options: SegmentedOption[]; className?: string }
interface SkeletonLinesProps { lines?: number }
interface TabsProps { value: string; onChange: (next: string) => void; className?: string; children: ReactNode }
interface TabListProps { label: string; className?: string; fit?: boolean; children: ReactNode }
interface TabProps { value: string; className?: string; children: ReactNode }
interface FlagProps { code?: string | null; className?: string; squared?: boolean; title?: string }
interface RiderLinkProps { id?: string | null; className?: string; children: ReactNode }

export const Section = SectionJs as unknown as (props: SectionProps) => ReactNode;
export const SectionHeader = SectionHeaderJs as unknown as (props: SectionHeaderProps) => ReactNode;
export const SectionStack = SectionStackJs as unknown as (props: SectionStackProps) => ReactNode;
export const Button = ButtonJs as unknown as (props: ButtonProps) => ReactNode;
export const Segmented = SegmentedJs as unknown as (props: SegmentedProps) => ReactNode;
export const SkeletonLines = SkeletonLinesJs as unknown as (props: SkeletonLinesProps) => ReactNode;
export const Tabs = TabsJs as unknown as (props: TabsProps) => ReactNode;
export const TabList = TabListJs as unknown as (props: TabListProps) => ReactNode;
export const Tab = TabJs as unknown as (props: TabProps) => ReactNode;
export const Flag = FlagJs as unknown as (props: FlagProps) => ReactNode;
export const RiderLink = RiderLinkJs as unknown as (props: RiderLinkProps) => ReactNode;
