// #8253 · Én fælles rute i løbsside v6: den farvede profil fra Etape-fanen
// (StageProfileV2) med bjergpriser, mellemspurter og mål. Ren logik her, så
// reglerne kan testes uden React: hvilke punkter ruten har, hvad der står ved
// hvert mærke, og hvilke etiketter der får plads uden at overlappe.
import { sortedClimbs, type StageProfile } from "../stagePageV2/stagePageV2Model.ts";

/** Samme grænse som StageProfileV2's smalle tegning: under den er ruten SMAL. */
export const V6_ROUTE_NARROW_BELOW = 640;
/** "Sidste 10 km" markeres kun, når etapen er længere end det. */
export const V6_ROUTE_FINAL_KM = 10;

export type V6RouteSize = "wide" | "narrow";
export function v6RouteSize(width: number): V6RouteSize {
  return width > 0 && width < V6_ROUTE_NARROW_BELOW ? "narrow" : "wide";
}

/** Kategori som Etape-fanens mærke skriver den (HC, 1-4, ellers "?"). */
export function v6RouteCategory(cat: string | null | undefined): string {
  const c = String(cat ?? "").toUpperCase();
  return c === "HC" ? "HC" : c || "?";
}

/** Hårdeste kategori først (HC, 1, 2, 3, 4); ukendt sidst. */
export function v6RouteCategoryRank(cat: string): number {
  if (cat === "HC") return 0;
  const n = Number(cat);
  return Number.isFinite(n) && n > 0 ? n : 9;
}

export interface V6RouteClimb { number: number; km: number; cat: string; name: string; rank: number }
export interface V6RouteSprint { number: number; km: number }
export interface V6RoutePoints { climbs: V6RouteClimb[]; sprints: V6RouteSprint[]; finishKm: number; finalKmFrom: number | null }

/**
 * Rutens punkter i km-orden. Bjergpriserne nummereres 1..n efter hvor de topper,
 * mellemspurterne 1..n efter km. Kun etapens egen profil; intet hentes.
 */
export function v6RoutePoints(profile: StageProfile): V6RoutePoints {
  const climbs = sortedClimbs(profile).map((c, i) => {
    const cat = v6RouteCategory(c.category);
    return { number: i + 1, km: Number(c.crest_km), cat, name: String(c.name ?? ""), rank: v6RouteCategoryRank(cat) };
  });
  const sprints = (Array.isArray(profile.sprints) ? profile.sprints : [])
    .filter((s) => s && s.kind === "intermediate" && Number.isFinite(Number(s.km)))
    .map((s) => Number(s.km))
    .sort((a, b) => a - b)
    .map((km, i) => ({ number: i + 1, km }));
  const finishKm = Number(profile.distance_km) || 0;
  return { climbs, sprints, finishKm, finalKmFrom: finishKm > V6_ROUTE_FINAL_KM ? finishKm - V6_ROUTE_FINAL_KM : null };
}

/** Mål på toppen: StageProfileV2 tegner så ingen måltekst (stigningens mærke står der). */
export function v6SummitFinish(points: V6RoutePoints): boolean {
  const last = points.climbs[points.climbs.length - 1];
  return last != null && points.finishKm - last.km < 1;
}

/** km som hele tal, som profilens akse og Etape-fanen skriver dem. */
export function v6RouteKm(km: number): number {
  return Math.round(km);
}

/** Teksten ved en bjergpris: bred = "#2 · km 56", smal = kun "#2" (km står i listen). */
export function v6ClimbTag(c: Pick<V6RouteClimb, "number" | "km">, size: V6RouteSize): string {
  return size === "narrow" ? `#${c.number}` : `#${c.number} · km ${v6RouteKm(c.km)}`;
}

/** Teksten ved en mellemspurt: bred = "km 42", smal = ingen (mærket alene; km står i listen). */
export function v6SprintTag(s: Pick<V6RouteSprint, "km">, size: V6RouteSize): string | null {
  return size === "narrow" ? null : `km ${v6RouteKm(s.km)}`;
}

// ── Etiketter uden overlap ─────────────────────────────────────────────────
//
// Reglen er bevidst enkel og vandret: hver etiket er et interval på x-aksen.
// En etiket står til højre for sit mærke (til venstre, når mærket er i rutens
// sidste del); er der ikke plads, prøves den anden side; ellers udelades den på
// profilen (listen under profilen har altid alle punkter med km). Etiketten må
// ikke gå uden for tegningen, ikke dække et andet mærke og ikke røre en
// etiket, der allerede står. Bjergpriserne placeres først, hårdeste kategori
// først, så spurterne. Lodret position regnes ikke med; det gør reglen
// strengere, aldrig løsere.

export type V6LabelSide = "left" | "right";

/** Anslået tekstbredde (font-data, tabular): bred nok til aldrig at undervurdere tal. */
export function v6TextWidth(text: string, fontPx: number): number {
  return Math.ceil(text.length * fontPx * 0.6);
}

