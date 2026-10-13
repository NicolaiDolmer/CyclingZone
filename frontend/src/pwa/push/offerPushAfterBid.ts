// #6590 · Indgangen fra auktionssiden: kaldes efter et vellykket bud.
//
// Al beslutning er i shouldOfferAfterBid (pushSupport.ts). Kun ved et ja
// hentes config fra serveren og UI'et (lazy chunk). Fail-closed: en fejl her
// maa aldrig paavirke selve buddet, der allerede er gennemfoert.
import { pushSupportState, readOfferState, readPushEnv, shouldOfferAfterBid, writeOfferAnswered } from "./pushSupport.ts";

function safeStorage(): Storage | null {
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

export async function offerPushAfterBid(auctionEnd: string | null | undefined): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    const env = readPushEnv(window);
    const storage = safeStorage();
    const base = {
      auctionEnd,
      now: new Date(),
      support: pushSupportState(env),
      permission: env.permission,
      offer: readOfferState(storage),
    };
    if (!shouldOfferAfterBid({ ...base, subscribed: false })) return;
    const { fetchPushConfig, getDeviceSubscription } = await import("./pushApi.ts");
    const [config, sub] = await Promise.all([fetchPushConfig(), getDeviceSubscription()]);
    if (!config?.enabled || !config.publicKey) return;
    if (!shouldOfferAfterBid({ ...base, subscribed: Boolean(sub) })) return;
    const { mountPushOptInOffer } = await import("./PushOptInOffer.tsx");
    await mountPushOptInOffer(config.publicKey, () => writeOfferAnswered(storage));
  } catch {
    // Tilbuddet er en bonus; buddet er allerede gennemfoert.
  }
}
