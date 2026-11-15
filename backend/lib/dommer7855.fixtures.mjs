// DOMMER #7855 (troejejagten, ejerens tre valg 13/11): faelles scenarier til dommerens proever.
// Skrevet FOER koden, kun ud fra ejerens ord paa issue #7855 (7/11, 12/11 og 13/11).
// Maa ikke aendres af byggebanen. Feltet, froeene og etapevalget er dommerens egne.
//
// Filen er ikke en test (ingen .test.-endelse) og koerer ikke af sig selv.
//
// SAADAN MAALES DER (samme vej som produktionen, ingen egne formler):
//   1. Etapen koeres gennem produktionens bro (raceEngineV4Bridge.loadRaceEngineV4 ->
//      simulateStage), med holdenes gemte raekker i samme form som API'et gemmer dem.
//   2. Prisen (traetheden efter etapen) er raceFatigue.stageConditionWork +
//      raceFatigue.raceConditionLoads, som raceRunner kalder dem (ny traethedsmodel, v2).
//   Proeverne kender derfor ingen tal fra motoren. De sammenligner kun motorens egne svar.
//
// Decimaltal afrundes foer sammenligning og foer hash (#8113: sidste ciffer er maskinafhaengigt).

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HER = path.dirname(fileURLToPath(import.meta.url));

export const REV = "s5_profiles_v3";
export const MENNESKEHOLD = new Set(["team-0", "team-1"]);

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

let motorCache = null;
/** Produktionens moduler (broen, kontrakten, traetheden). Indlaeses en gang pr. proces. */
export function motor() {
  motorCache ??= (async () => {
    const [bro, sp, spe, rf, ph, ruteAd] = await Promise.all([
      kraev("./raceEngineV4Bridge.js", "loadRaceEngineV4"),
      kraev("./stagePlan.ts", "validateStagePlanLegs", "legacyOrderFromPlan", "planHasJerseyHunt", "planWithoutJerseyHunt", "stagePlanRouteFromRaw", "withJerseyHunt7855", "TASK_EFFORT", "STAGE_PLAN_TASKS"),
      kraev("./stagePlanEngine.ts", "stagePlanRouteFromV4"),
      kraev("./raceFatigue.js", "stageConditionWork", "raceConditionLoads"),
      kraev("./raceParticipationHistory.ts", "deriveParticipationHistory"),
      kraev("./engine/v4/adapters/routeAdapter.ts", "routeFromStageProfileRow"),
    ]);
    return { adapter: await bro.loadRaceEngineV4(), sp, spe, rf, ph, ruteAd };
  })();
  return motorCache;
}

// ── Feltet (opdigtet, fast froe) ─────────────────────────────────────────────

function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EVNER = ["climbing", "time_trial", "flat", "tempo", "sprint", "acceleration", "punch", "endurance", "recovery", "durability", "descending", "cobblestone", "positioning", "aggression", "tactics"];
const SPECIALER = [
  { climbing: 20, recovery: 8, endurance: 8 },
  { sprint: 22, acceleration: 16, positioning: 10 },
  { punch: 18, acceleration: 10, climbing: 8 },
  { time_trial: 16, tempo: 14, flat: 10 },
  { aggression: 18, endurance: 12, tempo: 10 },
  { climbing: 14, punch: 10 },
  { sprint: 14, flat: 10 },
  {},
];
// De to menneskehold har alle roller, der maa faa jagten (ogsaa jaeger).
const MENNESKEROLLER = {
  "team-0": ["captain", "sprint_captain", "helper", "helper", "free_role", "hunter"],
  "team-1": ["captain", "sprint_captain", "helper", "helper", "hunter", "free_role"],
};

/** Ti hold af seks. Hold 0 og 1 er menneskehold (gemte planer), resten AI-hold (produktionens AI-ordrer). */
export function dommerFelt(froe = 7855) {
  const naeste = rng(froe);
  const felt = [];
  for (let hold = 0; hold < 10; hold++) {
    for (let plads = 0; plads < 6; plads++) {
      const special = SPECIALER[(hold * 5 + plads * 3) % SPECIALER.length];
      const basis = 46 + Math.floor(naeste() * 18);
      const abilities = Object.fromEntries(EVNER.map((k) => [k, Math.min(92, basis + Math.floor(naeste() * 10) + (special[k] ?? 0))]));
      const holdId = `team-${hold}`;
      const rolle = MENNESKEROLLER[holdId]?.[plads] ?? (plads === 0 ? "captain" : plads === 1 && hold % 2 === 0 ? "sprint_captain" : plads <= 3 ? "helper" : "free_role");
      felt.push({ rider_id: `t${hold}r${plads}`, team_id: holdId, race_role: rolle, team_is_ai: !MENNESKEHOLD.has(holdId), abilities });
    }
  }
  return felt;
}

/** Hjaelperne paa menneskeholdene (dem ejerens ord handler om). */
export const HJAELPERE = Object.freeze(["t0r2", "t0r3", "t1r2", "t1r3"]);
export const rolleAf = (id) => dommerFelt().find((r) => r.rider_id === id)?.race_role;

