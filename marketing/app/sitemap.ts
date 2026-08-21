import type { MetadataRoute } from "next";

const BASE = "https://cyclingzone.org";

// Genereres ved build. Erstatter frontend/public/sitemap.xml for de offentlige
// stier ved S3-cutover (#4067); nye sider tilføjes her, aldrig håndskrevet XML.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    {
      url: `${BASE}/`,
      alternates: { languages: { en: `${BASE}/`, da: `${BASE}/da` } },
    },
    {
      url: `${BASE}/da`,
      alternates: { languages: { en: `${BASE}/`, da: `${BASE}/da` } },
    },
  ];
}
