// backend/lib/raceDistribution.js
// Race Hub Fase 1: ren læse-logik for trup-fordeling-board'et. Kolonne-sæt
// (dagens egne-pulje overlap-løb), binding-map (hvilke kolonne-løb en rytter
// allerede er bundet i) og season-dag-projektion til tidslinjen. Pure — ingen DB.
import { windowsOverlap, teamInRacePool } from "./raceBinding.js";

const DAY_MS = 86_400_000;

// Løb der bliver kolonner: status scheduled, holdets egen pulje (eller pulje-løs),
// og tidsvindue overlapper den valgte dag. `races` = [{id, league_division_id, status, window}].
export function buildColumnSet({ races = [], teamDivisionId, dayWindow }) {
  if (!dayWindow) return [];
  return races.filter(
    (r) =>
      r.status === "scheduled" &&
      r.window &&
      teamInRacePool({ teamDivisionId, racePoolId: r.league_division_id }) &&
      windowsOverlap(r.window, dayWindow)
  );
}

// For hver rytter: de kolonne-løb han er udtaget i, der overlapper MINDST ét andet
// kolonne-løb (dvs. binder ham væk fra det andet). `columns` = [{id, window, riderIds}].
// #3041: `riderIds` pr. kolonne skal allerede være FILTRERET af kalderen til kun de
// bindende entries — manuelle valg + entries i et løb der er gået i gang (frys, #1825).
// Et auto-udtaget pick i et løb der IKKE er startet må ALDRIG stå her: det viger
// automatisk ved gem (#2637), og skal derfor heller ikke gråne rytteren i UI'et.
export function buildBindingMap({ columns = [], withdrawnIds } = {}) {
  // Rod A (#1823): afmeldte kolonne-løb binder ikke — deres ryttere er frie til de
  // overlappende løb. Filtrér dem ud før overlap-beregningen.
  const withdrawn = withdrawnIds instanceof Set ? withdrawnIds : new Set(withdrawnIds || []);
  const active = columns.filter((c) => !withdrawn.has(c.id));
  const map = {};
  for (const col of active) {
    const overlapsAnother = active.some((o) => o.id !== col.id && windowsOverlap(col.window, o.window));
    if (!overlapsAnother) continue;
    for (const rid of col.riderIds || []) {
      if (!map[rid]) map[rid] = [];
      if (!map[rid].includes(col.id)) map[rid].push(col.id);
    }
  }
  return map;
}

// #2256: eksterne bindings — holdets committede entries i løb UDEN FOR dagens kolonner,
// så brættet kan gråne en rytter der er optaget i et løb på en anden dag/pulje (buildBindingMap
// ser kun kolonnerne). Shape matcher frontendens bindingMap-entries ({ id, window }) + name til
// "optaget i <løbsnavn>". Afmeldte løb binder ikke (Rod A, #1823); løb uden binding-vindue kan
// ikke binde. #3041: `entries` skal allerede være FILTRERET af kalderen til kun bindende
// entries (manuelle + entries i startede løb) — se buildBindingMap ovenfor for samme kontrakt.
// Pure — ingen DB.
export function buildExternalBindings({ entries = [], columnIds, withdrawnIds, windowByRace, nameByRace } = {}) {
  const cols = columnIds instanceof Set ? columnIds : new Set(columnIds || []);
  const withdrawn = withdrawnIds instanceof Set ? withdrawnIds : new Set(withdrawnIds || []);
  const map = {};
  for (const e of entries) {
    if (cols.has(e.race_id) || withdrawn.has(e.race_id)) continue;
    const window = windowByRace?.get(e.race_id);
    if (!window) continue;
    (map[e.rider_id] ||= []).push({ id: e.race_id, name: nameByRace?.get(e.race_id) ?? null, window });
  }
  return map;
}

// Tidslinje-projektion: sæsonens dage med dato-tekst + terræn-glyf-nøgle + om holdet har
// et løb. `dayProfiles` = Map<day, { dateText, terrain, hasMyRace }>. Manglende dag → tom
// standard. #3107: totalDays kommer ALTID fra sæsonens faktiske kalenderdage (28 i S2) —
// den gamle `= 60`-default var en gætte-værdi der lækkede ud i UI'et ("60 løbsdage" på
// forsiden, #1774). Uden et gyldigt tal er den ærlige projektion tom, ikke opdigtet.
export function seasonDayProjection({ totalDays, currentDay, dayProfiles = new Map() }) {
  if (!Number.isFinite(totalDays) || totalDays < 1) return { totalDays: 0, currentDay: currentDay ?? null, days: [] };
  const days = [];
  for (let day = 1; day <= totalDays; day++) {
    const p = dayProfiles.get(day) || {};
    days.push({ day, dateText: p.dateText ?? null, terrain: p.terrain ?? null, hasMyRace: !!p.hasMyRace });
  }
  return { totalDays, currentDay: currentDay ?? null, days };
}

