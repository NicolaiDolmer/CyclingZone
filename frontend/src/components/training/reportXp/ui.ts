// #7627: typed entries to the .jsx kit pieces the XP report uses. Same approach
// as components/race/stagePageV2/ui.ts: the contract is written down here and
// cast once.
import type { ComponentType } from "react";
import { Flag as FlagJs } from "../../Flag.jsx";
import { formatDate } from "../../../lib/intl.js";

export const Flag = FlagJs as unknown as ComponentType<{ code: string; className?: string; title?: string }>;

/** A date with custom Intl options only (formatDate's `null` style). */
export const formatDay = (date: string, options: Intl.DateTimeFormatOptions): string =>
  (formatDate as unknown as (d: string, style: null, o: Intl.DateTimeFormatOptions) => string)(date, null, options);
