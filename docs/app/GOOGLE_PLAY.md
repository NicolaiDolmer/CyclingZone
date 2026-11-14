# Cycling Zone i Google Play: vejledning til ejeren

> Refs #6584. Første udgave 12/11/2026, opdateret 14/11/2026 efter ejerens valg 13/11 og en uafhængig gennemgang af PR #8059.
>
> **Forklaring:** appen er en tynd Android-skal (Trusted Web Activity) om cyclingzone.org. Det er det samme spil og den samme kode som i browseren. Detaljer om pakken: [`android-twa/README.md`](../../android-twa/README.md). Butiksteksterne: [`play-listing/`](play-listing/README.md).
>
> **Kilderegel:** hvert udsagn om Googles krav har en kilde og en dato for, hvornår siden blev læst. Står der **ikke efterprøvet**, har jeg ikke fundet det på Googles egne sider.

## Ejerens valg (13/11/2026)

| Spørgsmål | Valg |
|---|---|
| Kontotype | **Personlig konto nu, firmakonto senere** |
| "Slet min konto" | Personen slettes, historikken anonymiseres, 14 dages fortrydelse |
| Pro i Play-appen | **Model A:** Pro skjules helt i Play-appen. Pro købt på nettet virker stadig |
| PR #8059 | Gøres klar til merge (merge kræver ejerens ordrette "merge") |

## To blokeringer, før Play kan få appen (bygges i egne spor)

Denne PR gør dem ikke. Begge skal være bygget og godkendt af dig på billeder, før appen sendes til Googles gennemsyn.

