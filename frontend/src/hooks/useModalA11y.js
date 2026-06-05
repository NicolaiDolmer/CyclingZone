// #1073 · Delt modal-a11y: focus-trap + Escape-luk + focus-restore + scroll-lock.
// Kodebasen havde ingen genbrugelig dialog-primitiv (kun per-komponent role/aria),
// så board-modalerne var helt utilgængelige for tastatur/skærmlæser. Denne hook
// samler adfærden ét sted; kalderen sætter selv role="dialog"/aria-modal/
// aria-labelledby på panelet og hænger den returnerede ref på samme element.
//
// Brug:
//   const dialogRef = useModalA11y(onClose);              // mountes kun når åben
//   const wizardRef = useModalA11y(closable ? close : null, Boolean(open)); // inline modal
//   <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="...">
import { useEffect, useRef } from "react";

const FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "textarea:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

// onClose: kaldes ved Escape (null = ikke luk-bar, men focus-trap er stadig aktiv).
// active: om modalen er åben (default true for komponenter der kun mountes når åbne).
export function useModalA11y(onClose, active = true) {
  const containerRef = useRef(null);
  const onCloseRef = useRef(onClose);
  // Hold den seneste onClose uden at gen-køre focus-trap-effekten (som kun afhænger
  // af `active`). Ref-opdatering sker i en effect for ikke at røre ref under render.
  useEffect(() => {
    onCloseRef.current = onClose;
  });

  useEffect(() => {
    const node = containerRef.current;
    if (!active || !node || typeof document === "undefined") return undefined;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const getFocusable = () =>
      Array.from(node.querySelectorAll(FOCUSABLE_SELECTOR))
        .filter((el) => el.offsetParent !== null || el === node);

    // Sæt fokus ind i dialogen (første interaktive element, ellers panelet selv).
    const initial = getFocusable();
    (initial[0] || node).focus?.();

    const handleKeyDown = (e) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onCloseRef.current?.();
        return;
      }
      if (e.key !== "Tab") return;
      const items = getFocusable();
      if (items.length === 0) {
        e.preventDefault();
        node.focus?.();
        return;
      }
      const first = items[0];
      const last = items[items.length - 1];
      const activeEl = document.activeElement;
      if (e.shiftKey && (activeEl === first || activeEl === node)) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && activeEl === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => {
      document.removeEventListener("keydown", handleKeyDown, true);
      document.body.style.overflow = previousOverflow;
      previouslyFocused?.focus?.();
    };
  }, [active]);

  return containerRef;
}
