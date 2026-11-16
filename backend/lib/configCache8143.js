// #8143 (H): one shared, process-wide memory of app_config flag reads (featureStage.readFlagStage).
//
// Since #7663 a successful flag read is remembered for FLAG_CACHE_TTL_MS, but per client object
// (WeakMap). The server makes many clients: route modules, background jobs, and one per request
// for some reads. Each client asks the database again. With the switch `config_cache_8143` on, all
// clients share one memory per key, with the same rules as before:
//
//  1. A failed read is never remembered and never falls back to an old value (featureStage rule 1).
//  2. Engine and live-system switches (FRESH_FLAG_KEYS) are still read fresh every time.
//  3. An admin flag change forgets the key at once (clearFlagStageCache, called by the admin route).
//
// The switch itself is not read through readFlagStage (it would decide its own cache). The server
// asks for it every CONFIG_CACHE_SWITCH_REFRESH_MS with its own client (startConfigCacheSwitch, at
// boot). Until the first answer, after a failed read, and in every test that does not start it, the
// switch is off: readFlagStage then behaves exactly as before (per client).

export const CONFIG_CACHE_SWITCH_KEY = "config_cache_8143";
export const CONFIG_CACHE_SWITCH_REFRESH_MS = 30_000;

let enabled = false;
/** @type {ReturnType<typeof setInterval> | null} */
let timer = null;
/** @type {Map<string, { value: any, expiresAt: number }>} */
const sharedValues = new Map();
/** @type {Map<string, Promise<{ ok: boolean, value: any }>>} */
const sharedInflight = new Map();

/** True while flag reads share one memory across all clients. */
export function isConfigCacheShared() {
  return enabled;
}

/** The shared memory (values and reads under way), used by readFlagStage while the switch is on. */
export function sharedConfigCache() {
  return { values: sharedValues, inflight: sharedInflight };
}

/** Forget one key (or every key) in the shared memory. Reads under way finish and are not reused. */
export function forgetSharedConfig(key) {
  if (key === undefined) {
    sharedValues.clear();
    sharedInflight.clear();
    return;
  }
  sharedValues.delete(key);
  sharedInflight.delete(key);
}

function setEnabled(next) {
  if (next === enabled) return;
  enabled = next;
  // A flip either way starts from an empty shared memory: nothing from before the flip is reused.
  forgetSharedConfig();
}

/**
 * Ask for the switch once. Only "on" (or legacy true) turns sharing on; off, beta, a missing row
 * and any failure turn it off.
 * @param {any} supabase
 * @returns {Promise<boolean>}
 */
export async function refreshConfigCacheSwitch(supabase) {
  let next = false;
  try {
    const { data, error } = await supabase.from("app_config").select("value").eq("key", CONFIG_CACHE_SWITCH_KEY).maybeSingle();
    next = !error && (data?.value === "on" || data?.value === true);
  } catch {
    // catch-ok: an unreadable switch is off, the per-client memory from before #8143.
    next = false;
  }
  setEnabled(next);
  return enabled;
}

/**
 * Boot: ask for the switch now and then every `intervalMs`. The timer never keeps the process alive.
 * @param {{ supabase: any, intervalMs?: number }} opts
 */
export function startConfigCacheSwitch({ supabase, intervalMs = CONFIG_CACHE_SWITCH_REFRESH_MS }) {
  if (timer || !supabase?.from) return;
  void refreshConfigCacheSwitch(supabase);
  const interval = setInterval(() => { void refreshConfigCacheSwitch(supabase); }, intervalMs);
  interval.unref?.();
  timer = interval;
}

/** Shutdown (and tests): stop asking, and go back to the per-client memory. */
export function stopConfigCacheSwitch() {
  if (timer) clearInterval(timer);
  timer = null;
  setEnabled(false);
}
