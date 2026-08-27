// Kanal-SSOT (#4320). Ren + DB-fri, så den kan unit-testes uden Supabase.
//
// Hele pointen med dette modul: trafik-siden (traffic_events) og signup-siden
// (signup_attribution) SKAL mappe til nøjagtig samme kanal-nøgle, ellers kan
// konverteringsraten per kanal ikke beregnes. Begge aggregatorer kalder
// resolveChannel() herfra. Tilføj aldrig kanal-logik et andet sted.
//
// Politikken bor i JS, ikke i databasen: `traffic_events` gemmer FAKTA (rå
// referrer + host + UTM), og mappingen fra fakta til kanal sker ved læsning.
// Så kan aliaslisten udvides (nye AI-assistenter dukker op løbende) uden at
// historiske rækker skal migreres.

export const DIRECT = "(direct)";

// Vores egne værter. En referrer herfra er ikke en kanal, det er intern
// navigation der slap ud som referrer (SPA-artefaktet fra #3819/#2040, hvor
// 214 af 595 Clarity-sessions var cyclingzone.org → cyclingzone.org).
export const SELF_HOSTS = Object.freeze([
  "cyclingzone.org",
  "www.cyclingzone.org",
  "cycling-zone.vercel.app",
]);

// Eksakte host-matches. Nøglerne er lowercase hostnames som new URL().hostname
// producerer dem — bemærk at android-app://-referrers giver pakkenavnet som
// hostname ("com.reddit.frontpage"), hvilket er verificeret adfærd i Node og
// browsere.
const EXACT_HOSTS = new Map([
  // Reddit: web og app er SAMME kanal. Før #4320 blev de talt hver for sig,
  // hvilket undervurderede Reddit med en tredjedel (12 web + 4 app = 16).
  ["reddit.com", "reddit"],
  ["www.reddit.com", "reddit"],
  ["old.reddit.com", "reddit"],
  ["np.reddit.com", "reddit"],
  ["com.reddit.frontpage", "reddit"],

  // E-mail-klienter. android-app://com.google.android.gm/ er Gmail-appen og
  // stod for 11 signups der blev rapporteret som "ukendt" før #4320.
  ["com.google.android.gm", "email"],
  ["mail.google.com", "email"],
  ["outlook.live.com", "email"],
  ["outlook.office.com", "email"],
  ["mail.yahoo.com", "email"],

  // AI-assistenter. Allerede en top-5-kilde (#4322).
  ["chatgpt.com", "ai-assistant"],
  ["chat.openai.com", "ai-assistant"],
  ["openai.com", "ai-assistant"],
  ["perplexity.ai", "ai-assistant"],
  ["www.perplexity.ai", "ai-assistant"],
  ["claude.ai", "ai-assistant"],
  ["copilot.microsoft.com", "ai-assistant"],
  ["gemini.google.com", "ai-assistant"],

  // Søgemaskiner uden landedomæner.
  ["duckduckgo.com", "organic-search"],
  ["bing.com", "organic-search"],
  ["www.bing.com", "organic-search"],
  ["msn.com", "organic-search"],
  ["www.msn.com", "organic-search"],
  ["ecosia.org", "organic-search"],
  ["www.ecosia.org", "organic-search"],
  ["search.yahoo.com", "organic-search"],
  ["search.brave.com", "organic-search"],

  // Sociale medier og communities.
  ["discord.com", "discord"],
  ["discord.gg", "discord"],
  ["ptb.discord.com", "discord"],
  ["canary.discord.com", "discord"],
  ["com.discord", "discord"],
  ["t.co", "twitter"],
  ["twitter.com", "twitter"],
  ["x.com", "twitter"],
  ["facebook.com", "facebook"],
  ["www.facebook.com", "facebook"],
  ["m.facebook.com", "facebook"],
  ["l.facebook.com", "facebook"],
  ["com.facebook.katana", "facebook"],
  ["youtube.com", "youtube"],
  ["www.youtube.com", "youtube"],
  ["m.youtube.com", "youtube"],
  ["github.com", "github"],
]);

// Domæne-regler for værter der varierer. Matcher BÅDE apex-domænet selv og
// ethvert subdomæne under det.
//
// At matche apex separat er ikke en detalje: en ren suffiks-test på
// ".dugout-online.com" fanger www.dugout-online.com men IKKE dugout-online.com,
// så samme side blev til to kanaler. Præcis samme fejlklasse som Reddit-web vs.
// Reddit-app, fundet ved at køre aggregatoren mod ægte prod-data 27/8.
//
// Hattrick roterer på nummererede servere (www85..www89, stage) og er derfor
// umulig at dække med en eksakt liste. Google har ~190 landedomæner.
const DOMAIN_RULES = Object.freeze([
  { domain: "hattrick.org", channel: "hattrick" },
  { domain: "dugout-online.com", channel: "dugout-online" },
  { domain: "reddit.com", channel: "reddit" },
  { domain: "perplexity.ai", channel: "ai-assistant" },
  { domain: "discord.com", channel: "discord" },
  { domain: "youtube.com", channel: "youtube" },
  { domain: "facebook.com", channel: "facebook" },
]);

