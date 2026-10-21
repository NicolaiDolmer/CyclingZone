// #6804 P0 (ejer 21/10, beslutning 1 A): testportens syntetiske felt faar menneskeholdenes
// udbrudsvilje som i prod.
//
// Problemet: kaptajn, sprint-kaptajn og hjaelper forsoeger kun morgenudbruddet med en ordre
// (ejer 10/10, valg B). Det syntetiske felt (tilmeldingsgeneratoren eller bench-feltet) har
// ingen hunters og ingen holdordrer for menneskeholdene, saa et felt med mest menneskehold
// (D1, Grand Tours) danner naesten intet udbrud. I prod saetter menneskeholdene selv
// jaeger-roller og "Forsoeg udbrud".
//
// Reglen: satserne laeses READ-ONLY fra seneste afsluttede saeson (senior): pr. division og
// loebsgruppe (gt, stage_race, one_day) hvor mange hunters og frie roller et menneskehold
// stiller pr. loeb, og hvor mange "Forsoeg udbrud" det giver pr. vejetape (enkeltstarter og
// holdtidskoersler taelles ikke med, hverken i taeller eller naevner). Hvor lille en celle maa
// vaere foer gruppens samlede sats bruges, er en privat kalibrering (hard rule 17): den staar i
// satsfilen (`minCellTeamStages`), aldrig i koden. Hvert menneskehold i
// et syntetisk felt faar saa det forventede antal, deterministisk (hash af loeb, hold, etape):
//   - hunter/free_role: holdets hjaelpere med hoejest udbruds-score (aggression + udholdenhed)
//     faar rollen, aldrig kaptajn eller sprint-kaptajn.
//   - "Forsoeg udbrud": en ordre-raekke (race_team_orders-formen) med try_break for holdets
//     bedste hjaelper paa dagens terraen (aggression + terraenets evne, som M14's udbruds-score).
//     Et hold der allerede har en raekke for etapen roeres ikke.
// AI-hold roeres aldrig (M14 vaelger selv). Ingen tilfaeldighed uden for hashen; samme input
// giver samme felt. REN: ingen I/O.
import { createHash } from "node:crypto";

export const INTENT_MODES = Object.freeze(["prod", "none"]);
export const RATES_FORMAT = "cz-breakaway-intent-rates/v2";
const TIME_TRIALS = new Set(["itt", "itt_hilly", "ttt"]);

const clampAbility = (v) => Math.max(0, Math.min(99, Number(v) || 0));

/** Loebsgruppe ud fra antal etaper: endagsloeb, etapeloeb (2-14) eller Grand Tour (15+). */
export function raceGroupOf(stages) {
  const n = Number(stages) || 1;
  return n <= 1 ? "one_day" : n >= 15 ? "gt" : "stage_race";
}

/** Dagens primaere evne for en udbryder (spejler M14: aiTactics classifyTerrainDemand + attackKey). */
export function breakawayAbilityFor(profile) {
  const pt = profile?.profile_type;
  const ft = profile?.finale_type;
  if (ft === "punch" || ft === "wall_finish") return "punch";
  if (ft === "flat_sprint" || ft === "uphill_sprint") return "tempo";
  if (pt === "mountain" || pt === "high_mountain" || ft === "long_climb") return "climbing";
  if (pt === "cobbles" || pt === "gravel") return "cobblestone";
  return "tempo";
}

/** Deterministisk tal i [0, 1) fra en noegle. */
export function unitHash(key) {
  return parseInt(createHash("sha256").update(String(key)).digest("hex").slice(0, 12), 16) / 2 ** 48;
}

/** Forventet antal (fx 0.58) -> heltal: gulvet + 1 hvis hashen er under broekdelen. */
export function draws(rate, key) {
  const r = Math.max(0, Number(rate) || 0);
  const base = Math.floor(r);
  return base + (unitHash(key) < r - base ? 1 : 0);
}

/**
 * Prod-raekker -> satser. `races` [{id, league_division_id, stages}], `entries`
 * [{race_id, team_id, race_role}], `teams` [{id, is_ai}], `orders` [{race_id, team_id,
 * stage_number, riders}], `profiles` [{race_id, stage_number, profile_type}] (til at skille
 * vejetaper fra tidskoersler). Kun menneskehold taeller. Celler pr. division og gruppe, plus
 * gruppens samlede (division "all"). `minCellTeamStages` er den private graense (se ovenfor).
 */
