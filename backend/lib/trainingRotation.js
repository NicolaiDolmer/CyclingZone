// #8548 · Rotation: programmet som pas 1..N i fast raekkefoelge, der venter ved
// hvile og loeb og fortsaetter hvor det slap (spillerforslag 1/11, #7456).
// Design: docs/audits/undersoegelse-docs-8548-rotation-design.md (PR #8557), ejer-svar 21/11 paa #8548.
//
// RENE funktioner, ingen DB og intet flag. Bruges af API'et (PR 1) og senere af
// motoren og prognosen (PR 2), saa de tre altid regner ens (invariant I5).
//
// ═══ DATAFORMEN (v1) ═════════════════════════════════════════════════════════
// training_week_plans.rotation og training_groups.rotation (jsonb, NULL = ingen):
//   {
//     v: 1,
//     passes: [{ session, effort? }, ...]   2..35 pas i fast raekkefoelge
//     rev: n                                stiger ved HVER gemning (pas eller anker)
//     anchor: { rev, index, fromRev? }      hvor rotationen starter for denne rev
//   }
// Hvilken regel planen koerer, staar IKKE i rotationen: kolonnen plan_kind
// ('week' | 'rotation', NULL = dagens felt-plan) er den ene markoer (ejer-afstemning
// med #8549). Rotationen bliver liggende, naar spilleren skifter til Week blocks,
// saa et skift tilbage fortsaetter hvor den slap.
//
// ═══ PLADSEN ═════════════════════════════════════════════════════════════════
// Pladsen gemmes ikke som en taeller. Den stemples paa kvitteringen (motoren, PR 2):
//   report.rotation = { rev, index, length, advanced }
// og naeste plads afledes af stemplerne (nextRotationIndex). Fordi rev stiger ved
// hver gemning, ligger ankeret altid foer enhver kvittering med samme rev; derfor
// er reglen enkel: findes en kvittering med rotationens rev, fortsaettes derfra,
// ellers startes ved ankeret.
//
// ═══ BEHOLD PLADSEN (ejer 21/11, svar 3) ═════════════════════════════════════
// En rettelse med uaendret laengde beholder hver rytters plads; ny laengde = alle
// fra pas 1. Pladsen kendes ikke ved gemningen (den ligger paa rytterens
// kvitteringer), saa ankeret faar `fromRev`: fortsaet fra rytterens seneste
// kvittering med en rev i [fromRev, rev), hvis den har samme laengde; ellers
// start ved anchor.index. En kaede af rettelser uden koersel imellem bevarer
// fromRev, saa pladsen ikke tabes.

import { isProgramSession } from "./trainingPrograms.js";
import { isEffortLevel } from "./trainingEffortLevels.js";

export const ROTATION_VERSION = 1;
export const ROTATION_MIN_PASSES = 2;
export const ROTATION_MAX_PASSES = 35;
export const PLAN_KINDS = Object.freeze(["week", "rotation"]);

const ROTATION_KEYS = new Set(["v", "passes", "rev", "anchor"]);
const PASS_KEYS = new Set(["session", "effort"]);
const ANCHOR_KEYS = new Set(["rev", "index", "fromRev"]);

const isPlainObject = (value) => value != null && typeof value === "object" && !Array.isArray(value);
const isPositiveInt = (value) => Number.isInteger(value) && value >= 1;
const onlyKeys = (value, allowed) => Object.keys(value).every((key) => allowed.has(key));

export function isPlanKind(value) {
  return PLAN_KINDS.includes(value);
}

export function isValidRotationPass(pass) {
  if (!isPlainObject(pass) || !onlyKeys(pass, PASS_KEYS)) return false;
  if (!isProgramSession(pass.session)) return false;
  return pass.effort === undefined || isEffortLevel(pass.effort);
}

function isValidAnchor(anchor, { rev, length }) {
  if (!isPlainObject(anchor) || !onlyKeys(anchor, ANCHOR_KEYS)) return false;
  if (!isPositiveInt(anchor.rev) || anchor.rev > rev) return false;
  if (!Number.isInteger(anchor.index) || anchor.index < 0 || anchor.index >= length) return false;
  return anchor.fromRev === undefined || (isPositiveInt(anchor.fromRev) && anchor.fromRev < anchor.rev);
}

