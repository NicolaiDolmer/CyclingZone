# ANALYTICS_STACK: måling og værktøjer (SSOT)

> Kilde til sandhed for hvordan Cycling Zone måler: hvilket værktøj der ejer hvilket tal, hvad samtykket dækker, hvilke events der findes, og hvad ord som "aktiv" og "D7" betyder.
> Oprettet 2026-09-08 ([#5048](https://github.com/NicolaiDolmer/CyclingZone/issues/5048)) på grundlag af `docs/audits/business-layer-ssot-research-2026-09-08.md` og ejer-beslutningerne 8/9. **Læs denne FØR du bygger et nyt event, citerer et tal eller konkluderer noget ud fra et dashboard.**
>
> Verifikationsniveau er markeret pr. påstand: ✅ målt mod live-system · 📄 fra kode/dokumentation · ❓ uverificeret.

## 1. Princippet: Postgres er sandheden, browser-værktøjerne er stikprøver

**Postgres ejer tragten, attributionen, retentionen og pengene.** ✅ Databasen ser 100 % af brugerne, uanset hvad de svarede på cookie-banneret, fordi de transaktionelle kilder (`users.last_seen`, `auction_bids`, `race_entries`, `xp_log`, `subscriptions`, `signup_attribution`) skrives server-side som en del af selve spillet og ikke er adfærdsmåling.

**Browser-værktøjerne ser kun de samtykkende.** ✅ Målt 8/9: 263 brugere, 241 har svaret på banneret, **170 har sagt ja til `analytics`**. GA4, Clarity, Vercel Web Analytics og `player_events` dækker altså cirka to tredjedele af brugerbasen. Et tal fra dem er en stikprøve, aldrig en total.

> **Regel:** er spørgsmålet "hvor mange", "hvem" eller "hvor mange penge", så er svaret en SQL mod Postgres. Er spørgsmålet "hvorfor gik de i stå her", så er svaret et browser-værktøj.

### 1a. Ét ansvar pr. værktøj

Hvert værktøj ejer ÉT tal. Er to værktøjer uenige om "det samme", så slå op her hvilket der er sandheden for netop den metrik. Arven fra `docs/seo/2026-06-21-seo-ownership.md` §1, med to rettelser: **Morningscore og betalt Ahrefs findes ikke** (ejer 8/9) og er skrevet ud.

| Værktøj | Ejer sandheden om | Ejer IKKE | Status |
|---|---|---|---|
| **Postgres (Supabase)** | Tragt, aktivitet, retention, attribution, abonnementer, alle absolutte tal | Hvorfor en flade er svær at bruge | ✅ i drift |
| **PostHog** | Produkt-funnels, retention pr. kohorte, attribution pr. pageview, ad hoc-spørgsmål via MCP | Penge (Alunta/Postgres ejer dem) | ❓ besluttet 27/8 ([#4321](https://github.com/NicolaiDolmer/CyclingZone/issues/4321)), projekt findes (EU), **0 events nogensinde**; SDK'et wires i en søster-PR. Status forbliver ❓ til den er merget |
| **GA4** | Adfærd efter landing, sessions, engagement, koblingen til Search Console | Ranking-position; absolutte brugertal | 📄 i drift, beholdes ved siden af PostHog (ejer 8/9). SPA-pageviews afhænger af en admin-toggle, se §6 |
| **Google Search Console** | Søgning: impressions, klik, CTR, gennemsnitsposition, query-liste, indeksdækning | Adfærd efter landing; konvertering | 📄 property DNS-verificeret 30/6. Programmatisk adgang: service-konto planlagt, `scripts/gsc-report.mjs` klar, se §7 |
| **Microsoft Clarity** | Kvalitativ friktion: replay, heatmaps, dead clicks, rage clicks, JS-fejl | Bruger- og sessionstal (se §6) | 📄 i drift. **Revurderes efter fire ugers PostHog-drift** ([#4321](https://github.com/NicolaiDolmer/CyclingZone/issues/4321)) |
| **Vercel Web Analytics** | Sidevisninger, cookie-frit | Alt andet | ❓ ejer siger tændt; MCP-API'et svarer 404 "Web Analytics not found" (målt 27/8, 30/8 og 8/9). Årsag ukendt |
| **Sentry** | Fejl og exceptions i frontend og backend | Adfærd; trafik | 📄 i drift. **Ikke samtykke-gatet** (fejl er drift, ikke adfærd), bærer kun UUID |
| **Traffic beacon** | Anonym engagement på offentlige sider (`traffic_events`) | Indloggede brugere; identitet | 📄 i drift, cookie-fri og storage-less, ikke samtykke-gatet |
| **Lighthouse-CI** | LAB Core Web Vitals + bundle-budget som CI-gate | Field-CWV; trafik; ranking | 📄 i drift |
| **web-vitals til GA4** | FIELD Core Web Vitals fra rigtige brugere (LCP/INP/CLS/FCP/TTFB) | Lab-scores | 📄 i drift, gratis erstatning for betalt Speed Insights |
| **Ahrefs (gratis)** | Backlinks + uafhængig teknisk site-audit | Keyword-volumen (betalt-only), GSC-data | ❓ MCP'en svarer "Insufficient plan" på keywords-explorer og GSC-værktøjerne |
| **Alunta** | MRR, ARPU, churn, fakturaer | Spilleradfærd | ✅ i drift, se `docs/BILLING_STACK.md` |

Tommelfingerregler ved konflikt:

- "Hvor mange så os i Google?" er **GSC** (impressions). "Hvor mange kom ind?" er **GSC klik**; hvad der derefter skete er **GA4**. De to matcher aldrig 1:1 (forskellige målemetoder, bots, samtykke-gate). Det er forventet, ikke en fejl.
- "Hvor mange spillere er aktive?" er **Postgres** (§4), aldrig Clarity og aldrig `player_events` alene.
- "Hvor mange penge?" er **Alunta** (MRR) eller **Postgres** (`subscriptions`), aldrig LTV-kolonnen i admin før [#5051](https://github.com/NicolaiDolmer/CyclingZone/issues/5051) er lukket.

### 1b. Hvem kan læse hvad (MCP-adgang)

| Kilde | MCP virker | Bemærkning |
|---|---|---|
| Supabase | ✅ ja, read-only SQL | Den vigtigste. Slå kolonner op i `database/schema-snapshot.json` FØR ad hoc-SQL ([#3769](https://github.com/NicolaiDolmer/CyclingZone/issues/3769)) |
| PostHog | ✅ ja (`read-data-schema`, `execute-sql`) | Svarer, men projektet er tomt indtil SDK'et er wiret |
| Microsoft Clarity | ✅ ja | Dashboard-tal + session-recordings. Læs §6 om oppustningen før du citerer et tal |
| Alunta | ✅ ja, skrivebeskyttet | Se `docs/BILLING_STACK.md` §7 |
| Sentry | ✅ ja, plus `scripts/sentry-issues.mjs` | Scriptet er fallback når MCP'en er slået fra |
| Ahrefs | ⚠️ kun gratis-omfanget | "Insufficient plan" på keywords og GSC |
| Vercel Web Analytics | ❌ 404 | Se §6 |
| GA4 | ❌ ingen MCP | Kun ejerens browser. Derfor er GA4 aldrig en kilde Claude kan verificere en påstand imod |
| Google Search Console | ❌ ingen MCP i dag | `scripts/gsc-report.mjs` lukker hullet så snart service-kontoen findes (§7) |

## 2. Samtykke: hvad der er gatet, og hvad der ikke er

### 2a. Kategorier og lagring 📄

Fire kategorier i `frontend/src/lib/consent.jsx`: `necessary`, `analytics`, `marketing`, `email_marketing`. **Default er nej til alt undtagen `necessary`** (`DEFAULT_DENIED`), og banneret vises til enhver der ikke har svaret.

Valget gemmes to steder: `localStorage["cz_consent_v1"]` og `users.consent_preferences`. **DB'en vinder.** Findes der en fjern-værdi, overskriver den den lokale ved næste load; findes kun en lokal, skubbes den op i DB'en. Der er **ingen teardown ved tilbagekaldelse**: et vendor-SDK der allerede er loadet, kører videre til næste page load. Det er bevidst (hverken gtag, Clarity eller `web-vitals` har en ren stop-funktion) og står i koden.

✅ Målt 8/9: 241 af 263 brugere har svaret, 170 har `analytics: true`, 168 har `email_marketing: true`.

### 2b. Hvad hver vendor kræver 📄

| Vendor | Gate | Fil |
|---|---|---|
| GA4 (gtag) | `hasConsent("analytics")` og `import.meta.env.PROD` og `VITE_GA_MEASUREMENT_ID` | `frontend/src/lib/gaIntegration.jsx` |
| Clarity | samme, plus `VITE_CLARITY_PROJECT_ID` | `frontend/src/lib/clarityIntegration.jsx` |
| Vercel Web Analytics | samme, uden env-nøgle | `frontend/src/lib/vercelAnalyticsIntegration.jsx` |
| web-vitals til GA4 | samme | `frontend/src/lib/webVitalsIntegration.jsx` |
| `player_events` (klient) | `hasAnalyticsConsent()` læser `localStorage["cz_consent_v1"]` direkte | `frontend/src/lib/logEvent.js:30-39` |
| Sentry | **ingen gate** | `frontend/src/lib/sentry.jsx`, `backend/instrument.mjs` |
| Traffic beacon | **ingen gate** (cookie-fri, storage-less, kun offentlige sider) | `frontend/src/lib/trafficBeacon.js` |
| First-touch attribution | **ingen gate** (fanges før banneret besvares, skrives først ved signup) | `frontend/src/lib/attribution.js` |
| Presence (`users.last_seen`) | **ingen gate** (nødvendig drift) | `POST /api/presence`, RPC `touch_user_presence` |
| Server-events (`checkout_started`/`checkout_completed`) | **ingen gate** (betalings-telemetri, service-role) | `backend/lib/billingCheckout.js`, `backend/lib/aluntaWebhook.js` |

Alle fire browser-vendors er monteret i `AnalyticsBoundary` (`frontend/src/lib/sentry.jsx:138-152`), en egen error boundary, så en analytics-fejl aldrig vælter appen. 📄

### 2c. Hvad banneret lover 📄

Ordlyden binder os. Nøglerne i `frontend/public/locales/{en,da}/banners.json`:

- `consent.categories.analytics.desc`: "I anonymously measure how the game is used: which buttons frustrate players (Microsoft Clarity), where players come from (Google Analytics) and page views (Vercel Web Analytics), so I can fix bad UX."
- `consent.categories.marketing.desc`: "Not used today." Kategorien er reelt ubrugt.
- `consent.categories.email_marketing.desc`: "Occasional newsletters about major season updates or events."

> ⚠️ **PostHog står ikke i teksten.** Wires PostHog under `analytics`-gaten, skal `analytics.desc` udvides i BEGGE sprog i samme PR. Ellers måler vi med et værktøj brugeren ikke har fået at vide at vi bruger.

### 2d. `email_marketing` bruges ikke af mail-loopet 📄

Mail-sweeps gater på `users.email_prefs` (opt-out, fravær = tilmeldt), **ikke** på `consent_preferences.email_marketing` (opt-in). De to er uafhængige, og det er en kendt GDPR-gæld for `race_digest` (winback-audit 2/9 §1.2). Hjemmel og gate-kæde pr. mailtype hører til i `docs/EMAIL_STACK.md`; her står kun at forskellen findes, så ingen forveksler de to felter.

## 3. Event-katalog: alle navne i `player_events`

`player_events(id, team_id, user_id, event_name, event_data, created_at)`. To skrive-veje: klienten via `logEvent()`/`logFirstEvent()` (samtykke-gatet), og to server-side inserts med service-role (ikke gatet).

> **Regel:** et nyt event kræver **en række her OG et navn i `KNOWN_EVENTS`** (`frontend/src/lib/logEvent.js`). `KNOWN_EVENTS` driver Detector E's "deployet feature med 0 brugere"-alarm; denne tabel er den menneskelæsbare definition. Guarden `node scripts/check-event-catalog.mjs` fejler hvis et navn mangler begge steder, og advarer hvis det kun mangler i `KNOWN_EVENTS`.

Kolonnen "Kendt" = står i `KNOWN_EVENTS` (og er dermed canary-overvåget). Volumen er ✅ målt mod prod 8/9.

### Aktiverings-tragt

| Event | Kendt | Fyrer fra | Betydning |
|---|---|---|---|
| `signup` | ja | `logEvent.js:257` via `flushPendingSignup()` | Konto oprettet. Markøren sættes ved `signUp()` og flushes når brugeren er authenticated, fordi e-mailbekræftelse er slået til i prod |
| `onboarding_completed` | ja | `DashboardPage.jsx:810` | 4 af 4 onboarding-trin klaret. `logFirstEvent`, dedup pr. bruger |
| `team_drafted` | ja | `logEvent.js:225` via `logTeamDrafted()` | Første gang truppen er løbsklar (mindst 8 ryttere) |
| `first_bid` | ja | `useAuctionBidding.js:167` | Brugerens allerførste auktionsbud |
| `first_transfer` | ja | `RiderStatsPage.jsx:220` | Brugerens allerførste transfertilbud |
| `first_race_result_shown` | ja | `MyLatestResultCard.jsx:106` | Dashboardet EKSPONEREDE første gang et uset løbsresultat |
| `first_race_result_viewed` | ja | `TeamResultsTab.jsx:102` | Brugeren ÅBNEDE selv sit holds resultat første gang. Adskilt fra ovenstående med vilje |
| `onboarding_first_bid_recommendation_shown` | nej | `AuctionsPage.jsx:1278` | Bud-anbefalingen blev vist til en ny manager |
| `onboarding_first_bid_recommendation_clicked` | nej | `AuctionsPage.jsx:1302` | Anbefalingen blev brugt. Forholdet til `_shown` er selve målingen |

### Kerne-loop

| Event | Kendt | Fyrer fra | Betydning |
|---|---|---|---|
| `session_started` | ja | `logEvent.js:176` via `logSessionStart()` | Ny session. Dedup pr. session-id i et 30-minutters vindue efter [#2040](https://github.com/NicolaiDolmer/CyclingZone/issues/2040) (25.280 events fra 50 brugere før) |
| `auction_view` | ja | `AuctionsPage.jsx:1059` | Auktionssiden åbnet |
| `auction_bid_placed` | ja | `useAuctionBidding.js:165` | Bud afgivet |
| `transfer_offer_sent` | ja | `RiderStatsPage.jsx:218` | Transfertilbud sendt |
| `race_viewed` | ja | `RaceDetailPage.jsx:586` | Løbsdetaljer åbnet |
| `notification_clicked` | ja | `NotificationsPage.jsx:830` | Notifikation klikket, bærer `kind` |
| `training_focus_set` | ja | `useTraining.js:87` | Træningsfokus sat for én dag |
| `training_focus_set_bulk` | ja | `useTraining.js:151` | Fokus sat på flere ryttere ad gangen |
| `training_run_today` | ja | `useTraining.js:260` | Dagens træning kørt |
| `training_week_plan_set` | nej | `useTraining.js:176` | Ugeplan gemt for holdet |
| `training_rider_week_plan_set` | nej | `useTraining.js:217` | Ugeplan gemt for én rytter |
| `action_rejected` | ja | `actionTelemetry.js:86` | En spillerhandling blev afvist af en regel (for lavt bud, kontraktloft). Bærer `{action, reason, status}`, aldrig PII. Flyttet hertil fra Sentry ([#3767](https://github.com/NicolaiDolmer/CyclingZone/issues/3767)) |

### Akademi, faciliteter og stab

| Event | Kendt | Fyrer fra | Betydning |
|---|---|---|---|
| `academy_sign` | ja | `useAcademy.js:102` | Akademirytter skrevet under |
| `academy_reject` | ja | `useAcademy.js:122` | Akademirytter afvist |
| `academy_graduate` | ja | `useAcademy.js:142` | Rytter dimitteret fra akademiet |
| `academy_promote` | nej | `useAcademy.js:162` | Rytter rykket op |
| `academy_intake_pull` | nej | `useAcademy.js:180` | Nyt akademi-hold trukket. **0 events i prod** |
| `academy_demote` | nej | `useAcademy.js:200` | Rytter rykket ned |
| `academy_release` | nej | `useAcademy.js:239` | Rytter frigivet |
| `facility_upgrade` | nej | `useFacilities.js:45` | Facilitet opgraderet, bærer `{track, tier}` |
| `staff_hire` | nej | `useFacilities.js:69` | Stab ansat |
| `staff_fire` | nej | `useFacilities.js:84` | Stab fyret |

### Feature-canaries

Navne med præfikset `feature_` grupperes af `get_sprint_metrics` som "top features". Konventionen kommer fra `logEvent.js`.

| Event | Kendt | Fyrer fra | Betydning |
|---|---|---|---|
| `feature_rider_development_tab_opened` | ja | `RiderStatsPage.jsx:1975` | Udviklings-fanen på en rytter |
| `feature_rider_scouting_tab_opened` | nej | `RiderStatsPage.jsx:1976` | Spejder-fanen |
| `feature_rider_history_tab_opened` | nej | `RiderStatsPage.jsx:1977` | Historik-fanen |
| `feature_rider_results_tab_opened` | nej | `RiderStatsPage.jsx:1978` | Resultat-fanen |
| `feature_rider_palmares_tab_opened` | nej | `RiderStatsPage.jsx:1979` | Palmares-fanen |
| `feature_rider_interest_tab_opened` | nej | `RiderStatsPage.jsx:1980` | Interesse-fanen |
| `feature_board_consequences_panel_viewed` | ja | `BoardPage.jsx:1382` | Bestyrelsens konsekvens-panel set |
| `feature_finance_forecast_card_viewed` | ja | `FinancePage.jsx:145` | Økonomi-prognosekortet set |
| `feature_dayform_line_viewed` | ja | `RaceDetailPage.jsx:1609` | Etaperesultat set med mindst én egen dagsform-replik synlig |
| `feature_hall_of_fame_opened` | ja | `HallOfFamePage.jsx:103` | Hall of Fame åbnet. **Ingen events siden 19/6** |
| `feature_board_meeting_opened` | ja | `AnnualMeetingPage.jsx:63` | Årsmødet åbnet med et mandat |
| `board_meeting_signed` | ja | `AnnualMeetingPage.jsx:119` | Mandatet underskrevet. Funnel-modstykket til ovenstående |
| `board_receipt_opened` | ja | `MandateCard.jsx:142` | Målkvittering foldet ud i Boardroom |

### NPS

| Event | Kendt | Fyrer fra | Betydning |
|---|---|---|---|
| `nps_submitted` | ja | `useNpsPrompt.js:97` | Svar gemt |
| `nps_dismissed` | ja | `useNpsPrompt.js:114` | Prompten lukket uden svar. Forholdet mellem de to er selve målingen ([#4997](https://github.com/NicolaiDolmer/CyclingZone/issues/4997)) |

### Server-side (ikke samtykke-gatet)

| Event | Kendt | Fyrer fra | Betydning |
|---|---|---|---|
| `checkout_started` | server | `backend/lib/billingCheckout.js:140` | Checkout-session oprettet. Bærer `{interval, currency}`. Fire-and-forget: må aldrig vælte et køb |
| `checkout_completed` | server | `backend/lib/aluntaWebhook.js:281` | Betalingen gik igennem. Bærer `{plan_interval, currency}` ([#4646](https://github.com/NicolaiDolmer/CyclingZone/issues/4646)) |

### Historiske navne (fyres ikke længere, findes i tabellen)

De ligger i data og skal ikke tælles med i nutidige aggregater.

| Event | Kendt | Sidst set | Hvorfor væk |
|---|---|---|---|
| `survey_banner_shown` | nej | 15/7 | `SurveyBanner.jsx` slettet ([#2467](https://github.com/NicolaiDolmer/CyclingZone/issues/2467)). Admin-preview loggede shown ved hver mount og udgjorde 8 % af hele tabellen |
| `survey_banner_clicked` | nej | 16/5 | Samme |
| `survey_banner_dismissed` | nej | 29/6 | Samme |
| `feature_admin_auction_config_opened` | nej | 20/5 | Den gamle `AdminPage.jsx` blev slettet som dead code ([#1650](https://github.com/NicolaiDolmer/CyclingZone/issues/1650)). Admin-impressions er ikke et meningsfuldt canary-signal |
| `academy_free_agent_sign` | nej | 15/7 | Akademi-flowet lagt om |

## 4. Definitioner: hvad ordene betyder

Navnene her er **bindende**. Bruger et dashboard, et script eller en issue-kommentar et af dem, skal det være denne definition. Er der brug for en anden afgrænsning, får den et nyt navn.

### 4a. Aktivitet

**Kanonisk aktivitet** er en union af alle kilder, ikke `player_events` alene (7/9-audit, `docs/audits/launch-cohort-dropoff-2026-09-07.md`):

```
aktivitet = users.last_seen ∪ player_events ∪ auction_bids ∪ manuelle race_entries ∪ xp_log ∪ forum-skrivning
```

- **`aktiv/1d`, `aktiv/7d`, `aktiv/30d`**: brugere med et menneskehold og aktivitet i vinduet.
- **Menneskehold-diskriminatoren**: `teams` med `is_ai = false AND is_test_account = false AND is_bank = false AND user_id IS NOT NULL`, talt som `count(DISTINCT user_id)`. Aldrig `count(*)`: én manager kan have to hold.
- **`sovende`**: ingen aktivitet i 30 dage. Målt på `users.last_seen` alene i `backend/lib/managerActivity.js` (ejer-beslutning 2/9, [#4307](https://github.com/NicolaiDolmer/CyclingZone/issues/4307)).
- **`survey-aktiv`**: `last_seen` inden for 7 dage. Bruges KUN som eligible-population i `docs/SURVEY_SYSTEM.md` §6.2.

> ⚠️ ✅ **Målt 8/9, hvorfor unionen er nødvendig:** af 241 menneskehold var 74 aktive i de sidste 7 dage målt på unionen, men kun **54** hvis man kun spørger `player_events`. Det er en undertælling på 27 %, og den skyldes samtykke-gaten, ikke inaktivitet.

```sql
-- aktiv/7d, den korte udgave (last_seen ∪ player_events)
with human as (
  select distinct user_id from public.teams
   where is_ai = false and is_test_account = false and is_bank = false and user_id is not null
)
select count(*) from (
  select user_id from public.player_events where created_at >= now() - interval '7 days'
  union
  select id from public.users where last_seen >= now() - interval '7 days'
) u join human using (user_id);
```

Den fulde union med `auction_bids`, `race_entries`, `xp_log` og forum lever i `scripts/monday-numbers.mjs` (`docs/GROWTH_STACK.md` §mandagstal). ❓ Scriptet skrives i en søster-PR i samme bølge; indtil den er merget er SQL'en ovenfor den kørbare udgave.

### 4b. Retention

| Navn | Definition | Kilde | Brug |
|---|---|---|---|
| **Kohorte-D1/D3/D7** | Kohorte = signup-uge (mandag 00:00 UTC). Returneret på +Nd = `GREATEST(users.last_seen, max(player_events.created_at)) >= signup + N dage`. **Rolling**, ikke "aktiv præcis på dag N". Eligibility kræver `signup + N <= now()`; yngre kohorter giver `null`, ikke 0 % | `get_cohort_retention(p_weeks)`, `database/2026-06-09-cohort-retention-rpc.sql` | **Gate-tallet.** Det er dette D7 der bruges i go/no-go |
| **Rullende D7** | Andel af ALLE brugere der er 7+ dage gamle, og som har været aktive i de sidste 7 dage | `get_sprint_metrics(p_window)` | **Kun sanity-check.** Isolerer ingen kohorte og må aldrig stå som gate-tal (`docs/launch/2026-06-21-go-nogo.md` §2c) |

> ⚠️ De to tal hedder begge "D7" og er ikke sammenlignelige. Skriv altid hvilket af dem du citerer. Rolling-valget i kohorte-RPC'en er bevidst: bounded ("aktiv præcis dag N") ville give ren nul-støj på en beta-population af denne størrelse.

**DAU/WAU/MAU** i `get_sprint_metrics` er distinct brugere fra `users.last_seen ∪ player_events` i 1/7/30-dages-vinduer. `avg_session_secs` er `max(created_at) - min(created_at)` pr. bruger-dag i `player_events`, kun for dage med 2+ events. **Det er ikke sessionslængde**, men et "aktivt spænd", og det overvurderer systematisk.

### 4c. Signup

`users.created_at` (ækvivalent `auth.users.created_at`). Ikke `player_events`-eventet `signup`, som kun findes for brugere med samtykke og først flushes efter e-mailbekræftelse. Den autoritative signup-attribution er tabellen `signup_attribution`, se §5.

### 4d. Penge

| Navn | Definition | Kilde |
|---|---|---|
| **checkout startet** | `player_events.event_name = 'checkout_started'`. Historisk (før 3/9) aflæses det på `subscriptions.terms_accepted_at`, fordi vilkårsaccepten skrives før betalingen | `player_events`, `subscriptions` |
| **checkout gennemført** | `player_events.event_name = 'checkout_completed'`, historisk `subscriptions.last_event_id like 'checkout.completed%'` | Samme |
| **har nogensinde betalt** | `alunta_subscription_id` sat, ELLER status i {active, cancelled, past_due}, ELLER `current_period_end` sat. `hasEverPaid()` i `backend/lib/growthSnapshot.js`, samme definition i `compute_daily_growth_snapshot` | `subscriptions` |
| **aktivt abonnement** | `current_period_end > nu` OG status i {active, cancelled, past_due}. Identisk med `computeIsPro()`, så admin og spil er enige | `backend/lib/growthSnapshot.js` |
| **MRR** | **Alunta, ekskl. moms.** Aldrig et hardkodet tal i en doc; SSOT'en bærer formlen, kilden bærer tallet | Alunta `get_business_overview` |
| **LTV** | Estimat: `max(1, ceil(dækket tid / periodelængde)) * periodepris`. Ikke en regnskabssum: `subscriptions` har ingen betalingshistorik | `estimateSubscriptionLtvCents()` |

> ⚠️ LTV er **for høj i dag**: halvårsprisen står som 26500 øre i koden mod faktisk 21200. Se §6 og [#5051](https://github.com/NicolaiDolmer/CyclingZone/issues/5051).

### 4e. NPS

Standarddefinition, `backend/lib/growthSnapshot.js`: promoter = 9-10, passiv = 7-8, detractor = 0-6. `score = 100 * (promoters - detractors) / n`, `null` ved n = 0. Svar ligger i `nps_responses` og hænger på **`user_id`, ikke på et hold**. Prompten er gatet i `frontend/src/lib/npsGating.js`: mindst 3 løbsdage plus 90 dages throttle. NPS blev droppet fra spørgeskemaet 8/9, fordi dashboard-NPS måler det samme løbende (`docs/SURVEY_SYSTEM.md` §5.3).

### 4f. Go/no-go-kategorier

Strukturen fra `docs/SPRINT_DASHBOARD.md` overlever selvom tallene deri er historiske (maj-sprint): et go/no-go-scorecard har fire kategorier, ikke én. **Community** (Discord-medlemmer), **survey** (svar og svarprocent), **interviews** (gennemførte samtaler) og **ratio-metrikker** (fx venteliste mod survey). Blandes de sammen til ét tal, forsvinder signalet.

## 5. Attribution (kort)

First-touch fanges ved **første** besøg i `localStorage["cz_attribution_v1"]` (`frontend/src/lib/attribution.js`): fem UTM-felter plus `referrer` og `landing_path`. "First-touch wins", der overskrives aldrig. Rækken skrives først server-side ved holdoprettelse (`backend/routes/api.js`, `PUT /api/teams/my`, kun når holdet reelt blev oprettet) til `signup_attribution`, service-role-only, læses via `GET /api/admin/attribution`. 📄

Attributionen er **bevidst uden for samtykke-gaten**: first-touch sker før banneret besvares, og intet persisteres før brugeren selv opretter en konto. Grundlaget er legitim interesse, dokumenteret i privatlivspolitikken. 📄

Beacon'en (`trafficBeacon.js`) bærer de tre kanal-bærende UTM-felter plus referrer på anonyme sidevisninger, så trafik- og signup-siden af tragten kan holdes op mod hinanden ([#4320](https://github.com/NicolaiDolmer/CyclingZone/issues/4320)). Den er storage-less: konteksten lever i modul-scope for den ene page-session.

UTM-konventionen og kanal-grupperingen (inklusive kanal-gruppen "AI assistant") hører til i `docs/GROWTH_STACK.md` §3. ❓ Skrives i søster-PR'en.

## 6. Kendte målebrud og drift

Alt herunder er noget der **aktivt gør et tal forkert i dag**. Læs listen før du konkluderer på et dashboard.

| # | Brud | Konsekvens | Status |
|---|---|---|---|
| 1 | **`player_events` er samtykke-gatet** | Undertæller aktivitet med 27 % (✅ målt 8/9: 54 mod 74 aktive/7d). `player_events` alene må aldrig stå som aktivitetsmål | 📄 by design. Løsning er unionen i §4a, ikke at fjerne gaten |
| 2 | **Clarity puster bruger- og sessionstal op** | 17/8 viste Clarity ~4.000 "unikke brugere" mod 35 ægte indloggede, altså 115 gange for højt ([#3819](https://github.com/NicolaiDolmer/CyclingZone/issues/3819)). Kendetegn: self-referral, 1 session = 1 "ny" bruger, umulige enheds-fingeraftryk | 📄 delvist afhjulpet. Frontend tagger self-referral med `entry_referrer=self`; ekskludér det tag i dashboardets filtre. Brug Clarity KUN til friktionsmønstre |
| 3 | **Clarity manglede `consentV2`** | Uden signalet gav Clarity ét nyt id pr. sidevisning for EEA/UK/CH-trafik, så "returning users" var nul i ugevis | ✅ rettet 3/8, `.claude/learnings/2026-08-03-clarity-missing-consentv2-signal.md`. Læringen: at gate OM et værktøj loader er ikke det samme som at fortælle værktøjet HVAD samtykket var |
| 4 | **GA4 Enhanced Measurement er uverificeret** | Appen er en SPA uden manuel `page_view`-wiring. Er "Page changes based on browser history events" slået FRA i GA4-admin, får vi tavst 1 pageview pr. session. Ingen fejl, ingen advarsel, bare forkerte tal | ❓ kun ejeren kan tjekke det (GA4-admin, ingen MCP). Røgtest: åbn sitet, klik gennem 3-4 sider, se om GA4 Realtime tæller op |
| 5 | **Vercel Web Analytics svarer 404** | Ingen programmatisk adgang til sidevisningerne. Ejer siger integrationen er tændt | ❓ målt 27/8, 30/8 og 8/9. Årsag ukendt (plan eller scope) |
| 6 | **LTV bruger forkert halvårspris** | 26500 øre i koden mod faktisk 21200. LTV-kolonnen i `/admin/growth` er systematisk for høj | 📄 [#5051](https://github.com/NicolaiDolmer/CyclingZone/issues/5051) oprettet 8/9. Tre steder: `growthSnapshot.js:18` plus to SQL-migrationer |
| 7 | **`/admin/growth` opdateres ikke automatisk** | Dashboardet kan vise forældede tal uden at sige det | 📄 [#3453](https://github.com/NicolaiDolmer/CyclingZone/issues/3453). Snapshot-cron'en kører dagligt (`compute_daily_growth_snapshot`), men fladen har ikke en synlig friskheds-markør |
| 8 | **`users.browser_language` er næsten tom** | ✅ målt 8/9: 4 af 263 rækker udfyldt. Kolonnen kom 3/9 og skrives KUN af `handle_new_user()` ved nye signups | 📄 [#4811](https://github.com/NicolaiDolmer/CyclingZone/issues/4811). Konsistent med kolonnens alder, ikke nødvendigvis en fejl. Sprogfordeling for eksisterende brugere skal tages fra `users.language`, ikke herfra |
| 9 | **Sprint-metrics-snapshottet kører ikke** | `.github/workflows/sprint-metrics-snapshot.yml.disabled`. Der findes ingen automatisk historik på DAU/WAU/MAU ud over `growth_metric_snapshots` | 📄 bevidst deaktiveret. `backend/scripts/snapshot-sprint-metrics.mjs` findes og kan køres manuelt |
| 10 | **PostHog-projektet er tomt** | 0 events nogensinde. Ethvert PostHog-tal er indtil videre ikke-eksisterende, ikke lavt | ❓ SDK'et wires i søster-PR ([#4321](https://github.com/NicolaiDolmer/CyclingZone/issues/4321)) |
| 11 | **16 events er canary-blinde** | De fyrer i prod, men står ikke i `KNOWN_EVENTS`, så Detector E ville ikke opdage at de tørrede ud (se "Kendt: nej" i §3) | 📄 `node scripts/check-event-catalog.mjs` advarer om dem. At tilføje dem til `KNOWN_EVENTS` er en kode-ændring uden for denne SSOT's ramme |

## 7. Adgang og scripts

| Script | Hvad | Kør |
|---|---|---|
| `scripts/gsc-report.mjs` | Search Console: top 25 queries, top 10 sider, totaler mod forrige periode | `infisical run --env=dev -- node scripts/gsc-report.mjs --days=28 [--site=<url>] [--json]` |
| `scripts/check-event-catalog.mjs` | Forward-guard: hvert `player_events`-navn skal stå i §3 og helst i `KNOWN_EVENTS` | `node scripts/check-event-catalog.mjs` |
| `scripts/sentry-issues.mjs` | Uresolvede prod-fejl uden MCP | `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=24h` |
| `scripts/monday-numbers.mjs` | Ugens tal (`docs/GROWTH_STACK.md`) | ❓ skrives i søster-PR i samme bølge |
| `backend/scripts/snapshot-sprint-metrics.mjs` | Manuelt snapshot af sprint-metrics | Workflowen er `.disabled`, se §6 punkt 9 |
| `backend/scripts/backfill-growth-snapshots.js` | Genskaber historiske `growth_metric_snapshots` | Engangs, ejer-gated |

**GSC-adgang:** service-konto med `webmasters.readonly`, JSON-nøglen i Infisical som `GSC_SERVICE_ACCOUNT_JSON`. Kun ejeren kan oprette den. Trin for trin: `docs/runbooks/GSC_SERVICE_ACCOUNT.md` (ca. 10 min).

**Admin-fladen:** `frontend/src/pages/AdminGrowthPage.jsx` (7 faner) mod `GET /api/admin/{metrics, attribution, retention, growth/snapshots, growth/sprint-metrics, growth/customers, growth/nps}` (`backend/routes/api.js:8863-9142`). Alle bag `requireAdmin` med service-role-klienten. 📄

**RPC-adgang:** `get_cohort_retention`, `get_sprint_metrics` og `get_retention_scorecard_activity` er siden 6/9 kun kaldbare af `service_role` ([#4870](https://github.com/NicolaiDolmer/CyclingZone/issues/4870), `database/2026-09-06-4870-revoke-metrics-rpcs.sql`). Kald dem gennem admin-endpointet, ikke fra browseren.

**PostHog-MCP:** read-only under `read-data-schema` og `execute-sql`. Skriv aldrig til PostHog fra en session.

**Retention på rå telemetri:** `traffic_events` og `identity_events` slettes efter 180 dage af daglige cron-job (`backend/cron.js`). `identity_events` bærer IP og user agent og er derfor personoplysninger; `traffic_events` er PII-fri, men slettes alligevel.

## 8. Åbne punkter pr. 2026-09-08

| # | Sag | Blokerer |
|---|---|---|
| [#4321](https://github.com/NicolaiDolmer/CyclingZone/issues/4321) | PostHog wires (SDK bag `analytics`-consent, reverse proxy, pageviews + kendte events spejlet). Banner-teksten skal med i samme PR | Produkt-funnels |
| [#3797](https://github.com/NicolaiDolmer/CyclingZone/issues/3797) | GSC-service-konto oprettes af ejeren, så `gsc-report.mjs` kan køre | Søgemåling |
| [#5051](https://github.com/NicolaiDolmer/CyclingZone/issues/5051) | LTV-prisdrift 26500 mod 21200 | Troværdige penge-tal i admin |
| [#3453](https://github.com/NicolaiDolmer/CyclingZone/issues/3453) | `/admin/growth` opdateres ikke automatisk | Tillid til dashboardet |
| [#4811](https://github.com/NicolaiDolmer/CyclingZone/issues/4811) | `browser_language` dækker kun nye signups | Sprogprioritering |
| [#1407](https://github.com/NicolaiDolmer/CyclingZone/issues/1407) | GA4 Enhanced Measurement bekræftes af ejeren | Alle GA4-pageview-tal |
| [#1369](https://github.com/NicolaiDolmer/CyclingZone/issues/1369) | CRO-loop: måling til beslutning til ændring til måling | Systematisk forbedring |
| Uden issue | Vercel Web Analytics 404 | Sidevisninger uden GA4 |
| Uden issue | `check-event-catalog.mjs` er ikke hooket ind i CI eller preflight | Guarden bider ikke endnu |

## 9. Faldgruber, kort liste

1. **`player_events` alene er ikke aktivitet.** Den er samtykke-gatet og undertæller med 27 %.
2. **Clarity er ikke en tælling.** 115 gange for højt er målt. Brug den til friktion, aldrig til "hvor mange".
3. **De to D7 er ikke det samme tal.** Kohorte-D7 er gaten, rullende D7 er en sanity-check.
4. **En gate er ikke et signal.** At forhindre et SDK i at loade fortæller ikke SDK'et hvad brugeren valgte. Det kostede uger på Clarity.
5. **GA4's SPA-pageviews hænger på en admin-toggle**, ikke på kode. Ingen fejl vises hvis den står forkert.
6. **`count(*)` på `teams` er ikke antal managere.** Én manager kan have to hold. Brug `count(DISTINCT user_id)`.
7. **Hardkod aldrig et MRR- eller brugertal i en doc.** SSOT'en bærer formlen; kilden bærer tallet. Tre docs stod med tre forskellige MRR-tal 8/9.
8. **Et nyt event uden en række i §3 er usynligt for alle andre end den der skrev det.** Guarden findes netop derfor.
9. **Sammenlign aldrig GA4 og GSC 1:1.** Forskellige målemetoder, bots og samtykke-gate. Uenigheden er forventet.
10. **Slet aldrig TXT-recorden der verificerer GSC-domæne-property'en** (`docs/seo/2026-06-21-seo-ownership.md` §6). Google gen-tjekker den løbende, og data holder op med at opdatere.

## 10. Drift-tjek

```bash
node scripts/check-event-catalog.mjs
```

Fejler hvis et event fyrer i koden uden at stå i §3-tabellen, eller hvis `KNOWN_EVENTS` har et navn der ikke er dokumenteret her. Advarer om events der fyrer og er dokumenteret, men mangler i `KNOWN_EVENTS` (canary-blinde). ❓ Ikke hooket ind i CI eller `scripts/preflight-pr.ps1` endnu, se §8.

```bash
infisical run --env=dev -- node scripts/gsc-report.mjs --days=28
```

Fejler med exit 2 og en henvisning til runbooken hvis service-kontoen ikke findes endnu.

## 11. Relateret

- `docs/GROWTH_STACK.md` (mandagstal, UTM-konvention, kanaler) ❓ søster-PR
- `docs/EMAIL_STACK.md` (mailtyper, gates, samtykke-hjemmel pr. type) ❓ søster-PR
- `docs/BILLING_STACK.md` (Alunta, Stripe, Dinero, priser)
- `docs/SURVEY_SYSTEM.md` §5-6 (spørgeskema-analyse og eligible-population)
- `docs/clarity/README.md` (ugentlig Clarity-review, self-referral-filtrering, bot-håndtering)
- `docs/seo/2026-06-21-seo-ownership.md` (GSC-property, DNS-verificering, GA4-admin-checkliste)
- `docs/runbooks/GSC_SERVICE_ACCOUNT.md` (ejer-guide til service-kontoen)
- `docs/audits/business-layer-ssot-research-2026-09-08.md` (research-grundlaget for denne SSOT)
- `docs/audits/launch-cohort-dropoff-2026-09-07.md` (hvorfor aktivitet er en union)
- `.claude/learnings/2026-08-03-clarity-missing-consentv2-signal.md`
