// #6515 · "Har set patch notes / roadmap" gemt på brugeren, ikke på enheden.
//
// Før huskede kun browseren, hvornår spilleren sidst så patch notes og roadmap.
// Læste man noten på telefonen, var den gule prik der stadig på computeren.
// Nu ligger markøren også på brugerens række i public.user_ui_prefs (kolonnen
// seen_markers, se database/2026-11-14-6515-seen-markers.sql), så prikken følger
// spilleren på tværs af enheder.
//
// Værdien er en dato/tidsstempel-streng ("sidst set op til og med"). En markør
// kan kun rykke frem: serveren gemmer altid den nyeste af den gemte og den
// indsendte værdi. Så kan en enhed med en gammel lokal kopi aldrig hive en anden
// enheds nyere markør tilbage og få sete prikker til at dukke op igen. Fletningen
// sker atomisk i databasen (public.merge_seen_markers_6515), så to samtidige kald
// heller ikke kan overskrive hinanden.

/** Markørernes navne. Tilføj kun et navn når en flade faktisk læser det. */
export const SEEN_MARKER_KEYS = Object.freeze(["patch_notes", "roadmap"]);

// "2026-11-14" (patch notes) eller et ISO-tidsstempel som PostgREST leverer
// created_at i (roadmap). Andet afvises, så kolonnen aldrig bliver et frit lager.
const MARKER_PATTERN = /^\d{4}-\d{2}-\d{2}([T ]\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}(:?\d{2})?)?)?$/;
const MAX_MARKER_LENGTH = 40;

/** @param {unknown} value */
export function isValidSeenMarker(value) {
  if (typeof value !== "string" || value.length > MAX_MARKER_LENGTH) return false;
  if (!MARKER_PATTERN.test(value)) return false;
  return !Number.isNaN(Date.parse(value.replace(" ", "T")));
}

/**
 * Kun kendte markører med gyldig værdi forlader serveren.
 * @param {unknown} stored
 * @returns {Record<string, string>}
 */
export function publicSeenMarkers(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  /** @type {Record<string, string>} */
  const out = {};
  for (const key of SEEN_MARKER_KEYS) {
    const value = /** @type {any} */ (stored)[key];
    if (isValidSeenMarker(value)) out[key] = value;
  }
  return out;
}

/**
 * Tjek et PUT-body ({ markers: { key: value } }).
 * Fejl bærer `reason`, ikke `errorCode`: kaldet kører i baggrunden og vises
 * aldrig for spilleren, så der er ingen spillertekst at oversætte.
 * @param {unknown} body
 * @returns {{ ok: true, patch: Record<string, string> } | { ok: false, reason: string, error: string }}
 */
export function sanitizeSeenMarkersPatch(body) {
  const markers = body && typeof body === "object" ? /** @type {any} */ (body).markers : null;
  if (!markers || typeof markers !== "object" || Array.isArray(markers)) {
    return { ok: false, reason: "seen_markers_invalid_payload", error: "markers must be an object" };
  }
  const keys = Object.keys(markers);
  if (!keys.length) return { ok: false, reason: "seen_markers_invalid_payload", error: "markers must not be empty" };
  const unknown = keys.filter((k) => !SEEN_MARKER_KEYS.includes(k));
  if (unknown.length) {
    return { ok: false, reason: "seen_markers_unknown_keys", error: `Unknown marker keys: ${unknown.join(", ")}` };
  }
  const invalid = keys.filter((k) => !isValidSeenMarker(markers[k]));
  if (invalid.length) {
    return { ok: false, reason: "seen_markers_invalid_value", error: `Invalid value for: ${invalid.join(", ")}` };
  }
  return { ok: true, patch: Object.fromEntries(keys.map((k) => [k, markers[k]])) };
}

/**
 * Tabellen, kolonnen eller fletnings-funktionen findes ikke endnu (backend
 * deployet før migrationen): 42P01/42703/42883 fra Postgres eller
 * PGRST205/PGRST204/PGRST202 fra PostgREST's schema-cache.
 * @param {{ code?: string, message?: string } | null | undefined} error
 */
export function isMissingSeenMarkersStorage(error) {
  if (!error) return false;
  if (["42P01", "42703", "PGRST205", "PGRST204", "PGRST202"].includes(String(error.code ?? ""))) return true;
  // 42883 (ukendt funktion) kun når det er netop vores: en anden manglende
  // funktion er en rigtig fejl og skal kastes, ikke skjules som "ikke klar".
  const message = String(error.message ?? "");
  return /user_ui_prefs|seen_markers/.test(message) && /does not exist|schema cache|could not find/i.test(message);
}

/**
 * @param {any} supabase service-role klient
 * @param {string} userId
 * @returns {Promise<{ markers: Record<string, string>, available: boolean }>}
 */
export async function readSeenMarkers(supabase, userId) {
  // user_id er tabellens primærnøgle, så der er højst én række.
  const { data, error } = await supabase
    .from("user_ui_prefs")
    .select("seen_markers")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    if (isMissingSeenMarkersStorage(error)) return { markers: {}, available: false };
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : null;
  return { markers: publicSeenMarkers(row?.seen_markers), available: true };
}

/**
 * Flet (nyeste vinder) atomisk i databasen: én INSERT ... ON CONFLICT DO UPDATE
 * i public.merge_seen_markers_6515 mod den aktuelle række. Før læste vi rækken
 * her, flettede i Node og skrev hele objektet tilbage; to samtidige kald for
 * samme bruger kunne så overskrive hinanden. Rører kun kolonnen seen_markers,
 * så visningsvalgene i prefs (#7778) står urørt. Skriver intet, når intet rykker.
 * @param {any} supabase service-role klient
 * @param {string} userId
 * @param {Record<string, string>} patch allerede tjekket af sanitizeSeenMarkersPatch
 * @returns {Promise<{ markers: Record<string, string>, available: boolean }>}
 */
export async function writeSeenMarkers(supabase, userId, patch) {
  const clean = publicSeenMarkers(patch);
  if (!Object.keys(clean).length) return readSeenMarkers(supabase, userId);
  const { data, error } = await supabase.rpc("merge_seen_markers_6515", { p_user_id: userId, p_patch: clean });
  if (error) {
    if (isMissingSeenMarkersStorage(error)) return { markers: {}, available: false };
    throw error;
  }
  return { markers: publicSeenMarkers(data), available: true };
}
