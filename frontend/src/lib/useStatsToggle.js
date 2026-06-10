import { useEffect, useState, useCallback } from "react";
import { STAT_KEYS } from "../components/RiderFilters";

// Default = auktionssidens oprindelige adfærd (ingen stats synlige før man
// vælger nogle til). RidersPage bruger inverteret default: alle stats synlige,
// man klikker dem FRA (Refs #1006).
const DEFAULT_STORAGE_KEY = "cz-auctions-visible-stats";

function readStored(storageKey, fallback) {
  if (typeof window === "undefined") return fallback;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter(k => STAT_KEYS.includes(k));
  } catch {
    return fallback;
  }
}

export default function useStatsToggle({
  storageKey = DEFAULT_STORAGE_KEY,
  defaultVisible = [],
} = {}) {
  const [visibleStats, setVisibleStats] = useState(() => new Set(readStored(storageKey, defaultVisible)));

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(storageKey, JSON.stringify([...visibleStats]));
    } catch {
      // localStorage kan være disabled (privacy mode); accepter tab af persistens
    }
  }, [visibleStats, storageKey]);

  const toggleStat = useCallback(key => {
    setVisibleStats(prev => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key); else next.add(key);
      return next;
    });
  }, []);

  const showAll = useCallback(() => setVisibleStats(new Set(STAT_KEYS)), []);
  const hideAll = useCallback(() => setVisibleStats(new Set()), []);

  return { visibleStats, toggleStat, showAll, hideAll };
}
