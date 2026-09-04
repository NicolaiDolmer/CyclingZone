// backend/lib/routeSegments.js
// Race Engine v4 F1 (#3855, spec §3.1): rute-SSOT segmentliste + vejr-lag.
//
// Ren, deterministisk berigelse OVEN PÅ den allerede genererede rute (attachRoute i
// raceRouteGenerator.js). Rører ALDRIG pass 1 (raceStageProfileGenerator.js's rng) eller
// pass 2's route-rng (":route:"-strømmen) — bruger sine EGNE dedikerede rng-strømme
// (":segments:"/":weather:"), så profile_type/finale_type/demand_vector/distance_km/
// climbs/sprints/sectors forbliver bit-identiske med i dag (golden-fixturen i
// raceStageProfileGenerator.test.js påvirkes ikke).
//
// segments dækker [0, distance_km] uden huller/overlap: 'climb' (fra rutens climbs[]),
// 'cobbles' (fra rutens sectors[]), 'descent' (indsat efter en climb hvor der er plads),
// og 'flat'/'rolling' som udfylder resten (profil-afhængigt gap-fyld). Motoren (v4, F2+)
// læser denne liste; INTET her rører raceSimulator.js/raceTimeline.js.
//
// synthesizeSegments(profile) er en SELVSTÆNDIG (rng-fri parameter) ren funktion for
// etaper UDEN gemte segmenter (legacy race_stage_profiles-rækker fra før denne slice):
// den genbruger de SAMME climb/sector-byggeklodser (buildClimbs/buildSectors, nu
// eksporteret fra raceRouteGenerator.js) med en seed afledt af selve profil-rækkens
// felter, så v4-motoren kan simulere ALT fra dag 1 uden en ny bagudrettet DB-backfill.

import { makeRng } from "./fictionalRiderGenerator.js";
import { seasonSeedSuffix } from "./raceSeedAxis.js";
import { buildClimbs, buildSectors, makeRegionNamer, DISTANCE_BANDS } from "./raceRouteGenerator.js";

// FNV-1a 32-bit (samme lokale mønster som raceRouteGenerator.js/raceStageProfileGenerator.js
// — selvstændig fil, ingen krydsimport af selve hash-funktionen).
function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
const presentKey = (v) => (typeof v === "string" ? (v.trim() === "" ? null : v) : v ?? null);
function seedIdentityFor(race) {
  return presentKey(race?.external_id) ?? presentKey(race?.pool_race_id) ?? race?.id ?? "adhoc";
}

// Dedikerede seed-nøgler for de NYE lag — egne rng-strømme, forstyrrer ALDRIG pass 1
// (raceStageProfileGenerator.js's rng) eller pass 2 (raceRouteGenerator.js's route-rng).
function segmentsSeedKey(race, stageNumber) {
  return `${String(seedIdentityFor(race))}${seasonSeedSuffix(race)}:segments:${stageNumber}`;
}
function weatherSeedKey(race, stageNumber) {
  return `${String(seedIdentityFor(race))}${seasonSeedSuffix(race)}:weather:${stageNumber}`;
}

function round1(n) {
  return Math.round(n * 10) / 10;
}
function round2(n) {
  return Math.round(n * 100) / 100;
}
function clampNum(n, lo, hi) {
  return Math.min(hi, Math.max(lo, n));
}

function weightedPick(rng, items) {
  const total = items.reduce((s, it) => s + it.weight, 0);
  let r = rng() * total;
  for (const it of items) {
    r -= it.weight;
    if (r < 0) return it.value;
  }
  return items[items.length - 1].value;
}

// Gap-fyld (flat/rolling) pr. profil-type. cobbles/tidskørsels-familien fyldes flad
// (transport-/tempo-karakter mellem sektorer/uden terrænvariation); rolling/hilly/
// mountain/classic-familien fyldes rolling (bølget mellem climbs).
const GAP_KIND_BY_PROFILE = Object.freeze({
  flat: "flat", rolling: "rolling", hilly: "rolling", mountain: "rolling",
  // #4105: grus fyldes ROLLING mellem sektorerne (toscansk boelgeterraen), ikke flad som
  // brosten — det er forskellen paa en nordfransk transport-etape og en grusklassiker.
  high_mountain: "rolling", cobbles: "flat", gravel: "rolling", classic: "rolling",
  itt: "flat", itt_hilly: "flat", ttt: "flat",
});
// Spec §3.1: "flad har hoejst smaa rolling-stykker" — kun for profile_type "flat", og kun
// en LILLE lomme inde i en tilstrækkeligt lang flad strækning, aldrig en dominerende del.
const FLAT_ROLLING_POCKET_MIN_GAP_KM = 40;
const FLAT_ROLLING_POCKET_CHANCE = 0.3;
const FLAT_ROLLING_POCKET_LEN = [5, 15];

