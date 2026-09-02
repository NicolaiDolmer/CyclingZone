// #4598 (ejer-design 2/9) — dagsform som 11 spillervendte trin (-5..5) i
// rytterens egen stemme til sin manager, KUN for spillerens eget hold.
//
// Ren visning: backend (raceNarrative.js) persisterer ÉT "dayform_line"-moment
// pr. rytter pr. etape i race_stage_moments, med params={riderId, band} — band
// er dayformBand()-oversættelsen (heltal -5..5), ALDRIG det rå kontinuerte
// dagsform-tal. Denne fil vælger BARE hvilken af de (min.) 4 i18n-varianter for
// det bånd der skal vises, deterministisk pr. (race_id, stage_number, rider_id)
// — samme FNV-1a-hash-mod-længde-mønster som backend/lib/boardVoice.js'
// hashSeed/sampleVoiceLine, så samme etape ALTID viser samme replik for samme
// rytter, uanset hvor mange gange resultatsiden genindlæses.
//
// Synlighed (fog-of-war, #3350/#3967): denne fil afgør IKKE hvem der må se
// linjen — det gør kalderen (RaceDetailPage.jsx), som kun renderer den når
// rider.team_id === myOwnTeamId. race_stage_moments' RLS er i dag "alle
// authenticated" (samme som de eksisterende tag_jour_sans/tag_peak_day-
// badges), så denne UI-gating er IKKE en data-lækage-garanti — se
// opfølgnings-issuet linket i #4598's PR-body.
//
// Kendte trin (matcher frontend/public/locales/{en,da}/races.json's
// detail.dayformLine-nøgler). JSON-nøgler undgår ledende "-" for robusthed.
export const DAYFORM_BAND_KEYS = Object.freeze({
  "-5": "band_m5", "-4": "band_m4", "-3": "band_m3", "-2": "band_m2", "-1": "band_m1",
  "0": "band_0",
  "1": "band_p1", "2": "band_p2", "3": "band_p3", "4": "band_p4", "5": "band_p5",
});

// Antal skrevne varianter pr. trin i races.json (min. 4 pr. ejerens krav).
// Hardcodet (ikke læst fra i18n-arrayets .length) fordi hash-modulo skal være
// STABIL uafhængig af hvornår oversættelsesressourcerne er loadet i browseren.
export const DAYFORM_LINE_VARIANT_COUNT = 4;

// Stabil 32-bit hash (FNV-1a) — dupliceret bevidst fra backend/lib/boardVoice.js'
// hashSeed (samme begrundelse som resten af kodebasens frontend/backend-
// duplikationer, se raceStageMoments.js's isStoryTagKey-note).
function fnv1a32(str) {
  let hash = 0x811c9dc5;
  const text = String(str ?? "");
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash >>> 0;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

// Finder DENNE rytters dayform_line-moment for DENNE etape (eller null — samme
// ærlig-degraderings-mønster som raceStageMoments.js: gammelt/PCM-løb uden
// components → intet moment → intet vises, aldrig en gættet linje).
//
// @param {Array<{moment_key, params, stage_number, rider_ids}>} moments
// @param {string|null} riderId
// @param {number|null} stageNumber  null (samlet-fanen) giver ALTID null —
//   dagsformen er per-etape, ikke et sæson-aggregat.
// @returns {{ band:number }|null}
export function dayformLineMoment(moments, riderId, stageNumber) {
  if (!riderId || stageNumber == null || !moments?.length) return null;
  const m = moments.find(
    (mm) =>
      mm.moment_key === "dayform_line" &&
      (mm.stage_number ?? 1) === stageNumber &&
      (mm.rider_ids || []).includes(riderId)
  );
  if (!m) return null;
  const bandRaw = Number(m.params?.band);
  if (!Number.isFinite(bandRaw)) return null;
  return { band: clamp(Math.round(bandRaw), -5, 5) };
}

// Bygger i18n-nøglen for DENNE rytters replik på DENNE etape, deterministisk.
// Kalderen slår selv nøglen op med t() — denne funktion rører aldrig i18n.
//
// @returns {string|null}  fx "detail.dayformLine.band_p3.2", eller null hvis
//   band er ugyldigt (bør ikke ske efter dayformLineMoment's egen clamp).
export function dayformLineI18nKey({ raceId, stageNumber, riderId, band }) {
  const bandKey = DAYFORM_BAND_KEYS[String(band)];
  if (!bandKey) return null;
  const seed = `dayform:${raceId ?? ""}:${stageNumber ?? ""}:${riderId ?? ""}`;
  const idx = fnv1a32(seed) % DAYFORM_LINE_VARIANT_COUNT;
  return `detail.dayformLine.${bandKey}.${idx}`;
}
