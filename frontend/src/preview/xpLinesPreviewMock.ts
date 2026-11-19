// #7947 · Preview only (VITE_PREVIEW_MOCK): ?xp=1 shows the ability lines as they look
// with XP switched on. /api/training/me gets an invented `xp_bar` (whole numbers, the
// same shape the server sends) and capped = {}, exactly what the server does under XP.
// The prices are made up for the picture; the real ones never leave the server.
// Without ?xp=1 the response is untouched.
import { ABILITY_KEYS } from "../lib/abilities.js";

type Bars = Record<string, Record<string, { xp: number; price: number }>>;
type Body = (Record<string, unknown> & { progress?: Record<string, Record<string, number>> }) | null;

export function previewXpLinesActive(search: string = typeof window === "undefined" ? "" : window.location.search): boolean {
  return new URLSearchParams(search).get("xp") === "1";
}

// Deterministic, invented numbers so the before/after screenshots are stable.
function hash(text: string): number {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) h = Math.imul(h ^ text.charCodeAt(i), 16777619);
  return (h >>> 0) / 4294967296;
}

// The owner's example (19/11) on Ada's sprint line.
const EXAMPLE: Record<string, Record<string, { xp: number; price: number }>> = {
  "rider-1": { sprint: { xp: 312, price: 540 } },
};

export function previewXpBars(body: Body): Bars {
  const ids = new Set<string>();
  for (const key of ["progress", "condition", "plans", "capped"]) {
    const map = body?.[key];
    if (map && typeof map === "object") for (const id of Object.keys(map)) ids.add(id);
  }
  const bars: Bars = {};
  for (const id of ids) {
    bars[id] = {};
    for (const ability of ABILITY_KEYS as readonly string[]) {
      const price = 380 + Math.round(hash(`${id}:${ability}:price`) * 320);
      const frac = Number(body?.progress?.[id]?.[ability]);
      const share = Number.isFinite(frac) ? frac : hash(`${id}:${ability}:bar`) * 0.9;
      bars[id][ability] = EXAMPLE[id]?.[ability] ?? { xp: Math.round(share * price), price };
    }
  }
  return bars;
}

/** 19/11: dagens XP pr. evne paa kvitteringens aktiviteter (opdigtet), saa "i dag +x XP" kan ses i preview. */
function withPreviewActivityXp(run: any): any {
  const riders = run?.report?.riders;
  if (!Array.isArray(riders)) return run;
  const keys = ABILITY_KEYS as readonly string[];
  // Som prod (#8484): XP pr. evne staar paa hver sessions raekke (`xp`); kvitteringen samler dem som activities.
  return { ...run, report: { ...run.report, riders: riders.map((row: any) => ({
    ...row,
    xp: Object.fromEntries(keys.filter((k) => hash(`${row?.rider_id}:${k}:on`) > 0.55).map((k) => [k, 5 + Math.round(hash(`${row?.rider_id}:${k}:xp`) * 50)])),
  })) } };
}

/** Post-processes a mock response: with ?xp=1 the training payload carries XP. */
export async function withXpLinesPreview(url: string, method: string, response: Response): Promise<Response> {
  if (!previewXpLinesActive() || method !== "GET" || !response) return response;
  let pathname: string;
  try { pathname = new URL(url, window.location.origin).pathname; } catch { return response; }
  if (!pathname.endsWith("/api/training/me")) return response;
  let body: Body;
  try { body = await response.clone().json(); } catch { return response; }
  if (!body || typeof body !== "object") return response;
  const next = { ...body, capped: {}, xp_bar: previewXpBars(body), todayRun: withPreviewActivityXp(body.todayRun) };
  return new Response(JSON.stringify(next), { status: 200, headers: { "Content-Type": "application/json" } });
}
