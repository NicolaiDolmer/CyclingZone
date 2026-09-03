# Mail-tekster v2, låst med ejeren 2/9-2026 kl. 19:20-19:50 (#2853)

**Status: LÅST af ejeren i små bidder (tone-session 2/9).** Erstatter v1 (`mailtekster-2853-2026-08-03.md`). Underskrift **"Dolmer, Cycling Zone"** (stort D). DA-oversættelsen er leveret i opfølger-PR'en (3/9), valgt pr. modtager via `users.language` (`'da'` -> dansk, alt andet -> engelsk). Se DA-teksterne nederst i dette dokument.

Ejerens tone-domme undervejs, så de ikke gentages: "Here is the honest version", "Welcome to the club", "one week at a time", "there is always one", "every time", "if you do one thing today", "good day or bad day" og "{{teamName}} is in" er AI-fyld og er fjernet. Ingen rammesætnings-sætninger, ingen aforismer, ingen performet varme. Sig tingene ligeud.

## Layout (ejer-valg: top og bund fra A, rækker fra B)

Tabel-baseret HTML, systemskrift, inline CSS (`backend/lib/emailTemplates.js::wrapHtml`):
1. Navy bånd (#1B2A4A) øverst med wordmark som lille PNG (CYCLING ZONE, ZONE i guld) til venstre og en kort guld-eyebrow til højre (fx START LINE).
2. Hvid krop, 14-15 px, 1.55 linjeafstand.
3. Nummererede skridt som rækker med navy cirkel-tal, fed titel og grå undertekst (kun i velkomstmailen).
4. Én guld-knap (#C9A227, mørk tekst) som primær handling. Discord som sekundær outline-knap (navy kant) under teksten "Something broken or confusing? Come say hi on Discord, I read everything." Link: https://discord.gg/ykysBrWUyC
5. Underskrift "Dolmer, Cycling Zone" i fed.
6. Bund: "You are receiving this because you have a Cycling Zone account. Unsubscribe from these emails." med signeret unsub-link (uændret).

## 1. Welcome (dag 0, inden 48 timer efter holdet er lavet)

Subject: `Your team is on the start line`

```
Hi,

Welcome to Cycling Zone, and thanks for creating {{teamName}}. Come and go as
you like, the season runs regardless. Your team takes part in races
automatically. You do not have to do anything for that, but your riders ride
better when you do.

1. Bid on a rider you like
   You learn the market by losing an auction or two.
2. Sign a young rider
   Your academy already has riders waiting. You can sign one today.
3. Training and lineup
   Set the week's training, and pick who starts your next race.

[Open your dashboard]  https://cyclingzone.org/dashboard

Something broken or confusing? Come say hi on Discord, I read everything.
[Join the Discord]  https://discord.gg/ykysBrWUyC

Dolmer, Cycling Zone
```

## 2. Dag 1 (20 til 30 timer efter signup)

### Variant A, holdet har resultater

Subject: `Day 1: your riders have already raced`

```
Hi,

{{teamName}} raced while you were away. The results are up. Have a look at
who did well and who did not, and check the auctions closing today before
someone else takes the rider you wanted.

[Open your dashboard]  https://cyclingzone.org/dashboard

Dolmer, Cycling Zone
```

### Variant B, ingen resultater endnu

Subject: `Day 1: your first race is on the calendar`

```
Hi,

{{teamName}}'s first race is on the calendar and runs by itself. Today: check
the auctions closing tonight, and pick your own lineup for the first race. If
you do nothing, the assistant fills the gaps, but your own picks are better.

[Open your dashboard]  https://cyclingzone.org/dashboard

Dolmer, Cycling Zone
```

## 3. Digest: "raced while you were away" (NY målretning, ejer 2/9: "Ingen spam")

Ejeren afviste den daglige kadence. Digestet er nu en tilbagekomst-mail, ikke en daglig rapport:

- Kun til spillere med `last_seen` ældre end **3 dage**.
- Højst **én pr. 7 dage** pr. spiller (dedupe-nøgle pr. uge, ikke pr. dag).
- Højst **2 pr. fraværsperiode**: har spilleren fået to uden at komme tilbage, sendes ikke flere før `last_seen` igen er nyere end sidste digest.
- Aldrig til afmeldte (`email_prefs`) og aldrig til AI/test/frosne hold (uændret).
- Kun dage hvor holdet faktisk har resultater siden sidste besøg.
- Kl. 19 dansk tid som i dag.

Subject: `{{teamName}} raced while you were away`

```
Hi,

{{teamName}} raced while you were away. Best results since your last visit:

{{resultLines}}

[See all results]  https://cyclingzone.org/resultater

Dolmer, Cycling Zone
```

## Hvad der bygges (nattens retention-spor, draft-PR med renderede screenshots før merge)

1. `backend/lib/emailTemplates.js`: nyt `wrapHtml` efter layoutet ovenfor (bånd, knapper, rækker), de tre tekster, underskrift Dolmer begge steder (HTML + tekst), wordmark som inline-PNG (lille, data-URI eller hostet under cyclingzone.org).
2. `backend/lib/emailRaceDigestSweep.js`: ny målretning (3 dage, 1 pr. uge, 2 pr. fravær, resultater siden sidste besøg). Tests for hver regel.
3. `emailTemplates.test.js` + `emailRaceDigestSweep.test.js` opdateret.
4. Rendering-bevis: HTML-udgaven af hver mail gemt som fil og screenshot i PR'en (desktop + smal 375 px).
5. Efter merge: dry_run (ejer-GO), derefter nøgler (Resend + unsub-hemmelighed), derefter `on` pr. type efter ejer-ja. Patch note + help.json (EN+DA) ved `on`.
6. DA pr. modtager: **leveret** (opfølger-session 3/9). `users.language` (`'da'` -> dansk, alt andet -> engelsk) læses af de tre sweeps og sendes til `emailTemplates.js`. DA-teksterne står ordret nedenfor.

## DA-oversættelse (leveret 3/9-2026, opfølger-session til denne lås)

Trofast oversættelse af EN-teksterne ovenfor, samme struktur og pladsholdere, Dolmers stemme på dansk (jeg-form hvor Dolmer taler direkte, fx Discord-linjen). Underskriften **"Dolmer, Cycling Zone"** oversættes ikke (navn + produktnavn, uændret på begge sprog). Rendering-bevis: `docs/drafts/mail-render-2026-09-02/*-da.html`.

### Fælles bund (alle fire mails)

```
Er noget i stykker eller uklart? Kom forbi Discord, jeg læser alt.
[Deltag i Discord]  https://discord.gg/ykysBrWUyC

Dolmer, Cycling Zone

Du modtager denne mail fordi du har en Cycling Zone-konto. [Afmeld disse mails]
```

### 1. Welcome (DA)

Subject: `Dit hold er på startlinjen`

```
Hej,

Velkommen til Cycling Zone, og tak fordi du oprettede {{teamName}}. Kom og
gå som du vil, sæsonen kører uanset. Dit hold deltager i løb automatisk. Du
behøver ikke gøre noget for det, men dine ryttere kører bedre, når du gør.

1. Byd på en rytter du kan lide
   Du lærer markedet at kende ved at tabe en auktion eller to.
2. Skriv en ung rytter under kontrakt
   Dit akademi har allerede ryttere klar. Du kan skrive en under kontrakt i dag.
3. Træning og opstilling
   Sæt ugens træning, og vælg hvem der starter dit næste løb.

[Åbn dit dashboard]  https://cyclingzone.org/dashboard
```

### 2. Dag 1 (DA)

#### Variant A, holdet har resultater

Subject: `Dag 1: dine ryttere har allerede kørt`

```
Hej,

{{teamName}} kørte mens du var væk. Resultaterne er klar. Se hvem der
klarede sig godt og hvem der ikke gjorde det, og tjek de auktioner der
lukker i dag, før en anden tager den rytter du ville have.

[Åbn dit dashboard]  https://cyclingzone.org/dashboard
```

#### Variant B, ingen resultater endnu

Subject: `Dag 1: dit første løb er på kalenderen`

```
Hej,

{{teamName}}s første løb er på kalenderen og kører af sig selv. I dag:
tjek de auktioner der lukker i aften, og vælg selv din opstilling til det
første løb. Gør du ingenting, fylder assistenten hullerne, men dine egne
valg er bedre.

[Åbn dit dashboard]  https://cyclingzone.org/dashboard
```

### 3. Digest (DA)

Subject: `{{teamName}} kørte mens du var væk`

```
Hej,

{{teamName}} kørte mens du var væk. Bedste resultater siden dit sidste
besøg:

{{resultLines}}

[Se alle resultater]  https://cyclingzone.org/resultater
```

Resultatlinje pr. løb: `{{rider}}: placering {{rank}} i {{race}}` (eller `{{rider}}: resultater i {{race}}` hvis rangen mangler). "Placering" genbruger det ord `backendMessages.json` allerede bruger til samme koncept, ikke et nyt ord ("plads").
