// backend/lib/raceCalendarLanePacker.js
// Kalender-rebuild (2026-06-27, prestige/spredning-spec + ejer-billede): pak en divisions valgte
// løb ind i et `density`-baner × `days` gitter, så HVER dag fyldes til PRÆCIS density stage-events
// (= "5/4/3/2 løbsdage kørt om dagen"), uden tomme dage og uden droppede løb.
//
// Form (ejer-godkendt billede 2026-06-27):
//   - Grand Tours (≥ spineMinStages) er RYGRAD: komprimeret over (density-1) baner/dag (lader 1
//     bane fri til overlap), spredt jævnt så de IKKE overlapper hinanden, men mindre løb +
//     klassikere kører samtidig undervejs.
//   - Øvrige etapeløb: adaptiv komprimering (mindst muligt baner → mest spredning/overlap, men nok
//     til at passe i et frit vindue). 1 etape/bane/dag pr. bane løbet bruger.
//   - Klassikere (inkl. monumenter) fylder hver resterende celle → hver dag rammer præcis density.
//
// Binding nøgler på game_day (raceBinding.js). game_day = real_day for almindelige løb. MONUMENTER
// er binding-fri: game_day i et højt bånd (overlapper aldrig andre løb), men afvikles på delt
// IRL-dato og optager en dag-plads. Hver etape får en `lane` → mapper til et fast tids-slot.
// REN + deterministisk (ingen DB/Date/random).

export const MONUMENT_GAMEDAY_BASE = 100000;

