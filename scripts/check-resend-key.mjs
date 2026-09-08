#!/usr/bin/env node
// scripts/check-resend-key.mjs
// ============================================================
// Read-only verifikation af RESEND_API_KEY (#2853).
//
// HVORFOR (fund 8/9, go-live-sessionen): "noeglen findes i Railway" er ikke
// det samme som "noeglen kan sende". Og den naive test — GET /domains — svarer
// 401 for en HELT GYLDIG sende-noegle, fordi en noegle med "Sending access"
// bevidst ikke maa laese domaene-listen. Vi konkluderede derfor 2/9 at noeglen
// var ugyldig, selvom den virkede. Forskellen ligger i fejlens NAVN:
//
//   401 name = "restricted_api_key" -> noeglen er GYLDIG, men kun sende-scopet.
//   401 name = "invalid_api_key"    -> noeglen er ugyldig/tilbagekaldt.
//   200                             -> noeglen er gyldig med fuld adgang.
//
// Scriptet printer ALDRIG noegleværdien, hverken hel eller delvis, og logger
// aldrig responsens body raat (den kan indeholde domaene-/kontodata). Kun
// status + fejl-navn.
//
// Brug:
//   infisical run --env=prod -- node scripts/check-resend-key.mjs
//
// Exit-koder:
//   0 - noeglen kan sende (200 eller restricted_api_key)
//   1 - noeglen er ugyldig, mangler, eller svaret kunne ikke tolkes
//   2 - netvaerks-/kald-fejl (siger intet om noeglen)

const RESEND_DOMAINS_URL = "https://api.resend.com/domains";
const TIMEOUT_MS = 10_000;

/**
 * REN: oversaet (status, fejl-navn) til en konklusion. Eksporteret saa den kan
 * unit-testes uden netvaerk.
 * @param {{status: number, errorName?: string|null}} args
 * @returns {{ok: boolean, exitCode: 0|1, verdict: string}}
 */
export function classifyResendKeyProbe({ status, errorName = null }) {
  if (status === 200) {
    return { ok: true, exitCode: 0, verdict: "gyldig (fuld adgang - kan baade laese domaener og sende)" };
  }
  if (status === 401 && errorName === "restricted_api_key") {
    return {
      ok: true,
      exitCode: 0,
      verdict: "gyldig (Sending access) - 401 paa /domains er FORVENTET for en ren sende-noegle",
    };
  }
  if (status === 401 || status === 403) {
    return { ok: false, exitCode: 1, verdict: `ugyldig eller tilbagekaldt (${errorName || `HTTP ${status}`})` };
  }
  return { ok: false, exitCode: 1, verdict: `uventet svar (HTTP ${status}${errorName ? `, ${errorName}` : ""})` };
}

async function main() {
  const key = process.env.RESEND_API_KEY;
  if (!key) {
    console.error("[resend-key] RESEND_API_KEY er ikke sat i miljoeet.");
    console.error("             Koer scriptet via Infisical: infisical run --env=prod -- node scripts/check-resend-key.mjs");
    process.exit(1);
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let response;
  try {
    response = await fetch(RESEND_DOMAINS_URL, {
      method: "GET",
      headers: { Authorization: `Bearer ${key}` },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    // Et netvaerksudfald siger INTET om noeglen - egen exit-kode, saa en
    // flakey forbindelse ikke fejllaeses som "noeglen er doed".
    console.error(`[resend-key] kaldet til Resend fejlede (netvaerk/timeout): ${err?.message || err}`);
    process.exit(2);
  }
  clearTimeout(timer);

  // Fejl-navnet er det eneste vi laeser ud af body'en - aldrig hele svaret.
  let errorName = null;
  try {
    const body = await response.json();
    errorName = body?.name ?? body?.error?.name ?? null;
  } catch {
    errorName = null;
  }

  const { verdict, exitCode } = classifyResendKeyProbe({ status: response.status, errorName });
  console.log(`[resend-key] ${verdict}`);
  process.exit(exitCode);
}

// Kun naar filen koeres direkte - saa testen kan importere
// classifyResendKeyProbe uden at udloese et netvaerkskald.
if (process.argv[1] && process.argv[1].endsWith("check-resend-key.mjs")) {
  await main();
}