function matchesDomain(host, domain) {
  return host === domain || host.endsWith(`.${domain}`);
}

// Google-landedomæner: google.com, google.dk, google.co.uk, www.google.de ...
// Bevidst snæver: kræver at værten ER google eller starter med "www.google."
// eller en anden google-subdomæne-form, så "notgoogle.com" ikke fanges.
const GOOGLE_HOST = /^(?:[a-z0-9-]+\.)?google(?:\.[a-z]{2,3}){1,2}$/;

// Aliaser for utm_source-værdier vi selv eller andre sætter. Uden dem ville
// ChatGPT's egen tagging (utm_source=chatgpt.com) blive sin egen kanal, adskilt
// fra referrer-baserede chatgpt.com-besøg.
const SOURCE_ALIASES = new Map([
  ["chatgpt.com", "ai-assistant"],
  ["chatgpt", "ai-assistant"],
  ["openai", "ai-assistant"],
  ["perplexity", "ai-assistant"],
  ["claude", "ai-assistant"],
  ["gmail", "email"],
  ["newsletter", "email"],
  ["mail", "email"],
  ["google", "organic-search"],
  ["bing", "organic-search"],
  ["duckduckgo", "organic-search"],
  ["www.reddit.com", "reddit"],
  ["reddit.com", "reddit"],
  ["hattrick.org", "hattrick"],
  ["twitter", "twitter"],
  ["x", "twitter"],
]);

function norm(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

// Sammentræk en referrer-URL til dens host, så "https://google.com/search?q=x"
// og "https://google.com/" tæller som én kanal. Falder tilbage til den rå
// streng når den ikke kan parses, og til null når der ingen referrer er.
export function referrerHost(referrer) {
  const raw = norm(referrer);
  if (!raw) return null;
  try {
    return new URL(raw).hostname.toLowerCase() || raw.toLowerCase();
  } catch {
    // best-effort: en referrer der ikke kan parses som URL er forventet input,
    // ikke en fejl. Klienten sender rå document.referrer, og eksotiske schemes
    // findes i naturen. Vi beholder den rå streng som "vært", så besøget stadig
    // kan grupperes i stedet for at forsvinde.
    return raw.toLowerCase();
  }
}

export function isSelfHost(host, selfHosts = SELF_HOSTS) {
  const h = norm(host);
  if (!h) return false;
  const lower = h.toLowerCase();
  return selfHosts.some((self) => lower === self || lower.endsWith(`.${self}`));
}

// Mapper en vært til en kanal. Returnerer værten selv når den er ukendt, så en
// ny trafikkilde dukker op i rapporten som sit eget navn i stedet for at
// forsvinde i en "other"-spand.
export function channelFromHost(host, selfHosts = SELF_HOSTS) {
  const h = norm(host);
  if (!h) return null;
  const lower = h.toLowerCase();
  if (isSelfHost(lower, selfHosts)) return DIRECT;
  const exact = EXACT_HOSTS.get(lower);
  if (exact) return exact;
  if (GOOGLE_HOST.test(lower)) return "organic-search";
  for (const { domain, channel } of DOMAIN_RULES) {
    if (matchesDomain(lower, domain)) return channel;
  }
  return lower;
}

// Den kanoniske kanal for et besøg eller en signup.
//
// utm_source vinder over referrer: har vi selv tagget linket, er det taggen der
// er sandheden. Uden UTM falder vi tilbage på referrer-værten, og uden begge
// dele er det (direct).
export function resolveChannel({ utmSource, referrer, host, selfHosts = SELF_HOSTS } = {}) {
  const source = norm(utmSource);
  if (source) {
    const lower = source.toLowerCase();
    return SOURCE_ALIASES.get(lower) || channelFromHost(lower, selfHosts) || lower;
  }
  const resolvedHost = norm(host) || referrerHost(referrer);
  if (!resolvedHost) return DIRECT;
  return channelFromHost(resolvedHost, selfHosts) || DIRECT;
}

// Trunkér en klient-leveret streng, eller giv null. Alt fra /api/collect er
// upålideligt input: feltet kan mangle, være et tal, et objekt eller vilkårligt
// langt.
function clip(value, max) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.slice(0, max) : null;
}

// Oversæt en /api/collect-body til de kanal-kolonner traffic_events forventer.
// Ren + DB-fri, så den kan unit-testes uden Express og Supabase.
//
// referrer_host udledes HER af den rå referrer i stedet for at blive læst fra
// klienten. Endpointet er offentligt og uautentificeret, så en klient-leveret
// vært ville være et frit tekstfelt i vores kanal-rapport.
//
// Længdegrænserne spejler frontend/src/lib/attribution.js: UTM 200, referrer
// 500, path 200. Klienten trunkerer allerede, men serveren stoler ikke på det.
export function sanitizeCollectChannel(body) {
  const src = body && typeof body === "object" ? body : {};
  const referrer = clip(src.referrer, 500);
  return {
    referrer,
    referrer_host: referrer ? clip(referrerHost(referrer), 200) : null,
    utm_source: clip(src.utm_source, 200),
    utm_medium: clip(src.utm_medium, 200),
    utm_campaign: clip(src.utm_campaign, 200),
    landing_path: clip(src.landingPath, 200),
  };
}
