# Morgen 19/9: ejer-kort efter aftenbølgen 18/9 (to "merge"-kort, kalenderformen, slettelisten)

> Forrige session: `docs/audits/night-wave-2026-09-18-aften.md`. Ejeren gik i seng kl. ca. 22:45; runde 2 kørte færdig om natten. Alt internt er merget; alt spillervendt venter på ordet "merge".

## Prompt (kopiér herfra)

Godmorgen. Læs `docs/NOW.md` og `docs/drafts/next-session-prompt-2026-09-19.md` først. Giv mig kortene fra i nat ét ad gangen, kort og i almindeligt sprog, med billedet som FIL i samme tur som spørgsmålet.

## Sådan vil ejeren spørges (bidt hårdt 18/9 aften, se memory)

- ÉT område ad gangen, små simple spørgsmål, 2-4 sætninger, anbefaling først.
- Billeder sendes som fil (SendUserFile), aldrig kun som indlejret widget: de forsvinder for ham. Balancetal → `balance-internals/`, resten → `docs/audits/<dato>-kort/`.
- FIND HVAD DER ER AFTALT før du spørger. Forstår han ikke spørgsmålet: drop historik og jargon, vis ét konkret eksempel.
- Tjek egne skitser mod realisme-reglen (#5267-kommentaren 18/9) før de vises.

## Kort i rækkefølge

1. **#5397 Træningssiden på mobil.** Send `pr-screens/3643-before-after.png` fra PR'en (+ evt. 412 mørk og landskab). Ret FØRST de to småting orkestratoren så: billedteksten bruger ae/oe/aa, og mock-navnet "M. Soerensen". Ejeren har Android. Merge kun på ordet "merge"; derefter done-flip #3643 #4613 #5350 #4982 + træningsdelen af #5124.
2. **#5400 Én besked pr. løb + roligt dashboard.** Send før/efter (`5384-notifications-*`, `5389-midload-*`). Verificér selv at reviewerens to fund er rettet (etapeløbs-beskeder pr. dag bevares; testfil er `.ts`), byg go-kortet på diffen. Merge kun på "merge".
3. **Kalenderformen (#5267).** Tegn en uge for D1 og D4 ud fra `docs/audits/2026-09-18-5267-kalenderform-begge-dele.md` (§4 + eksempel-ugerne): synkroniserede etapeløbs-blokke med træningsdage i hullerne imellem. Sig ærligt at K2 kun er regnet som loft, ikke pakket. Spørg: må jeg bygge en prøvepakning (read-only dry-run) og vise dig den rigtige S4-kalender før noget lægges ind? S4-generering er ÉN gang (§2c), cutover 27-28/9.
4. **Slettelisten (#5399 er merget):** `docs/audits/2026-09-18-branch-opgoerelse.md` + de ca. 870 forældreløse mapper (#4924). Intet slettes uden ejerens ja til listen.
5. **#5383 tekst ud over bokse:** bed om skærmbillederne af "Overget" og den ulæselige danske tekst.
6. **Potentiale-sessionen:** de 6 åbne punkter i `balance-internals/2026-09-18-potentiale-session/det-har-vi-aftalt-om-potentiale.html` (kun lokalt på DOLMERPC). Foreslået efter 28/9, fordi grundreglerne først ændres efter S3 (ejer 28/8). Punkt 6 (fortæl spillerne at 1-99 ikke kommer, eller genopliv den) haster mest kommunikativt.

## Byggespor der er klar til en bølge (når ejeren har svaret)

- **Kalender-prøvepakning K2** (opus, investigate/build bag dry-run) → derefter ombygning af #5169 efter rapportens fix-plan.
- **B4-rettelsen (#5264)** efter realisme-reglen: binding fra `race_entry_days` (inkl. hviledage), løb-ELLER-træning uafhængigt af `race_day_development_enabled`, tick på rene træningsdage. Venter på kalenderformen for den sidste del. B3 (#5281) merges samme dag som flaget tændes.
- **U23-generatoren (spec A6)** oven på `U23_BIRTH_BAND` (#5401). Selve genereringen mod prod er en ejer-gated engangshandling ved cutover.
- **`race_notify_outbox_enabled`-flip:** ejer-only, eget kort, mål på en stor klynge kl. 12 eller 18 med SELECT'en fra #5398's PR-body.
- **wave.js investigate-brief:** lad undersøgelsesspor committe + pushe deres rapportfil (2 af 3 efterlod den utracket 18/9).
- Dependabot #5379 (grøn; merge uden kørende laner + `npm run sync-deps`) og #5356 (ægte byggefejl i marketing).

## Åbent hos ejeren (nævnes én gang)

Post `docs/drafts/discord-patch-notes-2026-09-17.md` og `-09-18.md` · fair-play-session 19/9 (#5203 #5282) · Quad9-aflæsning 19/9 (#5323) · klik "Alle handler" igennem + sæt ét flag til beta · PostHog-tjek efter SDK-skift (#5055) · win-back v2 (#2760/#4592).
