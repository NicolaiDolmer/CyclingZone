// #7535 · Planlaegningssidens indgang til spillets eksisterende JS-komponenter og -hjaelpere.
//
// De delte primitiver er .jsx/.js og faar deres prop-typer udledt af default-vaerdier (fx
// `iconLeft = null` bliver til typen null). Det goer en strikt .tsx-fil umulig at bruge dem paa
// uden at omskrive primitiverne, som andre sider hviler paa. Her loeses typerne op ét sted, saa
// planlaegningssidens egne filer er strikt typede, og logikken ligger i planningWorkbench.ts.
import * as ui from "../ui/index.js";
import SortableThBase from "../ui/SortableTh.jsx";
import RiderNameCellBase from "../rider/RiderNameCell.jsx";
import RiderBadgesBase from "../rider/RiderBadges.jsx";
import BestRoleTagBase from "../rider/BestRoleTag.jsx";
import TerrainTypeGlyphBase from "../race/TerrainTypeGlyph.jsx";
import StageProfileCardBase from "../race/StageProfileCard.jsx";
import LegacyStageProfileCardBase from "../race/LegacyStageProfileCard.jsx";
import { buttonClass as buttonClassBase } from "../ui/buttonStyles.js";
import { statusBadgeClass as statusBadgeClassBase } from "../ui/badgeStyles.js";
import { hasRouteData as hasRouteDataBase } from "../../lib/stageRouteProfile.js";
import { statPlateStyle as statPlateStyleBase } from "../../lib/statColor.js";
import { RIDER_TYPE_KEYS as RIDER_TYPE_KEYS_BASE } from "../../lib/riderTypeKeys.js";
import { riderBestRole as riderBestRoleBase } from "../../lib/riderRating.js";
import { validateSelectionClient as validateSelectionClientBase, partialSquadOutlook as partialSquadOutlookBase } from "../../lib/raceSelectionLogic.js";
import {
  rememberSelectionDraft as rememberSelectionDraftBase,
  readSelectionDraft as readSelectionDraftBase,
  forgetSelectionDraft as forgetSelectionDraftBase,
  reconcileSelectionDraft as reconcileSelectionDraftBase,
} from "../../lib/raceSelectionDraft.js";
import { Flag as FlagBase } from "../Flag.jsx";
import { isU23 as isU23Base } from "../../lib/riderAge.js";
import { injuryTimeLeft as injuryTimeLeftBase } from "../../lib/training.js";
import { useReloadBlock as useReloadBlockBase, RELOAD_BLOCK_REASONS as RELOAD_BLOCK_REASONS_BASE, isReloadAllowed as isReloadAllowedBase } from "../../lib/reloadGate.js";
import { useDismiss as useDismissBase } from "../ui/useDismiss.js";
import { useModalA11y as useModalA11yBase } from "../../hooks/useModalA11y.js";

// Runde 3: Taktik er loebssidens egen taktik-fane (samme etapeplan, samme gem, samme validering), og
// Formtop-maalets vaerdi og payback er Form-fanens egen linje. Ingen kopi af nogen af dem.
import RaceTacticsTabBase from "../race/RaceTacticsTab.jsx";
import { PeakValue as PeakValueBase } from "../planner/PlannerSquad.jsx";

type AnyComponent = (props: any) => any;

export const Segmented: AnyComponent = ui.Segmented as any;
export const RaceTacticsTab: AnyComponent = RaceTacticsTabBase as any;
export const PeakValue: AnyComponent = PeakValueBase as any;

