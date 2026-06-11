# 2026-06-11 · Signup-bootstrap race-conditions (#1264)

## Symptom
Load-test (#1174, `docs/audits/2026-06-11-load-test.md`) bekræftede empirisk ved 20 samtidige signups:
1. 3 hold endte med samme navn (3×201 Created).
2. 2 samtidige `PUT /api/teams/my` for samme bruger → 2 hold → `requireAuth`s `.single()`-lookup fejler stille → kontoen fremstår "hold-løs" selvom 2 hold findes. Udløses i prod af dobbeltklik/to faner/netværks-retry i signup-øjeblikket.
3. Bonus: `GET /api/teams/my` var død kode — skygget af `GET /teams/:id` (registreret først, `:id="my"` → 404).

## Rod-årsag
Check-then-insert uden DB-constraint. `teamProfileEngine.js` lavede applikations-side navnetjek (`ilike`) + team-insert som separate roundtrips; `teams` havde hverken UNIQUE på `user_id` eller på navn. Under samtidighed passerer begge requests prechecket før nogen af dem committer. Applikations-tjek kan ALDRIG lukke det vindue — kun databasen kan.

## Fix (PR for #1264)
- Migration `database/2026-06-11-teams-unique-user-and-name.sql`: partial unique `teams(user_id) WHERE user_id IS NOT NULL` + partial unique `teams(lower(name)) WHERE is_ai = false` (AI-hold undtaget: bulk-seedes udenom bootstrap; backwards-check i prod = 0 dubletter).
- `teamProfileEngine.js` håndterer 23505: user_id-konflikt → returnér eksisterende hold (idempotent, ikke 500); navne-konflikt ved insert → bounded retry med talsuffiks (3 forsøg, derefter 409); navne-konflikt ved rename → 409; board-profil-23505 (`UNIQUE (team_id, plan_type)`) → behandles som allerede oprettet.
- Vigtig detalje: ved dobbelt-bootstrap med SAMME navn kan Postgres rapportere navne-indexet FØR user_id-indexet — suffiks-retryet skal konvergere ind i user_id-håndteringen (testdækket).
- Død GET-route fjernet.

## Forward-guard
- 6 nye `node --test`-cases i `backend/lib/teamProfileEngine.test.js` dækker begge konfliktveje + konvergens + bounded-retry-exhaustion; test-doublen kan nu injicere 23505 + samtidige vinder-rækker (`insertErrors`/`updateErrors`).
- Læring til alle fremtidige "findes X allerede?"-flows (auktion, divisions-kapacitet — fund 3 i audit'en): samtidighedskritisk unikhed SKAL bo i DB'en som constraint/index, og applikationen skal håndtere 23505 som forventet udfald, ikke som 500. Precheck må kun være UX-sukker.
- Route-skygge-fælden: Express matcher i registreringsrækkefølge — statiske paths (`/teams/my`) skal registreres FØR parameter-paths (`/teams/:id`), ellers er de stille døde.
