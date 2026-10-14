// #6590 · Web Push-afsendelse uden tredjepartsbibliotek.
//
// Hvorfor ikke npm-pakken `web-push`: den er gratis (MPL-2.0, 0 kr.), men den
// ligger ikke i backendens afhaengigheder, og alt den goer for os er to
// velbeskrevne standarder som Node 24 har alle byggeklodser til i node:crypto:
//
//   - RFC 8291 (Message Encryption for Web Push, aes128gcm-indholdskodning,
//     RFC 8188): ECDH P-256 + HKDF-SHA-256 + AES-128-GCM.
//   - RFC 8292 (VAPID): et ES256-signeret JWT i Authorization-headeren.
//
// Korrektheden er laast af RFC 8291 bilag A's testvektor i pushService.test.js
// (samme noegler + salt giver byte-for-byte samme krop), og VAPID-signaturen
// verificeres med den offentlige noegle i samme test. Ingen ny afhaengighed,
// ingen SaaS: beskeden gaar direkte til browserens egen push-tjeneste
// (FCM / Mozilla autopush / Apple), der ikke koster noget at bruge.
//
// Noeglerne (VAPID_PUBLIC_KEY / VAPID_PRIVATE_KEY / VAPID_SUBJECT) laeses fra
// env; de genereres én gang uden for repoet og ligger i Infisical. Den private
// noegle logges aldrig og forlader aldrig backenden.
import { createECDH, createHmac, createCipheriv, createPrivateKey, randomBytes, sign, type KeyObject } from "node:crypto";

export interface VapidConfig {
  publicKey: string; // base64url, 65 byte ukomprimeret P-256-punkt
  privateKey: string; // base64url, 32 byte
  subject: string; // mailto:… eller https://…
}

export interface PushSubscriptionKeys {
  endpoint: string;
  p256dh: string; // base64url, 65 byte
  auth: string; // base64url, 16 byte
}

export interface SendResult {
  status: number; // HTTP-status fra push-tjenesten, 0 = netvaerksfejl
  gone: boolean; // 404/410: abonnementet findes ikke laengere
  ok: boolean;
}

const RECORD_SIZE = 4096;
const JWT_TTL_SECONDS = 12 * 60 * 60; // RFC 8292: hoejst 24 t
const SEND_TIMEOUT_MS = 10_000;

export function b64urlDecode(value: string): Buffer {
  return Buffer.from(String(value).replace(/-/g, "+").replace(/_/g, "/"), "base64");
}

export function b64urlEncode(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString("base64url");
}

function hmac(key: Buffer, data: Buffer): Buffer {
  return createHmac("sha256", key).update(data).digest();
}

/**
 * Laes VAPID-konfigurationen fra env. Returnerer null hvis noget mangler eller
 * er ugyldigt, saa sweepen kan staa stille i stedet for at kaste hvert minut.
 */
export function readVapidConfig(env: Record<string, string | undefined> = process.env): VapidConfig | null {
  const publicKey = (env.VAPID_PUBLIC_KEY ?? "").trim();
  const privateKey = (env.VAPID_PRIVATE_KEY ?? "").trim();
  const subject = (env.VAPID_SUBJECT ?? "").trim();
  if (!publicKey || !privateKey || !subject) return null;
  if (!/^(mailto:|https:\/\/)/.test(subject)) return null;
  try {
    const pub = b64urlDecode(publicKey);
    const priv = b64urlDecode(privateKey);
    if (pub.length !== 65 || pub[0] !== 0x04 || priv.length !== 32) return null;
    // Noegleparret skal haenge sammen, ellers afviser hver push-tjeneste os.
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    if (!ecdh.getPublicKey().equals(pub)) return null;
    // Byg signeringsnoeglen én gang nu: fejler den, staar sweepen stille i stedet
    // for at fejle pr. besked.
    buildVapidJwt("https://validate.invalid", { publicKey, privateKey: b64urlEncode(priv), subject });
  } catch {
    return null;
  }
  // Normaliseret (uden "="-padding): JWK's d-felt kraever ren base64url.
  return { publicKey: b64urlEncode(b64urlDecode(publicKey)), privateKey: b64urlEncode(b64urlDecode(privateKey)), subject };
}

function vapidKeyObject(config: VapidConfig): KeyObject {
  const pub = b64urlDecode(config.publicKey);
  return createPrivateKey({
    key: {
      kty: "EC",
      crv: "P-256",
      d: config.privateKey,
      x: b64urlEncode(pub.subarray(1, 33)),
      y: b64urlEncode(pub.subarray(33, 65)),
    },
    format: "jwk",
  });
}