export const Button: AnyComponent = ui.Button as any;
export const EmptyState: AnyComponent = ui.EmptyState as any;
export const ErrorState: AnyComponent = ui.ErrorState as any;
export const PageHeader: AnyComponent = ui.PageHeader as any;
export const PageLoader: AnyComponent = ui.PageLoader as any;
export const SkeletonLines: AnyComponent = ui.SkeletonLines as any;
export const Select: AnyComponent = ui.Select as any;
export const ChevronLeftIcon: AnyComponent = ui.ChevronLeftIcon as any;
export const ChevronRightIcon: AnyComponent = ui.ChevronRightIcon as any;
export const ChevronUpIcon: AnyComponent = ui.ChevronUpIcon as any;
export const ChevronDownIcon: AnyComponent = ui.ChevronDownIcon as any;
export const CalendarIcon: AnyComponent = ui.CalendarIcon as any;
export const FlagIcon: AnyComponent = ui.FlagIcon as any;
// Handlinger-menuen (#7535 variant B): spillets egen menu, portal og stroke-ikoner.
export const TeamIcon: AnyComponent = ui.TeamIcon as any;
export const XIcon: AnyComponent = ui.XIcon as any;
export const AlertTriangleIcon: AnyComponent = ui.AlertTriangleIcon as any;
export const Menu: AnyComponent = ui.Menu as any;
export const MenuItem: AnyComponent = ui.MenuItem as any;
export const Portal: AnyComponent = ui.Portal as any;
export const SortableTh: AnyComponent = SortableThBase as any;
export const RiderNameCell: AnyComponent = RiderNameCellBase as any;
export const RiderBadges: AnyComponent = RiderBadgesBase as any;
export const BestRoleTag: AnyComponent = BestRoleTagBase as any;
export const TerrainTypeGlyph: AnyComponent = TerrainTypeGlyphBase as any;
export const Flag: AnyComponent = FlagBase as any;
export const StageProfileCard: AnyComponent = StageProfileCardBase as any;
export const LegacyStageProfileCard: AnyComponent = LegacyStageProfileCardBase as any;

export const buttonClass: (opts?: { variant?: string; size?: string; fullWidth?: boolean }) => string = buttonClassBase as any;
export const statusBadgeClass: (state: string, opts?: { emphasis?: boolean }) => string = statusBadgeClassBase as any;
export const hasRouteData: (profile: unknown) => boolean = hasRouteDataBase as any;
/** Ratingens gradient-plade (statColor, samme farver som ratings i hele spillet). */
export const statPlateStyle: (value: number, opts?: { scale?: string }) => Record<string, string> = statPlateStyleBase as any;
export const RIDER_TYPE_KEYS: readonly string[] = RIDER_TYPE_KEYS_BASE as any;
export const riderBestRole: (flat: Record<string, unknown>) => { rating: number | null; role: string | null } = riderBestRoleBase as any;
export const validateSelectionClient: (args: Record<string, unknown>) => string[] = validateSelectionClientBase as any;
export const isU23: (birthdate: string | null, seasonYear: number | null) => boolean = isU23Base as any;
export const injuryTimeLeft: (condition: { injured_until?: string | null; injury_race_days_left?: number | null }) => {
  count: number;
  unit: "race_day" | "calendar_day";
} = injuryTimeLeftBase as any;
export const useReloadBlock: (active: boolean, reason?: string) => void = useReloadBlockBase as any;
export const RELOAD_BLOCK_REASONS: { DIRTY: string } = RELOAD_BLOCK_REASONS_BASE as any;
/** Holder en flade paa siden en ugemt kladde (fx taktik-fanen)? Samme laas som genindlaesnings-vagten. */
export const isReloadAllowed: () => boolean = isReloadAllowedBase as any;
export const useDismiss: (ref: { current: HTMLElement | null }, onDismiss: () => void, active?: boolean) => void = useDismissBase as any;
export const useModalA11y: (onClose: (() => void) | null, active?: boolean) => { current: HTMLDivElement | null } = useModalA11yBase as any;

export const partialSquadOutlook: (args: Record<string, unknown>) => {
  kind: string;
  open: number;
  free: number;
  min: number;
  injured?: number;
  starters?: number;
  emptySelection?: boolean;
} | null = partialSquadOutlookBase as any;
export const rememberSelectionDraft: (raceId: string, sel: unknown) => void = rememberSelectionDraftBase as any;
export const readSelectionDraft: (raceId: string) => unknown = readSelectionDraftBase as any;
export const forgetSelectionDraft: (raceId: string) => void = forgetSelectionDraftBase as any;
export const reconcileSelectionDraft: (draft: unknown, riders: unknown) => any = reconcileSelectionDraftBase as any;
