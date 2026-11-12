// #6165: ren geometri til de to egne SVG-grafer (donut + trendlinje), der
// erstatter recharts. Ingen DOM og ingen React her, kun tal ind og tal/strenge
// ud, så alt kan testes med node --test.

export interface DonutSegment {
  index: number;
  value: number;
  /** Andel af totalen, 0-100. */
  pct: number;
  startAngle: number;
  endAngle: number;
  /** SVG path-data for ringstykket. Tom streng når værdien er 0. */
  path: string;
}

const TAU = Math.PI * 2;

function polar(cx: number, cy: number, r: number, angle: number): [number, number] {
  // 0 rad = kl. 12, med uret.
  return [cx + r * Math.sin(angle), cy - r * Math.cos(angle)];
}

function f(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** Path for ét ringstykke mellem to vinkler (radianer, 0 = kl. 12, med uret). */
export function ringSegmentPath(
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  startAngle: number,
  endAngle: number,
): string {
  const sweep = endAngle - startAngle;
  if (!(sweep > 0)) return "";
  if (sweep >= TAU - 1e-9) {
    // En fuld ring kan ikke tegnes som én bue (start = slut), så hver kant
    // består af to halvbuer. Indre kant løber modsat, så midten forbliver hul.
    const [ox, oy] = polar(cx, cy, outerR, startAngle);
    const [oxm, oym] = polar(cx, cy, outerR, startAngle + Math.PI);
    const [ix, iy] = polar(cx, cy, innerR, startAngle);
    const [ixm, iym] = polar(cx, cy, innerR, startAngle + Math.PI);
    return [
      `M${f(ox)} ${f(oy)}`,
      `A${f(outerR)} ${f(outerR)} 0 1 1 ${f(oxm)} ${f(oym)}`,
      `A${f(outerR)} ${f(outerR)} 0 1 1 ${f(ox)} ${f(oy)}`,
      `L${f(ix)} ${f(iy)}`,
      `A${f(innerR)} ${f(innerR)} 0 1 0 ${f(ixm)} ${f(iym)}`,
      `A${f(innerR)} ${f(innerR)} 0 1 0 ${f(ix)} ${f(iy)}`,
      "Z",
    ].join(" ");
  }
  const large = sweep > Math.PI ? 1 : 0;
  const [ox1, oy1] = polar(cx, cy, outerR, startAngle);
  const [ox2, oy2] = polar(cx, cy, outerR, endAngle);
  const [ix2, iy2] = polar(cx, cy, innerR, endAngle);
  const [ix1, iy1] = polar(cx, cy, innerR, startAngle);
  return [
    `M${f(ox1)} ${f(oy1)}`,
    `A${f(outerR)} ${f(outerR)} 0 ${large} 1 ${f(ox2)} ${f(oy2)}`,
    `L${f(ix2)} ${f(iy2)}`,
    `A${f(innerR)} ${f(innerR)} 0 ${large} 0 ${f(ix1)} ${f(iy1)}`,
    "Z",
  ].join(" ");
}

/**
 * Deler en ring op i stykker efter værdierne. Negative eller ikke-endelige
 * værdier tæller som 0. paddingDeg er mellemrummet mellem stykkerne i grader og
 * bruges kun når der er mere end ét stykke at skille ad.
 */
export function donutSegments(
  values: number[],
  cx: number,
  cy: number,
  innerR: number,
  outerR: number,
  paddingDeg = 0,
): DonutSegment[] {
  const clean = values.map((v) => (Number.isFinite(v) && v > 0 ? v : 0));
  const total = clean.reduce((s, v) => s + v, 0);
  const visible = clean.filter((v) => v > 0).length;
  // Mellemrummene fordeles FØR stykkerne, så selv en meget lille kategori
  // beholder en synlig vinkel i stedet for at blive spist af mellemrummet.
  const pad = visible > 1 ? Math.min((paddingDeg * Math.PI) / 180, (TAU * 0.5) / visible) : 0;
  const usable = TAU - pad * (visible > 1 ? visible : 0);
  let cursor = 0;
  return clean.map((value, index) => {
    if (total <= 0 || value <= 0) {
      return { index, value, pct: 0, startAngle: cursor, endAngle: cursor, path: "" };
    }
    const share = (value / total) * usable;
    const startAngle = cursor + pad / 2;
    const endAngle = startAngle + share;
    cursor += share + pad;
    return {
      index,
      value,
      pct: (value / total) * 100,
      startAngle,
      endAngle,
      path: ringSegmentPath(cx, cy, innerR, outerR, startAngle, endAngle),
    };
  });
}

/** Lineær skala fra domæne til område. Et fladt domæne lander midt i området. */
export function linearScale(
  domainMin: number,
  domainMax: number,
  rangeMin: number,
  rangeMax: number,
): (v: number) => number {
  const span = domainMax - domainMin;
  if (!(span > 0)) return () => (rangeMin + rangeMax) / 2;
  return (v) => rangeMin + ((v - domainMin) / span) * (rangeMax - rangeMin);
}

function niceStep(rough: number): number {
  const exp = Math.floor(Math.log10(rough));
  const base = 10 ** exp;
  const frac = rough / base;
  const nice = frac <= 1.5 ? 1 : frac <= 3 ? 2 : frac <= 7 ? 5 : 10;
  return nice * base;
}

/**
 * Pæne y-akse-værdier (1, 2, 5 gange en tiopotens) der dækker min..max. Altid
 * mindst to ens fordelte værdier, også når alle data er ens eller tomme.
 */
export function niceTicks(min: number, max: number, target = 4): number[] {
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [0, 1];
  let lo = Math.min(min, max);
  let hi = Math.max(min, max);
  if (hi === lo) {
    if (lo === 0) return [0, 1];
    // Ét fladt niveau: åbn et vindue omkring det.
    const pad = Math.abs(lo) * 0.5;
    lo -= pad;
    hi += pad;
  }
  const step = niceStep((hi - lo) / Math.max(1, target));
  const start = Math.floor(lo / step) * step;
  const stop = Math.ceil(hi / step) * step;
  const ticks: number[] = [];
  const count = Math.round((stop - start) / step);
  for (let i = 0; i <= count; i += 1) {
    // Gang frem for at undgå flydende-komma-støj som 0.30000000000000004.
    ticks.push(Math.round((start + i * step) * 1e9) / 1e9);
  }
  return ticks;
}

/**
 * Hvilke indeks på x-aksen der får en mærkat, så de aldrig ligger tættere end
 * minGapPx. Første og sidste punkt er altid med, hvis der er plads.
 */
export function xTickIndices(count: number, widthPx: number, minGapPx = 56): number[] {
  if (count <= 0) return [];
  if (count === 1) return [0];
  const maxLabels = Math.max(2, Math.floor(widthPx / minGapPx) + 1);
  if (count <= maxLabels) return Array.from({ length: count }, (_, i) => i);
  const stride = Math.ceil((count - 1) / (maxLabels - 1));
  const out: number[] = [];
  for (let i = 0; i < count; i += stride) out.push(i);
  // Sidste punkt tages med, hvis det ikke ligger klods op ad det forrige.
  const last = count - 1;
  if (out[out.length - 1] !== last) {
    if (last - out[out.length - 1] < stride / 2) out[out.length - 1] = last;
    else out.push(last);
  }
  return out;
}

export interface LinePoint {
  x: number;
  y: number | null;
}

/**
 * Path-data for en linje. Huller (y = null/NaN) bliver enten bridget
 * (connectNulls) eller bryder linjen i flere stykker.
 */
export function linePath(points: LinePoint[], connectNulls = true): string {
  let d = "";
  let pen = false;
  for (const p of points) {
    const missing = p.y == null || !Number.isFinite(p.y) || !Number.isFinite(p.x);
    if (missing) {
      if (!connectNulls) pen = false;
      continue;
    }
    d += `${pen ? "L" : "M"}${f(p.x)} ${f(p.y as number)}`;
    pen = true;
  }
  return d;
}

/** Indeks på det punkt, der ligger nærmest en x-position. -1 hvis listen er tom. */
export function nearestIndex(xs: number[], x: number): number {
  let best = -1;
  let bestDist = Infinity;
  for (let i = 0; i < xs.length; i += 1) {
    const dist = Math.abs(xs[i] - x);
    if (dist < bestDist) {
      best = i;
      bestDist = dist;
    }
  }
  return best;
}
