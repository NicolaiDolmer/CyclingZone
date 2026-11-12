// #7778 · Visningsvalg gemt paa brugeren (GET/PUT /api/me/ui-prefs).
//
// Ejer 12/11 (valg 6): fx "Skjul rute" paa loebssiden huskes paa brugeren, paa
// tvaers af etaper, sider og enheder. Serveren er sandheden; localStorage er kun
// en hurtig kopi, saa siden kan tegne det rigtige valg i foerste frame, foer
// serverens svar er landet. Naar svaret lander, vinder det altid.
//
// Ét lager for hele appen: svaret hentes én gang pr. session, og alle
// komponenter der bruger samme noegle ser samme vaerdi.
import { useCallback, useEffect, useSyncExternalStore } from "react";

// Klienten hentes dynamisk (samme greb som RiderNameIcon): de rene funktioner
// her testes i node uden at traekke supabase-klienten med ind.
async function deps() {
  const [{ apiFetch }, { authHeaders }] = await Promise.all([import("./apiFetch.ts"), import("./supabase.ts")]);
  return { apiFetch, authHeaders };
}

/** Spejler backend/lib/userUiPrefs.js UI_PREF_SCHEMA. */
export const UI_PREF_SCHEMA = { race_route_hidden: "boolean" } as const;
export type UiPrefKey = keyof typeof UI_PREF_SCHEMA;
export type UiPrefs = Partial<Record<UiPrefKey, boolean>>;
export const UI_PREFS_LOCAL_KEY = "cz_ui_prefs_v1";

/** "saved" = serveren har valget; "local" = kun paa denne enhed (serveren kan ikke gemme endnu). */
export type UiPrefSaveState = "idle" | "saving" | "saved" | "local" | "failed";

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

export function parseUiPrefs(raw: unknown): UiPrefs {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: UiPrefs = {};
  for (const key of Object.keys(UI_PREF_SCHEMA) as UiPrefKey[]) {
    const value = (raw as Record<string, unknown>)[key];
    if (typeof value === UI_PREF_SCHEMA[key]) out[key] = value as boolean;
  }
  return out;
}

function defaultStorage(): StorageLike | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

export function readLocalUiPrefs(storage: StorageLike | null = defaultStorage()): UiPrefs {
  try {
    const raw = storage?.getItem(UI_PREFS_LOCAL_KEY);
    return raw ? parseUiPrefs(JSON.parse(raw)) : {};
  } catch {
    return {};
  }
}

export function writeLocalUiPrefs(prefs: UiPrefs, storage: StorageLike | null = defaultStorage()): void {
  try { storage?.setItem(UI_PREFS_LOCAL_KEY, JSON.stringify(parseUiPrefs(prefs))); } catch { /* privat tilstand: kopien er kun en genvej */ }
}

/**
 * Serverens svar flettet ind i den lokale kopi. Serveren vinder for hver noegle
 * den kender; en noegle serveren ikke har (aldrig gemt der) beholder den lokale
 * kopi, saa et valg gemt foer tabellen fandtes ikke forsvinder.
 */
export function mergeServerPrefs(local: UiPrefs, server: UiPrefs): UiPrefs {
  return { ...local, ...server };
}

// ── Lageret ───────────────────────────────────────────────────────────────
interface StoreState { prefs: UiPrefs; saveState: Partial<Record<UiPrefKey, UiPrefSaveState>> }
let state: StoreState = { prefs: readLocalUiPrefs(), saveState: {} };
let serverLoad: Promise<void> | null = null;
const listeners = new Set<() => void>();

function setState(next: StoreState) {
  state = next;
  for (const fn of listeners) fn();
}
function subscribe(fn: () => void) {
  listeners.add(fn);
  return () => { listeners.delete(fn); };
}

function loadFromServer(): Promise<void> {
  if (serverLoad) return serverLoad;
  serverLoad = (async () => {
    try {
      const { apiFetch, authHeaders } = await deps();
      const headers = await authHeaders({ json: false });
      if (!headers) return;
      const res = await apiFetch("/api/me/ui-prefs", { headers });
      const body = res.data as { prefs?: unknown; available?: boolean } | null;
      if (!res.ok || body?.available === false) return;
      const prefs = mergeServerPrefs(state.prefs, parseUiPrefs(body?.prefs));
      writeLocalUiPrefs(prefs);
      setState({ ...state, prefs });
    } catch { /* catch-ok: uden svar bruges den lokale kopi */ }
  })();
  return serverLoad;
}

async function saveToServer(key: UiPrefKey, value: boolean): Promise<UiPrefSaveState> {
  try {
    const { apiFetch, authHeaders } = await deps();
    const headers = await authHeaders({ json: true });
    if (!headers) return "local";
    const res = await apiFetch("/api/me/ui-prefs", { method: "PUT", headers, body: JSON.stringify({ prefs: { [key]: value } }) });
    if (res.ok) return "saved";
    return res.status === 503 ? "local" : "failed";
  } catch {
    return "failed";
  }
}

export function setUiPref(key: UiPrefKey, value: boolean): Promise<UiPrefSaveState> {
  const prefs = { ...state.prefs, [key]: value };
  writeLocalUiPrefs(prefs);
  setState({ prefs, saveState: { ...state.saveState, [key]: "saving" } });
  return saveToServer(key, value).then((result) => {
    // Et nyere valg paa samme noegle ejer status-teksten.
    if (state.prefs[key] === value) setState({ ...state, saveState: { ...state.saveState, [key]: result } });
    return result;
  });
}

/** Kun til tests. */
export function _resetUiPrefsForTests(prefs: UiPrefs = {}): void {
  serverLoad = null;
  state = { prefs, saveState: {} };
}

/**
 * [vaerdi, saet, gemme-status]. Vaerdien er den lokale kopi ved foerste frame og
 * serverens, saa snart den er hentet.
 */
export function useUiPref(key: UiPrefKey, fallback: boolean): [boolean, (value: boolean) => void, UiPrefSaveState] {
  const snapshot = useSyncExternalStore(subscribe, () => state, () => state);
  useEffect(() => { void loadFromServer(); }, []);
  const set = useCallback((value: boolean) => { void setUiPref(key, value); }, [key]);
  const value = snapshot.prefs[key];
  return [typeof value === "boolean" ? value : fallback, set, snapshot.saveState[key] ?? "idle"];
}
