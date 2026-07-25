/**
 * Per-URL FIFO-serialisering af Discord-webhook-poster (#2882).
 * ===============================================================
 * Discords rate limit er PR. WEBHOOK (~5 requests/2s), ikke global. Root-cause
 * for #2882 var 4 tier-3-puljer der finaliserede inden for få sekunder af
 * hinanden og alle postede til SAMME tier-samlekanal (getResultWebhooks) —
 * stage-scheduleren afvikler i dag ét løb ad gangen (stageScheduler.js: `for
 * (const race of dueRaces) await runStageFn(...)`), så det reelle burst-
 * mønster i dag er "hurtigt efter hinanden", ikke "bogstaveligt samtidig".
 * Men to uafhængige kilder (fx et cron-tick der overlapper en admin-triggeret
 * simulate-stage, eller en fremtidig refaktor der parallelliserer scheduleren
 * for throughput) KAN sende ægte samtidige POSTs til samme URL — og selv
 * "hurtigt efter hinanden" uden nogen kø kan i praksis ramme rate-limit-
 * vinduet. Denne kø gør serialisering pr. URL til en invariant i selve
 * sendWebhook, i stedet for noget hver kalder skal huske at overholde.
 *
 * Bevidst valg: serialisering er PR. URL, ikke global. Forskellige webhook-
 * URLs (fx gruppe-kanal vs. tier-samlekanal, eller ops-kanalen) er FORSKELLIGE
 * Discord-rate-limit-buckets — at serialisere på tværs af dem ville bare
 * tilføje unødig ventetid uden at forebygge noget.
 */

// url -> hale af kæden af afventende/kørende leverancer for den URL.
const tailByUrl = new Map();

/**
 * Kør `fn` efter alle tidligere `serializeByUrl(url, ...)`-kald for samme
 * `url` er afsluttet (uanset om de lykkedes). Forskellige `url`-værdier kører
 * uafhængigt af hinanden. Returnerer `fn`s resultat/fejl uændret til kalderen.
 */
export function serializeByUrl(url, fn) {
  const prevTail = tailByUrl.get(url) || Promise.resolve();
  const result = prevTail.then(fn, fn); // kør fn uanset om forrige led fejlede
  // Kæden holder kun styr på TIMING (hvornår forrige er færdig) — swallow fejl
  // her, så ét fejlet forsøg ikke låser alle efterfølgende poster til samme
  // URL fast for evigt. Selve fejlen returneres stadig til den ægte kalder
  // via `result`.
  tailByUrl.set(url, result.catch(() => {}));
  return result;
}

/** Test-only: nulstil kø-state mellem tests. */
export function __resetWebhookQueueForTests() {
  tailByUrl.clear();
}
