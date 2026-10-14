// #4545: en manglende fil under /assets/ skal fejle rent: 404 som ren tekst, aldrig
// HTML og aldrig cachet. Vercel serverer ellers public/404.html (#6557) for ALLE
// ukendte stier, og en HTML-side på en chunk-URL kan låse spillere bag
// chunk-fallbacken. Rewriten i vercel.json rammer kun, når filen ikke findes,
// fordi Vercel tjekker filsystemet før rewrites.
export function GET(): Response {
  return new Response("Not found\n", {
    status: 404,
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store",
      "x-robots-tag": "noindex",
    },
  });
}

export const HEAD = GET;
