// Sub-4 (#2448): etapeprofil-geometri + motor-aflæsning. Ren .js uden React/DOM,
// så `node --test` kan loade modulet direkte (samme mønster som stageProfileConfig.js).
//
// SANDHEDSPRINCIP (ejer 2026-07-22): alt på grafen kommer 1:1 fra race_stage_profiles,
// og alt motoren konsumerer skal kunne aflæses på grafen. Der findes INGEN punkt-for-
// punkt-højdedata; silhuetten SYNTETISERES herunder — men bundet af en invariant:
// kurvens samlede positive stigning er nøjagtig elevation_gain_m. En stignings
// placering, længde, stejlhed og højde er derfor sande; kun bølgeterrænet mellem
// stigningerne er fri form, og selv dens samlede stigning er bundet.

/** Dal-reference i meter. Rent visuelt nulpunkt — ikke en påstand om havhøjde. */
export const VALLEY_M = 180;
/**
 * Loft på hvor stejlt ruten falder fra en top (m/km ≈ 6,5 %). Ligger næste stigning
 * tæt, når ruten ALDRIG ned i dalen — den næste starter fra den højde nedkørslen
 * nåede, sådan som et bjergmassiv faktisk ser ud. Uden loftet bliver faldene absurde
 * (Picos etape 4: 915 hm på 6,6 km = 14 % nedad i seks kilometer), og bølgen kan
 * kun bidrage positivt hvis dens amplitude er flere hundrede meter.
 */
export const DESCENT_M_PER_KM = 65;
/** Blødt bånd (km) hvor bølgen fades ud mod en stignings-rampe, så ramperne er rene. */
const FADE_KM = 3;
/** Antal samplede punkter på kurven. Fast → determinisme. */
const SAMPLES = 420;
const TAU = 6.283185307179586;

/** Højdemeter for én stigning — SAMME formel som backend raceRouteGenerator.elevationGain(). */
export function climbGainM(climb) {
  return Math.round((Number(climb.length_km) * 1000 * Number(climb.avg_gradient)) / 100);
}

/** FNV-1a 32-bit — lokal kopi af backendens stableSeed (ingen backend-import i browser-kode). */
export function stableSeed(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193); }
  return h >>> 0;
}

/**
 * Gaten for hele Sub-4-fladen. distance_km er det ENESTE påkrævede felt: en flad
 * ITT uden climbs har stadig en ægte rute, mens et S1/PCM-løb uden rutedata skal
 * falde tilbage til #1484-piktogrammet (ingen syntetisk kurve).
 */
export function hasRouteData(profile) {
  return Number.isFinite(Number(profile?.distance_km)) && Number(profile.distance_km) > 0;
}

function clamp(v, lo, hi) { return Math.max(lo, Math.min(hi, v)); }

/**
 * Syntetisér etapens højdekurve.
 * @param {object} profile  race_stage_profiles-række
 * @param {{yMax?:number}} [opts]  yMax = fælles y-loft (etape-striben); ændrer IKKE kurven
 * @returns {{xs:number[], ys:number[], spans:[number,number][], climbs:object[],
 *            maxY:number, ascent:number, waveAmplitude:number}|null}
 */
