# Sentry smoke-test blev utilsigtet Node test

## Context

#648 viste at `backend-tests` fejlede på main, selv for frontend-only PRs. CI-loggen pegede på `backend/scripts/sentry-smoke-test.mjs`.

## Root cause

Node test-runnerens discovery samler `*-test.mjs` op. Smoke-scriptet er en manuel deploy-verifikation, men filnavnet gjorde det til en unit-CI-test. Uden `SENTRY_DSN` fejlede det derfor hele backend baseline.

## Fix pattern

Når et deploy-smoke-script kan blive samlet op af `node --test`, må det enten navngives uden test-suffix eller eksplicit skippe under Node test-runneren. Brug `NODE_TEST_CONTEXT` / `NODE_TEST_WORKER_ID` eller `npm_lifecycle_event=test` til at kende unit-test-konteksten, ikke `process.execArgv`.

## Verification

- `node --test --import ./test-setup.js scripts/sentry-smoke-test.mjs` uden DSN: pass med SKIP-besked
- `node scripts/sentry-smoke-test.mjs` uden DSN: failer stadig, så manuel deploy-verifikation ikke bliver falsk gron
- `npm test -- --test-reporter=spec`: 742 pass, 0 fail
