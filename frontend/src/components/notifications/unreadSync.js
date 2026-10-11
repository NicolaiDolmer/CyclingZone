// #6473: ulaest-taelleren (Layout-badge + Beskeder-fanens tal) skal holde sig
// korrekt paa tvaers af faner og efter mark-read / mark-all.
//
// Aarsag foer: Layout laeste taelleren via Realtime (UPDATE-events) og et
// window-event der KUN blev sendt ved sletning. mark-read / mark-all dispatchede
// intet, saa taelleren i samme fane afhang helt af at Realtime-kanalen levede.
// Og en anden fane (eller en Edge-fane der har sovet) fik aldrig besked -
// kanalen kan vaere doed uden at nogen opdager det, og taelleren staar fast
// indtil refresh.
//
// Her: ét signal-sted. notifyUnreadChanged() fortaeller baade denne fane
// (window-event) og alle andre faner (BroadcastChannel). subscribeUnreadSync()
// lytter paa begge - og paa at fanen bliver synlig / faar fokus / kommer online
// igen, saa en fane der har sovet genberegner sig selv.

export const NOTIF_CHANGED_EVENT = "cz:notif-changed";
// Eksisterende event fra deleteNotif/deleteMany/deleteAllRead - lyttes der stadig paa.
export const NOTIF_DELETED_EVENT = "cz:notif-deleted";
export const NOTIF_CHANNEL_NAME = "cz-notif-unread";

// Pr. fane/modul-instans: broadcasten fra en fane maa ikke trigge den samme fane
// en gang til (den har allerede faaet window-eventet).
const TAB_ID = Math.random().toString(36).slice(2);

function defaultEnv() {
  return {
    win: typeof window !== "undefined" ? window : null,
    doc: typeof document !== "undefined" ? document : null,
    BC: typeof BroadcastChannel !== "undefined" ? BroadcastChannel : null,
  };
}

/** Kaldes naar notifikationer er laest/slettet i denne fane. */
export function notifyUnreadChanged(env = defaultEnv()) {
  const { win, BC } = env;
  try {
    if (win?.dispatchEvent) win.dispatchEvent(new Event(NOTIF_CHANGED_EVENT));
  } catch { /* ikke-kritisk: taelleren genberegnes ogsaa ved fokus */ }
  if (!BC) return;
  try {
    const channel = new BC(NOTIF_CHANNEL_NAME);
    channel.postMessage({ type: "changed", from: env.tabId ?? TAB_ID });
    channel.close();
  } catch { /* BroadcastChannel kan vaere blokeret (privat vindue) */ }
}

/**
 * Kalder `onChange(source)` naar taelleren kan vaere forkert. Returnerer cleanup.
 * source er "local" naar aendringen skete i DENNE fane (listen er allerede
 * opdateret optimistisk) og "external" ellers (anden fane, fokus, synlig, online).
 * Udloeserne: eget window-event, andre faners BroadcastChannel, fane synlig
 * igen, vindue-fokus, netvaerk tilbage.
 */
export function subscribeUnreadSync(onChange, env = defaultEnv()) {
  const { win, doc, BC } = env;
  const cleanups = [];
  const fireLocal = () => { onChange("local"); };
  const fireExternal = () => { onChange("external"); };

  if (win?.addEventListener) {
    for (const [name, fire] of [
      [NOTIF_CHANGED_EVENT, fireLocal],
      [NOTIF_DELETED_EVENT, fireLocal],
      ["focus", fireExternal],
      ["online", fireExternal],
    ]) {
      win.addEventListener(name, fire);
      cleanups.push(() => win.removeEventListener(name, fire));
    }
  }
  if (doc?.addEventListener) {
    const onVisibility = () => { if (doc.visibilityState === "visible") fireExternal(); };
    doc.addEventListener("visibilitychange", onVisibility);
    cleanups.push(() => doc.removeEventListener("visibilitychange", onVisibility));
  }
  if (BC) {
    try {
      const channel = new BC(NOTIF_CHANNEL_NAME);
      channel.onmessage = (msg) => { if (msg?.data?.from !== (env.tabId ?? TAB_ID)) fireExternal(); };
      cleanups.push(() => { channel.onmessage = null; channel.close(); });
    } catch { /* BroadcastChannel blokeret: window-events daekker denne fane */ }
  }

  return () => { for (const cleanup of cleanups) cleanup(); };
}
