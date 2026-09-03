// backend/scripts/lib/headToHeadOrders.js
// Race Engine v4 F3 (#4615): realistiske hold-roller + TeamOrders til
// head-to-head-harnessen.
// SSOT: docs/RACE_ENGINE_RULES.md §1 (rolle-vokabularet, fem vaerdier) +
//   docs/superpowers/specs/2026-08-21-race-tactics-orders-v1-design.md
//   (ordre-kontrakten T1-T4).
//
// HVORFOR (fund fra F3-workerne 2/9, #4606/#4609/#4610): harnessen gav ALLE
// ryttere `free_role` og en TOM ordre-liste. M6 (lead-out) og M14 (AI-taktik)
// var derfor maalbart doed kode i scorecardet — ikke fordi mekanikkerne
// manglede, men fordi intet input nogensinde aktiverede dem. Uden roller og
// ordrer kan de tre ankre der forudsaetter holdtaktik (felt-favoritters
// win-rate, felt-sammenhaeng, udbruds-rater) hverken bekraeftes eller afvises.
//
// AI-holdenes ordrer genereres gennem M14's egen `generateAiTeamOrder` —
// PRAECIS samme kontrakt som spillerne indsender (mor-spec addendum 22: ingen
// side-kanaler). Harnessen opfinder altsaa ikke sin egen taktik-model; den
// koerer den der skal i produktion.
//
// #4246-AFGRAENSNING (bevidst): rolle-vs-ordre-modsigelsen (`hunter` vs
// `try_break`, `sprint_captain` vs `leadout_for`) er ejer-gated og afgoeres
// IKKE her. Denne fil saetter begge flader som specen beskriver dem — rollen
// fra holdudtagelsen, ordren fra taktik-kortet — og lader dem staa side om
// side. Naar #4246 er afgjort, er det `assignTeamRoles`/`buildTeamOrders` der
// skal baere afgoerelsen: enten skal rollen udlede ordrens default (rollen
// ejer intentionen), eller ordren skal overskrive rollen for etapen.
//
// 100% REN: ingen IO, ingen DB, ingen rng, ingen Date. Samme roster + samme
// rute giver altid samme roller og samme ordrer.

import { generateAiTeamOrder } from "../../lib/engine/v4/ai/aiTactics.ts";
import { isMassFinishRoute } from "../../lib/engine/v4/finale.ts";
import { TEAM_TACTICS_ORDER_KIND } from "../../lib/engine/v4/mechanics/breakaway.ts";

/** Rolle-vokabularet, RACE_ENGINE_RULES.md §1. Fem vaerdier, ikke til forhandling. */
export const RACE_ROLES = Object.freeze(["captain", "sprint_captain", "helper", "hunter", "free_role"]);

// Hvor stort et sprint-tog et hold saetter op naar dagen er en massefinale.
// Samme stoerrelsesorden som LEADOUT_EXTRA_TUNING.fullTrainSize — flere ryttere
// giver aftagende marginalnytte, saa der er ingen grund til at binde hele holdet.
const LEADOUT_TRAIN_SIZE = 3;

// Et hold skal have et minimum af ryttere paa etapen foer en rollefordeling
// giver mening; derunder er alle fri rolle (samme aand som T4's neutrale
// default: ingen opdigtet struktur hvor der ikke er en).
const MIN_TEAM_SIZE_FOR_ROLES = 3;

function ability(rider, key) {
  const v = Number(rider?.abilities?.[key]);
  return Number.isFinite(v) ? Math.max(0, Math.min(99, v)) : 0;
}

/** Deterministisk sortering: vaerdi faldende, rider_id som taerskel. Ingen rng. */
function bestBy(riders, score) {
  return [...riders].sort((a, b) => score(b) - score(a) || String(a.id).localeCompare(String(b.id)));
}

/**
 * Grupperer et startfelt pr. hold. Ryttere uden team_id samles under null-
 * noeglen og faar fri rolle (de hoerer ikke til en holdplan).
 * @param {Array<{id:string, team_id?:string|null, abilities:Record<string,number>}>} riders
 * @returns {Map<string|null, Array<object>>}
 */
export function groupByTeam(riders) {
  const byTeam = new Map();
  for (const rider of riders) {
    const teamId = rider.team_id ?? null;
    if (!byTeam.has(teamId)) byTeam.set(teamId, []);
    byTeam.get(teamId).push(rider);
  }
  // Deterministisk holdorden (Map bevarer indsaettelsesorden = feltets orden;
  // sorteres eksplicit saa output ikke afhaenger af rytter-raekkefolgen).
  return new Map([...byTeam.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));
}

