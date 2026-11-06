// #7778 · Hvad en spiller gjorde paa een visning af loebssiden (een fane, een etape):
// tid pr. sektion, klik pr. sektion og scroll-dybde. Rene data uden tekst eller navne,
// saa de kan sendes til PostHog og testes uden en browser.

export type RaceViewSummary = Record<string, number | null>;

/** Under dette er det en omdirigering eller et hurtigt fanehop, ikke en visning. */
export const MIN_VIEW_MS = 500;

export function createRaceViewLog(start: number) {
  const since = new Map<string, number>();
  const seen = new Map<string, number>();
  const clicks = new Map<string, number>();
  let maxScroll = 0;
  let firstClick: number | null = null;

  const leave = (section: string, now: number) => {
    const from = since.get(section);
    if (from == null) return;
    since.delete(section);
    seen.set(section, (seen.get(section) ?? 0) + Math.max(0, now - from));
  };

  return {
    enter(section: string, now: number) {
      if (!since.has(section)) since.set(section, now);
    },
    leave,
    click(section: string, kind: string, now: number) {
      if (firstClick == null) firstClick = Math.max(0, now - start);
      const key = `${section}_${kind}`;
      clicks.set(key, (clicks.get(key) ?? 0) + 1);
    },
    scroll(pct: number) {
      if (Number.isFinite(pct)) maxScroll = Math.max(maxScroll, Math.min(100, Math.round(pct)));
    },
    /** Lukker aabne sektioner. null = for kort til at vaere en visning. */
    finish(now: number): RaceViewSummary | null {
      for (const section of [...since.keys()]) leave(section, now);
      const duration = Math.max(0, now - start);
      if (duration < MIN_VIEW_MS) return null;
      const out: RaceViewSummary = {
        duration_ms: Math.round(duration),
        max_scroll_pct: maxScroll,
        first_click_ms: firstClick == null ? null : Math.round(firstClick),
        click_count: [...clicks.values()].reduce((a, b) => a + b, 0),
      };
      for (const [section, ms] of seen) out[`ms_${section}`] = Math.round(ms);
      for (const [key, count] of clicks) out[`clicks_${key}`] = count;
      return out;
    },
  };
}

/** Hvad der blev klikket paa, som en type. Aldrig elementets tekst: den kan vaere et navn. */
export function clickKind(tag: string, role: string | null, href: string | null): string {
  if (role === "tab") return "tab";
  if (tag === "a") {
    const first = /^\/([a-z-]+)/.exec(href ?? "")?.[1];
    return first ? `link_${first.replace(/-/g, "_")}` : "link";
  }
  if (tag === "select" || tag === "input") return "field";
  return "button";
}
