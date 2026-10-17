// #6728: placering af en åben tooltip-boble i viewport-koordinater (position: fixed).
// Boblen holdes mindst EDGE px inde fra skærmkanten, så den aldrig skæres af og
// aldrig gør siden bredere end skærmen.

export type Side = "top" | "bottom" | "left" | "right";
export interface Rect { left: number; top: number; right: number; bottom: number; width: number; height: number }
export interface Size { width: number; height: number }
// hidden: ankeret er scrollet ud af skærmen. Boblen ligger fixed, så uden det
// flag ville klemningen holde den svævende over andet indhold (kitchen-sink på
// webkit: en tvunget åben boble lå oven i stat-colours-sektionen).
export interface Placement { left: number; top: number; maxWidth: number; hidden: boolean }

export const EDGE = 8;
export const GAP = 8;
export const MAX_WIDTH = 320; // max-w-xs

// Boblens bredde-loft på en given skærmbredde. Boblen skal MÅLES med samme loft,
// som den vises med, ellers ombrydes teksten anderledes, og højden passer ikke.
export function tooltipMaxWidth(viewportWidth: number): number {
  return Math.min(MAX_WIDTH, viewportWidth - EDGE * 2);
}

export function placeTooltip(rect: Rect, side: Side | string, bubble: Size, viewport: Size): Placement {
  const maxWidth = tooltipMaxWidth(viewport.width);
  const w = Math.min(bubble.width, maxWidth);
  const h = bubble.height;
  // Mangler den ønskede side plads, vendes boblen til den modsatte side FØR
  // klemningen. Ellers klemmes den ind oven i ankeret (Codex-review #6734:
  // anker top 4/bund 26 og 30 px boble endte på top 8).
  const roomAbove = rect.top - GAP - h >= EDGE;
  const roomBelow = rect.bottom + GAP + h <= viewport.height - EDGE;
  const roomLeft = rect.left - GAP - w >= EDGE;
  const roomRight = rect.right + GAP + w <= viewport.width - EDGE;
  let actual = side;
  if (side === "top" && !roomAbove && roomBelow) actual = "bottom";
  else if (side === "bottom" && !roomBelow && roomAbove) actual = "top";
  else if (side === "left" && !roomLeft && roomRight) actual = "right";
  else if (side === "right" && !roomRight && roomLeft) actual = "left";
  let left: number;
  let top: number;
  if (actual === "left" || actual === "right") {
    left = actual === "left" ? rect.left - GAP - w : rect.right + GAP;
    top = rect.top + rect.height / 2 - h / 2;
  } else {
    left = rect.left + rect.width / 2 - w / 2;
    top = actual === "bottom" ? rect.bottom + GAP : rect.top - GAP - h;
  }
  const hidden = rect.bottom <= 0 || rect.top >= viewport.height || rect.right <= 0 || rect.left >= viewport.width;
  return {
    left: Math.max(EDGE, Math.min(left, viewport.width - w - EDGE)),
    top: Math.max(EDGE, Math.min(top, viewport.height - h - EDGE)),
    maxWidth,
    hidden,
  };
}
