// #6574: GET /api/og/stage — delbart road book-billede (1200x630 PNG) pr. etape, til og:image og "Del".
// Vercel OG (satori + resvg, WASM): 0 kr. ekstra, ingen ekstern tjeneste, ingen hemmeligheder.
//
//   /api/og/stage?id=<race_stage_profiles.id>[&lang=da]   etapens rigtige rute, hentet server-side
//   /api/og/stage?demo=high|hilly|flat|cobbles[&lang=da]  faste udsnit af rigtige etaper (preview/test)
//
// Ruten hentes fra backendens offentlige, read-only endpoint (se _lib/stageRoute.ts for hvorfor);
// URL'en bærer kun etape-id og sprog, aldrig kurven. Billedet caches på Vercels CDN.
import { ImageResponse } from "@vercel/og";
import { buildStageCard, OG_WIDTH, OG_HEIGHT, type Lang } from "./_lib/card.ts";
import { DEMO_STAGES } from "./_lib/demo.ts";
import { loadFonts } from "./_lib/fonts.ts";
import { DEFAULT_API_ORIGIN, fetchStageRoute, normalizeStageRoute, type StageRoute } from "./_lib/stageRoute.ts";

export const config = { runtime: "edge" };

// En etapes rute ændrer sig sjældent (kun ved en regenerering før løbet), så CDN'et må holde
// billedet et døgn og servere det gamle mens det fornyes. En fejl caches aldrig.
const CACHE_OK = "public, max-age=3600, s-maxage=86400, stale-while-revalidate=86400";

function plain(status: number, message: string): Response {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

function apiOrigin(): string {
  const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
  const fromEnv = env?.OG_API_ORIGIN;
  return fromEnv && /^https:\/\//.test(fromEnv) ? fromEnv : DEFAULT_API_ORIGIN;
}

export default async function handler(request: Request): Promise<Response> {
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "Method not allowed");
  const { searchParams } = new URL(request.url);
  const lang: Lang = searchParams.get("lang") === "da" ? "da" : "en";

  let route: StageRoute | null;
  const demoKey = searchParams.get("demo");
  const id = searchParams.get("id");
  if (demoKey) {
    // Object.hasOwn: aldrig prototype-nøgler som "constructor".
    route = Object.hasOwn(DEMO_STAGES, demoKey) ? normalizeStageRoute(DEMO_STAGES[demoKey]) : null;
    if (!route) return plain(404, `Unknown demo. Use one of: ${Object.keys(DEMO_STAGES).join(", ")}`);
  } else if (id) {
    const result = await fetchStageRoute(id, { origin: apiOrigin() });
    if (!result.ok) return plain(result.status, result.error);
    route = result.route;
  } else {
    return plain(400, "id is required (a stage id), or demo=" + Object.keys(DEMO_STAGES).join("|"));
  }

  try {
    const image = new ImageResponse(buildStageCard(route, lang) as unknown as ConstructorParameters<typeof ImageResponse>[0], {
      width: OG_WIDTH,
      height: OG_HEIGHT,
      fonts: loadFonts(),
      headers: { "cache-control": CACHE_OK },
    });
    // @vercel/og renderer i streamens start-callback: en satori/resvg-fejl opstår først når kroppen læses.
    // Bufferen (ca. 80 kB) gør at catch-blokken nedenfor faktisk kan svare 500 i stedet for et afbrudt svar.
    const body = await image.arrayBuffer();
    return new Response(body, { status: image.status, headers: image.headers });
  } catch (err) {
    console.error("og/stage render failed", err instanceof Error ? err.message : err);
    return plain(500, "Could not render image");
  }
}
