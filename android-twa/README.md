# android-twa: Cycling Zone i Google Play (Trusted Web Activity)

> Refs #6584. Ejerens samlede trin-for-trin-vejledning (konto, upload, formularer) står i [`docs/app/GOOGLE_PLAY.md`](../docs/app/GOOGLE_PLAY.md). Denne fil er den tekniske del: hvordan `app-release-bundle.aab` bygges.

Appen er en tynd Android-skal (Trusted Web Activity) der åbner `https://cyclingzone.org` i Chrome uden adresselinje. Det er det samme spil og den samme kode som browseren. Der er ingen native kode at vedligeholde, og spillet opdateres som i dag via Vercel. Play-pakken skal kun genudgives, når ikon, farver, genveje, pakke-opsætning eller Googles krav til target-API ændrer sig.

## Hvad der ligger her

| Fil | Hvad |
|---|---|
| `twa-manifest.json` | Bubblewrap-konfigurationen: host `cyclingzone.org`, pakkenavn `org.cyclingzone.app`, navn, farver, ikoner, start-url `/dashboard`, genveje. Tokens er de samme som web-manifestet (`#0e0f15`). |
| `.gitignore` | Blokerer nøgler (`*.jks`, `*.keystore`, `*.p12`, ...) og alt Bubblewrap genererer (Gradle-projekt, `.aab`, `.apk`). |
| `README.md` | Denne fil. |

Det genererede Android-projekt, `.aab`-filer og nøgler committes aldrig. Kun `twa-manifest.json` er kilden.

## Valg der er truffet (og hvorfor)