/**
 * Tildeler ÉT holds ryttere roller efter deres egne evner — samme afvejning en
 * sportsdirektoer laver naar holdet udtages: bedste klatrer er kaptajn, bedste
 * sprinter er sprint-kaptajn, den mest aggressive af resten jager udbrud, et
 * par arbejder for kaptajnen, resten koerer frit.
 *
 * Rollerne er dagsUAFHAENGIGE (holdudtagelsen sker foer etapen kendes) —
 * dagens terraen paavirker ORDREN, ikke rollen. Det er den arbejdsdeling
 * tactics-specens T1/T4 beskriver, og den er bevidst holdt intakt her fordi
 * #4246 endnu ikke har afgjort hvem der vinder naar de to er uenige.
 *
 * @param {Array<object>} teamRiders
 * @returns {Map<string, string>} rider_id -> race_role
 */
export function assignTeamRoles(teamRiders) {
  const roles = new Map();
  if (teamRiders.length < MIN_TEAM_SIZE_FOR_ROLES) {
    for (const rider of teamRiders) roles.set(rider.id, "free_role");
    return roles;
  }

  const remaining = new Set(teamRiders.map((r) => r.id));
  const pick = (score) => {
    const pool = teamRiders.filter((r) => remaining.has(r.id));
    if (pool.length === 0) return null;
    const chosen = bestBy(pool, score)[0];
    remaining.delete(chosen.id);
    return chosen;
  };

  const captain = pick((r) => ability(r, "climbing"));
  if (captain) roles.set(captain.id, "captain");

  const sprintCaptain = pick((r) => ability(r, "sprint"));
  if (sprintCaptain) roles.set(sprintCaptain.id, "sprint_captain");

  const hunter = pick((r) => ability(r, "aggression"));
  if (hunter) roles.set(hunter.id, "hunter");

  // Halvdelen af de resterende arbejder for kaptajnen (de bedste tempo-
  // motorer), resten koerer frit. En hjaelper er ikke en straf — det er den
  // rolle et rigtigt hold giver sine motorer.
  const rest = bestBy(
    teamRiders.filter((r) => remaining.has(r.id)),
    (r) => ability(r, "tempo") + ability(r, "endurance"),
  );
  const helperCount = Math.ceil(rest.length / 2);
  rest.forEach((rider, index) => roles.set(rider.id, index < helperCount ? "helper" : "free_role"));
  return roles;
}

/**
 * Roller for HELE startfeltet.
 * @param {Array<object>} riders  population.riders-format (id, team_id, abilities)
 * @returns {Map<string, string>} rider_id -> race_role
 */
export function assignFieldRoles(riders) {
  const roles = new Map();
  for (const [teamId, teamRiders] of groupByTeam(riders)) {
    if (teamId === null) {
      for (const rider of teamRiders) roles.set(rider.id, "free_role");
      continue;
    }
    for (const [riderId, role] of assignTeamRoles(teamRiders)) roles.set(riderId, role);
  }
  return roles;
}

/**
 * Sprint-tog for ÉT hold (M6): holdets sprint-kaptajn plus de bedste
 * positioning/tempo/acceleration-motorer blandt de oevrige. Returnerer null
 * naar holdet ikke har en sprint-kaptajn paa etapen eller ikke kan stille et
 * tog — et hold uden sprinter saetter ikke et tog op, og et tomt tog giver
 * (per M6's egen kontrakt) ingen bonus overhovedet.
 */
export function buildLeadoutOrder(teamId, teamRiders, roles) {
  const captain = teamRiders.find((r) => roles.get(r.id) === "sprint_captain");
  if (!captain) return null;
  const train = bestBy(
    teamRiders.filter((r) => r.id !== captain.id),
    (r) => ability(r, "positioning") + ability(r, "tempo") + ability(r, "acceleration"),
  ).slice(0, LEADOUT_TRAIN_SIZE);
  if (train.length === 0) return null;
  return {
    team_id: teamId,
    kind: "leadout",
    params: { captain_rider_id: captain.id, leadout_rider_ids: train.map((r) => r.id) },
  };
}