// Den gemte form. Streng: ukendte noegler afvises, saa en ny noegle kraever en ny v.
export function isValidRotation(rotation) {
  if (!isPlainObject(rotation) || !onlyKeys(rotation, ROTATION_KEYS)) return false;
  if (rotation.v !== ROTATION_VERSION || !isPositiveInt(rotation.rev)) return false;
  const { passes } = rotation;
  if (!Array.isArray(passes) || passes.length < ROTATION_MIN_PASSES || passes.length > ROTATION_MAX_PASSES) return false;
  if (!passes.every(isValidRotationPass)) return false;
  return rotation.anchor == null || isValidAnchor(rotation.anchor, { rev: rotation.rev, length: passes.length });
}

// Klientens liste af pas → den form der gemmes. `effortLevels` = kontakten
// training_effort_levels: slukket ignoreres indsatsen (ogsaa en ugyldig, som
// effortForWrite), taendt gemmes easy/normal/hard, null = foelg passets standard.
//   { ok: true, passes } | { ok: false, reason }
export function normalizeRotationPasses(input, { effortLevels = false } = {}) {
  if (!Array.isArray(input) || input.length < ROTATION_MIN_PASSES || input.length > ROTATION_MAX_PASSES) {
    return { ok: false, reason: "invalid_passes" };
  }
  const passes = [];
  for (const raw of input) {
    if (!isPlainObject(raw) || !onlyKeys(raw, PASS_KEYS)) return { ok: false, reason: "invalid_passes" };
    if (!isProgramSession(raw.session)) return { ok: false, reason: "invalid_session" };
    const pass = { session: raw.session };
    if (effortLevels && raw.effort != null) {
      if (!isEffortLevel(raw.effort)) return { ok: false, reason: "invalid_effort" };
      pass.effort = raw.effort;
    }
    passes.push(pass);
  }
  return { ok: true, passes };
}

export function copyRotationPasses(passes) {
  return passes.map((pass) => (pass.effort !== undefined ? { session: pass.session, effort: pass.effort } : { session: pass.session }));
}

// En selvstaendig kopi (ingen delte objekter mellem raekker), kun kendte noegler.
export function copyRotation(rotation) {
  if (!isValidRotation(rotation)) return null;
  const out = { v: rotation.v, passes: copyRotationPasses(rotation.passes), rev: rotation.rev };
  if (rotation.anchor != null) {
    const { rev, index, fromRev } = rotation.anchor;
    out.anchor = fromRev !== undefined ? { rev, index, fromRev } : { rev, index };
  }
  return out;
}

// Samme pas i samme raekkefoelge (og samme indsats)? Saa er en gemning uden
// "Spring til pas" ingen aendring, og rev skal ikke stige.
export function sameRotationPasses(rotation, passes) {
  if (!isValidRotation(rotation) || !Array.isArray(passes) || rotation.passes.length !== passes.length) return false;
  return rotation.passes.every((pass, i) => pass.session === passes[i]?.session && (pass.effort ?? null) === (passes[i]?.effort ?? null));
}

// Den rotation der gemmes, naar spilleren gemmer `passes` oven paa `prev`.
//   startIndex  "Spring til pas" / "Start fra pas 1": eksplicit plads (0-baseret).
//   keepPlace   (standard true) behold hver rytters plads, naar laengden er uaendret.
// null = ugyldigt input (pas eller startIndex).
/**
 * @param {any} prev
 * @param {any} passes
 * @param {{ keepPlace?: boolean, startIndex?: number | null }} [opts]
 */
