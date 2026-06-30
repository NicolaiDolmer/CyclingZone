import { useEffect, useRef } from "react";
import { useLocation } from "react-router-dom";
import { makeEngagementTracker, sendBeacon } from "../lib/trafficBeacon.js";

// Måler den logget-UD cold-population (logget-ind måles via player_events, #2040).
// Storage-less + consent-uafhængig: ingen cookie/localStorage/sessionStorage på
// enheden — serveren dedup'er via visit_hash. Mountes inde i BrowserRouter.
export default function TrafficBeacon({ session }) {
  const loc = useLocation();
  const tracker = useRef(null);
  const loadTs = useRef(Date.now());
  if (!tracker.current) {
    tracker.current = makeEngagementTracker(() => sendBeacon("engaged", loc.pathname));
  }

  // pageview pr. route-skift — kun logget-ud.
  useEffect(() => {
    if (session) return;
    sendBeacon("pageview", loc.pathname);
    tracker.current.pageview();
  }, [session, loc.pathname]);

  // 10s + interaktion → engaged (kun logget-ud).
  useEffect(() => {
    if (session) return undefined;
    const onInteract = () => tracker.current.interaction(Date.now() - loadTs.current);
    window.addEventListener("scroll", onInteract, { passive: true });
    window.addEventListener("click", onInteract);
    return () => {
      window.removeEventListener("scroll", onInteract);
      window.removeEventListener("click", onInteract);
    };
  }, [session]);

  return null;
}
