import { createPortal } from "react-dom";

// Renderer children i document.body — uden for overflow-/stacking-kontekster.
// SSR-guard: returnér null hvis document ikke findes.
export default function Portal({ children }) {
  if (typeof document === "undefined") return null;
  return createPortal(children, document.body);
}
