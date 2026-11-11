export default function Skeleton({ className = "h-4 w-full", rounded = "rounded-cz", staticMotion = true }) {
  return <span aria-hidden="true" className={`block ${staticMotion ? "cz-skeleton-static" : "cz-skeleton"} ${rounded} ${className}`} />;
}

// #2849 bølge 0 — kanonisk card-loading (states-sheet): 12px-høje linjer, 12px gap,
// radius 4, bredder der ekkoer ægte indhold (~88/64/76/52%).
// #2230: stille neutral graa, ingen puls/shimmer (ejer 11/11).
const LINE_WIDTHS = ["88%", "64%", "76%", "52%"];

export function SkeletonLines({ lines = 4, className = "" }) {
  return (
    <div aria-hidden="true" className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="block cz-skeleton-static h-3 rounded"
          style={{ width: LINE_WIDTHS[i % LINE_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}
