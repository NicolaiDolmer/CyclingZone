// #8297 · Ren logik for det fælles taktikpanel (wireframe v6c). Ingen React, ingen I/O.
//
// Ejerens valg 16/11 (#7535): indsatsen står på ÉN linje, let til venstre og hård til
// højre, samme rækkefølge overalt i spillet. Trinnene er stadig serverens egne
// (valid_efforts, gennem effortsForStage); panelet lægger dem kun i den rækkefølge.
import { EFFORT_SCALE } from "../../lib/raceIntention.js";

const SCALE: readonly string[] = EFFORT_SCALE;

/**
 * Indsatsens segmenter, letteste til venstre og hårdeste til højre. Kun de trin der
 * kommer ind (etapens trin), aldrig en hardkodet liste; et ukendt trin står bagest
 * frem for at forsvinde.
 */
export function effortSegments(steps: readonly string[] | null | undefined): string[] {
  const list = Array.isArray(steps) ? steps : [];
  const known = SCALE.filter((step) => list.includes(step));
  const unknown = list.filter((step) => !SCALE.includes(step));
  return [...new Set([...known, ...unknown])];
}

export type TacticsSaveStatus = "idle" | "saving" | "saved" | "error" | "partial" | "conflict";

/** Hvad bundens mærke siger. Kun "saved" er gemt; alt andet er "ikke gemt" med hver sin linje. */
export type TacticsSaveBadge = "saved" | "unsaved" | "untouched" | "saving" | "problem";

/**
 * Bundens tilstand (wireframe v6c: "NOT SAVED · If you do nothing, they ride exactly
 * this"). Samme regler som fanens egne linjer: "saved" efter et lykket gem, "unsaved"
 * med en kladde, "problem" ved fejl, delvist gem eller konflikt (linjen forklarer selv).
 */
export function saveBadge({ status, dirty }: { status: TacticsSaveStatus; dirty: boolean }): TacticsSaveBadge {
  if (status === "saving") return "saving";
  if (status === "saved") return "saved";
  if (status === "error" || status === "partial" || status === "conflict") return "problem";
  return dirty ? "unsaved" : "untouched";
}
