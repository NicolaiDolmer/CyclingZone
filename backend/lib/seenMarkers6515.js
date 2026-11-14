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
// enheds nyere markør tilbage og få sete prikker til at dukke op igen.

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

/** Den nyeste af to markører; en ugyldig eller tom tæller som fraværende. */
export function laterSeenMarker(a, b) {
  const okA = isValidSeenMarker(a);
  const okB = isValidSeenMarker(b);
  if (!okA) return okB ? b : null;
  if (!okB) return a;
  return b > a ? b : a;
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
 * @param {unknown} body
 * @returns {{ ok: true, patch: Record<string, string> } | { ok: false, errorCode: string, error: string }}
 */
export function sanitizeSeenMarkersPatch(body) {
  const markers = body && typeof body === "object" ? /** @type {any} */ (body).markers : null;
  if (!markers || typeof markers !== "object" || Array.isArray(markers)) {
    return { ok: false, errorCode: "seen_markers_invalid_payload", error: "markers must be an object" };
  }
  const keys = Object.keys(markers);
  if (!keys.length) return { ok: false, errorCode: "seen_markers_invalid_payload", error: "markers must not be empty" };
  const unknown = keys.filter((k) => !SEEN_MARKER_KEYS.includes(k));
  if (unknown.length) {
    return { ok: false, errorCode: "seen_markers_unknown_keys", error: `Unknown marker keys: ${unknown.join(", ")}` };
  }
  const invalid = keys.filter((k) => !isValidSeenMarker(markers[k]));
  if (invalid.length) {
    return { ok: false, errorCode: "seen_markers_invalid_value", error: `Invalid value for: ${invalid.join(", ")}` };
  }
  return { ok: true, patch: Object.fromEntries(keys.map((k) => [k, markers[k]])) };
}

/**
 * Flet: for hver markør vinder den nyeste. Returnerer også om noget rykkede.
 * @param {Record<string, string>} current
 * @param {Record<string, string>} patch
 */
export function mergeSeenMarkers(current, patch) {
  const merged = { ...publicSeenMarkers(current) };
  let changed = false;
  for (const [key, value] of Object.entries(publicSeenMarkers(patch))) {
    const next = laterSeenMarker(merged[key], value);
    if (next !== merged[key]) {
      merged[key] = next;
      changed = true;
    }
  }
  return { merged, changed };
}

/**
 * Tabellen eller kolonnen findes ikke endnu (backend deployet før migrationen):
 * 42P01/42703 fra Postgres eller PGRST205/PGRST204 fra PostgREST's schema-cache.
 * @param {{ code?: string, message?: string } | null | undefined} error
 */
export function isMissingSeenMarkersStorage(error) {
  if (!error) return false;
  if (["42P01", "42703", "PGRST205", "PGRST204"].includes(String(error.code ?? ""))) return true;
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
 * Læs, flet (nyeste vinder) og skriv kun hvis noget rykkede frem. Rører kun
 * kolonnen seen_markers, så visningsvalgene i prefs (#7778) står urørt.
 * @param {any} supabase service-role klient
 * @param {string} userId
 * @param {Record<string, string>} patch allerede tjekket af sanitizeSeenMarkersPatch
 * @param {() => string} [nowIso]
 * @returns {Promise<{ markers: Record<string, string>, available: boolean }>}
 */
export async function writeSeenMarkers(supabase, userId, patch, nowIso = () => new Date().toISOString()) {
  const current = await readSeenMarkers(supabase, userId);
  if (!current.available) return current;
  const { merged, changed } = mergeSeenMarkers(current.markers, patch);
  if (!changed) return { markers: merged, available: true };
  const { error } = await supabase
    .from("user_ui_prefs")
    .upsert({ user_id: userId, seen_markers: merged, updated_at: nowIso() }, { onConflict: "user_id" });
  if (error) {
    if (isMissingSeenMarkersStorage(error)) return { markers: {}, available: false };
    throw error;
  }
  return { markers: merged, available: true };
}