/**
 * Bygger hele etapens `StageInput.orders` for et startfelt.
 *
 * Pr. hold:
 *  - ÉN `team_tactics`-ordre (M5/M12): AI-taktikkens egen beslutning om
 *    breakaway_stance + effort + try_break pr. rytter, genereret af M14's
 *    `generateAiTeamOrder` gennem den frosne kontrakt.
 *  - Paa massefinale-etaper desuden ÉN `leadout`-ordre (M6), hvis holdet har
 *    en sprint-kaptajn med mindst én mand til at koere for sig. Paa selektive
 *    etaper saetter ingen et sprint-tog op.
 *
 * @returns {{orders: Array<object>, roles: Map<string,string>, effect: object}}
 */
export function buildStageTeamOrders({ riders, route }) {
  const roles = assignFieldRoles(riders);
  const massFinish = isMassFinishRoute(route);
  const orders = [];
  const effect = {
    teams: 0,
    stance: { chase: 0, neutral: 0, let_go: 0 },
    tryBreakRiders: 0,
    effort: { protect: 0, normal: 0, save: 0 },
    leadoutTrains: 0,
    leadoutRiders: 0,
    massFinish,
  };

  for (const [teamId, teamRiders] of groupByTeam(riders)) {
    if (teamId === null) continue; // hold-loese ryttere har ingen holdplan
    effect.teams += 1;

    const decision = generateAiTeamOrder({
      team_id: teamId,
      route: { profile_type: route.profile_type, finale_type: route.finale_type ?? null },
      roster: teamRiders.map((rider) => ({
        rider_id: rider.id,
        role: roles.get(rider.id) ?? "free_role",
        abilities: rider.abilities,
      })),
    });

    effect.stance[decision.order.breakaway_stance] += 1;
    for (const rider of decision.order.riders) {
      if (rider.try_break) effect.tryBreakRiders += 1;
      effect.effort[rider.effort] += 1;
    }

    orders.push({
      team_id: teamId,
      kind: TEAM_TACTICS_ORDER_KIND,
      params: { breakaway_stance: decision.order.breakaway_stance, riders: decision.order.riders },
    });

    if (massFinish) {
      const leadout = buildLeadoutOrder(teamId, teamRiders, roles);
      if (leadout) {
        orders.push(leadout);
        effect.leadoutTrains += 1;
        effect.leadoutRiders += leadout.params.leadout_rider_ids.length;
      }
    }
  }

  return { orders, roles, effect };
}

/** Summerer per-etape-effekter til ét koerselstal (til harnessens rapport). */
export function sumOrderEffects(effects) {
  const total = {
    stages: 0,
    teams: 0,
    stance: { chase: 0, neutral: 0, let_go: 0 },
    tryBreakRiders: 0,
    effort: { protect: 0, normal: 0, save: 0 },
    leadoutTrains: 0,
    leadoutRiders: 0,
    massFinishStages: 0,
  };
  for (const effect of effects) {
    total.stages += 1;
    total.teams += effect.teams;
    for (const key of Object.keys(total.stance)) total.stance[key] += effect.stance[key];
    for (const key of Object.keys(total.effort)) total.effort[key] += effect.effort[key];
    total.tryBreakRiders += effect.tryBreakRiders;
    total.leadoutTrains += effect.leadoutTrains;
    total.leadoutRiders += effect.leadoutRiders;
    if (effect.massFinish) total.massFinishStages += 1;
  }
  return total;
}

/** Laesbar effekt-rapport (harnessens stdout — kvalitativ, ingen motor-interne vaegte). */
export function formatOrderEffect(total) {
  const lines = [];
  lines.push("-- Hold-ordrer (M5/M6/M14) --");
  lines.push(`Etaper med ordrer: ${total.stages} (heraf massefinaler: ${total.massFinishStages})`);
  lines.push(`Hold-ordrer i alt: ${total.teams}`);
  lines.push(
    `Udbruds-stance: chase ${total.stance.chase} · neutral ${total.stance.neutral} · let_go ${total.stance.let_go}`,
  );
  lines.push(`Ryttere med "try the break": ${total.tryBreakRiders}`);
  lines.push(
    `Effort: protect ${total.effort.protect} · normal ${total.effort.normal} · save ${total.effort.save}`,
  );
  lines.push(`Sprint-tog: ${total.leadoutTrains} (${total.leadoutRiders} leadout-ryttere)`);
  return lines.join("\n");
}
