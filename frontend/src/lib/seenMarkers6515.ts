// #6515 · Den gule prik ved Patch Notes og Roadmap følger brugeren, ikke enheden.
//
// Før lå "sidst set" kun i browserens localStorage (cz_patchnotes_last_seen og
// cz_roadmap_last_seen), så en note læst på telefonen gav stadig en prik på
// computeren. Nu ligger markøren også på brugeren (GET/PUT /api/me/seen-markers,
// backend/lib/seenMarkers6515.js).
//
// Fire regler holder prikken korrekt:
//   1. localStorage er stadig hurtig første visning og faldvej. Siden venter
//      aldrig på serveren; svarer den ikke, opfører prikken sig som før.
//   2. En markør rykker kun frem: lokalt og på serveren vinder den nyeste. Så
//      viser en fejl eller en gammel kopi aldrig en prik for noget, spilleren
//      allerede har set på denne enhed.
//   3. Første besøg efter udrulning flytter den lokale markør op til serveren,
//      så ingen får alle gamle prikker tilbage.
//   4. Den lokale kopi tilhører én bruger. Logger en anden ind på enheden, gælder
//      den forriges markører ikke, og de sendes heller ikke op på den nye konto.
//      Udlogget: kun den lokale kopi, som i dag.
//   5. En læsning hører til den bruger, der var logget ind, da den skete, og
//      holdes adskilt fra den lokale kopi (som kan være en anden brugers). Den
//      sendes op, så længe serveren ikke vides at have den, uanset om den lokale
//      kopi rykkede; og afstemningen fletter den ind, før den kasserer en anden
//      brugers kopi. Så går ingen læsning tabt, uanset hvilken rækkefølge siden,
//      Layout og serverens svar lander i.
import { useEffect } from "react";

export type SeenMarkerKey = "patch_notes" | "roadmap";
export type SeenMarkers = Partial<Record<SeenMarkerKey, string>>;

/** Markør → den localStorage-nøgle prikken har brugt hele tiden (uændret). */
export const SEEN_MARKER_LOCAL_KEYS: Record<SeenMarkerKey, string> = {
  patch_notes: "cz_patchnotes_last_seen",
  roadmap: "cz_roadmap_last_seen",
};
export const SEEN_MARKER_KEYS = Object.keys(SEEN_MARKER_LOCAL_KEYS) as SeenMarkerKey[];

/** Hvilken bruger enhedens lokale markører sidst blev afstemt for (regel 4). */
export const SEEN_MARKERS_OWNER_KEY = "cz_seen_markers_owner";
/** Sendes på window, når serverens markører er flettet ind, så åbne sider kan følge med. */
export const SEEN_MARKERS_SYNCED_EVENT = "cz:seen-markers-synced";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** En brugbar markør: dato eller tidsstempel, som både patch notes og roadmap skriver. */
export function isSeenMarker(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value);
}

/** Den nyeste af to markører (regel 2); en ugyldig tæller som fraværende. */
export function laterSeenMarker(a: unknown, b: unknown): string | null {
  const okA = isSeenMarker(a);
  const okB = isSeenMarker(b);
  if (!okA) return okB ? b : null;
  if (!okB) return a;
  return b > a ? b : a;
}

export function parseSeenMarkers(raw: unknown): SeenMarkers {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const out: SeenMarkers = {};
  for (const key of SEEN_MARKER_KEYS) {
    const value = (raw as Record<string, unknown>)[key];
    if (isSeenMarker(value)) out[key] = value;
  }
  return out;
}

export interface SeenMarkerSyncPlan {
  /** Hvad den lokale kopi skal sættes til; null = fjern nøglen. */
  localWrites: Partial<Record<SeenMarkerKey, string | null>>;
  /** Hvad serveren mangler (enheden er længere fremme). */
  push: SeenMarkers;
}

/**
 * Ren afstemning mellem enhedens lokale kopi og serveren.
 * `sameOwner`: den lokale kopi er denne brugers, eller ejeren er ukendt (en kopi
 * fra før udrulningen: det er netop den, regel 3 flytter op).
 * `reads`: hvad den indloggede bruger selv har læst i denne fane (regel 5).
 */