// Terræn-glyf for en dag: flertals-profil blandt dagens etaper; lige fordeling → "mixed".
export function dominantTerrain(profileTypes = []) {
  if (!profileTypes.length) return null;
  const counts = new Map();
  for (const t of profileTypes) counts.set(t, (counts.get(t) || 0) + 1);
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]);
  if (sorted.length > 1 && sorted[0][1] === sorted[1][1]) return "mixed";
  return sorted[0][0];
}

// ALLE committede entries (manuelle OG auto-filled) i ANDRE løb end de der regenereres
// → lockedWindows til assignTeamAcrossRaces, så regenerering ikke dobbeltbooker en rytter
// holdet allerede er forpligtet med et overlappende sted. `excludeRaceIds` = de løb der
// regenereres (deres ryttere skal jo netop gen-tildeles, så de udelades).
//
// #1823 1b: tidligere låste vi KUN manuelle entries (`is_auto_filled === false`). Det
// efterlod et hul: en auto-filled rytter i et ikke-regenereret men tidsoverlappende løb
// (typisk et multi-dag-etapeløb der rækker ind i nabodagen) blev ikke låst → dobbeltbooking.
// Vi låser nu alle committede entries. Genbruges også til dual-mode "missing": de manuelt-
// udtagne kolonner holdes ude af regenererings-target og låses dermed her.
// Vælg hvilke af dagens kolonne-løb der skal regenereres (#1823 dual-mode + #1825 frys).
// `target` = de løb assistenten genudfylder; `skipped` = antal sprunget over af frys/manuel.
// Afmeldte løb tæller IKKE som skipped (de er bevidst ude). Igangværende (stages_completed>0)
// fryses ALTID; manuelt-udtagne springes kun over i mode=missing (og låses andetsteds).
// Pure + deterministisk.
export function partitionRegenTargets({ cols = [], withdrawnIds, manualRaceIds, mode = "missing" }) {
  const withdrawn = withdrawnIds instanceof Set ? withdrawnIds : new Set(withdrawnIds || []);
  const manual = manualRaceIds instanceof Set ? manualRaceIds : new Set(manualRaceIds || []);
  const target = [];
  let skipped = 0;
  for (const r of cols) {
    if (withdrawn.has(r.id)) continue;
    if ((r.stages_completed ?? 0) > 0) { skipped += 1; continue; } // frys (#1825)
    if (mode === "missing" && manual.has(r.id)) { skipped += 1; continue; }
    target.push(r);
  }
  return { target, skipped };
}

// #2599: "Ryd dag"/"Ryd alt" — target-partition for den eksplicitte, bekræftede
// ryd-handling. Simplere end partitionRegenTargets: ingen manual/mode-skelnen, for en
// bekræftet ryd-handling fjerner ALT for de valgte løb, inkl. manuelt udtagne (det er
// netop pointen — spilleren har lige bekræftet det i en dialog). Eneste hårde guard er
// frys (#1825): et igangværende etapeløb må ALDRIG røres, uanset hvad brugeren klikker.
// Afmeldte løb rydder vi også (harmløst — de har typisk ingen entries alligevel).
// Pure + deterministisk.
export function partitionClearTargets({ cols = [] }) {
  const target = [];
  let skipped = 0;
  for (const r of cols) {
    if ((r.stages_completed ?? 0) > 0) { skipped += 1; continue; } // frys (#1825)
    target.push(r);
  }
  return { target, skipped };
}

// #3061: konsekvens-forhåndsvisning til "Clear all"-dialogen. Genbruger SAMME frys-guard
// som selve ryd-handlingen (partitionClearTargets) — hvad dialogen viser SKAL matche hvad
// der faktisk cleares, ellers lyver den. Filtrerer derefter til reelt KOMMENDE løb: et løb
// uden schedule-data eller allerede forbi sit starttidspunkt kan ikke få en ærlig nedtælling
// (#3061-krav: "nedtællingen skal være sand, brug løbets faktiske starttidspunkt") og tælles
// derfor ikke med i "N races" — dialogen skal aldrig overdrive konsekvensen. Sorteret efter
// starttidspunkt (nærmeste først, så listen læses som en tidslinje). Pure + deterministisk.
export function buildClearPreview({ cols = [], windowByRace = new Map(), nowMs = Date.now() }) {
  const { target } = partitionClearTargets({ cols });
  const races = target
    .map((r) => ({ id: r.id, name: r.name, startAt: windowByRace.get(r.id)?.start ?? null }))
    .filter((r) => Number.isFinite(r.startAt) && r.startAt > nowMs)
    .sort((a, b) => a.startAt - b.startAt);
  return { races };
}

