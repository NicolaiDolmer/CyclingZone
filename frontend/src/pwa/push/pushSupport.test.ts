// #6590 · Opt-in-reglerne: aldrig ved indlaesning, kun i kontekst, iOS kun installeret.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  OFFER_STORAGE_KEY,
  endsToday,
  pushSupportState,
  readOfferState,
  sameServerKey,
  shouldOfferAfterBid,
  urlBase64ToUint8Array,
  writeOfferAnswered,
  type OfferContext,
  type PushEnv,
} from "./pushSupport.ts";

const env = (o: Partial<PushEnv> = {}): PushEnv => ({
  hasServiceWorker: true,
  hasPushManager: true,
  hasNotification: true,
  permission: "default",
  isIos: false,
  standalone: false,
  ...o,
});

test("pushSupportState: iOS i browseren faar install-vejledningen, ikke en knap", () => {
  assert.equal(pushSupportState(env()), "ok");
  assert.equal(pushSupportState(env({ isIos: true, standalone: false })), "ios-install");
  assert.equal(pushSupportState(env({ isIos: true, standalone: true })), "ok");
  assert.equal(pushSupportState(env({ hasPushManager: false })), "unsupported");
  assert.equal(pushSupportState(env({ permission: "denied" })), "denied");
});

const NOW = new Date(2026, 9, 13, 14, 0, 0);
const ctx = (o: Partial<OfferContext> = {}): OfferContext => ({
  auctionEnd: new Date(2026, 9, 13, 21, 30).toISOString(),
  now: NOW,
  support: "ok",
  permission: "default",
  offer: { answeredAt: null },
  subscribed: false,
  ...o,
});

test("tilbuddet efter et bud: kun auktion der slutter i dag, kun én gang", () => {
  assert.equal(shouldOfferAfterBid(ctx()), true);
  assert.equal(shouldOfferAfterBid(ctx({ auctionEnd: new Date(2026, 9, 14, 9, 0).toISOString() })), false, "slutter i morgen");
  assert.equal(shouldOfferAfterBid(ctx({ auctionEnd: new Date(2026, 9, 13, 13, 0).toISOString() })), false, "allerede slut");
  assert.equal(shouldOfferAfterBid(ctx({ offer: { answeredAt: 1 } })), false, "har svaret foer");
  assert.equal(shouldOfferAfterBid(ctx({ permission: "granted" })), false, "browseren har allerede svaret");
  assert.equal(shouldOfferAfterBid(ctx({ subscribed: true })), false);
  assert.equal(shouldOfferAfterBid(ctx({ support: "ios-install" })), false, "iOS i browseren: aldrig tilbud");
});

test("endsToday bruger spillerens egen kalenderdag", () => {
  assert.equal(endsToday(null, NOW), false);
  assert.equal(endsToday("not a date", NOW), false);
  assert.equal(endsToday(new Date(2026, 9, 13, 23, 59).toISOString(), NOW), true);
});

test("svaret huskes i storage, og en oedelagt vaerdi kaster ikke", () => {
  const map = new Map<string, string>();
  const storage = {
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => void map.set(k, v),
  } as unknown as Storage;
  assert.equal(readOfferState(storage).answeredAt, null);
  writeOfferAnswered(storage, 123);
  assert.equal(readOfferState(storage).answeredAt, 123);
  map.set(OFFER_STORAGE_KEY, "{oops");
  assert.equal(readOfferState(storage).answeredAt, null);
  assert.equal(readOfferState(null).answeredAt, null);
});

test("VAPID-noeglen afkodes og sammenlignes byte for byte (noegle-rotation)", () => {
  const key = "BAECAwQ"; // 0x04 0x01 0x02 0x03 0x04
  const bytes = urlBase64ToUint8Array(key);
  assert.deepEqual([...bytes], [4, 1, 2, 3, 4]);
  assert.equal(sameServerKey(bytes.buffer, key), true);
  assert.equal(sameServerKey(new Uint8Array([4, 1, 2, 3, 5]).buffer, key), false);
  assert.equal(sameServerKey(null, key), false);
});

test("service workeren: push-handler + notificationclick, og stadig ingen app-cache", () => {
  const sw = readFileSync(new URL("../../../public/sw.js", import.meta.url), "utf8");
  assert.match(sw, /addEventListener\("push"/);
  assert.match(sw, /addEventListener\("notificationclick"/);
  assert.match(sw, /showNotification\(/);
  assert.match(sw, /tag: typeof data\.tag === "string"/);
  // Kun egne stier aabnes fra en notifikation.
  assert.match(sw, /parsed\.origin === self\.location\.origin/);
  assert.doesNotMatch(sw, /cache\.put\(request/);
});

test("browserens tilladelses-dialog kaldes kun fra en knap, aldrig ved indlaesning", () => {
  for (const file of ["./pushApi.ts", "./PushNotificationsCard.tsx", "./PushOptInOffer.tsx", "./offerPushAfterBid.ts"]) {
    const src = readFileSync(new URL(file, import.meta.url), "utf8");
    const calls = src.match(/Notification\.requestPermission\(/g) ?? [];
    assert.equal(calls.length, file === "./pushApi.ts" ? 1 : 0, file);
  }
  const card = readFileSync(new URL("./PushNotificationsCard.tsx", import.meta.url), "utf8");
  const effect = card.slice(card.indexOf("useEffect("), card.indexOf("}, []);"));
  assert.doesNotMatch(effect, /enablePushOnThisDevice/);
});
