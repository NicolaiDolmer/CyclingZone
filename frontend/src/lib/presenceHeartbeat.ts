// #6343: presence-heartbeat der holder pause i skjulte faner.
//
// Intervallet kørte før hvert 60. sekund også i baggrundsfaner. Nu stopper det
// når dokumentet er skjult, og sender ét kald straks når fanen bliver synlig.
// Ren logik uden React, så den kan testes med falske timere og et falsk
// dokument (repoet har ingen jsdom).

export const PRESENCE_INTERVAL_MS = 60_000;

export interface VisibilityDocLike {
  hidden: boolean;
  addEventListener(type: "visibilitychange", listener: () => void): void;
  removeEventListener(type: "visibilitychange", listener: () => void): void;
}

export interface PresenceHeartbeatOptions {
  tick: () => void;
  doc: VisibilityDocLike;
  intervalMs?: number;
  setIntervalFn?: (fn: () => void, ms: number) => unknown;
  clearIntervalFn?: (id: unknown) => void;
}

export function startPresenceHeartbeat(opts: PresenceHeartbeatOptions): () => void {
  const {
    tick,
    doc,
    intervalMs = PRESENCE_INTERVAL_MS,
    setIntervalFn = (fn, ms) => setInterval(fn, ms),
    clearIntervalFn = (id) => clearInterval(id as ReturnType<typeof setInterval>),
  } = opts;

  let timer: unknown = null;

  const stopTimer = () => {
    if (timer !== null) {
      clearIntervalFn(timer);
      timer = null;
    }
  };
  const startTimer = () => {
    if (timer !== null) return;
    timer = setIntervalFn(() => {
      if (!doc.hidden) tick();
    }, intervalMs);
  };
  const onVisibility = () => {
    if (doc.hidden) {
      stopTimer();
      return;
    }
    // Synlig igen: ét kald med det samme, og genstart takten fra nu.
    stopTimer();
    tick();
    startTimer();
  };

  doc.addEventListener("visibilitychange", onVisibility);
  if (!doc.hidden) startTimer();

  return () => {
    doc.removeEventListener("visibilitychange", onVisibility);
    stopTimer();
  };
}

// Presence-svaret bærer online-tallet (#6343). Returnerer null hvis feltet
// mangler (gammel backend under deploy), så kalderen kan falde tilbage til
// /api/online-count.
export function readOnlineCountFromPresence(data: unknown): number | null {
  const value = (data as { online_count?: unknown } | null | undefined)?.online_count;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