// #3041: hvilke af en kolonnes rider_ids skal FODRES ind i buildBindingMap som bindende?
// Rod-årsag: bindingMap brugte hidtil ALLE entries (auto+manuelt) i en kolonne, så et
// auto-udtaget pick i et endnu-ikke-startet løb låste rytteren for et andet overlappende
// løb — selvom picket vige automatisk ved gem (#2637, "assistentens forslag vinder aldrig
// over et manuelt valg"). Kun MANUELLE entries binder; er løbet allerede i gang (frys,
// #1825) er der intet at frigive, og da binder ALT (auto som manuelt). Pure.
export function columnBindingRiderIds({ selection, startedHere }) {
  if (!selection) return [];
  return startedHere ? (selection.rider_ids || []) : (selection.manual_rider_ids || []);
}

// #3041: samme regel for eksterne bindings (entries i løb UDEN FOR dagens kolonner) —
// en auto-udtaget entry i et løb der ikke er startet endnu binder ikke; manuelle entries
// og entries i startede løb (stages_completed>0) binder altid. `startedRaceIds` = Set af
// race_id'er hvor stages_completed>0. Pure.
export function filterBindingEntries({ entries = [], startedRaceIds } = {}) {
  const started = startedRaceIds instanceof Set ? startedRaceIds : new Set(startedRaceIds || []);
  return entries.filter((e) => !e.is_auto_filled || started.has(e.race_id));
}

export function lockedWindowsFromEntries({ entries = [], windowByRace, excludeRaceIds = new Set() }) {
  const ridersByRace = new Map();
  for (const e of entries) {
    if (excludeRaceIds.has(e.race_id)) continue;
    if (!ridersByRace.has(e.race_id)) ridersByRace.set(e.race_id, []);
    ridersByRace.get(e.race_id).push(e.rider_id);
  }
  const locks = [];
  for (const [raceId, riderIds] of ridersByRace) {
    const window = windowByRace.get(raceId);
    if (window) locks.push({ window, riderIds });
  }
  return locks;
}

// Race Hub Fase 5 (#1835 / S6): read-only "andre divisioner"-browse.
// Bruttotrupper (PCS-style startlister) for en FREMMED pulje — strippet for roller,
// form, træthed og egnethed, og tidsgated til et kort vindue frem (default 7 dage),
// så man kan scoute forventede deltagere uden at læse modstanderens fulde taktik.
export const STARTLIST_HORIZON_DAYS = 7;

// Er et løbs startliste synlig endnu? Synlig når løbet starter inden for horisonten
// (default 7 dage) fra nu. Løb længere ude er låst (kun navn + nedtælling vises) —
// så man ikke kan se modstandernes fulde sæsonplan, kun det nært forestående.
export function startListVisible({ startMs, nowMs, horizonDays = STARTLIST_HORIZON_DAYS }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return false;
  return startMs <= nowMs + horizonDays * DAY_MS;
}

// Hele dage til løbsstart (afrundet op). 0/negativ → løbet er i gang/i dag. Pure.
export function daysUntilStart({ startMs, nowMs }) {
  if (!Number.isFinite(startMs) || !Number.isFinite(nowMs)) return null;
  return Math.ceil((startMs - nowMs) / DAY_MS);
}

// Strippet bruttotrup-projektion pr. hold for ÉT løb. Tager RÅ entries (kun
// {team_id, rider_id}) + opslag og returnerer [{ team, riders }] UDEN race_role,
// form, træthed, egnethed eller andre felter (#1835: kun startliste = hvem stiller op).
// Ryttere uden opslag eller entries uden hold springes over. Deterministisk: hold
// sorteret efter navn, ryttere efter efternavn+fornavn.
export function groupGrossSquads({ entries = [], ridersById = new Map(), teamsById = new Map() }) {
  const byTeam = new Map();
  for (const e of entries) {
    if (e.team_id == null) continue;
    const r = ridersById.get(e.rider_id);
    if (!r) continue;
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
    byTeam.get(e.team_id).push({
      id: r.id,
      firstname: r.firstname ?? null,
      lastname: r.lastname ?? null,
      nationality_code: r.nationality_code ?? null,
    });
  }
  const out = [];
  for (const [teamId, riders] of byTeam) {
    const team = teamsById.get(teamId) || null;
    riders.sort(
      (a, b) =>
        String(a.lastname ?? "").localeCompare(String(b.lastname ?? "")) ||
        String(a.firstname ?? "").localeCompare(String(b.firstname ?? ""))
    );
    out.push({ team: { id: team?.id ?? teamId, name: team?.name ?? null }, riders });
  }
  out.sort((a, b) => String(a.team.name ?? "").localeCompare(String(b.team.name ?? "")));
  return out;
}

