// #5920: ren model for ungdomsløbenes Team-kolonne (gulv-advarsel + "Train only").
import { MIN_RACE_ENTRIES } from "../../lib/raceSelectionLogic.js";
import { youthSelectionOpen, type YouthRaceItem } from "../../lib/youthRaceCalendar.ts";

// "Train only": kommende ulåste løb uden felt vises som "Not entered · training".
export function youthIsTraining(r: YouthRaceItem, trainOnly: boolean): boolean {
  return trainOnly && youthSelectionOpen(r) && r.selection === "none";
}

// #5907/#5920: under gulvet stiller holdet ikke op; kun mens udtagelsen er åben.
// Gælder også 0 udtagne ryttere (selection "none"), undtagen når truppen er train-only.
export function youthBelowFloor(r: YouthRaceItem, trainOnly: boolean): boolean {
  if (!youthSelectionOpen(r)) return false;
  if (youthIsTraining(r, trainOnly)) return false;
  return r.riders < MIN_RACE_ENTRIES;
}
