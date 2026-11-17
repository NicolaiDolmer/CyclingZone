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
// The switch itself is not read through readFlagStage (it would decide its own cache). It is read
// on demand (AGENTS.md rule 36: no polling): server.js only registers a client at boot
// (startConfigCacheSwitch), nothing is read and no timer runs. A flag read that finds the last
// answer older than CONFIG_CACHE_SWITCH_TTL_MS asks once in the background and goes on with the
// last answer; reads at the same time share that one question. No flag reads = no switch reads,
// also while the switch is off. An admin write of the switch forgets the answer: sharing stops at
// once and the next flag read asks again. Until the first answer, after a failed read, and in every
// test that does not register a client, the switch is off: readFlagStage then behaves exactly as
// before (per client).

export const CONFIG_CACHE_SWITCH_KEY = "config_cache_8143";
/** How long one answer about the switch is trusted before a flag read asks again. */
export const CONFIG_CACHE_SWITCH_TTL_MS = 30_000;

let enabled = false;
/** @type {any} */
let switchClient = null;
/** @type {() => number} */
let clock = Date.now;
let trustedUntil = -Infinity;
/** @type {Promise<void> | null} */
let switchRead = null;
// Bumped whenever the answer is forgotten, so a question asked before that is never trusted.
let generation = 0;
/** @type {Map<string, { value: any, expiresAt: number }>} */
const sharedValues = new Map();
/** @type {Map<string, Promise<{ ok: boolean, value: any }>>} */
const sharedInflight = new Map();

function clearShared() {
  sharedValues.clear();
  sharedInflight.clear();
}

function setEnabled(next) {
  if (next === enabled) return;
  enabled = next;
  // A flip either way starts from an empty shared memory: nothing from before the flip is reused.
  clearShared();
}

/** Forget the answer about the switch: off at once, and the next flag read asks again. */
function forgetSwitch() {
  generation++;
  switchRead = null;
  trustedUntil = -Infinity;
  setEnabled(false);
}

/**
 * One question about the switch. Only "on" (or legacy true) turns sharing on; off, beta, a
 * missing row and any failure are off.
 * @param {any} supabase
 * @returns {Promise<boolean>}
 */
async function readSwitch(supabase) {
  try {
    const { data, error } = await supabase.from("app_config").select("value").eq("key", CONFIG_CACHE_SWITCH_KEY).maybeSingle();
    return !error && (data?.value === "on" || data?.value === true);
  } catch {
    // catch-ok: an unreadable switch is off, the per-client memory from before #8143.
    return false;
  }
}

function askSwitch() {
  const asked = generation;
  const read = readSwitch(switchClient).then((next) => {
    // Forgotten while under way (admin write, shutdown): this answer may be from before the change.
    if (asked !== generation) return;
    setEnabled(next);
    trustedUntil = clock() + CONFIG_CACHE_SWITCH_TTL_MS;
  }).finally(() => {
    if (switchRead === read) switchRead = null;
  });
  switchRead = read;
}

/**
 * True while flag reads share one memory across all clients. Asks for the switch only when the
 * last answer has run out, and never waits for the answer.
 */
export function isConfigCacheShared() {
  if (switchClient && !switchRead && clock() >= trustedUntil) askSwitch();
  return enabled;
}

/** The shared memory (values and reads under way), used by readFlagStage while the switch is on. */
export function sharedConfigCache() {
  return { values: sharedValues, inflight: sharedInflight };
}

/**
 * Forget one key (or every key) in the shared memory. Reads under way finish and are not reused.
 * Forgetting the switch's own key (the admin route writes it) or every key also forgets the answer
 * about the switch.
 * @param {string} [key]
 */
export function forgetSharedConfig(key) {
  if (key === undefined || key === CONFIG_CACHE_SWITCH_KEY) {
    forgetSwitch();
    clearShared();
    return;
  }
  sharedValues.delete(key);
  sharedInflight.delete(key);
}

/**
 * Boot: register the client the switch is read with. Reads nothing and starts no timer.
 * @param {{ supabase: any, now?: () => number }} opts  `now` is for tests (rule 16).
 */
export function startConfigCacheSwitch({ supabase, now = Date.now }) {
  if (switchClient || !supabase?.from) return;
  switchClient = supabase;
  clock = now;
}

/** Resolves when the question about the switch under way (if any) is answered. For tests. */
export function settleConfigCacheSwitch() {
  return switchRead ?? Promise.resolve();
}

/** Shutdown (and tests): stop asking, and go back to the per-client memory. */
export function stopConfigCacheSwitch() {
  switchClient = null;
  clock = Date.now;
  forgetSwitch();
}