// Udfyld ét frit interval [fromKm, toKm) med gap-segmenter. For profile_type "flat" er der
// en seedet chance for at splitte en tilstrækkeligt lang strækning i flat→rolling→flat
// (en LILLE rolling-lomme), ellers ét sammenhængende gap-segment af GAP_KIND_BY_PROFILE.
// from_km/to_km er BEVIDST urundede her (rå floats) — afrunding sker ÉN gang, samlet, i
// roundBoundaries() til sidst i buildSegments. Uafhængig round1() af nabo-grænser (én
// gang pr. segment-ende) kan lade to meget tætte, men reelt forskellige, grænser runde
// til SAMME 1-decimal-værdi og dermed skabe et 0-længde "spøgelsessegment" — deferred,
// delt afrunding eliminerer den klasse af fejl helt.
function pushGapSegments(rng, out, fromKm, toKm, profileType) {
  const gap = toKm - fromKm;
  if (gap <= 0.01) return;
  const kind = GAP_KIND_BY_PROFILE[profileType] ?? "flat";
  if (profileType === "flat" && kind === "flat" && gap >= FLAT_ROLLING_POCKET_MIN_GAP_KM && rng() < FLAT_ROLLING_POCKET_CHANCE) {
    const pocketLen = clampNum(FLAT_ROLLING_POCKET_LEN[0] + rng() * (FLAT_ROLLING_POCKET_LEN[1] - FLAT_ROLLING_POCKET_LEN[0]), 1, gap - 2);
    const pocketStart = fromKm + (gap - pocketLen) * (0.3 + rng() * 0.4);
    const pocketEnd = Math.min(toKm - 1, pocketStart + pocketLen);
    if (pocketStart > fromKm) out.push({ kind: "flat", from_km: fromKm, to_km: pocketStart });
    if (pocketEnd > pocketStart) out.push({ kind: "rolling", from_km: pocketStart, to_km: pocketEnd });
    if (toKm > pocketEnd) out.push({ kind: "flat", from_km: pocketEnd, to_km: toKm });
    return;
  }
  out.push({ kind, from_km: fromKm, to_km: toKm });
}

// Deferred, DELT afrunding af segment-grænser (jf. kommentaren i pushGapSegments): hver
// interne grænse rundes ÉN gang og genbruges som BÅDE forrigt segments to_km OG næste
// segments from_km — de kan derfor aldrig divergere. Første from_km tvinges til 0, sidste
// to_km tvinges til distanceKm (den autoritative værdi, ikke en uafhængig afrunding af
// den). Segmenter der kollapser til 0-længde efter afrunding (yderst sjældent — kun ved
// sub-100m rå intervaller) fjernes; kæden forbliver intakt fordi nabo-grænsen allerede er
// sat FØR filtreringen.
function roundBoundaries(segments, distanceKm) {
  if (!segments.length) return segments;
  segments[0].from_km = 0;
  for (let i = 0; i < segments.length; i++) {
    const isLast = i === segments.length - 1;
    const to = isLast ? distanceKm : round1(segments[i].to_km);
    segments[i].to_km = to;
    if (!isLast) segments[i + 1].from_km = to;
  }
  return segments.filter((s) => s.to_km > s.from_km);
}

// Kumuleret højdemeter for climb-segmenternes top_elevation_m — plausibelt stigende
// gennem etapen. IKKE fysik-eksakt (kun input til motor/visning, ingen motor-afhængighed).
const CLIMB_BASE_ELEVATION_M = 250;
function elevationGainForClimb(lengthKm, avgGradient) {
  return Math.round((lengthKm * 1000 * avgGradient) / 100);
}

