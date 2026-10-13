// #6574: road book-kortet (1200x630) som satori-elementtræ. Ren funktion af de validerede parametre:
// ingen fetch, ingen Date/Math.random, så samme URL altid giver samme billede (og kan caches hårdt).
//
// Stil: P2 fra designlærredet "Cycling Zone · Feature wireframes" (Idea 7): papirbaggrund, guldlinje
// øverst, profil farvet efter stigningsprocent pr. segment, kategori-mærker og højde/km skrevet op ad
// linjen, km-bånd med stigningszoner under. Farveskalaen er den fælles (<3 / 3-6 / 6-8 / 8-10 / >10).
//
// Profilkurven er den SAMME som etapesiden tegner (buildProfileSeries): fast højdeskala pr. etapetype,
// samlet stigning = elevation_gain_m. Al tekst er HTML-lag oven på en svg, fordi satori ikke
// gengiver svg-tekst med vores skrifttyper.
import { buildProfileSeries } from "../../../src/lib/stageRouteProfile.js";
import { OG_WIDTH, OG_HEIGHT } from "./params.js";

export const COLORS = Object.freeze({
  bg: "#f4f2ec", ink: "#0e0f15", muted: "#66637a", rule: "#d9d3c2", navy: "#1a1f38",
  gold: "#e8c547", sprint: "#1f9d5a", down: "#e4dfd0",
  // <3 neutral · 3-6 gul · 6-8 orange · 8-10 rød · >10 mørkerød
  bands: Object.freeze(["#d9d3c2", "#f2c230", "#ef8a1f", "#d8392b", "#7a1418"]),
});
const CAT_COLOR = Object.freeze({ "4": "#f2c230", "3": "#ef8a1f", "2": "#e5601d", "1": "#d8392b", HC: "#7a1418" });

/** Fælles gradientskala (#6570). -1 = nedkørsel (dæmpet), 0-4 = <3, 3-6, 6-8, 8-10, >10 %. */
export function gradeBand(pct) {
  if (!Number.isFinite(pct)) return 0;
  if (pct <= -3) return -1;
  if (pct < 3) return 0;
  if (pct < 6) return 1;
  if (pct < 8) return 2;
  if (pct < 10) return 3;
  return 4;
}

const TEXT = {
  en: {
    stage: (n, of) => `STAGE ${n} OF ${of}`, oneDay: "ONE-DAY RACE",
    km: "km", gain: "m climbing", climb: "climb", climbs: "climbs", gradient: "% gradient",
    types: {
      flat: "Flat", rolling: "Rolling", hilly: "Hilly", cobbles: "Cobbles", gravel: "Gravel", classic: "Classic",
      medium_mountain: "Medium mountain", mountain: "Mountain", high_mountain: "High mountain",
      itt: "Time trial", itt_hilly: "Hilly time trial", ttt: "Team time trial",
    },
  },
  da: {
    stage: (n, of) => `ETAPE ${n} AF ${of}`, oneDay: "ENDAGSLØB",
    km: "km", gain: "højdemeter", climb: "stigning", climbs: "stigninger", gradient: "% stigning",
    types: {
      flat: "Flad", rolling: "Bølget", hilly: "Kuperet", cobbles: "Brosten", gravel: "Grus", classic: "Klassiker",
      medium_mountain: "Mellembjerg", mountain: "Bjerg", high_mountain: "Højt bjerg",
      itt: "Enkeltstart", itt_hilly: "Kuperet enkeltstart", ttt: "Holdtidskørsel",
    },
  },
};

const SEP = { en: ",", da: "." };
export function fmtInt(n, lang) {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, SEP[lang] ?? ",");
}
function fmtDec(n, lang) {
  const s = (Math.round(n * 10) / 10).toFixed(1);
  return lang === "da" ? s.replace(".", ",") : s;
}

// ── geometri ────────────────────────────────────────────────────────────────
const MARGIN = 48;
const CHART = Object.freeze({ left: MARGIN, top: 196, width: OG_WIDTH - 2 * MARGIN, height: 374, baseline: 312, plotHeight: 232 });

function makeElevationAt(xs, ys) {
  return (km) => {
    if (km <= xs[0]) return ys[0];
    let lo = 0, hi = xs.length - 1;
    if (km >= xs[hi]) return ys[hi];
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (xs[mid] <= km) lo = mid; else hi = mid;
    }
    const t = (km - xs[lo]) / (xs[hi] - xs[lo] || 1);
    return ys[lo] + t * (ys[hi] - ys[lo]);
  };
}