// ── Etaperne (repoets gemte proeve-etaper, rigtige etapeformer) ──────────────

let etapeCache = null;
export function proeveEtaper() {
  if (!etapeCache) {
    const raa = JSON.parse(readFileSync(path.resolve(HER, "../scripts/baselines/v4-proxy-stages-2026-09-06.json"), "utf8"));
    etapeCache = Array.isArray(raa) ? raa : raa.stages;
  }
  return etapeCache;
}
export const etape = (i) => structuredClone(proeveEtaper()[i]);

/** Samme etape med dommerens egne indlagte spurter (km), saa en dag kan have én, to eller tre. */
export function medSpurter(row, kms) {
  const r = structuredClone(row);
  r.sprints = [...kms.map((km, i) => ({ name: `Spurt ${i + 1}`, km, kind: "intermediate" })), { name: "Finish", km: r.distance_km, kind: "finish" }];
  return r;
}

/** En flad etape med én, to eller tre indlagte spurter. */
export function fladMedSpurter(antal) {
  const kms = { 1: [95], 2: [60, 130], 3: [45, 95, 150] }[antal];
  return medSpurter(etape(20), kms);
}

/** Ruten som kontrakten ser den (samme som API'et ved gem). */
export async function planRute(row, taendt = true) {
  const M = await motor();
  return M.sp.withJerseyHunt7855(M.sp.stagePlanRouteFromRaw(row), taendt);
}

// ── Koer en etape ────────────────────────────────────────────────────────────

/** Rytterens gemte raekke, som API'et gemmer den (stagePlanApi.withStagePlan). */
export async function gemtRaekke(riderId, legs) {
  const M = await motor();
  return { rider_id: riderId, ...M.sp.legacyOrderFromPlan(legs), plan: legs, ...(M.sp.planHasJerseyHunt(legs) ? { plan_no_hunt: M.sp.planWithoutJerseyHunt(legs) } : {}) };
}

/**
 * Koer en etape gennem produktionens bro.
 *   planer:  { rider_id: legs }  (kun menneskeholdenes ryttere), gemt som API'et gemmer dem
 *   raekker: { rider_id: faerdig raekke }  (bogstavelige raekker; bruges af den frosne proeve)
 *   taendt:  kontakten jersey_hunt_7855 for loebet
 *   sammenhaeng: "foerste" (etapeloebets foerste etape), "midt" (etape 5 med klassement) eller "endags"
 */
export async function koerEtape(row, froe, { planer = {}, raekker = null, taendt = true, sammenhaeng = "foerste", felt = dommerFelt() } = {}) {
  const M = await motor();
  const etapeNr = sammenhaeng === "midt" ? 5 : 1;
  const gemt = new Map();
  for (const r of felt) {
    const raekke = raekker ? raekker[r.rider_id] : planer[r.rider_id] ? await gemtRaekke(r.rider_id, planer[r.rider_id]) : null;
    if (!raekke) continue;
    if (!MENNESKEHOLD.has(r.team_id)) throw new Error("kun menneskehold har planer");
    gemt.set(r.rider_id, raekke);
  }
  const holdRaekker = new Map();
  for (const r of felt) {
    if (!gemt.has(r.rider_id)) continue;
    if (!holdRaekker.has(r.team_id)) holdRaekker.set(r.team_id, { team_id: r.team_id, stage_number: etapeNr, breakaway_stance: null, riders: [] });
    holdRaekker.get(r.team_id).riders.push(gemt.get(r.rider_id));
  }
  const entrants = felt.map((r) => ({ ...r, effort: gemt.get(r.rider_id)?.effort ?? "normal" }));
  const ids = felt.map((r) => r.rider_id).sort();
  const gcStandings = sammenhaeng === "midt" ? ids.map((id, i) => ({ rider_id: id, time: 60000 + i * 9 })) : [];
  const jerseyLeaders = sammenhaeng === "midt" ? { points: ids[11], kom: ids[20], komHunters: [ids[20], ids[31], ids[44]] } : null;
  const svar = M.adapter.simulateStage({
    entrants, stageProfile: { ...row, stage_number: etapeNr }, seedString: `${froe}:${etapeNr}`, stageNumber: etapeNr,
    teamOrderRows: [...holdRaekker.values()], isStageRace: sammenhaeng !== "endags", raceStages: null,
    jerseyLeaders, rulesRevision: REV, gcStandings, jerseyHunt7855: taendt === true,
  });
  const rute = M.ruteAd.routeFromStageProfileRow(row);
  return { output: svar.v4Output, efforts: svar.efforts, profil: rute.profile_type, distanceKm: rute.distance_km, etapeNr, ids };
}

// ── Aflaes loebet ────────────────────────────────────────────────────────────

