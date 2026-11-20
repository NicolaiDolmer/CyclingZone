// DOMMER #6110 R5 og R6 efter ejervalg 19/11 (kandidat B): aldersforloebet som rene regler,
// og et saesonskifte koert gennem motoren mod en falsk database.
//
// Ejerens ord 19/11 (issue #6110, kun de ord er grundlag):
//   - "XP er ens hele livet"; i patch noten "samme XP til langt hen i karrieren".
//   - "kroppen aeldes tidligere end i dag (hele trappen flyttes frem)", "kroppens aldring fra 29".
//     Dagens trappe begynder som 31-aarig, saa trappen er flyttet 2 aar frem.
//   - "et lille sent fald i mentale evner"; loeftet "Technique and tactics never drop" brydes
//     bevidst. Loeb og haarde traeningsdage bremser faldet, som for de fysiske evner.
//   - "Den nye aldring gaelder allerede ved skiftet S5→S6", og kun med XP taendt.
// Afloeser ejerens regel 12/11 og 14/11 (fuld udvikling til 26, et fald hvert aar fra 27, ca.
// en fjerdedel ved 31) og 6/11 (mentale evner vokser laengere end fysiske).
//
// Hvor ejeren ikke har sagt et tal, staar dommerens laesning som en navngiven konstant.
// Tallene her er offentlige (ejerens ord og dagens trappe i repoet), aldrig de private.
//
// Filen er ikke en test og koerer ikke af sig selv.

import { kraev, evner, fingeraftryk } from "./dommer6110.fixtures.mjs";

// ── Ejerens tal ──────────────────────────────────────────────────────────────────
export const FOERSTE_FALD = 29; // ejer 19/11: "kroppens aldring fra 29" (alderen i den nye saeson)
export const FLYTTET_AAR = 2; // dagens foerste fald er som 31-aarig; "hele trappen flyttes frem"

// ── Dommerens laesning (meldt til ejeren som spoergsmaal) ────────────────────────
export const LANGT_HEN = 32; // "samme XP til langt hen i karrieren": mindst til og med 32 aar (offentlig nedre graense)
export const DET_MESTE = 0.5; // "XP er ens hele livet": et sent sikkerhedsnet tager aldrig det meste
export const SENT_FRA = FOERSTE_FALD + 3; // "sent": tidligst efter kroppens foerste trin (offentlig nedre graense)
export const LILLE = 0.5; // "lille": hoejst halvdelen af kroppens fald i en kerneevne ved samme alder

// Ejerens ord: de fysiske evner + brosten aeldes med kroppen; teknik, taktik og de andre
// mentale evner faar det lille, sene fald.
export const KROP = Object.freeze([
  "climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance",
  "recovery", "durability", "cobblestone",
]);
export const TEKNIK_MENTAL = Object.freeze(["descending", "positioning", "aggression", "tactics", "teamwork", "leadership"]);

const ens = (a, b) => Math.abs(a - b) <= 1e-12;

/**
 * R5/R6: XP efter alder. `fysisk(alder)` og `mental(alder)` er andelen af fuld XP.
 * Tom liste = holder. Ejer 19/11: ens hele livet, og ens for fysiske og mentale evner.
 */
