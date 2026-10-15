// Vis en LOKAL frontend-build med ejerens rigtige prod-data, uden login:
// den gemte ejer-profil aabner cyclingzone.org, men HTML og /assets/* serveres
// fra <dist>. Alle API-/Supabase-kald gaar uaendret til prod (kun laesning i
// de sider vi viser). Brug: import { withLocalBuild } fra dette modul.
import { readFile } from "node:fs/promises";
import { join, extname } from "node:path";
import { withOwnerContext } from "./owner-session.mjs";
const TYPES = { ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".woff2": "font/woff2", ".png": "image/png", ".json": "application/json", ".webp": "image/webp" };
export async function withLocalBuild(dist, opts, fn) {
  return withOwnerContext(opts, async (c) => {
    await c.route(/^https:\/\/cyclingzone\.org\/.*/, async (route) => {
      const req = route.request(); const url = new URL(req.url());
      if (url.pathname.startsWith("/assets/") || /\.(woff2|svg|png|webp|ico|json|js|css)$/.test(url.pathname)) {
        try { const body = await readFile(join(dist, url.pathname)); return route.fulfill({ body, contentType: TYPES[extname(url.pathname)] || "application/octet-stream" }); } catch { return route.continue(); }
      }
      if (req.resourceType() === "document") return route.fulfill({ body: await readFile(join(dist, "index.html")), contentType: "text/html" });
      return route.continue();
    });
    return fn(c);
  });
}
