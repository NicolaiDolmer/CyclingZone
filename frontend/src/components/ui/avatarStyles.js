// Neutral avatar (spec B2). Hairline-ring, aldrig guld. Baerer initialer ELLER billede.
const AVATAR_BASE =
  "inline-flex shrink-0 select-none items-center justify-center overflow-hidden rounded-cz-pill " +
  "bg-cz-subtle text-cz-2 ring-1 ring-cz-border font-data font-semibold uppercase";

const AVATAR_SIZES = {
  sm: "h-7 w-7 text-[10px]",
  md: "h-9 w-9 text-xs",
  lg: "h-12 w-12 text-sm",
};

export function avatarClass({ size = "md" } = {}) {
  return `${AVATAR_BASE} ${AVATAR_SIZES[size] ?? AVATAR_SIZES.md}`;
}

// Initialer: foerste bogstav af de foerste to ord (maks 2), uppercase.
export function initialsFrom(name = "") {
  return (name ?? "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0])
    .join("")
    .toUpperCase();
}