export function buildRotationOnSave(prev, passes, { keepPlace = true, startIndex } = {}) {
  if (!Array.isArray(passes) || !passes.every(isValidRotationPass)) return null;
  if (passes.length < ROTATION_MIN_PASSES || passes.length > ROTATION_MAX_PASSES) return null;
  // rev skal altid stige paa raekken, ogsaa hvis den gamle vaerdi ikke laengere er gyldig:
  // ellers kunne et gammelt stempel med samme rev genbruges.
  const prevRev = isPositiveInt(prev?.rev) ? prev.rev : 0;
  const rev = prevRev + 1;
  const next = { v: ROTATION_VERSION, passes: copyRotationPasses(passes), rev };
  if (startIndex !== undefined && startIndex !== null) {
    if (!Number.isInteger(startIndex) || startIndex < 0 || startIndex >= passes.length) return null;
    next.anchor = { rev, index: startIndex };
    return next;
  }
  const prevValid = isValidRotation(prev) ? prev : null;
  if (keepPlace !== false && prevValid && prevValid.passes.length === passes.length) {
    const prevAnchor = prevValid.anchor?.rev === prevValid.rev ? prevValid.anchor : null;
    next.anchor = { rev, index: prevAnchor?.index ?? 0, fromRev: prevAnchor?.fromRev ?? prevValid.rev };
    return next;
  }
  next.anchor = { rev, index: 0 };
  return next;
}

// ═══ SKRIVNINGEN FRA KLIENTEN (rytterens plan og gruppens plan) ══════════════
// Body: { planKind?, passes?, keepPlace?, startIndex? }
//   planKind    'week' | 'rotation'. Udeladt: 'rotation' naar pas sendes, ellers uaendret.
//   passes      den nye liste (valideres af normalizeRotationPasses i routen).
//   keepPlace   standard true: behold pladsen ved samme laengde (ejer 21/11, svar 3).
//   startIndex  "Spring til pas" / "Start fra pas 1" (0-baseret).
// { ok: true, planKind, passes, keepPlace, startIndex } | { ok: false, reason }
export function parseRotationWrite(body) {
  const { planKind, passes, keepPlace, startIndex } = body ?? {};
  if (planKind !== undefined && !isPlanKind(planKind)) return { ok: false, reason: "invalid_plan_kind" };
  if (passes !== undefined && !Array.isArray(passes)) return { ok: false, reason: "invalid_passes" };
  if (keepPlace !== undefined && typeof keepPlace !== "boolean") return { ok: false, reason: "invalid_keep_place" };
  const hasStart = startIndex !== undefined && startIndex !== null;
  if (hasStart && !(Number.isInteger(startIndex) && startIndex >= 0)) return { ok: false, reason: "invalid_start" };
  // keepPlace false alene = "Start fra pas 1" paa den gemte rotation (Codex-fund).
  if (planKind === undefined && passes === undefined && !hasStart && keepPlace !== false) return { ok: false, reason: "nothing_to_write" };
  return {
    ok: true,
    planKind: planKind ?? (passes !== undefined ? "rotation" : undefined),
    passes,
    keepPlace: keepPlace ?? true,
    startIndex: hasStart ? startIndex : null,
  };
}

// Den nye tilstand oven paa den gemte. `passes` er den normaliserede liste (eller
// undefined, naar klienten ikke sendte nogen). Samme pas uden "Spring til pas" eller
// "Start fra pas 1" er ingen aendring: rev staar stille, saa stemplerne stadig passer.
// { ok: true, rotation, planKind } | { ok: false, reason }
export function applyRotationWrite({ prev = null, prevKind = null, write, passes }) {
  const prevValid = isValidRotation(prev) ? prev : null;
  let rotation = prevValid;
  if (passes !== undefined || write.startIndex != null || (write.keepPlace === false && prevValid)) {
    const base = passes ?? prevValid?.passes ?? null;
    if (!base) return { ok: false, reason: "rotation_missing" };
    // keepPlace false = "Start fra pas 1": altid en ny rev, ogsaa med samme pas.
    const unchanged = write.startIndex == null && write.keepPlace !== false && sameRotationPasses(prevValid, base);
    if (!unchanged) {
      rotation = buildRotationOnSave(prev, base, { keepPlace: write.keepPlace, startIndex: write.startIndex ?? undefined });
      if (!rotation) return { ok: false, reason: "invalid_start" };
    }
  }
  const planKind = write.planKind ?? (isPlanKind(prevKind) ? prevKind : null);
  if (planKind === "rotation" && !rotation) return { ok: false, reason: "rotation_missing" };
  return { ok: true, rotation: rotation ? copyRotation(rotation) : null, planKind };
}

