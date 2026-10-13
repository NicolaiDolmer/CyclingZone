// #6574: GET /api/og/stage — delbart road book-billede (1200x630 PNG) pr. etape, til og:image og "Del".
// Vercel OG (satori + resvg, WASM): 0 kr. ekstra, ingen ekstern tjeneste, ingen hemmeligheder.
//
//   /api/og/stage?race=Ruta%20Cantabrica&stage=2&of=5&type=mountain&km=180&gain=3400
//       &climbs=75~5~5.1~3~Collado%20de%20Cordal;180~15.5~7.4~1~Alto%20de%20Portelo&sprints=82
//   /api/og/stage?demo=mountain|hilly|flat|high   (opfundne eksempel-etaper)
//
// Parametrene valideres i _lib/params.js. Svaret er URL-adresseret, så det caches hårdt på Vercels CDN.
import { ImageResponse } from "@vercel/og";
import { parseStageParams, OG_WIDTH, OG_HEIGHT } from "./_lib/params.js";
import { buildStageCard } from "./_lib/card.js";
import { DEMO_STAGES } from "./_lib/demo.js";
import { loadFonts } from "./_lib/fonts.js";

export const config = { runtime: "edge" };

// Billedet er en ren funktion af URL'en → CDN må holde det længe; browsere kortere, så en ny kortversion
// slår hurtigt igennem. En fejlside caches aldrig.
const CACHE_OK = "public, max-age=3600, s-maxage=2592000, stale-while-revalidate=86400";

function plain(status, message) {
  return new Response(message, { status, headers: { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" } });
}

export default async function handler(request) {
  if (request.method !== "GET" && request.method !== "HEAD") return plain(405, "Method not allowed");
  const { searchParams } = new URL(request.url);

  let value;
  const demoKey = searchParams.get("demo");
  if (demoKey) {
    value = Object.hasOwn(DEMO_STAGES, demoKey) ? DEMO_STAGES[demoKey] : undefined; // aldrig prototype-nøgler som "constructor"
    if (!value) return plain(404, `Unknown demo. Use one of: ${Object.keys(DEMO_STAGES).join(", ")}`);
    if (searchParams.get("lang") === "da") value = { ...value, lang: "da" };
  } else {
    const parsed = parseStageParams(searchParams);
    if (!parsed.ok) return plain(400, parsed.error);
    value = parsed.value;
  }

  try {
    const image = new ImageResponse(buildStageCard(value), {
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
