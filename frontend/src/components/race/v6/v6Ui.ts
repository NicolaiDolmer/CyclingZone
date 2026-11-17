// #7778: typede indgange til de kit-dele v6-rammen bruger ud over stagePageV2/ui.ts.
import type { ReactNode } from "react";
import { EmptyState as EmptyStateJs, Button as ButtonJs } from "../../ui/index.js";
import {
  ChevronDownIcon as ChevronDownIconJs,
  ChevronUpIcon as ChevronUpIconJs,
  FlagIcon as FlagIconJs,
  CheckIcon as CheckIconJs,
  ChevronLeftIcon as ChevronLeftIconJs,
  ChevronRightIcon as ChevronRightIconJs,
} from "../../ui/icons/index.jsx";
import HeroStatsJs from "../../ui/HeroStats.jsx";

interface EmptyStateProps { icon?: ReactNode; title: ReactNode; description?: ReactNode; action: ReactNode }
interface IconProps { size?: number; className?: string; "aria-hidden"?: boolean | "true" }

interface ButtonProps {
  variant?: "primary" | "secondary" | "ghost";
  size?: "sm" | "md";
  fullWidth?: boolean;
  onClick?: () => void;
  className?: string;
  "aria-expanded"?: boolean;
  "aria-controls"?: string;
  children: ReactNode;
}

/** Kit-knappen (44 px trykflade på touch, P16) med aria-attributterne v6 bruger. */
export const Button = ButtonJs as unknown as (props: ButtonProps) => ReactNode;
export const EmptyState =EmptyStateJs as unknown as (props: EmptyStateProps) => ReactNode;
export const ChevronDownIcon = ChevronDownIconJs as unknown as (props: IconProps) => ReactNode;
export const ChevronUpIcon = ChevronUpIconJs as unknown as (props: IconProps) => ReactNode;
export const FlagIcon = FlagIconJs as unknown as (props: IconProps) => ReactNode;
export const CheckIcon = CheckIconJs as unknown as (props: IconProps) => ReactNode;
export const ChevronLeftIcon = ChevronLeftIconJs as unknown as (props: IconProps) => ReactNode;
export const ChevronRightIcon = ChevronRightIconJs as unknown as (props: IconProps) => ReactNode;
/** T3-heroens talrække (#4628). `flush` = uden egen top-streg og luft (udgave E: rækken står mellem hovedkortets hairlines). */
/** `spoiler` (#7859): tallet afslører et resultat og står ikke, mens spoiler-skjoldet skjuler en kørt etape. */
export interface HeroStatItem { label: string; value: ReactNode; sub?: ReactNode | null; spoiler?: boolean }
export const HeroStats = HeroStatsJs as unknown as (props: { items: HeroStatItem[]; className?: string; flush?: boolean }) => ReactNode;