export function packLaneCalendar({ stageRaces = [], oneDayRaces = [], density = 1, days = 28, spineMinStages = 15, gtReserveLanes = 1 } = {}) {
  const D = Math.max(0, density);
  const grid = Array.from({ length: days }, () => new Array(D).fill(null));
  const free = (day, lane) => day >= 0 && day < days && lane >= 0 && lane < D && grid[day][lane] === null;
  const placements = [];
  const unplaced = [];
  const lenOf = (r) => Math.max(1, Number(r.stages) || 1);

  const freeLanesOn = (day) => {
    const out = [];
    for (let l = 0; l < D; l++) if (grid[day][l] === null) out.push(l);
    return out;
  };

  // Forsøg at placere et løb dag-for-dag fra `start`: hver dag tages op til `maxPerDay` ledige baner
  // (≥1, ellers hul → mislykkes), indtil alle etaper er lagt. Fleksibelt (ikke stift rektangel), så
  // det fylder fragmenteret plads omkring Grand Tours. Returnerer cells eller null.
  function tryFlexible(stages, start, maxPerDay) {
    const cells = [];
    let s = 0;
    for (let day = start; s < stages; day++) {
      if (day >= days) return null;
      const avail = freeLanesOn(day);
      if (avail.length === 0) return null; // hul i etapeløbet ikke tilladt
      const take = Math.min(maxPerDay, avail.length, stages - s);
      for (let i = 0; i < take; i++) { cells.push({ day, lane: avail[i], stage_number: s + 1 }); s++; }
    }
    return cells;
  }

  // Søg en placering nær `prefStart` (spredt). maxPerDayList prøves i rækkefølge: lav cap først
  // (mest spredning/overlap), højere cap kun hvis det ikke kan passe (komprimér for at få plads).
  function place(race, prefStart, maxPerDayList) {
    const S = lenOf(race);
    for (const maxPerDay of maxPerDayList) {
      const span = Math.ceil(S / maxPerDay);
      const clamped = Math.max(0, Math.min(prefStart, days - span));
      for (let off = 0; off < days; off++) {
        for (const start of off === 0 ? [clamped] : [clamped + off, clamped - off]) {
          if (start < 0 || start >= days) continue;
          const cells = tryFlexible(S, start, maxPerDay);
          if (cells) {
            for (const c of cells) grid[c.day][c.lane] = race.id;
            placements.push({ id: race.id, type: "stage_race", race_class: race.race_class ?? null, stages: S, startRealDay: start, stagesPlaced: cells.map((c) => ({ stage_number: c.stage_number, real_day: c.day, game_day: c.day, lane: c.lane })) });
            return true;
          }
        }
      }
    }
    return false;
  }

  // 1) Grand Tours (rygrad): spredt, komprimeret over density-1 baner/dag (1 bane fri til overlap).
  const gtLanes = Math.max(1, D - gtReserveLanes);
  const gts = stageRaces.filter((r) => lenOf(r) >= spineMinStages).sort((a, b) => (lenOf(b) - lenOf(a)) || String(a.id).localeCompare(String(b.id)));
  const others = stageRaces.filter((r) => lenOf(r) < spineMinStages).sort((a, b) => (lenOf(b) - lenOf(a)) || String(a.id).localeCompare(String(b.id)));
  gts.forEach((gt, k) => {
    const span = Math.ceil(lenOf(gt) / gtLanes);
    const pref = Math.round(((k + 0.5) * days) / Math.max(1, gts.length)) - Math.floor(span / 2);
    if (!place(gt, pref, [gtLanes])) unplaced.push(gt.id);
  });

  // 2) Øvrige etapeløb: prøv 1 etape/dag (mest spredning) først, ellers komprimér gradvist op til density.
  others.forEach((race, k) => {
    const pref = Math.round(((k + 0.5) * days) / Math.max(1, others.length));
    if (!place(race, pref, Array.from({ length: D }, (_, i) => i + 1))) unplaced.push(race.id);
  });

  // 3) Klassikere (monumenter spredt) fylder hver resterende celle → præcis density/dag.
  const freeCells = [];
  for (let d = 0; d < days; d++) for (let l = 0; l < D; l++) if (free(d, l)) freeCells.push({ day: d, lane: l });
  const monuments = oneDayRaces.filter((r) => r.race_class === "Monuments");
  const regular = oneDayRaces.filter((r) => r.race_class !== "Monuments");
  const assign = new Array(freeCells.length).fill(null);
  const monStep = monuments.length ? freeCells.length / monuments.length : 0;
  monuments.forEach((m, i) => {
    let idx = Math.min(freeCells.length - 1, Math.floor(i * monStep + monStep / 2));
    while (idx < freeCells.length && assign[idx]) idx++;
    if (idx >= freeCells.length) idx = assign.findIndex((x) => !x);
    if (idx >= 0) assign[idx] = m;
  });
  let ri = 0;
  for (let i = 0; i < freeCells.length; i++) { if (assign[i] || ri >= regular.length) continue; assign[i] = regular[ri++]; }
  let monCounter = 0;
  for (let i = 0; i < freeCells.length; i++) {
    const r = assign[i];
    if (!r) continue;
    const c = freeCells[i];
    grid[c.day][c.lane] = r.id;
    const isMon = r.race_class === "Monuments";
    const game_day = isMon ? MONUMENT_GAMEDAY_BASE + monCounter++ : c.day;
    placements.push({ id: r.id, type: "single", race_class: r.race_class ?? null, stages: 1, startRealDay: c.day, stagesPlaced: [{ stage_number: 1, real_day: c.day, game_day, lane: c.lane }] });
  }
  const placedSingleIds = new Set(placements.filter((p) => p.type === "single").map((p) => p.id));
  const leftoverSingles = oneDayRaces.filter((r) => !placedSingleIds.has(r.id)).map((r) => r.id);

  const load = grid.map((col) => col.filter((x) => x !== null).length);
  // Antal forskellige løb pr. dag (overlap-mål).
  const racesPerDay = grid.map((col) => new Set(col.filter((x) => x !== null)).size);

  return {
    placements, load, racesPerDay, days, density: D,
    emptyDays: load.filter((x) => x === 0).length,
    underfilledDays: load.filter((x) => x < D).length,
    overlapDays: racesPerDay.filter((n) => n >= 2).length,
    unplaced, leftoverSingles,
  };
}