// `net` (valgfri, kun fra den private talfil, hard rule 17): ejerens praecise graenser
// { fuldTil, netFra, netAndel }. Uden `net` proeves kun de offentlige nedre graenser.
export function xpAlderBrud(fysisk, mental = fysisk, net = null) {
  const fejl = [];
  const fuld = fysisk(20);
  if (!(fuld > 0)) return ["en 20-aarig skal have XP"];
  for (let alder = 16; alder <= LANGT_HEN; alder++) {
    if (!ens(fysisk(alder), fuld)) fejl.push(`${alder} aar: XP skal vaere den samme som for en 20-aarig (ens hele livet)`);
  }
  for (let alder = LANGT_HEN + 1; alder <= 45; alder++) {
    if (!(fysisk(alder) <= fuld + 1e-12)) fejl.push(`${alder} aar: alder er aldrig en turbo`);
    if (!(fysisk(alder) <= fysisk(alder - 1) + 1e-12)) fejl.push(`${alder} aar: XP stiger aldrig igen med alderen`);
    if (!(fysisk(alder) >= DET_MESTE * fuld)) fejl.push(`${alder} aar: XP er ens hele livet; et sent sikkerhedsnet maa ikke tage det meste`);
    if (net && alder <= net.fuldTil && !ens(fysisk(alder), fuld)) fejl.push(`${alder} aar: ejerens graense for fuld XP er ikke overholdt`);
    if (net && alder >= net.netFra && !ens(fysisk(alder), net.netAndel * fuld)) fejl.push(`${alder} aar: ejerens sikkerhedsnet er ikke overholdt`);
  }
  for (let alder = 16; alder <= 45; alder++) {
    if (!ens(mental(alder), fysisk(alder))) fejl.push(`${alder} aar: mentale evner skal have samme XP som fysiske`);
  }
  return fejl;
}

/**
 * R5: kroppens trappe. `basisfald(alder)` er faldet pr. saeson i en kerneevne foer bremsen
 * under XP, `dagens(alder)` det samme efter dagens regel. Tom liste = holder.
 */
export function aldringstrappeBrud(basisfald, dagens) {
  const fejl = [];
  for (let alder = 16; alder < FOERSTE_FALD; alder++) {
    if (basisfald(alder) !== 0) fejl.push(`${alder} aar: kroppen aeldes foerst fra ${FOERSTE_FALD}`);
  }
  if (!(basisfald(FOERSTE_FALD) > 0)) fejl.push(`${FOERSTE_FALD} aar: kroppens aldring begynder her`);
  for (let alder = 16; alder <= 45; alder++) {
    if (!ens(basisfald(alder), dagens(alder + FLYTTET_AAR))) {
      fejl.push(`${alder} aar: trappen er dagens flyttet ${FLYTTET_AAR} aar frem (samme fald som en ${alder + FLYTTET_AAR}-aarig i dag)`);
    }
  }
  return fejl;
}

/**
 * R6: det lille, sene fald i teknik og mentale evner. `sentFald(alder)` er faldet pr. saeson
 * pr. evne foer bremsen, `basisfald(alder)` kroppens fald i en kerneevne. Tom liste = holder.
 */
// `praecis` (kun den private proeve): faldet SKAL begynde netop ved `sentFra`, ikke senere.
export function sentFaldBrud(sentFald, basisfald, sentFra = SENT_FRA, praecis = false) {
  const fejl = [];
  if (praecis && !(sentFald(sentFra) > 0)) fejl.push(`${sentFra} aar: ejerens sene fald skal begynde her`);
  let foerste = null;
  for (let alder = 16; alder <= 45; alder++) {
    const fald = sentFald(alder);
    if (fald > 0 && foerste === null) foerste = alder;
    if (alder < sentFra && fald !== 0) fejl.push(`${alder} aar: faldet i teknik og mentale evner er sent, tidligst fra ${sentFra}`);
    if (fald > 0 && !(fald <= LILLE * basisfald(alder))) fejl.push(`${alder} aar: faldet er lille, hoejst halvdelen af kroppens fald ved samme alder`);
    if (foerste !== null && !(fald > 0)) fejl.push(`${alder} aar: det sene fald holder ikke op igen`);
  }
  if (foerste === null) fejl.push("teknik og mentale evner skal falde en smule sent i karrieren (ejer 19/11)");
  return fejl;
}

// ═══ SAESONSKIFTET GENNEM MOTOREN ════════════════════════════════════════════════
// Skiftet S5→S6: den nye saeson er nr. 6, og alderen er saesonens (referenceaar 2031).