export function buildProfileSeries(profile, opts = {}) {
  if (!hasRouteData(profile)) return null;
  const D = Number(profile.distance_km);
  const climbs = (Array.isArray(profile.climbs) ? profile.climbs : [])
    .slice()
    .sort((a, b) => Number(a.crest_km) - Number(b.crest_km));

  // 1) Knuder: fod → top → begrænset nedkørsel → fod …
  const knots = [[0, VALLEY_M]];
  const spans = [];
  let prevKm = 0, prevAlt = VALLEY_M;
  for (const c of climbs) {
    const crest = Number(c.crest_km);
    const foot = Math.max(prevKm + 0.5, Math.min(crest - Number(c.length_km), crest - 0.5));
    const footAlt = Math.max(VALLEY_M, prevAlt - DESCENT_M_PER_KM * (foot - prevKm));
    if (foot > knots[knots.length - 1][0]) knots.push([foot, footAlt]);
    const crestAlt = footAlt + climbGainM(c);
    knots.push([crest, crestAlt]);
    spans.push([foot, crest]);
    prevKm = crest; prevAlt = crestAlt;
  }
  if (prevKm < D) {
    knots.push([D, Math.max(VALLEY_M, prevAlt - DESCENT_M_PER_KM * (D - prevKm))]);
  }

  const at = (x) => {
    for (let i = 1; i < knots.length; i++) {
      if (x <= knots[i][0]) {
        const [x0, y0] = knots[i - 1];
        const [x1, y1] = knots[i];
        return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
      }
    }
    return knots[knots.length - 1][1];
  };
  const mask = (x) => {
    let m = 1;
    for (const [a, b] of spans) {
      if (x >= a && x <= b) return 0;
      const d = x < a ? a - x : x - b;
      if (d < FADE_KM) m = Math.min(m, d / FADE_KM);
    }
    return m;
  };

  // 2) Bølgeterræn. Faser fra en stabil hash (aldrig Math.random/Date).
  // Bølgelængderne er KORTE med vilje: bølgen repræsenterer ikke-kategoriseret
  // terræn (BASE_ELEVATION), altså mange små bump. Med lange bølger skal de få
  // perioder bære hele restbeløbet, og amplituden ryger op i flere hundrede meter.
  const seed = stableSeed(`${profile.race_id ?? ""}#${profile.stage_number ?? 1}#${D}`);
  const p1 = ((seed % 1000) / 1000) * TAU;
  const p2 = (((seed >>> 10) % 1000) / 1000) * TAU;
  const L1 = clamp(D / 40, 0.8, 5.0), L2 = clamp(D / 15, 2.0, 14.0), L3 = clamp(D / 80, 0.4, 2.5);

  // Samplepunkter = jævn opløsning UNION alle knude-positioner. Uden knuderne
  // rammer rasteret sjældent en top præcist, og en HC-spids kan blive skåret
  // 30 m af (målt) — både geometrisk forkert og visuelt afrundet.
  const xs = [];
  for (let i = 0; i <= SAMPLES; i++) xs.push((D * i) / SAMPLES);
  for (const [kx] of knots) xs.push(kx);
  xs.sort((a, b) => a - b);
  for (let i = xs.length - 1; i > 0; i--) if (xs[i] - xs[i - 1] < 1e-9) xs.splice(i, 1);
  const N = xs.length - 1;

  const base = [], wav = [];
  for (let i = 0; i <= N; i++) {
    const x = xs[i];
    base.push(at(x));
    wav.push(mask(x) * (
      Math.sin((TAU * x) / L1 + p1)
      + 0.55 * Math.sin((TAU * x) / L2 + p2)
      + 0.3 * Math.sin((TAU * x) / L3 + p1 * 2)
    ));
  }
  // Nulstil bølgen ved start (rent konstant offset → invarianten er uændret),
  // så ruten altid begynder i dal-højde i stedet for på en tilfældig bølgetop.
  const w0 = wav[0];
  for (let i = 0; i <= N; i++) wav[i] -= w0;

  const ascentAt = (s) => {
    let a = 0;
    for (let i = 1; i <= N; i++) {
      const d = base[i] + s * wav[i] - (base[i - 1] + s * wav[i - 1]);
      if (d > 0) a += d;
    }
    return a;
  };

  // 3) INVARIANTEN: bisektér bølgens amplitude, så samlet stigning == elevation_gain_m.
  // Ramperne bidrager allerede med deres egen sum; bølgen absorberer præcis det
  // generatoren lagde oveni som BASE_ELEVATION[profile_type].
  const target = Number(profile.elevation_gain_m);
  let s = 0;
  if (Number.isFinite(target) && target > ascentAt(0)) {
    let lo = 0, hi = 8;
    while (ascentAt(hi) < target && hi < 4096) hi *= 2;
    for (let k = 0; k < 55; k++) {
      const mid = (lo + hi) / 2;
      if (ascentAt(mid) < target) lo = mid; else hi = mid;
    }
    s = (lo + hi) / 2;
  }
  const ys = xs.map((x, i) => Math.max(20, base[i] + s * wav[i]));
  const peak = Math.max(...ys);
  return {
    xs, ys, spans, climbs,
    maxY: Number.isFinite(opts.yMax) ? opts.yMax : peak,
    ascent: ascentAt(s),
    // Bølgens top-til-bund-udsving. Kalibreringens kanariefugl — se testen.
    waveAmplitude: s * 1.85,
  };
}

/**
 * Fælles y-loft for et løbs etaper. Uden det ville hver mini-profil skalere til
 * sin egen top, og en flad etape ville se lige så bjergrig ud som en HC-dag.
 * @returns {number|null} null hvis ingen af etaperne har rutedata
 */
export function sharedYMax(profiles) {
  let max = null;
  for (const p of profiles || []) {
    const s = buildProfileSeries(p);
    if (s && (max === null || s.maxY > max)) max = s.maxY;
  }
  return max;
}

// ─────────────────────────────────────────────────────────────────────────────
// Task 2 (#2448): motor-aflæsning. Grafen skal fortælle hvad ruten GØR ved
// løbet med PRÆCIS de samme betingelser og tal som motoren selv bruger — ellers
// lyver chippen over for spilleren. Konstanterne herunder er derfor dupliceret
// (ikke gættet) fra backend/lib/racePassages.js og backend/lib/raceSimulator.js;
// drift-guard-testene deepEqual'er dem mod de ægte backend-eksporter. Fejler en
// guard, ret DENNE fil — backend er motoren og er frossen for denne opgave.

