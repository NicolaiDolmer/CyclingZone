import type { CSSProperties } from "react";

// #7627: the race share is neutral, not gold (one gold primary per view,
// TASTE.md). Race is told apart from training by pattern, not colour alone:
// a darker neutral fill with diagonal hatching, so it reads in light and dark
// mode and for colour-blind players. Tokens only, no new colour.
export const RACE_FILL_CLASS = "bg-cz-2";
export const RACE_FILL_STYLE: CSSProperties = {
  backgroundImage: "repeating-linear-gradient(135deg, var(--color-cz-card) 0 1.5px, transparent 1.5px 4px)",
};
