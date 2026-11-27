// #7884 (ejer 11/11, 12/11, 13/11 og 26/11): "Angrib på" + et sted fra ruten.
//
// Kontrakten for den ene angrebsordre i nye planer. Rytteren saetter af ved FODEN af den valgte
// stigning (eller ved begyndelsen af finalen), fra den gruppe han sidder i. Denne fil er trin 1 i
// designets byggeplan (docs/superpowers/specs/2026-11-12-7884-langt-angreb-design.md, afsnit 7):
// stedlisten, ordrens form, valideringen og planen motoren faar, naar kontakten er slukket. Ingen
// motorkode: motorens trin (afsaet, fart betalt af reserven, jagten) kommer i egen PR med egen
// maaling og Fable-dom.
//
// Ejerens laaste valg (genaabnes ikke):
//  - Én ordre: "Angrib på" + sted. Stederne er rutens kategoriserede stigninger ved navn, ogsaa
//    maalstigningen, plus "Finalen" (de sidste km). Ingen "km fra maal" som eget valg (11/11, 13/11).
//  - Alle seks roller maa faa ordren (11/11). Ét forsoeg pr. stigning (12/11).
//  - Den gamle "Angrib" fra stigningens TOP er ikke et valg i nye planer; gemte planer koerer
//    uaendret (12/11).
//
// Kontakten `long_attack_7884` (app_config) er slukket. Slukket faar motoren praecis den plan, den
// faar i dag: en plan uden de nye steder er samme objekt (bit-identisk, bevist mod en frossen digest
// fra merge-basen i testen), og et angreb paa et sted erstattes af den forrige opgave. Indtil
// motorens trin findes (LONG_ATTACK_7884_ENGINE_READY), gaelder det ogsaa med kontakten taendt, saa
// en for tidlig taending aldrig kan sende en ukendt ordre til motoren.

import { createHash } from "node:crypto";
import { STAGE_PLAN_FINAL_KM, isTimeTrialProfile, normalizeStagePlanLegs, planHasJerseyHunt, planWithoutJerseyHunt, triggerKm, validateStagePlanLegs } from "./stagePlan.ts";

export const LONG_ATTACK_7884_FLAG_KEY = "long_attack_7884";

/**
 * #8828 trin 3: motorens mekanik er tilsluttet etapeplanen bag kontakten og loebets startstempel
 * (stagePlanEngine.ts, longAttack7884Flag.js). Kontakten selv er stadig slukket; API'et tager kun
 * imod stederne, naar loebet vil koere med dem (stagePlanApi.longAttack7884OpenForRaceApi). Saettes
 * den tilbage til false, tager API'et ikke imod stederne, uanset kontakten.
 */
export const LONG_ATTACK_7884_ENGINE_READY = true;

const CATEGORIES = new Set(["HC", "1", "2", "3", "4"]);
const ALL_ROLES = new Set(["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"]);

/**
 * Stedernes arter og deres skiftepunkt. #8828: strukturen er lavet, saa ejerens to aabne valg
 * (svar fre 27/11) kan saettes ind uden omskrivning:
 *  - "km foer maal" bliver en ny art her (fx `km_to_go`) med sin egen fod, og et nyt led i
 *    attackPlaces7884; valideringen, fingeraftrykket og fladen laeser kun `kind`/`trigger`.
 *  - "holdet foerer fra" bliver en ny opgave i PLACE_TASKS_7884; stederne er de samme.
 */
export const PLACE_KINDS_7884 = Object.freeze(["climb", "finale"]);
const PLACE_TRIGGERS = new Set(["climb_start", "finale"]);

/** Opgaverne der kan staa paa et sted. I dag kun "Angrib" (ejer 12/11). */
export const PLACE_TASKS_7884 = Object.freeze(["attack"]);

/** Kun den eksakte streng "on" taender. Alt andet (mangler, "off", true, fejl) er slukket. */
export function evaluateLongAttack7884Flag(value) {
  return value === "on";
}

