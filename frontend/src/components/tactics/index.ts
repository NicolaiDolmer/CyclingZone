// #8297 · Det fælles taktikpanels dele samlet ét sted. Løbssiden henter dem først, når
// panelet faktisk vises (kun under v6), så den gamle løbssides stykke ikke vokser.
export { default as TacticsPanel } from "./TacticsPanel.tsx";
export { default as TacticsRiderTable } from "./TacticsRiderTable.tsx";
export { default as EffortSegmented } from "./EffortSegmented.tsx";
export { default as TeamPlanCards } from "./TeamPlanCards.tsx";
export { saveBadge, effortSegments } from "./tacticsPanelModel.ts";
export type { TacticsSaveBadge, TacticsSaveStatus } from "./tacticsPanelModel.ts";
