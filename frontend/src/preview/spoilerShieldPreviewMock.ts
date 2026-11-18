// #8388: preview-override for spoiler-skjoldet (KUN preview-mocken, aldrig prod).
//
// Skjoldet (#7859) er slukket for alle spillere, og svaret kommer fra serveren, som preview ikke har.
// ?spoilerShield=on svarer som om skjoldet er tændt for løbet og ingen etaper er åbnet; "Vis resultater"
// åbner en etape i hukommelsen (som serveren ville). ?spoilerShield=off slukker igen. Huskes i
// localStorage. Uden parameteren er alt uændret, så Playwright-snapshots ikke flytter sig.

const STORAGE_KEY = "cz_mock_spoiler_shield";
const opened = new Map<string, number[]>();

export function previewSpoilerShieldEnabled() {
  try {
    const param = new URLSearchParams(window.location.search).get("spoilerShield");
    if (param === "on") localStorage.setItem(STORAGE_KEY, "1");
    if (param === "off") localStorage.setItem(STORAGE_KEY, "0");
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false; // storage kan vaere blokeret; preview uden override
  }
}
// Læses ved indlæsning, så parameteren virker, før en side omskriver URL'en.
previewSpoilerShieldEnabled();

const json = (body: unknown) => new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });

/** Svar for /api/me/spoiler-shield*; null = ikke vores route (eller overriden er ikke tændt). */
export function spoilerShieldPreviewRoute(url: string, method: string, init?: { body?: unknown }): Response | null {
  if (!previewSpoilerShieldEnabled()) return null;
  const openMatch = url.match(/\/api\/me\/spoiler-shield\/races\/([^/?]+)\/opened$/);
  if (openMatch && method === "POST") {
    const raceId = decodeURIComponent(openMatch[1]);
    let stage: unknown = null;
    try { stage = JSON.parse(String(init?.body ?? "{}")).stage; } catch { /* ugyldigt svar = ingen etape */ }
    if (typeof stage === "number" && Number.isInteger(stage)) opened.set(raceId, [...new Set([...(opened.get(raceId) ?? []), stage])]);
    return json({ ok: true });
  }
  const readMatch = url.match(/\/api\/me\/spoiler-shield(?:\?raceId=([^&]+))?$/);
  if (readMatch && method === "GET") {
    const raceId = readMatch[1] ? decodeURIComponent(readMatch[1]) : null;
    return json({
      enabled: true,
      settings: { shieldAll: true, openFinishedIn: "results" },
      race: raceId ? { shield: true, openedStages: opened.get(raceId) ?? [] } : null,
    });
  }
  return null;
}
