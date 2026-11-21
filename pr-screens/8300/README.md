# #8300 Dashboardet som spillets bedste side: research, måling og 3 skitser

Levende skitse: `dashboard-skitser.html` (åbn direkte i en browser). Parametre: `?v=now|a|b|c`, `?shield=on`, `?return=1`, `?theme=dark`, `?notes=0`.
Alle billeder er taget af den levende skitse ved 1440 og 390 px. Data er opfundne eksempler. Flagene er de rigtige `flag-icons` 7.6.0-SVG'er, samme pakke og version som spillets `<Flag>`.

## 1. Måling: hvad spillerne gør på siden i dag

PostHog, 30 dage til 16/11:

| Mål | Tal |
|---|---|
| Visninger af `/dashboard` | 11.918 fra 241 spillere (ca. 49 pr. spiller) |
| Telefon | 3.957 visninger (33 %): Android 2.080, iPhone 1.877. Resten har ingen enhed (antagelse: computer) |
| Næste side efter dashboardet | ingen (forlod spillet) 3.157 (26 %) · `/notifications` 2.746 (23 %) · `/patch-notes` 1.393 (12 %) · `/dashboard` igen 944 (8 %) · `/team` 471 · `/training` 349 · `/planning` 304 · `/standings` 273 · `/auctions` 236 · `/forum` 207 |

**Hvad vi ikke kan måle:** PostHog optager ikke klik (ingen `$autocapture`), og scroll-dybde findes ikke i projektet. Clarity er ikke koblet på denne session. Hvilke kort der bliver brugt, er derfor ukendt. **Ingen evidens. Antagelse ud fra næste side:** spillerne bruger dashboardet som et sted at passere igennem til beskederne. Hver fjerde går direkte videre til indbakken.

**Kode i dag** (`DashboardPage.jsx`, 1.462 linjer): bredden er `max-w-5xl` (1024 px), hverken T1 eller T2. Siden har 13 moduler, der kan slås til og fra (`useDashboardLayout`), plus ca. 12 betingede kort og bannere, bl.a. `SeasonSignupCard`, `RacePausedBanner`, `SurveyInviteCard`, onboarding, årsmøde og sæsonafslutning. Alt står i én lodret række. Ved 1440 px er der plads til 1.168 px indhold (sidebjælken er 208 px, sidepolstringen 2 × 32 px), men siden bruger kun 1.024 px.

## 2. Research: de bedste manager- og sportsspil og moderne dashboards

Fra kendt viden om produkterne, ingen ny websøgning i denne session.

| Kilde | Hvad forsiden gør | Hvad vi tager med |
|---|---|---|
| Football Manager (Home/Inbox) | Indbakken er spillets motor. Forsiden samler "hvad kræver dig" og næste kamp | Dagens handlinger først, sorteret efter frist |
| Hattrick | Nyheder fra din klub, næste kamp og din liga på én side | Ligatabellen med dig fremhævet hører til på forsiden |
| OOTP Baseball | Nyheder + stilling + to-do-liste | En "to-do" med antal åbne |
| Strava (forside) | Én strøm i midten, dine egne tal i en smal højre kolonne | Strøm + højrekolonne (variant C) |
| Linear / GitHub / Vercel | Tæt, tabulær, ingen hero, "My issues / Inbox" først, få nøgletal | Tæthed frem for luft, tabular tal, ingen bannere |

**Best practice (2025-26):** det man skal gøre, står over folden. Højst 4 nøgletal. "Siden sidst" til spillere der vender tilbage. Én primær handling. Tæt layout uden store tomme felter. Status hører til i sidehovedet, ikke i en boks over indholdet.

## 3. Varianterne

Fælles for alle tre:
- T2-bredde (op til 1600 px; siden har tabeller). Ejeren afviste T1 896 px.
- Sidehovedet er under 250 px (137 px målt). Første kort starter 161 px fra toppen ved 1440.
- **Påmindelsen om tilmelding** står som frist + den ene guld-knap i hovedets handlingsrække (regel 3: ingen bannere). Den ses straks på både computer og telefon og kan ikke foldes væk (#8282).
- Ingen skygger, 5 px radius, tabular tal, stroke-ikoner og ingen venstre-accentbjælke.
- **Spoiler-skjoldet (#7859, wireframe v6c-ordlyd):** vinder og "dit bedste" bliver til "Hidden · Show result". "How your team did" siger "Result hidden by your spoiler shield". I strømmen står resultatet neutralt ("is finished"). En linje under dagens løb fortæller, at skjoldet er slået til.

| | A · Kommandocentralen | B · Løbsdagen først | C · Siden sidst (anbefalet) |
|---|---|---|---|
| Idé | 4 nøgletal, derunder 3 kolonner: næste træk / dagens løb + resultat / division + marked | Dagens etaper som bred tabel øverst, derunder "Needs you" + nøgletal og division | Én prioriteret strøm (gør nu, i dag, tidligere) med nøgletal, division og marked i en højre kolonne |
| Over folden (1440) | Alt det vigtige | Løbsdagen + handlinger | Strømmen + nøgletal + division |
| Telefon | Lang, i prioritetsorden | Kortest (1.765 px) | Strømmen først, derefter tal |
| Tilbagevendende spiller | Velkomstlinje over nøgletallene | Samme | Velkomstlinje øverst i strømmen ("Since your last visit 9 days ago: ...") |
| Pris at bygge | Lav: genbruger dagens kort | Lav-mellem | Mellem: strømmen kræver én fælles kilde (beskeder + resultater + handlinger) |

Billeder: `now-*` (dagens side gengivet), `a-*`, `b-*`, `c-*`, `*-skjold`, `c-*-tilbage` (spiller der vender tilbage) og `c-*-dark`.
