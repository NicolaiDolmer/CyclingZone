import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { makeEngagementTracker, sendBeacon } from "../lib/trafficBeacon.js";

// Måler den logget-UD cold-population (logget-ind måles via player_events, #2040).
// Storage-less + consent-uafhængig: ingen cookie/localStorage/sessionStorage på
// enheden — serveren dedup'er via visit_hash. Mountes inde i BrowserRouter.
//
// Al ref-init + Date.now() sker i EFFECTS (ikke i render) for react-hooks-renhed
// (react-hooks/purity + react-hooks/refs).
export default function TrafficBeacon({ session }) {
  const loc = useLocation();
  const trackerRef = useRef(null);
  const loadTsRef = useRef(0);
  const pathRef = useRef(loc.pathname);

  // Hold seneste path tilgængelig for engaged-beaconen uden ref-skriv i render.
  useEffect(() => {
    pathRef.current = loc.pathname;
  }, [loc.pathname]);

  // Init tracker + load-timestamp én gang ved mount (Date.now i effect, ikke render).
  useEffect(() => {
    loadTsRef.current = Date.now();
    trackerRef.current = makeEngagementTracker(() => sendBeacon("engaged", pathRef.current));
  }, []);

  // pageview pr. route-skift — kun logget-ud.
  useEffect(() => {
    if (session) return;
    sendBeacon("pageview", loc.pathname);
    trackerRef.current?.pageview();
  }, [session, loc.pathname]);

  // 10s + interaktion → engaged (kun logget-ud).
  useEffect(() => {
    if (session) return undefined;
    const onInteract = () => {
      trackerRef.current?.interaction(Date.now() - loadTsRef.current);
    };
    window.addEventListener("scroll", onInteract, { passive: true });
    window.addEventListener("click", onInteract);
    return () => {
      window.removeEventListener("scroll", onInteract);
      window.removeEventListener("click", onInteract);
    };
  }, [session]);

  return null;
}
