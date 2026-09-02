import type { MetadataRoute } from "next";

const BASE = "https://cyclingzone.org";

// Genereres ved build. Erstatter frontend/public/sitemap.xml for de offentlige
// stier ved S3-cutover (#4067); nye sider tilføjes her, aldrig håndskrevet XML.
const PAGES: Array<{ en: string; da: string }> = [
  { en: "/", da: "/da" },
  { en: "/how-it-works", da: "/da/saadan-fungerer-det" },
  { en: "/pro-cycling-manager-alternative", da: "/da/pro-cycling-manager-alternativ" },
];

export default function sitemap(): MetadataRoute.Sitemap {
  return PAGES.flatMap(({ en, da }) => {
    const alternates = { languages: { en: `${BASE}${en}`, da: `${BASE}${da}` } };
    return [
      { url: `${BASE}${en}`, alternates },
      { url: `${BASE}${da}`, alternates },
    ];
  });
}
