import { terrainCodeFor } from "../../lib/terrainCode";

interface TerrainCodeGlyphProps {
  /** Terræn-bucket: sprint/flat/cobbles/hilly/mountain/itt/ttt (ukendt -> sprint-koden). */
  bucket: string | null | undefined;
  width?: number;
  height?: number;
  className?: string;
  /** Sat KUN når glyffen ikke allerede sidder inde i et element med sit eget
   * a11y-navn (fx en Link/knap der selv bærer aria-label/title) — ellers
   * bliver den stående dekorativ (aria-hidden) og relies on den omkringliggende
   * kontekst, samme mønster som IconBase (components/ui/icons/IconBase.jsx)
   * og den gamle calendar/TerrainGlyph.jsx den erstatter her. */
  title?: string;
}

// Delt terræn-bogstavkode-primitiv (#4143) — bruges BÅDE af kalenderens
// dagsceller/legend (CalendarPage.jsx) og planlæggerens master-canvas
// (MasterCanvas.jsx, via foreignObject — samme mønster som Flag/StarIcon der
// allerede indlejres i det canvas' SVG). Se lib/terrainCode.ts for
// sprog-/farve-begrundelsen. Ren SVG (ingen Tailwind-afhængighed på selve
// tegningen ud over currentColor), så den virker identisk i en almindelig
// HTML-kontekst og indlejret i et fremmed SVG-canvas.
export default function TerrainCodeGlyph({
  bucket,
  width = 20,
  height = 12,
  className = "",
  title,
}: TerrainCodeGlyphProps) {
  const code = terrainCodeFor(bucket);
  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={`block flex-shrink-0 ${className}`}
      role={title ? "img" : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : "true"}
    >
      <text
        x={width / 2}
        y={height / 2}
        dy="0.35em"
        textAnchor="middle"
        fontSize={Math.round(height * 0.78)}
        fontWeight="700"
        letterSpacing="0.01em"
        fill="currentColor"
        className="font-data"
      >
        {code}
      </text>
    </svg>
  );
}
