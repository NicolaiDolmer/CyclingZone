// #7778 · Visningsvalg gemt paa brugeren (GET/PUT /api/me/ui-prefs).
//
// Ejer 12/11 (valg 6): fx "Skjul rute" paa loebssiden huskes paa brugeren, paa
// tvaers af etaper, sider og enheder. Serveren er sandheden; localStorage er kun
// en hurtig kopi, saa siden kan tegne det rigtige valg i foerste frame, foer
// serverens svar er landet.
//
// Ét lager for hele appen. Tre regler holder det korrekt:
//   1. Et valg spilleren traeffer, mens serverens svar er paa vej, vinder over svaret.
//   2. Skrivninger koeres én ad gangen, og et valg der allerede er afloest, sendes
//      ikke: det sidste valg er altid det, serveren ender med.
//   3. Lageret og den lokale kopi tilhoerer én bruger. Logger en anden ind uden
//      genindlaesning, ryddes valgene, og svar til den forrige bruger smides vaek.
import { useCallback, useEffect, useSyncExternalStore } from "react";

/** Spejler backend/lib/userUiPrefs.js UI_PREF_SCHEMA. */
export const UI_PREF_SCHEMA = { race_route_hidden: "boolean" } as const;
export type UiPrefKey = keyof typeof UI_PREF_SCHEMA;
export type UiPrefs = Partial<Record<UiPrefKey, boolean>>;
export const UI_PREFS_LOCAL_KEY = "cz_ui_prefs_v1";

/** "saved" = serveren har valget; "local" = kun paa denne enhed (serveren kan ikke gemme endnu). */
export type UiPrefSaveState = "idle" | "saving" | "saved" | "local" | "failed";

interface StorageLike { getItem(key: string): string | null; setItem(key: string, value: string): void }

/** Den lokale kopi og den bruger den tilhoerer (null = ukendt, fx en kopi uden ejer). */
export interface LocalUiPrefs { userId: string | null; prefs: UiPrefs }

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

export function readLocalUiPrefs(storage: StorageLike | null = defaultStorage()): LocalUiPrefs {
  try {
    const raw = storage?.getItem(UI_PREFS_LOCAL_KEY);
    if (!raw) return { userId: null, prefs: {} };
    const parsed: unknown = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "prefs" in parsed) {
      const { userId, prefs } = parsed as { userId?: unknown; prefs?: unknown };
      return { userId: typeof userId === "string" ? userId : null, prefs: parseUiPrefs(prefs) };
    }
    // En kopi uden ejer (det oprindelige format): kun valgene.
    return { userId: null, prefs: parseUiPrefs(parsed) };
  } catch {
    return { userId: null, prefs: {} };
  }
}