/** RFC 8292 §2: JWT med aud = push-tjenestens origin, signeret ES256 (r||s). */
export function buildVapidJwt(audience: string, config: VapidConfig, nowSeconds = Math.floor(Date.now() / 1000)): string {
  const header = b64urlEncode(Buffer.from(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const claims = b64urlEncode(
    Buffer.from(JSON.stringify({ aud: audience, exp: nowSeconds + JWT_TTL_SECONDS, sub: config.subject })),
  );
  const unsigned = `${header}.${claims}`;
  const signature = sign("sha256", Buffer.from(unsigned), { key: vapidKeyObject(config), dsaEncoding: "ieee-p1363" });
  return `${unsigned}.${b64urlEncode(signature)}`;
}

export function vapidAuthorizationHeader(endpoint: string, config: VapidConfig, nowSeconds?: number): string {
  const audience = new URL(endpoint).origin;
  return `vapid t=${buildVapidJwt(audience, config, nowSeconds)}, k=${config.publicKey}`;
}

/**
 * RFC 8291 §3-4 + RFC 8188 §2: krypter én besked til ét abonnement.
 * `asPrivateKey` og `salt` kan injiceres, KUN saa testvektoren kan genskabes;
 * i drift er begge friske tilfaeldige vaerdier pr. besked.
 */
export function encryptPayload(
  plaintext: Buffer,
  sub: Pick<PushSubscriptionKeys, "p256dh" | "auth">,
  { asPrivateKey, salt }: { asPrivateKey?: Buffer; salt?: Buffer } = {},
): Buffer {
  const uaPublic = b64urlDecode(sub.p256dh);
  const authSecret = b64urlDecode(sub.auth);
  if (uaPublic.length !== 65 || uaPublic[0] !== 0x04) throw new Error("invalid p256dh");
  if (authSecret.length < 16) throw new Error("invalid auth secret");

  const ecdh = createECDH("prime256v1");
  if (asPrivateKey) ecdh.setPrivateKey(asPrivateKey);
  else ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const ecdhSecret = ecdh.computeSecret(uaPublic);

  // §3.4: IKM = HKDF(auth_secret, ecdh_secret, "WebPush: info" || 0x00 || ua_public || as_public, 32)
  const prkKey = hmac(authSecret, ecdhSecret);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = hmac(prkKey, Buffer.concat([keyInfo, Buffer.from([1])]));

  const useSalt = salt ?? randomBytes(16);
  const prk = hmac(useSalt, ikm);
  const cek = hmac(prk, Buffer.from("Content-Encoding: aes128gcm\0\x01")).subarray(0, 16);
  const nonce = hmac(prk, Buffer.from("Content-Encoding: nonce\0\x01")).subarray(0, 12);

  // Én record: plaintext + 0x02 (sidste record), ingen ekstra padding.
  const padded = Buffer.concat([plaintext, Buffer.from([2])]);
  if (padded.length + 16 > RECORD_SIZE) throw new Error("payload too large");
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final(), cipher.getAuthTag()]);

  const header = Buffer.alloc(16 + 4 + 1);
  useSalt.copy(header, 0);
  header.writeUInt32BE(RECORD_SIZE, 16);
  header.writeUInt8(asPublic.length, 20);
  return Buffer.concat([header, asPublic, encrypted]);
}

export interface SendOptions {
  ttlSeconds?: number;
  urgency?: "very-low" | "low" | "normal" | "high";
  topic?: string; // RFC 8030 §5.4: en ny besked med samme topic erstatter en ikke-leveret
  fetchImpl?: typeof fetch;
  nowSeconds?: number;
}

/** Send én krypteret besked. Kaster aldrig: resultatet beskriver udfaldet. */
export async function sendWebPush(
  sub: PushSubscriptionKeys,
  payload: string,
  config: VapidConfig,
  { ttlSeconds = 12 * 60 * 60, urgency = "normal", topic, fetchImpl = fetch, nowSeconds }: SendOptions = {},
): Promise<SendResult> {
  // Endpoint uden for de kendte push-tjenester: send aldrig (SSRF-vaern), slet.
  if (!isValidPushEndpoint(sub.endpoint)) return { status: 0, gone: true, ok: false };
  let body: Buffer;
  let authorization: string;
  try {
    body = encryptPayload(Buffer.from(payload, "utf8"), sub);
  } catch {
    // best-effort: ugyldige noegler i abonnementet kan aldrig lykkes, behandl som vaek.
    return { status: 0, gone: true, ok: false };
  }
  try {
    authorization = vapidAuthorizationHeader(sub.endpoint, config, nowSeconds);
  } catch {
    // best-effort: server-side VAPID-fejl er ikke abonnementets skyld; slet det ikke.
    return { status: 0, gone: false, ok: false };
  }
  const headers: Record<string, string> = {
    "Content-Encoding": "aes128gcm",
    "Content-Type": "application/octet-stream",
    TTL: String(ttlSeconds),
    Urgency: urgency,
    Authorization: authorization,
  };
  if (topic && /^[A-Za-z0-9_-]{1,32}$/.test(topic)) headers.Topic = topic;
  try {
    const res = await fetchImpl(sub.endpoint, {
      method: "POST",
      headers,
      body: new Uint8Array(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    });
    return { status: res.status, gone: res.status === 404 || res.status === 410, ok: res.status >= 200 && res.status < 300 };
  } catch {
    return { status: 0, gone: false, ok: false };
  }
}

// Browsernes push-tjenester (Chrome/Edge-Android/Samsung = FCM, Firefox =
// Mozilla autopush, Safari/iOS = Apple, Edge-desktop = WNS). Backenden POSTer
// kun til disse, saa et forfalsket abonnement aldrig kan faa serveren til at
// kalde en vilkaarlig adresse (SSRF).
const PUSH_HOSTS = ["fcm.googleapis.com", "updates.push.services.mozilla.com", "web.push.apple.com"];
const PUSH_HOST_SUFFIXES = [".push.services.mozilla.com", ".push.apple.com", ".notify.windows.com"];

export function isValidPushEndpoint(endpoint: unknown): endpoint is string {
  if (typeof endpoint !== "string" || endpoint.length > 2048) return false;
  try {
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.port || url.username || url.password) return false;
    const host = url.hostname.toLowerCase();
    return PUSH_HOSTS.includes(host) || PUSH_HOST_SUFFIXES.some((suffix) => host.endsWith(suffix));
  } catch {
    return false;
  }
}
