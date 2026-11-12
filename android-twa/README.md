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
- **Signering: Play App Signing.** Google opbevarer app-nøglen. Du har kun en upload-nøgle, og den ligger aldrig i repoet.

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

Brug en mappe der IKKE er i repoet, fx `C:\Users\<dig>\cz-play-keys\`. Nøglen er det eneste, der kan genudgive appen, så tag backup af filen og kodeordet i adgangskodemanageren.

```
keytool -genkeypair -v -keystore C:\Users\<dig>\cz-play-keys\upload-key.jks -alias upload -keyalg RSA -keysize 2048 -validity 10000
```

Mister du upload-nøglen, kan den nulstilles via Play Console. App-nøglen ligger hos Google og kan ikke mistes.

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

Appen åbner med adresselinje, indtil `assetlinks.json` på sitet har det rigtige fingeraftryk. Det er forventet for en APK signeret med upload-nøglen. For at se den fulde-skærm-udgave lokalt kan upload-nøglens fingeraftryk også tilføjes (se næste afsnit), men det er ikke nødvendigt for Play.

## Fingeraftrykket i `assetlinks.json` (efter første upload til Play)

Fuld skærm uden adresselinje kræver, at `https://cyclingzone.org/.well-known/assetlinks.json` indeholder SHA-256-fingeraftrykket af **den nøgle, Google signerer appen med**. Med Play App Signing er det app-signeringsnøglen, ikke upload-nøglen.

1. Upload `.aab` til Play Console (se `docs/app/GOOGLE_PLAY.md`).
2. Play Console: åbn appen og find siden "App signing" (under app-integritet i menuen; menunavnene ændrer sig af og til, så søg efter "App signing"). Kopiér **SHA-256 certificate fingerprint** under "App signing key certificate". Det er ikke det samme som "Upload key certificate" på samme side.
3. Sæt det ind i `frontend/public/.well-known/assetlinks.json` i stedet for pladsholderen `REPLACE_WITH_SHA256_OF_PLAY_APP_SIGNING_KEY`. Format: store hex-par med kolon, fx `AA:BB:CC:...` (32 par).
4. Skriv gerne upload-nøglens fingeraftryk ind som nummer to i samme liste, hvis du vil se fuld skærm på en lokalt installeret APK. Hent det med `keytool -list -v -keystore <sti>\upload-key.jks -alias upload`.
5. Commit, merge og lad Vercel deploye. Tjek derefter: `https://cyclingzone.org/.well-known/assetlinks.json` skal svare 200 med `application/json`, og `node scripts/check-cdn-cache-headers.mjs` skal være grøn.
6. Test på en telefon med appen installeret fra Play (lukket test): ingen adresselinje = verificeret.

Filen er en liste, så den kan have flere fingeraftryk. Er pladsholderen stadig i filen, vil appen vise adresselinje (Custom Tab), men virke.

## Når noget ændrer sig

| Ændring | Hvad skal gøres |
|---|---|
| Nyt ikon, nye farver, nye genveje på web | Opdatér `twa-manifest.json`, hæv `appVersionCode` med 1, `bubblewrap build`, upload ny AAB. |
| Googles krav til target-API stiger (årligt) | `npm i -g @bubblewrap/cli@latest`, hæv `appVersionCode`, byg, upload. |
| Nyt domæne eller nyt pakkenavn | Nyt pakkenavn er en ny app i Play. Tal med udvikleren først. |
| Almindelige spil-opdateringer | Intet. Appen viser altid den nyeste udgave af sitet. |

## Hvis `bubblewrap build` klager over konfigurationen

Skemaet i `twa-manifest.json` er sat efter Bubblewraps egen `TwaManifest`-kilde (pakke `@bubblewrap/core`, tjekket 12/11/2026). Ændrer en nyere Bubblewrap feltnavne, så kør `bubblewrap update` i mappen, eller start forfra med `bubblewrap init --manifest=https://cyclingzone.org/manifest.webmanifest` og brug værdierne fra tabellen ovenfor (pakkenavn `org.cyclingzone.app`, start-url `/dashboard`, farve `#0e0f15`, signering "Play App Signing"). Ret ikke på nøgler eller ikoner via andre veje.
