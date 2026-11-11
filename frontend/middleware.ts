import { next, rewrite } from "@vercel/functions";
import { authStorageKey, hasAuthCookie, landingGuardScript } from "./src/lib/authLanding.ts";

const MARKETING_HOST = "cycling-zone-marketing.vercel.app";
const UPSTREAM_TIMEOUT_MS = 2000;
export const config = {
  matcher: [
    "/",
    "/da",
    "/da/",
    "/ingest/:path*",
    "/_next/:path*",
    "/landing/:path*",
    "/how-it-works",
    "/pro-cycling-manager-alternative",
    "/da/saadan-fungerer-det",
    "/da/pro-cycling-manager-alternativ",
    "/api/email/unsubscribe",
  ],
};

export default async function middleware(request: Request) {
  const incoming = new URL(request.url);
  if (!["/", "/da", "/da/"].includes(incoming.pathname)) {
    // External rewrites forward incoming headers by default. Never send browser
    // credentials to analytics, marketing or the public unsubscribe endpoint.
    const headers = new Headers(request.headers);
    headers.delete("cookie");
    headers.delete("authorization");
    return next({ request: { headers } });
  }
  const fallback = () => {
    if (incoming.pathname === "/") return;
    const target = new URL("/app.html", incoming);
    target.search = incoming.search;
    return rewrite(target, { headers: { "cache-control": "private, no-store" } });
  };
  const key = authStorageKey(process.env.VITE_SUPABASE_URL);
  // Presence selects the app shell; Supabase/RLS still authorizes all player data.
  if (
    hasAuthCookie(request.headers.get("cookie") || "", key) ||
    incoming.searchParams.has("code")
  ) {
    const target = new URL("/dashboard", incoming);
    target.search = incoming.search;
    return new Response(null, {
      status: 307,
      headers: {
        location: target.href,
        "cache-control": "private, no-store",
        "cdn-cache-control": "no-store",
        "vercel-cdn-cache-control": "no-store",
        vary: "Cookie, Accept-Language",
      },
    });
  }
  const language = request.headers.get("accept-language") || "";
  const first = language.split(",")[0]?.trim().split(";")[0]?.toLowerCase();
  const danish = incoming.pathname.startsWith("/da") || first === "da" || first?.startsWith("da-");
  const upstream = new URL(`https://${MARKETING_HOST}${danish ? "/da" : "/"}`);
  upstream.search = incoming.search;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), UPSTREAM_TIMEOUT_MS);
  try {
    const response = await fetch(upstream, {
      headers: {
        "x-forwarded-host": incoming.host,
        "x-forwarded-proto": "https",
        "user-agent": request.headers.get("user-agent") || "",
        ...(language ? { "accept-language": language } : {}),
      },
      signal: controller.signal,
    });
    if (!response.ok) return fallback();
    const html = await response.text();
    const guard = `<script>${landingGuardScript(key)}</script>`;
    // If markup changes upstream, use the guarded local prerender instead.
    if (!/<head(?:\s[^>]*)?>/i.test(html)) return fallback();
    const headers = new Headers(response.headers);
    for (const name of ["content-encoding", "content-length", "etag", "set-cookie"])
      headers.delete(name);
    headers.set("cache-control", "private, no-store");
    headers.set("cdn-cache-control", "no-store");
    headers.set("vercel-cdn-cache-control", "no-store");
    headers.set("vary", "Cookie, Accept-Language");
    headers.set("content-type", "text/html; charset=utf-8");
    return new Response(
      html.replace(/<head(?:\s[^>]*)?>/i, (head) => head + guard),
      { headers }
    );
  } catch {
    return fallback();
  } finally {
    clearTimeout(timeout);
  }
}
