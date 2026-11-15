// DOMMER #7855: de scenarier, dommerens frosne facit daekker (__fixtures__/dommer7855Facit.json).
// Delt af proeverne og af fryseren (dommer7855.frys-facit.mjs). Ikke en test.
//
// Facit er frosset af dommeren paa origin/main 8a02593dd (13/11, FOER de tre valg blev bygget).
// Filen koeres UAENDRET paa main og paa den nye kode. Facit maa aldrig genskabes med den nye kode.
// Kun hashes og fejlkoder forlader modulet; alle decimaltal er afrundet foer hash (#8113).

import { motor, koerEtape, belastninger, etape, fladMedSpurter, hash, kanon, loebet, passager } from "./dommer7855.fixtures.mjs";

// ── Kontrakten: alle planer paa et og to led (og et udvalg paa tre) ──────────

export const RAA_BJERG = Object.freeze({
  distance_km: 170, profile_type: "mountain",
  climbs: [{ name: "Col B", crest_km: 60, category: "1" }, { name: "Col C", crest_km: 110, category: "1" }, { name: "Top", crest_km: 170, category: "1", summit_finish: true }],
  sprints: [{ name: "Spurt", km: 85, kind: "intermediate" }, { name: "Maal", km: 170, kind: "finish" }],
});
export const RAA_FLAD = Object.freeze({ distance_km: 180, profile_type: "flat", climbs: [], sprints: [{ name: "Spurt", km: 90, kind: "intermediate" }, { name: "Maal", km: 180, kind: "finish" }] });
export const RAA_RUTER = Object.freeze([["bjerg", RAA_BJERG], ["flad", RAA_FLAD]]);

export const ROLLER = Object.freeze(["captain", "co_captain", "sprint_captain", "helper", "hunter", "free_role"]);
export const PUNKTER = Object.freeze([{ at: "kom", kom_index: 0 }, { at: "kom", kom_index: 1 }, { at: "final_km" }, { at: "dropped" }]);
const JAGT_PAA_LED = [undefined, "hunt_points", "hunt_kom"];
const led = (task, hunt, from) => ({ task, ...(from ? { from } : {}), ...(hunt ? { hunt } : {}) });

/** Et selvstaendigt "Hent bjergpoint"-led et sted i planen (det, ejerens valg 1 fjerner). */
export const harBjergjagtAlene = (legs) => legs.some((l) => l.task === "hunt_kom");

export function allePlaner(opgaver) {
  const ud = [];
  for (const a of opgaver) {
    for (const ha of JAGT_PAA_LED) {
      ud.push([led(a, ha)]);
      for (const b of opgaver) {
        for (const from of PUNKTER) ud.push([led(a, ha), led(b, undefined, from)]);
        for (const c of ["ride_in", "tempo", "hunt_points", "hunt_kom"]) ud.push([led(a, ha), led(b, undefined, PUNKTER[0]), led(c, undefined, PUNKTER[2])]);
      }
    }
  }
  // Jagt paa et led, der ikke er udbrud og ikke er foerste led.
  ud.push([led("stay_sheltered"), led("tempo", "hunt_kom", PUNKTER[0])], [led("stay_sheltered"), led("tempo", "hunt_points", PUNKTER[0])]);
  return ud;
}

/**
 * Svartabellen for alle planer UDEN et selvstaendigt bjergjagt-led, taendt og slukket. Med i
 * tabellen er ogsaa planen uden jagt (den, rytteren koerer, naar kontakten er slukket eller stoppet).
 */
export async function valideringstabel() {
  const { sp } = await motor();
  const planer = allePlaner(sp.STAGE_PLAN_TASKS).filter((legs) => !harBjergjagtAlene(legs));
  const tabel = [];
  for (const legs of planer) tabel.push(["uden-jagt", JSON.stringify(legs), sp.planHasJerseyHunt(legs), JSON.stringify(sp.planWithoutJerseyHunt(legs))]);
  for (const [navn, raa] of RAA_RUTER) {
    for (const taendt of [true, false]) {
      const rute = sp.withJerseyHunt7855(sp.stagePlanRouteFromRaw(raa), taendt);
      for (const rolle of ROLLER) for (const legs of planer) tabel.push([navn, taendt, rolle, JSON.stringify(legs), sp.validateStagePlanLegs(legs, rolle, rute)]);
    }
  }
  return { antal: tabel.length, hash: hash(tabel) };
}

// ── Motoren: slukket kontakt, og "Hent point" fra feltet ─────────────────────

const ETAPER = [
  ["flad20", () => etape(20)],
  ["flad3spurter", () => fladMedSpurter(3)],
  ["rullende37", () => etape(37)],
  ["kuperet5", () => etape(5)],
  ["bjerg13", () => etape(13)],
  ["hoejfjeld14", () => etape(14)],
];
const SAMMENHAENGE = ["foerste", "midt", "endags"];
const FROE = ["facit-a", "facit-b"];

