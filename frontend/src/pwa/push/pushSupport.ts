// #6590 · Rene beslutninger for push-opt-in (testet i pushSupport.test.ts).
//
// Spec §3.1: browserens tilladelses-dialog vises ALDRIG ved indlaesning. Vi
// spoerger kun i kontekst (lige efter et bud paa en auktion der slutter i dag)
// og fra Notifikationer-sektionen paa profilsiden, og foerst naar spilleren
// trykker ja i vores egen UI kaldes Notification.requestPermission().
// iOS: web push virker kun i den installerede app, saa der viser vi
// install-vejledningen i stedet for en knap der ikke kan virke.
import { isIosDevice, isStandalone } from "../installPrompt.ts";

export const PUSH_CATEGORY_KEYS = ["auctions", "races", "transfers", "deadlines", "academy"] as const;
export type PushCategoryKey = (typeof PUSH_CATEGORY_KEYS)[number];
export type PushCategories = Record<PushCategoryKey, boolean>;

export type PushSupport = "ok" | "unsupported" | "ios-install" | "denied";

export interface PushEnv {
  hasServiceWorker: boolean;
  hasPushManager: boolean;
  hasNotification: boolean;
  permission: NotificationPermission | null;
  isIos: boolean;
  standalone: boolean;
}

export function pushSupportState(env: PushEnv): PushSupport {
  if (env.isIos && !env.standalone) return "ios-install";
  if (!env.hasServiceWorker || !env.hasPushManager || !env.hasNotification) return "unsupported";
  if (env.permission === "denied") return "denied";
  return "ok";
}

export function readPushEnv(win: Window): PushEnv {
  const nav = win.navigator;
  const NotificationApi = (win as Window & { Notification?: typeof Notification }).Notification;
  return {
    hasServiceWorker: "serviceWorker" in nav,
    hasPushManager: "PushManager" in win,
    hasNotification: typeof NotificationApi === "function",
    permission: typeof NotificationApi === "function" ? NotificationApi.permission : null,
    isIos: isIosDevice(nav.userAgent ?? "", nav.maxTouchPoints ?? 0),
    standalone: isStandalone(win),
  };
}

/** VAPID-noeglen (base64url) som Uint8Array til PushManager.subscribe. */
export function urlBase64ToUint8Array(value: string): Uint8Array<ArrayBuffer> {
  const padded = value + "=".repeat((4 - (value.length % 4)) % 4);
  const raw = atob(padded.replace(/-/g, "+").replace(/_/g, "/"));
  const out = new Uint8Array(new ArrayBuffer(raw.length));
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}

/** Er abonnementet lavet med den noegle serveren bruger nu? (Noegle-rotation.) */
export function sameServerKey(current: ArrayBuffer | null | undefined, publicKey: string): boolean {
  if (!current) return false;
  const a = new Uint8Array(current);
  const b = urlBase64ToUint8Array(publicKey);
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/** Slutter auktionen senere i dag, i spillerens egen kalenderdag? */
export function endsToday(endIso: string | null | undefined, now: Date = new Date()): boolean {
  if (!endIso) return false;
  const end = new Date(endIso);
  if (Number.isNaN(end.getTime()) || end.getTime() <= now.getTime()) return false;
  return (
    end.getFullYear() === now.getFullYear() && end.getMonth() === now.getMonth() && end.getDate() === now.getDate()
  );
}

// ── Kontekst-tilbuddet: hoejst én gang, og aldrig igen efter "Ikke nu" ────────

export const OFFER_STORAGE_KEY = "cz.pushOffer.v1";

export interface OfferState {
  answeredAt: number | null;
}

export function readOfferState(storage: Storage | null): OfferState {
  try {
    const raw = storage?.getItem(OFFER_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as Partial<OfferState>) : null;
    return { answeredAt: typeof parsed?.answeredAt === "number" ? parsed.answeredAt : null };
  } catch {
    return { answeredAt: null };
  }
}

export function writeOfferAnswered(storage: Storage | null, now: number = Date.now()): void {
  try {
    storage?.setItem(OFFER_STORAGE_KEY, JSON.stringify({ answeredAt: now }));
  } catch {
    // Privat vindue/blokeret storage: i vaerste fald spoerges der igen ved naeste bud.
  }
}

export interface OfferContext {
  auctionEnd: string | null | undefined;
  now: Date;
  support: PushSupport;
  permission: NotificationPermission | null;
  offer: OfferState;
  subscribed: boolean;
}

/**
 * Skal tilbuddet vises efter dette bud? Kun naar auktionen slutter i dag, push
 * kan virke her (ikke iOS i browseren), spilleren ikke allerede har svaret (ja
 * eller nej, her eller i browseren) og enheden ikke allerede abonnerer.
 */
export function shouldOfferAfterBid(ctx: OfferContext): boolean {
  if (ctx.support !== "ok") return false;
  if (ctx.permission !== "default") return false;
  if (ctx.offer.answeredAt != null) return false;
  if (ctx.subscribed) return false;
  return endsToday(ctx.auctionEnd, ctx.now);
}
