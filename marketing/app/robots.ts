import type { MetadataRoute } from "next";

const BASE = "https://cyclingzone.org";

// Genereres ved build (Next MetadataRoute.Robots), erstatter en haandskrevet
// robots.txt ved S3-cutover (#4067). Ingen login-flader findes paa marketing-
// sitet, saa der er intet at disallow'e endnu.
export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/" },
    sitemap: `${BASE}/sitemap.xml`,
  };
}
