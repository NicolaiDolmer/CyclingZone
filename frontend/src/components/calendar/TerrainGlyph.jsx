import { profileShape } from "../../lib/stageProfileConfig.js";

// One representative profile_type per calendar terrain bucket, so the legend and the
// race chips draw the same schematic silhouette vocabulary the rest of the app uses
// (StageStripe's MiniSilhouette). Honest: this is a category pictogram, not a measured
// elevation profile (the app only stores profile_type + finale_type, not metres).
const BUCKET_TO_PROFILE = {
  sprint: "flat",
  hilly: "hilly",
  mountain: "mountain",
  itt: "itt",
};

// A compact terrain silhouette for a calendar race chip / legend. Inherits color via
// currentColor (set the wrapper's text color). Width is fixed; the polyline scales.
export default function TerrainGlyph({ bucket = "sprint", className = "", width = 22, height = 12 }) {
  const profile = BUCKET_TO_PROFILE[bucket] || "flat";
  const { points, baseY } = profileShape(profile);
  return (
    <svg
      viewBox="0 0 100 24"
      width={width}
      height={height}
      preserveAspectRatio="none"
      className={`block flex-shrink-0 ${className}`}
      aria-hidden="true"
    >
      {/* baseline — "sea level" the silhouette rests on, drawn faint */}
      <line x1="0" y1={baseY} x2="100" y2={baseY} stroke="currentColor" strokeWidth="1" opacity="0.25" />
      <polyline points={points} fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />
    </svg>
  );
}
