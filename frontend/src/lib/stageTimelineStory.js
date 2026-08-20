// #3859 (bølge 2 — løbsfilm-afspiller): kuraterings-logik for "The story of the
// stage" — vælger 3-5 nøgle-events ud af en fuld etape-tidslinje (spec §2.2,
// docs/superpowers/specs/2026-08-17-race-event-log-stage-timeline-design.md).
// Ren afledningsfunktion: samme events-liste giver altid samme udvalg (samme
// determinisme-garanti som selve tidslinje-artefaktet, jf. spec §2.3.4).
//
// Prioritering: narrativ vægt, ikke kronologi — men OUTPUT sorteres kronologisk
// (km stigende) igen bagefter, fordi "historien om etapen" skal læses i den
// rækkefølge tingene skete, ikke i vigtigheds-rækkefølge. `gap_update` indgår
// ALDRIG i historien (vægt 0) — det er kurve-punkter til forsprings-grafen, ikke
// en fortælle-begivenhed (spec §2.2: forankring "(S) kurvepunkter — valg 2").
export const STORY_EVENT_WEIGHTS = {
  finish: 100,
  gc_change: 92,
  finale_attack: 84,
  breakaway_survived: 76,
  sprint_decided: 68,
  favorite_crack: 62,
  breakaway_caught: 56,
  breakaway_formed: 42,
  incident: 34,
  intermediate_sprint: 16,
  kom_passage: 14,
  stage_start: 4,
  gap_update: 0,
};

export const MIN_STORY_EVENTS = 3;
export const MAX_STORY_EVENTS = 5;

/**
 * Vælger op til MAX_STORY_EVENTS nøgle-events fra en fuld tidslinje, rangeret
 * efter narrativ vægt (ties brydes på oprindelig rækkefølge i tidslinjen, som
 * allerede er km-sorteret, for stabil determinisme). Returnerer dem KRONOLOGISK
 * (km stigende) igen, klar til visning.
 *
 * Degraderer ærligt: færre end MIN_STORY_EVENTS kvalificerende events (tynd/
 * gammel etape) → returnerer bare det der findes, aldrig opfundet indhold.
 * Ukendte event-typer (fremtidige taksonomi-tilføjelser, spec §2.2) får vægt 0
 * og udelades stille — forward-kompatibelt, ingen kast.
 */
export function selectStoryEvents(events = []) {
  const candidates = (events || [])
    .map((event, i) => ({ event, weight: STORY_EVENT_WEIGHTS[event?.type] ?? 0, i }))
    .filter((c) => c.weight > 0);

  if (!candidates.length) return [];

  candidates.sort((a, b) => b.weight - a.weight || a.i - b.i);
  const picked = candidates.slice(0, MAX_STORY_EVENTS);
  picked.sort((a, b) => (a.event.km ?? 0) - (b.event.km ?? 0) || a.i - b.i);
  return picked.map((c) => c.event);
}
