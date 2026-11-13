// DOMMER #6110 (XP og Udvikling 2.0): faelles scenarier til dommerens proever.
// Skrevet FOER koden, kun ud fra ejerens regler i issue #6110. Maa ikke aendres af
// byggebanen. Tallene her er dommerens EGNE (ikke de private parametre); de er valgt,
// saa de foelger ejerens regler og goer mekanikken synlig i en proeve.
//
// Filen er ikke en test (ingen .test.-endelse) og koerer ikke af sig selv.

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HER = path.dirname(fileURLToPath(import.meta.url));

export const EVNER = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "descending", "cobblestone", "positioning", "aggression",
  "tactics", "teamwork", "leadership",
]);

/** Alle evner paa `basis`, med enkelte evner overskrevet. */
export function evner(basis, overskriv = {}) {
  const ud = {};
  for (const e of EVNER) ud[e] = basis;
  return { ...ud, ...overskriv };
}

// ── Dommerens XP-parametre (foelger ejerens regler 6/11, 7/11 og 12/11) ─────────
// Alder: fuld til og med 26, faldende for hvert aar fra 27, naesten intet fra 31.
// Mentale evner vokser laengere. Type: alt kan traenes, signaturen mest.
export const DOMMER_XP_RAA = Object.freeze({
  price: { base: 400, exponent: 3 },
  potentialXp: [{ at: 1, value: 20 }, { at: 3.5, value: 60 }, { at: 6, value: 120 }],
  ageShare: {
    physical: [
      { at: 26, value: 1 }, { at: 27, value: 0.8 }, { at: 28, value: 0.6 },
      { at: 29, value: 0.4 }, { at: 30, value: 0.2 }, { at: 31, value: 0.05 },
    ],
    mental: [
      { at: 30, value: 1 }, { at: 31, value: 0.8 }, { at: 32, value: 0.6 },
      { at: 33, value: 0.4 }, { at: 34, value: 0.2 }, { at: 35, value: 0.05 },
    ],
  },
  offFocusShare: 0.2,
  raceOffFocusShare: 0.2,
  typeShare: { signatur: 1, sekundaer: 0.8, haandvaerk: 0.6, andenRolle: 0.4, svaghed: 0.3 },
});

// Samme model, men med saa meget XP, at flere point kan koebes paa én dato. Bruges
// kun til at vise, at motoren ikke har et skjult loft (ejer 7/11 og 12/11).
export const RIGELIG_XP_RAA = Object.freeze({
  ...DOMMER_XP_RAA,
  potentialXp: [{ at: 1, value: 900 }, { at: 3.5, value: 2400 }, { at: 6, value: 5000 }],
});

// Daglig variation efter ejervalget 12/11: ca. 50-150 % pr. dag, ingen hukommelse.
export const DOMMER_VARIATION = Object.freeze({
  // Sat sammen af dele, saa hemmeligheds-scanneren ikke tager en proevetekst for en rigtig noegle.
  key: ["dommer-6110", "kun-til-proever", "ikke-en-rigtig-noegle", "0123456789"].join("-"),
  span: 0.5,
  memory: 0,
});

/** Fejler med en tydelig "IKKE BYGGET", naar et modul eller en eksport mangler. */
export async function kraev(modulSti, ...navne) {
  let modul;
  try {
    modul = await import(pathToFileURL(path.resolve(HER, modulSti)).href);
  } catch (fejl) {
    if (fejl?.code === "ERR_MODULE_NOT_FOUND" && String(fejl.message).includes(path.basename(modulSti))) {
      throw new Error(`IKKE BYGGET: modulet ${modulSti} findes ikke`, { cause: fejl });
    }
    throw fejl;
  }
  for (const navn of navne) {
    if (typeof modul[navn] === "undefined") throw new Error(`IKKE BYGGET: ${modulSti} eksporterer ikke ${navn}`);
  }
  return modul;
}

export function findes(modulSti) {
  return existsSync(path.resolve(HER, modulSti));
}

/** Validerede XP-params fra motorens egen validering (kaster, hvis dommerens tal afvises). */
export async function xpParams(raa = DOMMER_XP_RAA) {
  const { validateDevelopmentXpParams } = await kraev("./developmentXp.ts", "validateDevelopmentXpParams");
  const params = validateDevelopmentXpParams(raa);
  if (!params) throw new Error("Motoren afviser dommerens XP-parametre, som foelger ejerens regler");
  return params;
}

/** XP-params med ejerens daglige variation. IKKE BYGGET, hvis motoren ikke kender variation. */
export async function xpParamsMedVariation(raa = DOMMER_XP_RAA, variation = DOMMER_VARIATION) {
  await kraev("./developmentXpVariation.ts", "developmentXpDayVariation");
  const params = await xpParams({ ...raa, variation });
  if (!params.variation) throw new Error("IKKE BYGGET: XP-parametrene baerer ikke den daglige variation");
  return params;
}

// ── Ryttere (dommerens egne) ────────────────────────────────────────────────────
export const UNG_KLATRER = Object.freeze({
  riderId: "dommer-ung-klatrer", age: 19, potentiale: 5.5, primaryType: "climber", secondaryType: "puncheur",
  abilities: evner(41, { climbing: 58, tempo: 52, punch: 49, endurance: 50 }),
});
export const SPRINTER = Object.freeze({
  riderId: "dommer-sprinter", age: 24, potentiale: 3, primaryType: "sprinter", secondaryType: null,
  abilities: evner(55, { sprint: 71, acceleration: 69, flat: 63 }),
});
export const VETERAN = Object.freeze({
  riderId: "dommer-veteran", age: 33, potentiale: 2, primaryType: "puncheur", secondaryType: "climber",
  abilities: evner(62, { punch: 78, climbing: 70, tactics: 74 }),
});

