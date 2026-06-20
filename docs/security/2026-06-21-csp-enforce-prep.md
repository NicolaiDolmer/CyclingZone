# CSP enforce-prep (#1462)

> **Status:** PREP — `frontend/vercel.json` forbliver i **`Content-Security-Policy-Report-Only`**.
> Enforce-flip (rename header-key + apply hash + verify på preview + merge) = **EJER-HANDLING**.
> Dato: 2026-06-21. Refs #1462, #1460 (CSP report-only live 2026-06-18), #1578 (WP0 strammede report-only).

---

## Hvad denne prep leverer

1. Et script `scripts/compute-csp-hash.mjs` der beregner `'sha256-…'`-tokenet for det inline theme-bootstrap-script — det ene kendte `script-src`-gap.
2. Denne runbook: præcis procedure for at flippe report-only → enforcing, inkl. report-to-Sentry-overvejelsen og auth-flow-tjeklisten fra #1462.

**Hvorfor ikke bare committe hashen:** en CSP-hash er public by design, men er en høj-entropi-streng der tripper både den lokale `sanitize-secrets`-hook og potentielt CI-`leak-check` (gitleaks). Den committes derfor IKKE i repoet; ejeren genererer den med scriptet i selve enforce-øjeblikket (hashen skal alligevel beregnes fra den **byggede** HTML, fordi Vite kan ændre whitespace).

---

## 1. Inline-script-hash (script-src-gap)

`frontend/index.html` har ét inline executable script: theme-bootstrap-IIFE'en (`localStorage.getItem('cz-theme')` → sætter `data-theme="dark"` før paint, anti-flash). Under enforcing CSP uden `'unsafe-inline'` i `script-src` ville det blokeres, så det skal whitelistes via sin sha256.

**Procedure (ejer, ved enforce):**
```sh
cd frontend && npm run build && cd ..
node scripts/compute-csp-hash.mjs          # læser frontend/dist/index.html
```
Scriptet printer ét eller flere `'sha256-…'`-tokens. Indsæt dem i `script-src` i `frontend/vercel.json` **sammen med** de eksisterende kilder (`'self' https://www.googletagmanager.com https://*.clarity.ms`). Behold IKKE `'unsafe-inline'` i `script-src` ved enforce (det ophæver hash-beskyttelsen).

> JSON-LD-blokken (`type="application/ld+json"`, structured data) eksekveres ikke og gates ikke af `script-src` — den kræver ingen hash.

---

## 2. report-to / report-uri → Sentry

**Begrænsning:** Sentry-DSN'en er env-only (`VITE_SENTRY_DSN`, se `frontend/src/lib/sentry.jsx:9`) — den er IKKE committet, og `vercel.json`-header-værdier er statiske (ingen env-substitution). At tilføje en Sentry-`report-uri` kræver derfor at den public DSN-afledte endpoint-URL skrives literal ind i `vercel.json`.

Sentrys CSP-report-endpoint har formen (afled fra DSN — `https://<PUBLIC_KEY>@<ORG>.ingest(.de).sentry.io/<PROJECT_ID>`):
```
report-uri https://<ORG>.ingest.de.sentry.io/api/<PROJECT_ID>/security/?sentry_key=<PUBLIC_KEY>
```
(moderne `report-to` kræver desuden en `Reporting-Endpoints`-header; `report-uri` alene virker bredest i dag.)

**[EJER-BESLUTNING]** to muligheder:
- **(a) Tilføj report-uri:** indsæt den public endpoint-URL i `vercel.json`. `*.ingest(.de).sentry.io` er ALLEREDE i `connect-src`, så domænet er ikke nyt; men `sentry_key` er en høj-entropi-værdi → tilføj en gitleaks-allowlist-entry (`.gitleaks.toml`) for præcis den linje, ellers fejler `leak-check`. Central violation-opsamling i Sentry.
- **(b) Drop report-uri:** behold blot report-only's browser-console-rapportering ved enforce-verifikation. Enklere, ingen leak-friktion, men ingen central opsamling.

Anbefaling som prep (ikke beslutning): start uden report-uri (b) for at undgå leak-friktion; tilføj (a) først hvis violation-volumen ved enforce gør central opsamling nødvendig.

---

## 3. Krav FØR enforce (fra #1462 — ejer verificerer i report-only)

- [ ] Test ALLE authenticated flows i report-only og fang manglende origins i console/violation-rapporter: **draft · auction · race-view · admin · notifications · settings**. (Public landing er allerede ren — 0 console-errors.)
- [ ] Bekræft inline-script-hash dækker theme-bootstrappet (kør scriptet §1).
- [ ] Tag report-to-beslutningen §2.
- [ ] Verificér den nuværende allowlist stadig matcher prod-trafik. **NB:** #1578 (WP0) strammede report-only — fjernede `https://fonts.googleapis.com` (style-src) og `https://fonts.gstatic.com` (font-src), fordi DM Sans nu er self-hosted. Den nuværende `vercel.json` er altså strammere end #1462's reference-allowlist; bekræft ingen font fra Google længere hentes (DevTools → Network).

## 4. Flip-procedure (ejer)

1. Anvend §1-hash + (evt.) §2-report-uri i `frontend/vercel.json`.
2. Rename header-key `Content-Security-Policy-Report-Only` → `Content-Security-Policy`.
3. Deploy til **preview** (ikke prod). Klik hele appen igennem (auth-flows §3). 0 blokerede ressourcer i console.
4. Først derefter merge til prod. Rollback = rename tilbage til `-Report-Only`.

---

## Afgrænsning

Denne prep ændrer INTET i `vercel.json` (forbliver report-only). Den leverer kun værktøjet (hash-script) + proceduren. Selve enforce-flip + hash-apply + report-uri-beslutning er ejer-handlinger, jf. #1462 og natbølge-grænsen (ingen prod-flag-flips uden ejer).
