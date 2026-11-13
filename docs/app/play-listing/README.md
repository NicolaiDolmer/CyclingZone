# Play-butiksside: tekster, grafik og skærmbilleder

> Refs #6584. Ejerens samlede vejledning: [`../GOOGLE_PLAY.md`](../GOOGLE_PLAY.md). Kravene herunder er læst på Googles egne hjælpesider 12/11/2026, og hver tabel nævner kilden.

## Hvad der ligger her

| Fil | Bruges til | Grænse (kilde) |
|---|---|---|
| `en/title.txt`, `da/title.txt` | Appens navn i butikken | Højst 30 tegn (Play Console) |
| `en/short-description.txt`, `da/short-description.txt` | Kort beskrivelse | Højst 80 tegn ([Googles hjælp: preview assets](https://support.google.com/googleplay/android-developer/answer/9866151)) |
| `en/full-description.txt`, `da/full-description.txt` | Fuld beskrivelse | Højst 4.000 tegn (Play Console) |
| `feature-graphic-1024x500.png` | Feature graphic | 1024 x 500, JPEG eller 24-bit PNG uden alfa (samme hjælpeside) |
| `../../../frontend/public/icons/icon-512.png` | Appikon i butikken | 512 x 512, 32-bit PNG med alfa, højst 1.024 KB (samme hjælpeside) |
| `tools/take-screenshots.mjs` | Tager telefon-skærmbillederne | Se nedenfor |
| `tools/make-feature-graphic.mjs` | Gentegner feature graphic fra brandets wordmark | |

Engelsk er standardsproget i Play Console. Tilføj dansk som oversættelse under "Butiksindstillinger > Administrer oversættelser" (menunavnet kan ændre sig, søg efter "translations").

`frontend/src/pwa/playListing.test.ts` holder grænserne og tonereglerne (ingen tankestreg, aldrig "free forever", jeg-stemme) i live, så en tekst ikke bliver for lang uden at nogen opdager det.

## Tonen, og hvorfor teksterne ikke nævner Pro

Teksterne følger [`docs/TONE_OF_VOICE.md`](../../TONE_OF_VOICE.md): jeg-stemme, ingen tankestreg, ærlig om open beta, og fair-løftet (man kan ikke betale sig til bedre ryttere, træning eller resultater). De nævner **ikke** Pro, premium eller køb. Ejeren valgte 13/11/2026 model A: Pro skjules helt i Play-appen, så butiksteksten må ikke love noget, appen ikke kan sælge. Googles betalingspolitik forbyder desuden at henvise til andre betalingsmetoder i butiksteksten (se blokering 2 i `GOOGLE_PLAY.md`). Testen `frontend/src/pwa/playListing.test.ts` fejler, hvis Pro kommer ind i teksterne igen. Vælges en anden betalingsmodel senere, skal teksterne og testen gennemses.

## Skærmbilleder: hvad Play kræver

Kilde: [Googles hjælpeside om preview assets](https://support.google.com/googleplay/android-developer/answer/9866151), læst 14/11/2026.

| Krav | Værdi |
|---|---|
| Antal | Op til 8 pr. enhedstype; mindst 2 for at udgive. Plan: 6 |
| Format | JPEG eller 24-bit PNG, **uden alfa** |
| Mål | Hver side mellem 320 og 3.840 px |
| Forhold | Den længste side højst **2 gange** den korteste |
| **Spil, for at komme med i Googles anbefalinger** | Mindst **tre stående 9:16 på mindst 1080 x 1920** (og tre liggende 16:9 på mindst 1920 x 1080, hvis spillet har liggende visning; Cycling Zone er stående) |

**Derfor 1080 x 1920:** scriptet tager 360 x 640 CSS-px ved skala 3, altså **præcis 1.080 x 1.920 px (9:16)**. 360 CSS-px er en almindelig Android-bredde, så det er samme mobillayout, som spillerne ser. Scriptet melder "FEJL", hvis et billede ikke er 9:16 eller er under 1080 x 1920. Tager du i stedet et skærmbillede på en rigtig telefon (ofte 20:9), så beskær det til 9:16.

## Skærmbillederne: opskrift

De seks skærme, i butikkens rækkefølge: Dashboard, Auktioner, Min trup, Race Centre (dagens etaper), Træning, Akademi.

### 1. Formatprøve uden login (kan køres af alle)

Bygger og serverer projektets egen e2e-build og bruger projektets test-fixtures (syntetiske data, intet login, intet prod, ingen hemmeligheder). Billederne er IKKE til butikken (holdet hedder "E2E Racing"), men beviser at mål, format og ruter er rigtige.

```
cd frontend
$env:VITE_E2E = "1"; $env:VITE_API_URL = "http://127.0.0.1:4173"; $env:VITE_SUPABASE_URL = "https://cycling-zone-e2e.supabase.co"; $env:VITE_SUPABASE_ANON_KEY = "e2e-anon-key"; $env:VITE_PUBLIC_APP_URL = "http://127.0.0.1:4173"
npm run build
node scripts/e2e-static-server.mjs --host 127.0.0.1 --port 4173
```

I et andet vindue, fra repo-roden:

```
node docs/app/play-listing/tools/take-screenshots.mjs --mode=fixtures
```

Luk serveren bagefter (Ctrl+C). Resultatet er seks filer på 1080x1920, og scriptet melder "ok" pr. fil. Meldes "FEJL", står årsagen ved filen (forkerte mål, ikke 9:16, over 2:1, alfa-kanal, eller siden endte på en anden rute, fx login).

### 2. Butiksbillederne fra den rigtige app (ejerens egen konto)

Det er rigtige data og dermed rigtige spillere, så billederne gemmes uden for repoet (standard: `%LOCALAPPDATA%\CyclingZone\play-listing-shots\live`). Scriptet genbruger ejerens logind-profil fra billedstationen (`scripts/shots/owner-session.mjs`) og ser aldrig adgangskoden.

```
node scripts/shots/owner-session.mjs login
node docs/app/play-listing/tools/take-screenshots.mjs --mode=live
```

Første linje åbner et vindue, hvor ejeren logger ind én gang. Scriptet skriver intet til din konto: hverken sprog eller samtykke bliver ændret, så billederne tages på kontoens eget sprog og lægges i en undermappe med sprogets navn (`...\live\en` eller `...\live\da`). Vil du have begge sprog, så skift sprog i appen selv (Min profil), kør scriptet igen, og skift tilbage bagefter. Tilføj `--lang=da` for at få scriptet til at stoppe, hvis kontoen ikke vises på dansk. Scriptet maskerer links til andre managere og hold med en grå flade. **Det er en hjælp, ikke en garanti.** Før upload åbnes hvert billede, og der tjekkes manuelt at ingen managernavn, holdnavn eller e-mail fra andre spillere er synlig. Auktionssiden er den mest udsatte (bydere og sælgere). Er et navn synligt alligevel: tag billedet om på en tid, hvor siden ikke viser andre, eller beskær.

Ønsker du at stille billederne ind (fx vælge en bestemt rytter eller et bestemt løb), så tag dem med telefonens egen skærmbilledefunktion fra den installerede app og beskær til 9:16 (se ovenfor).

### Når de er taget

Upload under "Telefon-skærmbilleder" på butiksiden. Hold rækkefølgen fra 1 til 6, og lad Dashboard være først. To er nok til at udgive (Googles minimum), men mindst tre i 9:16 skal med, for at spillet kan komme med i Googles anbefalinger.