export const SAESON = Object.freeze({ id: "dommer-s6", nummer: 6, aar: 2031 });
// Den nye saesons start. seasons.start_date er en ren DATE-kolonne (database/schema.sql), saa
// databasen svarer med en dato uden klokkeslaet. Skiftet koeres typisk aftenen foer kl. 18
// dansk tid (seasonTransitionBoundary.js); det er standard-uret i koerSkifte.
export const START_S6 = "2026-11-28";
export const START_S6_DANSK_DATO = "2026-11-28";
export const SKIFTE_UR = "2026-11-27T17:00:00Z"; // 27/11 kl. 18:00 dansk tid
const HOLD_MANAGER = "dommer-hold-manager";
const HOLD_AI = "dommer-hold-ai";
const TYPER = Object.freeze(["climber", "sprinter", "puncheur", "rouleur", "gc", "tt"]);
const SIGNATUR = Object.freeze({
  climber: "climbing", sprinter: "sprint", puncheur: "punch", rouleur: "flat", gc: "endurance", tt: "time_trial",
});

/**
 * En rytter til skiftet. `alder` er alderen i den NYE saeson. `belastning` er den afsluttede
 * saesons loebsdage og haarde traeningsdage. `hold`: "manager", "ai" eller null (fri).
 */
export function skifteRytter({ id, alder, type = "climber", basis = 60, belastning = null, hold = "manager", potentiale = 4 }) {
  return {
    id, alder, belastning,
    rider: {
      id, primary_type: type, secondary_type: null, potentiale, birthdate: `${SAESON.aar - alder}-06-15`,
      is_u25: alder <= 25, is_retired: false, team_id: hold === "manager" ? HOLD_MANAGER : hold === "ai" ? HOLD_AI : null,
      firstname: "Dommer", lastname: id,
    },
    abilities: evner(basis, { [SIGNATUR[type] ?? "climbing"]: Math.min(95, basis + 18) }),
  };
}

/** En kohorte af ens opbyggede ryttere i samme alder (forskellige id'er, typer og niveauer). */
export function kohorte({ alder, antal = 60, belastning = null, hold = "manager", navn = "k" }) {
  return Array.from({ length: antal }, (_, i) => skifteRytter({
    id: `dommer-${navn}-${alder}-${i}`, alder, type: TYPER[i % TYPER.length], basis: 48 + ((i * 7) % 30), belastning, hold,
  }));
}

/** De faste ryttere til "slukket = dagens regel": 24-41 aar, alle typer, hold og belastninger. */
export function fasteSkifteRyttere() {
  const belastninger = [null, { raceDays: 40, hardDays: 0 }, { raceDays: 130, hardDays: 0 }, { raceDays: 30, hardDays: 60 }, { raceDays: 0, hardDays: 90 }];
  const hold = ["manager", "ai", null];
  const ud = [];
  let n = 0;
  for (let alder = 24; alder <= 41; alder++) {
    for (const type of TYPER) {
      ud.push(skifteRytter({
        id: `dommer-fast-${alder}-${type}`, alder, type, basis: 45 + ((n * 11) % 35),
        belastning: belastninger[n % belastninger.length], hold: hold[n % hold.length], potentiale: 1 + (n % 6),
      }));
      n += 1;
    }
  }
  return ud;
}

