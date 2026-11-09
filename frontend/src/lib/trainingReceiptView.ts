// #7745 / #7746: how the daily training report presents one rider's development.
//
// Pure view helpers for DailyTrainingReceipt. They never compute development;
// they only order and split what the receipt already carries:
//   - whole ability points (gains) are the headline and stand apart from the
//     progress toward the next point (gain_percent), so a "+1" can never be
//     mistaken for "+1%" (#7745, follows #6239),
//   - riders keep one order whether or not they landed a whole point; those
//     without one say so on their own row (#7745),
//   - abilities are listed in the rider profile's order, the shared ability
//     registry (Physical, Mental, Technical), never in storage order (#7746).
import { ABILITY_KEYS } from "./abilities.js";

const PROFILE_ORDER: ReadonlyMap<string, number> = new Map((ABILITY_KEYS as readonly string[]).map((key, index) => [key, index]));

/** Sorts ability keys in the rider profile's order. Keys the registry does not
 *  know (older reports) go last, alphabetically, so nothing is dropped. */
export function orderAbilities(keys: Iterable<string>): string[] {
  return [...new Set(keys)].sort((a, b) => {
    const ia = PROFILE_ORDER.get(a), ib = PROFILE_ORDER.get(b);
    if (ia != null && ib != null) return ia - ib;
    if (ia != null) return -1;
    if (ib != null) return 1;
    return a.localeCompare(b);
  });
}

export interface ReceiptDevelopment {
  gains: Record<string, number>;
  gain_percent: Record<string, number | null>;
}

const positive = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value) && value > 0;

/** Whole points landed on the date, in profile order. */
export function wholePointEntries(dev: ReceiptDevelopment): Array<{ key: string; points: number }> {
  return orderAbilities(Object.keys(dev.gains ?? {}).filter(key => positive(dev.gains[key])))
    .map(key => ({ key, points: dev.gains[key] }));
}

/** Abilities that only moved toward their next point (no whole point), in profile order. */
export function progressOnlyEntries(dev: ReceiptDevelopment): Array<{ key: string; percent: number }> {
  return orderAbilities(Object.keys(dev.gain_percent ?? {})
    .filter(key => positive(dev.gain_percent[key]) && !positive(dev.gains?.[key])))
    .map(key => ({ key, percent: dev.gain_percent[key] as number }));
}
