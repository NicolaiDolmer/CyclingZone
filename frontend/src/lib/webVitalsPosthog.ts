import { matchPath } from "react-router";

export const WEB_VITALS_PRODUCTION_ORIGIN = "https://cyclingzone.org";
const METRICS = new Set(["LCP", "INP", "CLS"]);
const REDIRECTS = new Set(["/races/strategy"]);
const ROUTE_TEMPLATES = [
  "/dashboard", "/notifications", "/team", "/planning", "/planning/workbench",
  "/training", "/riders", "/riders/:id", "/compare", "/teams/:id", "/managers/:teamId",
  "/staff/:id", "/races/:raceId", "/race-archive/:raceSlug", "/race-centre", "/resultater",
  "/auctions", "/auctions/history", "/transfers", "/watchlist", "/standings",
  "/academy", "/academy/graduation", "/squads/u23", "/squads/junior", "/youth-races",
  "/finance", "/board", "/board/meeting", "/sponsors", "/klub", "/scouting",
  "/forum", "/forum/:postId", "/profile", "/seasons", "/seasons/:seasonId",
  "/seasons/:seasonId/finance/:teamId", "/help", "/rules", "/patch-notes", "/roadmap",
];

export interface WebVitalSample {
  name: string;
  value: number;
  id: string;
  navigationType: string;
  navigationURL?: string;
}

export function buildWebVitalProperties(metric: WebVitalSample) {
  if (!METRICS.has(metric.name) || !Number.isFinite(metric.value) || metric.value < 0 || !metric.id || !metric.navigationURL) return null;

  let url: URL;
  try {
    url = new URL(metric.navigationURL);
  } catch {
    return null;
  }
  const pathname = url.pathname.replace(/\/+$/, "").toLowerCase();
  if (url.origin !== WEB_VITALS_PRODUCTION_ORIGIN || REDIRECTS.has(pathname)) return null;
  const route = ROUTE_TEMPLATES.find(path => matchPath(path, pathname));
  if (!route) return null;

  return {
    metric_name: metric.name,
    metric_value: metric.value,
    metric_id: metric.id,
    route_template: route,
    navigation_scope: metric.navigationType === "soft-navigation" ? "spa" : "document",
    navigation_type: metric.navigationType,
    $current_url: WEB_VITALS_PRODUCTION_ORIGIN + route,
    $pathname: route,
    $referrer: "",
  };
}
