// #6574: road book-kortet (1200x630) som satori-elementtræ. Ren funktion af etapens rute: ingen fetch,
// ingen Date/Math.random, så samme etape altid giver samme billede (og kan caches hårdt).
//
// Stil: P2 fra designlærredet "Cycling Zone · Feature wireframes" (Idea 7): papirbaggrund, guldlinje
// øverst, profil farvet efter stigningsprocent, kategori-mærker med navn/længde/procent/højdemeter op ad
// linjen, km-bånd med stigninger, bølget terræn, brosten og sprints. Fælles road book-skala (#6570):
// under 3 / 3-6 / 6-8 / 8-10 / over 10 %, nedkørsel dæmpet.
//
// Profilen er etapens RIGTIGE terræn fra ruten (terrain.ts), aldrig dekorative bølger. Al tekst er
// HTML-lag oven på en svg, fordi satori ikke gengiver svg-tekst med vores skrifttyper.
import type { StageRoute } from "./stageRoute.ts";
import { buildTerrain, gradeBand, type Terrain } from "./terrain.ts";

export { gradeBand };

export const OG_WIDTH = 1200;
export const OG_HEIGHT = 630;
export type Lang = "en" | "da";

export const COLORS = Object.freeze({
  bg: "#f4f2ec", ink: "#0e0f15", muted: "#66637a", rule: "#d9d3c2", navy: "#1a1f38",
  gold: "#e8c547", sprint: "#1f9d5a", down: "#e4dfd0",
  strip: "#e5e0d5", rolling: "#c9c1ab", cobbles: "#6b5d48",
  // under 3 neutral · 3-6 gul · 6-8 orange · 8-10 rød · over 10 mørkerød
  bands: Object.freeze(["#d9d3c2", "#f2c230", "#ef8a1f", "#d8392b", "#7a1418"]),
});
const CAT_COLOR: Readonly<Record<string, string>> = Object.freeze({ "4": "#f2c230", "3": "#ef8a1f", "2": "#e5601d", "1": "#d8392b", HC: "#7a1418" });

const TYPES_EN: Record<string, string> = {
  flat: "Flat", rolling: "Rolling", hilly: "Hilly", cobbles: "Cobbles", gravel: "Gravel", classic: "Classic",
  medium_mountain: "Medium mountain", mountain: "Mountain", high_mountain: "High mountain",
  itt: "Time trial", itt_hilly: "Hilly time trial", ttt: "Team time trial",
};
const TYPES_DA: Record<string, string> = {
  flat: "Flad", rolling: "Bølget", hilly: "Kuperet", cobbles: "Brosten", gravel: "Grus", classic: "Klassiker",
  medium_mountain: "Mellembjerg", mountain: "Bjerg", high_mountain: "Højt bjerg",
  itt: "Enkeltstart", itt_hilly: "Kuperet enkeltstart", ttt: "Holdtidskørsel",
};
const TEXT = {
  en: {
    stage: (n: number, of: number) => `STAGE ${n} OF ${of}`, oneDay: "ONE-DAY RACE",
    km: "km", gain: "m climbing", climb: "climb", climbs: "climbs", sector: "cobbled sector", sectors: "cobbled sectors",
    gradient: "% gradient", rolling: "rolling", cobbles: "cobbles",
    summit: (name: string) => `Summit finish${name ? `: ${name}` : ""}`,
    types: TYPES_EN,
  },
  da: {
    stage: (n: number, of: number) => `ETAPE ${n} AF ${of}`, oneDay: "ENDAGSLØB",
    km: "km", gain: "højdemeter", climb: "stigning", climbs: "stigninger", sector: "brostenssektor", sectors: "brostenssektorer",
    gradient: "% stigning", rolling: "bølget", cobbles: "brosten",
    summit: (name: string) => `Mål på toppen${name ? `: ${name}` : ""}`,
    types: TYPES_DA,
  },
};

const SEP: Record<Lang, string> = { en: ",", da: "." };
export function fmtInt(n: number, lang: Lang): string {
  return String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, SEP[lang] ?? ",");
}
function fmtDec(n: number, lang: Lang): string {
  const s = (Math.round(n * 10) / 10).toFixed(1);
  return lang === "da" ? s.replace(".", ",") : s;
}

// ── geometri ────────────────────────────────────────────────────────────────
const MARGIN = 48;
const CHART = Object.freeze({ left: MARGIN, top: 196, width: OG_WIDTH - 2 * MARGIN, height: 374, baseline: 312, plotHeight: 232 });

