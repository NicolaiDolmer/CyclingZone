import { cloneElement, isValidElement, useCallback, useId, useLayoutEffect, useRef, useState } from "react";
import Portal from "./Portal.jsx";
import { tooltipClass } from "./tooltipStyles.js";
import { placeTooltip, tooltipMaxWidth } from "./tooltipPlacement.ts";

// #6728: en lukket boble renderes ikke. Før lå den usynligt (opacity-0) og
// absolut placeret i siden, og ved skærmkanten gjorde den siden bredere end
// skærmen: løbssiden var 461 px bred på en 375 px telefon og kunne swipes
// sidelæns. En åben boble renderes i en Portal med fixed position og holdes
// inde fra kanten. Samme greb som MarkerTip i RaceDetailPage.jsx (#6185).
// Hover viser den, fokus (tryk på mobil) viser den, `open` tvinger den åben
// (kitchen-sink/snapshot).
export default function Tooltip({ label, side = "top", open = false, id, className = "", children }) {
  const anchorRef = useRef(null);
  const bubbleRef = useRef(null);
  const [active, setActive] = useState(false);
  const [pos, setPos] = useState(null);
  const visible = active || open;
  // Codex-review #6734: boblen findes kun, mens den er åben, så skærmlæsere
  // får teksten fra en altid tilstedeværende sr-only-kopi, som ankeret peger
  // på via aria-describedby.
  const descId = `${useId()}-desc`;
  const trigger = isValidElement(children)
    ? cloneElement(children, {
      "aria-describedby": [children.props["aria-describedby"], descId].filter(Boolean).join(" "),
    })
    : children;

  const place = useCallback(() => {
    const anchor = anchorRef.current;
    const bubble = bubbleRef.current;
    if (!anchor || !bubble) return;
    // Sæt det endelige bredde-loft FØR målingen: på en smal skærm ombrydes
    // teksten ellers anderledes end ved målingen, og top beregnes ud fra en
    // forkert højde (Codex-review på #6734). Gælder også ved resize.
    bubble.style.maxWidth = `${tooltipMaxWidth(window.innerWidth)}px`;
    const b = bubble.getBoundingClientRect();
    setPos(placeTooltip(anchor.getBoundingClientRect(), side, { width: b.width, height: b.height },
      { width: window.innerWidth, height: window.innerHeight }));
  }, [side]);

  useLayoutEffect(() => {
    if (!visible) { setPos(null); return undefined; }
    place();
    window.addEventListener("scroll", place, true);
    window.addEventListener("resize", place);
    return () => {
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("resize", place);
    };
  }, [visible, place]);

  return (
    <span ref={anchorRef} className="group relative inline-flex"
      onMouseEnter={() => setActive(true)} onMouseLeave={() => setActive(false)}
      onFocus={() => setActive(true)} onBlur={() => setActive(false)}>
      {trigger}
      <span id={descId} className="sr-only">{label}</span>
      {visible && (
        <Portal>
          <span ref={bubbleRef} role="tooltip" id={id}
            className={`${tooltipClass({ side })} opacity-100! ${className}`}
            /* Tailwind 4 skriver -translate-x-1/2 som `translate`, så både
               transform og translate nulstilles (#6271). Indtil første måling
               står boblen skjult øverst til venstre, så den kan måles. */
            style={{
              position: "fixed", left: pos?.left ?? 0, top: pos?.top ?? 0, right: "auto", bottom: "auto",
              transform: "none", translate: "none", maxWidth: pos?.maxWidth ?? tooltipMaxWidth(window.innerWidth),
              visibility: pos && !pos.hidden ? "visible" : "hidden",
            }}>
            {label}
          </span>
        </Portal>
      )}
    </span>
  );
}