function isValidStamp(stamp) {
  return isPlainObject(stamp)
    && isPositiveInt(stamp.rev)
    && Number.isInteger(stamp.length) && stamp.length >= ROTATION_MIN_PASSES
    && Number.isInteger(stamp.index) && stamp.index >= 0 && stamp.index < stamp.length
    && typeof stamp.advanced === "boolean";
}

// Pladsen for naeste slot, der koerer rotationens pas.
//   stamps  rytterens rotation-stempler i AFREGNINGSRAEKKEFOELGE (aeldste foerst):
//           tidligere datoers kvitteringer og derefter datoens egne, i den
//           raekkefoelge de blev skrevet. Saa faar to slots aldrig samme plads.
// null = ingen gyldig rotation.
export function nextRotationIndex({ rotation, stamps = [] } = {}) {
  if (!isValidRotation(rotation)) return null;
  const length = rotation.passes.length;
  const list = Array.isArray(stamps) ? stamps.filter(isValidStamp) : [];
  const continueFrom = (stamp) => (stamp.advanced ? (stamp.index + 1) % length : stamp.index);
  const latest = (accept) => {
    for (let i = list.length - 1; i >= 0; i -= 1) if (accept(list[i])) return list[i];
    return null;
  };
  // 1. Kvitteringer med denne rev: fortsaet derfra.
  const current = latest((s) => s.rev === rotation.rev && s.length === length);
  if (current) return continueFrom(current);
  // 2. Ankeret for denne rev (et anker fra en anden rev er foraeldet og ignoreres).
  const anchor = rotation.anchor?.rev === rotation.rev ? rotation.anchor : null;
  if (!anchor) return 0;
  if (anchor.fromRev !== undefined) {
    const carried = latest((s) => s.rev >= anchor.fromRev && s.rev < rotation.rev);
    if (carried && carried.length === length) return continueFrom(carried);
  }
  return anchor.index;
}

// Udfaldet af et slot, set fra rotationen (designets afsnit 5 + ejer 21/11).
export const ROTATION_OUTCOMES = Object.freeze({
  TRAINED: "trained", // almindeligt slot, aftenkoersel
  TRAIN_NOW: "train_now", // Traen nu (#7737): hvert frit slot der afregnes ved trykket
  FREE_SLOT_STAGE_DATE: "free_slot_stage_date", // frit slot paa en etapedato (#5267 A)
  RACED: "raced", // koerte loeb / race-session afregnet ved etapen (#7982)
  BOUND_REST: "bound_rest", // bundet, GT-hviledag i etapeloeb
  INJURED: "injured", // skadet / syg
  UNKNOWN_PENDING: "unknown_pending", // afgoeres naar slottet afregnes
  FATIGUE_RULE: "fatigue_rule", // traethedsgraensen slog til (erstatningen afgoer det)
  AFTER_STAGE: "after_stage", // "dagen efter en etape: foerste felt restitution"
});

// Rykker pladsen? Kun naar rotationens pas faktisk blev koert.
// Traethedsgraensen med "samme pas paa let" rykker (ejer 21/11, svar 2: passet
// taeller som koert); med Hvile eller Aktiv restitution venter rotationen.
// Et ukendt udfald venter (fail-safe: et pas der ikke blev koert, tabes aldrig).
export function advancesRotation(outcome, { fatigueFallback = null } = {}) {
  switch (outcome) {
    case ROTATION_OUTCOMES.TRAINED:
    case ROTATION_OUTCOMES.TRAIN_NOW:
    case ROTATION_OUTCOMES.FREE_SLOT_STAGE_DATE:
      return true;
    case ROTATION_OUTCOMES.FATIGUE_RULE:
      return fatigueFallback === "light";
    default:
      return false;
  }
}

// Stemplet paa kvitteringen for et slot, der stod paa rotationen.
export function rotationStamp({ rotation, index, advanced }) {
  if (!isValidRotation(rotation)) return null;
  const length = rotation.passes.length;
  if (!Number.isInteger(index) || index < 0 || index >= length) return null;
  return { rev: rotation.rev, index, length, advanced: advanced === true };
}

// Passet paa pladsen (en kopi), eller null.
export function rotationPassAt(rotation, index) {
  if (!isValidRotation(rotation) || !Number.isInteger(index) || index < 0 || index >= rotation.passes.length) return null;
  return copyRotationPasses([rotation.passes[index]])[0];
}