// Fra backend/lib/racePassages.js (Sub-2, ejer-låste Tour-skalaer, spec §4 22/7).
export const GREEN_FINISH_SCALES = Object.freeze({
  flat:          Object.freeze([50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]),
  cobbles:       Object.freeze([50, 30, 20, 18, 16, 14, 12, 10, 8, 7, 6, 5, 4, 3, 2]),
  rolling:       Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  hilly:         Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  classic:       Object.freeze([30, 25, 22, 19, 17, 15, 13, 11, 9, 7, 6, 5, 4, 3, 2]),
  mountain:      Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  high_mountain: Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  itt:           Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
  ttt:           Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]),
});
export const INTERMEDIATE_SPRINT_SCALE = Object.freeze([20, 17, 15, 13, 11, 10, 9, 8, 7, 6, 5, 4, 3, 2, 1]);
export const KOM_SCALES = Object.freeze({
  HC:  Object.freeze([20, 15, 12, 10, 8, 6, 4, 2]),
  "1": Object.freeze([10, 8, 6, 4, 2, 1]),
  "2": Object.freeze([5, 3, 2, 1]),
  "3": Object.freeze([2, 1]),
  "4": Object.freeze([1]),
});
export const FINISH_BONUS_SECONDS = Object.freeze([10, 6, 4]);
export const INTERMEDIATE_BONUS_SECONDS = Object.freeze([3, 2, 1]);

// Fra backend/lib/raceSimulator.js (Sub-3, #2771 rute-bevidst gap-model).
export const TECHNICAL_DESCENT_WINDOW_KM = Object.freeze([3, 12]);
export const VALLEY_MIN_DESCENT_KM = 10;
export const DISTANCE_BAND_MIDPOINTS = Object.freeze({
  flat: 175, rolling: 170, hilly: 185, mountain: 170, high_mountain: 160,
  cobbles: 160, classic: 230, itt: 27.5, ttt: 35,
});

// Sub-4s EGNE præsentations-tærskler — findes IKKE i backend. Motoren clamper
// distanceFactor blødt ([0.85, 1.2], se raceSimulator.distanceFactor); grafen
// har derimod brug for en diskret ja/nej-chip ("lang dag"/"kort dag"), så disse
// er en visningsbeslutning oven på motorens kontinuerlige model, ikke en kopi.
export const LONG_DAY_RATIO = 1.06;
export const SHORT_DAY_RATIO = 0.94;

/**
 * Point til førstepladsen på en stigning — SAMME regel som racePassages.scaleFor:
 * summit-finish på HC eller kategori 1 giver DOBBELT point (toppen ER stregen).
 * Ukendt/manglende kategori → 0, aldrig en kastet fejl.
 */
export function komPointsForClimb(climb) {
  const scale = KOM_SCALES[climb?.category];
  if (!scale || !scale.length) return 0;
  const points = scale[0];
  const doubles = climb?.summit_finish && (climb.category === "HC" || climb.category === "1");
  return doubles ? points * 2 : points;
}

/**
 * Etapens "hvad betyder ruten"-nøgler til i18n. Betingelserne er IDENTISKE med
 * motorens (stageGapModel + isTechnicalFinale i raceSimulator.js) — chippen må
 * aldrig påstå noget motoren ikke selv handler efter. Uden rutedata: tom liste
 * (samme gate som resten af Sub-4-fladen).
 * @returns {{key:string, params?:object}[]}
 */
export function routeReadKeys(profile) {
  if (!hasRouteData(profile)) return [];
  const D = Number(profile.distance_km);
  // Samme sortering som buildProfileSeries — "sidste stigning" skal være
  // geografisk sidst, ikke sidst i en vilkårlig DB-rækkefølge.
  const climbs = (Array.isArray(profile.climbs) ? profile.climbs : [])
    .slice()
    .sort((a, b) => Number(a.crest_km) - Number(b.crest_km));
  const lastClimb = climbs.length ? climbs[climbs.length - 1] : null;
  const gapFromLastCrest = lastClimb ? D - Number(lastClimb.crest_km) : null;
  const keys = [];

  // summit/valley er gensidigt udelukkende (jf. stageGapModel: en summit-finish
  // har INGEN nedkørsel at måle — bunch nulstilles i stedet).
  if (lastClimb?.summit_finish) {
    keys.push({ key: "summit" });
  } else if (gapFromLastCrest !== null && gapFromLastCrest >= VALLEY_MIN_DESCENT_KM) {
    keys.push({ key: "valley", params: { km: Math.round(gapFromLastCrest) } });
  }

  // Teknisk finale — kopi af raceSimulator.isTechnicalFinale's tre betingelser.
  const sectors = Array.isArray(profile.sectors) ? profile.sectors : [];
  const isTechnical = profile.finale_type === "descent"
    || (gapFromLastCrest !== null
        && gapFromLastCrest >= TECHNICAL_DESCENT_WINDOW_KM[0]
        && gapFromLastCrest <= TECHNICAL_DESCENT_WINDOW_KM[1])
    || sectors.some((s) => Number(s.start_km) + Number(s.length_km) >= D - 10);
  if (isTechnical) keys.push({ key: "technical" });

  const mid = DISTANCE_BAND_MIDPOINTS[profile.profile_type];
  if (mid) {
    const ratio = D / mid;
    if (ratio >= LONG_DAY_RATIO) keys.push({ key: "long" });
    else if (ratio <= SHORT_DAY_RATIO) keys.push({ key: "short" });
  }

  if (sectors.length > 0) keys.push({ key: "cobbles", params: { count: sectors.length } });

  return keys;
}

