// #2577: FLIP-reorder — mål rækkepositioner før og efter en data-opdatering og
// animér forskellen (rækker glider til nye pladser i stedet for at hoppe).
// Nøgle = stabilt id (team_id), IKKE index. Kræver ingen absolute positioning
// og virker med en almindelig <table>.
// prefers-reduced-motion => ingen animation (spec A6, hard krav).
import { useLayoutEffect, useRef } from "react";

export default function useFlipRows(deps) {
  const refs = useRef(new Map());       // id -> <tr>
  const prev = useRef(new Map());       // id -> top (px)
  useLayoutEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const next = new Map();
    refs.current.forEach((el, id) => { if (el) next.set(id, el.getBoundingClientRect().top); });
    if (!reduced) {
      // Ens delta på ALLE rækker = ren scroll/layout-forskydning, ikke en
      // reorder — animér ikke (hele tabellen ville ellers glide samlet).
      const deltas = [];
      next.forEach((top, id) => {
        const before = prev.current.get(id);
        if (before != null && before !== top) deltas.push(before - top);
      });
      const uniformShift = deltas.length > 1 && deltas.every(d => d === deltas[0]);
      if (!uniformShift) next.forEach((top, id) => {
        const before = prev.current.get(id);
        if (before == null || before === top) return;
        const el = refs.current.get(id);
        el.animate(
          [{ transform: `translateY(${before - top}px)` }, { transform: "translateY(0)" }],
          // 360ms er bevidst over --dur-slow (240ms) — reorder er en større
          // rumlig bevægelse. Easing = --ease-kurven.
          { duration: 360, easing: "cubic-bezier(.2,.7,.2,1)" }
        );
      });
    }
    prev.current = next;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
  return (id) => (el) => { el ? refs.current.set(id, el) : refs.current.delete(id); };
}
