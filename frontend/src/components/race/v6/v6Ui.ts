// #7778: typede indgange til de kit-dele v6-rammen bruger ud over stagePageV2/ui.ts.
import type { ReactNode } from "react";
import { EmptyState as EmptyStateJs, Button as ButtonJs } from "../../ui/index.js";
import {
  ChevronDownIcon as ChevronDownIconJs,
  ChevronUpIcon as ChevronUpIconJs,
  FlagIcon as FlagIconJs,
  CheckIcon as CheckIconJs,
} from "../../ui/icons/index.jsx";
import StageProfileGraphJs from "../StageProfileGraph.jsx";

interface EmptyStateProps { icon?: ReactNode; title: ReactNode; description?: ReactNode; action: ReactNode }
interface IconProps { size?: number; className?: string; "aria-hidden"?: boolean | "true" }
interface StageProfileGraphProps {
  profile: unknown; tier?: "full" | "compact" | "mini"; width?: number; height?: number;
  uid?: string; hasClassifications?: boolean; heightClass?: string;
}

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
export const StageProfileGraph = StageProfileGraphJs as unknown as (props: StageProfileGraphProps) => ReactNode;