export function planSeenMarkerSync(
  local: Partial<Record<SeenMarkerKey, string | null>>,
  server: SeenMarkers,
  sameOwner: boolean,
  reads: SeenMarkers = {},
): SeenMarkerSyncPlan {
  const plan: SeenMarkerSyncPlan = { localWrites: {}, push: {} };
  for (const key of SEEN_MARKER_KEYS) {
    const mine = isSeenMarker(local[key]) ? local[key] : null;
    const theirs = isSeenMarker(server[key]) ? server[key] : null;
    const read = isSeenMarker(reads[key]) ? reads[key] : null;
    // Regel 4: en anden brugers lokale markør gælder ikke og sendes ikke op;
    // regel 5: brugerens egne læsninger tæller altid med.
    const own = sameOwner ? laterSeenMarker(mine, read) : read;
    const next = laterSeenMarker(theirs, own);
    if (next !== mine) plan.localWrites[key] = next;
    if (own && (!theirs || own > theirs)) plan.push[key] = own;
  }
  return plan;
}

// ── Afstemning mod serveren ────────────────────────────────────────────────

/** Det afstemningen taler med; i appen serveren og localStorage, i tests forfalskninger. */
export interface SeenMarkersBackend {
  storage: StorageLike | null;
  /** Den indloggede bruger, eller null uden session. */
  getUserId(): Promise<string | null>;
  /** null = intet svar (ingen session eller netværksfejl). */
  fetchMarkers(): Promise<{ ok: boolean; available: boolean; markers: unknown } | null>;
  /** true = serveren har markørerne. */
  putMarkers(markers: SeenMarkers): Promise<boolean>;
  /**
   * Fortæl åbne sider om brugerens markører fra serveren. `replace`: den lokale
   * kopi var en anden brugers, så sidens øjebliksbillede skal erstattes, ikke flettes.
   */
  announce?(markers: SeenMarkers, options?: { replace: boolean }): void;
}

/** Fanens hukommelse pr. forbindelse (regel 5), aldrig i localStorage. */
interface TabState {
  /** Hvad hver bruger har læst i denne fane. */
  reads: Map<string, SeenMarkers>;
  /** Hvad serveren vides at have pr. bruger (hentet eller bekræftet); kun en nedre grænse. */
  confirmed: Map<string, SeenMarkers>;
  /** Læsninger hvis bruger endnu ikke er slået op. */
  pending: Set<Promise<unknown>>;
}
const tabs = new WeakMap<SeenMarkersBackend, TabState>();

function tabFor(backend: SeenMarkersBackend): TabState {
  let tab = tabs.get(backend);
  if (!tab) {
    tab = { reads: new Map(), confirmed: new Map(), pending: new Set() };
    tabs.set(backend, tab);
  }
  return tab;
}

/** Ryk brugerens markør frem i et af fanens kort. true = den rykkede. */
function advanceFor(map: Map<string, SeenMarkers>, userId: string, key: SeenMarkerKey, value: string | null | undefined): boolean {
  const current = map.get(userId) ?? {};
  const next = laterSeenMarker(current[key], value);
  if (!next || next === current[key]) return false;
  map.set(userId, { ...current, [key]: next });
  return true;
}

function readLocal(storage: StorageLike | null, key: string): string | null {
  try { return storage?.getItem(key) ?? null; } catch { return null; }
}

function writeLocal(storage: StorageLike | null, key: string, value: string | null): void {
  try {
    if (value === null) storage?.removeItem(key);
    else storage?.setItem(key, value);
  } catch { /* privat tilstand: kopien er kun en genvej */ }
}

/** Enhedens lokale markør for én flade (som prikken altid har læst den). */
export function readLocalSeenMarker(key: SeenMarkerKey, storage: StorageLike | null = defaultStorage()): string | null {
  return readLocal(storage, SEEN_MARKER_LOCAL_KEYS[key]);
}

/**
 * Sæt den lokale markør, men kun fremad (regel 2). Returnerer den værdi der nu
 * står, og om den rykkede.
 */
export function advanceLocalSeenMarker(
  key: SeenMarkerKey,
  value: string | null | undefined,
  storage: StorageLike | null = defaultStorage(),
): { value: string | null; advanced: boolean } {
  const previous = readLocalSeenMarker(key, storage);
  const next = laterSeenMarker(previous, value);
  if (!next || next === previous) return { value: previous, advanced: false };
  writeLocal(storage, SEEN_MARKER_LOCAL_KEYS[key], next);
  return { value: next, advanced: true };
}

