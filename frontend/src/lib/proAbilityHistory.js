// #6286 · Rene helpers til Pro-sæsonhistorikken (RiderAbilityHistoryPro.jsx).
// Ren .js uden JSX, så `node --test` kan loade den.
//
// Kontrakt fra GET /api/pro/rider-history/:riderId:
//   seasons: [{ season_number, abilities: { <evne>: tal }, live?: true }]
// Det sidste punkt er normalt rytterens NUVÆRENDE evner (live: true), så kurven
// slutter i det tal profilen viser.
//
// En evne der mangler i en sæson (fx Teamwork/Leadership før de fandtes) er et
// HUL i kurven, aldrig 0. Et hul tegnes ikke, og deltaet regnes kun mellem
// rigtige værdier.

function asValue(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

// Én evnes punkter på den fælles sæsonakse. `v` er null ved et hul.
export function abilitySeries(seasons, key) {
  return (seasons ?? []).map((s) => ({
    season: s?.season_number ?? null,
    live: Boolean(s?.live),
    v: asValue(s?.abilities?.[key]),
  }));
}

// Ændring fra første til sidste RIGTIGE værdi. Kræver mindst to rigtige værdier,
// ellers null (ingen "+X" ud af et hul eller ud af ét enkelt punkt).
export function abilityDelta(points) {
  const real = (points ?? []).filter((p) => p.v != null);
  if (real.length < 2) return null;
  return real[real.length - 1].v - real[0].v;
}

// Seneste rigtige værdi (det tal rækken viser), eller null.
export function latestValue(points) {
  for (let i = (points?.length ?? 0) - 1; i >= 0; i--) {
    if (points[i].v != null) return points[i].v;
  }
  return null;
}

// Sammenhængende stykker uden huller: [[{ i, v }, ...], ...]. `i` er punktets
// plads på den fælles akse, så et stykke efter et hul starter det rigtige sted.
export function seriesSegments(points) {
  const segments = [];
  let current = [];
  (points ?? []).forEach((p, i) => {
    if (p.v == null) {
      if (current.length) segments.push(current);
      current = [];
    } else {
      current.push({ i, v: p.v });
    }
  });
  if (current.length) segments.push(current);
  return segments;
}

// Akse-labels: "S1", "S2" ... pr. punkt. Et live-punkt uden kendt sæson hedder
// `nowLabel`. Ved mange sæsoner vises hver n'te plus den sidste, så labels ikke
// løber sammen på en smal kolonne.
export function seasonAxisLabels(seasons, { nowLabel = "Now", maxLabels = 6 } = {}) {
  const list = seasons ?? [];
  const n = list.length;
  const step = n > maxLabels ? Math.ceil(n / maxLabels) : 1;
  const labels = [];
  list.forEach((s, i) => {
    const isLast = i === n - 1;
    // Sidste label vises altid; de øvrige hver n'te, men ikke så tæt på den sidste
    // at de to løber sammen.
    if (!isLast && (i % step !== 0 || n - 1 - i < step)) return;
    const label = s?.season_number != null ? `S${s.season_number}` : nowLabel;
    labels.push({ i, label, live: Boolean(s?.live) });
  });
  return labels;
}

// x-position (0..1) for punkt i af n på aksen; ét punkt står i midten.
export function axisFraction(i, n) {
  return n <= 1 ? 0.5 : i / (n - 1);
}
