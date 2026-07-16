// Race Engine v3 (#2224), slice S6 (#2355) — pure client helpers over persisted
// race_stage_moments rows. Ren præsentations-lag: ingen ny fortolkning af
// spilmekanik her, kun filtrering/gruppering af hvad backenden (raceNarrative.js)
// allerede har afledt. Degraderer ærligt: tom/manglende moments → tomme lister,
// aldrig kast (samme regel som raceRecap.js).
//
// isStoryTagKey duplikeret bevidst fra backend/lib/raceNarrative.js (samme
// begrundelse som resten af kodebasens frontend/backend-duplikationer — ingen
// delt pakke mellem de to sider).
export function isStoryTagKey(momentKey) {
  return typeof momentKey === "string" && momentKey.startsWith("tag_");
}

export function momentsForStage(moments, stageNumber) {
  if (!moments?.length) return [];
  return moments.filter((m) => (m.stage_number ?? 1) === stageNumber);
}

// "Beats" — etape-fortællingens Tier1-momenter der ENDNU IKKE har et modstykke
// i v1-referatet (raceRecap.js dækker allerede sprint/solo/close-win, udbrud,
// hold-dagen og de mest markante uheld — at gengive dem her ville bare duplikere
// samme sætning to steder). Kun de NYE komponent-afledte forklaringer vises.
const WHY_PANEL_KEYS = new Set(["gc_takeover", "final_gc", "helper_shift", "favorite_off_day", "form_peak"]);

export function whyBeatsForStage(moments, stageNumber) {
  return momentsForStage(moments, stageNumber).filter((m) => WHY_PANEL_KEYS.has(m.moment_key));
}

// Story-tags for én rytter. stageNumber=null søger på tværs af HELE løbet
// (bruges på "samlet"-fanen, hvor en tidligere etapes offer/kollaps stadig er
// relevant kontekst for slut-klassementet).
export function storyTagsForRider(moments, riderId, stageNumber = null) {
  if (!riderId || !moments?.length) return [];
  const scoped = stageNumber != null ? momentsForStage(moments, stageNumber) : moments;
  const seen = new Set();
  const out = [];
  for (const m of scoped) {
    if (!isStoryTagKey(m.moment_key)) continue;
    if (!(m.rider_ids || []).includes(riderId)) continue;
    if (seen.has(m.moment_key)) continue; // samme tag flere etaper på "samlet" → vis kun én gang
    seen.add(m.moment_key);
    out.push(m);
  }
  return out;
}
