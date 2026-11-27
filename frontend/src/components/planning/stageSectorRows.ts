// #8609 · Raekkerne i sektorlisten (StageSectorList): ren logik, saa tallene testes uden React.
// Kilden er etapeprofilens gemte `sectors` (race_stage_profiles), de samme felter som profilen
// tegner (StageProfileV2), saa listen og profilen altid viser de samme sektorer.
import type { StageProfile } from "../race/stagePageV2/stagePageV2Model.ts";

export type SectorKind = "cobbles" | "gravel";

export interface SectorRow {
  /** Indeks i den sorterede liste (km-raekkefoelge); bruges til markeringen paa profilen. */
  index: number;
  kind: SectorKind;
  name: string | null;
  startKm: number;
  endKm: number;
  lengthKm: number;
  kmToGo: number;
}

const tenth = (v: number) => Math.round(v * 10) / 10;

/**
 * Etapens brostens- og grussektorer i km-raekkefoelge. Sektorer uden brugbar placering eller
 * laengde udelades, praecis som profilen udelader dem, saa listen aldrig viser en sektor,
 * der ikke er tegnet.
 */
export function sectorRows(profile: StageProfile | null | undefined): SectorRow[] {
  const raw = Array.isArray(profile?.sectors) ? profile!.sectors! : [];
  const distance = Number(profile?.distance_km);
  return raw
    .filter((s) => Number.isFinite(Number(s?.start_km)) && Number(s?.length_km) > 0)
    .map((s) => ({ s, start: Number(s.start_km), length: Number(s.length_km) }))
    .sort((a, b) => a.start - b.start)
    .map(({ s, start, length }, index) => {
      const end = start + length;
      return {
        index,
        kind: (s.kind === "gravel" ? "gravel" : "cobbles") as SectorKind,
        name: typeof s.name === "string" && s.name.trim() ? s.name.trim() : null,
        startKm: tenth(start),
        endKm: tenth(end),
        lengthKm: tenth(length),
        kmToGo: Number.isFinite(distance) && distance > 0 ? Math.max(0, Math.round(distance - end)) : 0,
      };
    });
}
