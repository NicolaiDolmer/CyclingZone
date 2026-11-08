// #6110 Udvikling 2.0: potentiale vist som ét skønnet tal + et sikkerhedsord.
//
// Spec: docs/superpowers/specs/2026-10-23-6110-potentiale-et-tal-samlet-design.md §3.
// Ren funktion uden I/O. Byggetrin 1 lagde kernen (bruges af harnessen,
// backend/scripts/dev/potentialEstimateHarness6110.mjs); byggetrin 3 lægger
// resten af lib'en: validering af kalibreringen, kombineret viden, monotoni-værn,
// gemt skøn pr. (rytter, hold) (§3.3) og den offentlige visning (gate H4).
// Ingen spillerflade læser den endnu, og den ændrer intet i spillet: kaldere
// kommer i byggetrin 4/5 bag slukket flag.
//
// Adfærd (spec §3.2): skønnet er det sande loft plus en afvigelse, der skrumper
// med viden. Afvigelsen har en fælles del pr. rytter, en del pr. (rytter, hold)
// og en del pr. vidensniveau. Usikkerheden går aldrig under params.minU, så
// selv et sikkert skøn kan ramme lidt ved siden af (ejer 23/10).
//
// Konstruktion, vægte og alle tal er PRIVATE (hard rule 17, balance-internals/6110/)
// og gives som `params`. Der er bevidst ingen standardværdier.

import { seededUnitMixed } from "./riderProgression.js";

export const CERTAINTY_WORDS = Object.freeze(["unsure", "fair", "sure"]);

// Hvorfor skønnet skrives (§3.3). Samme værdier som CHECK-constrainten i
// database/2026-11-04-6110-potential-estimates.sql.
export const WRITE_REASONS = Object.freeze(["new_knowledge", "sunday", "team_change", "backfill"]);

// Skjulte talent-kolonner på riders (byggetrin 2). Backend kører service_role og
// omgår kolonne-privilegierne, så enhver rute, der selecter `*` på riders, skal
// fjerne dem, før svaret forlader serveren (samme klasse som potentiale, #1162).
export const HIDDEN_RIDER_TALENT_COLUMNS = Object.freeze(["base_talent", "talent_ceiling"]);

export function stripHiddenTalent(row) {
  if (!row || typeof row !== "object") return row;
  const safe = { ...row };
  for (const col of HIDDEN_RIDER_TALENT_COLUMNS) delete safe[col];
  return safe;
}

// ---------------------------------------------------------------------------
// Kalibreringen: strukturel validering og monotoni
// ---------------------------------------------------------------------------

const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const nonIncreasing = (arr) => arr.every((v, i) => i === 0 || v <= arr[i - 1]);

