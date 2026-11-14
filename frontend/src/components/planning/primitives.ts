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
import { formatDate as formatDateBase } from "../../lib/intl.js";
import { useReloadBlock as useReloadBlockBase, RELOAD_BLOCK_REASONS as RELOAD_BLOCK_REASONS_BASE } from "../../lib/reloadGate.js";

type AnyComponent = (props: any) => any;

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
export const riderBestRole: (flat: Record<string, unknown>) => { rating: number | null; role: string | null } = riderBestRoleBase as any;
export const validateSelectionClient: (args: Record<string, unknown>) => string[] = validateSelectionClientBase as any;
export const isU23: (birthdate: string | null, seasonYear: number | null) => boolean = isU23Base as any;
export const injuryTimeLeft: (condition: { injured_until?: string | null; injury_race_days_left?: number | null }) => {
  count: number;
  unit: "race_day" | "calendar_day";
} = injuryTimeLeftBase as any;
export const formatDate: (value: string, style?: string) => string = formatDateBase as any;
export const useReloadBlock: (active: boolean, reason?: string) => void = useReloadBlockBase as any;
export const RELOAD_BLOCK_REASONS: { DIRTY: string } = RELOAD_BLOCK_REASONS_BASE as any;

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