/** En falsk database med de tabeller og opslag, saesonskiftet bruger. Skrivninger fanges. */
export function saesonDb({ app = {}, privat = {}, startDato = START_S6, ryttere = [] }) {
  const tabeller = {
    seasons: startDato === null ? [] : [{ id: SAESON.id, start_date: startDato }],
    app_config: Object.entries(app).map(([key, value]) => ({ key, value })),
    private_config: Object.entries(privat).map(([key, value]) => ({ key, value })),
    teams: [
      { id: HOLD_MANAGER, is_ai: false, is_bank: false, is_frozen: false, is_test_account: false },
      { id: HOLD_AI, is_ai: true, is_bank: false, is_frozen: false, is_test_account: false },
    ],
    riders: ryttere.map((r) => r.rider),
    rider_derived_abilities: ryttere.map((r) => ({ rider_id: r.id, ...r.abilities, ability_caps: null })),
    rider_development_log: [],
  };
  const skrevet = [];
  return {
    skrevet,
    from(tabel) {
      const filtre = [];
      const raekker = () => (tabeller[tabel] ?? []).filter((r) => filtre.every(([k, v]) => r[k] === v));
      const svar = () => Promise.resolve({ data: raekker(), error: null });
      const kaede = {
        select() { return kaede; },
        eq(kolonne, vaerdi) { filtre.push([kolonne, vaerdi]); return kaede; },
        order() { return kaede; },
        is() { return kaede; },
        in() { return kaede; },
        limit() { return svar(); },
        range() { return svar(); },
        maybeSingle() { return Promise.resolve({ data: raekker()[0] ?? null, error: null }); },
        upsert() { return Promise.resolve({ data: null, error: null }); },
        then(ok, fejl) { return svar().then(ok, fejl); },
      };
      return kaede;
    },
    rpc(navn, args) {
      skrevet.push({ navn, args });
      return Promise.resolve({ data: true, error: null });
    },
  };
}

/**
 * Koerer saesonskiftet gennem motoren med dens egen laesning af kontakten.
 * Svarer med hver rytters evner efter skiftet (det, motoren skriver) og om han stoppede.
 */
export async function koerSkifte({ ryttere, app = {}, privat = {}, startDato = START_S6, ur = new Date(SKIFTE_UR) }) {
  const { developRidersForSeason } = await kraev("./riderProgressionEngine.js", "developRidersForSeason");
  const db = saesonDb({ app, privat, startDato, ryttere });
  const belastning = new Map(ryttere.filter((r) => r.belastning).map((r) => [r.id, r.belastning]));
  const stille = { warn() {}, error() {}, log() {} };
  const gemt = { warn: console.warn, error: console.error, log: console.log };
  Object.assign(console, stille);
  let summary;
  try {
    summary = await developRidersForSeason({
      supabase: db, seasonId: SAESON.id, seasonNumber: SAESON.nummer, notify: false, now: ur, seasonLoadByRider: belastning,
    });
  } finally {
    Object.assign(console, gemt);
  }
  const efter = new Map();
  for (const { navn, args } of db.skrevet) {
    if (navn !== "apply_rider_development") continue;
    efter.set(args.p_rider_id, { abilities: args.p_log.abilities, stoppet: args.p_log.retired_this_season === true });
  }
  return { efter, summary };
}

/** Faldet i en gruppe evner for én rytter: point foer minus point efter (aldrig negativt regnet om). */
export function fald(rytter, efter, gruppe) {
  const nu = efter.get(rytter.id)?.abilities;
  if (!nu) throw new Error(`${rytter.id}: motoren skrev ikke rytteren ved skiftet`);
  return gruppe.reduce((sum, evne) => sum + (rytter.abilities[evne] - nu[evne]), 0);
}

/** Stoerste fald i én evne i gruppen for én rytter. */
export function stoersteFald(rytter, efter, gruppe) {
  const nu = efter.get(rytter.id).abilities;
  return Math.max(...gruppe.map((evne) => rytter.abilities[evne] - nu[evne]));
}

/** Ét fingeraftryk af skiftets udfald: hver rytters evner efter skiftet, og om han stoppede. */
export function skifteFingeraftryk(ryttere, efter) {
  return fingeraftryk(ryttere.map((r) => {
    const ud = efter.get(r.id);
    if (!ud) throw new Error(`${r.id}: motoren skrev ikke rytteren ved skiftet`);
    return [r.id, Object.keys(ud.abilities).sort().map((evne) => [evne, ud.abilities[evne]]), ud.stoppet];
  }));
}