// Gemte raekker, bogstaveligt som API'et gemmer dem paa main (saa facit ikke afhaenger af
// funktioner, byggebanen aendrer). r(id, indsats, udbrud, plan, planUdenJagt).
const r = (rider_id, effort, try_break, plan, plan_no_hunt) => ({ rider_id, effort, try_break, leadout: false, plan, ...(plan_no_hunt ? { plan_no_hunt } : {}) });
/** Planer uden troejejagt (udbrud, tempo, laeet, sat-led, finale). */
export const RAEKKER_UDEN_JAGT = Object.freeze({
  t0r1: r("t0r1", "save", false, [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }]),
  t0r2: r("t0r2", "protect", false, [{ task: "tempo" }]),
  t0r3: r("t0r3", "normal", true, [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }]),
  t1r2: r("t1r2", "normal", false, [{ task: "shelter_leader" }, { task: "ride_in", from: { at: "dropped" } }]),
  t1r4: r("t1r4", "normal", true, [{ task: "breakaway" }, { task: "ride_for_result", from: { at: "dropped" } }]),
});
/** Gemte planer MED troejejagt i alle former (alene, paa udbrudsleddet, i en kaede). */
export const RAEKKER_MED_JAGT = Object.freeze({
  t0r1: r("t0r1", "protect", false, [{ task: "hunt_points" }], [{ task: "stay_sheltered" }]),
  t0r2: r("t0r2", "protect", false, [{ task: "hunt_points" }, { task: "ride_in", from: { at: "dropped" } }], [{ task: "stay_sheltered" }, { task: "ride_in", from: { at: "dropped" } }]),
  t0r3: r("t0r3", "protect", false, [{ task: "hunt_kom" }], [{ task: "stay_sheltered" }]),
  t0r4: r("t0r4", "protect", false, [{ task: "hunt_points" }, { task: "ride_for_result", from: { at: "final_km" } }], [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }]),
  t1r2: r("t1r2", "normal", true, [{ task: "breakaway", hunt: "hunt_kom" }], [{ task: "breakaway" }]),
  t1r3: r("t1r3", "normal", true, [{ task: "breakaway", hunt: "hunt_points" }, { task: "ride_in", from: { at: "dropped" } }], [{ task: "breakaway" }, { task: "ride_in", from: { at: "dropped" } }]),
  t1r4: r("t1r4", "protect", false, [{ task: "tempo" }, { task: "hunt_kom", from: { at: "kom", kom_index: 0 } }], [{ task: "tempo" }, { task: "stay_sheltered", from: { at: "kom", kom_index: 0 } }]),
});
/** Kun "Hent point" fra feltet (ejer 13/11: bliver, som det er). */
export const RAEKKER_HENT_POINT = Object.freeze({
  t0r1: r("t0r1", "protect", false, [{ task: "hunt_points" }], [{ task: "stay_sheltered" }]),
  t0r2: r("t0r2", "protect", false, [{ task: "hunt_points" }], [{ task: "stay_sheltered" }]),
  t0r4: r("t0r4", "protect", false, [{ task: "hunt_points" }, { task: "ride_for_result", from: { at: "final_km" } }], [{ task: "stay_sheltered" }, { task: "ride_for_result", from: { at: "final_km" } }]),
  t1r3: r("t1r3", "protect", false, [{ task: "hunt_points" }], [{ task: "stay_sheltered" }]),
  t1r5: r("t1r5", "protect", false, [{ task: "hunt_points" }], [{ task: "stay_sheltered" }]),
});

async function aftryk(row, froe, valg) {
  const k = await koerEtape(row, froe, valg);
  return { k, loeb: hash(k.output), pris: hash(await belastninger(k)) };
}

/**
 * Slukket kontakt: hele motorens svar og alle rytteres pris (traethed), for planer uden jagt, uden
 * gemte planer og med gemte jagt-planer. `taendtUdenJagt`: samme koersler med kontakten taendt
 * og ingen valgt jagt.
 */
export async function slukketAftryk() {
  const slukket = {};
  const taendtUdenJagt = {};
  for (const [navn, row] of ETAPER) {
    for (const sammenhaeng of SAMMENHAENGE) {
      for (const froe of FROE) {
        const n = `${navn}:${sammenhaeng}@${froe}`;
        const saet = [["uden-jagt", RAEKKER_UDEN_JAGT], ["med-gemt-jagt", RAEKKER_MED_JAGT], ...(sammenhaeng === "foerste" ? [["ingen-planer", {}]] : [])];
        for (const [saetNavn, raekker] of saet) {
          const a = await aftryk(row(), froe, { raekker, taendt: false, sammenhaeng });
          slukket[`${n}:${saetNavn}`] = { loeb: a.loeb, pris: a.pris };
          if (saetNavn !== "med-gemt-jagt") {
            const b = await aftryk(row(), froe, { raekker, taendt: true, sammenhaeng });
            taendtUdenJagt[`${n}:${saetNavn}`] = { loeb: b.loeb, pris: b.pris };
          }
        }
      }
    }
  }
  return { slukket, taendtUdenJagt };
}

/**
 * Taendt med "Hent point" fra feltet: loebet (tider, placeringer, passagernes point) og hvem der
 * koerte efter pointene. Prisen er IKKE med (den aendres af valg 2).
 */
export async function hentPointAftryk() {
  const ud = {};
  let jagedePassager = 0;
  for (const [navn, row] of ETAPER) {
    for (const froe of FROE) {
      const k = await koerEtape(row(), froe, { raekker: RAEKKER_HENT_POINT, taendt: true, sammenhaeng: "foerste" });
      const jaegere = passager(k).map((p) => ({ kind: p.kind, index: p.index, hunters: [...(p.hunters ?? [])].sort(), betaler: [...(p.hunt_work_7855 ?? [])].sort() }));
      jagedePassager += jaegere.filter((p) => p.hunters.length > 0).length;
      ud[`${navn}@${froe}`] = hash({ loeb: loebet(k), jaegere });
    }
  }
  return { aftryk: ud, jagedePassager };
}

export { kanon };
