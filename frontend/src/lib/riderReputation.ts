// #4956: Earned rider reputation visibility.
//
// Kilden er backendens GET /api/display-flags. Flaget i app_config har sit eget
// off|shadow|on-forloeb, og klienten faar kun en boolean: true betyder "on".
// Shadow er false her, saa ingen spillerflade laeser eller viser de nye tal
// foer ejerens flip.

const STORAGE_KEY = "cz_rider_reputation_enabled";

function readCached(): boolean {
  try {
    if (typeof localStorage === "undefined") return false;
    return localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

let riderReputation = readCached();
const listeners = new Set<() => void>();

export function isRiderReputationOn(): boolean {
  return riderReputation;
}

export function setRiderReputation(enabled: boolean): void {
  const next = enabled === true;
  try {
    if (typeof localStorage !== "undefined") {
      if (next) localStorage.setItem(STORAGE_KEY, "1");
      else localStorage.removeItem(STORAGE_KEY);
    }
  } catch {
    // Blokeret storage: kontakten virker stadig for denne sideload.
  }
  if (next === riderReputation) return;
  riderReputation = next;
  for (const fn of listeners) fn();
}

export function subscribeRiderReputation(fn: () => void): () => void {
  listeners.add(fn);
  return () => {
    listeners.delete(fn);
  };
}
