import { useEffect, useState } from "react";

/**
 * Reaktiv `window.matchMedia`. Til gengæld for de eksisterende engangs-aflæsninger
 * (`prefers-reduced-motion` i CountdownRing/useFlipRows) er DENNE reaktiv, fordi
 * mobil/desktop-grænsen skal kunne krydses uden reload — både når telefonen
 * roteres og når en e2e-test resizer viewportet mellem to skærmbilleder.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() => {
    if (typeof window === "undefined" || !window.matchMedia) return false;
    return window.matchMedia(query).matches;
  });

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);

  return matches;
}

/**
 * T2's mobilgrænse (docs/design/PAGE_TEMPLATES.md "Mobile ≤640px", D-047/#5102).
 * Samme 640px som Tailwinds `sm`, så CSS-baserede og JS-baserede dele af den
 * samme tabel skifter tilstand på nøjagtig samme pixel.
 */
export function useIsMobileViewport(): boolean {
  return useMediaQuery("(max-width: 640px)");
}
