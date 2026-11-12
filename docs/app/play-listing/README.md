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

## Tonen og hvad teksterne siger om Pro

Teksterne følger [`docs/TONE_OF_VOICE.md`](../../TONE_OF_VOICE.md): jeg-stemme, ingen tankestreg, ærlig om open beta. De siger, at CZ Pro findes som valgfrit premium-niveau, og at det aldrig giver styrke. De siger **ikke**, hvad Pro koster, og peger **ikke** på hjemmesiden som sted at købe. Det er med vilje: Googles betalingspolitik forbyder at henvise til andre betalingsmetoder i butiksteksten (se punkt 2 under blokeringer i `GOOGLE_PLAY.md`). Vælger ejeren en anden betalingsmodel end "intet køb i appen", skal teksterne gennemses igen.

## Skærmbilleder: hvad Play kræver

Kilde: Googles hjælpeside om preview assets (se tabellen ovenfor), læst 12/11/2026.

| Krav | Værdi |
|---|---|
| Antal telefon-skærmbilleder | Mindst 2 for at udgive. Op til 8. Plan: 6 |
| Format | JPEG eller 24-bit PNG, **uden alfa** |
| Mål | Hver side mellem 320 og 3.840 px |
| Forhold | Den længste side højst **2 gange** den korteste |
| Anbefalet (ikke krav) | Mindst 4 skærmbilleder på 1.080 px eller mere, 9:16 stående, for at komme i betragtning til særlige visninger |

**Vigtigt om 412 x 915:** et moderne Android-skærmbillede (fx 412 x 915 CSS-px, 1.080 x 2.400 px) er 2,22:1, og det afvises af Play. Derfor tager scriptet 412 x 824 CSS-px ved skala 2,62, altså **1.080 x 2.160 px (præcis 2:1)**. Tager du i stedet et skærmbillede på en rigtig telefon, så beskær statuslinjen øverst og navigationslinjen nederst, til højden er højst 2 gange bredden.

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

Luk serveren bagefter (Ctrl+C). Resultatet er seks filer på 1080x2160, og scriptet melder "ok" pr. fil. Meldes "FEJL", står årsagen ved filen (forkerte mål, over 2:1, alfa-kanal, eller siden endte på en anden rute, fx login).

### 2. Butiksbillederne fra den rigtige app (ejerens egen konto)

Det er rigtige data og dermed rigtige spillere, så billederne gemmes uden for repoet (standard: `%LOCALAPPDATA%\CyclingZone\play-listing-shots\live`). Scriptet genbruger ejerens logind-profil fra billedstationen (`scripts/shots/owner-session.mjs`) og ser aldrig adgangskoden.

```
node scripts/shots/owner-session.mjs login
node docs/app/play-listing/tools/take-screenshots.mjs --mode=live
```

Første linje åbner et vindue, hvor ejeren logger ind én gang. Scriptet skriver intet til din konto: hverken sprog eller samtykke bliver ændret, så billederne tages på kontoens eget sprog og lægges i en undermappe med sprogets navn (`...\live\en` eller `...\live\da`). Vil du have begge sprog, så skift sprog i appen selv (Min profil), kør scriptet igen, og skift tilbage bagefter. Tilføj `--lang=da` for at få scriptet til at stoppe, hvis kontoen ikke vises på dansk. Scriptet maskerer links til andre managere og hold med en grå flade. **Det er en hjælp, ikke en garanti.** Før upload åbnes hvert billede, og der tjekkes manuelt at ingen managernavn, holdnavn eller e-mail fra andre spillere er synlig. Auktionssiden er den mest udsatte (bydere og sælgere). Er et navn synligt alligevel: tag billedet om på en tid, hvor siden ikke viser andre, eller beskær.

Ønsker du at stille billederne ind (fx vælge en bestemt rytter eller et bestemt løb), så tag dem med telefonens egen skærmbilledefunktion fra den installerede app og følg reglen om 2:1 ovenfor.

### Når de er taget

Upload under "Telefon-skærmbilleder" på butiksiden. Hold rækkefølgen fra 1 til 6, og lad Dashboard være først. Har du ikke tid til alle seks, er to nok til at udgive (Googles minimum), men fire eller flere er anbefalet.
