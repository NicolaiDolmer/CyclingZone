# Staff-navnepulje del 2: kombinatorik + dedup-backfill (#2657, følger #2643 → #2658)

## Kontekst
`.claude/learnings/2026-07-18-staff-name-pool-birthday-collisions.md` dokumenterer
rod-årsagen (birthday-paradox på en fast navneliste) og #2658's midlertidige fix
(pulje 40→150). #2657 var opfølgningen: en fast liste har ALTID et loft uanset
størrelse — 150-puljen målte stadig ~35% kollisionsrate ved prod-skala.

## Fix
1. **Kode** (`backend/lib/staffCandidates.js`): erstattet `STAFF_NAME_POOL` (fast
   liste) med fornavn×efternavn-kombinatorik fra `fictionalRiderNames.NAME_CLUSTERS`
   (samme kilde/stil som rytter-generatoren — genbrug, ingen ny navne-vedligeholdelse).
   Cluster vælges FØR fornavn/efternavn, så par forbliver kulturelt konsistente.
   ~7.300 kombinationer (mod 150) → målt ~0% kollisionsrate ved 60 hires, ~5% ved
   200 hires (sim 2026-07-19), ned fra 75-78% på den oprindelige 40-navns-pulje.
2. **Backfill** (`database/2026-07-19-staff-name-dedup-backfill.sql`): idempotent
   PL/pgSQL DO-blok der omdøber duplikat-navne blandt AKTIVE team_staff-rækker
   (globalt unikt pr. navn, ikke kun pr. hold) — ældste række beholder navnet,
   yngre rows får et nyt navn fra en lokal 24×24-kombinatorisk pulje, tjekket
   deterministisk mod live-tabellen pr. forsøg (md5-hash af id, ikke Math.random).
   Fyret staff (`status='fired'`) røres bevidst ikke (historisk audit-trail).

## Verifikation
Ingen live Postgres tilgængelig i denne session — verificeret med PGlite-harnessen
(samme mønster som `backend/lib/testdb/createTestDb.js`): loadede `schema.sql` +
`2026-07-05-facilities-staff-foundation.sql`, seedede 6 duplikat-navne-scenarier
(inkl. en fired-duplikat), kørte migrationen 2×. Resultat: alle aktive navne
globalt unikke efter kørsel 1, fired-rækken uændret, kørsel 2 = no-op (samme navne).

## Læring
1. **En fast pulje er ALDRIG "stor nok" — kun midlertidigt stor nok.** Enhver
   uafhængigt-trukket pulje med et fast loft rammer birthday-paradox igen ved
   nok skala. Kombinatorik (fornavn × efternavn, evt. × cluster) er den
   strukturelle fix; en større liste er kun en udskydelse (som #2658 var, med
   vilje — den var et hurtigt content-only stop-gap).
2. **Genbrug eksisterende navne-infrastruktur på tværs af generatorer.** Staff
   havde sin egen kuraterede liste; rytter-generatoren havde allerede regionale
   clusters med langt større kombinationsrum. At pege staff-generatoren på samme
   kilde fjerner en hel vedligeholdelses-byrde uden at duplikere navnedata.
3. **Deterministiske seed-fixtures reshuffler ved enhver ændring af RNG-forbrugs-
   mønsteret** (ikke kun ved pulje-størrelse) — `pickStaffName` bruger nu 3
   `rand()`-kald pr. forsøg mod 1 før, hvilket ændrede alle downstream-drawn
   selv ved samme teamId/season/role. `scoutingFacilityIntegration.test.js`
   krævede re-seed (samme symptom som ved #2658, forudset i forrige learnings-fil).
4. **Backfill-SQL kan bruge md5-baseret pseudo-tilfældighed + live-EXISTS-retry**
   til deterministisk, kollisions-sikker navnetildeling i en PL/pgSQL-løkke uden
   at afhænge af `random()` (reproducérbart ved re-kørsel, og hver iteration ser
   forrige iterations UPDATE inden for samme transaktion).
