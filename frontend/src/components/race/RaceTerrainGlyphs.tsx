// #6514 · Et løbs terræn som glyffer: kalenderens løbskort og Løbshistorikkens
// terrænkolonne tegner det ens.
//
// Ejer 15/10 (14:06 + 14:43): TerrainTypeGlyph, hver type én gang,
// højst 3, den hårdeste først (lib/racePeek.ts raceTerrain). Antallet står kun i
// tooltip, fx "Bjerge ×4". #6683: ikonerne er farvede streg-ikon (farven viser
// sværhed), tegnet af TerrainTypeGlyph, ét sted for alle.
import type { ComponentType } from "react";
import type { RaceTerrain } from "../../lib/racePeek.ts";
import TerrainTypeGlyphBase from "./TerrainTypeGlyph.jsx";

// TerrainTypeGlyph er stadig .jsx uden typer: kontrakten skrives ned her.
const TerrainTypeGlyph = TerrainTypeGlyphBase as unknown as ComponentType<{ profileType: string; size?: number; className?: string }>;

interface RaceTerrainGlyphsProps {
  terrain: readonly RaceTerrain[];
  /** Tooltip/skærmlæser-tekst for én type, fx "Bjerge ×4". */
  label: (item: RaceTerrain) => string;
  size?: number;
  className?: string;
  testId?: string;
}

export default function RaceTerrainGlyphs({ terrain, label, size = 14, className = "", testId }: RaceTerrainGlyphsProps) {
  if (!terrain.length) return null;
  const labels = terrain.map(label);
  return (
    <span role="img" aria-label={labels.join(", ")} className={`inline-flex items-center gap-2 ${className}`} data-testid={testId}>
      {terrain.map((item, i) => (
        <span key={item.kind} title={labels[i]} className="inline-flex">
          <TerrainTypeGlyph profileType={item.profileType} size={size} />
        </span>
      ))}
    </span>
  );
}