// Tjekker at et params-sæt kan bruges, og at det giver monotoni (H3) pr. konstruktion:
// flere kig, bedre scout og flere afregnede datoer kan aldrig gøre usikkerheden
// større. Kaster en Error med alle fund; returnerer params uændret ved succes.
// Vægtene skal tilsammen give en standard-normal afvigelse før klip, så
// usikkerheden betyder det samme på tværs af kalibreringer.
export function validateParams(params) {
  const p = params || {};
  const errors = [];
  const need = (cond, msg) => { if (!cond) errors.push(msg); };

  need(typeof p.salt === "string" && p.salt.length > 0, "salt must be a non-empty string");
  const w = p.weights || {};
  need(["shared", "pair", "level"].every((k) => isNum(w[k]) && w[k] >= 0), "weights.shared/pair/level must be numbers >= 0");
  if (["shared", "pair", "level"].every((k) => isNum(w[k]))) {
    const sq = w.shared ** 2 + w.pair ** 2 + w.level ** 2;
    need(Math.abs(sq - 1) <= 0.01, "weights must have a sum of squares of 1 (standard-normal deviation before clipping)");
    need(w.level > 0, "weights.level must be > 0 (inversion guard, spec 3.2)");
    need(w.shared > 0, "weights.shared must be > 0 (pooling across teams may only help a little)");
  }
  need(isNum(p.clip) && p.clip > 0, "clip must be > 0");
  need(isNum(p.minU) && p.minU > 0, "minU must be > 0 (a confident estimate can still be slightly off)");

  const words = p.words || {};
  need(isNum(words.sureAtOrBelow) && isNum(words.fairAtOrBelow) && words.sureAtOrBelow > 0
    && words.sureAtOrBelow < words.fairAtOrBelow, "words: 0 < sureAtOrBelow < fairAtOrBelow");

  const s = p.scout || {};
  need(Number.isInteger(s.maxLooks) && s.maxLooks >= 1, "scout.maxLooks must be an integer >= 1");
  need(Number.isInteger(s.defaultTier) && s.defaultTier >= 1 && s.defaultTier <= 5, "scout.defaultTier must be 1-5");
  need(Array.isArray(s.uByLooks) && s.uByLooks.length >= (s.maxLooks || 1) && s.uByLooks.every((v) => isNum(v) && v > 0),
    "scout.uByLooks needs a positive number per look up to maxLooks");
  need(Array.isArray(s.uByLooks) && nonIncreasing(s.uByLooks), "scout.uByLooks must never increase with more looks (H3)");
  need(Array.isArray(s.tierFactor) && s.tierFactor.length === 5 && s.tierFactor.every((v) => isNum(v) && v > 0),
    "scout.tierFactor needs 5 positive numbers");
  need(Array.isArray(s.tierFactor) && nonIncreasing(s.tierFactor), "scout.tierFactor must never increase with a better scout (H3)");
  if (s.minUByTier != null) {
    need(Array.isArray(s.minUByTier) && s.minUByTier.length === 5 && s.minUByTier.every((v) => isNum(v) && v > 0),
      "scout.minUByTier needs 5 positive numbers");
    need(Array.isArray(s.minUByTier) && nonIncreasing(s.minUByTier), "scout.minUByTier must never increase with a better scout (H3)");
  }

  const o = p.own || {};
  need(isNum(o.firstEstimateDates) && o.firstEstimateDates >= 0, "own.firstEstimateDates must be >= 0");
  need(isNum(o.staffSpeedWeight) && o.staffSpeedWeight >= 0, "own.staffSpeedWeight must be >= 0");
  const steps = Array.isArray(o.steps) ? o.steps : [];
  need(steps.length > 0 && steps.every((st) => isNum(st?.fromDates) && isNum(st?.u) && st.u > 0),
    "own.steps must be a non-empty list of { fromDates, u > 0 }");
  need(steps.every((st, i) => i === 0 || st.fromDates > steps[i - 1].fromDates), "own.steps.fromDates must be strictly increasing");
  need(nonIncreasing(steps.map((st) => st.u)), "own.steps.u must never increase with more settled dates (H3)");

  if (errors.length) throw new Error(`potentialEstimate: invalid params: ${errors.join("; ")}`);
  return params;
}

// ---------------------------------------------------------------------------
// Seed: afvigelsen
// ---------------------------------------------------------------------------

