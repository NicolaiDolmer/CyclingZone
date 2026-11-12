# Cycling Zone i Google Play: vejledning til ejeren

> Refs #6584. Skrevet 12/11/2026. Alt det tekniske er forberedt, så du kun skal (1) oprette en Google Play-udviklerkonto og (2) trykke "send til gennemsyn". Dette er trin for trin, i den rækkefølge du skal gøre det.
>
> **Forklaring:** appen er en tynd Android-skal (Trusted Web Activity) om cyclingzone.org. Det er det samme spil og den samme kode som i browseren. Detaljer om pakken: [`android-twa/README.md`](../../android-twa/README.md). Butiksteksterne: [`play-listing/`](play-listing/README.md).

## Blokeringer og beslutninger FØR du sender noget (læs først)

**1. Sletning af konto findes ikke som selvbetjening. Det er en blokering.**
Google kræver, at en app hvor man opretter konto, har (a) en sti i appen til at slette kontoen og dens data, og (b) et offentligt weblink hvor man kan anmode om sletning uden at skulle geninstallere appen. Linket skrives i dataformularen, og formularen skal være udfyldt allerede til den lukkede test. ([Googles regler om kontosletning](https://support.google.com/googleplay/android-developer/answer/13327111), læst 12/11/2026.)
Det findes i dag:
- Privatlivspolitikken (https://cyclingzone.org/privacy-policy) siger, at sletning anmodes via Discord eller e-mail fra Hjælp-siden. Det er ikke en dedikeret sletningsside, og der er ingen sti i appen.
- Sletning af en bruger findes kun som admin-funktion i backend (`DELETE /api/admin/users/:userId`), ikke til spilleren selv.
Der er altså hverken en adresse jeg kan skrive i formularen, eller en sti i appen. Jeg har ikke opfundet en side. **Der skal bygges** en selvbetjent "slet min konto" i appen og en offentlig side med sletningsanmodning. Det rører reglen om ikke at hårdslette beviser (#3233, #5032), så det skal designes først. Forslag: nyt issue, bygges før den lukkede test starter.

**2. Pro og Googles betalingspolitik: du skal vælge A, B eller C.**
Pro er en digital funktion. Google kræver som udgangspunkt Google Play Billing for den slags og forbyder at henvise til andre betalingsmetoder i butiksteksten, i appen, i knapper og i tilmeldingsflows (undtagelser for visse lande og programmer findes). ([Googles betalingspolitik](https://support.google.com/googleplay/android-developer/answer/9858738), læst 12/11/2026.) Designet i `docs/superpowers/specs/2026-10-13-6584-push-og-twa-design.md` §6.3 anbefaler **A: intet køb i Play-appen**: Pro-knapper og henvisninger skjules, når spillet kører som Play-app. Det er **ikke bygget endnu**: det kræver en lille detektion af Play-appen i frontend. Uden det vil appen vise Pro-køb, og det kan give afvisning eller suspension af appen. Butikstekstens Pro-sætning er skrevet til model A (nævner at Pro findes, men ikke pris eller hvor man køber).
Beslutning til dig: A (anbefalet, 0 kr., ingen ny integration), B (Play Billing via Digital Goods API, Googles servicegebyr, ny integration) eller C (EØS alternativ fakturering, ansøgning, mere kompleksitet). Skal være afgjort og bygget før produktion.

**3. Appen kræver login, så Google skal have en test-konto.**
Under "App access" i Play Console skal du give gennemseren et login. Brug en dedikeret konto (fx en af de oprettede test-konti, se `docs/TESTING.md`), aldrig din egen. Oplysningerne skrives kun i Play Console, aldrig i repoet.

**4. Målgruppe.**
Vilkår og privatlivspolitik fastsætter ingen mindstealder. Vælg en målgruppe der ikke indeholder børn under 13 (så udløses Googles Families-krav ikke). Forum og beskeder mellem spillere gør, at indholdsvurderingen skal besvares ærligt om brugerskabt indhold (se punkt 8).

**Det der er i orden:**
- Privatlivspolitik: https://cyclingzone.org/privacy-policy (engelsk), https://cyclingzone.org/privatlivspolitik (dansk). Begge er offentlige og forudgenereret som statiske sider. Brug den engelske adresse i Play Console.
- Kontakt-e-mail til butiksiden: support@cyclingzone.org (står i Hjælp-siden).

## Hvad koster penge, og hvad tager tid

| Hvad | Pris | Tid | Kilde |
|---|---|---|---|
| Google Play-udviklerkonto | **25 USD, én gang** (kort) | Oprettelse nogle minutter | [Googles hjælp](https://support.google.com/googleplay/android-developer/answer/6112435) |
| Identitetsbekræftelse (billed-id) | Gratis | Google angiver cirka 3 hverdage. Du kan ikke udgive før den er færdig | Samme hjælpeside |
| Lukket test | Gratis | **Mindst 12 testere, tilmeldt uafbrudt i 14 dage** (gælder nye personlige konti) | [Googles hjælp om testkravet](https://support.google.com/googleplay/android-developer/answer/14151465) |
| Ansøgning om produktionsadgang efter lukket test | Gratis | Google siger normalt 7 dage eller mindre, nogle gange længere | Samme side |
| Gennemsyn af selve appen | Gratis | Google garanterer ingen tid. Regn med dage, ikke timer | |
| Pro-betalingsmodel B eller C | Googles gebyr pr. salg + udviklingstid | Uger | Se punkt 2 |
| Organisationskonto i stedet for personlig | Gratis at ansøge, men kræver D-U-N-S-nummer | Kan tage uger. Undgår testkravet (12 testere), men er et ejer-valg | [Googles hjælp om kontotyper](https://support.google.com/googleplay/android-developer/answer/10788890) |

Ingen nye løbende udgifter: kontoen er en engangsbetaling, og appen koster intet at drive (spillet kører som i dag på Vercel og Railway).

## Googles krav, slået op 12/11/2026

| Krav | Værdi | Kilde |
|---|---|---|
| Target API-niveau | Nye apps og opdateringer skal målrette Android 16 (API 36) eller højere fra 31/8/2026 | [developer.android.com](https://developer.android.com/google/play/requirements/target-sdk) |
| Bubblewrap | Version 1.25.0 eller nyere bumper target til 36 (nyeste set: 1.27.0) | [Bubblewrap-udgivelser](https://github.com/GoogleChromeLabs/bubblewrap/releases) |
| Digital Asset Links | Filen skal ligge på `/.well-known/assetlinks.json` på domænets rod og være offentlig og i klartekst | [Googles Digital Asset Links](https://developers.google.com/digital-asset-links/v1/getting-started), [Chromes TWA-guide](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide) |
| Dataformular | Skal udfyldes for alle apps i lukket test, åben test eller produktion, og kræver et privatlivspolitik-link | [Googles hjælp](https://support.google.com/googleplay/android-developer/answer/10787469) |
| Indholdsvurdering (IARC) | Spørgeskema i Play Console, kræves for nye apps | [Googles hjælp](https://support.google.com/googleplay/android-developer/answer/9859655) |
| Kontosletning | Sti i appen og weblink, linket i dataformularen | [Googles hjælp](https://support.google.com/googleplay/android-developer/answer/13327111) |
| Skærmbilleder | Mindst 2 på telefon, hver side 320 til 3.840 px, længste side højst 2 gange korteste | [Googles hjælp](https://support.google.com/googleplay/android-developer/answer/9866151) |

## Trin for trin

### Trin 1. Opret udviklerkontoen (dig, 25 USD)

1. Gå til Google Play Console (play.google.com/console) og log ind med den Google-konto, der skal eje appen. Brug en konto du vil beholde: den kan ikke flyttes let.
2. Vælg kontotype. **Personlig** er hurtigst og kræver kun navn, adresse, e-mail og telefon, men har testkravet (12 testere, 14 dage). **Organisation** (Dolmer Digital) kræver D-U-N-S og undgår testkravet. Anbefaling: personlig, og brug Discord-testerne til den lukkede test.
3. Betal 25 USD med kort.
4. Gennemfør identitetsbekræftelsen (Google beder om billed-id og kan bede om bekræftelse af telefon og e-mail). Vent til den er godkendt. Kan den ikke godkendes, kan du ifølge Google bede om at få gebyret tilbage.

### Trin 2. Byg AAB-filen (en maskine med JDK og Android-værktøjer)

Følg [`android-twa/README.md`](../../android-twa/README.md). Kort: opret en upload-nøgle uden for repoet, kør `bubblewrap build`, få `app-release-bundle.aab`. Tjek at target er 36 eller højere. **Gem upload-nøglen og kodeordet i adgangskodemanageren**, og aldrig i repoet.

### Trin 3. Opret appen

1. Play Console: "Opret app". Navn: **Cycling Zone: Cycling Manager** (30 tegn, fra `play-listing/en/title.txt`). Standardsprog engelsk. Type: Spil. Gratis.
2. Kategori: Spil, typen Sport (eller Simulation, dit valg).
3. Erklæringerne ("Declarations") besvares ærligt. Annoncer: nej (spillet viser ingen reklamer; privatlivspolitikken siger at annoncesignaler er slået fra). In-app køb: **nej** under model A, ellers ja.

### Trin 4. Upload AAB (Play App Signing)

1. Opret en udgivelse i **Lukket test** (ikke produktion): upload `app-release-bundle.aab`.
2. Accepter **Play App Signing** (standard for nye apps). Google opbevarer så app-nøglen, og du har kun upload-nøglen. Mister du upload-nøglen, kan den nulstilles i Play Console.
3. Pakkenavnet er `org.cyclingzone.app` og **kan ikke ændres bagefter**. Er du i tvivl, så sig det før første upload.

### Trin 5. Sæt SHA-256-fingeraftrykket ind (så adresselinjen forsvinder)

Uden dette virker appen, men viser en adresselinje ("Custom Tab").

1. Play Console, appens side "App signing" (under app-integritet, menunavne ændrer sig, søg "App signing"). Kopiér **SHA-256 certificate fingerprint** under **App signing key certificate** (ikke "Upload key certificate").
2. Åbn `frontend/public/.well-known/assetlinks.json` og erstat `REPLACE_WITH_SHA256_OF_PLAY_APP_SIGNING_KEY` med fingeraftrykket (store hex-par med kolon, 32 par).
3. Commit og merge (eller bed Claude om det). Efter deploy skal `https://cyclingzone.org/.well-known/assetlinks.json` svare 200 som JSON, og `node scripts/check-cdn-cache-headers.mjs` skal være grøn.
4. Installér appen fra den lukkede test på en telefon. Ingen adresselinje = verificeret.

Chromes guide nævner upload-nøglens fingeraftryk. Med Play App Signing er det Googles app-nøgle, der signerer den installerede app, så det er den, der skal i filen. Vil du også se fuld skærm på en lokalt installeret APK, så skriv upload-nøglens fingeraftryk ind som nummer to i samme liste.

### Trin 6. Butiksside

1. Titel, kort og fuld beskrivelse: kopiér fra `play-listing/en/` (engelsk) og tilføj dansk fra `play-listing/da/`.
2. Appikon: `frontend/public/icons/icon-512.png` (512 x 512).
3. Feature graphic: `play-listing/feature-graphic-1024x500.png`.
4. Skærmbilleder: tag dem efter [`play-listing/README.md`](play-listing/README.md) (6 stk., 1080 x 2160). Tjek at ingen andre spilleres navne er synlige.
5. Kontakt-e-mail: support@cyclingzone.org. Privatlivspolitik: https://cyclingzone.org/privacy-policy.

### Trin 7. Dataformularen ("Data safety")

Formularen findes under "App content". Svarene herunder er hentet fra privatlivspolitikken (https://cyclingzone.org/privacy-policy, opdateret 6/10/2026). **Du er ansvarlig for at svarene er rigtige**, og Google kontrollerer dem ikke på forhånd, men forkerte svar kan give afvisning. Tjek dem mod politikken, hver gang den ændres.

| Spørgsmål | Svar |
|---|---|
| Indsamler appen data? | Ja |
| Krypteret under overførsel? | Ja (hele sitet kører over HTTPS med HSTS) |
| Kan brugere anmode om sletning? | Ja, men se blokering 1: linket skal findes først |
| Personlige oplysninger: e-mailadresse | Indsamlet, påkrævet. Formål: appfunktion og kontostyring |
| Personlige oplysninger: bruger-id/brugernavn, holdnavn, managernavn | Indsamlet, påkrævet. Formål: appfunktion og kontostyring |
| Appaktivitet (spildata: økonomi, ryttere, auktioner, resultater) | Indsamlet, påkrævet. Formål: appfunktion |
| Appaktivitet (sidevisninger og nøgletrin i spillet via PostHog, og analyse med samtykke via Microsoft Clarity, Google Analytics og Vercel Web Analytics) | Indsamlet, valgfrit (kan fravælges via cookie-valget). Formål: analyse |
| Enheds- eller andre id'er (Discord-id, kun hvis spilleren selv tilføjer det) | Indsamlet, valgfrit. Formål: appfunktion (DM-beskeder) |
| IP-adresse, browseroplysninger, sprog og tidszone til fair play-logning (slettes efter 180 dage) | Indsamlet, påkrævet. Formål: svindelforebyggelse, sikkerhed og compliance. Googles datatyper nævner ikke IP-adresse eksplicit, så vælg den nærmeste (sandsynligvis "Device or other IDs") og læs Googles hjælpetekst i formularen |
| Finansielle oplysninger | Ingen i appen under model A. Kortbetaling sker aldrig i appen i denne udgave |
| Placering, kontakter, fotos, lyd, kalender, beskeder uden for spillet, sundhed | Nej |
| Deles data med tredjeparter? | Tjenesteudbydere der behandler data på Cycling Zones vegne (Supabase, Vercel, Railway, PostHog) tæller ifølge Google ikke som deling. Google Analytics og Clarity er med samtykke; vurdér ærligt, og vælg "ja" hvis du er i tvivl. Politikken siger: ingen salg og ingen deling til markedsføring |

### Trin 8. Indholdsvurdering (IARC)

"App content" > indholdsvurdering. Du får et spørgeskema; hold dig til sandheden:
- Spillet er et manager-spil om cykelløb uden vold, blod, våben eller seksuelt indhold.
- **Brugerskabt indhold og kommunikation mellem brugere: ja** (forum og beskeder mellem spillere).
- Spil om penge eller simuleret gambling: nej. Auktionerne bruger spilvaluta (CZ$), og fairness-løftet er, at man ikke kan betale sig til resultater. Tjek at det stadig er sandt, før du svarer.
- Køb med rigtige penge i appen: nej under model A.
Resultatet er en aldersvurdering pr. område. Gem e-mailen, du angiver til IARC.

### Trin 9. Øvrige erklæringer under "App content"

Privatlivspolitik (adressen fra blokeringsafsnittet), App access (test-login, se blokering 3), Annoncer (nej), Målgruppe og indhold (se blokering 4), Dataformular (trin 7), Kontosletning (blokering 1), og evt. erklæringer for nyheder, regering, finans og sundhed: ikke relevante, svar nej.

### Trin 10. Lukket test: 12 testere i 14 dage (tid hos dig)

1. Opret en testerliste (e-mailadresser på Google-konti) eller en Google Group, og tilføj den til den lukkede test.
2. Mindst **12 testere skal være tilmeldt uafbrudt i 14 dage**, før du kan ansøge om produktion. En tester der melder sig fra før 14 dage, tæller ikke. Inviter flere end 12.
3. Send testerne linket til testen (Play Console viser det). Discord-betatestere er oplagte.
4. Når 14 dage er gået: Dashboard i Play Console > "Apply for production". Formularen har tre dele: om din lukkede test, om appen, og om produktionsparathed. Google svarer normalt inden for 7 dage, nogle gange senere.

### Trin 11. Send til gennemsyn (du)

Produktion > "Opret ny udgivelse" > vælg AAB'en fra den lukkede test (eller upload igen) > udgivelsesnoter (engelsk: kort og ærligt, se `docs/TONE_OF_VOICE.md`) > "Send til gennemsyn". Regn med dage hos Google. Hvis Google afviser, står årsagen i Play Console og i en e-mail. Send den til Claude, så rettes det.

## Når appen er live

- Spillet opdateres som i dag via Vercel: Play-appen viser altid den nyeste udgave. Du skal kun udgive en ny AAB, når ikon, farver, genveje eller pakke-opsætning ændres, eller når Googles target-krav stiger (årligt). Se tabellen "Når noget ændrer sig" i `android-twa/README.md`.
- Push-beskeder er ikke med i første udgave (spor 2, #6590). Slås først til, når push er bygget.
- Offline-tilstand er bevidst ikke med (ejer 12/11). Offline-siden fra PWA-sporet er alt, der findes.

## Hvad der IKKE er gjort i denne omgang

Ingen konto er oprettet, intet er betalt eller uploadet, og ingen nøgler eller hemmeligheder er rørt. AAB-filen er ikke bygget, fordi det kræver en upload-nøgle og Android-værktøjer, der ikke ligger på maskinen. Skærmbillederne til butikken er ikke taget: de kræver din rigtige konto (se `play-listing/README.md`). Selvbetjent kontosletning og Pro-skjulning i appen (blokering 1 og 2) er ikke bygget.
