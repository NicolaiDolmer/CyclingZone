import { headers } from "next/headers";
import type { MetadataRoute } from "next";

const BASE = "https://cyclingzone.org";

// Genereres ved build (Next MetadataRoute.Robots), erstatter en haandskrevet
// robots.txt ved S3-cutover (#4067). Ingen login-flader findes paa marketing-
// sitet, saa der er intet at disallow'e endnu.
//
// #4067: samme deployment svarer paa BAADE cyclingzone.org (via frontend/
// vercel.json-rewrites) OG paa sit eget cycling-zone-marketing.vercel.app-
// domaene. Kun cyclingzone.org maa indekseres - vercel.app-domaenet disallow'er
// sig selv her, saa Google ikke ser dubleret indhold paa to URL'er. headers()
// goer routen dynamisk (ingen static-export af denne fil).
export default async function robots(): Promise<MetadataRoute.Robots> {
  const host = (await headers()).get("host") ?? "";
  const isCanonicalHost = host === "cyclingzone.org" || host === "www.cyclingzone.org";

  if (!isCanonicalHost) {
    return { rules: { userAgent: "*", disallow: "/" } };
  }

  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
