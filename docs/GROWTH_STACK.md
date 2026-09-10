# GROWTH_STACK: tilgang og vækst (SSOT)

> Kilde til sandhed for hvordan nye spillere kommer ind, hvad vi måler dem på, og hvem der gør hvad.
> Oprettet 2026-09-08 (#5048), efter modellen i [`BILLING_STACK.md`](BILLING_STACK.md). **Læs denne FØR du rører kanaler, kampagner eller mandagstal.**
>
> Verifikationsniveau er markeret pr. påstand: ✅ målt mod live-system · 📄 fra kode/dokumentation · ❓ uverificeret.
>
> Grundlaget for dokumentet: [`docs/audits/business-layer-ssot-research-2026-09-08.md`](audits/business-layer-ssot-research-2026-09-08.md) (måling + ejer-beslutninger 8/9). Absorberer mandagstals-proceduren fra [30-dages pengeplanen](superpowers/specs/2026-09-02-30-dages-pengeplan.md) §0.9; pengeplanen forbliver en tidsbegrænset plan og linker hertil.

## 1. Nordstjerne og mandagstal

### 1.1 Nordstjernen

**Nordstjernen er `aktive/7d`:** antal brugere med et menneskehold der har været aktive inden for de seneste 7 dage. 📄 Definitionen er consent-uafhængig og navngivet i ANALYTICS_STACK (aktivitet = `users.last_seen` ∪ `player_events` ∪ `auction_bids` ∪ manuelle `race_entries` ∪ `xp_log` ∪ forum-skrivning). `player_events` alene er samtykke-gated og må aldrig stå alene som aktivitetsmål.

Hvorfor lige det tal: økonomien er ikke et konverteringsproblem. ✅ 8/9 er der 17 til 18 betalende abonnementer mod 74 aktive/7d, altså omkring en fjerdedel. (Bemærk: at hver betaler også er aktiv/7d er ikke verificeret, så de to tal er et forhold, ikke en konverteringsrate.) 📄 ARPU er ~37 kr. ekskl. moms, så et levebrød på 25.000 kr./md. kræver i omegnen af 680 betalende og dermed tusindvis af aktive spillere. **Tilgang er flaskehalsen, ikke konvertering.**

### 1.2 De tre mandagstal

Måles **hver mandag** som ugens første handling. Rækkefølgen er fast, så en uge kan sammenlignes med den forrige.

| # | Tal | Kilde | Hvorfor |
|---|---|---|---|
| 1 | MRR ekskl. moms + aktive abonnementer | Alunta MCP `get_business_overview` krydset med `subscriptions` (`status in (active,past_due)` og `alunta_subscription_id` sat) | Pengene. Alunta er sandheden ved uenighed; vores tabel er en cache (`BILLING_STACK.md` §5) |
| 2 | D7 for seneste fulde kohorte | RPC `get_cohort_retention(6)`, seneste uge med `d7_eligible >= 5` | Om nye spillere bliver hængende. Kohorte-D7, ikke rullende D7 |
| 3 | Checkout gennemført / startet, rullende 7 dage | `subscriptions.terms_accepted_at` mod `last_event_id like 'checkout.completed%'` | Om betalingsvejen er tæt |

Derudover aflæses hver mandag: nordstjernen (aktive 1d/7d/30d), signups pr. uge de sidste fem uger, kanal-tabellen fra `signup_attribution`, og antal sovende med mail-samtykke.

### 1.3 Hvem måler, og hvor tallene skrives

- **Claude (Code) mandag morgen, som ugens første handling.** Ikke ejeren.
- Kommandoen er ét script, ikke håndholdt SQL:

```bash
infisical run --env=prod -- node scripts/monday-numbers.mjs
```

- Outputtet skrives som **én linje i §12 "Log"** nedenfor. Nyeste øverst.
- MRR hentes særskilt via Alunta MCP `get_business_overview` (REST-API'et eksponerer ikke MRR) og skrives ind i samme log-linje.

> **Tal hører til i Log, ikke i prosa.** MRR er tidligere hardkodet tre forskellige steder (pengeplanen 188 kr., `NOW.md` 436 kr., Alunta 659 kr.) og alle tre var forældede samtidig. Dokumentet bærer formlen og proceduren; tallet bor i loggen.

### 1.4 Baseline 8/9 og mål 2/10

Baseline ✅ målt 8/9 kl. 20:47 (scriptets output, se §12):

| Mandagstal | Baseline 8/9 | Mål 2/10 (pengeplan §2) | Status |
|---|---|---|---|
| MRR ekskl. moms / aktive abonnementer | 659,33 kr. / 18 (Alunta), 17 (vores tabel) | >= 450 kr. / >= 10 | **Målet er allerede slået** |
| Checkout gennemført / startet, 7 d | 16 / 19 (84 %) | >= 60 % | **Målet er allerede slået** |
| D7 seneste fulde kohorte | 30,0 % (uge 24/8, 20 berettigede) | >= 45 % | Ikke nået |
| Aktive/7d | 74 | >= 100 | Ikke nået |
| Mail-loop | welcome + day1 = on, digest = off | on, 0 failed | Delvist |

To af fem mål er slået to en halv uge før deadline. De tre der mangler er alle på **tilgang og fastholdelse**, ikke på penge. Det er den samme konklusion som §1.1.

## 2. Kanaler

### 2.1 Hvad der er målt

📄 Hattrick og self-referral genkendes på præcist værtsnavn eller et underdomæne med punktum som grænse. Et domænenavn indlejret i et fremmed værtsnavn, URL-sti eller brugerinfo tæller ikke som den kanal. Eksplicit `utm_source` har fortsat forrang; domænemærker følger samme grænse. Regressionstest: `scripts/monday-numbers.test.mjs` (CodeQL #357/#358).

✅ Målt 8/9 mod `signup_attribution` (152 rækker i alt, sidste 30 dage i egen kolonne). Kanal bestemmes af `utm_source` hvis den findes, ellers af referrer-værtsnavnet (§3.4).

| Kanal | Sidste 30 d | I alt | Kendt konvertering |
|---|---:|---:|---|
| (direct / ukendt) | 24 | 76 | Kan ikke opgøres, se §3.2 |
| Søgning (organisk: Google, Bing, DuckDuckGo) | 13 | 24 | ~1 % 📄 (#3796, analyse 15/8) |
| Reddit (web + app) | 2 | 19 | ~8 %, bedste kanal 📄 (#3796) |
| AI assistant (ChatGPT m.fl.) | 4 | 11 | Ikke opgjort |
| Email, vores egne mails (Gmail-app-referrer) | 2 | 11 | Ikke opgjort |
| Hattrick-fora | 1 | 8 | ~2 % 📄 (#3796) |
| dugout-online.com | 1 | 2 | Ikke opgjort |
| Self-referral | 1 | 1 | Måle-artefakt, ikke en kanal |

**AI assistant er en selvstændig kanal** (#4322), ikke støj i referrer-listen. Gruppen samler `chatgpt.com`, `perplexity.ai`, `claude.ai`, `copilot.microsoft.com`, `gemini.google.com`. ChatGPT alene leverede 27/8 flere signups end DuckDuckGo, Bing og dugout-online tilsammen. 7 af de 10 kom ind med `utm_source=chatgpt.com`, altså ChatGPT's egen mærkning, ikke vores. Definitionen findes ét sted i kode: `AI_ASSISTANT_HOSTS` i `scripts/monday-numbers.mjs`.

**Gmail-app-referreren er ikke en tredjepartskanal.** `android-app://com.google.android.gm/` betyder at nogen klikkede et link i en mail fra os (eller videresendte spillet pr. mail). Den tælles derfor som "vores egne mails". 📄 (#3796-kommentar 27/8).

### 2.2 Hvad der ikke findes

Tre kanaler man kunne tro vi har. Vi har dem ikke:

| Kanal | Status | Detalje |
|---|---|---|
| **Referral / invitér en ven** | Findes ikke i kode 📄 | Ejer-beslutning 23/7 (#1173): trappet belønning, 7 dages Pro for en ven der bliver aktiv, 1 måneds Pro hvis vennen betaler. Afhængighed: Pro skal låse noget op, ellers er belønningen tom. Uafklaret: hvad "bliver aktiv" betyder, og hvordan selv-referral med flere konti forhindres |
| **Betalte annoncer** | Ikke startet 📄 | Ejer-direktiv 20/7 (#2759). **Ejer-beslutning 8/9:** én lille test på 500 til 1.000 kr. (Reddit/Facebook, UTM-tagget) i ugen op til S4 (starter 28/9). Claude leverer udkast og målgruppe, ejeren godkender budget. **Betinget af G4-princippet, se §4.3** |
| **SEO-site** | Deployet på eget Vercel-subdomæne, ikke koblet til cyclingzone.org ✅ | `marketing/` (Next.js App Router) er merget 2/9 (#4659) med `/`, `/how-it-works`, `/pro-cycling-manager-alternative` + `/da/...`. Vercel-projektet `cycling-zone-marketing` er git-koblet og bygger fra main; sitet er live på https://cycling-zone-marketing.vercel.app (verificeret 8/9 kl. 21:05 med curl: forside, `/da`, `/how-it-works`, `/da/saadan-fungerer-det`, `/pro-cycling-manager-alternative`, sitemap og robots svarer 200). Mangler stadig rewrites fra cyclingzone.org (separat PR, ejer-go). Forsiden er indtil videre `LandingPage.jsx` prerenderet på engelsk. Google-indeks: 1 side (målt 21/8, #4067) |

### 2.3 Kanaler vi bevidst ikke bruger

📄 (#2236). Dokumenteret så beslutningen ikke skal tages om: r/InternetIsBeautiful (signup-væggen blokerer), r/incremental_games (forkert genre), r/cycling og r/bicycling (promo-forbud), r/pelotoncycling (handler om Peloton-fitness, ikke cykelsport), r/footballmanagergames (konkurrent-promo, kun tone-reference).

## 3. Attribution

### 3.1 Mekanikken (first-touch)

📄 `frontend/src/lib/attribution.js` + `backend/lib/signupAttribution.js`.

```
Første besøg   → captureFirstTouch() skriver UTM + referrer + landing_path
                 til localStorage["cz_attribution_v1"]. Skriver ÉN gang, første besøg vinder.
Holdoprettelse → PUT /api/teams/my (kun når result.created === true) sender payloaden med;
                 backend/routes/api.js skriver rækken til signup_attribution (service_role-only).
Aflæsning      → GET /api/admin/attribution, Attribution-fanen i AdminGrowthPage.
```

Feltet er bevidst uafhængigt af analytics-samtykket: first-touch sker før cookie-banneret er besvaret, og intet persisteres før brugeren opretter en konto. Hjemmel: legitim interesse (vurdering, ikke juridisk efterprøvet); om privatlivspolitikken nævner det, er ikke tjekket ❓

**Dækning:** ✅ 123 af 137 signups de seneste 60 dage er attribueret, altså 90 % (målt 8/9). De 10 % uden række er typisk brugere der aldrig fik oprettet et hold, eller hvor localStorage var blokeret.

### 3.2 Hvad referrer aldrig fanger

- **Discord.** Discord-appen sender ingen referrer. Alle klik derfra tæller som direct. ✅ Der er 0 rækker med discord-referrer i 152 rækker, mens 32 af 241 menneskehold har Discord koblet: kanalen findes, referreren gør ikke.
- **Mund til mund.** "En ven nævnte det" har intet teknisk spor.
- **Delte links i beskedapps** uden for browseren.

Derfor er "(direct / ukendt)" med 76 af 152 rækker ikke en kanal. **Det er hullet.** Læs den række som "ukendt", aldrig som "kom af sig selv".

### 3.3 "Hvor hørte du om os?"

📄 Ikke bygget (#3796). Foreslået leverance: valgfri dropdown ved onboarding (Discord / Reddit / søgemaskine / ven eller bekendt / forum / AI-chatbot / andet), gemt som `self_reported_source` sammen med first-touch-rækken, service_role-only RLS som resten af tabellen, med i Attribution-fanen og CSV-eksporten. Det er den eneste mekanisme der kan udfylde hullet i §3.2.

### 3.4 UTM-konventionen (bindende)

📄 Besluttet 8/9 (#3796, research §6). Konventionen bor **her**, ikke i et separat `docs/marketing/UTM_CONVENTION.md`.

| Parameter | Betydning | Tilladte værdier (voksende liste) |
|---|---|---|
| `utm_source` | Kanalen | `discord`, `reddit`, `email`, `hattrick`, `dugout`, `facebook`, `tiktok`, `chatgpt` |
| `utm_medium` | Formen | `community`, `social`, `email`, `paid` |
| `utm_campaign` | Anledningen | Kort slug, fx `s4-launch`, `winback-sep`, `feature-friday` |

Konkrete eksempler til copy-paste:

```
Discord-announcement    https://cyclingzone.org/?utm_source=discord&utm_medium=community&utm_campaign=s4-launch
Reddit-opslag           https://cyclingzone.org/?utm_source=reddit&utm_medium=community&utm_campaign=procyclingmanager
Vores egne mails        https://cyclingzone.org/?utm_source=email&utm_medium=email&utm_campaign=day1
Forum-signatur          https://cyclingzone.org/?utm_source=hattrick&utm_medium=community&utm_campaign=signature
Betalt test             https://cyclingzone.org/?utm_source=reddit&utm_medium=paid&utm_campaign=s4-ads-test
```

Reglen fra #2236 er en del af konventionen: **UTM pr. community**, ikke pr. platform. `utm_campaign=<community>` gør at r/WebGames kan skelnes fra r/playmygame.

**Prioriteret rækkefølge for at tagge** 📄 (#3796, anbefaling 27/8): mail-templates og Discords info-kanaler først. Det er de to steder hvor vi ved der er trafik (11 signups via Gmail-app, Discord sender slet ingen referrer), og hvor et tag derfor flytter mest fra "ukendt" til "kendt".

## 4. Tragten og dag 1

### 4.1 Hvor de falder fra

📄 Pengeplanen §0.3 (153 signups over 60 dage til 2/9):

| Trin | Antal | Andel |
|---|---:|---:|
| Signup | 153 | 100 % |
| Har hold med starter-trup | 140 | 92 % |
| Har mindst ét løbsresultat | 137 | 90 % |
| Kom tilbage dag 1 eller senere | 68 | 44 % |
| Har afgivet mindst ét bud | 87 | 57 % |
| Kom tilbage i uge 2 (143 berettigede) | 44 | 31 % |

**Hullet er ikke draften. Det er dag 1 til uge 2.** 92 % får hold og løb; 44 % kommer tilbage; 31 % er der i uge 2.

### 4.2 Hvad der adskiller dem der bliver

📄 Målt 2/9 og 7/9:

- **Første bud er signalet.** Af de 44 der er der i uge 2 har 42 budt, altså 95 %. Af de 99 tabte har 37 budt. `auction_bids` er kilden, ikke `player_events`.
- **Selv-sat opstilling mod auto-udfyldt** (7/9-auditen, n=193): første løb auto-udfyldt gav 29,9 % uge-2-retention; sat af manageren selv gav 57,9 %. Launch-kohorten fik 12 af 20 kun auto-udfyldte opstillinger. Bemærk: korrelation, ikke årsag. Den der selv sætter opstilling er også den der i forvejen er engageret.
- **Launch-kohorten (24-30/8)** blev meldt som 28,6 %. Alders-justeret (hver kohortes egen dag 0-6 mod dag 7-13) er tallet 33,3 %, og de tidligere kohorter ligger på 38,8 til 45,5 %. Nye spillere har holdt 33 til 46 % siden maj. Launch-ugen er ikke syg; den gjorde et gammelt tab synligt, fordi 20 kom ind på én uge (#4964).
- **Frafaldet er bimodalt.** 7 af launch-kohortens 18 stoppede inden for 36 minutter. Enten binder første session, eller også er det slut. Der er ingen glidende decay at optimere på.

### 4.3 G4-princippet (bindende)

Ordret fra go-nogo-dokumentet 21/6, §1 G4:

> **Marketing tændes ikke ind i en utæt spand uanset retention.**

G4 er en **port, ikke et vægtet signal**: enten er der ingen åbne spil-blokerende bugs og Sentry er rent for kerne-flows, eller også er porten lukket. Konsekvensen står i §2.2: annonce-testen op til S4 er betinget af at dag-1-krogen holder først. Bruger man penge på tilgang mens 39 til 56 % forsvinder inden for et døgn, køber man et større tab.

### 4.4 Dag-1-krogen er tændt

✅ 8/9: mail-loopets `welcome` og `day1` er `on` (første mail sendt; levering ikke bekræftet, fordi webhooken ikke er sat op (EMAIL_STACK §5.8) ❓); `race_digest` er stadig `off`. Før 8/9 havde `email_log` nul rækker nogensinde, og en spiller der lukkede fanen efter 36 minutter kunne ikke nås af noget som helst. Day-1-sweepets vindue (20 til 30 timer efter holdoprettelse) rammer nøjagtigt der hvor frafaldet sker. Gates, typer og drift: EMAIL_STACK.

Målet er **ikke** flere klik i sig selv, men om dag-7- og dag-14-andelen løftes fra launch-kohortens 30 % og 25 % op mod det historiske bånd på 34 til 37 % og 24 til 30 %. Måles på næste kohorte med mindst 15 nye, 14 dage efter.

## 5. Ugerytme og roller

### 5.1 Ejerens faste distributionsdag

📄 Ejer-beslutning 8/9: **én fast dag om ugen, 4 til 6 timer**, afsat til distribution (opslag, kommentarer, community-deltagelse). Ikke spredt ud over ugen. Claude forbereder udkast og tal **dagen før**, så dagen bruges på at poste og svare, ikke på at skrive.

### 5.2 De tre comms-slots

📄 (#428, detaljer i COMMS_PLAYBOOK): **MAN** uge-note · **ONS** spørgsmål · **SØN** ugens øjeblik. Slots er kadencen; indholdet og skabelonerne bor i COMMS_PLAYBOOK.

### 5.3 Ejeren poster altid selv

📄 `docs/SOCIAL_RULES.md` §0, bindende: **Claude sender aldrig beskeder på ejerens vegne.** Undtagelsen er automatiske systemfeeds (patch notes, resultat-poster). Alt andet leveres som udkast klar til copy-paste. Tjek altid om ejeren allerede har postet, før du laver et nyt udkast.

### 5.4 Rules of engagement i communities

📄 (#2236), gælder overalt:

1. **90/10:** deltag ægte før selvpromo. Kold promo bliver fjernet.
2. **Aldrig et bart link.** Historie først, link sidst.
3. **Ingen emoji i Reddit-opslag** (fint på Discord). Ingen em-dash. Aldrig "free forever".
4. **UTM pr. community** (§3.4).
5. **Læs subreddittets live-sidebar én gang før posting.** Den er den eneste autoritet.

### 5.5 Måling efter et opslag

📄 A10 i `ASSUMPTIONS_TO_VALIDATE.md`: **upvotes, kommentarer og signups inden for 48 timer** efter opslaget. Det er det vindue der afgør om en kanal virker.

Sådan læses det: kør `scripts/monday-numbers.mjs --json` **lige før** opslaget og igen **48 timer efter**, og træk kanalens `total` fra hinanden. Kanal-tabellens 30-dages-kolonne kan ikke isolere to døgn; kun differencen kan. Upvotes og kommentarer tælles manuelt af ejeren i samme ombæring.

### 5.6 Communities i spil

| Community | Status |
|---|---|
| **r/procyclingmanager** | Testet. Ejeren postede ~29/6, kendte regler 📄 |
| **r/peloton** | Utestet kandidat. Sandsynligvis thread-gated; kun kommentarer indtil videre 📄 |
| **Hattrick-fora** | Organisk opdaget 20/7 (45 sessions fra hattrick.org uden at vi selv postede). Målgruppen er browser-manager-veteraner, altså perfekt. 8 signups i alt ✅ |
| Discord-servere (PCM, Lanterne Rouge, r/pelotons officielle) | Kortlagt, ikke gennemført 📄 (#2236) |

## 6. Kampagne-skabelon

En kampagne er et afgrænset skub med et mål, ikke løbende posting. Skabelonen udfyldes **før** noget postes.

| Felt | Udfyldes med |
|---|---|
| **Mål** | Ét tal, målbart i `scripts/monday-numbers.mjs`. Fx "signups sidste 7 d fra 6 til 20" |
| **Kanaler** | Konkrete communities, ikke platforme |
| **UTM** | `utm_campaign`-slug låst før første link deles (§3.4) |
| **Tekst-ejer** | Claude skriver udkast, ejeren godkender og poster (§5.3) |
| **Måling 48 t** | Upvotes, kommentarer, signups (§5.5) |
| **Måling 7 d** | Kanal-tabel + D7 for kampagne-ugens kohorte |
| **Port** | G4 (§4.3): er dag-1-krogen tæt? |

### 6.1 Første kampagne: sæsonskiftet S4

**Datoerne er hårde kendsgerninger:** sæson 3 slutter søndag 27/9, sæson 4 starter mandag 28/9 (ejer 8/9: sæsonen slutter en søndag og starter en mandag). Ikke en valgt kampagnedato. Det besluttede indhold:

- **Annonce-test:** 500 til 1.000 kr. på Reddit/Facebook med UTM, i ugen op til sæsonstarten 28/9. Ejer godkender budget og tekst. Betinget af G4.
- **S4-opslaget som win-back-krog** 📄 (pengeplan §1, satsning 3): "ny sæson starter" er den ene ægte grund til at vende tilbage vi har i kalenderen.
- **Hård afhængighed:** S4-kalenderen skal materialiseres FØR cutover, ellers får ingen hold et årsmøde 📄 (tørkørsel 2/9).

Alt andet om kampagnen er ubesluttet. **Opfind ikke datoer, budgetter eller kanaler her.**

> Dato-drift afklaret 8/9: 27/9 er sidste S3-dag (søndag), 28/9 er første S4-dag (mandag). Tekster der siger 'sæsonen starter 28/9' er korrekte; tekster der siger 'sæsonskiftet 27/9' mener sidste dag i S3.

## 7. Brugerforståelse

Tallene siger hvor folk falder fra. De siger ikke hvorfor. Interviews er det andet ben.

### 7.1 Interview-guide

📄 Bevaret fra go-nogo §3b (21/6), semistruktureret, tilpasses pr. segment:

**Opvarmning (ingen ledende spørgsmål):**
- Hvad fik dig til at prøve Cycling Zone?
- Beskriv hvad du gjorde de første 10 minutter. Hvor gik du i stå?

**Kerne-loop (løb, træning, ungdom, transfer/auktion):**
- Hvilken del trak dig tilbage næste dag? Hvilken ignorerede du?
- Auktioner: var budgivningen klar? Hvad forvirrede?
- Løb: gav etape-for-etape-afviklingen mening, og var den værd at følge?
- Træning: forstod du hvad dine valg gjorde ved rytterne?
- Ungdom og udvikling: mærkede du progression over tid?

**Retention og deling:**
- Hvad ville få dig til at komme tilbage hver dag? Hvad ville få dig til at stoppe?
- Ville du dele spillet? Med hvem, og hvorfor eller hvorfor ikke?

**Afslutning:**
- Én ting du ville ændre i morgen?
- Må jeg vende tilbage med opfølgning?

### 7.2 Syntese-skabelon

📄 go-nogo §3c. Udfyldes EFTER, aldrig undervejs:

| Tema | Frekvens (antal interviews) | Citat (kilde-id) | Søjle berørt |
|---|---|---|---|
| | | | |

Rangér fund efter **frekvens x impact**. Interviewnoter må ikke ligge lokalt: GitHub eller OneDrive-context.

### 7.3 A12-metoden

📄 `ASSUMPTIONS_TO_VALIDATE.md` A12 (Discord som community-platform): antagelsen valideres ikke med en måling, men ved at **spørge testere i interviews hvor de hænger ud, og om Discord er friktion eller fordel**. Metoden generaliserer: en platform-antagelse testes på brugerne, ikke på trafiktal. Bruges næste gang forumet mod Discord skal afgøres (#4235).

## 8. Win-back og sovende

- **Sovende** = ingen aktivitet i 30 dage 📄 (`managerActivity.js`, ejer-definition 2/9, #4307).
- **Segmentet:** ✅ 84 sovende med `email_marketing = true` af 167 med samtykke i alt (målt 8/9).
- **Gaten er eksplicit `true`.** `NULL` er IKKE stiltiende accept (GDPR art. 4(11)), og `marketing`-kategorien er den forkerte: den dækker annoncer og remarketing, og bannerteksten siger selv at den ikke bruges i dag. Bannerteksten for `email_marketing` er allerede skrevet til netop dette formål: "occasional newsletters about major season updates or events".
- **En win-back-mail er markedsføring, ikke service.** Modtageren har per definition ingen igangværende transaktion, og formålet er reaktivering.
- **Status: ikke bygget** 📄 (#2760). `winback` findes ikke som type i koden. Segment-SQL, mailtekst-udkast (EN + DA) og det tekniske forslag ligger i [`docs/audits/winback-consent-audit-2026-09-02.md`](audits/winback-consent-audit-2026-09-02.md).
- **Kandidatlisten vises ejeren FØR første send**, før selv `dry_run` flippes. Det er den første mailtype hvor forkert targeting betyder at kontakte folk der aktivt har forladt spillet.

Gates, dedupe, unsubscribe og drift-tærskler: EMAIL_STACK. Trin for trin ved flip: [`docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md`](EMAIL_LOOP_GO_LIVE_RUNBOOK.md).

## 9. Adgang og værktøjer

Kort oversigt. Ansvarsfordelingen mellem værktøjerne bor i ANALYTICS_STACK.

| Værktøj | Adgang | Bruges til |
|---|---|---|
| **Postgres (prod)** | Supabase MCP (read-only) + `SUPABASE_SERVICE_KEY` i scripts | Sandheden for tragt, attribution og penge |
| **Alunta** | MCP, skrivebeskyttet | MRR, ARPU, aktive abonnementer |
| **Clarity** | MCP | Replay og dead clicks. Kan ikke bære attribution (§11, faldgrube 1) |
| **PostHog** | MCP, projekt findes (EU), 0 events endnu ✅ | Produkt-funnels, retention, attribution, når #4321 er wired |
| **GSC** | Google service-konto planlagt, nøgle `GSC_SERVICE_ACCOUNT_JSON` i Infisical ❓ | Søgning: rank og impressions (#3797) |
| **Ahrefs** | Kun gratis-endpoints. Betalt plan afvist ✅ ("Insufficient plan" på keywords-explorer og GSC-tools) | Domain rating, ikke andet |
| **GA4** | Property modtager data 📄 | Adfærd, beholdes ved siden af PostHog (ejer-valg 8/9) |

**Morningscore og betalt Ahrefs findes ikke.** Ældre SEO-dokumenter nævner begge; ignorér dem.

## 10. Åbne punkter

| # | Sag | Hvad der mangler |
|---|---|---|
| [#3796](https://github.com/NicolaiDolmer/CyclingZone/issues/3796) | UTM-disciplin + "hvor hørte du om os" | Konventionen står nu her (§3.4). Mangler: tagning af mails og Discord-kanaler, samt onboarding-dropdown |
| [#4322](https://github.com/NicolaiDolmer/CyclingZone/issues/4322) | AI-assistenter som kanal | Gruppen er defineret (§2.1). Mangler: baseline-måling af hvad assistenterne svarer, og verifikation af at AI-crawlere ikke er blokeret |
| [#4067](https://github.com/NicolaiDolmer/CyclingZone/issues/4067) | Marketing-site | Live på cycling-zone-marketing.vercel.app; mangler rewrites fra cyclingzone.org (separat PR med ejer-go) ✅ |
| [#3797](https://github.com/NicolaiDolmer/CyclingZone/issues/3797) | GSC + funnel pr. kanal | Service-konto og `scripts/gsc-report.mjs` ikke bygget |
| [#1173](https://github.com/NicolaiDolmer/CyclingZone/issues/1173) | Referral | Belønningsmodellen er besluttet; intet er bygget. Afventer at Pro låser noget op |
| [#2759](https://github.com/NicolaiDolmer/CyclingZone/issues/2759) | Betalte annoncer | Testen er godkendt i princippet; udkast, målgruppe og budget mangler |
| [#2760](https://github.com/NicolaiDolmer/CyclingZone/issues/2760) | Win-back | Type, sweep og `app_config`-nøgle ikke bygget |
| [#2236](https://github.com/NicolaiDolmer/CyclingZone/issues/2236) | Outreach-tracker | Reglerne står nu her (§5.4). Trackeren selv er stadig et eksternt artefakt |
| [#4964](https://github.com/NicolaiDolmer/CyclingZone/issues/4964) | Launch-kohorten | Ejer-valg om #1140/#1569's kø-placering udestår |
| [#4321](https://github.com/NicolaiDolmer/CyclingZone/issues/4321) | PostHog | 0 events. Revurdér Clarity efter 4 ugers PostHog-drift |
| (nyt) | Aktivitets-unionen i scriptet | `scripts/monday-numbers.mjs` dækker `last_seen` ∪ `player_events` ∪ `auction_bids`. Manuelle `race_entries`, `xp_log` og forum-skrivning mangler; aktive-tallene kan undertælle |

## 11. Faldgruber

1. **Clarity kan ikke bære attribution.** Den er samtykke-gated, oppustede sessionstal 115x i #3819, og self-referral fylder listen. Brug den til replay og dead clicks, aldrig til at tælle kanaler.
2. **"Direct" er ikke "ingen kanal".** Det er 50 % af rækkerne og består mest af Discord, mund til mund og app-klik uden referrer (§3.2).
3. **MRR-tal hører aldrig hjemme i prosa.** Tre dokumenter bar tre forskellige forældede tal samtidig. Dokumentet bærer formlen, Log bærer tallet (§1.3).
4. **`player_events` er samtykke-gated.** 4 af launch-kohortens 20 havde nul events og op til 32 auktionsbud. Et aktivitetsmål bygget på `player_events` alene undertæller systematisk.
5. **Rullende D7 er ikke kohorte-D7.** `get_sprint_metrics` giver rullende (alle brugere der er mindst 7 dage gamle); `get_cohort_retention` giver kohorte-isoleret. Kun kohorte-tallet er mandagstal 2; det rullende er sanity-check.
6. **`*_pct = NULL` betyder "endnu ikke målbar", ikke 0 %.** Læs `d7_eligible` før du læser `d7_pct`.
7. **Signups pr. uge er en lille population.** 1, 6, 20, 12, 17 over de sidste fem uger. En enkelt uge er støj; kig på båndet.
8. **UTM'er der ikke er vores.** 7 af 10 ChatGPT-signups havde `utm_source=chatgpt.com` sat af ChatGPT selv. Vores egne taggede links stod 27/8 for reelt 3 signups. Konkludér ikke "vi tagger" fordi feltet er udfyldt.

## 12. Log

Én linje pr. mandag, nyeste øverst. Kør `infisical run --env=prod -- node scripts/monday-numbers.mjs`, hent MRR via Alunta MCP `get_business_overview`, skriv linjen.

| Dato | MRR ekskl. moms / abo | D7 (kohorte) | Checkout 7 d | Aktive 1d/7d/30d | Signups 7 d | Sovende m. samtykke |
|---|---|---|---|---|---|---|
| 2026-09-08 (baseline) | 659,33 kr. / 18 (Alunta), 17 (SQL) | 30,0 % (uge 24/8, 20 berettigede) | 16 / 19 (84,2 %) | 54 / **74** / 122 | 6 | 84 af 167 |

## 13. Drift-tjek

```bash
infisical run --env=prod -- node scripts/monday-numbers.mjs
```

Read-only: kun SELECT og den read-only RPC `get_cohort_retention`. Nøgler læses udelukkende fra env (`SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, valgfri `ALUNTA_API_TOKEN`) og printes aldrig. `--json` giver maskinlæsbart output til videre behandling.

Scriptet fejler tydeligt hvis en nøgle mangler (exit 1) eller Supabase svarer med fejl (exit 2). Rammer en tabel-forespørgsel række-loftet, siger scriptet det i "Forbehold" i stedet for stiltiende at undertælle.

Kanal-grupperingen i §2.1 er den eneste rigtige logik i scriptet, og den er testet uden netværk:

```bash
node --test scripts/monday-numbers.test.mjs
```

Ændrer du gruppedefinitionerne (`AI_ASSISTANT_HOSTS`, `OWN_EMAIL_HOSTS`, `REDDIT_HOSTS`, `SEARCH_HOSTS`), så ret §2.1 i samme PR. Ellers flytter et tal i SSOT'en uden at nogen ser det.

## 14. Relateret

- [`docs/audits/business-layer-ssot-research-2026-09-08.md`](audits/business-layer-ssot-research-2026-09-08.md) med måling og ejer-beslutninger 8/9
- [`docs/superpowers/specs/2026-09-02-30-dages-pengeplan.md`](superpowers/specs/2026-09-02-30-dages-pengeplan.md) med tragt-tal og målene pr. 2/10
- [`docs/audits/launch-cohort-dropoff-2026-09-07.md`](audits/launch-cohort-dropoff-2026-09-07.md) med dag-1-frafaldet
- [`docs/audits/winback-consent-audit-2026-09-02.md`](audits/winback-consent-audit-2026-09-02.md) med segment-SQL og mailudkast
- [`docs/BILLING_STACK.md`](BILLING_STACK.md) for penge-siden
- [`docs/TONE_OF_VOICE.md`](TONE_OF_VOICE.md) for al copy: EN først, DA under, jeg-stemme
- [`docs/SOCIAL_RULES.md`](SOCIAL_RULES.md) §0 for hvem der må sende beskeder
- `docs/ANALYTICS_STACK.md`, `docs/EMAIL_STACK.md`, `docs/COMMS_PLAYBOOK.md` (søsterdokumenter i samme bølge, #5048)
