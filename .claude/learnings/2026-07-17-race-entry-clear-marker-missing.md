# Postmortem · 2026-07-17 · Auto-udtagelse for hele sæsonen + ryddede trupper kom tilbage (#2599)

## Hvad skete der?
Spillere rapporterede i Discord (17/7) at deres race-trupper var blevet auto-udtaget for
RESTEN AF SÆSONEN uden de selv havde valgt det, og at en trup de manuelt havde ryddet
kom tilbage kort efter. Bobby (@bobby2106) kvitterede issuet som HIGH.

## Root cause
To sammenhængende ting, ingen af dem en regression fra 17/7 — begge har eksisteret siden
#1810/#2375 (Fase 0b):

1. **Bredt scope, ikke en bug:** `runRaceEntryGeneratorSweep` (backend/lib/raceEntryGeneratorSweep.js)
   kalder `runRaceEntryGenerator` for HELE sæsonens løb (ikke kun nærtstående dage), og kører
   både hver time (`setInterval(60min)`, backend/cron.js:1132-1135) OG umiddelbart ved hvert
   deploy-boot (linje 1146). Flaget `auto_entry_generator_enabled` er `on` i prod siden
   2026-06-23. Verificeret mod prod (read-only): 8.841 auto-udfyldte entries på tværs af 126
   RIGTIGE (ikke-AI) hold for 173 fremtidige, ikke-startede løb — helt efter design, men
   overraskende for spillere der ikke havde bedt om det for løb langt ude i sæsonen.

2. **Den egentlige bug:** en tom `race_entries`-mængde for (race,team) var UMULIGT at skelne
   fra "aldrig rørt". `raceSelection.js`'s `validateSelection` sagde det ligeud i en kommentar:
   "en tom trup = ren auto-udtagelse". Når en spiller fjernede alle ryttere (drag/drop eller
   enkeltvis) og gemte, blev raden for `is_auto_filled=false` prostet — INGEN rækker tilbage.
   Næste generator-tick (op til en time senere, eller straks ved næste deploy) så ingen manuel
   entry og fyldte truppen ud igen, som om spilleren aldrig havde rørt den.

## Fix
- Ny tabel `race_entry_clears (race_id, team_id, cleared_at)` (database/2026-07-17-race-entry-clears.sql,
  committed — IKKE anvendt af denne session, jf. migration-policy) — et eksplicit "spilleren
  har bekræftet en ryd-handling"-signal, adskilt fra den ambivalente "tom udtagelse".
- `backend/lib/raceEntryGenerator.js`: generatoren springer nu en (race,team)-enhed over hvis
  den har en clear-markering OG ingen manuelle entries (mirror afmeldings-skip-mønsteret).
- Nye knapper "Ryd dag" / "Ryd alt" (backend/routes/api.js: `POST /races/distribution/clear`,
  frontend: `AvailableRidersPool.jsx` + `RaceHubBoard.jsx`) med `window.confirm`-dialog —
  rydder ALT (inkl. manuelle, det er pointen) og skriver clear-markeringen.
- "Rebuild all"-knappen (tidligere `mode=all`-overskrivning der selv fyldte AI-forslag ud
  over spillerens valg) er erstattet af "Ryd dag": rydder til TOM i stedet for at gætte.
  Spilleren vælger derefter selv Auto-fill ELLER manuel udtagelse.
- Markeringen slettes automatisk igen ved en manuel udtagelse (≥1 rytter, raceSelection.js)
  eller et spiller-initieret auto-fill/udfyld-manglende (regenerate-endpointet) — først da må
  generatoren fylde ud igen.

## Ikke gjort (ejer-beslutning, se ownerFlags i PR)
- Prod-cronen (`auto_entry_generator_enabled`) er IKKE slukket — den er bevidst designet
  bredt (Fase 0b), og at slukke den er en produkt-beslutning, ikke en bugfix.
- De 8.841 eksisterende auto-udfyldte entries (126 rigtige hold) er IKKE datarepareret —
  det ville kræve at vide hvilke der reelt var "cleared" af spilleren vs. aldrig rørt, hvilket
  historikken ikke indeholder (rækkerne blev prostet uden spor). Flagged til ejer.

## Forhindret-fremover
- Regressionstest i `raceEntryGenerator.test.js`: en clear-markering uden manuel entry
  regenereres ALDRIG; en manuel entry overstyrer altid en (stale) clear-markering.
- Pure-funktion `partitionClearTargets` (raceDistribution.js) + dækning i
  `raceDistribution.test.js`.

## Læring
"Tom" er ikke det samme som "spilleren har bekræftet at den skal være tom" — når et system
har en bred, periodisk baggrunds-handling (cron/sweep) der genopfylder tomme tilstande, skal
en eksplicit brugerhandling ALTID efterlade et separat, holdbart spor (ikke bare fraværet af
data), ellers optræder baggrunds-handlingen som om brugerens valg aldrig skete. Samme
mønster som `race_withdrawals` — en global "spring over"-markering — men denne gang skulle
den være pr. (race,team), ikke pr. race.
