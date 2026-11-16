import type { CSSProperties } from "react";

// #7627: the race share is neutral, not gold (one gold primary per view,
// TASTE.md). Race is told apart from training by pattern, not colour alone:
// a darker neutral fill with diagonal hatching, so it reads in light and dark
// mode and for colour-blind players. Tokens only, no new colour. The hatching
// is an SVG pattern stroked with the card token, so it follows the theme.
const PATTERN_ID = "race-share-hatch";

export default function RaceFill({ className = "", style }: { className?: string; style?: CSSProperties }) {
  return (
    <span className={`block h-full bg-cz-2 ${className}`} style={style} data-race-fill="">
      <svg className="block h-full w-full" aria-hidden="true" focusable="false">
        <defs>
          <pattern id={PATTERN_ID} width="4" height="4" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="1.5" height="4" fill="var(--color-cz-card)" />
          </pattern>
        </defs>
        <rect width="100%" height="100%" fill={`url(#${PATTERN_ID})`} />
      </svg>
    </span>
  );
}
