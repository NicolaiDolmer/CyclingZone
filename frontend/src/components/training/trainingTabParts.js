// #6030: de dele af TrainingPage der kun bruges i fanerne Program, Development
// og Report, samlet i EET modul. TrainingPage henter modulet med en enkelt
// dynamisk import (React.lazy), saa foerste visning af Today henter mindre.
// Eet modul frem for en lazy import pr. komponent: bundle-gaten summerer ALLE
// chunks gzippet hver for sig, og ti smaa chunks mister den faelles gzip-
// kontekst (maalt 1/10 mod en build uden lazy: ti imports +11,2 KB i alt,
// eet modul +5,0 KB; se _training_dead_code_lazy_note i bundle-budget.json).
export { default as TrainingPlanCard } from "./TrainingPlanCard.tsx";
export { default as TrainingProgramList } from "./TrainingProgramList.tsx";
export { default as FatigueRulePanel } from "./FatigueRulePanel.tsx";
export { default as TrainingGroupsPlan } from "./TrainingGroupsPlan.tsx";
export { default as TrainingGroupDialog } from "./groups/TrainingGroupDialog.tsx";
export { default as GroupFatigueExceptions } from "./groups/GroupFatigueExceptions.tsx";
export { default as SeasonOverview } from "./SeasonOverview.jsx";
export { default as DevelopmentGlyph } from "../development/DevelopmentGlyph.jsx";
export { default as TrainingHistory } from "./TrainingHistory.jsx";
export { default as TrainingMoment } from "./TrainingMoment.jsx";
