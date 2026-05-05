export {
  BOARD_IDENTITY_RIDER_SELECT,
  BOARD_NEGOTIATION_STATES,
  ONBOARDING_PLAN_SEQUENCE,
  VALID_BOARD_FOCUSES,
  VALID_BOARD_NEGOTIATION_STATES,
  VALID_BOARD_PLAN_TYPES,
  VALID_BOARD_REQUEST_TYPES,
} from "./boardConstants.js";

export {
  startSequentialNegotiation,
} from "./boardSequentialNegotiation.js";

export {
  deriveBoardPersonality,
  deriveTeamIdentityProfile,
  computeSeasonOneIdentity,
  deriveDefaultFocusFromIdentity,
} from "./boardIdentity.js";

export {
  getPlanDuration,
  parseBoardGoals,
  generateBoardGoals,
  buildNegotiatedGoal,
  buildBoardProposal,
  annotateGoalWithIdentityBasis,
  generate1YrFromLongerPlans,
  createBaselineProfile,
  createInitialBoardProfile,
  finalizeBoardGoals,
  inferNegotiationIndexesFromGoals,
  evaluateGoal,
  countGoalsMet,
  evaluateGoalProgress,
  computeU25StatSum,
  applyTradeoffTighteningToGoals,
} from "./boardGoals.js";

// S-02d · Cumulative + plan-start-baseline kontekst-loader for de 7 nye mål-typer
export {
  loadGoalContextForBoard,
} from "./boardGoalContext.js";

// S-02g · Mid-season auto-banner cron + pure trigger-evaluering
export {
  processMidSeasonReviewCron,
  evaluateMidSeasonTrigger,
  MID_SEASON_TITLE_PREFIX,
} from "./boardMidSeason.js";

export {
  isValidBoardFocus,
  isValidBoardPlanType,
  isValidBoardRequestType,
  getBoardRequestDefinition,
  buildBoardRequestOptions,
  resolveBoardRequest,
  isMajorPivotRequest,
  TRADEOFF_PAYLOADS_BY_REQUEST,
  REQUEST_WINDOW_BLOCK_RACE_DAYS_LEFT,
  MID_CYCLE_PROGRESS_THRESHOLD_PCT,
  MID_CYCLE_SATISFACTION_DELTA_PCT,
  MAJOR_PIVOT_REQUEST_TYPES,
} from "./boardRequests.js";

export {
  buildBoardOutlook,
  calculateBoardSatisfaction,
  satisfactionToModifier,
  evaluateBoardSeason,
} from "./boardEvaluation.js";

// S-02c · Board members + arketyper
export {
  BOARD_ARCHETYPE_KEYS,
  BOARD_ARCHETYPES,
  archetypesConflict,
  computeArchetypeAlignmentScore,
  getArchetypeByKey,
} from "./boardArchetypes.js";

export {
  TEAM_BOARD_MEMBERS_COUNT,
  IDENTITY_PICKS,
  WILDCARD_PICKS,
  REPLACEMENT_TRIGGER_THRESHOLD,
  LOW_SATISFACTION_THRESHOLD,
  selectBoardMembers,
  assignBoardMembersForTeam,
  selectDominantMember,
  sampleReactionForFeedback,
  sampleReactionForGoal,
  processReplacementTrigger,
} from "./boardMembers.js";

// S-02f · Klub-DNA (5 håndlavede klub-identiteter)
export {
  DNA_KEYS,
  BOARD_CLUB_DNA,
  getDnaByKey,
  isValidDnaKey,
  computeDnaSuggestions,
  getDnaArchetypeAlignmentBonus,
  getDnaGoalWeightMultiplier,
  buildDnaTraditionGoal,
  applyDnaWeightingToGoals,
} from "./boardClubDna.js";
