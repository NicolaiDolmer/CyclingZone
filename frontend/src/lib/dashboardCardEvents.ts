import { useEffect } from "react";
import {
  POSTHOG_CAPTURE_READY, POSTHOG_ENABLED, capturePosthogEvent, isPosthogCapturing,
} from "./posthogClient.js";

const CARD = "[data-dashboard-card]";
const cardIds = new Set([
  "survey", "seniorStartsWarning", "squadWarning", "contractWarning", "seasonSignup",
  "racePause", "todayStages", "firstRace", "myLatestResult", "nextActions",
  "teamSelection", "seasonStatus", "developmentTransition", "onboardingProgress",
  "seasonWrap", "seasonStart", "onboardingCompletion", "discord", "maidenWin",
  "heroAgony", "annualMeeting", "auctions", "transfers", "races", "forumHighlights",
  "divStandings", "forecast", "recentResults", "riderRanking", "board", "globalRank",
]);
type EventName = "dashboard_card_viewed" | "dashboard_card_clicked";

function cardId(marker: Element | null): string | null {
  const id = marker?.getAttribute("data-dashboard-card") ?? "";
  return cardIds.has(id) ? id : null;
}

export function attachDashboardCardEvents(
  root: HTMLElement,
  capture: (name: EventName, payload: { card_id: string }) => void,
  isReady: () => boolean,
) {
  if (typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return undefined;
  const owner = root.ownerDocument;
  const watched = new Map<Element, string>();
  const visible = new Set<Element>();
  const sent = new Set<string>();

  function sendVisible() {
    if (owner.visibilityState !== "visible" || !isReady()) return;
    for (const target of visible) {
      const id = watched.get(target);
      if (!id || !root.contains(target) || sent.has(id)) continue;
      capture("dashboard_card_viewed", { card_id: id });
      sent.add(id);
    }
  }

  const observer = new IntersectionObserver(entries => {
    for (const { target, isIntersecting } of entries) {
      if (isIntersecting && watched.has(target)) visible.add(target);
      else visible.delete(target);
    }
    sendVisible();
  });
  function watchCards() {
    for (const marker of root.querySelectorAll(CARD)) {
      const id = cardId(marker);
      const target = marker.classList.contains("contents") ? marker.firstElementChild : marker;
      if (!id || !target || watched.has(target)) continue;
      watched.set(target, id);
      observer.observe(target);
    }
    for (const target of watched.keys()) {
      if (root.contains(target)) continue;
      observer.unobserve(target);
      watched.delete(target);
      visible.delete(target);
    }
  }
  const changes = new MutationObserver(watchCards);
  changes.observe(root, { childList: true, subtree: true });
  watchCards();

  function onClick(event: MouseEvent) {
    const marker = event.target instanceof Element ? event.target.closest(CARD) : null;
    const id = cardId(marker);
    if (id && root.contains(marker) && isReady()) capture("dashboard_card_clicked", { card_id: id });
  }

  root.addEventListener("click", onClick, true);
  owner.addEventListener("visibilitychange", sendVisible);
  owner.defaultView?.addEventListener(POSTHOG_CAPTURE_READY, sendVisible);
  return () => {
    changes.disconnect();
    observer.disconnect();
    root.removeEventListener("click", onClick, true);
    owner.removeEventListener("visibilitychange", sendVisible);
    owner.defaultView?.removeEventListener(POSTHOG_CAPTURE_READY, sendVisible);
  };
}

export function useDashboardCardEvents(root: HTMLElement | null, userId: string | null) {
  useEffect(() => {
    if (!POSTHOG_ENABLED || !root || !userId) return undefined;
    return attachDashboardCardEvents(root, (name, payload) => {
      capturePosthogEvent(name, payload, { userId });
    }, isPosthogCapturing);
  }, [root, userId]);
}