/**
 * Hent brugerens markører, flet dem ind i den lokale kopi og send det serveren
 * mangler op. Kaster aldrig. Returnerer true hvis den lokale kopi ændrede sig
 * (så prikken skal genberegnes).
 */
export async function syncSeenMarkers(backend: SeenMarkersBackend = appBackend): Promise<boolean> {
  try {
    const userId = await backend.getUserId().catch(() => null);
    if (!userId) return false; // udlogget: kun den lokale kopi, som i dag
    const res = await backend.fetchMarkers().catch(() => null);
    if (!res || !res.ok || !res.available) return false; // regel 1: faldvej = lokal kopi
    // Regel 5: læsninger startet før dette punkt skal kende deres bruger, før
    // kopien afstemmes. Hvert opslag er en hurtig session-læsning; loftet er kun
    // et værn mod en uendelig strøm af nye læsninger.
    const tab = tabFor(backend);
    for (let round = 0; round < 10 && tab.pending.size; round += 1) {
      await Promise.allSettled([...tab.pending]);
    }
    // Brugeren skiftede undervejs: svaret er den forriges og smides væk.
    const nowUser = await backend.getUserId().catch(() => null);
    if (nowUser !== userId) return false;

    // Herfra og til afstemningen er skrevet, sker alt uden pause (ingen await),
    // så ingen læsning kan lande midt i den.
    const server = parseSeenMarkers(res.markers);
    for (const [key, value] of Object.entries(server) as [SeenMarkerKey, string][]) advanceFor(tab.confirmed, userId, key, value);
    const reads = tab.reads.get(userId) ?? {};
    const owner = readLocal(backend.storage, SEEN_MARKERS_OWNER_KEY);
    const sameOwner = !owner || owner === userId;
    // Læst først nu, så en markør sat mens svaret var på vej, er med.
    const local: Partial<Record<SeenMarkerKey, string | null>> = {};
    for (const key of SEEN_MARKER_KEYS) local[key] = readLocalSeenMarker(key, backend.storage);

    const plan = planSeenMarkerSync(local, server, sameOwner, reads);
    for (const [key, value] of Object.entries(plan.localWrites) as [SeenMarkerKey, string | null][]) {
      writeLocal(backend.storage, SEEN_MARKER_LOCAL_KEYS[key], value);
    }
    writeLocal(backend.storage, SEEN_MARKERS_OWNER_KEY, userId);
    if (Object.keys(plan.push).length) {
      const push = plan.push;
      void backend.putMarkers(push).then((ok) => {
        if (!ok) return;
        for (const [key, value] of Object.entries(push) as [SeenMarkerKey, string][]) advanceFor(tab.confirmed, userId, key, value);
      }).catch(() => false);
    }

    // Kun serverens værdier (det brugeren så på andre enheder). Den lokale kopi kan
    // allerede indeholde dette besøg, og en værdi brugeren selv har læst i denne
    // fane, er også dette besøg: ingen af dem må slukke sidens "nyt"-markeringer.
    const elsewhere: SeenMarkers = {};
    for (const [key, value] of Object.entries(server) as [SeenMarkerKey, string][]) {
      if (value !== reads[key]) elsewhere[key] = value;
    }
    // En anden brugers kopi: åbne sider tog deres øjebliksbillede af den, så det erstattes.
    if (Object.keys(elsewhere).length) backend.announce?.(elsewhere, { replace: !sameOwner });
    return Object.keys(plan.localWrites).length > 0;
  } catch {
    return false; // ikke-kritisk UI: prikken falder tilbage til den lokale kopi
  }
}

/**
 * Notér en læsning på den indloggede bruger og send den op, medmindre serveren
 * allerede vides at have den eller en nyere (regel 5). Uafhængig af om den lokale
 * kopi rykkede. Udlogget eller fejl: kun den lokale kopi. Kaster aldrig.
 */
