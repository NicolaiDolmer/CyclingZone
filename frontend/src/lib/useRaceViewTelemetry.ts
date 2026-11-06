// #7778 · Maaler hvad spilleren goer paa loebssiden: een opsummering pr. fane og etape til
// PostHog, og fane og etape som tags i Clarity. Begge kraever samtykke (posthogClient,
// clarityIntegration). Sektioner markeres med data-race-section. Maalingen maa aldrig
// paavirke siden: uden browser-API'erne sker der intet.
import { useEffect } from "react";
import { capturePosthogEvent } from "./posthogClient.js";
import { clickKind, createRaceViewLog } from "./raceViewLog.ts";

const SECTION_SELECTOR = "[data-race-section]";
const CLICKABLE = "a,button,input,select,[role=button],[role=tab]";

interface Context { raceId: string | null | undefined; tab: string; stage: number; phase: string }

function tagClarity(tab: string, stage: number) {
  const clarity = (window as unknown as { clarity?: (...args: unknown[]) => void }).clarity;
  if (typeof clarity !== "function") return;
  clarity("set", "race_tab", tab);
  clarity("set", "race_stage", String(stage));
  clarity("event", `race_tab_${tab}`);
}

function scrollPct(): number {
  const height = document.documentElement.scrollHeight;
  return height > 0 ? ((window.scrollY + window.innerHeight) / height) * 100 : 0;
}

export function useRaceViewTelemetry({ raceId, tab, stage, phase }: Context) {
  useEffect(() => {
    if (!raceId || typeof IntersectionObserver === "undefined" || typeof MutationObserver === "undefined") return undefined;
    tagClarity(tab, stage);
    const context = { race_id: raceId, tab, stage, phase };
    // null = fanen er skjult: baggrundstid er ikke en visning.
    let log: ReturnType<typeof createRaceViewLog> | null = createRaceViewLog(performance.now());
    const watched = new Set<Element>();
    const sectionOf = (el: Element) => el.getAttribute("data-race-section") ?? "page";

    // Laesezonen er midten af skaermen: en sektion der kun stikker ind i kanten er ikke set.
    const seen = new IntersectionObserver((entries) => {
      const now = performance.now();
      for (const entry of entries) {
        if (entry.isIntersecting) log?.enter(sectionOf(entry.target), now);
        else log?.leave(sectionOf(entry.target), now);
      }
    }, { rootMargin: "-20% 0px -20% 0px" });
    const rescan = () => {
      for (const el of document.querySelectorAll(SECTION_SELECTOR)) {
        if (watched.has(el)) continue;
        watched.add(el);
        seen.observe(el);
      }
    };
    rescan();
    const added = new MutationObserver(rescan);
    added.observe(document.body, { childList: true, subtree: true });

    const onScroll = () => log?.scroll(scrollPct());
    const onClick = (event: MouseEvent) => {
      const target = event.target instanceof Element ? event.target.closest(CLICKABLE) : null;
      if (!target || !target.closest("[data-race-page]")) return;
      const section = target.closest(SECTION_SELECTOR);
      const kind = clickKind(target.tagName.toLowerCase(), target.getAttribute("role"), target.getAttribute("href"));
      log?.click(section ? sectionOf(section) : "page", kind, performance.now());
    };
    const send = () => {
      const summary = log?.finish(performance.now());
      if (summary) capturePosthogEvent("race_view_summary", { ...context, ...summary });
      log = null;
    };
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        send();
        return;
      }
      // Tilbage paa fanen: ny visning, og observeren melder igen, hvad der er i laesezonen.
      log = createRaceViewLog(performance.now());
      for (const el of watched) {
        seen.unobserve(el);
        seen.observe(el);
      }
    };
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    document.addEventListener("click", onClick, true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pagehide", send);
    return () => {
      window.removeEventListener("scroll", onScroll);
      document.removeEventListener("click", onClick, true);
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pagehide", send);
      added.disconnect();
      seen.disconnect();
      send();
    };
  }, [raceId, tab, stage, phase]);
}
