import { useEffect } from "react";

// Delt afvisning for ankrede overlays (Dropdown): klik-udenfor + Escape.
// Modal bruger useModalA11y (focus-trap); Tooltip er hover/fokus-drevet.
export function useDismiss(ref, onDismiss, active = true) {
  useEffect(() => {
    if (!active || typeof document === "undefined") return undefined;
    const onPointer = (e) => {
      if (ref.current && !ref.current.contains(e.target)) onDismiss?.();
    };
    const onKey = (e) => {
      if (e.key === "Escape") onDismiss?.();
    };
    document.addEventListener("mousedown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [ref, onDismiss, active]);
}