/**
 * Byg den ordnede, [0,distance_km]-dækkende segmentliste for ÉN allerede-genereret rute
 * (climbs/sectors fra attachRoute, eller fra en legacy-syntese). Ren funktion — muterer
 * intet input.
 * @param {function():number} rng  dedikeret rng-strøm (segments- eller synth-seedet)
 * @param {{distance_km:number, profile_type:string, finale_type:(string|null), climbs?:Array, sectors?:Array}} route
 * @returns {Array<object>} ordnet, dækkende segmentliste
 */
export function buildSegments(rng, route) {
  const distanceKm = Number(route.distance_km) || 0;
  const profileType = route.profile_type;
  const finaleType = route.finale_type ?? null;
  const climbs = route.climbs ?? [];
  const sectors = route.sectors ?? [];
  if (!(distanceKm > 0)) return [];

  // 1. Rå features (climb + cobbles), afledt af de allerede genererede climbs/sectors.
  const raw = [];
  for (const c of climbs) {
    const to = clampNum(Number(c.crest_km), 0, distanceKm);
    const from = clampNum(to - Number(c.length_km), 0, to);
    raw.push({ kind: "climb", from, to, category: c.category, avg_gradient: c.avg_gradient });
  }
  for (const s of sectors) {
    const from = clampNum(Number(s.start_km), 0, distanceKm);
    const to = clampNum(from + Number(s.length_km), from, distanceKm);
    // #4105: BAADE brostens- og grus-sektorer bliver "cobbles"-SEGMENTER. Segment-
    // modellen beskriver fysikken (loest/ujaevnt underlag: lav laesgevinst, hoej
    // styrt-risiko, hoej work-cost), og den er den samme for de to underlag — ejer-
    // rammen 3/9. Underlaget selv staar i etapens profile_type og i sectors[].kind.
    raw.push({ kind: "cobbles", from, to, sector_name: s.name });
  }
  raw.sort((a, b) => a.from - b.from || a.to - b.to);

  // 2. Overlap-opløsning: tidligere feature (i sorteret rækkefølge) vinder — en cursor-
  // fejning der GARANTERER ingen overlap i output, uafhængigt af hvor climbs/sectors
  // tilfældigvis landede. Deterministisk givet samme input.
  const resolved = [];
  let cursor = 0;
  for (const f of raw) {
    const from = Math.max(f.from, cursor);
    if (from >= f.to) continue; // fuldt konsumeret af en tidligere feature
    resolved.push({ ...f, from });
    cursor = f.to;
  }

  // 3. Byg segmentlisten: gap-fyld FØR hver feature, feature selv, evt. 'descent' EFTER
  // en climb (indsat i det ledige rum til næste feature eller mål).
  const out = [];
  let elevationCum = CLIMB_BASE_ELEVATION_M;
  let pos = 0;
  for (let i = 0; i < resolved.length; i++) {
    const f = resolved[i];
    pushGapSegments(rng, out, pos, f.from, profileType);

    if (f.kind === "climb") {
      elevationCum += elevationGainForClimb(f.to - f.from, f.avg_gradient);
      out.push({
        kind: "climb", from_km: f.from, to_km: f.to,
        category: f.category, avg_gradient: f.avg_gradient,
        top_elevation_m: Math.round(elevationCum),
      });

      const nextFrom = i + 1 < resolved.length ? resolved[i + 1].from : distanceKm;
      const gapAfter = nextFrom - f.to;
      const isLastFeature = i === resolved.length - 1;
      // Descent-finale (spec §3.1): slutter ALTID med et descent-segment der rammer
      // distance_km præcist — også når den "naturlige" descent-længde ville være kortere.
      const forceFullDescent = isLastFeature && finaleType === "descent" && gapAfter > 0.01;
      if (forceFullDescent) {
        out.push({ kind: "descent", from_km: f.to, to_km: distanceKm, technicality: 1 + Math.floor(rng() * 3) });
        pos = distanceKm;
        continue;
      }
      if (gapAfter > 0.5) {
        const climbLen = f.to - f.from;
        const rawLen = climbLen * (0.5 + rng() * 0.8);
        const descLen = clampNum(rawLen, 1, gapAfter);
        const descTo = f.to + descLen;
        out.push({ kind: "descent", from_km: f.to, to_km: descTo, technicality: 1 + Math.floor(rng() * 3) });
        pos = descTo;
        continue;
      }
      pos = f.to;
      continue;
    }

    // cobbles
    out.push({ kind: "cobbles", from_km: f.from, to_km: f.to, sector_name: f.sector_name, stars: 1 + Math.floor(rng() * 5) });
    pos = f.to;
  }
  pushGapSegments(rng, out, pos, distanceKm, profileType);

  return roundBoundaries(out, distanceKm);
}

