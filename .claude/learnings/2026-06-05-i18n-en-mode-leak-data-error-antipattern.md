# Postmortem · 2026-06-05 · EN-mode i18n-leaks trods grøn key-coverage (`data.error || t()`-anti-pattern)

## Hvad skete der?
En multi-agent audit af #678 ("verify critical flows leak-free in EN-mode") fandt **52 verificerede EN-mode i18n-leaks** — danske strenge der vises til engelske spillere — selvom `i18n-check-keys` var **grøn** (24 namespaces × 2 sprog). 6 var P0 i money-flows (auktion-bud, transfer, board).

## Root cause
`i18n-check-keys` verificerer kun **key-parity** (findes nøglen i begge sprog). Den fanger ikke de to mønstre der faktisk lækker:

1. **Backend returnerer rå dansk `{ error: "..." }`**, og frontend renderer `data.error || t("...")`. Fordi `data.error` altid er sandt når backenden sætter den, **vinder den danske streng altid** — den lokaliserede `t()`-fallback er reelt dødt kode. Samme i `showMsg(\`❌ ${data.error}\`)`. EN-spilleren ser dansk.
2. **Hele sider/komponenter uden `useTranslation`** — al tekst hardcodet dansk i JSX (fx 6 results-sider, `AuctionHistoryPage`, `DeadlineDayBoard`, `OnlineBadge`). Locale-JSON'en var ren; koden bypassede den bare.

Bonus-fund undervejs: `backendMessage.js` importerede `./intl` **uden `.js`** — Vite tilgiver det, men Node's ESM-loader (CI's frontend-build + `node --test`) gør ikke (#803-klassen). Det blokerede en ny unit-test og var en latent CI-fælde.

## Fix
`{ code, params }`-kontrakten fra #666 udvidet til player-facing fejl: backend returnerer additivt `{ error: <legacy DA fallback>, errorCode, errorParams }` (beholder `error` → nul risiko for andre consumers), og frontend `resolveApiError(data, t, fallback)` (`frontend/src/lib/apiError.js`) resolver `errorCode` via `errors:api.*` med locale-aware tal-formatering. Leveret i 4 tracks: auktion (PR #1053), transfer/swap/lån, board+cron, auction-history. `.js`-extension tilføjet i `backendMessage.js`.

## Forhindret-fremover
Forward-guard filet som **#1068**: ny `scripts/i18n-check-leaks.mjs` (CI + pre-commit) med to detektorer — (A) DA-tekst i EN-værdier (EN===DA for natursprog, eller danske stopord/`[æøå]`), (B) hardcodede JSX/backend-strenge uden for `t()`. Indtil den lander er der **ingen** automatisk beskyttelse mod nye leaks — kun manuel review.

## Læring
- **Grøn `i18n-check-keys` ≠ leak-fri.** Key-parity siger intet om EN-værdiens faktiske sprog eller om koden overhovedet bruger `t()`.
- **`data.error || t(...)` er et anti-pattern.** En backend-leveret tekststreng vinder altid over fallback'en → lokaliseringen er død. Backend skal returnere **koder** (`{ errorCode, errorParams }`), aldrig færdig-formateret bruger-tekst; frontend ejer ordlyden.
- **Naiv grep duer ikke til DA-i-EN-detektion** (× … → emoji giver false positives; danske ord uden æøå giver false negatives) — derfor LLM-audit eller en EN===DA-heuristik, ikke en simpel regex.
- Nye relative imports i `frontend/src/lib` SKAL have `.js`-extension (Node ESM), ellers fejler de først i CI/`node --test`, ikke i Vite-build.
