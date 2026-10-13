// #6574 · GET /api/public/stage-route/:stageId — én etapes rute, offentligt og read-only.
//
// Hvorfor den findes: road book-billedet (frontend/api/og/stage.ts, Vercel edge) skal tegne
// etapens RIGTIGE terræn fra race_stage_profiles, ikke en kurve der står i URL'en. Tabellen
// har kun authenticated-select (RLS), og Vercel-funktionen har ingen service-nøgle (og skal
// ikke have en). Backenden har allerede service-klienten, så den svarer med et snævert,
// whitelistet udsnit: præcis det en spiller kan se på etapesiden (rute, stigninger, sprints,
// brosten, løbsnavn), intet om hold, ryttere, demand_vector, vejr eller motorens tal.
//
// KONTRAKT (ren læsning, ingen skrivning):
//   200 { stage: { id, race_name, stage_number, stage_count, profile_type, distance_km,
//                  elevation_gain_m, climbs[], sprints[], sectors[], segments[] } }
//   400 invalid_stage_id · 404 stage_not_found · 500 stage_route_failed
// Cache: public, 5 min i browseren, 1 time på en delt cache. Etapen er offentligt indhold.
//
// EGEN route-fil, monteret i server.js FØR apiRoutes (samme mønster som comeback.js og
// boardVerdict.js): routes/api.js er stor og delt af mange bølge-laner.
import express from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";
import { captureException } from "../lib/sentry.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CACHE_OK = "public, max-age=300, s-maxage=3600";

const SEGMENT_KINDS = new Set(["flat", "rolling", "climb", "descent", "cobbles"]);

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}
function str(value, max = 60) {
  return typeof value === "string" ? value.slice(0, max) : null;
}
const arr = (v) => (Array.isArray(v) ? v : []);

/**
 * Whitelist af én race_stage_profiles-række + løbet. Eksporteret så testen kan låse,
 * at intet ud over rute-felterne slipper ud (fx top_elevation_m, demand_vector, weather).
 */
export function toPublicStageRoute(profile, race) {
  return {
    id: profile.id,
    race_name: str(race?.name, 80) ?? "",
    stage_number: num(profile.stage_number) ?? 1,
    stage_count: num(race?.stages) ?? 1,
    profile_type: str(profile.profile_type, 32),
    distance_km: num(profile.distance_km),
    elevation_gain_m: num(profile.elevation_gain_m),
    climbs: arr(profile.climbs).map((c) => ({
      name: str(c?.name),
      category: str(String(c?.category ?? ""), 3),
      crest_km: num(c?.crest_km),
      length_km: num(c?.length_km),
      avg_gradient: num(c?.avg_gradient),
      summit_finish: c?.summit_finish === true,
    })),
    sprints: arr(profile.sprints).map((s) => ({ km: num(s?.km), kind: str(s?.kind, 20) })),
    sectors: arr(profile.sectors).map((s) => ({
      name: str(s?.name), start_km: num(s?.start_km), length_km: num(s?.length_km),
    })),
    segments: arr(profile.segments)
      .filter((s) => SEGMENT_KINDS.has(s?.kind))
      .map((s) => ({
        kind: s.kind,
        from_km: num(s.from_km),
        to_km: num(s.to_km),
        ...(s.kind === "climb" ? { category: str(String(s.category ?? ""), 3), avg_gradient: num(s.avg_gradient) } : {}),
        ...(s.kind === "cobbles" ? { sector_name: str(s.sector_name), stars: num(s.stars) } : {}),
      })),
  };
}

/** Læser én etape. Eksporteret så testen kan køre den uden Express. Null = findes ikke. */
export async function loadPublicStageRoute(supabase, stageId) {
  const { data: profile, error } = await supabase
    .from("race_stage_profiles")
    .select("id, race_id, stage_number, profile_type, distance_km, elevation_gain_m, climbs, sprints, sectors, segments")
    .eq("id", stageId)
    .maybeSingle();
  if (error) throw new Error(`race_stage_profiles: ${error.message}`);
  if (!profile) return null;
  const { data: race, error: raceError } = await supabase
    .from("races")
    .select("id, name, stages")
    .eq("id", profile.race_id)
    .maybeSingle();
  if (raceError) throw new Error(`races: ${raceError.message}`);
  return toPublicStageRoute(profile, race);
}

export function createPublicStageRouteRouter({ supabase }) {
  const router = express.Router();
  // Står FØR api.js, så apiBaselineLimiter dækker ikke. Et OG-billede caches på Vercels CDN,
  // så backenden ser kun cache-miss; loftet er bevidst rummeligt (edge-kald deler få IP'er).
  const limiter = rateLimit({
    windowMs: 60_000,
    limit: 300,
    standardHeaders: "draft-7",
    legacyHeaders: false,
    keyGenerator: (req) => `public-stage-route:${ipKeyGenerator(req.ip)}`,
    skip: () => process.env.RATE_LIMIT_DISABLED === "1",
  });

  router.get("/:stageId", limiter, async (req, res) => {
    const { stageId } = req.params;
    if (!UUID_RE.test(String(stageId ?? ""))) return res.status(400).json({ error: "invalid_stage_id" });
    try {
      const stage = await loadPublicStageRoute(supabase, stageId);
      if (!stage) return res.status(404).json({ error: "stage_not_found" });
      res.set("Cache-Control", CACHE_OK);
      return res.json({ stage });
    } catch (err) {
      captureException(err, { tags: { route: "public-stage-route" } });
      console.error("[public-stage-route] read failed", err instanceof Error ? err.message : err);
      return res.status(500).json({ error: "stage_route_failed" });
    }
  });
  return router;
}
