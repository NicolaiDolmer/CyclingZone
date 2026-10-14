// #6590 · Klient-siden af push: abonnement paa denne enhed + /api/push/*.
//
// Workeren (/sw.js) registreres af serviceWorker.ts i produktion. Push kraever
// den; i dev findes den ikke, og saa melder vi "virker ikke her" i stedet for at
// registrere en worker midt i HMR.
import { apiFetch } from "../../lib/apiFetch.ts";
import { authHeaders } from "../../lib/supabase.ts";
import { SW_URL } from "../serviceWorker.ts";
import { PUSH_CATEGORY_KEYS, sameServerKey, urlBase64ToUint8Array, type PushCategories } from "./pushSupport.ts";

export interface PushConfig {
  enabled: boolean;
  publicKey: string | null;
  categories: PushCategories;
  timezone: string | null;
}

function normalizeCategories(input: unknown): PushCategories {
  const source = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const out = {} as PushCategories;
  for (const key of PUSH_CATEGORY_KEYS) out[key] = source[key] === true;
  return out;
}

export async function fetchPushConfig(): Promise<PushConfig | null> {
  // GET uden Content-Type: ingen unoedvendig CORS-preflight (#4348).
  const headers = await authHeaders({ json: false });
  if (!headers) return null;
  const res = await apiFetch("/api/push/config", { headers }, { source: "push-config" });
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  const data = res.data as Record<string, unknown>;
  return {
    enabled: data.enabled === true,
    publicKey: typeof data.publicKey === "string" ? data.publicKey : null,
    categories: normalizeCategories(data.categories),
    timezone: typeof data.timezone === "string" ? data.timezone : null,
  };
}

async function getRegistration(register: boolean): Promise<ServiceWorkerRegistration | null> {
  if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return null;
  const existing = await navigator.serviceWorker.getRegistration("/");
  if (existing) return existing;
  if (!register || !import.meta.env.PROD) return null;
  await navigator.serviceWorker.register(SW_URL, { scope: "/", updateViaCache: "none" });
  return navigator.serviceWorker.ready;
}

export async function getDeviceSubscription(): Promise<PushSubscription | null> {
  try {
    const reg = await getRegistration(false);
    return (await reg?.pushManager.getSubscription()) ?? null;
  } catch {
    return null;
  }
}

function browserTimeZone(): string | null {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || null;
  } catch {
    return null;
  }
}

async function postSubscription(sub: PushSubscription): Promise<boolean> {
  const headers = await authHeaders();
  if (!headers) return false;
  const res = await apiFetch(
    "/api/push/subscriptions",
    { method: "POST", headers, body: JSON.stringify({ subscription: sub.toJSON(), timezone: browserTimeZone() }) },
    { source: "push-subscribe" },
  );
  return res.ok;
}

export type EnableOutcome = "ok" | "denied" | "unsupported" | "error";

/** Spilleren har trykket ja i VORES UI: foerst nu spoerges browseren. */
export async function enablePushOnThisDevice(publicKey: string): Promise<EnableOutcome> {
  try {
    const permission = await Notification.requestPermission();
    if (permission !== "granted") return "denied";
    const reg = await getRegistration(true);
    if (!reg) return "unsupported";
    let sub = await reg.pushManager.getSubscription();
    if (sub && !sameServerKey(sub.options.applicationServerKey, publicKey)) {
      await sub.unsubscribe();
      sub = null;
    }
    sub ??= await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
    return (await postSubscription(sub)) ? "ok" : "error";
  } catch {
    return "error";
  }
}

export async function disablePushOnThisDevice(): Promise<boolean> {
  const sub = await getDeviceSubscription();
  if (!sub) return true;
  const headers = await authHeaders();
  if (headers) {
    await apiFetch(
      "/api/push/subscriptions",
      { method: "DELETE", headers, body: JSON.stringify({ endpoint: sub.endpoint }) },
      { source: "push-unsubscribe" },
    );
  }
  try {
    return await sub.unsubscribe();
  } catch {
    return false;
  }
}

/**
 * Enheden abonnerer allerede: knyt endpointet til den spiller der er logget
 * ind nu (samme telefon kan skifte konto). Stille; en fejl aendrer intet.
 */
export async function syncDeviceSubscription(sub: PushSubscription, publicKey: string): Promise<boolean> {
  if (!sameServerKey(sub.options.applicationServerKey, publicKey)) return false;
  return postSubscription(sub);
}

export async function savePushCategories(patch: Partial<PushCategories>): Promise<PushCategories | null> {
  const headers = await authHeaders();
  if (!headers) return null;
  const res = await apiFetch(
    "/api/push/prefs",
    { method: "PATCH", headers, body: JSON.stringify({ categories: patch }) },
    { source: "push-prefs" },
  );
  if (!res.ok || !res.data || typeof res.data !== "object") return null;
  return normalizeCategories((res.data as Record<string, unknown>).categories);
}

/**
 * Log ud (Layout.signOut): slet enhedens abonnement, saa en delt enhed ikke
 * bliver ved med at faa den forrige spillers push (GDPR, spec §4). Bundet til
 * 1,5 s, saa log ud aldrig haenger paa et langsomt netvaerk.
 */
export async function forgetPushOnThisDevice(): Promise<void> {
  const work = disablePushOnThisDevice().then(() => undefined);
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, 1500));
  await Promise.race([work, timeout]);
}
