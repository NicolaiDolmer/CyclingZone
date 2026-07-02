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

// (Auto-gem-når-fuld + canFieldFullLineup udgået 28/6: board'et bruger nu eksplicit Gem +
// tillader delvis trup. Se RaceHubBoard.saveAll + backend validateSelection.)

// To in-game-dag-vinduer overlapper hvis de deler mindst én game-dag (inkl. ender).
// Spejler backend raceBinding.windowsOverlap. Defensiv mod null (intet vindue → ingen binding).
export function windowsOverlap(a, b) {
  if (!a || !b) return false;
  return a.start <= b.end && b.start <= a.end;
}

// Er rytteren bundet væk fra `forRaceId` (udtaget i et ANDET kolonne-løb hvis IN-GAME-dag-
// vindue overlapper forRaceId's)? Kronologi-rebuild (2026-06-28): to løb på samme IRL-dag
// binder KUN hvis deres game-dage overlapper — så en rytter må gerne køre to løb på samme
// kalenderdato når de ligger på forskellige in-game-dage. `bindingMap[riderId]` = liste af
// { id, window } (game-dag-vindue pr. kolonne rytteren er i). `forWindow` = forRaceId's vindue.
export function isRiderBound({ bindingMap, riderId, forRaceId, forWindow }) {
  const entries = bindingMap?.[riderId];
  if (!entries || !entries.length) return false;
  return entries.some((e) => e.id !== forRaceId && windowsOverlap(e.window, forWindow));
}

// Kan rytteren tilføjes kolonne-løbet? (ikke afmeldt/låst, ikke allerede udtaget, ikke
// game-dag-bundet i et andet kolonne-løb). Delt af puljen (lås-tilstand) + popover (mål-liste).
export function canAddRiderToColumn({ column, bindingMap, riderId }) {
  if (!column || column.withdrawn || column.lineup_locked) return false;
  if ((column.selection?.rider_ids || []).includes(riderId)) return false;
  return !isRiderBound({ bindingMap, riderId, forRaceId: column.id, forWindow: column.bindingWindow });
}

// #1984: hvilket ANDET kolonne-løb blokerer rytteren fra `column` (det overlappende løb han
// allerede er i)? Returnerer kolonnen {id, name, ...} eller null. Bruges af popover/pulje til
// at sige HVORFOR en rytter er optaget — ikke bare at han er det.
export function overlapConflictColumn({ column, columns = [], bindingMap, riderId }) {
  if (!column) return null;
  const entries = bindingMap?.[riderId];
  if (!entries || !entries.length) return null;
  const hit = entries.find((e) => e.id !== column.id && windowsOverlap(e.window, column.bindingWindow));
  if (!hit) return null;
  return columns.find((c) => c.id === hit.id) || { id: hit.id, name: null };
}

// #1984: klassificér en rytters forhold til ét kolonne-løb i dag. Driver tilgængeligheds-UI'et:
//   "riding"    — allerede udtaget i løbet
//   "locked"    — løbet er afmeldt/startet (kan ikke ændres)
//   "overlap"   — blokeret fordi rytteren er i et tids-overlappende løb
//   "available" — kan tilføjes
export function riderColumnState({ column, bindingMap, riderId }) {
  if (!column) return "locked";
  if ((column.selection?.rider_ids || []).includes(riderId)) return "riding";
  if (column.withdrawn || column.lineup_locked) return "locked";
  if (isRiderBound({ bindingMap, riderId, forRaceId: column.id, forWindow: column.bindingWindow })) return "overlap";
  return "available";
}

// #1984/#1983: alle ægte overlap-konflikter i kladden — en rytter udtaget i to løb hvis game-dag-
// vinduer overlapper. Driver den NAVNGIVNE gem-fejl (i stedet for backendens opake kode) + en
// proaktiv advarsel. Returnerer [{ riderId, raceIds:[a,b], raceNames:[a,b] }] (afmeldte løb tæller ikke).
export function findSelectionOverlaps({ columns = [] }) {
  const out = [];
  const active = columns.filter((c) => c && !c.withdrawn);
  for (let i = 0; i < active.length; i++) {
    for (let j = i + 1; j < active.length; j++) {
      const a = active[i], b = active[j];
      if (!windowsOverlap(a.bindingWindow, b.bindingWindow)) continue;
      const setB = new Set(b.selection?.rider_ids || []);
      for (const id of a.selection?.rider_ids || []) {
        if (setB.has(id)) out.push({ riderId: id, raceIds: [a.id, b.id], raceNames: [a.name, b.name] });
      }
    }
  }
  return out;
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

// #1925 + kronologi-rebuild: kladde-bevidst binding. Pr. rytter: de IKKE-afmeldte kolonne-løb
// han er i kladden, MED hvert løbs in-game-dag-vindue, så isRiderBound kun binder mod løb hvis
// game-dage faktisk overlapper (samme IRL-dag ≠ binding når game-dagene er forskellige).
// Erstatter den stale server-bindingMap i popover/pulje, så live-redigeringer afspejles straks.
export function draftBindingMap(columns = []) {
  const map = {};
  for (const c of columns) {
    if (c.withdrawn) continue;
    for (const id of c.selection?.rider_ids || []) (map[id] ||= []).push({ id: c.id, window: c.bindingWindow ?? null });
  }
  return map;
}
