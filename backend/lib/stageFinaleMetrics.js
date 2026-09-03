// backend/lib/stageFinaleMetrics.js
// #4272 (ejer-beslutning 26/8): måle- og GATE-laget for HVORDAN etaperne slutter.
//
// HVORFOR: kalenderen målte allerede "slutter det for tit nedad?" (#4218-scorecardet)
// men håndhævede intet. Udfaldet var derfor drevet af tilfældigheder i vægtene frem for
// af en regel — og det var gået galt to steder på én gang:
//   · `mountain` sluttede NEDAD 59-70 % i D1-D3 og opad kun 6-13 % (omvendt af
//     virkeligheden, præcis klagen i #3426)
//   · `hilly` sluttede opad 33-86 % afhængigt af division — ingen regel, så hver
//     division fik sit eget udfald
// `high_mountain` og `flat` var derimod sunde, hvilket viste at generatoren godt KAN
// ramme rigtigt når reglen findes.
//
// Ren funktion — ingen DB/RNG. Samme mønster som stageOrderMetrics.js og
// calendarCompositionTargets.js: tallene er DATA, målingen er en ren funktion over
// GENEREREDE etaper (ikke over persisterede rækker, som beskriver en ældre generator).

// finale_type → finale-KLASSE. Ejerens tabel er formuleret i klasser, ikke i de syv
// rå finale_types: "opad" = long_climb + punch · "fladt" = bunch_sprint + reduced_sprint.
export const FINALE_CLASS_BY_TYPE = Object.freeze({
  long_climb: "up", punch: "up",
  bunch_sprint: "flat", reduced_sprint: "flat",
  descent: "down",
  breakaway: "break",
  solo_tt: "tt",
});

export const FINALE_CLASSES = Object.freeze(["up", "flat", "down", "break", "tt"]);

export const CLASS_LABELS = Object.freeze({
  up: "opad", flat: "fladt", down: "nedad", break: "udbrud", tt: "enkeltstart",
});

export function finaleClass(finaleType) {
  return FINALE_CLASS_BY_TYPE[finaleType] ?? null;
}

// ── Ejerens bånd pr. terræntype (issue #4272, godkendt tal for tal 26/8) ───────────
//
// Samme bånd i ALLE fire divisioner — ejeren: "I alle divisioner: Lav et bånd angående
// hvor mange af de forskellige typer der slutter nedad, fladt og opad."
//
// En klasse der IKKE står i et terrænbånd er markeret "—" i ejerens tabel og har
// VÆGT 0 i FINALE_WEIGHTS_BY_PROFILE (raceStageProfileGenerator.js) — "ikke nævnt" og
// "kan ikke forekomme" er samme ting, så en bunch_sprint i højbjerget er et brud, ikke
// en tolereret sjældenhed. Derfor gates uspecificerede klasser mod 0.
//
// `classic` står bevidst IKKE i tabellen: ejerens tabel dækker de terræner kalenderen
// komponeres af, og classic er monument-arketypen (Lombardia slutter opad, Sanremo
// samlet). Den RAPPORTERES men bånd-gates ikke — se BANDED_PROFILES.
export const TERRAIN_FINALE_BANDS = Object.freeze({
  high_mountain: Object.freeze({ up: [80, 100], down: [0, 15] }),
  mountain:      Object.freeze({ up: [45, 65], down: [20, 35], break: [10, 25] }),
  hilly:         Object.freeze({ up: [40, 60], flat: [15, 30], break: [15, 30] }),
  cobbles:       Object.freeze({ flat: [30, 50], break: [40, 60] }),
  // #4105/#4270: EJEREN HAR BESLUTTET 3/9 at grus faar SAMME finale-baand som brosten
  // ("naesten samme type"). Raekken staar bevidst IKKE her endnu, og det er et aabent
  // punkt, ikke en forglemmelse:
  //
  //   grus-sporet (#4708) giver `gravel` vaegtene breakaway 55 / punch 25 /
  //   reduced_sprint 20 i FINALE_WEIGHTS_BY_PROFILE. Oversat til finale-klasser er det
  //   udbrud 55 % · opad 25 % · fladt 20 % - og brostens-baandet (fladt 30-50,
  //   udbrud 40-60, opad 0) kan IKKE rammes af dem. Et baand generatorens egne vaegte
  //   ikke kan naa er en garanti uden forsyning, ikke en garanti
  //   (.claude/learnings/2026-08-06-garanti-uden-forsyning-blokerede-s3-kalenderen.md),
  //   og stageFinaleMetrics.test.js faelder den med det samme.
  //
  // De to ting skal derfor landes SAMMEN: baandet her + vaegtene i
  // raceStageProfileGenerator.js. Se docs/CALENDAR_RULES.md §5 og §11.

  rolling:       Object.freeze({ flat: [25, 45], break: [55, 75] }),
  flat:          Object.freeze({ flat: [90, 100] }),
  itt:           Object.freeze({ tt: [100, 100] }),
  itt_hilly:     Object.freeze({ tt: [100, 100] }),
  ttt:           Object.freeze({ tt: [100, 100] }),
});

