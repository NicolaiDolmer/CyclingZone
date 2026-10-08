# Første officielle løbsforberedelse: design-handoff

Issue-ejer: #1140. Måling: #4964/#1369. Ventetid: #5104. Dismiss-rest: #1569. Mail: #2853.

## Status og ejerens ord

- Ekstra introduktionsløb blev afvist: "Vi skal ikke til at forvirre ud af boksen ... urealistisk og for fiktivt".
- Ruten først i spillerens rigtige klub blev accepteret: "Det er okay det kan vi godt prøve".
- Første interaktive ruteskitse: "Det ser fint ud".
- Anbefalingen om egen udtagelse først med hjælp ved behov fik "Okay" og blev brugt til fortsættelsen.
- Seneste samlede prototype er leveret, ikke endeligt godkendt til build. Ejeren ønsker proaktiv færdiggørelse, ikke et spørgsmål om hver lille UI-detalje.

**Ingen build-go.** Morgendagens review skal give samlet design-go og kapacitet. Dette dokument er ikke en ny parallel regel-SSOT.

## Bindende grundlag

Læs og citér [DASHBOARD_RULES](../../DASHBOARD_RULES.md), [PLANNING_CENTER_RULES](../../PLANNING_CENTER_RULES.md), [RACE_ENGINE_RULES](../../RACE_ENGINE_RULES.md), [CALENDAR_RULES](../../CALENDAR_RULES.md), [ASSISTANT_RULES](../../ASSISTANT_RULES.md), [PAGE_TEMPLATES](../../design/PAGE_TEMPLATES.md) og [TASTE](../../design/TASTE.md) før implementering. D-037/D-038 i [GDD-beslutninger](../../design/gdd/DECISIONS.md) er den tidligere retning; denne sessions præcisering af det officielle løb skal indarbejdes efter ejerreview.

## Produktkontrakt

En ny manager forbereder et faktisk kommende officielt løb med egne ryttere. Løbet følger fælles kalender. Ingen kunstig sejr, personlig sandkasse, ekstra belønning eller fiktiv modstander bruges som onboarding.

Første session skal ende med en forstået og gemt beslutning samt forventning om næste hændelse. Den må ikke love, at et officielt resultat nødvendigvis kommer inden samme session.

## Skærme og interaktioner

### 1. Ruten

- Titel: "Din første løbsforberedelse" (DA-review; spillertekster færdiggøres EN først/DA derefter).
- Faktisk løbsnavn, korrekt lokal starttid, etapeantal og løbsdagskontekst.
- Eksisterende profilvisning fra rigtige data, ikke skitsens håndbyggede terrænbar som ny produktionskomponent.
- Én kort sportslig læsning af rutens fakta. Ingen lovet vinder eller opdigtet forklaring.
- Ved etapeløb skal resten af etaperne være synlige/relevante før kaptajnvalg. En flad første etape bestemmer ikke hele løbets kaptajn.
- Primær handling: "Se min trup".

### 2. Kaptajn

- Samlet trupliste med faktiske spiller-visible evner og tilgængelighed fra eksisterende endpoints.
- Spilleren vælger selv. Ingen proaktiv assistent, ingen tavs lagring.
- Skeln kaptajn for løbet fra sprintkaptajn; rollen skal følge den aktive v3/v4-kontrakt, ikke en ny UI-fortolkning.
- Primær handling: "Udtag resten af holdet". Eget kaptajnvalg følger med.

### 3. Egen holdudtagelse

- Én liste: markér ryttere og justér rolle på den valgte rytters række. Bevar samme data på mobil, D-047's tre vigtigste kolonner med resten tilgængeligt.
- Vis udtaget antal mod løbets faktiske maksimum. Ingen antagelse om samme maksimum i alle løbsklasser.
- Kanoniske roller: kaptajn, sprintkaptajn, hjælper, udbrudsjæger, fri rolle; brug eksisterende oversættelser/typer. Unikke roller må ikke duplikeres. Ved rolleflyt vis konsekvensen tydeligt; skitsens automatisk flyttede rolle kræver konkret UX-review.
- Delvis trup er lovlig at gemme efter eksisterende kontrakt. Deltagelsesminimum er ikke en blokering af gemning. Vis faktisk konsekvens/assistenttilstand og reelt ledige ryttere via eksisterende partialSquadOutlook.
- Hjælp er valgfri og spillerinitieret. Genbrug eksisterende indgang; ingen fjerde assistentindgang eller automatisk overskrivning af egne valg.
- Kladden og roller bevares ved tilbage-navigation. Fjernet kaptajn skal håndteres tydeligt.
- Primær handling: "Gennemse udtagelsen".