export function writeLocalUiPrefs(copy: LocalUiPrefs, storage: StorageLike | null = defaultStorage()): void {
  try {
    storage?.setItem(UI_PREFS_LOCAL_KEY, JSON.stringify({ userId: copy.userId, prefs: parseUiPrefs(copy.prefs) }));
  } catch { /* privat tilstand: kopien er kun en genvej */ }
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

/** Det lageret taler med; i appen serveren og localStorage, i tests forfalskninger. */
export interface UiPrefsBackend {
  storage: StorageLike | null;
  /** Den indloggede bruger, eller null uden session. */
  getUserId(): Promise<string | null>;
  /** null = intet svar (ingen session eller netvaerksfejl). */
  fetchPrefs(): Promise<{ ok: boolean; available: boolean; prefs: unknown } | null>;
  putPref(key: UiPrefKey, value: boolean): Promise<Exclude<UiPrefSaveState, "idle" | "saving">>;
}

export interface UiPrefsState {
  userId: string | null;
  prefs: UiPrefs;
  saveState: Partial<Record<UiPrefKey, UiPrefSaveState>>;
}

export interface UiPrefsStore {
  getState(): UiPrefsState;
  subscribe(fn: () => void): () => void;
  /** Hent serverens valg for den indloggede bruger (én gang pr. bruger). */
  ensureLoaded(): Promise<void>;
  set(key: UiPrefKey, value: boolean): Promise<UiPrefSaveState>;
}

export function createUiPrefsStore(backend: UiPrefsBackend): UiPrefsStore {
  const local = readLocalUiPrefs(backend.storage);
  let state: UiPrefsState = { userId: local.userId, prefs: local.prefs, saveState: {} };
  const listeners = new Set<() => void>();
  let loadedFor: string | null = null;
  let loading: Promise<void> | null = null;
  // Noegler spilleren har aendret, siden den igangvaerende hentning startede (regel 1).
  let editedSinceLoad = new Set<UiPrefKey>();
  // Skrivekoeen (regel 2).
  let writeChain: Promise<unknown> = Promise.resolve();

  function setState(next: UiPrefsState) {
    state = next;
    for (const fn of listeners) fn();
  }

  function ensureLoaded(): Promise<void> {
    // En hentning er i gang: tjek bagefter igen, for brugeren kan have skiftet imens.
    if (loading) return loading.then(() => ensureLoaded());
    loading = (async () => {
      const userId = await backend.getUserId().catch(() => null);
      if (!userId || userId === loadedFor) return;
      // Regel 3: en anden brugers valg (i lageret og i kopien) gaelder ikke her.
      if (state.userId && state.userId !== userId) {
        setState({ userId, prefs: {}, saveState: {} });
        writeLocalUiPrefs({ userId, prefs: {} }, backend.storage);
      } else if (state.userId !== userId) {
        setState({ ...state, userId });
      }
      editedSinceLoad = new Set();
      const res = await backend.fetchPrefs().catch(() => null);
      // Brugeren skiftede undervejs: svaret er den forriges og smides vaek.
      const nowUser = await backend.getUserId().catch(() => null);
      if (state.userId !== userId || nowUser !== userId) return;
      if (!res || !res.ok) return; // proeves igen ved naeste visning
      loadedFor = userId;
      if (!res.available) return;
      const server = parseUiPrefs(res.prefs);
      for (const key of editedSinceLoad) delete server[key];
      const prefs = mergeServerPrefs(state.prefs, server);
      writeLocalUiPrefs({ userId, prefs }, backend.storage);
      setState({ ...state, prefs });
    })().finally(() => { loading = null; });
    return loading;
  }

  function set(key: UiPrefKey, value: boolean): Promise<UiPrefSaveState> {
    const userId = state.userId;
    editedSinceLoad.add(key);
    const prefs = { ...state.prefs, [key]: value };
    writeLocalUiPrefs({ userId, prefs }, backend.storage);
    setState({ ...state, prefs, saveState: { ...state.saveState, [key]: "saving" } });
    const isLatest = () => state.userId === userId && state.prefs[key] === value;
    const run = writeChain.then(async (): Promise<UiPrefSaveState | null> => {
      // Et nyere valg staar i koeen efter dette og sender den nyeste vaerdi.
      if (!isLatest()) return null;
      return backend.putPref(key, value).catch(() => "failed" as const);
    });
    writeChain = run.catch(() => undefined);
    return run.then((result) => {
      if (result === null) return state.saveState[key] ?? "idle";
      if (isLatest()) setState({ ...state, saveState: { ...state.saveState, [key]: result } });
      return result;
    });
  }

  return {
    getState: () => state,
    subscribe(fn) {
      listeners.add(fn);
      return () => { listeners.delete(fn); };
    },
    ensureLoaded,
    set,
  };
}

// ── Appens lager ──────────────────────────────────────────────────────────

// Klienten hentes dynamisk (samme greb som RiderNameIcon): de rene funktioner
// her testes i node uden at traekke supabase-klienten med ind.
async function deps() {
  const [{ apiFetch }, { authHeaders, getSession }] = await Promise.all([import("./apiFetch.ts"), import("./supabase.ts")]);
  return { apiFetch, authHeaders, getSession };
}

const appBackend: UiPrefsBackend = {
  storage: defaultStorage(),
  async getUserId() {
    const { getSession } = await deps();
    const { data } = await getSession();
    return data?.session?.user?.id ?? null;
  },
  async fetchPrefs() {
    const { apiFetch, authHeaders } = await deps();
    const headers = await authHeaders({ json: false });
    if (!headers) return null;
    const res = await apiFetch("/api/me/ui-prefs", { headers });
    const body = res.data as { prefs?: unknown; available?: boolean } | null;
    return { ok: res.ok, available: body?.available !== false, prefs: body?.prefs };
  },
  async putPref(key, value) {
    const { apiFetch, authHeaders } = await deps();
    const headers = await authHeaders({ json: true });
    if (!headers) return "local";
    const res = await apiFetch("/api/me/ui-prefs", { method: "PUT", headers, body: JSON.stringify({ prefs: { [key]: value } }) });
    if (res.ok) return "saved";
    return res.status === 503 ? "local" : "failed";
  },
};

const appStore = createUiPrefsStore(appBackend);

/**
 * [vaerdi, saet, gemme-status]. Vaerdien er den lokale kopi ved foerste frame og
 * serverens, saa snart den er hentet.
 */
export function useUiPref(key: UiPrefKey, fallback: boolean): [boolean, (value: boolean) => void, UiPrefSaveState] {
  const snapshot = useSyncExternalStore(appStore.subscribe, appStore.getState, appStore.getState);
  useEffect(() => { void appStore.ensureLoaded(); }, []);
  const set = useCallback((value: boolean) => { void appStore.set(key, value); }, [key]);
  const value = snapshot.prefs[key];
  return [typeof value === "boolean" ? value : fallback, set, snapshot.saveState[key] ?? "idle"];
}