export const BANDED_PROFILES = Object.freeze(Object.keys(TERRAIN_FINALE_BANDS));

// Samlet bånd på tværs af ALLE etaper i en division (ejeren, samme beslutning):
// "opad 25-32 % · fladt 32-40 % · nedad højst 10 % · udbrud 12-20 %. Samme i alle
// divisioner, så pyramiden ikke kan vende om."
export const OVERALL_FINALE_BAND = Object.freeze({
  up: [25, 32], flat: [32, 40], down: [0, 10], break: [12, 20],
});

// ── Stikprøve-reglen (hvorfor båndene ikke gates råt pr. division) ────────────────
//
// Et løbs parcours er seedet på løbets VIRKELIGE identitet (external_id), så DET SAMME
// løb har DET SAMME parcours i alle fire divisioner — en bevidst, dokumenteret
// invariant (raceStageProfileGenerator.js v2). Konsekvensen er at en divisions
// finale-fordeling ikke kan styres direkte: divisionen er en STIKPRØVE af katalogets
// løb, og andelen svinger binomialt omkring generatorens vægt.
//
// Med n = 10-40 etaper pr. terræntype pr. division er standardfejlen 8-16 pp. Et råt
// ±0 pp-bånd ville derfor være rødt på en KORREKT generator omtrent hver tredje gang —
// præcis den fejl #3469 allerede har betalt for én gang ("en gate der altid kræver et
// flag er en gate ingen længere læser", calendarCompositionTargets.js).
//
// Derfor gates der i TO lag:
//   1. SÆSON-AGGREGATET (alle fire divisioner lagt sammen, n = 20-90 pr. terræntype)
//      mod det RÅ bånd. Det er her garantien "bjergetaper slutter opad" reelt bor.
//   2. PR. DIVISION mod båndet udvidet med SAMPLE_ALLOWANCE_SE standardfejl, og kun
//      når divisionen har mindst MIN_SAMPLE etaper af terrænet. Det fanger stadig en
//      ægte regression (bjerg-opad 6-13 % mod bånd 45-65 % ryger ud med margin) uden
//      at være rød på ren stikprøvestøj.
export const MIN_SAMPLE = 12;
export const SAMPLE_ALLOWANCE_SE = 2;

// Standardfejl på en andel (i procentpoint) for n observationer omkring p (0-1).
// Gulvet på 0,01 forhindrer at en observeret andel på præcis 0 % eller 100 % giver
// tillæg 0 og dermed et hårdere krav end midt i båndet.
function standardErrorPp(p, n) {
  if (!n) return 0;
  return 100 * Math.sqrt(Math.max(p * (1 - p), 0.01) / n);
}

const emptySlot = () => ({ total: 0, counts: Object.fromEntries(FINALE_CLASSES.map((c) => [c, 0])), unknown: 0 });

const withPct = (slot) => ({
  ...slot,
  pct: Object.fromEntries(FINALE_CLASSES.map((c) => [c, slot.total ? (slot.counts[c] / slot.total) * 100 : 0])),
});

/**
 * Tæl finale-klasser pr. terræntype og samlet for ét sæt genererede løb.
 *
 * Puljer i samme tier deler identisk løbssæt OG identisk parcours (#2276) — kald derfor
 * med ÉN repræsentativ pulje pr. division, aldrig med alle puljer.
 *
 * @param {Array<{stages:Array<{profile_type:string, finale_type:string|null}>}>} races
 */
