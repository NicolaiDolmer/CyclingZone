// #2356 (S2: race-recap v2) — dramaturgi + variation oven på de EKSISTERENDE
// race_stage_moments (backend/lib/raceNarrative.js, S6). Ren præsentation: VÆLGER,
// ORDNER og VARIERER momenter backend allerede har afledt — ingen ny fortolkning
// af spilmekanik, ingen felter der ikke allerede findes i moment.params.
//
// Spec: docs/superpowers/specs/2026-07-11-narrative-systems-design.md §"System A"
// (A2 moment-vokabular, A3 significance, A4 rapport-dramaturgi). Content-batch
// (EN+DA-tekst): docs/superpowers/drafts/2026-07-11-narrative-content-batch.md §A.
//
// Determinisme (narrativ-invarianten): variant-valg = hash(raceId, stageNumber,
// nøgle) % antalVarianter (spec A4 "Variation") — SAMME etape giver SAMME
// fortælling ved hvert besøg, uafhængigt af sprog (kun TEKSTEN varierer pr.
// sprog, indekset er sprog-uafhængigt, jf. content-batchens regel).
//
// Degraderer ærligt: ingen vindermoment for denne etape (gammelt/PCM-løb, v3 var
// slukket for etapen, eller tabellen ikke migreret endnu) → buildRaceReport
// returnerer null. Kald-stedet (RaceDetailPage.jsx) falder tilbage til v1
// (raceRecap.js), samme mønster som WhyPanel/StoryTagBadges.
//
// fnv1aHash duplikeret bevidst fra backend/lib/raceSimulator.js's stableSeed
// (samme begrundelse som resten af kodebasens frontend/backend-duplikationer —
// ingen delt pakke mellem de to sider, jf. raceStageMoments.js's isStoryTagKey).
function fnv1aHash(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

// Deterministisk variant-indeks (0-baseret). variantCount < 1 → altid 0 (ingen
// variation defineret for nøglen, samme som kun v1 findes i i18n).
export function variantIndex(raceId, stageNumber, key, variantCount) {
  if (!variantCount || variantCount < 1) return 0;
  return fnv1aHash(`${raceId ?? ""}|${stageNumber ?? ""}|${key}`) % variantCount;
}

// Antal skabelon-varianter pr. nøgle — matcher `report.headline.*`/`lede.*`/
// `beat.*` i races.json (en+da, samme antal i begge sprog). Holdt i sync manuelt,
// samme mønster som WHY_PANEL_KEYS-listen i raceStageMoments.js. Testdækket
// (raceReport.test.js) mod de faktiske locale-filer, så et glemt v2 ikke bare
// falder tilbage til v1 uden varsel.
export const HEADLINE_VARIANT_COUNTS = Object.freeze({
  sprint_win: 3, close_win: 2, solo_win: 3, breakaway_survived: 2, gc_takeover: 2, final_gc: 2,
  itt_win: 2, ttt_win: 2, // #4373
});
export const LEDE_VARIANT_COUNTS = Object.freeze({
  bunch_sprint: 2, reduced_sprint: 1, solo: 2, breakaway: 1, generic: 1,
  time_trial: 2, team_time_trial: 1, // #4373
});
export const BEAT_VARIANT_COUNTS = Object.freeze({
  breakaway_caught: 2, breakaway_survived: 1, helper_shift: 2, form_peak: 2,
  favorite_off_day: 1, gc_takeover: 2, team_day: 1,
  aggression_no_cost: 2, saved_effort: 2, gave_everything: 2,
});

// #4373: itt_win/ttt_win er tidskørslernes vindermomenter (backend/lib/
// raceNarrative.js). Uden dem her fandt buildRaceReport intet vindermoment på en
// enkeltstart og degraderede til v1-recappen, som selv kaldte det en spurt.
const WIN_MOMENT_KEYS = ["sprint_win", "close_win", "solo_win", "itt_win", "ttt_win"];

function byKey(moments, key) {
  return moments.find((m) => m.moment_key === key) || null;
}

// Lede-nøgle = HVORDAN etapen blev afgjort (altid vindermomentet, uafhængigt af
// hvilket moment der endte med at blive rubrikken — fx en gc_takeover-rubrik
// beskriver STADIG en spurtsejr i leden).
export function ledeKeyForWinMoment(winMoment, stageMoments) {
  // #4373: enkeltstart og holdtidskørsel er to forskellige discipliner og deler
  // ikke formulering. Ligger FØRST, fordi ingen af de øvrige grene (udbrud,
  // spurt, solo) kan være sande på en tidskørsel.
  if (winMoment.moment_key === "itt_win") return "time_trial";
  if (winMoment.moment_key === "ttt_win") return "team_time_trial";
  if (winMoment.moment_key === "solo_win") return "solo";
  if (winMoment.moment_key === "close_win") return "reduced_sprint";
  const breakawaySurvived = byKey(stageMoments, "breakaway_survived");
  if (breakawaySurvived && breakawaySurvived.rider_ids?.[0] === winMoment.rider_ids?.[0]) return "breakaway";
  if (winMoment.moment_key === "sprint_win") return "bunch_sprint";
  return "generic";
}

// Rubrik-valg (spec A4 punkt 1): den STØRRE historie slår den rene etapesejr,
// når den rent faktisk er større (significance-sammenligning på de PERSISTEREDE
// scorer — ingen ny vægtning her). final_gc (sidste etape) vinder altid, da
// intet er større end selve løbssejren.
export function selectHeadlineMoment(stageMoments, winMoment) {
  const finalGc = byKey(stageMoments, "final_gc");
  if (finalGc) return finalGc;
  const gcTakeover = byKey(stageMoments, "gc_takeover");
  const breakawaySurvived = byKey(stageMoments, "breakaway_survived");
  if (breakawaySurvived && breakawaySurvived.rider_ids?.[0] === winMoment.rider_ids?.[0]) {
    return gcTakeover && (gcTakeover.significance ?? 0) > (breakawaySurvived.significance ?? 0) ? gcTakeover : breakawaySurvived;
  }
  if (gcTakeover && (gcTakeover.significance ?? 0) > (winMoment.significance ?? 0)) return gcTakeover;
  return winMoment;
}

// Fase-orden for "sådan foldede det sig ud" (spec A4 punkt 3): udbrud →
// selektion/hjælperarbejde/indsats → konsekvens. Beats INDEN for en fase
// sorteres efter significance (høj → lav); rækkefølgen MELLEM faser er FAST —
// dramaturgi (spænding før udfald), ikke en ren significance-top-liste. Højst
// ét beat pr. fase, så ingen fase kan dominere de 2-4 beats.
const PHASES = Object.freeze([
  { keys: ["breakaway_caught", "breakaway_survived"] },
  { keys: ["helper_shift", "favorite_off_day", "form_peak", "team_day", "tag_saved_effort", "tag_gave_everything"] },
  { keys: ["tag_aggression_no_cost"] },
  { keys: ["gc_takeover"] },
]);
const MAX_BEATS = 4;

// tag_-momenter genbruger beat-teksten UDEN 'tag_'-præfikset (aggression_no_cost/
// saved_effort/gave_everything har intet ikke-tag Tier1-beat-modstykke i dag).
function beatKeyFor(momentKey) {
  return momentKey.startsWith("tag_") ? momentKey.slice(4) : momentKey;
}

// 2-4 beats i FAST fase-orden (ikke significance-sorteret på tværs af faser).
// headline udelades altid (allerede fortalt i rubrik/lede) — undtagen
// tag_aggression_no_cost, som ALDRIG er en rubrik i sig selv, men som IKKE skal
// gentage sig hvis rytteren allerede er hovedpersonen i rubrikken (fx vandt fra
// udbrud OG fik tagget — samme fakta, ingen grund til at nævne det to gange).
export function selectBeats(stageMoments, headline) {
  if (!stageMoments?.length) return [];
  const used = new Set([headline?.moment_key].filter(Boolean));
  const beats = [];
  for (const phase of PHASES) {
    const candidates = stageMoments
      .filter((m) => phase.keys.includes(m.moment_key) && !used.has(m.moment_key))
      .filter((m) => !(m.moment_key === "tag_aggression_no_cost" && headline?.rider_ids?.includes(m.rider_ids?.[0])))
      .sort((a, b) => (b.significance ?? 0) - (a.significance ?? 0));
    if (candidates.length) {
      beats.push(candidates[0]);
      used.add(candidates[0].moment_key);
    }
    if (beats.length >= MAX_BEATS) break;
  }
  return beats.slice(0, MAX_BEATS);
}

/**
 * Byg en dramaturgisk etaperapport-plan (rene nøgler/varianter/moment-refs — INGEN
 * tekst; kald-stedet interpolerer via t() med races.json's `detail.report.*`).
 * @param {object} args
 * @param {string} [args.raceId]
 * @param {number} args.stageNumber
 * @param {Array} [args.moments]  ALLE løbets moments (race_stage_moments-rækker), filtreres internt til denne etape.
 * @returns {{ headline: {moment, variant}, lede: {key, variant, winMoment}, beats: Array<{moment, beatKey, variant}> } | null}
 */
export function buildRaceReport({ raceId, stageNumber, moments } = {}) {
  const stageMoments = (moments || []).filter((m) => (m.stage_number ?? 1) === stageNumber);
  const winMoment = stageMoments.find((m) => WIN_MOMENT_KEYS.includes(m.moment_key));
  if (!winMoment) return null; // ingen etapesejr-moment → degradér ærligt til v1 (raceRecap.js)

  const headline = selectHeadlineMoment(stageMoments, winMoment);
  const ledeKey = ledeKeyForWinMoment(winMoment, stageMoments);
  const beats = selectBeats(stageMoments, headline).map((m) => {
    const beatKey = beatKeyFor(m.moment_key);
    return { moment: m, beatKey, variant: variantIndex(raceId, stageNumber, `beat.${beatKey}`, BEAT_VARIANT_COUNTS[beatKey] ?? 1) };
  });

  return {
    headline: {
      moment: headline,
      variant: variantIndex(raceId, stageNumber, `headline.${headline.moment_key}`, HEADLINE_VARIANT_COUNTS[headline.moment_key] ?? 1),
    },
    lede: {
      key: ledeKey,
      winMoment,
      variant: variantIndex(raceId, stageNumber, `lede.${ledeKey}`, LEDE_VARIANT_COUNTS[ledeKey] ?? 1),
    },
    beats,
  };
}
