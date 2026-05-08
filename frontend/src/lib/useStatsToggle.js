import { useEffect, useState, useCallback } from "react";
import { STAT_KEYS } from "../components/RiderFilters";

const STORAGE_KEY = "cz-auctions-visible-stats";

function readStored() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(k => STAT_KEYS.includes(k));
  } catch {
    return [];
  }
}

export default function useStatsToggle() {
  const [visibleStats, setVisibleStats] = useState(() => new Set(readStored()));

  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...visibleStats]));
    } catch {
      // localStorage kan være disabled (privacy mode); accepter tab af persistens
    }
  }, [visibleStats]);

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
