// developmentReport.js — rene helpers til Udvikling-fanen (#2000 stykke 5).
//
// Afleder chart-serier, sæson-vækst og udviklingslog-aggregater fra de ÆGTE
// evnevektor-snapshots (GET /api/riders/:id/development → rider_derived_
// ability_history) + trænings-historikken (useTrainingHistory). Ingen DB/React/
// Date — unit-testes isoleret med node --test.
//
// BEVIDST UDELADT (ejer-gate, samme disciplin som Træningsscore #2000): loft-
// linje, stiplet projektion mod loft og "til loft/alder ved loft". Per-type-loft
// kræver ability_caps, som er invertérbar til det server-skjulte potentiale
// (#1162) — en ærlig projektion skal komme fuzzy fra backend efter ejer-review.

import { riderTypeRating } from "./riderRating.js";
import { isBreakthrough } from "./trainingReport.js";

// Samme dato kan have flere snapshots (baseline-backfill + dagens trænings-tick,
// og på sæsonskifte-dagen også season_transition-punktet). Vinderen pr. dato:
// 1) HØJESTE season_number først — transition-punktet (nyt sæsonnummer, post-
//    progression) skal vinde over en præ-transition daily-række uanset hvilken
//    rækkefølge motorerne kørte i den dag (træning kan køre både før og efter
//    auto-transitionen; se review-fund #2000 stykke 5).
// 2) Derefter source-prioritet: daily_training er dagens slut-tilstand (inkl.
//    gevinst), season_transition sæsonskiftets resultat, baseline backfill-start.
const SOURCE_PRIORITY = { daily_training: 3, season_transition: 2, baseline: 1 };

function beats(row, prev) {
  const sa = row.season_number ?? -Infinity;
  const sb = prev.season_number ?? -Infinity;
  if (sa !== sb) return sa > sb;
  return (SOURCE_PRIORITY[row.source] ?? 0) >= (SOURCE_PRIORITY[prev.source] ?? 0);
}

// Rens + dedup: gyldige rækker, sorteret kronologisk (ASC), én pr. snapshot_date.
export function dedupeSnapshots(history) {
  const rows = (Array.isArray(history) ? history : []).filter(
    (r) => r && typeof r.snapshot_date === "string" && r.abilities && typeof r.abilities === "object",
  );
  const byDate = new Map();
  for (const row of rows) {
    const prev = byDate.get(row.snapshot_date);
    if (!prev || beats(row, prev)) byDate.set(row.snapshot_date, row);
  }
  return [...byDate.values()].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
}

// Chartets typer: primærtypen først (fremhævet linje), derefter de 2 højest-
// ratede øvrige typer ved SENESTE snapshot (tie-break = allKeys-rækkefølgen,
// dvs. RIDER_TYPE_KEYS' stabile orden). Mangler/ukendt primærtype → den
// højest-ratede type er primær.
export function pickChartTypeKeys(latestAbilities, primaryType, allKeys) {
  const keys = Array.isArray(allKeys) ? allKeys : [];
  if (keys.length === 0) return [];
  const rated = keys.map((key, i) => ({ key, i, rating: riderTypeRating(latestAbilities, key) }));
  rated.sort((a, b) => b.rating - a.rating || a.i - b.i);
  const primary = keys.includes(primaryType) ? primaryType : rated[0].key;
  const rest = rated.filter((r) => r.key !== primary).slice(0, 2).map((r) => r.key);
  return [primary, ...rest];
}

// Tidsserie for én type: [{ date, season, rating }] i snapshot-rækkefølge.
export function typeSeries(snapshots, typeKey) {
  return snapshots.map((s) => ({
    date: s.snapshot_date,
    season: s.season_number ?? null,
    rating: riderTypeRating(s.abilities, typeKey),
  }));
}

// Sammenhængende sæson-segmenter i snapshot-rækkefølge. season_number=null
// coalesces til forrige kendte sæson (leading nulls → første kendte) — vi
// opfinder aldrig et sæsonnummer der ikke findes i data.
export function seasonSegments(snapshots) {
  const known = snapshots.map((s) => s.season_number).filter((n) => n != null);
  if (snapshots.length === 0) return [];
  let current = known.length > 0 ? known[0] : null;
  const segments = [];
  snapshots.forEach((s, i) => {
    const season = s.season_number ?? current;
    current = season;
    const last = segments[segments.length - 1];
    if (last && last.season === season) last.endIndex = i;
    else segments.push({ season, startIndex: i, endIndex: i });
  });
  return segments;
}

