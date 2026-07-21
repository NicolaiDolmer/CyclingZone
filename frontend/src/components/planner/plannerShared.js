// Season Planner — delte konstanter + rene geometri/format-hjælpere for cockpittet.
//
// Palette bruger appens CSS-tokens (ikke hardcodet hex) så master-canvasset temaer
// korrekt i BÅDE lyst (chalk/navy/gold, som mockuppen) og mørkt tema. De "navy"
// elementer (realiseret kurve, build/taper-skygge) bruger --text-1 (primær-blæk),
// der er mørkt på chalk og lyst på mørk baggrund — altid synligt.

export const CZ = {
  ink: "var(--text-1)",
  t2: "var(--text-2)",
  t3: "var(--text-3)",
  card: "var(--bg-card)",
  body: "var(--bg-body)",
  subtle: "var(--bg-subtle)",
  border: "var(--border)",
  gold: "rgb(var(--accent))",
  goldDeep: "rgb(var(--accent-t))",
};

const DAY_MS = 86_400_000;

// "YYYY-MM-DD" → CET-kalenderdag-ordinal (spejl af backend racePeakPlans.
// dateStringToOrdinal, så frontend-vinduer og motor-vinduer ligger på samme skala).
export function dateToOrdinal(dateStr) {
  if (!dateStr) return null;
  const ms = Date.parse(`${String(dateStr).slice(0, 10)}T00:00:00Z`);
  return Number.isFinite(ms) ? ms / DAY_MS : null;
}

// Ordinal → { year, monthIndex, day } (UTC, som ordinalen blev udledt i).
function ordinalToParts(ord) {
  const d = new Date(ord * DAY_MS);
  return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth(), day: d.getUTCDate() };
}

// Måneds-ticks (den 1. i hver måned) inden for [startOrd, endOrd] til den tids-
// proportionale kalender-akse. monthsLabels = 12-element lokaliseret array.
export function monthTicks(startOrd, endOrd, monthsLabels) {
  const ticks = [];
  if (startOrd == null || endOrd == null || endOrd <= startOrd) return ticks;
  const start = ordinalToParts(Math.floor(startOrd));
  let y = start.year, m = start.monthIndex;
  for (let guard = 0; guard < 48; guard++) {
    const ord = Date.parse(`${y}-${String(m + 1).padStart(2, "0")}-01T00:00:00Z`) / DAY_MS;
    if (ord > endOrd) break;
    if (ord >= startOrd) ticks.push({ ord, label: monthsLabels?.[m] ?? String(m + 1) });
    m += 1;
    if (m > 11) { m = 0; y += 1; }
  }
  return ticks;
}

// Kort dansk/engelsk dato "12 Jun" fra ordinal (til peak-vindue-labels i skuffen).
export function formatOrdinalShort(ord, monthsLabels) {
  if (ord == null) return "";
  const p = ordinalToParts(Math.round(ord));
  return `${p.day} ${monthsLabels?.[p.monthIndex] ?? ""}`.trim();
}

// Kompakt dato-label for et løb: enkelt dag "12 Aug", eller datospænd for et
// etapeløb "12-15 Aug" (samme måned) / "29 Jul - 2 Aug" (måned-skift). #2519.
// Beregnet ren frontend-side fra `date` (kalenderdag for gameDayStart) +
// gameDayEnd-gameDayStart — game-day-indeks mapper 1:1 til kalenderdage i denne
// sæson-motor (dayDateMap i backend/lib/raceCalendar.js), så spændet er præcist
// selv når etaper har en hviledag imellem. Boardet leverer ikke et separat
// etape-slutdato-felt i dag, og dette er frontend-only arbejde (rør ikke API'et).
export function formatRaceDateLabel(race, monthsLabels) {
  const startOrd = dateToOrdinal(race?.date);
  if (startOrd == null) return "";
  const rawSpan = (race?.gameDayEnd ?? race?.gameDayStart ?? 0) - (race?.gameDayStart ?? 0);
  const spanDays = Number.isFinite(rawSpan) && rawSpan > 0 ? rawSpan : 0;
  if (spanDays === 0) return formatOrdinalShort(startOrd, monthsLabels);
  const endOrd = startOrd + spanDays;
  const p1 = ordinalToParts(Math.round(startOrd));
  const p2 = ordinalToParts(Math.round(endOrd));
  const m1 = monthsLabels?.[p1.monthIndex] ?? "";
  if (p1.monthIndex === p2.monthIndex && p1.year === p2.year) return `${p1.day}-${p2.day} ${m1}`.trim();
  const m2 = monthsLabels?.[p2.monthIndex] ?? "";
  return `${p1.day} ${m1} - ${p2.day} ${m2}`.trim();
}

// Sæson-løb til den scannbare løbs-liste (#2568): filtrér mine/alle + gyldig dato,
// berig med ordinal + fortids-flag, sortér kronologisk. Ren funktion (samme
// filter-diskriminator som MasterCanvas.visRaces, så listen og tidslinjen altid
// viser præcis samme løbsmængde). nowOrd må være null (så er intet "kørt").
export function racesForList(races, filter, nowOrd) {
  return (races || [])
    .filter((r) => r.date && (filter === "all" || r.isMine))
    .map((r) => {
      const ord = dateToOrdinal(r.date);
      return { ...r, ord, isPast: nowOrd != null && ord != null && ord < nowOrd };
    })
    .filter((r) => r.ord != null)
    .sort((a, b) => a.ord - b.ord);
}

// Antal af MINE ryttere der (ægte eller foreslået) topper mod hvert løb → race_id
// → count. Bruges af løbs-listen til "N peaks her"-chippen; spejler board'ets
// targetRaceId-optælling, men kun over egne ryttere (rival-tal er et separat felt).
export function myPeakCountByRace(riders) {
  const out = new Map();
  for (const rd of riders || []) {
    for (const p of rd.peaks || []) {
      if (!p.targetRaceId) continue;
      out.set(p.targetRaceId, (out.get(p.targetRaceId) || 0) + 1);
    }
  }
  return out;
}

// Trænings-status-chip: farve + redundant ikon-glyf (ikke kun farve — a11y §5.4).
export function statusMeta(status) {
  switch (status) {
    case "on_track": return { key: "onTrack", glyph: "✓", tone: "good" };
    case "at_risk": return { key: "atRisk", glyph: "↓", tone: "warn" };
    default: return { key: "pending", glyph: "•", tone: "muted" };
  }
}

// Kort visningsnavn "L. Vermeulen" (fornavn-initial + efternavn).
export function riderShortName(rider) {
  const fn = rider?.firstname ? `${rider.firstname.slice(0, 1)}.` : "";
  return `${fn} ${rider?.lastname ?? ""}`.trim();
}
