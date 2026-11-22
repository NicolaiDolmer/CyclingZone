// #7627: typed entries to the .jsx kit pieces the XP report uses. Same approach
// as components/race/stagePageV2/ui.ts: the contract is written down here and
// cast once.
import type { ComponentType, CSSProperties, ReactNode } from "react";
import { Flag as FlagJs } from "../../Flag.jsx";
import EmptyStateJs from "../../ui/EmptyState.jsx";
import ErrorStateJs from "../../ui/ErrorState.jsx";
import ButtonJs from "../../ui/Button.jsx";
import { formatDate } from "../../../lib/intl.js";
import RiderNameCellJs from "../../rider/RiderNameCell.jsx";
import { statPlateStyle as statPlateStyleJs } from "../../../lib/statColor.js";

export const Flag = FlagJs as unknown as ComponentType<{ code: string; className?: string; title?: string }>;

/** #8562: the kit's canonical empty and error states (docs/design/PAGE_TEMPLATES.md), typed once. */
export const EmptyState = EmptyStateJs as unknown as ComponentType<{ icon?: ReactNode; title: string; description?: string | null; action?: ReactNode; className?: string }>;
export const ErrorState = ErrorStateJs as unknown as ComponentType<{ title?: string; description?: string; action?: ReactNode; className?: string }>;
export const SecondaryButton = ButtonJs as unknown as ComponentType<{ variant?: "primary" | "secondary" | "ghost"; size?: "sm" | "md"; onClick?: () => void; children?: ReactNode; "data-testid"?: string; "aria-expanded"?: boolean }>;

/** A date with custom Intl options only (formatDate's `null` style). */
export const formatDay = (date: string, options: Intl.DateTimeFormatOptions): string =>
  (formatDate as unknown as (d: string, style: null, o: Intl.DateTimeFormatOptions) => string)(date, null, options);

/** The game's canonical name cell: hover icon, name, jersey and talent marks (TASTE P12). */
export const RiderNameCell = RiderNameCellJs as unknown as ComponentType<{ id: string; name?: string; firstname?: string; lastname?: string; className?: string; stopPropagation?: boolean; wrap?: boolean; children?: ReactNode }>;

/** Rating-plate style (#3666), used for form per #8364. */
export const statPlateStyle = statPlateStyleJs as unknown as (value: number, options?: { scale?: string }) => CSSProperties;
