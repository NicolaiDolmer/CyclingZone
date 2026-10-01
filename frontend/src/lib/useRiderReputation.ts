import { useSyncExternalStore } from "react";
import {
  isRiderReputationOn,
  subscribeRiderReputation,
} from "./riderReputation.ts";

const serverSnapshot = (): boolean => false;

export function useRiderReputation(): boolean {
  return useSyncExternalStore(subscribeRiderReputation, isRiderReputationOn, serverSnapshot);
}