// Standard-normalfordelt tal fra to seeded uniforme tal (Box-Muller).
function seededNormal(key) {
  const u1 = Math.max(seededUnitMixed(`${key}:a`), 1e-12);
  const u2 = seededUnitMixed(`${key}:b`);
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

// Afvigelsen for ét vidensniveau, klippet til ±clip.
export function deviation(riderId, teamId, levelKey, params) {
  const shared = seededNormal(`pot-est:${params.salt}:${riderId}`);
  const pair = seededNormal(`pot-est:${params.salt}:${riderId}:${teamId}`);
  const perLevel = seededNormal(`pot-est:${params.salt}:${riderId}:${teamId}:${levelKey}`);
  const { shared: ws, pair: wp, level: wl } = params.weights;
  const z = ws * shared + wp * pair + wl * perLevel;
  return Math.max(-params.clip, Math.min(params.clip, z));
}

// ---------------------------------------------------------------------------
// Usikkerhed: holdets viden
// ---------------------------------------------------------------------------

// Vidensniveau fra egne træninger (egen rytter). null under grænsen for første skøn.
function ownLevel(k, params) {
  const dates = Math.max(0, Number(k.trainingDates) || 0);
  if (dates < params.own.firstEstimateDates) return null;
  const effective = dates * (1 + Math.max(0, Number(k.staffSpeed) || 0) * params.own.staffSpeedWeight);
  const steps = params.own.steps; // [{ fromDates, u }] stigende fromDates
  let idx = 0;
  steps.forEach((s, i) => { if (effective >= s.fromDates) idx = i; });
  return { key: `own${idx}`, u: Math.max(params.minU, steps[idx].u) };
}

// Vidensniveau fra kig (scouting). null uden kig.
function scoutLevel(k, params) {
  const looks = Math.min(Math.max(0, Number(k.looks) || 0), params.scout.maxLooks);
  if (looks <= 0) return null;
  const tier = Math.min(5, Math.max(1, Number(k.bestScoutTier) || params.scout.defaultTier));
  const u = params.scout.uByLooks[looks - 1] * params.scout.tierFactor[tier - 1];
  // K2 (ejer 23/10): scoutens niveau sætter loftet for sikkerheden. En svag scout
  // kan aldrig bringe usikkerheden ned i "Sikker", uanset antal kig.
  const tierFloor = params.scout.minUByTier?.[tier - 1] ?? params.minU;
  return { key: `s${looks}t${tier}`, u: Math.max(params.minU, tierFloor, u) };
}

// Usikkerhed (halv-spredning i ratingpoint) og nøglen for vidensniveauet.
// Returnerer null, når holdet intet ved (fremmed rytter uden kig, eller egen
// ungdomsrytter under grænsen for første skøn og uden kig): så vises intet tal.
//
// knowledge:
//   own                 true for holdets egen rytter
//   trainingDates       antal rigtige datoer med afregnet træning på holdet (S18)
//   staffSpeed          >= 0, hvor meget træner/facilitet fremskynder egen viden
//   looks               antal kig (scout-niveau, capped af params)
//   bestScoutTier       scoutens niveau ved det bedste kig (1-5), null = standardscout
//
// En egen rytter, som holdet scoutede, før han kom til holdet, beholder den viden
// (§3.3 holdskifte: "med den viden holdet havde i forvejen"). Den bedste kilde
// (mindste usikkerhed) vinder, så egne træninger aldrig gør skønnet mindre sikkert.
export function knowledgeLevel(knowledge, params) {
  const k = knowledge || {};
  const scout = scoutLevel(k, params);
  if (!k.own) return scout;
  const own = ownLevel(k, params);
  if (!own) return scout;
  if (!scout) return own;
  return scout.u < own.u ? scout : own;
}

export function uncertaintyFor(knowledge, params) {
  return knowledgeLevel(knowledge, params)?.u ?? null;
}

export function certaintyWord(u, params) {
  if (u == null) return null;
  if (u <= params.words.sureAtOrBelow) return "sure";
  if (u <= params.words.fairAtOrBelow) return "fair";
  return "unsure";
}

// ---------------------------------------------------------------------------
// Skønnet
// ---------------------------------------------------------------------------

function ratingFloor(currentRating) {
  return Math.max(1, Math.round(Number(currentRating) || 1));
}

function valueFor({ truePot, riderId, teamId, level }, params) {
  const z = deviation(riderId, teamId, level.key, params);
  return Math.max(1, Math.min(99, Math.round(Number(truePot) + z * level.u)));
}

// Det tal spilleren ser.
//   truePot        rytterens sande loft i ratingskala (1-99)
//   currentRating  rytterens nuværende rating; skønnet vises aldrig under den
// Returnerer { hidden: true } eller { hidden: false, value, u, certainty }.
export function estimatePotential({ truePot, currentRating, riderId, teamId, knowledge }, params) {
  const level = knowledgeLevel(knowledge, params);
  if (!level) return { hidden: true };
  const raw = valueFor({ truePot, riderId, teamId, level }, params);
  const value = Math.max(ratingFloor(currentRating), raw);
  return { hidden: false, value, u: level.u, certainty: certaintyWord(level.u, params) };
}

// ---------------------------------------------------------------------------
// Gemt skøn pr. (rytter, hold) (§3.3) - rækken i rider_potential_estimates
// ---------------------------------------------------------------------------

function storedLevel(stored) {
  if (!stored || stored.knowledge_key == null || stored.uncertainty == null) return null;
  const u = Number(stored.uncertainty);
  return Number.isFinite(u) ? { key: String(stored.knowledge_key), u } : null;
}

// Monotoni-værnet (H3): holdets viden om en rytter kan kun vokse. Falder den
// beregnede viden (fx en dårligere facilitet sænker stab-farten), holdes det
// gemte vidensniveau, så ordet aldrig bliver mindre sikkert. Kun et niveau med
// STRENGT mindre usikkerhed afløser det gemte: et skift mellem to kilder med samme
// usikkerhed (fx egne træninger falder tilbage til et lige så godt kig, fordi
// stab-farten faldt) er ikke ny viden og må ikke flytte tallet (H2). Det lukker
// også for at samle flere aflæsninger på samme sikkerhed op og midle dem (H6).
export function monotoneLevel(stored, next) {
  const prev = storedLevel(stored);
  if (!prev) return next;
  if (!next) return prev;
  return next.u < prev.u ? next : prev;
}

// Afgør om skønnet for (rytter, hold) skal skrives, og hvilken række der skrives.
//
// input:
//   stored         eksisterende række for (rytter, hold) eller null
//   truePot        sande loft nu (1-99)
//   riderId, teamId, knowledge   som estimatePotential
//   trigger        én af WRITE_REASONS
//   paramsVersion  kalibreringens version (gemmes, så en ny kalibrering kan spores)
//   now            ISO-tidsstempel for skrivningen
//
// Returnerer:
//   { action: "none" }               holdet ved intet, og der er intet gemt
//   { action: "keep", reason }       tallet står stille (H2)
//   { action: "write", row, changed }  rækken der upsertes på (rider_id, team_id)
//
// Regler (§3.3): uden ny viden og med uændret sandt loft står tallet stille.
//   new_knowledge  skriv når vidensniveauet er nyt (et kig, en bedre scout)
//   sunday         skriv ved nyt vidensniveau (flere afregnede datoer) eller flyttet loft
//   team_change    det nye hold får sit eget skøn (eget seed) med den viden det havde
//   backfill       skriv kun hvor intet er gemt; overskriver aldrig
// Kun søndagskørslen og holdskiftet må flytte tallet, fordi det sande loft har
// flyttet sig; et nyt kig læser altid det sande loft, som det er nu.
//
// Nuværende rating anvendes IKKE her: gulvet lægges på ved visning
// (publicEstimateView), så det gemte tal ikke skal skrives om, hver gang
// rytteren bliver bedre.
export function planEstimateWrite(input, params) {
  const { stored = null, truePot, riderId, teamId, knowledge, trigger, paramsVersion, now } = input || {};
  if (!WRITE_REASONS.includes(trigger)) throw new Error(`planEstimateWrite: unknown trigger ${trigger}`);
  if (typeof paramsVersion !== "string" || !paramsVersion) throw new Error("planEstimateWrite: paramsVersion is required");
  if (typeof now !== "string" || !now) throw new Error("planEstimateWrite: now (ISO timestamp) is required");
  const ceiling = Math.round(Number(truePot));
  if (!Number.isFinite(ceiling) || ceiling < 1 || ceiling > 99) throw new Error("planEstimateWrite: truePot must be 1-99");

  const level = monotoneLevel(stored, knowledgeLevel(knowledge, params));
  if (!level) return { action: "none" };

  if (stored) {
    if (trigger === "backfill") return { action: "keep", reason: "already_stored" };
    const sameLevel = String(stored.knowledge_key) === level.key;
    const sameCeiling = Number(stored.ceiling_at_write) === ceiling;
    if (trigger === "new_knowledge" && sameLevel) return { action: "keep", reason: "no_new_knowledge" };
    if ((trigger === "sunday" || trigger === "team_change") && sameLevel && sameCeiling) {
      return { action: "keep", reason: "unchanged" };
    }
  }

  const value = valueFor({ truePot: ceiling, riderId, teamId, level }, params);
  const certainty = certaintyWord(level.u, params);
  const changed = !!stored && (Number(stored.value) !== value || stored.certainty !== certainty);
  const row = {
    rider_id: riderId,
    team_id: teamId,
    value,
    certainty,
    uncertainty: level.u,
    knowledge_key: level.key,
    ceiling_at_write: ceiling,
    params_version: paramsVersion,
    write_reason: trigger,
    previous_value: changed ? Number(stored.value) : (stored?.previous_value ?? null),
    previous_certainty: changed ? stored.certainty : (stored?.previous_certainty ?? null),
    changed_at: changed ? now : (stored?.changed_at ?? null),
    computed_at: now,
  };
  return { action: "write", row, changed };
}

// Det eneste der må forlade serveren (gate H4): tal + ord og "ændret siden sidst"
// for holdets eget skøn. Aldrig usikkerheden, vidensniveauet eller loftet bag.
// Skønnet vises aldrig under rytterens nuværende rating (§3.2).
export function publicEstimateView(row, { currentRating } = {}) {
  if (!row || row.value == null || !CERTAINTY_WORDS.includes(row.certainty)) return { hidden: true };
  const floor = ratingFloor(currentRating);
  const value = Math.max(floor, Number(row.value));
  // Codex P2: "ændret siden sidst" skal sammenligne de VISTE tal. Skjuler gulvet
  // ændringen (fx 60 → 61 under en rating på 64), har spilleren set det samme tal
  // begge gange, og der må ikke opfindes en ændring.
  const previousShown = row.previous_value == null ? null : Math.max(floor, Number(row.previous_value));
  const certaintyChanged = row.previous_certainty != null && row.previous_certainty !== row.certainty;
  const visibleChange = previousShown != null && (previousShown !== value || certaintyChanged);
  return {
    hidden: false,
    value,
    certainty: row.certainty,
    previousValue: visibleChange ? previousShown : null,
    previousCertainty: visibleChange ? (row.previous_certainty ?? null) : null,
    changedAt: visibleChange ? (row.changed_at ?? null) : null,
  };
}
