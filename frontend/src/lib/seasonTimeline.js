// Z1 v0 — Season-visningens rene geometri (#1146, Planning Center fase 2 §2 Z1).
// Datolineal + løbs-bænde over sæsonens datospænd. Alt her er dato-matematik og
// lane-pakning uden IO, så det kan testes med node --test og genbruges
// sæson-agnostisk (spec-krav B7: tidslinje-komponenter bygges sæson-agnostiske).
//
// Dato-konvention: alle datoer er "YYYY-MM-DD"-strenge i spillets kalender
// (Europe/Copenhagen-datoer). Aritmetik sker via Date.UTC på dag-granularitet,
// så lokal browser-tidszone aldrig kan forskyde en dag (kendt fejlklasse).

/** "YYYY-MM-DD" → heltals-dagindeks (dage siden epoch, TZ-frit). */
export function dayIndex(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  if (!y || !m || !d) return null;
  return Math.round(Date.UTC(y, m - 1, d) / 86400000);
}

/** Dagindeks → "YYYY-MM-DD" (invers af dayIndex). */
export function isoOfDayIndex(idx) {
  return new Date(idx * 86400000).toISOString().slice(0, 10);
}

/**
 * Sæsonens datospænd ud fra løbenes bænde: [min startDate, max endDate].
 * Returnerer null hvis der ingen gyldige bænde er.
 */
export function seasonRange(bands) {
  let lo = null, hi = null;
  for (const b of bands || []) {
    const s = dayIndex(b.startDate), e = dayIndex(b.endDate);
    if (s == null || e == null) continue;
    if (lo == null || s < lo) lo = s;
    if (hi == null || e > hi) hi = e;
  }
  return lo == null ? null : { startIso: isoOfDayIndex(lo), endIso: isoOfDayIndex(hi) };
}

/**
 * Et datospænd → {leftPct, widthPct} på linealen. Hver kalenderdag har samme
 * bredde; et bånd dækker sine dage INKLUSIVT (endagsløb = én dags bredde).
 * Dage udenfor linealen klippes; helt udenfor → null.
 */
export function spanToRect(startIso, endIso, railStartIso, railEndIso) {
  const s = dayIndex(startIso), e = dayIndex(endIso);
  const r0 = dayIndex(railStartIso), r1 = dayIndex(railEndIso);
  if (s == null || e == null || r0 == null || r1 == null) return null;
  const total = r1 - r0 + 1;
  if (total <= 0 || e < r0 || s > r1) return null;
  const cs = Math.max(s, r0), ce = Math.min(e, r1);
  return {
    leftPct: ((cs - r0) / total) * 100,
    widthPct: ((ce - cs + 1) / total) * 100,
  };
}

/** Én dato → midtpunkts-position i procent (til TODAY-markøren). Udenfor → null. */
export function dateToPct(iso, railStartIso, railEndIso) {
  const d = dayIndex(iso), r0 = dayIndex(railStartIso), r1 = dayIndex(railEndIso);
  if (d == null || r0 == null || r1 == null || d < r0 || d > r1) return null;
  const total = r1 - r0 + 1;
  return ((d - r0 + 0.5) / total) * 100;
}

/**
 * Uge-ticks til linealen: start-dato, derefter hver 7. dag, og slut-dato.
 * En mellemtick der falder < 4 dage fra slut-ticken droppes, så de to labels
 * ikke kolliderer (mockup: 25/8, 1/9, 8/9, 15/9, 21/9 — 15→21 er kun 6 dage).
 * Returnerer [{iso, pct, edge: "start"|"end"|null}].
 */
export function buildWeekTicks(railStartIso, railEndIso) {
  const r0 = dayIndex(railStartIso), r1 = dayIndex(railEndIso);
  if (r0 == null || r1 == null || r1 < r0) return [];
  const ticks = [{ iso: railStartIso, pct: dateToPct(railStartIso, railStartIso, railEndIso), edge: "start" }];
  for (let d = r0 + 7; d < r1 - 3; d += 7) {
    const iso = isoOfDayIndex(d);
    ticks.push({ iso, pct: dateToPct(iso, railStartIso, railEndIso), edge: null });
  }
  if (r1 > r0) ticks.push({ iso: railEndIso, pct: dateToPct(railEndIso, railStartIso, railEndIso), edge: "end" });
  return ticks;
}

