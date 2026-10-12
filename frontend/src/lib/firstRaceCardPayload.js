// #1140 · rene hjaelpere til klientens "Your first race"-opslag (ingen React,
// ingen netvaerk), saa de kan unit-testes under node --test.
export const FIRST_RACE_PREVIEW_PARAM = "first-race";

/** Kun den praecise vaerdi sendes videre; serveren ignorerer den for alle ikke-beta/admin. */
export function readFirstRacePreviewParam(search) {
  try {
    return new URLSearchParams(search ?? "").get("preview") === FIRST_RACE_PREVIEW_PARAM
      ? FIRST_RACE_PREVIEW_PARAM
      : null;
  } catch {
    return null;
  }
}

/** Alt der ikke er et tydeligt `visible: true` giver INTET kort. */
export function normalizeFirstRaceCardPayload(data) {
  if (!data || data.visible !== true) return null;
  return {
    preview: data.preview === true,
    assistant_picks: data.assistant_picks === true,
    mail: data.mail === true,
    next_season_start: typeof data.next_season_start === "string" ? data.next_season_start : null,
  };
}
