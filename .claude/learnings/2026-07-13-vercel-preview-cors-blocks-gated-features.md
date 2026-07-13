# Vercel branch-previews CORS-blokerede alle Express-features (#1875 rod-årsag)

**Dato:** 2026-07-13
**Symptom:** Ejeren åbnede en per-branch Vercel-preview (`cycling-zone-git-<branch>-<hash>-nicolai-dolmers-projects.vercel.app`) for at teste S5 Planneren. Hold/balance/ryttere loadede, men Akademi, Spejder, Klub OG Planneren manglede alle i sidebaren — selvom `academy_enabled`/`scout_system_enabled`/`facilities_enabled` alle er `on` i prod. "Det er svært at finde tingene."

## Rod-årsag
`backend/server.js` CORS brugte en **eksakt-match allowlist**:
```js
app.use(cors({ origin: (origin, cb) => cb(null, !origin || ALLOWED_ORIGINS.includes(origin)), credentials: true }));
```
`ALLOWED_ORIGINS` = cyclingzone.org, www, cycling-zone.vercel.app, localhost. Per-branch/per-commit Vercel-preview-URLs har **tilfældige hashes** og står derfor aldrig på listen → browseren blokerede alle `/api/*`-svar (ingen `Access-Control-Allow-Origin`).

Hvorfor så noget loadede: hold/balance/ryttere kommer fra **Supabase-direkte** reads (Supabase' egen CORS er permissiv). Alt **Express-baseret** (gated-nav-hooks: useFacilities/useScoutingCentral/usePlanner, + enhver ny flade) fejlede stille → featuren skjult. Så et preview så "halvt virkende" ud og gav indtryk af manglende features.

## Fix
`backend/lib/corsOrigin.js` — `isAllowedOrigin(origin, allowedList)`: eksakt allowlist ELLER regex-match mod ejerens Vercel-team-scope (`https://<...>-nicolai-dolmers-projects.vercel.app`). **Team-scope, ikke hele `*.vercel.app`** — kun ejerens eget team kan lave deploys der ender på det trailing segment, så en fremmed Vercel-bruger ikke kan kalde API'et med credentials. Ren + unit-testet (inkl. sikkerheds-cases: fremmed team, http-downgrade, suffix-spoofing).

## Læring (forward-guard)
1. **"Test på preview" ≠ virker på preview.** Når jeg beder ejeren teste et gated/Express-baseret feature på et branch-preview, skal jeg verificere at **backend'en faktisk er nåelig fra den preview-origin** — ikke kun at frontend'en deployer. Supabase-direkte data der loader skjuler at Express-laget er dødt.
2. **Ephemeral preview-URLs kræver scope-match, ikke eksakt-match** i CORS. Enhver ny feature bag Express + flag ville have haft samme usynlighed på previews.
3. Dette er #1875's konkrete mekanik (previews "mangler features") — ikke kun manglende seed-data/mock, men CORS der dræber hele API-laget. Både denne CORS-fix OG `VITE_PREVIEW_MOCK` på preview-env er komplementære veje til brugbare previews.

## Relateret
- #1875 (Vercel preview-env brugbarhed), feedback_owner_must_be_able_to_test_on_preview
- Komplementær: statefuld preview-mock (`plannerMock.js`) for offline-gennemklik uden backend.