**1. Selvbetjent kontosletning.** Google kræver, at en app, hvor man opretter konto, har (a) en vej i appen til at slette kontoen og dens data og (b) et offentligt weblink, hvor man kan bede om sletning uden appen. Linket skal i dataformularen, og formularen skal være udfyldt allerede til den lukkede test. ([Googles regler om kontosletning](https://support.google.com/googleplay/android-developer/answer/13327111), læst 12/11/2026.) I dag findes sletning kun som admin-funktion. Ejerens valg: personen slettes, historikken står under "Tidligere manager", 14 dages fortrydelse. Om 14 dages fortrydelse er i orden hos Google: **ikke efterprøvet**.

**2. Pro skjult i Play-appen (model A).** Pro er en digital funktion. Google kræver som udgangspunkt Google Play Billing for den slags og forbyder at henvise til andre betalingsmetoder i appen og i butiksteksten. ([Googles betalingspolitik](https://support.google.com/googleplay/android-developer/answer/9858738), læst 12/11/2026.) Appen skal derfor kunne se, at den kører som Play-app, og skjule alle Pro-knapper og -henvisninger. Butiksteksterne nævner allerede ikke Pro (testen `frontend/src/pwa/playListing.test.ts` holder det sådan). Om Pro købt på nettet må bruges i Play-appen under model A: **ikke efterprøvet**, skal bekræftes på Googles sider før udgivelse.

**Andet, der skal være på plads:**
- **Test-login til Google.** Under "App access" skal gennemseren have et login. Brug en dedikeret testkonto, aldrig din egen. Oplysningerne skrives kun i Play Console, aldrig i repoet.
- **Målgruppe.** Vælg en målgruppe uden børn under 13, så Googles Families-krav ikke udløses. Forum og beskeder mellem spillere betyder, at spørgsmålene om brugerskabt indhold skal besvares ærligt.
- **Privatlivspolitik:** https://cyclingzone.org/privacy-policy (engelsk). **Kontakt-e-mail:** support@cyclingzone.org.

## Kontoen: personlig nu, firma senere

| | Personlig konto (nu) | Firmakonto (senere) | Kilde |
|---|---|---|---|
| Pris | 25 USD én gang | 25 USD én gang (ny konto) eller skift af den personlige | [answer/6112435](https://support.google.com/googleplay/android-developer/answer/6112435), læst 14/11/2026 |
| Identitet | Gyldigt billed-id og betalingskort i dit eget navn kan kræves | Billed-id for en tegningsberettiget person | Samme side, læst 14/11/2026 |
| Android-telefon | Du skal bekræfte adgang til en Android-telefon via appen "Google Play Console", før du kan udgive | | Samme side, læst 14/11/2026 |
| Test før produktion | **Mindst 12 testere, tilmeldt uafbrudt i mindst 14 dage**, derefter ansøgning om produktion | Kravet står kun for personlige konti; at firmakonti er fritaget, er **ikke efterprøvet** | [answer/14151465](https://support.google.com/googleplay/android-developer/answer/14151465), læst 14/11/2026 |
| Ansøgning om produktion | Google: "usually takes seven days or less", nogle gange længere | | Samme side, læst 14/11/2026 |
| D-U-N-S-nummer | Ikke nødvendigt | **Påkrævet.** Gratis hos Dun & Bradstreet. Kan tage op til 30 dage | [answer/13628312](https://support.google.com/googleplay/android-developer/answer/13628312), læst 14/11/2026 |
| Hvad butikken viser | Google: kun e-mailadressen vises for personlige konti | Firmanavn, og en bekræftet e-mail og telefon vises. Fuld adresse kan vises "i visse regioner"; for Danmark: **ikke efterprøvet**, så regn med, at firmaets adresse bliver offentlig | [answer/13634888](https://support.google.com/googleplay/android-developer/answer/13634888), læst 14/11/2026 |
| Skift senere | Personlig kan skiftes til firma ved at oprette og bekræfte en betalingsprofil for firmaet | Firma kan **ikke** skiftes tilbage til personlig | Samme side, læst 14/11/2026 |

Hvor lang tid Googles identitetsbekræftelse tager, står ikke på Googles side: **ikke efterprøvet**.

Ingen nye løbende udgifter: kontoen er en engangsbetaling, og appen koster intet at drive (spillet kører som i dag på Vercel og Railway).

## Det skal du selv gøre hos Google (tjekliste)

Det her kan kun du gøre, fordi det kræver din identitet og dit kort. Claude forbereder resten og skriver, hvad der skal stå i felterne.

**Før du starter**
- [ ] Vælg den Google-konto, der skal eje appen i mange år. Slå to-trins-login til på den.
- [ ] Hav pas eller kørekort og et betalingskort i dit eget navn klar.

**Opret kontoen**
- [ ] Gå til play.google.com/console og log ind med den valgte konto.
- [ ] Vælg **personlig** konto.
- [ ] Betal 25 USD (én gang).
- [ ] Gennemfør identitetsbekræftelsen (upload billed-id). Vent på godkendelse.
- [ ] Installér appen "Google Play Console" på din Android-telefon, og bekræft telefonen, når den beder om det.

**Når Claude siger, at appen er klar til upload** (efter de to blokeringer er bygget)
- [ ] Opret appen i Play Console, og upload filen, du får, til **Lukket test**. Sig ja til Play App Signing.
- [ ] Kopiér **alle** fingeraftryk under "App signing key" (op til tre, se trin 5), og send dem til Claude. De er ikke hemmelige.
- [ ] Gem upload-nøglen og dens kodeord i **Infisical**, og læg en krypteret kopi offline (fx en USB-nøgle i en skuffe). Aldrig i repoet, aldrig i en chat.
- [ ] Indtast test-login til Googles gennemsyn (en testkonto, aldrig din egen).

**Testere**
- [ ] Inviter mindst 20 personer (fx fra Discord-betaen) med deres Google-konto, så mindst 12 holder hele perioden.
- [ ] Bed dem blive tilmeldt i 14 dage i træk uden at melde sig fra.
- [ ] Efter 14 dage: tryk "Apply for production" (ansøg om produktion).

**Til sidst**
- [ ] Tag skærmbillederne på din konto, når Claude siger til (én kommando), og tjek, at ingen andre spilleres navne kan ses.
- [ ] Tryk "Send til gennemsyn". Får du en afvisning, så videresend mailen.

**Senere: skift til firmakonto**
- [ ] Slå gratis op hos Dun & Bradstreet, om firmaet har et D-U-N-S-nummer; ellers bestil det (gratis, op til 30 dage).
- [ ] Opret og bekræft en betalingsprofil for firmaet, og knyt den til Play-kontoen. Navn og adresse skal passe præcist med D-U-N-S-oplysningerne.

## Googles tekniske krav

| Krav | Værdi | Kilde |
|---|---|---|
| Target API-niveau | Nye apps og opdateringer skal målrette Android 16 (API 36) eller højere fra 31/8/2026 | [developer.android.com](https://developer.android.com/google/play/requirements/target-sdk), læst 12/11/2026 |
| Bubblewrap | Version 1.25.0 eller nyere bumper target til 36 (nyeste set: 1.27.0) | [Bubblewrap-udgivelser](https://github.com/GoogleChromeLabs/bubblewrap/releases), læst 12/11/2026 |
| Play App Signing | Nye apps får "quantum-ready hybrid signing": en klassisk RSA 4096-nøgle og en post-kvante ML-DSA-65-nøgle, i alt **tre nøgler med hver sit fingeraftryk**. `assetlinks.json` skal opdateres "with these fingerprints" | [answer/9842756](https://support.google.com/googleplay/android-developer/answer/9842756), læst 14/11/2026 |
| Digital Asset Links | Filen skal ligge på `/.well-known/assetlinks.json` på domænets rod, offentlig og i klartekst | [Digital Asset Links](https://developers.google.com/digital-asset-links/v1/getting-started), [Chromes TWA-guide](https://developer.chrome.com/docs/android/trusted-web-activity/integration-guide), læst 12/11/2026 |
| Dataformular | Skal udfyldes for alle apps i lukket test, åben test eller produktion | [answer/10787469](https://support.google.com/googleplay/android-developer/answer/10787469), læst 12/11/2026 |
| Indholdsvurdering (IARC) | Spørgeskema i Play Console, kræves for nye apps | [answer/9859655](https://support.google.com/googleplay/android-developer/answer/9859655), læst 12/11/2026 |
| Skærmbilleder | 2 til 8 pr. enhedstype, hver side 320 til 3.840 px, længste side højst 2 gange korteste, uden alfa. **Spil:** mindst tre stående 9:16 på mindst 1080 x 1920 for at kunne komme med i Googles anbefalinger | [answer/9866151](https://support.google.com/googleplay/android-developer/answer/9866151), læst 14/11/2026 |
| Kort beskrivelse | Højst 80 tegn | Samme side, læst 14/11/2026 |

## Trin for trin

### Trin 1. Opret udviklerkontoen (dig, 25 USD)

Følg tjeklisten ovenfor under "Opret kontoen". Vælg personlig konto.

### Trin 2. Byg AAB-filen

Følg [`android-twa/README.md`](../../android-twa/README.md). Kort: opret en upload-nøgle uden for repoet, kør `bubblewrap build`, få `app-release-bundle.aab`. Tjek at target er 36 eller højere. Upload-nøglen og kodeordet gemmes i **Infisical** med en krypteret kopi offline, aldrig i repoet.

### Trin 3. Opret appen

1. Play Console: "Opret app". Navn: **Cycling Zone: Cycling Manager** (fra `play-listing/en/title.txt`). Standardsprog engelsk. Type: Spil. Gratis.
2. Kategori: Spil, typen Sport (eller Simulation, dit valg).
3. Erklæringer besvares ærligt. Annoncer: nej. Køb i appen: **nej** (model A).

### Trin 4. Upload AAB (Play App Signing)

1. Opret en udgivelse i **Lukket test** (ikke produktion), og upload `app-release-bundle.aab`.
2. Accepter **Play App Signing** (standard for nye apps). Google opbevarer app-nøglerne; du har kun upload-nøglen. Mister du upload-nøglen, kan den nulstilles i Play Console ([answer/9842756](https://support.google.com/googleplay/android-developer/answer/9842756), læst 14/11/2026).
3. Pakkenavnet er `org.cyclingzone.app` og kan ikke ændres bagefter.

### Trin 5. Sæt fingeraftrykkene ind (så adresselinjen forsvinder)

Uden dette virker appen, men viser en adresselinje (Chrome Custom Tab).

1. Play Console, i appen: **Protected with Play > Play Store protection > Manage Play app signing**. Rul ned til afsnittet **App signing key**, og kopiér **SHA-256**-fingeraftrykket for hver nøgle, der står der (op til tre; Google skriver "you must copy the fingerprints for three keys"). Ikke "Upload key". (Menusti og nøgletal fra [answer/9842756](https://support.google.com/googleplay/android-developer/answer/9842756), læst 14/11/2026. Menunavne ændrer sig; står stien ikke der, så søg efter "app signing".)
2. Åbn `frontend/public/.well-known/assetlinks.json`, og erstat pladsholderne `REPLACE_WITH_SHA256_OF_PLAY_APP_SIGNING_KEY_1` til `_3` med fingeraftrykkene (store hex-par med kolon, 32 par). Er der kun to, så slet den tredje pladsholder. Bland aldrig pladsholdere og ægte aftryk: testen og tjekket efter deploy afviser det.
3. Hvilket af aftrykkene Chrome bruger til at godkende fuld skærm, siger Google ikke: **ikke efterprøvet**. Derfor skrives alle ind; filen er en liste.
4. Commit og merge (eller bed Claude om det). Efter deploy skal `https://cyclingzone.org/.well-known/assetlinks.json` svare 200 som JSON, og `node scripts/check-cdn-cache-headers.mjs` skal være grøn **uden** advarslen `ASSETLINKS_PLACEHOLDER`.
5. Bed Claude sætte `ASSETLINKS_REQUIRE_FINGERPRINT: "1"` på trinnet "Verify CDN cache-headers" i `.github/workflows/deploy-verify.yml`. Derefter er en pladsholder rød i stedet for en advarsel, så den ikke kan snige sig tilbage.
6. Installér appen fra den lukkede test på en telefon. Ingen adresselinje = verificeret.

**Hvorfor en advarsel og ikke rødt indtil da:** tjekket kører efter hver deploy til prod. Var pladsholderen rød, ville main være rød, indtil du har oprettet Play-kontoen, og en permanent rød deploy-verify skjuler de ægte fejl, den skal fange. Advarslen hedder `ASSETLINKS_PLACEHOLDER` og står som annotation på hver kørsel i GitHub Actions, så den ikke kan overses.

Vil du se fuld skærm på en lokalt installeret APK (signeret med upload-nøglen), så tilføj også upload-nøglens aftryk i samme liste.

### Trin 6. Butiksside

1. Titel, kort og fuld beskrivelse: kopiér fra `play-listing/en/`, og tilføj dansk fra `play-listing/da/`.
2. Appikon: `frontend/public/icons/icon-512.png` (512 x 512).
3. Feature graphic: `play-listing/feature-graphic-1024x500.png`.
4. Skærmbilleder: tag dem efter [`play-listing/README.md`](play-listing/README.md): 6 stk., **1080 x 1920 (9:16)**. Tjek, at ingen andre spilleres navne er synlige.
5. Kontakt-e-mail: support@cyclingzone.org. Privatlivspolitik: https://cyclingzone.org/privacy-policy.

### Trin 7. Dataformularen ("Data safety")

Formularen findes under "App content". Svarene herunder er hentet fra privatlivspolitikken (https://cyclingzone.org/privacy-policy, opdateret 6/10/2026). **Du er ansvarlig for, at svarene er rigtige**; forkerte svar kan give afvisning. Tjek dem mod politikken, hver gang den ændres.

| Spørgsmål | Svar |
|---|---|
| Indsamler appen data? | Ja |
| Krypteret under overførsel? | Ja (hele sitet kører over HTTPS med HSTS) |
| Kan brugere anmode om sletning? | Ja, når blokering 1 er bygget; linket skal findes først |
| Personlige oplysninger: e-mailadresse | Indsamlet, påkrævet. Formål: appfunktion og kontostyring |
| Personlige oplysninger: bruger-id/brugernavn, holdnavn, managernavn | Indsamlet, påkrævet. Formål: appfunktion og kontostyring |
| Appaktivitet (spildata: økonomi, ryttere, auktioner, resultater) | Indsamlet, påkrævet. Formål: appfunktion |
| Appaktivitet (sidevisninger og nøgletrin i spillet via PostHog, og analyse med samtykke via Microsoft Clarity, Google Analytics og Vercel Web Analytics) | Indsamlet, valgfrit (kan fravælges via cookie-valget). Formål: analyse |
| Enheds- eller andre id'er (Discord-id, kun hvis spilleren selv tilføjer det) | Indsamlet, valgfrit. Formål: appfunktion (DM-beskeder) |
| IP-adresse, browseroplysninger, sprog og tidszone til fair play-logning (slettes efter 180 dage) | Indsamlet, påkrævet. Formål: svindelforebyggelse, sikkerhed og compliance. Vælg den nærmeste datatype, og læs Googles hjælpetekst i formularen |
| Finansielle oplysninger | Ingen i appen (model A) |
| Placering, kontakter, fotos, lyd, kalender, beskeder uden for spillet, sundhed | Nej |
| Deles data med tredjeparter? | Tjenesteudbydere, der behandler data på Cycling Zones vegne (Supabase, Vercel, Railway, PostHog), tæller ifølge Google ikke som deling. Google Analytics og Clarity er med samtykke; vurdér ærligt, og vælg "ja", hvis du er i tvivl |

### Trin 8. Indholdsvurdering (IARC)

"App content" > indholdsvurdering. Hold dig til sandheden:
- Manager-spil om cykelløb uden vold, blod, våben eller seksuelt indhold.
- **Brugerskabt indhold og kommunikation mellem brugere: ja** (forum og beskeder).
- Spil om penge eller simuleret gambling: nej. Auktionerne bruger spilvaluta, og man kan ikke betale sig til resultater. Tjek, at det stadig er sandt, før du svarer.
- Køb med rigtige penge i appen: nej (model A).

### Trin 9. Øvrige erklæringer under "App content"

Privatlivspolitik, App access (test-login), Annoncer (nej), Målgruppe og indhold, Dataformular (trin 7), Kontosletning (blokering 1). Erklæringer for nyheder, regering, finans og sundhed er ikke relevante: svar nej.

### Trin 10. Lukket test: 12 testere i 14 dage

1. Opret en testerliste (Google-konti) eller en Google Group, og tilføj den til den lukkede test.
2. Mindst **12 testere skal være tilmeldt uafbrudt i 14 dage** ([answer/14151465](https://support.google.com/googleplay/android-developer/answer/14151465), læst 14/11/2026). En tester, der melder sig fra og til igen, skal have 14 sammenhængende dage. Inviter flere end 12.
3. Send testerne linket (Play Console viser det). Discord-betatestere er oplagte.
4. Efter 14 dage: Dashboard i Play Console > "Apply for production". Google svarer normalt inden for 7 dage.

### Trin 11. Send til gennemsyn (dig)

Produktion > "Opret ny udgivelse" > vælg AAB'en fra den lukkede test > udgivelsesnoter (engelsk, kort og ærligt, se `docs/TONE_OF_VOICE.md`) > "Send til gennemsyn". Google lover ingen tid. Afviser Google, står årsagen i Play Console og i en e-mail; send den videre, så rettes det.

## Når appen er live

- Spillet opdateres som i dag via Vercel: Play-appen viser altid den nyeste udgave. Ny AAB kun ved nyt ikon, nye farver, genveje eller pakke-opsætning, eller når Googles target-krav stiger (årligt). Se "Når noget ændrer sig" i `android-twa/README.md`.
- Push-beskeder er ikke med i første udgave (#6590).
- Offline-tilstand er bevidst ikke med (ejer 12/11).

## Hvad der IKKE er gjort

Ingen konto er oprettet, intet er betalt eller uploadet, og ingen nøgler eller hemmeligheder er rørt. AAB-filen er ikke bygget (kræver upload-nøgle og Android-værktøjer), så `minSdkVersion 21` og Bubblewrap-versionen er ikke prøvet i et rigtigt byg. Skærmbillederne til butikken er ikke taget (kræver din konto). Kontosletning og Pro-skjulning (blokering 1 og 2) bygges i egne spor.
