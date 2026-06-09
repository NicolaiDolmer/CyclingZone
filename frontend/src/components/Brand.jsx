// #481 brand wire-in — reusable brand marks backed by the locked, fully-outlined
// SVG masters in `public/brand/`. The masters carry the exact geometry + twin
// movement-lines (no live-font dependency), so these render pixel-identical
// regardless of font availability.
//
// - <Wordmark>  theme-aware "CYCLING ZONE" logotype (navy on light, gold on dark).
// - <Monogram>  the CZ tile (gold square, navy CZ) — theme-independent, any bg.
// - <StackedMark> the stacked CYCLING/ZONE lockup (gold tile) — hero / login mark.
//
// Theme switching uses Tailwind's `dark:` variant (configured to
// `[data-theme="dark"]`) so there is no JS flicker: both wordmark variants are
// emitted and CSS shows the matching one. Hidden <img>s are not announced by
// screen readers, so both may safely carry the same alt.

const BRAND_NAME = "Cycling Zone";

/**
 * Theme-aware wordmark logotype. Sizes by height; width is intrinsic (≈3.43:1).
 * Sidebar passes `forceDark` because the sidebar canvas is always navy.
 */
export function Wordmark({ className = "h-5", forceDark = false, alt = BRAND_NAME }) {
  if (forceDark) {
    return <img src="/brand/wordmark-ondark.svg" alt={alt} className={className} draggable="false" />;
  }
  return (
    <>
      <img src="/brand/wordmark-onlight.svg" alt={alt} className={`${className} block dark:hidden`} draggable="false" />
      <img src="/brand/wordmark-ondark.svg" alt={alt} className={`${className} hidden dark:block`} draggable="false" />
    </>
  );
}

/** CZ monogram tile — gold square, navy CZ. Theme-independent. Decorative by default. */
export function Monogram({ className = "w-7 h-7", alt = "" }) {
  return (
    <img
      src="/brand/monogram-cz.svg"
      alt={alt}
      aria-hidden={alt === "" ? "true" : undefined}
      className={`rounded-md flex-shrink-0 ${className}`}
      draggable="false"
    />
  );
}

/** Stacked CYCLING/ZONE lockup on the gold tile — the hero / app-icon mark. */
export function StackedMark({ className = "w-16 h-16", alt = BRAND_NAME }) {
  return (
    <img
      src="/brand/favicon-stacked.svg"
      alt={alt}
      className={`rounded-xl ${className}`}
      draggable="false"
    />
  );
}