/** Prisen: etapens belastning (traethed) for alle ryttere, regnet som produktionen regner den. */
export async function belastninger(koersel) {
  const M = await motor();
  const work = M.rf.stageConditionWork({ rulesRevision: REV, stageNumber: koersel.etapeNr, profileType: koersel.profil, v4Result: { v4Output: koersel.output, efforts: koersel.efforts } });
  const loads = M.rf.raceConditionLoads(koersel.ids, koersel.profil, koersel.efforts, REV, work, { distanceKm: koersel.distanceKm, seasonRaceDaysByRider: new Map() });
  return new Map(loads.map((l) => [l.rider_id, l.load]));
}
export const pris = async (koersel, id) => (await belastninger(koersel)).get(id);

/**
 * Pristrappen paa samme koersel og samme rytter: hvad dagen ville koste paa et andet trin, alt
 * andet lige (samme funktion som ovenfor, kun rytterens indsats er skiftet).
 * Middel = "normal", Haard = "protect", Meget haard = "all_out".
 */
export async function prisPaaTrin(koersel, id, trin) {
  const efforts = new Map(koersel.efforts);
  efforts.set(id, trin);
  return (await belastninger({ ...koersel, efforts })).get(id);
}

export const passager = (koersel, art) => (koersel.output.passages ?? []).filter((p) => (!art || p.kind === art) && p.km < koersel.distanceKm);
/** Passager, hvor rytteren koerte efter pointene (filmens kilde). */
export const jagede = (koersel, id, art) => passager(koersel, art).filter((p) => (p.hunters ?? []).includes(id)).length;
/** Passager, opgaven fik ham til at koere med om (dem, der koster). */
export const betalte = (koersel, id, art) => passager(koersel, art).filter((p) => (p.hunt_work_7855 ?? []).includes(id)).length;
export function point(koersel, id, art) {
  let sum = 0;
  for (const p of passager(koersel, art)) for (const r of p.results ?? []) if (r.rider_id === id) sum += Number(r.points ?? 0);
  return sum;
}
export const tider = (koersel) => koersel.output.results.map((r) => [r.rider_id, afrund(r.time_seconds, 3), r.rank]);

/** Var rytteren med i dagens udbrud? Samme kilde som produktionen (deltagelseshistorikken). */
export async function medIUdbrud(koersel, id) {
  const M = await motor();
  const h = M.ph.deriveParticipationHistory(koersel.output.timeline?.events ?? [], koersel.output.results.map((r) => r.rider_id));
  return h.morningRiderIds.has(id);
}
/** Laa rytteren paa noget tidspunkt i en gruppe foran feltet (udbrud, alene)? Fra motorens gruppebilleder. */
export const foranFeltet = (koersel, id) => (koersel.output.groupSnapshots ?? []).some((s) => (s.groups ?? []).some((g) => (g.kind === "breakaway" || g.kind === "solo") && g.rider_ids.includes(id)));

/** Rytterens arbejde uden for jagten (andel i front og i grupetto), til at afgoere om to dage kan sammenlignes. */
export async function arbejde(koersel, id) {
  const M = await motor();
  const e = M.rf.stageConditionWork({ rulesRevision: REV, stageNumber: koersel.etapeNr, profileType: koersel.profil, v4Result: { v4Output: koersel.output, efforts: koersel.efforts } }).exposure.get(id);
  return { front: afrund(e?.front ?? 0, 3), shelter: afrund(e?.shelter ?? 0, 3) };
}

// ── Afrunding og hash (#8113) ────────────────────────────────────────────────

export const afrund = (x, decimaler = 6) => {
  const f = 10 ** decimaler;
  return Math.round(Number(x) * f) / f;
};

/** Kanonisk form: noegler sorteret, Map/Set som lister, alle decimaltal afrundet. */
export function kanon(v, decimaler = 6) {
  if (typeof v === "number") return Number.isFinite(v) ? afrund(v, decimaler) : String(v);
  if (v instanceof Map) return kanon([...v.entries()].sort((a, b) => (String(a[0]) < String(b[0]) ? -1 : 1)), decimaler);
  if (v instanceof Set) return kanon([...v].sort(), decimaler);
  if (Array.isArray(v)) return v.map((x) => kanon(x, decimaler));
  if (v && typeof v === "object") return Object.fromEntries(Object.keys(v).sort().filter((k) => v[k] !== undefined).map((k) => [k, kanon(v[k], decimaler)]));
  return v;
}
export const hash = (v, decimaler = 6) => createHash("sha256").update(JSON.stringify(kanon(v, decimaler))).digest("hex");

/** Loebet, som spilleren ser det: tider, placeringer og passagernes point (uden jagtens egne felter). */
export function loebet(koersel) {
  return {
    resultater: koersel.output.results.map((r) => ({ rider_id: r.rider_id, rank: r.rank, time_seconds: r.time_seconds, status: r.status ?? null })),
    passager: (koersel.output.passages ?? []).map((p) => ({ kind: p.kind, index: p.index, km: p.km, results: (p.results ?? []).map((r) => ({ rider_id: r.rider_id, points: r.points ?? 0, bonus_seconds: r.bonus_seconds ?? 0 })) })),
  };
}

export const gennemsnit = (a) => (a.length ? a.reduce((s, x) => s + x, 0) / a.length : NaN);
