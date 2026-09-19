# Aftenbølge 2026-09-17

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 16:30 → ca. 21:00 |
| Agenter launched / fuldført / døde | 23 + 4 (rating-spor) / 27 / 0 |
| PR'er åbnet / merged | 13 / 12 (inkl. patch note #5353, c7c7af5d6) |
| Issues → claude:done | #5085 #5004 #5253 #5286 #5291 #5224 #5015 #5017 #5088 #5302 #4873 #4861 #5322 #5223 #5326 #5094 #4123 #5272 (+ #5321 ved merge) |
| Lukket som allerede lavet (bølge 0) | #4645 |
| Nye issues oprettet | #5348 #5349 (Holdarbejde/Lederskab i motoren) · #5350 (træningsside mobil) · #5351 (rating-fald, beslutning) |
| gh-401-retries | 0 observeret |
| Recoveries | 0 (ingen frys, ingen dirty worktrees) |
| Preflight | GO kl. 16:31 (.codex.local/night-wave-preflight.json), keep-awake PID 952 |

## Forløb

- **Bølge 0 (ejer-krav):** 52 issues forfiltreret read-only af to sonnet-agenter FØR byg (`2026-09-17-aftenboelge-precheck.md`). 1 LAVET, 11 DELVIST, resten IKKE LAVET. Fire retningsskift fanget (#5017, #4582, #5177, #4123).
- **Bølge 1+2 i ét wave.js-kald:** 10 spor, 4 laner, 0 frys. 8 merget under bølgen (merge-queue, én ad gangen, done-flip PR-for-PR), 2 åbne ved bølgeslut (#5346 rating-planlægger, #5347 kalender-gate → merget 19:30).
- **Ejer-drevet indskud kl. 18:40-20:15:** rating-forskellen (#5321) viste sig at være bredere end issuet: `Number(null) === 0` i `ratingForRole` + fire nye display-vægte fra 15/9 gav 41 vs 44 for samme rytter afhængigt af hvilke kolonner fladen hentede. Ejer-beslutning kl. 19:35: vægte ud igen, NULL er ikke 0, golden-guard, og bindende rækkefølge (nye evner i opskriften først i samme deploy som #5268). Bygget som eget ét-spors wave.js-kald (PR #5352).
- **Discord:** Infisical-login var udløbet; ejeren loggede ind kl. 18:50, sweep kørt, aftenens rating-tråd læst og lagt på #5321.

## Merget (squash)

| PR | Issues | SHA |
|---|---|---|
| #5339 | #5085 #5004 | 0875e71ab |
| #5338 | #5253 #5286 | bca5a5496 |
| #5341 | #5291 #5224 #5015 #5017 | 189c0f786 |
| #5343 | #5088 (migration, post-verificeret) | 87486313a |
| #5340 | #5302 #4873 #4861 | 041af1321 |
| #5342 | #5322 | 72234bd53 |
| #5345 | #5223 | 277a9ef02 |
| #5344 | #5326 #5094 | cc473d9c1 |
| #5347 | #4123 #5272 | a963be2bd |
| #5352 | #5321 (rating) | 5ee8d38e0 |
| #5346 | #5321 (planlægger/træning) | dbfc40182 |

## Afvigelser/læringer

- **Mobile-webkit-flaken (#4925) ramte 3 PR'er** (seo-public-routes, race-selection, transfers-deadclick; React #418). Rerun hver gang, aldrig fix. Kostede ca. 15 min pr. PR.
- **Cron-vækning afvist af classifieren;** Monitor-værktøjet med 90 s poll på `gh pr list` fungerede som orkestrator-puls og gav merges undervejs (PR-loftet holdt).
- **Hook-PR (#5344) holdt tilbage til alle laner var færdige,** fordi den ændrer pre-commit for alle worktrees. Rigtigt valg: ingen lane brød.
- **Bølge 4-5 (ejer-go-features) ikke nået:** ejer-indskuddet om ratingen fyldte aftenen. Ikke en fejl; det var det der brændte.
- **Læring til postmortem:** en ny evne i display-opskriften med NULL-værdier var en usynlig rating-ændring for alle spillere. Guard (golden fixture) + HOWTO-regel lukker klassen.

Refs #605 #627 #5142.
