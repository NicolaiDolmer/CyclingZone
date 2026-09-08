# 2026-09-08 · Mail-asset på stabil URL blev cachet af Outlooks billed-proxy

**Symptom:** #5045 gjorde `wordmark-email.png` gennemsigtig. Prod serverede den nye fil (md5 verificeret), men Outlook dark mode viste stadig den gamle navy-plade i en testmail sendt EFTER deploy.

**Rod-årsag:** Billedet blev refereret fra mailen på en stabil URL (`/brand/wordmark-email.png`), og Vercel sender `/brand/*` med `Cache-Control: public, max-age=604800`. Outlooks billed-proxy (og enhver anden mail-proxy) beholder den gamle kopi i op til en uge. En URL der skifter indhold er en fejl i mail-sammenhæng, ikke kun en cache-detalje.

**Bekræftelse:** Testmail 2 med `?v=<hash>` på URL'en gav rent bånd med det samme.

**Fix (#5046):** Indholds-hash i filnavnet (`wordmark-email.<sha256[0:8]>.png`), skrevet af `scripts/build-email-wordmark.mjs` sammen med det genererede modul `backend/lib/emailWordmarkAsset.js`. Skabelonen bygger URL'en derfra. Gamle filer bliver liggende, så allerede sendte mails beholder deres billede.

**Forward-guard:** `backend/lib/emailWordmarkAsset.test.js` fejler hvis filen mangler, hvis hashen ikke matcher bytes, eller hvis nogen skabelon falder tilbage til den uhashede URL.

**Regel fremover:** Alt der refereres fra en mail (billeder, fonte, vedhæftede assets) skal have immutable URL'er. Ny version = nyt filnavn, aldrig samme navn med nyt indhold.