/**
 * Alle motorens waypoints for etapen, sorteret på km, til visning + klik-opslag
 * på grafen. `index` beregnes FØR den fælles km-sortering — positionen i
 * climbs[]/mellemsprint-listen, samme konvention som racePassages.computePassages
 * — så den matcher race_stage_passages.waypoint_index, og et klik kan slå det
 * ægte passage-resultat op fremfor at gætte ud fra rækkefølgen på grafen.
 * @returns {Array<{kind:"kom"|"sprint"|"finish", index:number, name:string|null,
 *   km:number, points:number, bonus:number, category?:string, length_km?:number,
 *   avg_gradient?:number, summit_finish?:boolean}>}
 */
export function waypointsFor(profile) {
  if (!hasRouteData(profile)) return [];
  const D = Number(profile.distance_km);
  // VIGTIGT: index kommer fra det RÅ array, IKKE en km-sorteret kopi.
  // racePassages.js:88 gør `climbs.map((c, i) => ({..., index: i}))` på
  // stageProfile.climbs UDEN at sortere først — waypoint_index i
  // race_stage_passages er altså positionen i rækkens rå rækkefølge. Sorterer
  // vi HER før vi tildeler index, kan et klik på grafen ramme en forkert
  // stignings passage-resultat, hvis climbs nogensinde står i ikke-km-orden.
  // Sortering til VISNING sker bagefter, på det færdige waypoint-array.
  const climbs = Array.isArray(profile.climbs) ? profile.climbs : [];
  const sprints = Array.isArray(profile.sprints) ? profile.sprints : [];
  const intermediates = sprints.filter((s) => s.kind === "intermediate");

  const komWps = climbs.map((c, i) => ({
    kind: "kom",
    index: i,
    name: c.name ?? null,
    km: Number(c.crest_km),
    points: komPointsForClimb(c),
    bonus: 0,
    category: c.category,
    length_km: c.length_km,
    avg_gradient: c.avg_gradient,
    summit_finish: !!c.summit_finish,
  }));
  const sprintWps = intermediates.map((s, i) => ({
    kind: "sprint",
    index: i,
    name: s.name ?? null,
    km: Number(s.km),
    points: INTERMEDIATE_SPRINT_SCALE[0] || 0,
    bonus: INTERMEDIATE_BONUS_SECONDS[0] || 0,
  }));
  // Grøn målskala pr. profile_type — ukendt type falder tilbage til "mountain",
  // SAMME fallback som racePassages.scaleFor() (`GREEN_FINISH_SCALES[profileType]
  // || GREEN_FINISH_SCALES.mountain`). Grafen skal vise det tal motoren rent
  // faktisk ville uddele, ikke et andet — profile_type er en CHECK-constraint-
  // enum i praksis, så denne gren rammes reelt aldrig af ægte data.
  const finishScale = GREEN_FINISH_SCALES[profile.profile_type] || GREEN_FINISH_SCALES.mountain;
  const isTimeTrial = profile.profile_type === "itt" || profile.profile_type === "ttt";
  const finishWp = {
    kind: "finish",
    index: 0,
    name: null,
    km: D,
    points: finishScale[0] || 0,
    // Ingen bonussekunder på en enkeltstart — der er ingen gruppe at tage tid fra.
    bonus: isTimeTrial ? 0 : (FINISH_BONUS_SECONDS[0] || 0),
  };

  // Visnings-sortering: km, og ved samme km kommer "kom" før "sprint" (samme
  // tiebreak som racePassages.js:90's `.sort((a,b) => a.km-b.km || (a.kind==="kom"?-1:1))`).
  return [...komWps, ...sprintWps, finishWp]
    .sort((a, b) => a.km - b.km || (a.kind === "kom" ? -1 : 1));
}
