export default function Skeleton({ className = "h-4 w-full", rounded = "rounded-cz" }) {
  return <span aria-hidden="true" className={`block cz-skeleton ${rounded} ${className}`} />;
}

// #2849 bølge 0 — kanonisk card-loading (states-sheet): 12px-høje linjer, 12px gap,
// radius 4, bredder der ekkoer ægte indhold (~88/64/76/52%), accent-shimmer 1.4s
// (cz-skeleton i index.css). Aldrig en spinner inde i cards.
const LINE_WIDTHS = ["88%", "64%", "76%", "52%"];

export function SkeletonLines({ lines = 4, className = "" }) {
  return (
    <div aria-hidden="true" className={`space-y-3 ${className}`}>
      {Array.from({ length: lines }, (_, i) => (
        <span
          key={i}
          className="block cz-skeleton h-3 rounded"
          style={{ width: LINE_WIDTHS[i % LINE_WIDTHS.length] }}
        />
      ))}
    </div>
  );
}