// Vejr-fordeling v1 (spec §3.1/§4-M11, ejer-valg 20/8): 55% sol / 25% overskyet /
// 12% regn / 8% vind. wind_exposure højere ved kind="wind" og let forhøjet på flade/
// kystnære profiler (fundament for sidevind/vifter, #2476 — ikke aktiveret her).
const WEATHER_WEIGHTS = Object.freeze([
  { value: "sun", weight: 55 }, { value: "overcast", weight: 25 },
  { value: "rain", weight: 12 }, { value: "wind", weight: 8 },
]);
const WIND_EXPOSED_FAMILY = new Set(["flat", "rolling", "cobbles", "gravel"]);

export function buildWeather(rng, profileType) {
  const kind = weightedPick(rng, WEATHER_WEIGHTS);
  let base = kind === "wind" ? 0.55 : 0.15;
  if (WIND_EXPOSED_FAMILY.has(profileType)) base += 0.1;
  const wind_exposure = round2(clampNum(base + rng() * 0.3, 0, 1));
  return { kind, wind_exposure };
}

/**
 * Berig ÉN allerede genereret etape (profile_type/finale_type/distance_km/climbs/
 * sectors — pass 1 + pass 2's output) med segments + weather. Kaldes fra
 * raceStageProfileGenerator.js's toStage(). Rører ALDRIG pass 1/pass 2's rng-strømme.
 */
export function attachSegmentsAndWeather(stage, race, stageNumber) {
  const segRng = makeRng(stableSeed(segmentsSeedKey(race, stageNumber)));
  const weatherRng = makeRng(stableSeed(weatherSeedKey(race, stageNumber)));
  const segments = buildSegments(segRng, stage);
  const weather = buildWeather(weatherRng, stage.profile_type);
  return { segments, weather };
}

// ── Legacy-syntese (#3855 F1 punkt 3): etaper uden gemte segmenter ──────────────────
//
// Ren funktion — INGEN rng-parameter (seeden er selv-afledt af profil-rækkens felter,
// så gentagne kald på SAMME række giver SAMME segmentliste, byte for byte). Genbruger
// buildClimbs/buildSectors fra raceRouteGenerator.js (samme byggeklodser som den "live"
// rute-generering via attachRoute), så en legacy-etape uden gemt distance_km/climbs/
// sectors stadig får en karakter-tro, [0,distance]-dækkende segmentliste.
function synthSeedKey(profile) {
  const identity = presentKey(profile?.race_id) ?? presentKey(profile?.id) ?? "synth";
  return `${identity}:${profile?.stage_number ?? 1}:${profile?.profile_type ?? "flat"}:${profile?.finale_type ?? ""}`;
}

/**
 * Syntetisér en deterministisk segmentliste for en etape UDEN gemte segmenter, afledt
 * af profile_type/finale_type (+ distance_km hvis kendt). Bagudkompatibel indgang for
 * v4-motoren: legacy race_stage_profiles-rækker kan simuleres uden ny backfill.
 * @param {{profile_type?:string, finale_type?:(string|null), distance_km?:number, race_id?:string, id?:string, stage_number?:number}} profile
 * @returns {Array<object>} samme form som buildSegments()
 */
export function synthesizeSegments(profile) {
  const profileType = DISTANCE_BANDS[profile?.profile_type] ? profile.profile_type : "flat";
  const finaleType = profile?.finale_type ?? null;
  const rng = makeRng(stableSeed(synthSeedKey(profile)));
  const namer = makeRegionNamer(rng, "default");

  let distanceKm = Number(profile?.distance_km);
  if (!Number.isFinite(distanceKm) || distanceKm <= 0) {
    const [lo, hi] = DISTANCE_BANDS[profileType] ?? DISTANCE_BANDS.flat;
    distanceKm = Math.round((lo + hi) / 2);
  }

  const climbs = buildClimbs(rng, profileType, finaleType, distanceKm, namer);
  const sectors = buildSectors(rng, profileType, distanceKm, namer);
  return buildSegments(rng, { distance_km: distanceKm, profile_type: profileType, finale_type: finaleType, climbs, sectors });
}
