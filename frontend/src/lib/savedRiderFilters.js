// #4649 · Gemte filtre (Pro v1.1, del C). Rene localStorage-helpers — v1 er
// bevidst KUN klient-lokal (ejer-beslutning i issuet: "ingen migration").
// Nøglen er pr. bruger (userId), så et delt device ikke blander to spilleres
// gemte filtre.
//
// Loft: 10 gemte filtre pr. bruger (samme størrelsesorden som CompareSelection
// MAX_COMPARE-mønstret — en fast lille konstant, ikke Pro-gated i sig selv,
// da HELE denne funktion allerede er Pro-gated i UI'et).
export const MAX_SAVED_FILTERS = 10;

function storageKey(userId) {
  return `cz-riders-saved-filters-${userId}`;
}

export function loadSavedFilters(userId) {
  if (!userId) return [];
  try {
    const raw = localStorage.getItem(storageKey(userId));
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(userId, list) {
  try {
    localStorage.setItem(storageKey(userId), JSON.stringify(list));
  } catch {
    // Privat vindue / fuld storage — filteret virker stadig for sessionen,
    // det bliver bare ikke husket næste gang (samme fejltolerance som
    // useStatsToggle's localStorage-brug).
  }
}

function normalizeName(name) {
  return (name || "").trim().toLocaleLowerCase();
}

// #6286: hvorfor et navn ikke kan gemmes, eller null. Rækkefølge: tomt navn,
// loftet nået, dublet (samme navn uden hensyn til store/små bogstaver og mellemrum).
export function savedFilterNameError(list, name) {
  const normalized = normalizeName(name);
  if (!normalized) return "empty";
  if ((list?.length ?? 0) >= MAX_SAVED_FILTERS) return "limit";
  if ((list ?? []).some((f) => normalizeName(f?.name) === normalized)) return "duplicate";
  return null;
}

// Returnerer den OPDATEREDE liste (kaldere sætter selv React-state fra den).
// #6286: et dublet-navn gemmer intet (listen returneres uændret). Loftet håndhæves
// i UI'et (Save-knappen forklarer det); slice'en herunder er kun et sikkerhedsnet.
export function addSavedFilter(userId, name, filters) {
  const trimmedName = (name || "").trim();
  if (!trimmedName || !userId) return loadSavedFilters(userId);
  const list = loadSavedFilters(userId);
  if (list.some((f) => normalizeName(f?.name) === normalizeName(trimmedName))) return list;
  const entry = { id: `f-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`, name: trimmedName, filters };
  const next = [entry, ...list].slice(0, MAX_SAVED_FILTERS);
  persist(userId, next);
  return next;
}

export function removeSavedFilter(userId, id) {
  const next = loadSavedFilters(userId).filter((f) => f.id !== id);
  persist(userId, next);
  return next;
}
