# Postmortem · 2026-05-27 · Blank crash fallback

## Hvad skete der?
Brugere kunne ende på en tom beige/hvid skærm efter klik i appen, især omkring lazy-loaded routes som `/team`. Skærmen lignede en hængt side, fordi den globale frontend error fallback ikke viste tekst eller recovery-handling.

## Root cause
`frontend/src/lib/sentry.jsx` havde en Sentry ErrorBoundary fallback der kun renderede en tom `min-h-screen bg-cz-bg` div. Stale browser-tabs efter Vercel deploys kunne desuden ramme gamle Vite chunk-hashes og udløse dynamic import-fejl, som blev skjult af samme blanke fallback.

## Fix
Sentry fallbacken viser nu en DA/EN fejlside med genindlæs-knap og event-id, og chunk-load errors tagges som `chunk_load_error`. `frontend/src/lib/chunkErrors.js` detekterer stale chunk-fejl og forsøger højst én sessionStorage-gated reload pr. release.

## Forhindret-fremover
`frontend/src/lib/chunkErrors.test.js` dækker Vite dynamic-import failures, module MIME-type failures, non-chunk render errors og reload-loop guard.

## Læring
Error boundaries må aldrig have tomme fallbacks i production. Selv når observability fanger fejlen, skal brugeren have en forklaring og en recovery-knap.
