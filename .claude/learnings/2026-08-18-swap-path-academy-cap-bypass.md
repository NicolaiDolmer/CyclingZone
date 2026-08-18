# Postmortem · 2026-08-18 · Byttehandel omgik akademiets 8-plads-cap

## Hvad skete der?
En byttehandel (swap) mellem to hold kunne flytte en akademi-rytter til modpartens hold uden at røre `is_academy`. Rytteren landede som `is_academy = true` hos modtageren, uden om det 8-plads-loft der ellers håndhæves ved intake/auktion/promote/demote. To uafhængige spillere ramte det (Discord 21/7 og 10/8) — den ene endte på 9/8. En separat EN-i18n-læk ("Drift paid" i akademi-regnskabet) blev rapporteret i samme tråd.

## Root cause
`executeSwapOffer()` i `backend/lib/transferExecution.js` opdaterede kun `team_id`/`pending_team_id` + kontrakt-patch pr. rytter. `is_academy` blev hverken hentet i SELECT'en eller skrevet i UPDATE'en, så feltet fulgte råt med over holdgrænsen — modsat købs-stien (`executeTransferOffer`), som #3650 allerede havde rettet med samme mønster.

EN-i18n-lækken ("Drift paid") var faktisk allerede rettet i en tidligere, urelateret commit (#2925/#2979, `ba2d2926`) — verificeret med `git log -S "Upkeep paid"` og et grep efter "Drift" i alle EN-locale-filer (0 hits). Den del af issuet var forældet på tidspunktet for denne session.

## Fix
`backend/lib/transferExecution.js`, `executeSwapOffer()`:
- SELECT for begge ryttere henter nu `is_academy`.
- Begge sider af swap'et (parkering OG direkte registrering) skriver `offeredGraduatePatch`/`requestedGraduatePatch` — en akademi-rytter graduerer atomisk til `is_academy: false` hos modtageren, samme `graduatePatch`-mønster som #3650 bruger for direkte salg.
- Rollback-stien (når `movedRequested` fejler efter at `offered` allerede er flyttet) nulstiller eksplicit `is_academy` til den oprindelige værdi, så en fejlet swap ikke efterlader sælgeren med en rytter der mistede sin akademi-plads uden at være flyttet.

Regressionstests tilføjet i `backend/lib/transferExecution.test.js` (3 nye, alle grønne): graduation når modtagerens akademi allerede er fuld (8/8 → aldrig 9/8), graduation på BEGGE sider når begge ryttere er akademi-ryttere, og graduation ved parkering (aktivt etapeløb), ikke først ved endelig registrering.

## Forhindret-fremover
Løsningen håndhæver capen strukturelt (en byttet akademi-rytter kan aldrig blive stående som akademi hos modtageren), i stedet for at tilføje endnu et separat kapacitets-tjek der kunne divergere fra #3650/#2701's logik igen. De tre nye tests dækker netop den bug-rapporterede sti (8/8-akademi + indgående swap).

## Læring
Enhver ny anskaffelses-sti for ryttere (køb, swap, auktion, promote/demote) skal eksplicit håndtere `is_academy` — feltet "arver" ellers råt med over holdgrænsen, fordi ingen UPDATE-statement nulstiller det af sig selv. Når et mønster som `graduatePatch` allerede findes ét sted (#3650), er den rigtige fix at genbruge det samme mønster i den nye sti, ikke at opfinde et separat cap-tjek.