/** Udregner alt tegnbart: slices (sammenlagt pr. bånd), konturen, stigningsflag, sprints, km-ticks. */
export function layoutStage(v) {
  const series = buildProfileSeries({
    race_id: v.seedKey, stage_number: v.stage, profile_type: v.type,
    distance_km: v.distance_km, elevation_gain_m: v.elevation_gain_m, climbs: v.climbs,
  });
  if (!series) return null;
  const D = v.distance_km;
  const { width: W, baseline, plotHeight } = CHART;
  const elevAt = makeElevationAt(series.xs, series.ys);
  const X = (km) => (km / D) * W;
  const Y = (m) => baseline - (m / series.maxY) * plotHeight;

  // 1) Segmenter á ~500 m, farvet efter segmentets gennemsnitlige stigning; naboer i samme bånd slås sammen.
  const n = Math.max(1, Math.min(360, Math.ceil(D / 0.5)));
  const step = D / n;
  const runs = [];
  for (let i = 0; i < n; i++) {
    const k0 = i * step, k1 = (i + 1) * step;
    const e0 = elevAt(k0), e1 = elevAt(k1);
    // Kun stigningerne er sande data; bølgeterrænet imellem er fri form (jf. stageRouteProfile.js).
    // Det farves derfor aldrig som "stejlt" — højst neutral eller nedkørsel.
    const mid = (k0 + k1) / 2;
    const onClimb = series.spans.some(([a, b]) => mid >= a && mid <= b);
    const raw = gradeBand((e1 - e0) / (step * 10));
    const band = onClimb ? raw : Math.min(raw, 0);
    const last = runs[runs.length - 1];
    if (last && last.band === band) last.pts.push([k1, e1]);
    else runs.push({ band, pts: [[k0, e0], [k1, e1]] });
  }
  const fills = runs.map((r) => {
    const pts = r.pts.map(([k, e]) => `${X(k).toFixed(1)},${Y(e).toFixed(1)}`);
    const x0 = X(r.pts[0][0]).toFixed(1), x1 = X(r.pts[r.pts.length - 1][0]).toFixed(1);
    return { band: r.band, d: `M${x0},${baseline} L${pts.join(" L")} L${x1},${baseline} Z` };
  });
  const outline = `M${series.xs.map((k, i) => `${X(k).toFixed(1)},${Y(series.ys[i]).toFixed(1)}`).join(" L")}`;

  // 2) Stigningsflag: top + kategori-mærke + navn/tal. Placering prøves i rækkefølgen (højre, venstre) x
  // (nederste, øverste niveau); den første uden kollision med andre flags' tekst, mærker eller master vinder.
  // Findes ingen, vises kun mærket. De hårdeste stigninger placeres først, så de får deres tekst.
  const LEVEL_STEP = 62;
  const RANK = { HC: 0, "1": 1, "2": 2, "3": 3, "4": 4 };
  const flags = [...v.climbs].sort((a, b) => a.crest_km - b.crest_km).map((c) => {
    const px = Math.min(X(c.crest_km), CHART.width - 14), py = Y(elevAt(c.crest_km));
    const sub = `${fmtDec(c.length_km, v.lang)} km · ${fmtDec(c.avg_gradient, v.lang)} %`;
    const name = c.name || "";
    return {
      px, py, cat: c.category, name, sub, rank: RANK[c.category] ?? 3, length: c.length_km,
      est: Math.max(name.length * 11.5, sub.length * 8.6) + 8,
      level: 0, rightSide: true, placed: false, shown: false,
      summitM: Math.round(elevAt(c.crest_km)), gainM: Math.round(c.length_km * 10 * c.avg_gradient),
      foot: Math.max(0, c.crest_km - c.length_km), crest: c.crest_km,
    };
  });
  const hit = (a, b, pad) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
  const geo = (f, level, rightSide) => {
    const poleH = 16 + level * LEVEL_STEP;
    const top = Math.max(4, f.py - poleH - 36);
    return {
      poleH, top,
      badge: { x0: f.px - 13, x1: f.px + 13, y0: top, y1: top + 26 },
      pole: { x0: f.px - 2, x1: f.px + 2, y0: top + 26, y1: f.py },
      text: rightSide
        ? { x0: f.px + 22, x1: f.px + 22 + f.est, y0: top - 4, y1: top + 46 }
        : { x0: f.px - 22 - f.est, x1: f.px - 22, y0: top - 4, y1: top + 46 },
    };
  };
  for (const f of [...flags].sort((a, b) => a.rank - b.rank || b.length - a.length)) {
    for (const [level, rightSide] of [[0, true], [0, false], [1, true], [1, false]]) {
      const g = geo(f, level, rightSide);
      if (g.text.x0 < 0 || g.text.x1 > CHART.width) continue;
      const clash = flags.some((o) => {
        if (o === f) return false;
        const og = geo(o, o.level, o.rightSide);
        // min tekst mod andres mærke/mast, og min mast/mærke mod andres (placerede) tekst
        if (hit(g.text, og.badge, 8) || hit(g.text, og.pole, 8)) return true;
        if (o.placed && o.shown && (hit(g.text, og.text, 10) || hit(g.badge, og.text, 8) || hit(g.pole, og.text, 8))) return true;
        return false;
      });
      if (!clash) { Object.assign(f, { level, rightSide, placed: true, shown: true }); break; }
    }
    if (!f.shown) Object.assign(f, { placed: true, shown: false, level: 0 });
  }
  for (const f of flags) f.poleH = geo(f, f.level, f.rightSide).poleH;

  // 3) Mellemsprints.
  const sprints = v.sprints.map((km) => ({ px: X(km), py: Y(elevAt(km)), km }));

  // 4) Km-ticks: 5-10 stk., runde tal.
  const stepKm = [5, 10, 20, 25, 50, 100].find((s) => D / s <= 10) ?? 100;
  const ticks = [];
  for (let k = 0; k < D - stepKm * 0.35; k += stepKm) ticks.push({ km: k, px: X(k) });

  return { fills, outline, flags, sprints, ticks, X, Y, series, W, baseline };
}