### 4. Gennemgang og gemning

- Vis løbet/alle etaper, valgte ryttere, roller, mangler og hvad der faktisk gemmes.
- "Ret udtagelsen" bevarer kladden. "Gem holdudtagelse" bruger eksisterende atomiske skrivevej.
- Genvalidér ejerskab, skader, binding/overlap, aktuel race-status/lock og kapacitet server-side. Vis navngiven, handlingsbar fejl. Ingen falsk succes eller tabt kladde ved konflikt/netværksfejl.
- Kvittering kræver serverbekræftelse. Den viser faktisk gemt opstilling, starttid og hvor resultatet kan findes.
- Ingen automatisk Pro-pitch, tvungen Discord eller survey i samme førstehandling.

### 5. Efter første løb

- Vis eksisterende eget resultat og næste konkrete handling, uden at en helt ny analyse-/notifikationsmotor bliver en blocker for første release.
- Forståelige indsatskort/årsagsforklaring følger D-036 og faktisk motoroutput; teksten må ikke opfinde hændelser eller sikker kausalitet.
- Resultatdrevet mail/Discord som selvstændigt næste lag under #2853/D-038, med dedupe, samtykke, afmelding, frekvensloft og korrekte links.

## Hjørnetilfælde der skal designes før build

Ingen kommende udtagelig start; sæsonpause; første løb allerede startet; plan allerede sat af spilleren/assistenten; flere relevante løb; utilstrækkeligt frie ryttere; skade/overlap opstår under redigering; gem fejler; mobil kladde ved route-skift. Løs dem med ærlig tilstand og eksisterende handlinger, aldrig et opdigtet introduktionsløb.

## Visuelt grundlag og begrænsninger

Skitsen brugte et ægte snapshot af Tour du Périgord (flad første, kuperet anden etape) og en eksisterende ny klub. Rutevisning blev godkendt som retning. Skitsen har lokal interaktion, ingen API-writes; den er ikke produktionskode eller en live frontendtest.

De samtaleinteraktive HTML-kilder lå i den tråd-ejede visualizations-mappe (16/9, filerne `foerste-loeb-ruten-foerst.html` og `foerste-loeb-holdudtagelse.html`). De er regenererbare preview-filer, ikke eneste beslutningskilde. Dette dokument bevarer hele designkontrakten på GitHub; næste preview bygges mod faktiske komponenter og ejerens aktuelle testklub. Rå spiller-/evne-snapshot kopieres ikke ind i offentligt repo.

## Verifikationsplan

- Før kode: nye spillere observeres fra landing; test ruteforståelse, kaptajn/sprintkaptajn, egen beslutning og forventning til resultat.
- Foreslået usability-mål: 4/5 gennemfører og forklarer næste skridt uden hjælp. Det er et forslag, ikke en eksisterende kvalitetsgate eller retentionbevis.
- Test-tier: fastlægges efter diff. Backend/delte kontrakter/i18n eller >6 filer betyder FULL efter CLAUDE. Frontend/i18n kræver relevante fulde e2e-krav. Respektér verify-lock.
- Test reelle udfald: korrekt udtagelse og roller, delvis trup tilladt, maksimum/rolleoverlap/ejerskab/skade/binding/lock, atomisk fejl uden tabt kladde, serverbekræftet kvittering.
- Mobil+desktop screenshots/preview og faktisk opgavegennemførelse før merge. Ingen vurdering alene fra tekst eller mockup.
- Mål første manuelle udtagelse, tid til gemning og efterfølgende aktivitet med dokumenteret coverage. Kanonisk D7 og foreslået A14 holdes adskilt. Små før/efter-tal er ikke kausal A/B-evidens.
- Ved implementering: opdatér berørte SSOT'er, FEATURE_REGISTRY hvis kontrakt/kernefeature ændres, patch notes og help EN/DA efter gældende regler.
