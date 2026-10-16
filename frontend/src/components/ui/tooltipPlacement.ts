// #6728: placering af en åben tooltip-boble i viewport-koordinater (position: fixed).
// Boblen holdes mindst EDGE px inde fra skærmkanten, så den aldrig skæres af og
// aldrig gør siden bredere end skærmen.

export type Side = "top" | "bottom" | "left" | "right";
export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Size { width: number; height: number }
export interface Placement { left: number; top: number; maxWidth: number }

export const EDGE = 8;
export const GAP = 8;
export const MAX_WIDTH = 320; // max-w-xs

export function placeTooltip(rect: Rect, side: Side | string, bubble: Size, viewport: Size): Placement {
  const maxWidth = Math.min(MAX_WIDTH, viewport.width - EDGE * 2);
  const w = Math.min(bubble.width, maxWidth);
  const h = bubble.height;
  let left: number;
  let top: number;
  if (side === "left" || side === "right") {
    left = side === "left" ? rect.left - GAP - w : rect.right + GAP;
    top = rect.top + rect.height / 2 - h / 2;
  } else {
    left = rect.left + rect.width / 2 - w / 2;
    top = side === "bottom" ? rect.bottom + GAP : rect.top - GAP - h;
  }
  return {
    left: Math.max(EDGE, Math.min(left, viewport.width - w - EDGE)),
    top: Math.max(EDGE, Math.min(top, viewport.height - h - EDGE)),
    maxWidth,
  };
}
