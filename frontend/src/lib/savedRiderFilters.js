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

// Returnerer den OPDATEREDE liste (kaldere sætter selv React-state fra den).
export function addSavedFilter(userId, name, filters) {
  const trimmedName = (name || "").trim();
  if (!trimmedName || !userId) return loadSavedFilters(userId);
  const list = loadSavedFilters(userId);
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