export async function pushSeenMarker(
  key: SeenMarkerKey,
  value: string | null | undefined,
  backend: SeenMarkersBackend = appBackend,
): Promise<boolean> {
  if (!isSeenMarker(value)) return false;
  try {
    const tab = tabFor(backend);
    // Læsningen knyttes til brugeren, før en afstemning må bruge den (se syncSeenMarkers).
    const attributed = (async () => {
      const userId = await backend.getUserId().catch(() => null);
      if (userId) advanceFor(tab.reads, userId, key, value);
      return userId;
    })();
    tab.pending.add(attributed);
    let userId: string | null;
    try { userId = await attributed; } finally { tab.pending.delete(attributed); }
    if (!userId) return false;
    const known = tab.confirmed.get(userId)?.[key] ?? null;
    if (known && laterSeenMarker(known, value) === known) return true; // serveren har den eller en nyere
    const ok = await backend.putMarkers({ [key]: value }).catch(() => false);
    if (ok) advanceFor(tab.confirmed, userId, key, value);
    return ok;
  } catch {
    return false;
  }
}

/** Sæt den lokale markør fremad og notér læsningen på brugeren (regel 5). Blokerer aldrig. */
export function markSeen(key: SeenMarkerKey, value: string | null | undefined, backend: SeenMarkersBackend = appBackend): void {
  advanceLocalSeenMarker(key, value, backend.storage);
  void pushSeenMarker(key, value, backend);
}

/**
 * En åben side, der har taget et "sidst set ved ankomst"-øjebliksbillede, rykker
 * det frem når brugerens markører lander, så prikker for noget allerede set på
 * en anden enhed forsvinder. Rykker aldrig tilbage.
 */
export function useSeenMarkersSynced(key: SeenMarkerKey, setSnapshot: (update: (prev: string | null) => string | null) => void): void {
  useEffect(() => {
    if (typeof window === "undefined") return undefined;
    const onSynced = (event: Event) => {
      const detail = ((event as CustomEvent).detail ?? {}) as { markers?: unknown; replace?: boolean };
      const value = parseSeenMarkers(detail.markers)[key];
      if (!value) return;
      // replace: øjebliksbilledet var taget af en anden brugers kopi (brugerskift).
      setSnapshot((prev) => (detail.replace ? value : laterSeenMarker(prev, value)));
    };
    window.addEventListener(SEEN_MARKERS_SYNCED_EVENT, onSynced);
    return () => window.removeEventListener(SEEN_MARKERS_SYNCED_EVENT, onSynced);
  }, [key, setSnapshot]);
}

// ── Appens forbindelse ─────────────────────────────────────────────────────

function defaultStorage(): StorageLike | null {
  try { return typeof window !== "undefined" ? window.localStorage : null; } catch { return null; }
}

// Klienten hentes dynamisk (samme greb som userUiPrefs.ts): de rene funktioner
// her testes i node uden at trække supabase-klienten med ind.
async function deps() {
  const [{ apiFetch }, { authHeaders, getSession }] = await Promise.all([import("./apiFetch.ts"), import("./supabase.ts")]);
  return { apiFetch, authHeaders, getSession };
}

const appBackend: SeenMarkersBackend = {
  get storage() { return defaultStorage(); },
  async getUserId() {
    const { getSession } = await deps();
    const { data } = await getSession();
    return data?.session?.user?.id ?? null;
  },
  async fetchMarkers() {
    const { apiFetch, authHeaders } = await deps();
    const headers = await authHeaders({ json: false });
    if (!headers) return null;
    const res = await apiFetch("/api/me/seen-markers", { headers }, { source: "seen-markers" });
    const body = res.data as { markers?: unknown; available?: boolean } | null;
    return { ok: res.ok, available: body?.available !== false, markers: body?.markers };
  },
  async putMarkers(markers) {
    const { apiFetch, authHeaders } = await deps();
    const headers = await authHeaders({ json: true });
    if (!headers) return false;
    const res = await apiFetch(
      "/api/me/seen-markers",
      { method: "PUT", headers, body: JSON.stringify({ markers }) },
      { source: "seen-markers" },
    );
    return res.ok;
  },
  announce(markers, options) {
    const detail = { markers, replace: Boolean(options?.replace) };
    try { window.dispatchEvent(new CustomEvent(SEEN_MARKERS_SYNCED_EVENT, { detail })); } catch { /* ingen window */ }
  },
};
