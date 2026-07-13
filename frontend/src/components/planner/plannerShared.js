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

// Trænings-status-chip: farve + redundant ikon-glyf (ikke kun farve — a11y §5.4).
export function statusMeta(status) {
  switch (status) {
    case "on_track": return { key: "onTrack", glyph: "✓", tone: "good" };
    case "at_risk": return { key: "atRisk", glyph: "↓", tone: "warn" };
    default: return { key: "pending", glyph: "•", tone: "muted" };
  }
}

// Ryttertype → i18n-nøgle (planner:type.*). Ukendt → rå værdi som fallback-label.
export function riderTypeKey(primaryType) {
  const known = ["sprinter", "tt", "climber", "puncheur", "brostensrytter", "baroudeur", "rouleur", "gc"];
  return known.includes(primaryType) ? `type.${primaryType}` : null;
}

// Kort visningsnavn "L. Vermeulen" (fornavn-initial + efternavn).
export function riderShortName(rider) {
  const fn = rider?.firstname ? `${rider.firstname.slice(0, 1)}.` : "";
  return `${fn} ${rider?.lastname ?? ""}`.trim();
}