interface Box { x0: number; x1: number; y0: number; y1: number }
export interface Flag {
  px: number; py: number; cat: string; name: string; sub: string; rank: number; length: number; est: number;
  level: number; rightSide: boolean; placed: boolean; shown: boolean; poleH: number; foot: number; crest: number;
}

/** Udregner alt tegnbart: fyld pr. terræn-stykke, konturen, stigningsflag, bånd, sprints, km-ticks. */
export function layoutStage(route: StageRoute, lang: Lang = "en") {
  const terrain: Terrain = buildTerrain(route);
  const D = route.distance_km;
  const { width: W, baseline, plotHeight } = CHART;
  const X = (km: number) => (km / D) * W;
  const Y = (m: number) => baseline - (m / terrain.maxY) * plotHeight;
  const f1 = (n: number) => n.toFixed(1);

  // 1) Ét fyld pr. terræn-stykke, farvet efter stykkets egen stigningsprocent fra ruten.
  const fills = terrain.runs.map((r) => ({
    band: r.band,
    d: `M${f1(X(r.from_km))},${baseline} L${f1(X(r.from_km))},${f1(Y(r.startM))} L${f1(X(r.to_km))},${f1(Y(r.endM))} L${f1(X(r.to_km))},${baseline} Z`,
  }));
  const pts = terrain.runs.length
    ? [[terrain.runs[0].from_km, terrain.runs[0].startM], ...terrain.runs.map((r) => [r.to_km, r.endM])]
    : [[0, terrain.valley], [D, terrain.valley]];
  const outline = `M${pts.map(([k, m]) => `${f1(X(k))},${f1(Y(m))}`).join(" L")}`;

  // 2) Stigningsflag: top + kategori-mærke + navn/tal. Placering prøves i rækkefølgen (højre, venstre) x
  // (nederste, øverste niveau); den første uden kollision med andre flags' tekst, mærker eller master vinder.
  // Findes ingen, vises kun mærket. De hårdeste stigninger placeres først, så de får deres tekst.
  const LEVEL_STEP = 62;
  const RANK: Record<string, number> = { HC: 0, "1": 1, "2": 2, "3": 3, "4": 4 };
  const flags: Flag[] = route.climbs.map((c) => {
    const px = Math.min(X(c.crest_km), CHART.width - 14);
    const py = Y(terrain.elevationAt(c.crest_km));
    const gainM = Math.round(c.length_km * 10 * c.avg_gradient);
    const sub = `${fmtDec(c.length_km, lang)} km · ${fmtDec(c.avg_gradient, lang)} % · +${fmtInt(gainM, lang)} m`;
    return {
      px, py, cat: c.category, name: c.name, sub, rank: RANK[c.category] ?? 3, length: c.length_km,
      est: Math.max(c.name.length * 11.5, sub.length * 8.6) + 8,
      level: 0, rightSide: true, placed: false, shown: false, poleH: 16,
      foot: Math.max(0, c.crest_km - c.length_km), crest: c.crest_km,
    };
  });
  const hit = (a: Box, b: Box, pad: number) => a.x0 < b.x1 + pad && a.x1 > b.x0 - pad && a.y0 < b.y1 + pad && a.y1 > b.y0 - pad;
  const geo = (f: Flag, level: number, rightSide: boolean) => {
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
  const OPTIONS: [number, boolean][] = [[0, true], [0, false], [1, true], [1, false]];
  for (const f of [...flags].sort((a, b) => a.rank - b.rank || b.length - a.length)) {
    for (const [level, rightSide] of OPTIONS) {
      const g = geo(f, level, rightSide);
      if (g.text.x0 < 0 || g.text.x1 > CHART.width) continue;
      const clash = flags.some((o) => {
        if (o === f) return false;
        const og = geo(o, o.level, o.rightSide);
        if (hit(g.text, og.badge, 8) || hit(g.text, og.pole, 8)) return true;
        if (o.placed && o.shown && (hit(g.text, og.text, 10) || hit(g.badge, og.text, 8) || hit(g.pole, og.text, 8))) return true;
        return false;
      });
      if (!clash) { Object.assign(f, { level, rightSide, placed: true, shown: true }); break; }
    }
    if (!f.shown) Object.assign(f, { placed: true, shown: false, level: 0 });
  }
  for (const f of flags) f.poleH = geo(f, f.level, f.rightSide).poleH;

  // 3) Km-båndet: bølget terræn og brosten fra ruten, stigninger i kategori-farve, sprints.
  const rollingBands = terrain.runs.filter((r) => r.kind === "rolling").map((r) => ({ x: X(r.from_km), w: X(r.to_km) - X(r.from_km) }));
  const cobbleSpans = route.sectors.length
    ? route.sectors.map((s) => [s.start_km, Math.min(D, s.start_km + s.length_km)])
    : terrain.runs.filter((r) => r.kind === "cobbles").map((r) => [r.from_km, r.to_km]);
  const cobbleBands = cobbleSpans.map(([a, b]) => ({ x: X(a), w: Math.max(3, X(b) - X(a)) }));
  const sprints = route.sprints.map((km) => ({ px: X(km), py: Y(terrain.elevationAt(km)), km }));

  // 4) Km-ticks: 5-10 stk., runde tal.
  const stepKm = [5, 10, 20, 25, 50, 100].find((s) => D / s <= 10) ?? 100;
  const ticks: { km: number; px: number }[] = [];
  for (let k = 0; k < D - stepKm * 0.35; k += stepKm) ticks.push({ km: k, px: X(k) });

  return { terrain, fills, outline, flags, rollingBands, cobbleBands, sprints, ticks, X, Y, W, baseline };
}

// ── elementtræ ──────────────────────────────────────────────────────────────
type Child = El | string | null | undefined;
export interface El { type: string; props: Record<string, unknown> }
type Style = Record<string, string | number>;
const h = (type: string, style: Style, children?: Child | Child[], props: Record<string, unknown> = {}): El =>
  ({ type, props: { style, children, ...props } });
const box = (style: Style, children?: Child | Child[]) => h("div", { display: "flex", ...style }, children);
const abs = (style: Style, children?: Child | Child[]) => box({ position: "absolute", ...style }, children);
const svgEl = (type: string, props: Record<string, unknown>) => h(type, {}, undefined, props);
const INTER = "Inter Tight";

function nameSize(len: number): number {
  return Math.max(46, Math.min(88, Math.floor(700 / (Math.max(len, 1) * 0.42))));
}

export function buildStageCard(route: StageRoute, lang: Lang = "en"): El {
  const L = layoutStage(route, lang);
  const t = TEXT[lang] ?? TEXT.en;
  const typeLabel = t.types[route.type] ?? "";
  const eyebrow = [route.stageCount > 1 ? t.stage(route.stage, route.stageCount) : t.oneDay, typeLabel.toUpperCase()]
    .filter(Boolean).join("  ·  ");

  const climbCount = route.climbs.length;
  const sectorCount = route.sectors.length || L.cobbleBands.length;
  const third: [string, string] = climbCount === 0 && sectorCount > 0
    ? [String(sectorCount), sectorCount === 1 ? t.sector : t.sectors]
    : [String(climbCount), climbCount === 1 ? t.climb : t.climbs];
  const stats: [string, string][] = [
    [fmtInt(route.distance_km, lang), t.km],
    [fmtInt(route.elevation_gain_m, lang), t.gain],
    third,
  ];
  const last = route.climbs[route.climbs.length - 1];
  const subline = last?.summit_finish ? t.summit(last.name) : "";

  const header: Child[] = [
    abs({ left: MARGIN, top: 34, fontFamily: INTER, fontWeight: 700, fontSize: 20, letterSpacing: 3, color: COLORS.muted }, eyebrow),
    abs({
      left: MARGIN, top: 56, width: 720, fontFamily: "Bebas Neue", fontSize: nameSize(route.race.length), lineHeight: 1,
      color: COLORS.ink, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }, route.race),
    subline ? abs({
      left: MARGIN, top: 150, width: 720, fontFamily: INTER, fontWeight: 400, fontSize: 27, color: COLORS.muted,
      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
    }, subline) : null,
    abs({ right: MARGIN, top: 40, gap: 34 }, stats.map(([num, label]) => box({ flexDirection: "column", alignItems: "flex-end" }, [
      box({ fontFamily: "Bebas Neue", fontSize: 64, lineHeight: 1, color: COLORS.ink }, num),
      box({ fontFamily: INTER, fontWeight: 400, fontSize: 18, color: COLORS.muted, marginTop: 2 }, label),
    ]))),
  ];

  const { fills, outline, flags, rollingBands, cobbleBands, sprints, ticks, baseline, W } = L;
  const bandColor = (b: number) => (b < 0 ? COLORS.down : COLORS.bands[b]);
  const svgChildren: El[] = [
    ...fills.map((f) => svgEl("path", { d: f.d, fill: bandColor(f.band), stroke: bandColor(f.band), strokeWidth: 0.6 })),
    svgEl("path", { d: outline, fill: "none", stroke: COLORS.ink, strokeWidth: 2.2, strokeLinejoin: "round" }),
    svgEl("rect", { x: 0, y: baseline + 8, width: W, height: 6, fill: COLORS.strip }),
    ...rollingBands.map((b) => svgEl("rect", { x: b.x, y: baseline + 8, width: b.w, height: 6, fill: COLORS.rolling })),
    ...cobbleBands.map((b) => svgEl("rect", { x: b.x, y: baseline + 5, width: b.w, height: 12, fill: COLORS.cobbles })),
    ...flags.map((f) => svgEl("rect", { x: L.X(f.foot), y: baseline + 5, width: Math.max(3, L.X(f.crest) - L.X(f.foot)), height: 12, fill: CAT_COLOR[f.cat] ?? CAT_COLOR["3"] })),
    ...sprints.map((s) => svgEl("rect", { x: s.px - 3, y: baseline + 5, width: 6, height: 12, fill: COLORS.sprint })),
    ...flags.map((f) => svgEl("line", { x1: f.px, x2: f.px, y1: f.py, y2: Math.max(30, f.py - f.poleH - 10), stroke: COLORS.muted, strokeWidth: 1.5 })),
    ...sprints.map((s) => svgEl("circle", { cx: s.px, cy: s.py, r: 10, fill: COLORS.sprint, stroke: COLORS.bg, strokeWidth: 2.5 })),
    ...flags.map((f) => svgEl("rect", { x: f.px - 13, y: Math.max(4, f.py - f.poleH - 36), width: 26, height: 26, rx: 4, fill: CAT_COLOR[f.cat] ?? CAT_COLOR["3"] })),
  ];
  const chart: Child[] = [h("svg", { position: "absolute", left: 0, top: 0 }, svgChildren, {
    width: CHART.width, height: CHART.height, viewBox: `0 0 ${CHART.width} ${CHART.height}`, xmlns: "http://www.w3.org/2000/svg",
  })];

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
    const textStyle: Style = f.rightSide
      ? { left: f.px + 22, alignItems: "flex-start" }
      : { left: f.px - 22 - f.est, width: f.est, alignItems: "flex-end" };
    chart.push(abs({ top: badgeTop - 4, flexDirection: "column", ...textStyle }, [
      f.name ? box({ fontFamily: "Bebas Neue", fontSize: 27, lineHeight: 1, color: COLORS.ink, whiteSpace: "nowrap" }, f.name) : null,
      box({ fontFamily: INTER, fontWeight: 700, fontSize: 17, color: COLORS.muted, marginTop: f.name ? 3 : 4, whiteSpace: "nowrap" }, f.sub),
    ].filter(Boolean)));
  }
  for (const tk of ticks) {
    const first = tk.km === 0;
    chart.push(abs({ left: first ? 0 : tk.px - 30, top: baseline + 24, width: 60, justifyContent: first ? "flex-start" : "center", fontFamily: INTER, fontWeight: 400, fontSize: 17, color: COLORS.muted }, first ? `0 ${t.km}` : fmtInt(tk.km, lang)));
  }
  chart.push(abs({ right: 0, top: baseline + 24, fontFamily: INTER, fontWeight: 700, fontSize: 17, color: COLORS.ink }, `${fmtInt(route.distance_km, lang)} ${t.km}`));

  const chip = (color: string, label: string, w = 22) => box({ alignItems: "center", gap: 6 }, [
    box({ width: w, height: 12, borderRadius: 2, backgroundColor: color }),
    box({ fontFamily: INTER, fontWeight: 400, fontSize: 16, color: COLORS.muted }, label),
  ]);
  const terrainChips: Child[] = [
    rollingBands.length ? chip(COLORS.rolling, t.rolling, 18) : null,
    cobbleBands.length ? chip(COLORS.cobbles, t.cobbles, 18) : null,
  ];
  const legend = box({ alignItems: "center", gap: 14 }, [
    ...terrainChips,
    ...([["<3", 0], ["3–6", 1], ["6–8", 2], ["8–10", 3], [">10", 4]] as [string, number][]).map(([label, band]) => chip(COLORS.bands[band], label)),
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
