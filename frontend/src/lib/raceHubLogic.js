// frontend/src/lib/raceHubLogic.js
// Race Hub Fase 1: rene UI-helpers til trup-fordeling-board'et. Holder komponenterne
// thin + giver node --test-dækning. Ingen React, ingen I/O.

// Status-chip for en kolonne. withdrawn vinder; ellers under/over/præcis target.
// `max` (valgfri) = øvre grænse; uden den behandles target som max (uændret adfærd).
// Rod A (#1823): kladde-redigering kan transient gå OVER max (add-først-bytte på en
// fuld 6/6-trup), så vi skelner "overfull" fra "full" → ærlig "for mange"-besked.
export function computeColumnStatus({ selected, target, withdrawn, max }) {
  if (withdrawn) return { kind: "withdrawn", selected, target };
  const upper = Number.isFinite(max) ? max : target;
  if (selected > upper) return { kind: "overfull", selected, target };
  if (selected >= target) return { kind: "full", selected, target };
  return { kind: "understaffed", selected, target };
}

// Er kladden klar til at GEMMES? Auto-gem-når-gyldig. #1906 (ejer 26/6): fuld opstilling
// KRÆVES — board'et auto-gemmer KUN en komplet trup (count === pladsantal = max). En
// delvis trup gemmes aldrig; vil/kan man ikke stille fuldt hold afmelder man løbet eller
// henter fri-agenter. Spejler backend raceSelection.validateSelection (required = size.max).
export function isSelectionSavable({ count, max }) {
  const required = Number.isFinite(max) ? max : count;
  return count === required;
}

// #1906: kan holdet OVERHOVEDET fylde en fuld opstilling? false → vis afmeld + link til
// fri transfers (man har for få raske, berettigede ryttere). `available` = antal raske,
// berettigede ryttere; `max` = løbets pladsantal. Spejler backend's selection_insufficient_riders.
export function canFieldFullLineup({ available, max }) {
  if (!Number.isFinite(max)) return true;
  return Number.isFinite(available) ? available >= max : true;
}

// Er rytteren bundet væk fra `forRaceId` (udtaget i et ANDET overlappende kolonne-løb)?
// Bruges i AddRiderPopover til at filtrere hvilke løb en ledig rytter kan tilføjes til.
export function isRiderBound({ bindingMap, riderId, forRaceId }) {
  const races = bindingMap?.[riderId];
  if (!races || !races.length) return false;
  return races.some((id) => id !== forRaceId);
}

// Visnings-status for et løb (#1828). Backend SKRIVER ALDRIG 'active' (det ville bryde
// finalization-invarianterne); i stedet afledes "live" af fremdriften: et etapeløb er
// "live" når mindst én — men ikke alle — etaper er kørt. Pure → delt af Dashboard,
// RaceDetailPage og RacesPage-badge, så de tre flader aldrig kan vise hver sin status.
//   "completed"  — status='completed', ELLER alle etaper kørt (status-flip undervejs)
//   "live"       — status='scheduled' og 0 < stages_completed < stages
//   "scheduled"  — status='scheduled' og endnu ingen etaper kørt
//   (anden status passeres uændret igennem)
export function deriveRaceStatus(status, stagesCompleted, stages) {
  const completed = Number.isFinite(stagesCompleted) ? stagesCompleted : 0;
  const total = Number.isFinite(stages) && stages > 0 ? stages : 1;
  if (status === "completed") return "completed";
  if (status === "scheduled") {
    if (completed >= total) return "completed";
    if (completed > 0) return "live";
    return "scheduled";
  }
  return status;
}

// Per-pulje løbsdage-tæller (#1829). Ét race day = én etape. Den gamle tæller var
// sæson-GLOBAL (seasons.race_days_completed = sum(stages) over completede løb) og
// viste forkert tal for managerens egen pulje. Her summeres KUN puljens egne løb,
// og igangværende etaper TÆLLER med (i modsætning til sum-completed-mønsteret), så
// "kørt / muligt" er ærligt mens et etapeløb stadig kører. Pure → testbar + klient-
// side (ingen migration). `races` = puljens løb [{ status, stages, stages_completed }].
//   completed  — løbsdage kørt: completede løb tæller alle stages, igangværende
//                tæller stages_completed (klampet til [0, stages])
//   total      — puljens samlede løbsdage = sum(stages)
//   inProgress — løbsdage der hører til løb som STADIG kører (delmængde af completed)
export function poolRaceDayTotals(races = []) {
  let completed = 0;
  let total = 0;
  let inProgress = 0;
  for (const r of races || []) {
    const rawStages = Number(r?.stages);
    const stages = Number.isFinite(rawStages) && rawStages > 0 ? rawStages : 1;
    const done = Math.min(Math.max(Number(r?.stages_completed) || 0, 0), stages);
    total += stages;
    const view = deriveRaceStatus(r?.status, done, stages);
    if (view === "completed") {
      completed += stages;
    } else if (view === "live") {
      completed += done;
      inProgress += done;
    }
    // "scheduled" → 0 løbsdage kørt
  }
  return { completed, total, inProgress };
}

// Fit-tier fra suitability-score (0-100): ord-anker til den delte fit-bar (Strong/
// Average/Poor). Heuristiske tærskler, centraliseret så de er nemme at rekalibrere.
// null hvis score mangler (rytter uden beregnet egnethed).
export function fitTier(score) {
  if (!Number.isFinite(score)) return null;
  if (score >= 66) return "strong";
  if (score >= 40) return "average";
  return "poor";
}

// Friskheds-tier fra fatigue (0-100). Erstatter det magiske `fatigue>50` (RaceColumn)
// med én delt, læsbar skala. null hvis fatigue mangler.
export function freshnessTier(fatigue) {
  if (fatigue == null) return null;
  const f = Number(fatigue);
  if (!Number.isFinite(f)) return null;
  if (f >= 67) return "tired";
  if (f >= 34) return "ok";
  return "fresh";
}