function finite(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

/**
 * Stederne man kan angribe paa, i rutens raekkefoelge (foden foerst, saa index).
 * `raw` er etapens raa felter (race_stage_profiles: distance_km, profile_type, climbs).
 *
 *  - Hver kategoriseret stigning med top efter start og senest ved maal, ogsaa topankomsten.
 *    Noeglen er stigningens index i de raa `climbs` (samme som profilens og motorens vejpunkter);
 *    navnet er kun en etiket, saa to stigninger med samme navn er to steder.
 *  - Foden er toppen minus stigningens laengde, aldrig under 0. Uden gyldig laengde kendes foden
 *    ikke, og stigningen er ikke et sted.
 *  - "Finalen" findes paa hver vejetape og begynder samme sted som planens "sidste km".
 *  - En tidskoersel har ingen steder (der findes ingen plan at angribe i).
 */
export function attackPlaces7884(raw) {
  const distanceKm = finite(raw?.distance_km);
  if (distanceKm === null || !(distanceKm > 0)) return [];
  if (isTimeTrialProfile(raw?.profile_type)) return [];
  const climbs = Array.isArray(raw?.climbs) ? raw.climbs : [];
  const places = [];
  climbs.forEach((c, index) => {
    if (!c || typeof c !== "object") return;
    const crestKm = finite(c.crest_km ?? c.km);
    const lengthKm = finite(c.length_km);
    const category = String(c.category ?? "");
    if (!CATEGORIES.has(category) || crestKm === null) return;
    if (!(crestKm > 0 && crestKm <= distanceKm)) return;
    if (lengthKm === null || !(lengthKm > 0)) return;
    const summitFinish = c.summit_finish === true || crestKm === distanceKm;
    places.push({
      key: `climb:${index}`,
      kind: "climb",
      trigger: { at: "climb_start", kom_index: index },
      name: typeof c.name === "string" && c.name.trim() !== "" ? c.name : null,
      category,
      foot_km: Math.max(0, crestKm - lengthKm),
      crest_km: crestKm,
      summit_finish: summitFinish,
    });
  });
  places.push({
    key: "finale",
    kind: "finale",
    trigger: { at: "finale" },
    name: null,
    category: null,
    foot_km: Math.max(0, distanceKm - STAGE_PLAN_FINAL_KM),
    crest_km: null,
    summit_finish: false,
  });
  // Samme fod: stigningerne i rutens index-orden, finalen sidst.
  const order = (p) => (p.key === "finale" ? Number.MAX_SAFE_INTEGER : p.trigger.kom_index);
  return places.sort((a, b) => a.foot_km - b.foot_km || order(a) - order(b));
}

/**
 * Rutens fingeraftryk over stederne. En gemt ordre bygget paa et andet fingeraftryk peger maaske
 * paa en flyttet eller omdoebt stigning; gem afvises da med en neutral konflikt (designets afsnit 2).
 */
export function attackRouteFingerprint7884(places) {
  const canonical = (Array.isArray(places) ? places : []).map((p) => [p.key, p.foot_km, p.crest_km, p.name, p.category, p.summit_finish]);
  return createHash("sha256").update(JSON.stringify(canonical)).digest("hex").slice(0, 16);
}

/** Er skiftepunktet et af de nye steder (formen uden at slaa stedet op)? */
export function isPlaceTrigger7884(trigger) {
  return !!trigger && typeof trigger === "object" && !Array.isArray(trigger) && PLACE_TRIGGERS.has(trigger.at);
}

/** Stedet et skiftepunkt peger paa, eller null (ukendt form eller ukendt sted). */
export function placeForTrigger7884(trigger, places) {
  if (!isPlaceTrigger7884(trigger)) return null;
  const keys = Object.keys(trigger);
  if (trigger.at === "finale") {
    if (keys.length !== 1) return null;
    return places.find((p) => p.key === "finale") ?? null;
  }
  if (keys.length !== 2 || !Number.isInteger(trigger.kom_index)) return null;
  return places.find((p) => p.key === `climb:${trigger.kom_index}`) ?? null;
}

/** Et leds rutepunkt i km: et sted = foden; de gamle punkter som i dag; "sat" = null. */
function legKm7884(leg, route, places) {
  if (isPlaceTrigger7884(leg.from)) return placeForTrigger7884(leg.from, places)?.foot_km ?? null;
  return triggerKm(leg.from, route);
}

/**
 * Reglerne for de nye steder i EN rytters plan (null = gyldig, ellers en fejlkode). Resten af
 * planen valideres af de gamle regler paa planen uden stederne (`planWithoutLongAttack7884`), som
 * er den plan motoren faar, naar kontakten er slukket; den skal derfor altid vaere gyldig.
 *
 *  - Kun opgaven "attack" kan have et sted som skiftepunkt, og formen er eksakt.
 *  - Alle seks roller.
 *  - Stedet skal findes paa ruten.
 *  - Kronologi paa tvaers af gamle og nye punkter: strengt stigende km. Det giver ogsaa ét forsoeg
 *    pr. stigning (samme fod to gange er ikke stigende).
 *  - `newPlan` (standard): den gamle "Angrib" fra en stignings top er ikke et valg (ejer 12/11).
 *    En gemt plan laeses med `newPlan: false`.
 */
export function validateLongAttackLegs7884(legs, role, route, places, { newPlan = true } = {}) {
  if (!Array.isArray(legs)) return "stage_plan_invalid_leg";
  if (!ALL_ROLES.has(role)) return "stage_plan_task_not_for_role";
  let lastKm = -Infinity;
  for (let i = 0; i < legs.length; i++) {
    const leg = legs[i];
    if (!leg || typeof leg !== "object" || Array.isArray(leg)) return "stage_plan_invalid_leg";
    const from = leg.from;
    if (i > 0 && isPlaceTrigger7884(from)) {
      if (!PLACE_TASKS_7884.includes(leg.task)) return "long_attack_needs_attack_task";
      if (placeForTrigger7884(from, places) === null) return "long_attack_unknown_place";
    } else if (newPlan && leg.task === "attack" && from && typeof from === "object" && from.at === "kom") {
      return "long_attack_top_attack_retired";
    }
    if (i === 0 || !from || typeof from !== "object") continue;
    if (from.at === "dropped") continue;
    const km = legKm7884(leg, route, places);
    if (km === null) continue; // ukendt gammelt punkt: de gamle regler afviser det
    if (!(km > lastKm) || !(km > 0)) return "stage_plan_not_chronological";
    lastKm = km;
  }
  return null;
}

/**
 * Planen uden de nye steder: et angreb paa et sted erstattes af den forrige opgave (leddet
 * fjernes, saa forrige led fortsaetter), senere led bevares, og to ens led i traek bliver til ét
 * (det foerste beholder sit punkt). Har planen ingen nye steder, returneres SAMME array
 * (bit-identisk med i dag).
 */
export function planWithoutLongAttack7884(legs) {
  if (!Array.isArray(legs) || !legs.some((leg, i) => i > 0 && isPlaceTrigger7884(leg?.from))) return legs;
  const out = [];
  legs.forEach((leg, i) => {
    if (i > 0 && isPlaceTrigger7884(leg.from)) return;
    const prev = out[out.length - 1];
    if (prev && prev.task === leg.task) return;
    out.push(leg);
  });
  return out;
}

/**
 * Hele planens validering med de nye steder: stedernes regler (ovenfor) og de gamle regler paa
 * planen uden stederne. Leddenes antal begraenses af de gamle regler paa den reducerede plan;
 * angrebsleddene selv begraenses af stederne (ét pr. sted). Flere angreb paa samme etape er
 * tilladt, ét pr. stigning (ejer 12/11).
 */
export function validateStagePlan7884(legs, role, route, places, opts = {}) {
  const own = validateLongAttackLegs7884(legs, role, route, places, opts);
  if (own !== null) return own;
  return validateStagePlanLegs(planWithoutLongAttack7884(legs), role, route);
}

/**
 * Den plan motoren faar. Slukket, eller taendt foer motorens trin findes: planen uden de nye
 * steder (samme objekt, naar der ingen er). Kun med kontakten taendt OG motorens trin bygget
 * koerer planen med stederne.
 */
export function effectivePlan7884({ flagValue, legs, engineReady = LONG_ATTACK_7884_ENGINE_READY }) {
  if (evaluateLongAttack7884Flag(flagValue) && engineReady === true) return legs;
  return planWithoutLongAttack7884(legs);
}

// ── #8828 trin 2: etiket, fakta, gem og laesning ─────────────────────────────

/**
 * Stedets etiket som data (fladen oversaetter den). Ejer 26/11: en stigning uden navn vises med
 * kategori og km ("Kat. 3 ved km 87"); km er toppens, samme som profilens forklaring.
 *  - { key: "climb", name, summit_finish }
 *  - { key: "climbUnnamed", category, km, summit_finish }
 *  - { key: "finale", from_km }
 */
export function placeLabel7884(place) {
  if (!place || typeof place !== "object") return null;
  if (place.kind === "finale") return { key: "finale", from_km: Math.round(place.foot_km) };
  if (place.name) return { key: "climb", name: place.name, summit_finish: place.summit_finish === true };
  return { key: "climbUnnamed", category: place.category, km: Math.round(place.crest_km), summit_finish: place.summit_finish === true };
}

/**
 * Fakta fra ruten under valget (designets afsnit 6): hvor foden er, hvor mange kategoriserede
 * stigninger der kommer efter, og om det er topankomsten. Kun rutens egne data, ingen tal fra
 * motoren (fog of war).
 */
export function placeFacts7884(place, places) {
  if (!place || typeof place !== "object") return null;
  const list = Array.isArray(places) ? places : [];
  const after = list.filter((p) => p.kind === "climb" && p.foot_km > place.foot_km).length;
  return { foot_km: Math.round(place.foot_km), climbs_after: after, summit_finish: place.summit_finish === true };
}

/** Stederne som fladen faar dem: noegle, skiftepunkt, etiket og fakta, plus rutens fingeraftryk. */
export function attackPlacesView7884(raw) {
  const places = attackPlaces7884(raw);
  return {
    fingerprint: attackRouteFingerprint7884(places),
    places: places.map((p) => ({ key: p.key, kind: p.kind, trigger: p.trigger, label: placeLabel7884(p), facts: placeFacts7884(p, places) })),
  };
}

/** Har planen mindst ét led paa et af de nye steder? */
export function planHasLongAttack7884(legs) {
  return Array.isArray(legs) && legs.some((leg, i) => i > 0 && isPlaceTrigger7884(leg?.from));
}

/**
 * Kanonisk form til lagring, ogsaa for de nye steder (stagePlan.normalizeStagePlanLegs kender
 * kun de gamle punkter og ville tabe stigningens index). Forudsaetter en valideret plan.
 */
export function normalizeStagePlan7884(legs) {
  if (!planHasLongAttack7884(legs)) return normalizeStagePlanLegs(legs);
  const base = normalizeStagePlanLegs(legs.map((leg, i) => (i > 0 && isPlaceTrigger7884(leg.from) ? { ...leg, from: { at: "final_km" } } : leg)));
  return base.map((leg, i) => {
    const from = legs[i].from;
    if (i === 0 || !isPlaceTrigger7884(from)) return leg;
    return { ...leg, from: from.at === "finale" ? { at: "finale" } : { at: "climb_start", kom_index: from.kom_index } };
  });
}

/**
 * Rytterens gemte raekke for en plan med de nye steder (stagePlanApi.withStagePlan kalder hertil):
 *  - `plan`: hele planen med stederne (motoren koerer den kun med kontakten og motorens trin).
 *  - `plan_no_long_attack`: planen motoren ellers faar (planWithoutLongAttack7884), gemt ved
 *    siden af, saa en slukket kontakt aldrig dropper rytterens plan.
 *  - `long_attack_route_7884`: rutens fingeraftryk ved gem.
 *  - `plan_no_hunt` (#7855): planen uden troejejagt OG uden stederne, kun naar der er jagt.
 * De gamle felter (effort, try_break, leadout) udledes af planen uden stederne; foerste led og
 * toget er de samme i begge.
 */
export function longAttackStorage7884(legs, fingerprint, legacyOrderFromPlan) {
  const plan = normalizeStagePlan7884(legs);
  const fallback = normalizeStagePlanLegs(planWithoutLongAttack7884(plan));
  return {
    ...legacyOrderFromPlan(fallback),
    plan,
    plan_no_long_attack: fallback,
    long_attack_route_7884: fingerprint,
    ...(planHasJerseyHunt(fallback) ? { plan_no_hunt: planWithoutJerseyHunt(fallback) } : {}),
  };
}

/**
 * Gem-konflikten (designets afsnit 2): en plan med de nye steder skal sende det fingeraftryk,
 * den blev bygget paa. Er ruten aendret siden, afvises gem neutralt, saa rytteren aldrig
 * angriber paa en flyttet eller omdoebt stigning. null = ok.
 */
export function routeFingerprintError7884(rider, fingerprint) {
  if (!planHasLongAttack7884(rider?.plan)) return null;
  return rider.long_attack_route_7884 === fingerprint ? null : "long_attack_route_changed";
}

/**
 * Tager etapeplanen imod de nye steder i dette loeb? Kun naar ALT holder: kontakten er "on",
 * loebets revision har etapeplanen, og motorens trin er tilsluttet. Enhver fejl = false.
 * (Bindingen til loebet ved foerste etape, som #7855, kommer med tilslutningen af motoren.)
 */
export function longAttack7884OpenForRace({ flagValue, revisionOk, engineReady = LONG_ATTACK_7884_ENGINE_READY }) {
  return revisionOk === true && evaluateLongAttack7884Flag(flagValue) && engineReady === true;
}
