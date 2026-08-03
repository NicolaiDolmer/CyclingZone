import * as Sentry from "@sentry/node";
import { normalizeSupabaseErrorMessage } from "./supabaseErrorNormalize.js";

let enabled = false;

// #2389 (A3): Supabase-js' query-fejl er PLAIN OBJECTS ({message, code, details,
// hint}), ikke Error-instanser. Sendes de rå til Sentry.captureException, bliver
// issue-titlen "captureException"/"<unknown>" og ALT grupperer i én bunke. Der er
// 30+ `throw someError;`-steder i lib/ der ender her via trackedTick m.fl., så
// normalisér centralt: syntetisér et Error med beskrivende besked, bevar code/
// details, og STRIP stacken — den syntetiske stack ville pege på denne fil for
// alle fejl og få Sentry til at gruppere ALT som ét issue; uden stack grupperer
// Sentry på type+besked, hvilket er præcis den ønskede adfærd for DB-fejl.
export function toSentryError(error) {
  if (error instanceof Error) return error;
  const rawMessage = error == null
    ? ""
    : (typeof error.message === "string" && error.message) ||
      (typeof error === "string" ? error : "") ||
      (() => { try { return JSON.stringify(error); } catch { return String(error); } })();
  const err = new Error(normalizeSupabaseErrorMessage(rawMessage) || "Unknown error (non-Error captured)");
  if (error && typeof error === "object") {
    if (error.code != null) err.code = error.code;
    if (error.details != null) err.details = error.details;
    if (error.hint != null) err.hint = error.hint;
  }
  err.stack = ""; // gruppér på besked, ikke på den syntetiske wrap-stack
  return err;
}

function releaseName() {
  return process.env.SENTRY_RELEASE ||
    process.env.RAILWAY_GIT_COMMIT_SHA ||
    process.env.VERCEL_GIT_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    undefined;
}

function sampleRateFromEnv() {
  const value = Number(process.env.SENTRY_TRACES_SAMPLE_RATE || 0);
  return Number.isFinite(value) && value >= 0 ? value : 0;
}

function positiveIntFromEnv(raw, fallback) {
  const value = Number(raw);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : fallback;
}

// #2900 — SDK-level volumen-guard (defense-in-depth BAG app-lags fingerprinting).
// CYCLINGZONE-31 brændte 11.992 events på ét døgn (97,9 % af 90-dages-kvoten,
// verificeret via Sentry search_events 25/7) fordi runAiTeamTrimHealSweepCron
// capturede ÉN Error PR HOLD PR TICK uden fast fingerprint (65 hold × 5-min-
// kadence). #2434/#2435 fixede DEN specifikke sweep (aggregeret capture, fast
// fingerprint — se cron.js linje ~668/698). Denne guard er backstoppen for
// NÆSTE tilsvarende bug et vilkårligt andet sted i koden: uanset om en
// udvikler glemmer en fingerprint, kan ÉN fejl-gruppe aldrig sende mere end
// VOLUME_LIMIT_MAX_PER_WINDOW events pr. VOLUME_LIMIT_WINDOW_MS til Sentry.
//
// Bevidst IKKE et globalt sampleRate (som ville droppe et tilfældigt udsnit,
// inkl. potentielt den FØRSTE forekomst af en helt ny fejl) — i stedet et
// per-gruppe token-vindue: tælleren for en gruppe starter ved 0 for hvert nyt
// vindue, så den FØRSTE event i en ny fejl-gruppe altid slipper igennem
// (0 < max er altid sandt). Kun GENTAGELSER ud over loftet inden for samme
// vindue droppes — nye fejltyper og nye issues opdages stadig med det samme,
// og alert-regel 559456 ("notification for high priority issues") fyrer
// stadig på issue-oprettelse, ikke på event-volumen.
const VOLUME_LIMIT_WINDOW_MS = positiveIntFromEnv(process.env.SENTRY_VOLUME_LIMIT_WINDOW_MS, 10 * 60 * 1000);
const VOLUME_LIMIT_MAX_PER_WINDOW = positiveIntFromEnv(process.env.SENTRY_VOLUME_LIMIT_MAX_PER_WINDOW, 20);
const VOLUME_LIMIT_MAX_TRACKED_KEYS = positiveIntFromEnv(process.env.SENTRY_VOLUME_LIMIT_MAX_TRACKED_KEYS, 500);