/**
 * Lane-pakning: fordel bænde på vandrette baner uden dato-overlap i samme bane.
 * Sortering (stabil): længste spænd først (GT'er lægger sig øverst som i
 * mockuppen), dernæst tidligste start. Grådig first-fit pr. bane.
 * Returnerer bændene beriget med `lane` (0-indekseret) + `laneCount` på arrayet.
 */
export function packLanes(bands) {
  const valid = (bands || [])
    .map((b) => ({ ...b, _s: dayIndex(b.startDate), _e: dayIndex(b.endDate) }))
    .filter((b) => b._s != null && b._e != null && b._e >= b._s);
  valid.sort((a, b) => (b._e - b._s) - (a._e - a._s) || a._s - b._s);
  const lanes = []; // pr. bane: liste af [s, e]-intervaller
  for (const b of valid) {
    let placed = false;
    for (let i = 0; i < lanes.length; i++) {
      if (lanes[i].every(([s, e]) => b._e < s || b._s > e)) {
        lanes[i].push([b._s, b._e]);
        b.lane = i;
        placed = true;
        break;
      }
    }
    if (!placed) {
      lanes.push([[b._s, b._e]]);
      b.lane = lanes.length - 1;
    }
  }
  const out = valid.map(({ _s, _e, ...rest }) => rest);
  out.laneCount = lanes.length;
  return out;
}

/** Bænde hvis datospænd (inklusivt) dækker den givne dag. */
export function bandsCoveringDay(bands, iso) {
  const d = dayIndex(iso);
  if (d == null) return [];
  return (bands || []).filter((b) => {
    const s = dayIndex(b.startDate), e = dayIndex(b.endDate);
    return s != null && e != null && s <= d && d <= e;
  });
}

/**
 * Dag-panelets default-fokus: første dag ≥ `todayIso` hvor mindst ét løb uden
 * gemt udtagelse er aktivt ("… · 1 open"). Er alt udtaget → første kommende dag
 * med løb overhovedet. Intet kommende → null. Returnerer "YYYY-MM-DD".
 */
export function nextFocusDayIso(bands, todayIso) {
  const t = dayIndex(todayIso);
  if (t == null) return null;
  const covered = new Set(), open = new Set();
  for (const b of bands || []) {
    const s = dayIndex(b.startDate), e = dayIndex(b.endDate);
    if (s == null || e == null) continue;
    for (let d = Math.max(s, t); d <= e; d++) {
      covered.add(d);
      if (!b.hasSelection) open.add(d);
    }
  }
  const pick = (set) => (set.size ? Math.min(...set) : null);
  const day = pick(open) ?? pick(covered);
  return day == null ? null : isoOfDayIndex(day);
}

/**
 * 1-baseret løbsdag-ordinal (boardets `?day=`-akse, jf. backend/lib/seasonDay.js:
 * dansk KALENDERDAG, dag 1 = sæsonens tidligste etape-dato). `seasonFirstIso`
 * SKAL være den tidligste dato på tværs af ALLE puljer, ikke kun egen pulje.
 */
export function seasonDayOrdinal(iso, seasonFirstIso) {
  const d = dayIndex(iso), f = dayIndex(seasonFirstIso);
  if (d == null || f == null) return null;
  return d - f + 1;
}

/**
 * Visuel min-bredde: et endagsløb på en 28-dages lineal er ~3,6 % bredt — for
 * smalt til sit navn. Spændet UDVIDES (kun mod højre; ankeret er startdatoen)
 * til mindst `minDays` kalenderdage FØR pakning, så labels kan læses og to
 * nære endagsløb aldrig overlapper visuelt i samme bane. Stats/dag-panel skal
 * bruge de RIGTIGE datoer — kald denne kun på render/pakke-vejen.
 */
export function padVisualSpan(bands, minDays = 2) {
  return (bands || []).map((b) => {
    const s = dayIndex(b.startDate), e = dayIndex(b.endDate);
    if (s == null || e == null) return b;
    const spanDays = e - s + 1;
    if (spanDays >= minDays) return b;
    return { ...b, endDate: isoOfDayIndex(s + minDays - 1) };
  });
}
