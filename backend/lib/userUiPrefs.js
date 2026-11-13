// #7778 · Visningsvalg gemt på brugeren (public.user_ui_prefs, én række pr. bruger).
//
// Ejer 12/11 (valg 6): "Skjul rute" på løbssiden huskes på brugeren, på tværs af
// etaper, sider og enheder. Klientens localStorage er kun en hurtig kopi; denne
// tabel er sandheden.
//
// Kun nøgler i UI_PREF_SCHEMA kan gemmes, og kun med den type de er erklæret med.
// Alt andet afvises med 400, så tabellen aldrig bliver et frit lager.

/** Nøgle → forventet JS-type. Tilføj kun en nøgle når en flade faktisk læser den. */
export const UI_PREF_SCHEMA = Object.freeze({
  // #7778: løbssidens ruteprofil skjult (true) eller vist (false/ingen række).
  race_route_hidden: "boolean",
});

export const UI_PREF_KEYS = Object.freeze(Object.keys(UI_PREF_SCHEMA));

/**
 * Tjek et PUT-body ({ prefs: { key: value } }) mod allowlisten.
 * @param {unknown} body
 * @returns {{ ok: true, patch: Record<string, unknown> } | { ok: false, errorCode: string, error: string }}
 */
export function sanitizeUiPrefsPatch(body) {
  const prefs = body && typeof body === "object" ? /** @type {any} */ (body).prefs : null;
  if (!prefs || typeof prefs !== "object" || Array.isArray(prefs)) {
    return { ok: false, errorCode: "ui_prefs_invalid_payload", error: "prefs must be an object" };
  }
  const keys = Object.keys(prefs);
  if (!keys.length) return { ok: false, errorCode: "ui_prefs_invalid_payload", error: "prefs must not be empty" };
  const unknown = keys.filter((k) => !Object.prototype.hasOwnProperty.call(UI_PREF_SCHEMA, k));
  if (unknown.length) {
    return { ok: false, errorCode: "ui_prefs_unknown_keys", error: `Unknown pref keys: ${unknown.join(", ")}` };
  }
  const wrongType = keys.filter((k) => typeof prefs[k] !== UI_PREF_SCHEMA[k]);
  if (wrongType.length) {
    return { ok: false, errorCode: "ui_prefs_invalid_value", error: `Invalid value for: ${wrongType.join(", ")}` };
  }
  return { ok: true, patch: Object.fromEntries(keys.map((k) => [k, prefs[k]])) };
}

/**
 * Kun kendte nøgler med rigtig type forlader serveren, også hvis en gammel
 * nøgle står i rækken.
 * @param {unknown} stored
 * @returns {Record<string, unknown>}
 */
export function publicUiPrefs(stored) {
  if (!stored || typeof stored !== "object" || Array.isArray(stored)) return {};
  const out = {};
  for (const key of UI_PREF_KEYS) {
    const value = /** @type {any} */ (stored)[key];
    if (typeof value === UI_PREF_SCHEMA[key]) out[key] = value;
  }
  return out;
}

/**
 * Tabellen findes ikke endnu (deploy foer migration): 42P01 fra Postgres eller
 * PGRST205 fra PostgREST's schema-cache.
 * @param {{ code?: string, message?: string } | null | undefined} error
 */
export function isMissingUiPrefsTable(error) {
  if (!error) return false;
  if (error.code === "42P01" || error.code === "PGRST205") return true;
  return /user_ui_prefs/.test(String(error.message ?? "")) && /does not exist|schema cache/i.test(String(error.message ?? ""));
}

/**
 * @param {any} supabase service-role klient
 * @param {string} userId
 * @returns {Promise<{ prefs: Record<string, unknown>, available: boolean }>}
 */
export async function readUiPrefs(supabase, userId) {
  // user_id er tabellens primærnøgle, så der er højst én række.
  const { data, error } = await supabase
    .from("user_ui_prefs")
    .select("prefs")
    .eq("user_id", userId)
    .limit(1);
  if (error) {
    if (isMissingUiPrefsTable(error)) return { prefs: {}, available: false };
    throw error;
  }
  const row = Array.isArray(data) ? data[0] : null;
  return { prefs: publicUiPrefs(row?.prefs), available: true };
}

/**
 * Læs, flet og skriv. Én bruger skriver kun sin egen række, så flet-i-klienten
 * er nok; samtidige skrivninger fra to enheder giver "sidste vinder" pr. række.
 * @param {any} supabase service-role klient
 * @param {string} userId
 * @param {Record<string, unknown>} patch allerede tjekket af sanitizeUiPrefsPatch
 * @param {() => string} [nowIso]
 * @returns {Promise<{ prefs: Record<string, unknown>, available: boolean }>}
 */
export async function writeUiPrefs(supabase, userId, patch, nowIso = () => new Date().toISOString()) {
  const current = await readUiPrefs(supabase, userId);
  if (!current.available) return current;
  const merged = { ...current.prefs, ...patch };
  const { error } = await supabase
    .from("user_ui_prefs")
    .upsert({ user_id: userId, prefs: merged, updated_at: nowIso() }, { onConflict: "user_id" });
  if (error) {
    if (isMissingUiPrefsTable(error)) return { prefs: {}, available: false };
    throw error;
  }
  return { prefs: publicUiPrefs(merged), available: true };
}