// #4245: LØBSDAGE pr. løb = antal DISTINKTE game_day i løbets schedule-rækker
// (race_stage_schedule.game_day), ikke etape-antallet. To etaper på samme løbsdag
// er ÉN løbsdag for rytteren (docs/CALENDAR_RULES.md §0: game_day er den in-game
// akse der binder rytteren, og den kan aldrig udledes af scheduled_at).
//
// BELASTNING ER IKKE BINDING — de to tal er bevidst forskellige:
//   · BINDING bruger hele SPÆNDET min(game_day)..max(game_day). Det er ejer-direktiv
//     25/8 (#4217, docs/CALENDAR_RULES.md §2b + §8): er du udtaget til et etapeløb,
//     er du bundet indtil det er slut, også hen over springene. Se raceBinding.js.
//   · BELASTNING (dette tal) er de løbsdage rytteren FAKTISK kører på. Springene i
//     et løbs game_day-serie er ikke hviledage — en løbsdag er et halvdags-slot, og
//     slot-tælleren løber videre for de øvrige løb i puljen imens (CALENDAR_RULES
//     §2b). La Corsa dei Due Mari kører 7 etaper på løbsdag 10, 13, 17, 20, 23, 27,
//     28: 7 løbsdages belastning, men et bundet spænd på 19.
// Derfor: distinkte værdier, ALDRIG spændet (end-start+1, jf. raceGameDaySpan) — det
// ville måle bindingen og kalde den belastning.
//
// `scheduleRows` = [{race_id, game_day}]. `stagesByRaceId` (valgfri) = Map<race_id,
// stages>: FÆLLES fallback for løb uden brugbare game_day-rækker, så alle flader der
// viser løbsdage falder ens tilbage (#4245 rework: Race Hub faldt til 1, planner-
// boardet til etapetal — et delvist backfillet etapeløb viste derfor 1 dag på den ene
// skærm og 8 på den anden). Etapetallet er det ærlige estimat: efter akse-reparationen
// (#4161) får hver etape sin egen løbsdag. Mindst 1. Pure, ingen DB.
export function raceDaysByRace(scheduleRows = [], { stagesByRaceId } = {}) {
  const daysByRace = new Map();
  for (const row of scheduleRows) {
    if (!Number.isFinite(row?.game_day)) continue;
    if (!daysByRace.has(row.race_id)) daysByRace.set(row.race_id, new Set());
    daysByRace.get(row.race_id).add(row.game_day);
  }
  const out = new Map([...daysByRace].map(([id, set]) => [id, set.size]));
  if (stagesByRaceId) {
    for (const [raceId, stages] of stagesByRaceId) {
      if (out.has(raceId)) continue;
      const n = Number(stages);
      out.set(raceId, Number.isFinite(n) && n > 0 ? Math.trunc(n) : 1);
    }
  }
  return out;
}

// #2772/#4245: sæson-belastning pr. rytter: antal løb + antal LØBSDAGE rytteren er
// tilmeldt henover sæsonen, auto-fyldte entries inklusive (rytteren stiller til start
// uanset hvem der satte ham på listen). `entries` skal ALLEREDE være eligibility-
// krydset af kalderen (loadEligibleEntries: ghosts/udlånte/pensionerede tæller ikke,
// #1906).
//
// `seasonRaceIds` (Set) er PÅKRÆVET af enhver flade hvis copy siger "denne sæson".
// race_entries er ikke sæson-scopet i sig selv, så uden filteret tæller entries fra
// TIDLIGERE sæsoner med: målt i prod 27/8 var 69.115 af 94.712 entries gamle, 2.367
// af 4.854 ryttere fik en oppustet chip (snit 14,4 løb vist mod 5,3 sande), værst
// 56 løb vist for en rytter med 0 i den aktive sæson (#4245 rework).
//
// Fallback: et løb uden game_day-rækker tæller som mindst ÉN løbsdag, derfor `|| 1`
// og ikke `?? 1` — en 0-værdi ville slippe igennem og skjule belastnings-chippen
// tavst pga. `load.raceDays > 0`-gaten i AvailableRidersPool. Det ægte fallback-valg
// (etapetal) sker ÉT sted, i raceDaysByRace's `stagesByRaceId`; `|| 1` her er kun
// sidste værn. Pure.
export function seasonLoadByRider({ entries = [], raceDaysByRaceId = new Map(), seasonRaceIds } = {}) {
  const inSeason = seasonRaceIds instanceof Set ? seasonRaceIds : null;
  const out = {};
  for (const e of entries) {
    if (inSeason && !inSeason.has(e.race_id)) continue;
    const cur = out[e.rider_id] || { races: 0, raceDays: 0 };
    cur.races += 1;
    cur.raceDays += raceDaysByRaceId.get(e.race_id) || 1;
    out[e.rider_id] = cur;
  }
  return out;
}
