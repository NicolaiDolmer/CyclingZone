// #7801 rest-byg · preview med kontakten fatigue_now_7801 taendt, til billeder og ejerens egen
// klik-rundtur foer taending. Prod roeres ikke; kun preview-mockens svar aendres.
//   ?fatigueNow=on      tallet lige nu: en rytter har koert to haarde etaper i dag (tallet stiger),
//                       en anden en let etape (tallet falder). Traening faar skoennet ved start.
//   ?fatigueNow=unknown som "on", men tallet kunne ikke regnes for nogle ryttere (serveren sender
//                       null, skaermen viser "—"); regelpanelet i trainingFatigueRulesMock.js.
//   udeladt / off       som i dag (Playwright-fixtures og snapshots er urort).
// Tallene er preview-fiktion oven paa seed-dataene, ikke regnet af serveren.
import { previewFatigueNowMode } from "./trainingFatigueRulesMock.js";
import { SEED_SELECTION, SEED_STAGE_ROLES_BY_RACE, SEED_TRAINING } from "./seedData.js";

type Mode = "on" | "unknown";
type Row = Record<string, unknown> & { fatigue?: number | null };
type Body = Record<string, unknown> & { flags?: Record<string, boolean>; condition?: Record<string, Row>; riders?: Row[] } | null;

const DELTA_TODAY: Record<string, number> = { "rider-1": 9, "rider-2": -2, "rider-97": 6, "rider-95": -1 };
const UNKNOWN_NOW = new Set(["rider-2", "rider-96"]);

function liveFatigue(id: string, opening: unknown, mode: Mode): number | null {
  if (mode === "unknown" && UNKNOWN_NOW.has(id)) return null;
  if (opening == null) return null;
  return Math.max(0, Math.min(100, Number(opening) + (DELTA_TODAY[id] ?? 0)));
}

function openingById() {
  const out = new Map<string, number | null>();
  for (const roles of Object.values(SEED_STAGE_ROLES_BY_RACE)) for (const r of roles?.riders ?? []) out.set(r.rider_id, r.fatigue);
  for (const r of SEED_SELECTION.riders ?? []) out.set(r.id, r.fatigue);
  for (const [id, c] of Object.entries(SEED_TRAINING.condition ?? {})) out.set(id, c.fatigue);
  return out;
}

function transform(pathname: string, body: Body, mode: Mode): unknown {
  if (pathname.endsWith("/api/feature-flags") && body?.flags && !Array.isArray(body.flags)) {
    // Rytterkortet (rider_hover_card) med, saa kortets tal kan ses i samme rundtur.
    return { ...body, flags: { ...body.flags, fatigue_now_7801: true, rider_hover_card: true } };
  }
  const card = pathname.match(/\/api\/riders\/([^/]+)\/fatigue-now$/);
  if (card) {
    const id = decodeURIComponent(card[1]);
    const opening = openingById();
    return opening.has(id) ? { enabled: true, own: true, fatigue: liveFatigue(id, opening.get(id), mode) } : { enabled: true, own: false, fatigue: null };
  }
  if (pathname.endsWith("/api/training/me") && body?.condition) {
    const condition = Object.fromEntries(Object.entries(body.condition as Record<string, Row>).map(([id, c]) => {
      const fatigue = liveFatigue(id, c.fatigue, mode);
      // Skoennet ved start: rytteren med etape senere i dag; de andre har ingen etape i dag eller i morgen.
      return [id, { ...c, fatigue, fatigue_at_start: id === "rider-1" ? fatigue : null }];
    }));
    return { ...body, condition };
  }
  if (/\/api\/races\/[^/]+\/selection$/.test(pathname) && Array.isArray(body?.riders)) {
    return { ...body, riders: (body.riders ?? []).map((r) => ({ ...r, fatigue: liveFatigue(String(r.id), r.fatigue, mode) })) };
  }
  if (/\/api\/races\/[^/]+\/stage-roles$/.test(pathname) && Array.isArray(body?.riders)) {
    return { ...body, riders: (body.riders ?? []).map((r) => ({ ...r, fatigue: liveFatigue(String(r.rider_id), r.fatigue, mode) })) };
  }
  return undefined;
}

/** Efterbehandler et mock-svar med kontakten taendt. Uden ?fatigueNow: svaret uaendret. */
export async function withFatigueNowPreview(url: string, method: string, response: Response): Promise<Response> {
  const mode = previewFatigueNowMode() as Mode | "off";
  if (mode === "off" || method !== "GET" || !response) return response;
  let pathname: string;
  try { pathname = new URL(url, window.location.origin).pathname; } catch { return response; }
  if (!/\/api\/(feature-flags|riders\/[^/]+\/fatigue-now|training\/me|races\/[^/]+\/(selection|stage-roles))$/.test(pathname)) return response;
  let body: Body;
  try { body = await response.clone().json(); } catch { body = null; }
  const next = transform(pathname, body, mode);
  if (next === undefined) return response;
  return new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } });
}
