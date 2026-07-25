// Cooldown-regnestykket bag "send bekræftelsesmail igen". Refs #2826.
//
// Hvorfor: resend-knappen (#2068) havde ingen cooldown. Supabase afviser to
// resends inden for ~60 sekunder med "For security purposes, you can only
// request this after N seconds", så en spiller der ikke så mailen med det
// samme klikkede igen og fik en fejl i stedet for hjælp. Fejlen ligner at
// noget er i stykker, selv om beskeden bare er "vent lidt".
//
// Vi viser derfor en nedtælling i stedet: knappen er deaktiveret indtil den er
// brugbar igen, og teksten siger hvornår. Rammer vi alligevel rate-limitten
// (fx fordi mailen blev sendt fra en anden fane), læser vi det præcise antal
// sekunder ud af Supabases besked og bruger DET som cooldown, så nedtællingen
// er sand frem for et gæt.
//
// Ren logik uden timere eller React, så den kan testes med node --test.

// Supabases default-interval mellem to resends. Bruges når vi selv har sendt
// en mail og ikke har en server-oplyst ventetid.
export const RESEND_COOLDOWN_SECONDS = 60;

/**
 * Læs antal sekunder ud af Supabases rate-limit-besked.
 *
 * Dækker begge ordlyde vi har set i prod (#2068):
 *   "For security purposes, you can only request this after 54 seconds"
 *   "For security purposes, you can only request this once every 60 seconds"
 *
 * @param {unknown} error - AuthError, plain object eller streng
 * @returns {number|null} sekunder, eller null hvis beskeden ikke er en rate-limit
 */
export function parseRateLimitSeconds(error) {
  if (!error) return null;
  const message = typeof error === "string" ? error : error?.message;
  if (typeof message !== "string") return null;

  const match = message.match(/(?:after|every)\s+(\d+)\s+seconds?/i);
  if (!match) return null;

  const seconds = Number(match[1]);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  // Loft: en absurd høj værdi ville låse knappen i praksis for evigt. Supabases
  // interval er sekunder, ikke timer.
  return Math.min(seconds, 600);
}

/**
 * Hvor mange hele sekunder er der tilbage af en cooldown?
 *
 * @param {number|null} until - epoch-ms hvor cooldown udløber
 * @param {number} now - epoch-ms "nu"
 * @returns {number} 0 når der ikke er nogen aktiv cooldown
 */
export function cooldownSecondsLeft(until, now) {
  if (!until || !Number.isFinite(until) || !Number.isFinite(now)) return 0;
  const msLeft = until - now;
  if (msLeft <= 0) return 0;
  return Math.ceil(msLeft / 1000);
}

/**
 * Beregn hvornår resend må bruges igen.
 *
 * @param {number} now - epoch-ms
 * @param {number} [seconds] - ventetid; default RESEND_COOLDOWN_SECONDS
 * @returns {number} epoch-ms
 */
export function cooldownUntil(now, seconds = RESEND_COOLDOWN_SECONDS) {
  const safeSeconds = Number.isFinite(seconds) && seconds > 0 ? seconds : RESEND_COOLDOWN_SECONDS;
  return now + safeSeconds * 1000;
}