// Registreret vækst for én type inden for én sæson: første → seneste snapshot.
// null hvis sæsonen ikke findes i data.
export function seasonDelta(snapshots, typeKey, seasonNumber) {
  const seg = seasonSegments(snapshots).find((s) => s.season === seasonNumber);
  if (!seg) return null;
  const from = riderTypeRating(snapshots[seg.startIndex].abilities, typeKey);
  const to = riderTypeRating(snapshots[seg.endIndex].abilities, typeKey);
  return { from, to, delta: to - from };
}

// Registrerede evne-gevinster inden for én sæson (seneste minus første snapshot).
// Returnerer { gains: [{ ability, delta }] (kun positive, faldende), totalPoints }.
export function seasonAbilityGains(snapshots, seasonNumber) {
  const seg = seasonSegments(snapshots).find((s) => s.season === seasonNumber);
  if (!seg) return { gains: [], totalPoints: 0 };
  const first = snapshots[seg.startIndex].abilities;
  const last = snapshots[seg.endIndex].abilities;
  const gains = [];
  let totalPoints = 0;
  for (const [ability, rawTo] of Object.entries(last)) {
    const to = Number(rawTo);
    const from = Number(first?.[ability]);
    if (!Number.isFinite(to) || !Number.isFinite(from)) continue;
    const delta = to - from;
    if (delta > 0) {
      gains.push({ ability, delta });
      totalPoints += delta;
    }
  }
  gains.sort((a, b) => b.delta - a.delta || a.ability.localeCompare(b.ability));
  return { gains, totalPoints };
}

// Dominerende træningsplan fra rytterens run-entries (riderHistoryFromRuns-form):
// hyppigste fokus blandt dage med et fokus, + hyppigste intensitet på de dage.
// null hvis ingen fokus-dage (fx ingen træning kørt endnu).
export function dominantPlan(entries) {
  const focusCount = new Map();
  const intensityCount = new Map();
  for (const e of Array.isArray(entries) ? entries : []) {
    const row = e?.row;
    if (!row?.focus) continue;
    focusCount.set(row.focus, (focusCount.get(row.focus) ?? 0) + 1);
    if (row.intensity) intensityCount.set(row.intensity, (intensityCount.get(row.intensity) ?? 0) + 1);
  }
  const top = (m) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null;
  const focus = top(focusCount);
  if (!focus) return null;
  return { focus, intensity: top(intensityCount) };
}

// Antal dage med mindst én evne-gevinst i run-entries.
export function gainDayCount(entries) {
  return (Array.isArray(entries) ? entries : []).filter((e) => isBreakthrough(e?.row)).length;
}

// ── Loft-udsigt (#2645 Del A) ────────────────────────────────────────────────────
//
// Bug (spillerrapport 18/7): en rytter med evne 29 og loft 90+ fik teksten
// "Approaching ceiling" — fordi backendens ceilingTiming() returnerer null når den
// optimistiske envelope ikke når loft-båndet inden for DISPLAY_SEASONS (6 sæsoner),
// UANSET hvor stort gabet reelt er. Frontend brugte det null-resultat som eneste
// betingelse for "approaching", og blandede dermed evne/loft-familien ("approaching
// ceiling") sammen med tilfælde der reelt bare er en lang udviklingshorisont.
//
// To besked-familier må ALDRIG låne hinandens ord (#2645): ALDER/peak-vindue
// ("past peak") vs. EVNE/loft-afstand ("approaching ceiling"). En loft-besked må
// kun vises når rytterens nu-rating faktisk er tæt på det konservative loft
// (ceilLo) — her sat til ≥85% (ejer-valgt tærskel, #2645 Del A accept-kriterie).
export const NEAR_CEILING_RATIO = 0.85;

// Outlook-i18n-nøgle for grenen uden ren "til loft"-ETA (projection.timing == null):
//   • pastPeak (alder > PEAK_AGE)                     → "pastPeak" (alders-familien)
//   • ikke pastPeak, men now/ceilLo ≥ NEAR_CEILING_RATIO → "approaching" (reelt tæt på)
//   • ellers (stort gab, bare uden for display-vinduet) → "gapToCeiling" (ærlig, neutral)
// Kræver projection.now + projection.ceil.lo — begge findes altid når
// projectionActive(projection) er sand (se RiderDevelopmentTab.jsx).
export function ceilingOutlookKey(projection) {
  if (projection?.pastPeak) return "pastPeak";
  const now = projection?.now;
  const ceilLo = projection?.ceil?.lo;
  if (typeof now === "number" && typeof ceilLo === "number" && ceilLo > 0 && now / ceilLo >= NEAR_CEILING_RATIO) {
    return "approaching";
  }
  return "gapToCeiling";
}