export function computeFinaleStats(races = []) {
  const byProfile = new Map();
  const overall = emptySlot();

  for (const r of races) {
    for (const st of r?.stages ?? []) {
      const p = st?.profile_type;
      if (!p) continue;
      if (!byProfile.has(p)) byProfile.set(p, emptySlot());
      const slot = byProfile.get(p);
      const cls = finaleClass(st?.finale_type);
      slot.total += 1;
      overall.total += 1;
      if (cls) { slot.counts[cls] += 1; overall.counts[cls] += 1; }
      else { slot.unknown += 1; overall.unknown += 1; }
    }
  }

  return {
    total: overall.total,
    overall: withPct(overall),
    byProfile: Object.fromEntries([...byProfile.entries()].map(([p, slot]) => [p, withPct(slot)])),
  };
}

/** Læg flere divisioners stats sammen til ét sæson-aggregat. */
export function mergeFinaleStats(statsList = []) {
  const merged = new Map();
  const overall = emptySlot();
  for (const s of statsList) {
    if (!s) continue;
    overall.total += s.overall.total;
    overall.unknown += s.overall.unknown;
    for (const c of FINALE_CLASSES) overall.counts[c] += s.overall.counts[c];
    for (const [p, slot] of Object.entries(s.byProfile ?? {})) {
      if (!merged.has(p)) merged.set(p, emptySlot());
      const m = merged.get(p);
      m.total += slot.total;
      m.unknown += slot.unknown;
      for (const c of FINALE_CLASSES) m.counts[c] += slot.counts[c];
    }
  }
  return {
    total: overall.total,
    overall: withPct(overall),
    byProfile: Object.fromEntries([...merged.entries()].map(([p, slot]) => [p, withPct(slot)])),
  };
}

/**
 * Bånd-brud for ÉT sæt stats.
 *
 * @param {object}  p.stats   computeFinaleStats/mergeFinaleStats-output
 * @param {string}  p.label   fx "division 1" eller "sæson"
 * @param {boolean} p.strict  true = rå bånd (sæson-aggregatet), false = bånd + stikprøve-tillæg
 */
export function detectFinaleViolations({ stats, label = "sæson", strict = false } = {}) {
  const violations = [];
  // 0 etaper er fravær af evidens, ikke et opfyldt krav — meld det, gæt ikke grønt (#2854).
  if (!stats || !stats.total) return [`${label}: 0 etaper at måle finaler på — båndene kan ikke vurderes (#4272)`];

  if (stats.overall.unknown > 0) {
    violations.push(`${label}: ${stats.overall.unknown} etaper har ukendt/manglende finale_type (#4272)`);
  }

  const check = (got, [lo, hi], n, what) => {
    let loEff = lo, hiEff = hi;
    if (!strict) {
      const allow = SAMPLE_ALLOWANCE_SE * standardErrorPp(got / 100, n);
      loEff = Math.max(0, lo - allow);
      hiEff = Math.min(100, hi + allow);
    }
    if (got < loEff - 1e-9 || got > hiEff + 1e-9) {
      violations.push(
        `${label}: ${what} ${got.toFixed(1)} % (bånd ${lo}-${hi} %` +
        `${strict ? "" : `, stikprøve-tillæg → ${loEff.toFixed(1)}-${hiEff.toFixed(1)} %`}, n=${n}) (#4272)`
      );
    }
  };

  for (const profile of BANDED_PROFILES) {
    const slot = stats.byProfile?.[profile];
    if (!slot || !slot.total) continue;
    if (!strict && slot.total < MIN_SAMPLE) continue;
    const bands = TERRAIN_FINALE_BANDS[profile];
    for (const cls of FINALE_CLASSES) {
      check(slot.pct[cls], bands[cls] ?? [0, 0], slot.total, `${profile} slutter ${CLASS_LABELS[cls]}`);
    }
  }

  for (const [cls, band] of Object.entries(OVERALL_FINALE_BAND)) {
    check(stats.overall.pct[cls], band, stats.total, `SAMLET ${CLASS_LABELS[cls]}`);
  }

  return violations;
}
