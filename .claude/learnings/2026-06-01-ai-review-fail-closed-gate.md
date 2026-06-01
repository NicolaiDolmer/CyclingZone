# Postmortem · 2026-06-01 · Mandatory AI-review-gate fail-closed på ekstern API i launch-ugen

## Hvad skete der?
AI-Autopilot Fase 2 gjorde Auto-PR-review til et **required, fail-closed** statuscheck (`continue-on-error: false` i `claude-review.yml`). Under sundhedsauditen blokerede gaten to legitime fix-PR'er (#880, #883): review-jobbet fejlede 2× på ~26-30s — ikke på kodekvalitet, men på Anthropic-token-kvote/transient API. Ironisk blokerede gaten endda PR'en der skulle fikse den. (Kvoten kom sig senere, så de samme PR'er passerede ved gen-kørsel.)

## Root cause
En merge-gate gjort afhængig af en **ekstern, kvote-begrænset AI-API**. Når API'et er nede/rate-limited/token udløbet, fejler jobbet → required check rødt → PR umergeligt (kun ejer-override via `enforce_admins: false`). Sekundær bug: workflow-trigger var kun `[opened, synchronize]`, så en draft→ready PR fik aldrig et review-resultat (deadlock), harmløst indtil checket blev required.

## Fix
PR #884 (erstattede #880): `continue-on-error: true` → review er nu **advisory**. De hårde gates er de deterministiske checks (`backend-tests`, `frontend-build`, `dependency-review`). Tilføjede `ready_for_review` + `reopened` triggers. Beslutning truffet med ejer (ikke unilateralt — gaten var Manus' ADR, #877). Bemærk: admin-override af en fejlende safety-gate blev korrekt blokeret af auto-mode-classifieren; normal merge lykkedes da kvoten var kommet sig.

## Forhindret-fremover
Hårde merge-gates skal være **deterministiske og selvstændige** (tests, build, lint, dependency-review). Probabilistiske / eksternt-afhængige checks (AI-review, tredjeparts-API) hører til som **advisory** — eller, hvis mandatory, kun med retry + fail-open-fallback ved infrastruktur-fejl (skeln "API nede" fra "review fandt en fejl"). Især i en launch-uge er en fail-closed ekstern afhængighed en direkte leverance-risiko.

## Læring
Samme meta-mønster som lockfile-drift-false-positive samme dag: forveksl ikke *et signals tilgængelighed* med *det det måler*. En AI-reviews udeblivelse betyder ikke "koden er dårlig" — kun "vi fik ikke en mening". Gate på det du kan stole på deterministisk; lad resten informere, ikke blokere.