- **Pakkenavn `org.cyclingzone.app`** er omvendt domæne, og det kan ikke ændres efter første upload til Play. Det er et ejer-valg (se `docs/superpowers/specs/2026-10-13-6584-push-og-twa-design.md` §6.2).
- **`display: standalone`** giver ingen adresselinje, når Digital Asset Links er verificeret. Statuslinjen bevares, så telefonens ur og batteri stadig kan ses. `fullscreen` skjuler også dem og er ikke valgt.
- **`fallbackType: customtabs`**: hvis verifikationen fejler, åbner appen en Chrome Custom Tab med adresselinje i stedet for at gå i stykker.
- **`enableNotifications: false`**: push-beskeder er ikke med i første udgave (#6590). Slå først til, når push er bygget.
- **`minSdkVersion: 21`** er Bubblewraps standard.
- **Ingen offline-tilstand i appen.** Offline-siden fra PWA-sporet (#6585/#8021) er alt, der findes, og den ejes af web-appen.
- **Signering: Play App Signing.** Google opbevarer app-nøglerne. Du har kun en upload-nøgle, og den ligger aldrig i repoet.
- **Upload-nøglen gemmes ét sted:** keystore-filen (base64) og begge kodeord i **Infisical**, plus en krypteret kopi offline (fx en USB-nøgle i en skuffe). Aldrig i repoet, aldrig i en chat. Det er samme regel som designet (`docs/superpowers/specs/2026-10-13-6584-push-og-twa-design.md` §6.2).
- **`signingKey.path` peger uden for repoet** (`../../cz-play-keys/upload-key.jks`, en mappe ved siden af repo-mappen). Giv altid stien eksplicit med `--signingKeyPath` ved `bubblewrap build`. Testen `frontend/src/pwa/twaPackage.test.ts` fejler, hvis stien peger ind i repoet.

## Krav (målt mod officielle kilder 12/11/2026)

| Krav | Værdi | Kilde |
|---|---|---|
| Bubblewrap CLI | 1.25.0 eller nyere (1.25.0 hæver `targetSdkVersion` til 36; nyeste set på udgivelsessiden er 1.27.0) | github.com/GoogleChromeLabs/bubblewrap/releases |
| Node.js | 18 eller nyere | Bubblewrap CLI README |
| JDK | 17 (ældre kan ikke kompilere, nyere virker ikke med Androids kommandolinjeværktøjer) | Bubblewrap CLI README |
| Android command line tools | Pakkes ud i en mappe uden mellemrum i stien. Bubblewrap kan hente dem selv ved første kørsel | Bubblewrap CLI README |
| Target API | Nye apps og opdateringer skal målrette Android 16 (API 36) eller højere fra 31/8/2026 | developer.android.com/google/play/requirements/target-sdk |

## Byg AAB-filen (ét skridt, når værktøjet er på maskinen)

Alle kommandoer køres i `android-twa/`. Ingen af dem kræver, at repoet indeholder en nøgle.

```
npm i -g @bubblewrap/cli@latest
bubblewrap doctor
```

`bubblewrap doctor` skal melde JDK og Android SDK fundet. Mangler de, kan Bubblewrap hente dem ved første `build`, eller du kan pege på dem:

```
bubblewrap updateConfig --jdkPath="C:\sti\til\jdk-17" --androidSdkPath="C:\sti\til\android-sdk"
```

### 1. Opret upload-nøglen (én gang, uden for repoet)

Brug en mappe der IKKE er i repoet, fx `C:\Users\<dig>\cz-play-keys\`. Læg straks filen (base64) og kodeordene i Infisical, og tag en krypteret kopi offline. Ved senere byg hentes filen fra Infisical til samme mappe uden for repoet.

```
keytool -genkeypair -v -keystore C:\Users\<dig>\cz-play-keys\upload-key.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Mister du upload-nøglen, kan den nulstilles via Play Console ("Request upload key reset"), men det tager tid. App-nøglerne ligger hos Google og kan ikke mistes ([answer/9842756](https://support.google.com/googleplay/android-developer/answer/9842756), læst 14/11/2026).

### 2. Byg

```
bubblewrap build --signingKeyPath="C:\Users\<dig>\cz-play-keys\upload-key.jks" --signingKeyAlias=upload
```

Bubblewrap spørger efter kodeordene. I CI sættes `BUBBLEWRAP_KEYSTORE_PASSWORD` og `BUBBLEWRAP_KEY_PASSWORD` i stedet (aldrig i en fil i repoet).

Første kørsel opretter Gradle-projektet fra `twa-manifest.json` (Bubblewrap kan spørge, om det må). Resultatet i `android-twa/`:

- `app-release-bundle.aab`: filen der uploades til Play Console.
- `app-release-signed.apk`: til at prøve appen på en telefon.

Tjek efter bygget, at target-API er rigtigt: `app/build.gradle` skal indeholde `targetSdkVersion 36` (eller højere). Står der lavere, er Bubblewrap for gammel; opdatér den.

### 3. Prøv APK'en på en Android-telefon (valgfrit, anbefalet)

```
bubblewrap install
```

Appen åbner med adresselinje, indtil `assetlinks.json` på sitet har de rigtige fingeraftryk. Det er forventet for en APK signeret med upload-nøglen. For at se den fulde-skærm-udgave lokalt kan upload-nøglens fingeraftryk også tilføjes (se næste afsnit), men det er ikke nødvendigt for Play.

## Fingeraftrykkene i `assetlinks.json` (efter første upload til Play)

Fuld skærm uden adresselinje kræver, at `https://cyclingzone.org/.well-known/assetlinks.json` indeholder fingeraftrykkene af **de nøgler, Google signerer appen med**. Nye apps får "quantum-ready hybrid signing" (en klassisk RSA 4096-nøgle og en post-kvante ML-DSA-65-nøgle), og Google skriver, at man skal kopiere fingeraftrykkene for **tre** nøgler og opdatere `assetlinks.json` med dem ([answer/9842756](https://support.google.com/googleplay/android-developer/answer/9842756), læst 14/11/2026).

1. Upload `.aab` til Play Console (se `docs/app/GOOGLE_PLAY.md`).
2. Play Console, i appen: **Protected with Play > Play Store protection > Manage Play app signing**. Rul til afsnittet **App signing key**, og kopiér SHA-256 for hver nøgle der (op til tre). Ikke "Upload key". Menunavne ændrer sig; står stien ikke der, så søg efter "app signing".
3. Sæt dem ind i `frontend/public/.well-known/assetlinks.json` i stedet for pladsholderne `REPLACE_WITH_SHA256_OF_PLAY_APP_SIGNING_KEY_1` til `_3`. Format: store hex-par med kolon, fx `AA:BB:CC:...` (32 par). Er der færre end tre, så slet de overskydende pladsholdere. Bland aldrig pladsholdere og ægte aftryk.
4. Hvilket aftryk Chrome bruger til at godkende fuld skærm, siger Google ikke: **ikke efterprøvet**. Derfor skrives alle ind.
5. Skriv gerne upload-nøglens fingeraftryk ind i samme liste, hvis du vil se fuld skærm på en lokalt installeret APK. Hent det med `keytool -list -v -keystore <sti>\upload-key.jks -alias upload`.
6. Commit, merge og lad Vercel deploye. Tjek derefter: `https://cyclingzone.org/.well-known/assetlinks.json` skal svare 200 med `application/json`, og `node scripts/check-cdn-cache-headers.mjs` skal være grøn uden advarslen `ASSETLINKS_PLACEHOLDER`. Sæt derefter `ASSETLINKS_REQUIRE_FINGERPRINT=1` på trinnet i `deploy-verify.yml`, så en pladsholder fremover er rød.
7. Test på en telefon med appen installeret fra Play (lukket test): ingen adresselinje = verificeret.

Så længe pladsholderne står i filen, viser appen adresselinje (Custom Tab), men virker. Tjekket efter deploy melder det som den navngivne advarsel `ASSETLINKS_PLACEHOLDER` (ikke rødt, så main ikke er rød, før Play-kontoen findes); en halvt rettet fil eller et ugyldigt aftryk er rødt.

## Når noget ændrer sig

| Ændring | Hvad skal gøres |
|---|---|
| Nyt ikon, nye farver, nye genveje på web | Opdatér `twa-manifest.json`, hæv `appVersionCode` med 1, `bubblewrap build`, upload ny AAB. |
| Googles krav til target-API stiger (årligt) | `npm i -g @bubblewrap/cli@latest`, hæv `appVersionCode`, byg, upload. |
| Nyt domæne eller nyt pakkenavn | Nyt pakkenavn er en ny app i Play. Tal med udvikleren først. |
| Almindelige spil-opdateringer | Intet. Appen viser altid den nyeste udgave af sitet. |

## Hvis `bubblewrap build` klager over konfigurationen

Skemaet i `twa-manifest.json` er sat efter Bubblewraps egen `TwaManifest`-kilde (pakke `@bubblewrap/core`, tjekket 12/11/2026). Ændrer en nyere Bubblewrap feltnavne, så kør `bubblewrap update` i mappen, eller start forfra med `bubblewrap init --manifest=https://cyclingzone.org/manifest.webmanifest` og brug værdierne fra tabellen ovenfor (pakkenavn `org.cyclingzone.app`, start-url `/dashboard`, farve `#0e0f15`, signering "Play App Signing"). Ret ikke på nøgler eller ikoner via andre veje.