export interface V6LabelMarker { x: number; half: number }
export interface V6LabelItem { x: number; width: number; gap: number }
export interface V6LabelLayoutInput {
  width: number;
  /** Alle mærker på profilen (bjergpriser og spurter), så en etiket ikke dækker dem. */
  markers: V6LabelMarker[];
  /** Etiketter i prioriteret rækkefølge; resultatet følger samme rækkefølge. */
  items: V6LabelItem[];
  /** Felter der allerede er optaget (fx "Mål · 312 m" øverst til højre). */
  reserved?: Array<[number, number]>;
  /** Afstand mellem to etiketter. */
  spacing?: number;
}

export function v6LayoutLabels({ width, markers, items, reserved = [], spacing = 6 }: V6LabelLayoutInput): Array<V6LabelSide | null> {
  const placed: Array<[number, number]> = reserved.map(([a, b]) => [a, b]);
  return items.map((it) => {
    const preferred: V6LabelSide[] = it.x > width * 0.6 ? ["left", "right"] : ["right", "left"];
    for (const side of preferred) {
      const box: [number, number] = side === "right" ? [it.x + it.gap, it.x + it.gap + it.width] : [it.x - it.gap - it.width, it.x - it.gap];
      const inside = box[0] >= 0 && box[1] <= width;
      const hitsMarker = markers.some((m) => Math.abs(m.x - it.x) > 0.5 && m.x + m.half > box[0] && m.x - m.half < box[1]);
      const hitsLabel = placed.some(([a, b]) => a < box[1] + spacing && b > box[0] - spacing);
      if (inside && !hitsMarker && !hitsLabel) {
        placed.push(box);
        return side;
      }
    }
    return null;
  });
}

/** Mærkernes halve bredde, som StageProfileV2 tegner dem (kategori-kassen og spurt-cirklen). */
export const V6_CLIMB_MARK_HALF = 11;
export const V6_SPRINT_MARK_HALF = 8;

export interface V6RouteLabelPlan {
  climbs: Array<{ side: V6LabelSide | null; tag: string; name: string | null }>;
  sprints: Array<{ side: V6LabelSide | null; tag: string | null }>;
}

/**
 * Hele etiket-planen for én tegning. `x` omsætter km til pixel i den målte
 * bredde; `finishLabelWidth` er bredden af målets tekst øverst til højre (0 når
 * den ikke tegnes, fx ved målstreg på toppen).
 */
export function v6RouteLabelPlan(points: V6RoutePoints, size: V6RouteSize, width: number, x: (km: number) => number, finishLabelWidth = 0): V6RouteLabelPlan {
  const markers: V6LabelMarker[] = [
    ...points.climbs.map((c) => ({ x: x(c.km), half: V6_CLIMB_MARK_HALF })),
    ...points.sprints.map((s) => ({ x: x(s.km), half: V6_SPRINT_MARK_HALF })),
  ];
  const climbOrder = points.climbs.map((_, i) => i).sort((a, b) => points.climbs[a].rank - points.climbs[b].rank || a - b);
  const climbTexts = points.climbs.map((c) => {
    const tag = v6ClimbTag(c, size);
    const name = size === "wide" && c.name ? c.name : null;
    const w = Math.max(v6TextWidth(tag, 11), name ? v6TextWidth(name, 12) : 0);
    return { tag, name, w };
  });
  const sprintTexts = points.sprints.map((s) => v6SprintTag(s, size));
  const items: V6LabelItem[] = [
    ...climbOrder.map((i) => ({ x: x(points.climbs[i].km), width: climbTexts[i].w, gap: size === "narrow" ? 13 : 16 })),
    ...points.sprints.map((s, i) => ({ x: x(s.km), width: sprintTexts[i] ? v6TextWidth(sprintTexts[i]!, 11) : 0, gap: 11 })),
  ];
  const reserved: Array<[number, number]> = finishLabelWidth > 0 ? [[width - 6 - finishLabelWidth, width]] : [];
  // En spurt uden tekst (smal) skal ikke have plads; den springes over i layoutet.
  const active = items.map((it, i) => i < climbOrder.length || sprintTexts[i - climbOrder.length] !== null);
  const sides = v6LayoutLabels({ width, markers, items: items.filter((_, i) => active[i]), reserved });
  const allSides: Array<V6LabelSide | null> = [];
  let k = 0;
  for (let i = 0; i < items.length; i++) allSides.push(active[i] ? sides[k++] : null);

  const climbs: V6RouteLabelPlan["climbs"] = points.climbs.map((_, i) => ({ side: null, tag: climbTexts[i].tag, name: climbTexts[i].name }));
  climbOrder.forEach((ci, j) => { climbs[ci].side = allSides[j]; });
  const sprints = points.sprints.map((_, i) => ({ side: allSides[climbOrder.length + i], tag: sprintTexts[i] }));
  return { climbs, sprints };
}