export const HAARD_KLATRING = Object.freeze({ focus: "vo2max_climb", intensity: "hard" });
export const NORMAL_SPURT = Object.freeze({ focus: "sprint", intensity: "normal" });
export const LET_UDHOLDENHED = Object.freeze({ focus: "endurance", intensity: "easy" });
export const LOEBSLAERE = Object.freeze({ focus: "loebslaere", intensity: "normal" });
export const HVILE = Object.freeze({ focus: "endurance", intensity: "rest" });

// En staerk traener og den bedste facilitet (haandbygget, samme felter som motoren laeser).
export const STAERK_TRAENER = Object.freeze({
  overall: 88,
  dimensions: { physical: 96, mental: 60, technical: 60 },
  levels: { u23: 96, senior: 96 },
  roleSkills: {},
});
export const BEDSTE_FACILITET = 5;

/** Loft til den gamle model: evnen plus et fast stykke, hoejst 99. */
export function lofter(abilities, plus) {
  const ud = {};
  for (const [e, v] of Object.entries(abilities)) ud[e] = Math.min(99, v + plus);
  return ud;
}

// ── Den gamle model: dommerens faste scenarier til "slukket = som foer" ─────────
export function gammelModelScenarier() {
  const ryttere = [
    { ...UNG_KLATRER, capPlus: 22 },
    { ...SPRINTER, capPlus: 9 },
    { ...VETERAN, capPlus: 3 },
  ];
  const programmer = [HAARD_KLATRING, NORMAL_SPURT, LET_UDHOLDENHED, LOEBSLAERE, HVILE,
    { focus: "restitution", intensity: "recovery" }];
  const datoer = ["2026-11-16", "2026-11-17", "2026-12-03"];
  const former = [0.9, 1, 1.08];
  const ud = [];
  let n = 0;
  for (const r of ryttere) {
    for (const program of programmer) {
      for (const dateStr of datoer) {
        n += 1;
        const basis = {
          riderId: r.riderId, dateStr, age: r.age, abilities: r.abilities, caps: lofter(r.abilities, r.capPlus),
          progress: n % 2 ? {} : { climbing: 0.93, sprint: 0.4, endurance: 1.6, tactics: 0.7 },
          program, conditionMult: former[n % former.length], potentiale: r.potentiale,
          primaryType: r.primaryType, secondaryType: r.secondaryType,
        };
        ud.push(basis);
        // Hver tredje ogsaa paa loebsdags-aksen (flere ticks pr. dato, +1 pr. tick i den gamle model).
        if (n % 3 === 0) ud.push({ ...basis, tickSeedKey: `dommer-s#gd${n}`, budgetDivisor: 140, hardDailyCap: 1 });
        // Hver fjerde med traener og facilitet.
        if (n % 4 === 0) ud.push({ ...basis, staff: STAERK_TRAENER, facilityTier: BEDSTE_FACILITET, riderLevel: r.age <= 22 ? "u23" : "senior" });
      }
    }
  }
  return ud;
}

const rund = (x) => (typeof x === "number" && Number.isFinite(x) ? Number(x.toPrecision(12)) : x);
const rundAlt = (o) => {
  if (o === null || typeof o !== "object") return rund(o);
  if (Array.isArray(o)) return o.map(rundAlt);
  const ud = {};
  for (const k of Object.keys(o).sort()) ud[k] = rundAlt(o[k]);
  return ud;
};

/** Det, spilleren kan maerke af et tick: evner, bjaelke, gevinster, kvittering, dagsform. */
export function tickAftryk(resultat) {
  return rundAlt({
    abilities: resultat.abilities, progress: resultat.progress, gains: resultat.gains,
    score: resultat.score, noise: resultat.noise, status: resultat.status,
    traeningsscore: resultat.trainingScore?.score ?? null,
  });
}

export function fingeraftryk(vaerdi) {
  return createHash("sha256").update(JSON.stringify(vaerdi)).digest("hex");
}

/** Koerer alle faste scenarier gennem den gamle model og giver ét fingeraftryk. */
export function gammelModelFingeraftryk(applyDailyTick, ekstra = {}) {
  const aftryk = gammelModelScenarier().map((s) => tickAftryk(applyDailyTick({ ...s, ...ekstra })));
  return { antal: aftryk.length, hash: fingeraftryk(aftryk), foerste: aftryk[0], sidste: aftryk[aftryk.length - 1] };
}

// ── En falsk database med samme opslag, som kontakterne bruger ──────────────────
export function falskDb({ app = {}, privat = {} } = {}) {
  const laest = [];
  return {
    laest,
    from(tabel) {
      const q = { key: null };
      const kaede = {
        select() { return kaede; },
        eq(_kolonne, key) { q.key = key; return kaede; },
        async maybeSingle() {
          laest.push({ tabel, key: q.key });
          const kilde = tabel === "app_config" ? app : privat;
          return { data: q.key in kilde ? { value: kilde[q.key] } : null, error: null };
        },
      };
      return kaede;
    },
  };
}

/** Dommerens egen udregning af, hvor mange point en pung af XP koeber til prislisten. */
export function koebMedPrisliste({ level, bar = 0, xp = 0 }, pris) {
  let pung = bar * pris(level) + xp;
  let nu = level;
  let point = 0;
  while (nu < 99 && pung >= pris(nu)) {
    pung -= pris(nu);
    nu += 1;
    point += 1;
  }
  return { level: nu, point, rest: pung };
}