// ── elementtræ ──────────────────────────────────────────────────────────────
const h = (type, style, children, props = {}) => ({ type, props: { style, children, ...props } });
const box = (style, children) => h("div", { display: "flex", ...style }, children);
const abs = (style, children) => box({ position: "absolute", ...style }, children);
const INTER = "Inter Tight";

function nameSize(len) {
  return Math.max(46, Math.min(88, Math.floor(700 / (Math.max(len, 1) * 0.42))));
}

export function buildStageCard(v) {
  const L = layoutStage(v);
  const t = TEXT[v.lang] ?? TEXT.en;
  const typeLabel = t.types[v.type] ?? "";
  const eyebrow = [v.stageCount > 1 ? t.stage(v.stage, v.stageCount) : t.oneDay, typeLabel.toUpperCase()].filter(Boolean).join("  ·  ");
  const climbCount = v.climbs.length;

  const stats = [
    [fmtInt(v.distance_km, v.lang), t.km],
    [fmtInt(v.elevation_gain_m, v.lang), t.gain],
    [String(climbCount), climbCount === 1 ? t.climb : t.climbs],
  ];

  const header = [
    abs({ left: MARGIN, top: 34, fontFamily: INTER, fontWeight: 700, fontSize: 20, letterSpacing: 3, color: COLORS.muted }, eyebrow),
    abs({
      left: MARGIN, top: 56, width: 720, fontFamily: "Bebas Neue", fontSize: nameSize(v.race.length), lineHeight: 1,
      color: COLORS.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }, v.race),
    v.route ? abs({
      left: MARGIN, top: 150, width: 720, fontFamily: INTER, fontWeight: 400, fontSize: 27, color: COLORS.muted,
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }, v.route) : null,
    abs({ right: MARGIN, top: 40, gap: 34 }, stats.map(([num, label]) => box({ flexDirection: "column", alignItems: "flex-end" }, [
      box({ fontFamily: "Bebas Neue", fontSize: 64, lineHeight: 1, color: COLORS.ink }, num),
      box({ fontFamily: INTER, fontWeight: 400, fontSize: 18, color: COLORS.muted, marginTop: 2 }, label),
    ]))),
  ];

  const chart = [];
  if (L) {
    const { fills, outline, flags, sprints, ticks, baseline, W } = L;
    const svgChildren = [
      ...fills.map((f) => h("path", {}, undefined, { d: f.d, fill: f.band < 0 ? COLORS.down : COLORS.bands[f.band], stroke: f.band < 0 ? COLORS.down : COLORS.bands[f.band], strokeWidth: 0.6 })),
      h("path", {}, undefined, { d: outline, fill: "none", stroke: COLORS.ink, strokeWidth: 2.2, strokeLinejoin: "round" }),
      h("rect", {}, undefined, { x: 0, y: baseline + 8, width: W, height: 6, fill: "#e5e0d5" }),
      ...flags.map((f) => h("rect", {}, undefined, { x: L.X(f.foot), y: baseline + 5, width: Math.max(3, L.X(f.crest) - L.X(f.foot)), height: 12, fill: CAT_COLOR[f.cat] ?? CAT_COLOR["3"] })),
      ...sprints.map((s) => h("rect", {}, undefined, { x: s.px - 3, y: baseline + 5, width: 6, height: 12, fill: COLORS.sprint })),
      ...flags.map((f) => h("line", {}, undefined, { x1: f.px, x2: f.px, y1: f.py, y2: Math.max(30, f.py - f.poleH - 10), stroke: COLORS.muted, strokeWidth: 1.5 })),
      ...sprints.map((s) => h("circle", {}, undefined, { cx: s.px, cy: s.py, r: 10, fill: COLORS.sprint, stroke: COLORS.bg, strokeWidth: 2.5 })),
      ...flags.map((f) => h("rect", {}, undefined, { x: f.px - 13, y: Math.max(4, f.py - f.poleH - 36), width: 26, height: 26, rx: 4, fill: CAT_COLOR[f.cat] ?? CAT_COLOR["3"] })),
    ];
    chart.push(h("svg", { position: "absolute", left: 0, top: 0 }, svgChildren, {
      width: CHART.width, height: CHART.height, viewBox: `0 0 ${CHART.width} ${CHART.height}`, xmlns: "http://www.w3.org/2000/svg",
    }));

    for (const s of sprints) {
      chart.push(abs({ left: s.px - 10, top: s.py - 10, width: 20, height: 20, alignItems: "center", justifyContent: "center", fontFamily: INTER, fontWeight: 700, fontSize: 12, color: "#fff" }, "S"));
    }
    for (const f of flags) {
      const badgeTop = Math.max(4, f.py - f.poleH - 36);
      chart.push(abs({
        left: f.px - 13, top: badgeTop, width: 26, height: 26, alignItems: "center", justifyContent: "center",
        fontFamily: INTER, fontWeight: 700, fontSize: f.cat === "HC" ? 12 : 16, color: f.cat === "4" ? COLORS.ink : "#fff",
      }, f.cat));
      if (!f.shown) continue;
      const textStyle = f.rightSide
        ? { left: f.px + 22, alignItems: "flex-start" }
        : { left: f.px - 22 - f.est, width: f.est, alignItems: "flex-end" };
      chart.push(abs({ top: badgeTop - 4, flexDirection: "column", ...textStyle }, [
        f.name ? box({ fontFamily: "Bebas Neue", fontSize: 27, lineHeight: 1, color: COLORS.ink, whiteSpace: "nowrap" }, f.name) : null,
        box({ fontFamily: INTER, fontWeight: 700, fontSize: 17, color: COLORS.muted, marginTop: f.name ? 3 : 4, whiteSpace: "nowrap" },
          `${f.sub} · ${fmtInt(f.summitM, v.lang)} m`),
      ].filter(Boolean)));
    }
    for (const tk of ticks) {
      const first = tk.km === 0;
      chart.push(abs({ left: first ? 0 : tk.px - 30, top: baseline + 24, width: first ? 60 : 60, justifyContent: first ? "flex-start" : "center", fontFamily: INTER, fontWeight: 400, fontSize: 17, color: COLORS.muted }, first ? `0 ${t.km}` : fmtInt(tk.km, v.lang)));
    }
    chart.push(abs({ right: 0, top: baseline + 24, fontFamily: INTER, fontWeight: 700, fontSize: 17, color: COLORS.ink }, `${fmtInt(v.distance_km, v.lang)} ${t.km}`));
  }

  const legend = box({ alignItems: "center", gap: 14 }, [
    ...[["<3", 0], ["3–6", 1], ["6–8", 2], ["8–10", 3], [">10", 4]].map(([label, band]) =>
      box({ alignItems: "center", gap: 6 }, [
        box({ width: 22, height: 12, borderRadius: 2, backgroundColor: COLORS.bands[band] }),
        box({ fontFamily: INTER, fontWeight: 400, fontSize: 16, color: COLORS.muted }, label),
      ])),
    box({ fontFamily: INTER, fontWeight: 400, fontSize: 16, color: COLORS.muted }, t.gradient),
  ]);

  const footer = abs({ left: MARGIN, right: MARGIN, top: 584, height: 46, alignItems: "center", justifyContent: "space-between", borderTop: `1px solid ${COLORS.rule}` }, [
    box({ alignItems: "center", gap: 10 }, [
      box({ width: 14, height: 14, backgroundColor: COLORS.gold }),
      box({ fontFamily: "Bebas Neue", fontSize: 30, letterSpacing: 2, color: COLORS.navy }, "CYCLING ZONE"),
    ]),
    legend,
    box({ fontFamily: INTER, fontWeight: 700, fontSize: 20, color: COLORS.muted }, "cyclingzone.org"),
  ]);

  return box({ position: "relative", width: OG_WIDTH, height: OG_HEIGHT, backgroundColor: COLORS.bg }, [
    abs({ left: 0, top: 0, width: OG_WIDTH, height: 8, backgroundColor: COLORS.gold }),
    ...header.filter(Boolean),
    abs({ left: CHART.left, top: CHART.top, width: CHART.width, height: CHART.height }, chart),
    footer,
  ]);
}
