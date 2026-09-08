# COMMS_PLAYBOOK: spillerkommunikation (SSOT)

> Kilde til sandhed for **hvad** der kommunikeres til spillerne, **hvornår**, **hvor** og **af hvem**.
> Oprettet 2026-09-08 ([#5048](https://github.com/NicolaiDolmer/CyclingZone/issues/5048)) på ejer-beslutningerne i
> [`docs/audits/business-layer-ssot-research-2026-09-08.md`](audits/business-layer-ssot-research-2026-09-08.md) §4.
> **Læs denne FØR du skriver et udkast til spillerne, planlægger en kampagne eller rører ugerytmen.**
>
> Verifikationsniveau er markeret pr. påstand: ✅ målt mod live-system · 📄 fra kode/dokumentation · ❓ uverificeret.
>
> **Grænsen til naboerne.** Stemmen (hvordan der skrives) står i [`TONE_OF_VOICE.md`](TONE_OF_VOICE.md).
> Teknikken bag de sociale flader (Discord-kobling, rollesync, DM-motor, notifikationer, forum-mekanik) står i
> [`SOCIAL_RULES.md`](SOCIAL_RULES.md). Denne fil dækker kadence, kanaler, skabeloner, kampagner og opslags-bank.

## 1. Reglen og rollerne

### 1.1 Den ufravigelige regel

**Der sendes ALDRIG spillerbeskeder på ejerens vegne. AI laver udkast, ejeren poster selv.**
Reglen er låst i [`SOCIAL_RULES.md` §0](SOCIAL_RULES.md#0-den-ufravigelige-regel) og gentages ikke her: læs den dér.
Tre konsekvenser der bider i kommunikationsarbejdet:

1. Et godkendt udkast betyder *"teksten er rigtig"*, ikke *"post den for mig"*.
2. Roadmap-kategorien på forummet er ejerens egen kanal (#4818, ejer 8/9: *"kun jeg opretter, alle svarer"*).
   En agent poster ALDRIG dér, heller ikke via service-role.
3. Tjek altid om ejeren **allerede har postet**, før du leverer et udkast igen. §5 er stedet hvor status står.

### 1.2 Rollefordeling

| Rolle | Gør | Gør aldrig |
|---|---|---|
| **Ejeren** | Skriver al prosa i egen stemme. Poster på alle spillervendte flader. Godkender ordlyd før enhver udsendelse. | |
| **Claude** | Leverer fakta-bullets (verificerede), struktur, `[FOUNDER-PROSA]`-slots, EN først og DA under, klar til copy-paste. Foreslår rækkefølge og timing. Måler effekten bagefter. | Skriver færdig founder-prosa (blokeret indtil #1283 leverer 2-3 godkendte kalibrerings-tekster). Poster. Sender DM'er. |
| **Automatiske systemfeeds** | Sender fordi koden er bygget til det. Se listen nedenfor. | |

### 1.3 Undtagelsen: automatiske systemfeeds 📄

Disse afsender uden et menneske i loopet, fordi de er features i spillet og ikke beskeder fra ejeren
(`SOCIAL_RULES.md` §0 + koden):

| Feed | Hvor | Kilde |
|---|---|---|
| Resultat-feeds til divisionskanalerne | Discord | `SOCIAL_RULES.md` §4 |
| Digest-DM | Discord-DM | `SOCIAL_RULES.md` §4.6 |
| Auktions- og transfer-DM'er | Discord-DM | `SOCIAL_RULES.md` §4.2 |
| Ops-alarmer | Discord (ops) | `backend/lib/emailHealthReport.js` m.fl. |
| Mail-loopet: `welcome`, `day1`, `race_digest` | Mail | `backend/lib/emailTemplates.js`; status 8/9: welcome + day1 = on, race_digest = off ✅ |
| In-app notifikationer (auktion, svar på egen tråd, @-tag m.fl.) | In-app | `backend/lib/notificationTypes.js` |

**Ikke en undtagelse:** en engangsudsendelse via script (typen `admin_notice`, fx survey-invitationen)
er ikke en automatisk feature. Ordlyden godkendes af ejeren FØR scriptet kører; kun selve afsendelsen
er automatiseret. 📄 (`backend/scripts/notify-4376-sponsor-correction.js`, `sendSurveyInvite.mjs`)

### 1.4 Hvem ejer hvad (grænsen mellem de tre docs)

| Spørgsmål | Svar står i |
|---|---|
| Hvordan lyder en sætning? Hvilke ord er forbudte? Hvordan ser en patch note ud? | `TONE_OF_VOICE.md` |
| Hvordan kobles en Discord-konto? Hvem får hvilken DM? Hvad kan forummet teknisk? | `SOCIAL_RULES.md` |
| Hvad postes hvornår og hvor? Hvad er kadencen? Hvordan kører en kampagne? | Denne fil |
| Hvordan måles effekten? Hvad er UTM-konventionen? | `GROWTH_STACK.md` |
| Hvornår sender vi mail, og med hvilken hjemmel? | `EMAIL_STACK.md` |

## 2. Kanaler

Én tabel, én linje pr. flade. Detaljerne står under tabellen.

| Flade | Formål | Hvem poster | Kadence | Sprog | UTM | Verifikation |
|---|---|---|---|---|---|---|
| Discord-server | Community-hjem: rytme, samtale, hurtig feedback | Ejeren + systemfeeds | 3 faste slots/uge (§3) | EN først, DA i tråd eller `#dansk-snak` | På alle links ud af Discord | 📄 kanalnavne fra #428/#4117, ❓ ikke verificeret live 8/9 |
| In-app forum | Ejerens egen langtidsholdbare flade; tråde der overlever en scroll | Ejeren (alle kategorier), spillere (alle undtagen `roadmap`) | Efter behov, `roadmap` ca. månedligt | EN (spillets standardsprog) | Nej (interne links) | ✅ 12 admin-opslag målt 8/9 |
| In-app indbakke og notifikationer | Direkte, sikker rækkevidde til alle managere | Ejer-godkendt script (`admin_notice`) | Sjældent, kun ved noget der ikke må gå tabt | EN + DA (i18n) | Ja, hvis linket peger ud af appen | 📄 `notificationTypes.js` |
| Patch notes | Ændringslog: hvad blev anderledes | Automatisk in-app; ejeren i `#patch-notes` | Ved enhver brugerrettet ændring (hard rule) | EN først, DA under | Nej | 📄 format låst i ToV 14/8 |
| Mail (Resend) | Onboarding og genkald; bredeste rækkevidde | Automatisk (loop) | welcome + day1 automatisk; broadcast kun med ejer-go | EN + DA | Ja, altid | ✅ welcome + day1 on 8/9 |
| Reddit | Tilgang udefra: nye managere | Ejeren | Én community ad gangen, aldrig batch | EN | Ja, pr. community | 📄 #2236 |
| Hattrick-forum | Nærmeste beslægtede publikum (browser-manager-spillere) | Ejeren | Sjældent, regel-tjek først | EN | Ja | ✅ 3 signups attribueret til hattrick.org |
| AI-assistenter (ChatGPT, Perplexity m.fl.) | Indirekte kanal: de citerer offentligt indhold | Ingen (kan ikke postes til) | n/a | EN | Kan ikke sættes | ✅ 10 signups m. `utm_source=chatgpt.com` |
| Marketing-site (`marketing/`) | Søgemaskine-landing uden for appen | Deploy | n/a | EN + DA | Modtager UTM | 📄 merget 2/9, endnu intet eget Vercel-projekt |

### 2.1 Discord 📄

Serveren er guild `1504615050831466669` (`backend/lib/discordRoleSync.js`). Kanalnavne der er i brug i
kommunikations-issues og opslags-banken:

`#the-roadbook` · `#feedback-and-ideas` · `#team-showcase` · `#general` · `#questions-and-answers` ·
`#patch-notes` · `#annoncements` · `#dansk-snak` · `#bugs` · `#samlet-feedback-features-og-bugs` ·
`#feedback-from-dolmer` (ejerens egen indgang, læses af den daglige triage, §6).

❓ **Ingen af navnene er verificeret mod den levende server.** Discord-MCP'en kunne ikke forbinde 8/9.
Navnene stammer fra #428 (genskrevet 22/8) og #4117 (postplan 21/8), som begge er skrevet efter at de
gamle navne (`#sæson-resultater`, `#hold-showcase`) forsvandt. Verificér én gang i serveren og ret her,
i stedet for at gætte i et udkast.

**Discord-appen sender ingen referrer.** Klik fra Discord lander som "direct" i analytics. UTM er derfor
den eneste måde at se om et opslag virkede, se `GROWTH_STACK.md`.

### 2.2 In-app forum ✅

Syv kategorier 📄 (`database/2026-09-08-4818-forum-roadmap-category.sql`, labels i
`frontend/public/locales/*/forum.json`):

| Slug | EN-label | Hvem må oprette tråde |
|---|---|---|
| `roadmap` | Roadmap | **Kun admin** (ejeren). Alle må svare. |
| `general` | General | Alle |
| `feedback_ideas` | Feedback & ideas | Alle |
| `questions` | Questions & answers | Alle |
| `tactics` | Tactics & strategy | Alle |
| `transfers` | Transfers | Alle |
| `off_topic` | Off-topic | Alle |

Roadmap-kategorien gik live 8/9 og har **0 opslag** pr. 8/9 ✅. Det første opslag dér er ejerens, og det
er den billigste måde at gøre kategorien synlig på.

### 2.3 In-app indbakke og notifikationer 📄

Typen `admin_notice` er den generiske ejer-til-alle-kanal (`backend/lib/notificationTypes.js`). Den er
dyr at bruge for tit og umulig at trække tilbage. Brug den kun til noget der ikke må gå tabt: en
sæsonovergang, en beklagelse, en invitation der har en deadline. Discord-invitationen i indbakken er
stadig et åbent spor (#2761).

### 2.4 Patch notes 📄

Format og pligt er låst i `TONE_OF_VOICE.md` (låst 14/8). To ting hører hjemme her:

- **Skriv aldrig en separat Discord-tekst.** Discord får titlen plus feltet "What changed", ordret.
- Patch notes er råstoffet til mandagens uge-note (§3). Har du skrevet dem, er uge-noten næsten skrevet.

Selve produktions-SSOT'et for begge flader (site + Discord) er stadig udestående, se #4521.

### 2.5 Mail

Typer, gates, samtykke-hjemmel og drift-tærskler står i [`EMAIL_STACK.md`](EMAIL_STACK.md), flip- og
rollback-trinene i [`EMAIL_LOOP_GO_LIVE_RUNBOOK.md`](EMAIL_LOOP_GO_LIVE_RUNBOOK.md). Kommunikations-reglen
her: **en broadcast til spillerne er en udsendelse, ikke en feature.** Den kræver ejer-go på den konkrete
ordlyd, og den skal respektere `users.email_prefs` og samtykke.

### 2.6 Reddit 📄

Rules of engagement fra #2236, gælder uden undtagelse:

- **90/10:** deltag ægte før selvpromo. Kold promo bliver fjernet.
- **Aldrig et bart link.** Historie først, link sidst.
<!-- tone-check-terms:disable (reglen citerer den forbudte frase) -->
- **Ingen emoji i Reddit-opslag** (fint på Discord). Ingen em-dash. Aldrig "free forever".
<!-- tone-check-terms:enable -->
- UTM pr. community: `?utm_source=reddit&utm_medium=community&utm_campaign=<community>`
- **Læs subreddittets live-sidebar én gang før posting.** Det er den eneste autoritet.

Kendte communities: r/procyclingmanager (testet, kendte regler), r/peloton (utestet kandidat, sandsynligvis
thread-gated). Bevidst fravalgt: r/cycling, r/bicycling (promo-ban), r/pelotoncycling (forkert emne).
Tier-listen og trackeren ligger i #2236.

### 2.7 Hattrick-forum ✅

3 signups er attribueret til `hattrick.org` i `signup_attribution` (målt 8/9). Publikummet er beslægtet
(browser-manager, langsom kadence, gammelt community), og en Hattrick-spiller i vores eget community har
selv peget på Hattrick som model (#4235). Samme regler som Reddit: læs forumreglerne først, historie før link.

### 2.8 AI-assistenter ✅

Kan ikke postes til. De citerer offentligt indhold, så kanalen påvirkes kun indirekte via marketing-sitet,
Reddit-tråde og alt andet der er offentligt læsbart. Målt 8/9: 10 signups med `utm_source=chatgpt.com` og
9 med chatgpt.com som referrer-domæne. Kanal-gruppen og målingen defineres i `GROWTH_STACK.md` (#4322).

### 2.9 UTM-reglen

**Ethvert link der postes uden for appen bærer UTM.** Format (konventionen bor i `GROWTH_STACK.md` §3):

```
?utm_source=<kanal>        discord | reddit | hattrick | email | chatgpt-ads | ...
&utm_medium=<type>         community | social | email | paid
&utm_campaign=<anledning>  fx s4-launch
```

Interne links (in-app forum, indbakke) får ikke UTM: de forurener kun attributionen.

## 3. Ugerytmen

Ejer-mandat 22/8 (#428): *"Det er vigtigt, at jeg fast kommunikerer med spillerne."* Tre slots, ikke seks.
Maj-versionen havde tre slots plus en parallel drifts-rytme plus Feature Friday, og ingen af dem kørte.

| Dag | Slot | Kanal | Effort | Hvad Claude leverer dagen før |
|---|---|---|---|---|
| **MANDAG** | Uge-note: hvad shippede, hvad bygger jeg nu | `#the-roadbook` | ~10 min | Ugens patch notes destilleret til maks 3 bullets + tallene fra `scripts/monday-numbers.mjs` |
| **ONSDAG** | Ét spørgsmål til spillerne | `#feedback-and-ideas` | ~5 min | 2-3 kandidat-spørgsmål fra opslags-banken (§5) + ugens patch-note-anker |
| **SØNDAG** | Ugens øjeblik | `#team-showcase` eller `#general` | ~10 min | 2-3 kandidater fra weekendens resultater og forum-aktivitet, ikke kun toppen af D1 |

**Ejer-beslutning 22/8:** søndag, ikke fredag. Feature Friday findes ikke længere som rytme, og søndag
rammer weekend-aktiviteten hvor der faktisk køres løb.

### 3.1 Den faste distributionsdag (ejer 8/9)

Ud over de tre slots har ejeren **én fast dag om ugen, 4-6 timer**, til distribution: outreach udefra
(Reddit, Hattrick, andre communities), kampagne-arbejde og marketing-sitet. De tre slots er
fastholdelse (dem der allerede er her), distributionsdagen er tilgang (dem der ikke er). De konkurrerer
ikke om den samme time. Rammerne for hvad dagen bruges på står i `GROWTH_STACK.md`.

### 3.2 Delegering

Onsdags-slottet kan delegeres til en frivillig moderator når community er etableret
(**≥30 aktive**, antagelse fra #428). De to andre slots er ejerens stemme og delegeres ikke.

### 3.3 Slot-skabeloner

Fakta-felter fyldes af Claude. Prosaen skriver ejeren i `[FOUNDER-PROSA]`-slottene, jf.
`TONE_OF_VOICE.md` "Founder voice: template". EN først, DA under. Emoji er tilladt i Discord (ToV,
låst beslutning 1: ren editorial gælder akkvisitions-flader), men skabelonerne herunder er uden, så
ejeren tilføjer dem hvor de er hans egne.

**MANDAG: uge-note**

```
EN:
This week in Cycling Zone

Shipped: [maks 3 bullets, ordret fra "What changed" i ugens patch notes]
Building now: [1-2 linjer om det aktive spor]

[FOUNDER-PROSA: ejer binder det sammen, jeg-stemme, 2-4 sætninger.]

Full patch notes: [link]

DA (i tråd nedenunder):
Ugen i Cycling Zone
Sendt live: [samme bullets]
Bygger nu: [samme linje]
[FOUNDER-PROSA: samme, på dansk]
Alle patch notes: [link]
```

**ONSDAG: ét spørgsmål**

```
EN:
[FOUNDER-PROSA: ejer skriver ét spørgsmål. Aldrig et blankt stykke papir:
Claude leverer 2-3 kandidater fra opslags-banken.]

React: [emoji A] = [valg A] · [emoji B] = [valg B]

Context: [1 linje fakta, fx hvad der lige er ændret og hvorfor spørgsmålet stilles nu]

DA (i tråd eller #dansk-snak): [samme]
```

Poll-resultatet er råstof til mandagens uge-note eller til en patch note. Genbrug det.

**SØNDAG: ugens øjeblik**

```
EN:
Moment of the week: [manager eller hold]

What happened: [fakta: løb, resultat, transfer, point-delta. Ét tal, ikke fem.]

[FOUNDER-PROSA: ejer skriver hvorfor netop dette øjeblik, 2-4 sætninger.]

DA (i tråd nedenunder): [samme]
```

Rotér. Ikke kun toppen af D1: et øjeblik fra D3 er mere værd, fordi flere kan genkende sig i det.

## 4. Kampagne-skabelon

En kampagne er en samlet udsendelse om én anledning på tværs af flader. Første anvendelse:
**sæson 4, der starter 27/9** (📄 ejer 8/9). Opfind ingen andre datoer.

### 4.1 Skabelon

| Felt | Indhold |
|---|---|
| **Anledning** | Hvad sker der, og hvorfor er det interessant for en spiller? |
| **Mål** | Ét tal, målbart inden for 7 dage (fx signups, genaktiverede sovende, svar i en tråd). |
| **Budskab** | Én sætning, EN først. Alt andet er variationer over den. |
| **Kanaler** | Kun dem hvor budskabet holder. En kanal uden et ægte budskab koster mere end den giver. |
| **Rækkefølge** | forum → Discord → Reddit → mail (§4.2) |
| **UTM** | Én `utm_campaign` for hele kampagnen (fx `s4-launch`), `utm_source` pr. kanal. |
| **Måling** | 48 timer + 7 dage (§4.3) |
| **Ejer-go** | Ordlyd pr. flade, godkendt før første opslag. |

### 4.2 Rækkefølgen og hvorfor

1. **Forum først.** Ejerens egen flade. Tråden er landingspladsen alt andet kan pege på, og den overlever
   en scroll. Roadmap-kategorien hvis det er en retningsmelding, `general` hvis det er en begivenhed.
2. **Discord derefter.** Distribution, ikke duplikat: kort tekst plus link til forum-tråden.
3. **Reddit tredje.** Kun hvis der er en historie at fortælle. 90/10-reglen gælder, og opslaget skal kunne
   stå alene for en der aldrig har hørt om spillet. Aldrig samme dag som Discord, så der er noget at linke til.
4. **Mail sidst.** Bredest, mest irreversibel. Kun med ejer-go, kun til dem der ikke har afmeldt, og kun
   når de tre andre flader allerede bærer historien.

### 4.3 Måling

| Vindue | Hvad aflæses |
|---|---|
| **48 timer** | Upvotes og kommentarer pr. eksternt opslag; signups inden 48 timer efter opslaget; svar i forum-tråden. |
| **7 dage** | Signups pr. `utm_campaign`; hvor mange af dem der stadig er aktive dag 7; effekt på ugens tre slots. |

Definitionerne af "aktiv" og "signup" ejes af `ANALYTICS_STACK.md`. Brug dem, opfind ikke nye.

### 4.4 Tjekliste før første opslag

- [ ] Ordlyden er godkendt af ejeren pr. flade (ikke "godkendt i princippet")
- [ ] Ingen forbudte termer (§7), ingen em-dash, ingen emoji i Reddit-opslaget
- [ ] EN først, DA under eller i tråd
- [ ] Alle eksterne links bærer UTM, samme `utm_campaign`
- [ ] Forum-tråden findes FØR Discord-opslaget peger på den
- [ ] Påstande om spillet er verificeret mod koden (community-copy har før påstået at shippede features manglede)
- [ ] Aftalt hvornår tallene aflæses, og af hvem

### 4.5 Roadbook-udkast

Roadbook-opslag (`#the-roadbook`, forum-kategorien `roadmap`) er en særlig genre: **ingen tidspunkter,
ingen tal, glad tone.** Et roadbook-opslag der lover en dato skaber en gæld; et der lover en retning skaber
forventning. Claude leverer retningen og fakta om det der allerede er shippet, aldrig et løfte om hvornår.

## 5. Opslags-bank

To banker med færdigt materiale. **Post dem ikke på én gang:** 13 tråde til 67 Discord-medlemmer giver
13 halvdøde tråde (#4117).

### 5.1 De 13 community-tråde (#4117) 📄

Færdigskrevne EN-opslag i [`docs/discord/2026-08-21-community-traade-en.md`](discord/2026-08-21-community-traade-en.md).
Status kan ikke verificeres uden Discord-adgang (MCP nede 8/9), så alle står som ❓.

| # | Titel | Kanal (foreslået) | Postet? |
|---|---|---|---|
| 1 | Marketing: how would you market this game? | `#feedback-and-ideas` | ❓ |
| 2 | The race engine dream | `#feedback-and-ideas` | ❓ |
| 3 | The tactics screen (**gate:** kun hvis motor v4 er flippet) | `#feedback-and-ideas` | ❓ |
| 4 | The September vote (2 beskeder) | `#feedback-and-ideas` | ❓ |
| 5 | Roadmap, next 3 months (**gate:** /pro-blokken, se issuet) | `#the-roadbook` + kort i `#annoncements` | ❓ |
| 6 | Dashboard | `#feedback-and-ideas` | ❓ |
| 7 | U23 and junior | `#feedback-and-ideas` | ❓ |
| A | What nearly made you quit | `#feedback-and-ideas` | ❓ |
| B | Your first week | `#feedback-and-ideas` | ❓ |
| C | Season 2 in one screenshot (**ejeren poster selv først, ellers dør tråden**) | `#team-showcase` | ❓ |
| D | The money | `#feedback-and-ideas` | ❓ |
| E | The help section | `#questions-and-answers` | ❓ |
| F | Predict season 3 | `#general` | ❓ |

Fire korte DA-pointere til `#dansk-snak` ligger nederst i filen. **Dele af materialet er sæson-bundet**
(C og F handler om sæson 2 og 3): læs gaten i filen før genbrug i sæson 4.

### 5.2 De 9 forum-emner (#4820) ✅ delvist

Ejer-direktiv 4/9. Status målt i `forum_posts` 8/9 (read-only SQL, admin-oprettede tråde).

| Emne | Postet? | Bevis |
|---|---|---|
| Pro fordele | ✅ ja, 7/9 | "The future of: Cycling Zone \"Pro\"", 4 svar |
| U23/juniorhold | ✅ ja, 7/9 | "The future of: Youth and academy", 6 svar |
| Nationale mesterskaber | ❌ nej | ingen tråd |
| Sæson 4 ruterne | ❌ nej | ingen tråd |
| Ansigter på ryttere og personale | ❌ nej | ingen tråd |
| Personligheder på ryttere og personale | ❌ nej | ingen tråd |
| Spiller-identitet | ❌ nej | ingen tråd |
| Recruit a friend | ❌ nej | ingen tråd |
| Spørgeskema (hvad er vigtigst / hvad fungerer dårligst) | ✅ åbent 8/9 | #4943, 32 startet og 23 gennemført ✅ |

To tråde ud over de ni blev postet 7/9 i samme serie: "The future of: The race engine" (6 svar) og
"The future of: The staff feature" (2 svar). Serien virker: median 5 svar pr. tråd. ✅

I alt 12 admin-oprettede forum-tråde nogensinde, hvoraf 2 er test-tråde fra 6/8 ✅.

## 6. Svar og triage

### 6.1 Daglig triage 📄

`scripts/discord/sweep-daily.mjs` surfacer nye beskeder fra `#general`, `#questions-and-answers`,
`#dansk-*`, `#feedback-from-dolmer` og forum-tråde. Rutinen (#2758, ejer 20/7) er: sweep → opret eller
berig GitHub-issue → dedup mod eksisterende. **Det der mangler er ikke sweepen, det er svaret.**
Ubesvarede spørgsmål er det dyreste signal en spiller kan få.

Ejer-DM'er triageres med skillen `discord-dm`: issue plus svarudkast på EN og DA.

### 6.2 Svartids-mål

| Mål | Tærskel | Kilde |
|---|---|---|
| Åbne spillerspørgsmål besvaret | inden **48 timer** | #428 acceptance |
| Forum-tråde besvaret | **≥70 % inden 24 timer** | #4235, aflæses 15/9 |
| Forum-skribenter pr. 30 dage | ≥27 (30 % af aktive), baseline 15 | #4235 |
| Forum-opslag pr. uge | ≥8, baseline 4,4 | #4235 |

### 6.3 Anonymisering

Repoet er publicly viewable. Spillernavne, Discord-handles, mailadresser og skærmbilleder med
identificerbare konti hører ikke i issues, docs eller commits. Beskriv rollen ("en manager i D3"),
ikke personen. Skillen `discord-dm` anonymiserer automatisk; gør det samme i hånden.

## 7. Ordliste

### 7.1 Tilladte produkttermer

| Term | Betydning |
|---|---|
| **CZ Pro** | Det eneste betalte produkt. 49 kr./md eller 265 kr./6 md (EUR 6,49 / 34,99). `BILLING_STACK.md` §2. |
| **Founder** | Tidlig-status, ikke en betalt tier. Brug ordet alene. |
| **open beta** / **tester** | Fasen vi er i. Brug den. |
| **premium** (lille p, som alment ord) | Om begrebet betalt lag, ikke som produktnavn. ToV tillader det eksplicit. |
| **CZ$** | Spillets egen valuta. |
| **euro** | Engelsk tekst om rigtige penge skriver euro, aldrig kroner (ejer 21/8). |

### 7.2 Forbudte termer

<!-- tone-check-terms:disable (tabellen herunder NÆVNER de forbudte termer for at forbyde dem) -->

| Term | Hvorfor |
|---|---|
| **Premium** som tier-navn, **Pro Analyst**, **Patron** | Døde 8/9. Der er ét tier: CZ Pro. |
| **Founder Supporter** som samlet navn | Ejer: *"lyder åndsvagt"*. Brug Founder eller Supporter alene. |
| **"free forever"** | Aldrig som markedsførings-frase. Spillet er gratis og forbliver gratis, men ikke med de ord. |
| **"støt" / "support"** som verbum om CZ Pro | Det er en transaktion, ikke velgørenhed. Brug "back the project", "go Pro". |
| **freemium**, **fair-freemium** | Intern jargon. |
| **sprint**, **validation**, **Go/No-Go**, **day 30**, **runway**, **power features** | Intern jargon. |
| **em-dash** | Aldrig, nogen steder. Komma, punktum, kolon eller parentes. |
| **"fuldtid" / "full-time"** om ejeren | Ikke sandt før indtægten dækker leveomkostninger. |

<!-- tone-check-terms:enable -->

Fuld liste og begrundelser: [`TONE_OF_VOICE.md`](TONE_OF_VOICE.md) "Ord og termer".
Guard: `node scripts/tone-check-terms.mjs` (§8.4).

## 8. Åbne punkter, faldgruber, relateret

### 8.1 Åbne punkter pr. 2026-09-08

| # | Sag | Blokerer |
|---|---|---|
| [#4235](https://github.com/NicolaiDolmer/CyclingZone/issues/4235) | Forum vs Discord: hvilken flade bærer communityet? Beslutning **15/9** på tærsklerne i §6.2 | Kanal-prioritering i §2 |
| [#1283](https://github.com/NicolaiDolmer/CyclingZone/issues/1283) | Founder-stemme: 2-3 ejer-godkendte kalibrerings-tekster mangler | AI må ikke skrive færdig founder-prosa |
| [#4521](https://github.com/NicolaiDolmer/CyclingZone/issues/4521) | Patch-notes-produktions-SSOT (site + Discord) | §2.4 er ufuldstændig |
| [#2761](https://github.com/NicolaiDolmer/CyclingZone/issues/2761) | Discord-invite i in-app-indbakken (ny + backfill) | Discord-vækst fra eksisterende managere |
| [#4820](https://github.com/NicolaiDolmer/CyclingZone/issues/4820) | 7 af 9 forum-emner ikke postet (§5.2) | Indholdsplanen |
| [#4117](https://github.com/NicolaiDolmer/CyclingZone/issues/4117) | Status på de 13 tråde er ukendt (§5.1) | Kan ikke planlægge uden at vide hvad der er postet |
| ❓ | **Discord-kanalnavnene er ikke verificeret live** (MCP nede 8/9) | Et udkast med et forkert kanalnavn |
<!-- tone-check-terms:disable (rækken herunder navngiver den drift den beskriver) -->
| ❓ | **Døde tier-navne er live på `/founder-supporter`**: `frontend/public/locales/{en,da}/founder.json` viser stadig et 4-tier-katalog (Premium 49, Pro Analyst 89, Patron 149), mens produktet er ét tier. Ruten er aktiv i `App.jsx`. Rettelsen er en spillervendt copy-beslutning, ikke en docs-rettelse | Ejer-go på ordlyd |
<!-- tone-check-terms:enable -->

### 8.2 Faldgruber

1. **Discord-appen sender ingen referrer.** Klik fra Discord ser ud som "direct". Uden UTM kan du ikke se
   om et opslag virkede, og du vil konkludere forkert på selv-referral-tallene.
2. **En tråd uden ejer-opslag dør.** Det gælder både Discord-tråde og forum-kategorier. Roadmap-kategorien
   har 0 opslag: en tom kategori er værre end ingen kategori.
3. **13 tråde på én gang giver 13 døde tråde.** Bank-materiale postes spredt, aldrig som batch.
4. **Ingen em-dash. Ingen emoji i Reddit.** Begge er lette at overse i copy-paste fra et udkast.
5. **Kanalnavne drifter.** Maj-versionen af #428 pegede på to kanaler der ikke fandtes længere, og
   rytmen kørte aldrig. Verificér navnet før du skriver det ind i et udkast.
6. **Discord-patch-noten er et udsnit, ikke en ny tekst.** Skriver du en selvstændig Discord-version,
   holder den op med at blive skrevet, og backloggen vokser (det skete fra v7.112 til v7.120).
7. **"Godkendt udkast" er ikke "post den for mig".** §1.1.
8. **Community-copy skal verificeres mod koden.** Et udkast har før bedt om features der allerede var
   shippet (`.claude/learnings/2026-08-21-community-copy-claimed-unshipped-features.md`).
9. **Tal i et opslag ældes.** Skriv tallet med sin dato, eller lad være med at skrive det.

### 8.3 Relateret

- [`TONE_OF_VOICE.md`](TONE_OF_VOICE.md) · stemme, forbudte termer, patch-notes-format, founder-skelet
- [`SOCIAL_RULES.md`](SOCIAL_RULES.md) · §0-reglen og hele den tekniske sociale flade
- [`GROWTH_STACK.md`](GROWTH_STACK.md) · UTM-konvention, mandagstal, distributionsdagen, kanal-måling
- [`ANALYTICS_STACK.md`](ANALYTICS_STACK.md) · definitioner af aktiv, signup, retention
- [`EMAIL_STACK.md`](EMAIL_STACK.md) + [`EMAIL_LOOP_GO_LIVE_RUNBOOK.md`](EMAIL_LOOP_GO_LIVE_RUNBOOK.md) · mail
- [`FORUM_RULES.md`](FORUM_RULES.md) · forummets indhold og moderation
- [`docs/discord/2026-08-21-community-traade-en.md`](discord/2026-08-21-community-traade-en.md) · de 13 tråde
- [`docs/comms/2026-06-21-relaunch-comms-kit.md`](comms/2026-06-21-relaunch-comms-kit.md) · proces-skabelon med `[FOUNDER-PROSA]`-slots
- [`docs/audits/business-layer-ssot-research-2026-09-08.md`](audits/business-layer-ssot-research-2026-09-08.md) · research og ejer-beslutninger bag denne fil

### 8.4 Drift-tjek

```bash
node scripts/tone-check-terms.mjs
node scripts/tone-check-em-dash.mjs
```

Første guard fejler på de døde produkttermer fra §7.2 i spillervendte locales, i `TONE_OF_VOICE.md`,
i denne fil og i nye patch notes. Anden guard fejler på em-dash i player-facing copy. Begge kører i CI
via `npm run check:i18n`, og dermed også i `scripts/preflight-pr.ps1`.

Skal en doc nævne en forbudt term for at forbyde den, pakkes afsnittet ind i
`<!-- tone-check-terms:disable -->` og `<!-- tone-check-terms:enable -->`, som i §7.2.