// UUID + tal erstattes med pladsholdere, så en loop der capturer "hold <id>
// fejlede: <besked>" for 65 forskellige hold grupperes som ÉN nøgle her, selv
// uden en eksplicit Sentry-fingerprint på call-site'et (netop CYCLINGZONE-31-
// mønstret). Eksporteret for test.
export function normalizeMessageForGrouping(message) {
  return String(message ?? "")
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, "<uuid>")
    .replace(/\d+/g, "<n>")
    .slice(0, 160);
}

// Grupperingsnøgle for volumen-guarden. Bruger en eksplicit fingerprint hvis
// call-site'et har sat en (fx de aggregerede #2407/#2434-captures i cron.js —
// de ligger allerede langt under loftet, så guarden er no-op for dem). Ellers
// falder den tilbage til exception-type + normaliseret besked. Eksporteret
// for test.
export function getEventGroupKey(event) {
  if (Array.isArray(event?.fingerprint) && event.fingerprint.length) {
    return `fp:${event.fingerprint.join("|")}`;
  }
  const exception = event?.exception?.values?.[0];
  const type = exception?.type || "Error";
  const message = exception?.value || event?.message || "";
  return `msg:${type}:${normalizeMessageForGrouping(message)}`;
}

// Ren, testbar factory (ingen modul-scoped state) — et lille per-nøgle
// tælle-vindue. Map'en ryddes ikke aktivt for udløbne nøgler mellem kald, men
// er hård-begrænset til maxTrackedKeys distinkte grupper (FIFO-eviction) så
// en lang-levende proces ikke vokser ubegrænset selv med mange fejltyper.
export function createVolumeLimiter({
  maxPerWindow = VOLUME_LIMIT_MAX_PER_WINDOW,
  windowMs = VOLUME_LIMIT_WINDOW_MS,
  maxTrackedKeys = VOLUME_LIMIT_MAX_TRACKED_KEYS,
} = {}) {
  const buckets = new Map(); // key -> { windowStart, count, suppressed }

  return {
    // Returnerer { allow, suppressedInWindow }. allow=false ⇒ drop eventet.
    // suppressedInWindow tælles op pr. drop og nulstilles ved nyt vindue —
    // bruges af kalderen til at logge "har nået loftet" kun ÉN gang pr. vindue.
    check(key, now = Date.now()) {
      let bucket = buckets.get(key);
      if (!bucket || now - bucket.windowStart >= windowMs) {
        if (!bucket && buckets.size >= maxTrackedKeys) {
          const oldestKey = buckets.keys().next().value;
          if (oldestKey !== undefined) buckets.delete(oldestKey);
        }
        bucket = { windowStart: now, count: 0, suppressed: 0 };
        buckets.set(key, bucket);
      }
      bucket.count += 1;
      if (bucket.count > maxPerWindow) {
        bucket.suppressed += 1;
        return { allow: false, suppressedInWindow: bucket.suppressed };
      }
      return { allow: true, suppressedInWindow: 0 };
    },
    size() {
      return buckets.size;
    },
  };
}

const defaultVolumeLimiter = createVolumeLimiter();

// #3052 — SDK-level besked-normalisering (defense-in-depth BAG toSentryError).
//
// toSentryError normaliserer kun værdier der IKKE allerede er Error-instanser
// (linje 15: `if (error instanceof Error) return error;`). Men det dominerende
// mønster i backenden er `throw new Error(\`min-kontekst: ${err.message}\`)` —
// 112 filer gør det, mod 8 der bruger withSupabaseRetry/toSupabaseError. Når
// Supabase-gatewayen svarer med en Cloudflare-fejlside, ryger hele HTML-siden
// derfor med som issue-titel (CYCLINGZONE-3X: "Error: stall-watchdog seasons:
// <!DOCTYPE html>…"), og fordi siden bærer et unikt Ray ID grupperer to udfald
// af SAMME outage ikke engang sammen.
//
// Her er det ét sted der dækker alle call-sites, uden en 112-filers refaktor.
// Kører FØR getEventGroupKey, så både Sentrys gruppering og volumen-guarden
// ser den korte besked. Muterer kun Sentry-eventet — aldrig applikationens
// egne fejl-objekter.
export function normalizeEventMessages(event) {
  if (!event || typeof event !== "object") return event;
  if (typeof event.message === "string") {
    event.message = normalizeSupabaseErrorMessage(event.message);
  }
  for (const value of event.exception?.values || []) {
    if (typeof value?.value === "string") {
      value.value = normalizeSupabaseErrorMessage(value.value);
    }
  }
  return event;
}