export function aggregateIntentRates({ races, entries, teams, orders, profiles = [], minCellTeamStages, seasonId = null, generatedAt = null }) {
  if (!Number.isFinite(minCellTeamStages) || minCellTeamStages < 0) throw new Error("aggregateIntentRates: minCellTeamStages (privat graense) skal vaere et tal >= 0");
  const ai = new Map(teams.map((t) => [t.id, t.is_ai === true]));
  const raceById = new Map(races.map((r) => [r.id, r]));
  const ttStages = new Set(profiles.filter((p) => TIME_TRIALS.has(p.profile_type)).map((p) => `${p.race_id}|${p.stage_number}`));
  const roadStagesOf = (race) => {
    const n = Math.max(1, Number(race.stages) || 1);
    let tt = 0;
    for (let i = 1; i <= n; i++) if (ttStages.has(`${race.id}|${i}`)) tt += 1;
    return n - tt;
  };
  const cells = new Map();
  const cell = (division, group) => {
    const k = `${division}|${group}`;
    if (!cells.has(k)) cells.set(k, { division, group, humanTeamRaces: 0, humanTeamRoadStages: 0, hunters: 0, freeRoles: 0, tryBreakRiders: 0 });
    return cells.get(k);
  };
  const both = (race, fn) => {
    const g = raceGroupOf(race.stages);
    fn(cell(String(race.league_division_id ?? "?"), g));
    fn(cell("all", g));
  };
  const teamRaces = new Map();
  for (const e of entries) {
    const race = raceById.get(e.race_id);
    if (!race || ai.get(e.team_id) !== false) continue;
    const k = `${e.race_id}|${e.team_id}`;
    if (!teamRaces.has(k)) teamRaces.set(k, { race, hunters: 0, freeRoles: 0 });
    const tr = teamRaces.get(k);
    if (e.race_role === "hunter") tr.hunters += 1;
    if (e.race_role === "free_role") tr.freeRoles += 1;
  }
  for (const { race, hunters, freeRoles } of teamRaces.values()) {
    both(race, (c) => {
      c.humanTeamRaces += 1;
      c.humanTeamRoadStages += roadStagesOf(race);
      c.hunters += hunters;
      c.freeRoles += freeRoles;
    });
  }
  for (const o of orders) {
    const race = raceById.get(o.race_id);
    if (!race || !teamRaces.has(`${o.race_id}|${o.team_id}`) || ttStages.has(`${o.race_id}|${o.stage_number}`)) continue;
    const n = (Array.isArray(o.riders) ? o.riders : []).filter((r) => r && r.try_break === true).length;
    if (n) both(race, (c) => { c.tryBreakRiders += n; });
  }
  const rows = [...cells.values()].sort((a, b) => a.group.localeCompare(b.group) || a.division.localeCompare(b.division, "en", { numeric: true }));
  return { format: RATES_FORMAT, seasonId, generatedAt, minCellTeamStages, rows };
}

/**
 * Kort signatur af satserne (cache-genbrug: andre satser = anden koersel). Graensen for
 * smaa celler er med, fordi den aendrer hvilken celle et loeb faar.
 */
export function ratesSignature(rates) {
  return createHash("sha256").update(JSON.stringify({ rows: rates?.rows ?? [], minCellTeamStages: rates?.minCellTeamStages ?? null })).digest("hex").slice(0, 16);
}

/** Valider en satsfil (fail-closed). */
export function validateRates(rates) {
  if (!rates || rates.format !== RATES_FORMAT || !Array.isArray(rates.rows)) throw new Error(`udbrudsvilje-satser: format skal vaere "${RATES_FORMAT}" med rows`);
  if (!Number.isFinite(rates.minCellTeamStages) || rates.minCellTeamStages < 0) throw new Error("udbrudsvilje-satser: minCellTeamStages mangler");
  return rates;
}

