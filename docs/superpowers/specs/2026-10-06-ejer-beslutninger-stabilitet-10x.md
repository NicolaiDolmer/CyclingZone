# Ejer-beslutninger 6/10: stabilitet, 10x og tempo

Truffet i Claude-session 6/10 efter to Supabase-udfald (12:59 og 15:21). Gælder indtil ejeren ændrer dem. Hændelse og evidens: #5878 (kommentar 6/10).

**Princip (ejer):** alle valg prioriterer langsigtet værdi, høj kvalitet, professionalisme og best practice; udfordr status quo; projektet skal kunne håndtere 10x brugere. Driftsomkostninger skal minimeres, men kun når stabiliteten er sikret: databasen må ikke gå ned. Når der er ro, er nye spillere igen prioritet nr. 1.

| # | Emne | Beslutning | Hvornår |
|---|---|---|---|
| 1 | Tailwind 4 | Byg i uge 42 (13.-17/10), merge senest fre 17/10, frontend-frys fra 18/10 til efter sæsonskiftet 25/10. Gate: browserversion måles i Sentry; er andelen under Safari 16.4 / Chrome 111 over 1 %, venter vi til efter 25/10 | Måling nu, byg uge 42 |
| 2 | PostHog | Variant A: EU-cloud, sidevisninger + login-identitet + kerne-rejsen (signup → hold oprettet → første bud → første løb med egen trup → første træning → tilbage dag 2/7), ét dashboard med D1/D7. Session-optagelser bliver i Clarity | Denne uge (41), start 6/10 |
| 3 | Privatliv | PostHog uden cookies før login (memory-persistence); identify efter login. Intet nyt samtykke-banner | Med #2 |
| 4 | Worker-service | Mål først API-svartider omkring etape-tick (hele timer). Tydeligt langsommere ved tick → byg separat worker (crons + lås pr. job) i uge 42 med rulle-tilbage-plan; ellers uge 44 som 10x-fundament | Måling nu |
| 5 | DB-alarm | Ekstern overvågning (Better Stack/UptimeRobot) af nyt /api/health med rigtig DB-forespørgsel hvert minut; push + Discord efter 2 fejlede minutter. Ejer opretter konto | 7/10 |
| 6 | Database 10x | (a) connection pooling i transaktionstilstand + (b) caching af fælles data (ranglister, kalender, rytterdatabase) i uge 43-44; (c) læsereplika først når målinger viser behov | Uge 43-44 |
| 7 | Lasttest | "10x" = 10 × dagens peak (måles fra edge-loggen). Lasttest på staging (#5904) før 25/10 og ved hver større release; fejl = release-blokering | Mål nu, test uge 42 |
| 8 | Tempo / merge-regler | Hard rule 35 udvides: merges UDEN go-kort ved grøn CI + rent uafhængigt review: (1) motorændringer bag en SLUKKET regel-revision, (2) ops/CI/infra uden spillertekst, (3) Dependabot-sikkerhedsbump. Go-kort fortsat på alt spillervendt, økonomi/balance, data-ændrende migrationer og at tænde noget | Gælder fra 6/10 |
| 9 | Regnekraft | Prod på Medium (opgraderet 6/10 15:51). Bliv på Medium indtil #5692 + indekser er landet og databasen har været stabil; derefter ned igen, når ugentlig måling af hukommelse/CPU viser det sikkert. Mål: optimér databasen, så de høje udgifter ikke er nødvendige | Ugentlig måling |
| 10 | Rytme | Ingen udskydelse til i morgen af det, der kan laves i dag. Arbejdet fortsætter 6/10 i ny session. Udskudt af ejeren selv: DB-alarm, #6248 maks +1 (langsigtet model, A/B), #6156 form | Løbende |

## Andre beslutninger 6/10
- `orders_gc_v3` tændes IKKE endnu; analysen laves først, når de relevante PR'er er merget (ejer).
- Nedkørsels-ankeret under v3 måler ejerens regel (≤1,5 s/km og ≤50 %), #6257/#6260.
- #6249: kun scout-stierne; anlæg/staff/akademi i #6261-#6264.
- Dependabot #63 (postcss-selector-parser) løses med Tailwind 4 (#6271); Dependabot-PR #6268 (Tailwind 3→4) lukket.
- Feature-liveness-auditten må aldrig tælle prod-tabeller ved PR-push (#6267).
- Roadmap-flip må køres af Claude, ejeren informeres hver gang.