export function initSentry() {
  if (enabled || !process.env.SENTRY_DSN) return;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT || process.env.NODE_ENV || "development",
    release: releaseName(),
    tracesSampleRate: sampleRateFromEnv(),
    beforeSend(event) {
      // #3052: kog HTML-fejlsider ned FØR gruppering/volumen-guard nedenfor.
      normalizeEventMessages(event);

      const message = event.message || event.exception?.values?.[0]?.value || "";
      if (/rate limit exceeded/i.test(message)) return null;

      // #2900: volumen-guard — se kommentaren ved VOLUME_LIMIT_* ovenfor.
      const groupKey = getEventGroupKey(event);
      const { allow, suppressedInWindow } = defaultVolumeLimiter.check(groupKey);
      if (!allow) {
        if (suppressedInWindow === 1) {
          // Log kun ÉN gang pr. vindue at loftet er nået — Railway-logs koster
          // intet ekstra og forbliver den operationelle synlighed, mens vi
          // netop beskytter Sentry-kvoten mod at blive brændt af gentagelser.
          console.warn(
            `[sentry] volumen-guard: gruppe "${groupKey}" har ramt loftet ` +
            `(${VOLUME_LIMIT_MAX_PER_WINDOW} events / ${VOLUME_LIMIT_WINDOW_MS}ms) — ` +
            `yderligere gentagelser i dette vindue droppes fra Sentry (#2900)`
          );
        }
        return null;
      }
      return event;
    },
  });
  enabled = true;

  process.on("unhandledRejection", (reason) => {
    Sentry.captureException(reason instanceof Error ? reason : new Error(String(reason)));
  });
  process.on("uncaughtException", (error) => {
    Sentry.captureException(error);
  });
}

// context: { tags?, fingerprint?, ...extra }. fingerprint (#2434) tvinger Sentry-
// gruppering — sæt en FAST fingerprint på en aggregeret alarm, så den lander i ÉT
// issue uanset at beskeden/antallet varierer pr. tick (ellers splitter Sentry på
// den variable besked). Øvrige nøgler ender som `extra` på eventet.
export function captureException(error, context = {}) {
  if (!enabled) return;
  const { tags, fingerprint, ...extra } = context;
  Sentry.captureException(toSentryError(error), {
    extra,
    ...(tags ? { tags } : {}),
    ...(fingerprint ? { fingerprint } : {}),
  });
}

export function setupSentryExpressErrorHandler(app) {
  if (!enabled || typeof Sentry.setupExpressErrorHandler !== "function") return;
  Sentry.setupExpressErrorHandler(app);
}

// #2077 (#621 punkt 5) — Sentry Cron-heartbeat. Wrap et cron-tick så Sentry ved
// hvornår et tick STARTER og SLUTTER (ok/error). Udebliver et tick (proces død,
// deploy-hang, event-loop blokeret) fyrer Sentry en MISSED-alarm ud fra schedulen
// i monitorConfig — komplementært til stall-watchdog'en, der fanger "tavse" stalls
// mens processen ellers kører fint. No-op når Sentry er disabled (ingen DSN).
export function captureCheckIn(payload, monitorConfig) {
  if (!enabled || typeof Sentry.captureCheckIn !== "function") return undefined;
  return Sentry.captureCheckIn(payload, monitorConfig);
}

/**
 * Returnerer en wrapped async-fn der sender in_progress → ok/error check-ins omkring
 * `fn`. Fejl re-throwes (så trackedTick stadig captureExceptioner). Er Sentry
 * disabled, køres fn direkte uden overhead.
 */
export function monitorCron(monitorSlug, fn, monitorConfig) {
  return async (...args) => {
    if (!enabled || typeof Sentry.captureCheckIn !== "function") return fn(...args);
    const checkInId = Sentry.captureCheckIn({ monitorSlug, status: "in_progress" }, monitorConfig);
    try {
      const result = await fn(...args);
      Sentry.captureCheckIn({ checkInId, monitorSlug, status: "ok" }, monitorConfig);
      return result;
    } catch (err) {
      Sentry.captureCheckIn({ checkInId, monitorSlug, status: "error" }, monitorConfig);
      throw err;
    }
  };
}

// #621 item 2 — tag request-scoped Sentry-events med user.id efter auth-validation.
// KUN UUID (req.user.id) — ingen email, ingen team-navn, ingen PII (GDPR-safe).
// Sentry v8+ Node-SDK bruger OpenTelemetry-context-isolation per request, så
// Sentry.setUser() inden for en request scopes til den request alene; den
// lækker ikke til parallelle requests. Refs:
// https://docs.sentry.io/platforms/javascript/guides/node/enriching-events/identify-user/
export function setSentryUser(userId) {
  if (!enabled || !userId) return;
  Sentry.setUser({ id: userId });
}
