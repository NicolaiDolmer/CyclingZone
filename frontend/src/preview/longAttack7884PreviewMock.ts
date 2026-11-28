// #8828 · preview (`?longAttack=1`, kræver `?stagePlan=1`): taktikfanen med "Angrib på"-stederne, så
// ejeren kan se skærmen før kontakten tændes. Stederne bygges af de samme seedede etapeprofiler som
// profilen over taktikken, med serverens regel (backend/lib/tacticAttackTrigger7884.attackPlacesView7884).
import { SEED_STAGE_PROFILES } from "./seedData.js";

const STORAGE_KEY = "cz-preview-long-attack-7884";
const FINAL_KM = 10;
const CATEGORIES = new Set(["HC", "1", "2", "3", "4"]);

export function longAttackPreviewActive(): boolean {
  try {
    if (typeof window === "undefined") return false;
    if (new URLSearchParams(window.location.search).get("longAttack") === "1") {
      window.sessionStorage.setItem(STORAGE_KEY, "1");
      return true;
    }
    return window.sessionStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // storage kan vaere blokeret; preview uden stederne
  }
}

type Climb = { name?: string | null; category?: string; crest_km?: number; km?: number; length_km?: number; summit_finish?: boolean };
type Profile = { race_id: string; stage_number: number; distance_km: number; profile_type: string; climbs?: Climb[] };
type Place = { key: string; kind: "climb" | "finale"; trigger: object; name: string | null; category: string | null; foot_km: number; crest_km: number | null; summit_finish: boolean };

function placesOf(p: Profile): Place[] {
  if (/^itt|ttt/.test(p.profile_type)) return [];
  const out: Place[] = [];
  (p.climbs ?? []).forEach((c, index) => {
    const crest = Number(c.crest_km ?? c.km);
    const length = Number(c.length_km);
    const category = String(c.category ?? "");
    if (!CATEGORIES.has(category) || !(crest > 0 && crest <= p.distance_km) || !(length > 0)) return;
    out.push({
      key: `climb:${index}`, kind: "climb", trigger: { at: "climb_start", kom_index: index },
      name: c.name && c.name.trim() ? c.name : null, category, foot_km: Math.max(0, crest - length), crest_km: crest,
      summit_finish: c.summit_finish === true || crest === p.distance_km,
    });
  });
  out.push({ key: "finale", kind: "finale", trigger: { at: "finale" }, name: null, category: null, foot_km: Math.max(0, p.distance_km - FINAL_KM), crest_km: null, summit_finish: false });
  return out.sort((a, b) => a.foot_km - b.foot_km);
}

function view(p: Profile) {
  const places = placesOf(p);
  return {
    fingerprint: `preview-${p.race_id}-${p.stage_number}`,
    places: places.map((pl) => {
      const after = places.filter((x) => x.kind === "climb" && x.foot_km > pl.foot_km).length;
      const feet = places.filter((x) => x.kind === "climb" && pl.crest_km !== null && x.foot_km >= pl.crest_km).map((x) => x.foot_km);
      const valley = pl.kind !== "climb" || pl.summit_finish || pl.crest_km === null ? null : Math.round((feet.length ? Math.min(...feet) : p.distance_km) - pl.crest_km);
      const label = pl.kind === "finale" ? { key: "finale", from_km: Math.round(pl.foot_km) }
        : pl.name ? { key: "climb", name: pl.name, summit_finish: pl.summit_finish }
          : { key: "climbUnnamed", category: pl.category, km: Math.round(pl.crest_km ?? 0), summit_finish: pl.summit_finish };
      return { key: pl.key, kind: pl.kind, trigger: pl.trigger, label, facts: { foot_km: Math.round(pl.foot_km), climbs_after: after, summit_finish: pl.summit_finish, valley_after_km: valley, category: pl.category } };
    }),
  };
}

/** GET team-orders med stederne for løbets etaper (som serveren, når løbet tager imod dem). */
export function withLongAttackPreview<T extends object>(body: T, raceId: string): T & { long_attack_7884: Record<string, unknown> } {
  const byStage: Record<string, unknown> = {};
  for (const p of (SEED_STAGE_PROFILES as Profile[]).filter((x) => x.race_id === raceId)) byStage[String(p.stage_number)] = view(p);
  return { ...body, long_attack_7884: byStage };
}
