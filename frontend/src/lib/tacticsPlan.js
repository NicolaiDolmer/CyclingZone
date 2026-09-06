// Taktik-ordrer v1 (race engine v4, #4030/#4246) — rene, testbare afledninger til
// TacticsCard.jsx. Ingen IO her (ingen fetch/Date.now uden parameter); adapteren
// (tacticsOrdersAdapter.js) leverer data, denne fil regner ren logik på dem.
//
// Ordre-kontrakten (SSOT: backend/lib/engine/v4/ai/teamOrderContract.ts):
//   TeamOrder = { team_id, breakaway_stance: "chase"|"neutral"|"let_go",
//                 riders: [{ rider_id, effort, try_break, leadout }] }
//
// ROLLEN ER STANDARDORDREN (ejer 2/9, #4246). Kortet er dagens overlay oven på
// den. Rolle-til-ordre-tabellen står IKKE her: serveren sender standardordren
// med i GET-svaret (`default_order`), regnet af motorens egen kontrakt. Sådan
// findes tabellen ét sted i stedet for at blive en femte kopi.

export const BREAKAWAY_STANCES = ["chase", "neutral", "let_go"];

// #4632: fald tilbage på de tre oprindelige trin når serveren ikke har sendt
// sit vokabular (den femtrins-intention er bag eget flag).
export const DEFAULT_EFFORT_KEYS = ["protect", "normal", "save"];

// T4 (spec): fraværende ordre for en rytter = neutrale defaults.
export function defaultRiderOrder(riderId) {
  return { rider_id: riderId, effort: "normal", try_break: false, leadout: false };
}

export function defaultTeamOrder(riderIds = []) {
  return { team_id: null, breakaway_stance: "neutral", riders: riderIds.map(defaultRiderOrder) };
}

/**
 * Standardordren for én rytter, som serveren regnede den ud af rollen.
 * Ukendt rytter (fx netop udtaget) falder til den neutrale ordre.
 */
export function roleDefaultFor(defaultOrder, riderId) {
  const hit = (defaultOrder?.riders || []).find((r) => r.rider_id === riderId);
  return hit ? { ...defaultRiderOrder(riderId), ...hit } : defaultRiderOrder(riderId);
}

// Ryttere kan være tilføjet/fjernet i lineupet siden ordrerne sidst blev gemt —
// round-trip kun dem der stadig er i truppen, og lad rytteren falde tilbage på
// ROLLENS standard (ikke en tom neutral ordre) når han ikke er nævnt i dagens
// gemte række. Præcis samme regel som motorens adapter (applyStageOverlayToOrder).
export function mergeOrderWithRoster(order, riderIds = [], defaultOrder = null) {
  const known = new Map((order?.riders || []).map((r) => [r.rider_id, r]));
  return {
    team_id: order?.team_id ?? null,
    breakaway_stance: order?.breakaway_stance ?? defaultOrder?.breakaway_stance ?? "neutral",
    riders: riderIds.map((id) => {
      const base = roleDefaultFor(defaultOrder, id);
      const saved = known.get(id);
      return saved ? { ...base, ...saved } : base;
    }),
  };
}

// i18n-nøglen for stance-teksten ("let_go" → "letGo", resten uændret).
export function stanceI18nKey(stance) {
  return stance === "let_go" ? "letGo" : stance;
}

export function effortCounts(riders = [], keys = DEFAULT_EFFORT_KEYS) {
  const counts = Object.fromEntries(keys.map((k) => [k, 0]));
  for (const r of riders) {
    if (counts[r.effort] != null) counts[r.effort] += 1;
  }
  return counts;
}

export function setRiderEffort(order, riderId, effort) {
  return { ...order, riders: order.riders.map((r) => (r.rider_id === riderId ? { ...r, effort } : r)) };
}

export function toggleTryBreak(order, riderId) {
  return { ...order, riders: order.riders.map((r) => (r.rider_id === riderId ? { ...r, try_break: !r.try_break } : r)) };
}

export function toggleLeadout(order, riderId) {
  return { ...order, riders: order.riders.map((r) => (r.rider_id === riderId ? { ...r, leadout: !r.leadout } : r)) };
}

export function setBreakawayStance(order, stance) {
  return { ...order, breakaway_stance: stance };
}

export function isOrderLocked(locksAt, now = Date.now()) {
  if (!locksAt) return false;
  const t = new Date(locksAt).getTime();
  return Number.isFinite(t) && now >= t;
}

// Team plan er afledt tekst i v1 (spec §UI-anatomi), ikke et input. captainName
// kan være null (endnu ingen kaptajn valgt i lineupet ovenfor).
export function teamPlanKey(stance, captainName) {
  if (!captainName) return { key: "tacticsOrders.plan.noCaptain", params: {} };
  return { key: `tacticsOrders.plan.${stanceI18nKey(stance)}`, params: { captain: captainName } };
}

/**
 * "Standard: jæger. I dag: bliv i feltet" (#4246, ejer 2/9).
 *
 * Returnerer i18n-nøgler, aldrig færdig tekst — kaldstedet oversætter.
 * `today` er en LISTE af afvigelser fra rollens standard; er den tom, kører
 * rytteren sin rolle (RACE_ENGINE_RULES §1b: "ikke valgt" vises som netop det).
 *
 * Fog of war: kun ord for det valgte, aldrig hvad valget er værd.
 */
export function riderIntentKeys(riderOrder, defaultRiderOrderForRider, role) {
  const base = defaultRiderOrderForRider ?? defaultRiderOrder(riderOrder?.rider_id);
  const today = [];
  if ((riderOrder?.try_break ?? false) !== (base.try_break ?? false)) {
    today.push(riderOrder.try_break ? "tryBreak" : "stayInBunch");
  }
  if ((riderOrder?.leadout ?? false) !== (base.leadout ?? false)) {
    today.push(riderOrder.leadout ? "joinTrain" : "leaveTrain");
  }
  if ((riderOrder?.effort ?? "normal") !== (base.effort ?? "normal")) {
    today.push(`effort.${riderOrder.effort}`);
  }
  return {
    roleKey: `tacticsOrders.roleDefault.${role || "free_role"}`,
    todayKeys: today.map((k) => `tacticsOrders.today.${k}`),
  };
}

/** Holdet kan kun sætte et sprint-tog når det har en spurt-kaptajn på etapen. */
export function hasSprintCaptain(riders = []) {
  return riders.some((r) => r.role === "sprint_captain");
}