/** Satserne for et loeb: divisionens celle, eller gruppens samlede naar cellen er for lille. */
export function ratesFor(rates, division, stages) {
  const group = raceGroupOf(stages);
  const find = (d) => rates.rows.find((r) => r.division === d && r.group === group);
  const own = find(String(division ?? "?"));
  const c = own && own.humanTeamRoadStages >= rates.minCellTeamStages ? own : find("all");
  if (!c || !(c.humanTeamRaces > 0)) return { group, source: "none", hunterPerRace: 0, freeRolePerRace: 0, tryBreakPerStage: 0 };
  return {
    group,
    source: c === own ? `division ${c.division}` : "alle divisioner",
    hunterPerRace: c.hunters / c.humanTeamRaces,
    freeRolePerRace: c.freeRoles / c.humanTeamRaces,
    tryBreakPerStage: c.humanTeamRoadStages > 0 ? c.tryBreakRiders / c.humanTeamRoadStages : 0,
  };
}

/**
 * Laeg prod-lignende udbrudsvilje paa et syntetisk felt. `data` er cache-formen
 * {race, profiles, entries, orders, teams, abilities}. Returnerer {data, summary}; input
 * muteres ikke.
 */
export function applyBreakawayIntent(data, rates) {
  const r = ratesFor(rates, data.race?.league_division_id, data.race?.stages ?? data.profiles?.length);
  const ai = new Set((data.teams ?? []).filter((t) => t.is_ai === true).map((t) => t.id));
  const ab = new Map((data.abilities ?? []).map((a) => [a.rider_id, a]));
  const raceId = data.race?.id ?? "?";
  const entries = (data.entries ?? []).map((e) => ({ ...e }));
  const byTeam = new Map();
  for (const e of entries) {
    if (e.team_id == null || ai.has(e.team_id)) continue;
    if (!byTeam.has(e.team_id)) byTeam.set(e.team_id, []);
    byTeam.get(e.team_id).push(e);
  }
  const teamIds = [...byTeam.keys()].sort();
  const summary = { group: r.group, source: r.source, humanTeams: teamIds.length, hunters: 0, freeRoles: 0, tryBreakOrders: 0 };
  const helpersBy = (list, score) => list
    .filter((e) => e.race_role === "helper")
    .map((e) => ({ e, s: score(ab.get(e.rider_id) ?? {}) }))
    .sort((a, b) => b.s - a.s || a.e.rider_id.localeCompare(b.e.rider_id))
    .map((x) => x.e);
  const raceScore = (a) => clampAbility(a.aggression) + clampAbility(a.endurance);
  for (const teamId of teamIds) {
    const nHunters = draws(r.hunterPerRace, `${raceId}|${teamId}|hunter`);
    const nFree = draws(r.freeRolePerRace, `${raceId}|${teamId}|free`);
    const pick = helpersBy(byTeam.get(teamId), raceScore);
    for (const e of pick.slice(0, nHunters)) { e.race_role = "hunter"; summary.hunters += 1; }
    for (const e of pick.slice(nHunters, nHunters + nFree)) { e.race_role = "free_role"; summary.freeRoles += 1; }
  }
  const existing = new Set((data.orders ?? []).map((o) => `${o.team_id}|${o.stage_number}`));
  const orders = [...(data.orders ?? [])];
  for (const profile of [...(data.profiles ?? [])].sort((a, b) => a.stage_number - b.stage_number)) {
    if (TIME_TRIALS.has(profile.profile_type)) continue;
    const key = breakawayAbilityFor(profile);
    const stageScore = (a) => clampAbility(a.aggression) + clampAbility(a[key]);
    for (const teamId of teamIds) {
      if (existing.has(`${teamId}|${profile.stage_number}`)) continue;
      const n = draws(r.tryBreakPerStage, `${raceId}|${teamId}|${profile.stage_number}|try_break`);
      if (!n) continue;
      const chosen = helpersBy(byTeam.get(teamId), stageScore).slice(0, n);
      if (!chosen.length) continue;
      orders.push({
        team_id: teamId, race_id: raceId, stage_number: profile.stage_number, breakaway_stance: null,
        riders: chosen.map((e) => ({ rider_id: e.rider_id, try_break: true })),
      });
      summary.tryBreakOrders += chosen.length;
    }
  }
  return { data: { ...data, entries, orders }, summary };
}
