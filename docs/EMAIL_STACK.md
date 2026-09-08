# EMAIL_STACK: mail (SSOT)

> Kilde til sandhed for hvordan Cycling Zone sender mail: hvilke typer der findes, hvilke gates de passerer, hvilken samtykke-hjemmel hver type hviler på, hvad driften måler på, og hvad der stadig er uafklaret.
> Oprettet 2026-09-08 (#5048) på grundlag af `docs/audits/business-layer-ssot-research-2026-09-08.md` og ejer-beslutning 1 og 9 samme aften. **Læs denne FØR du rører noget der sender mail.**
>
> Arbejdsdeling: denne fil er tilstanden (typer, gates, hjemmel, tærskler, huller). [`docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md`](EMAIL_LOOP_GO_LIVE_RUNBOOK.md) er trin-for-trin-handlingen (flip, verifikations-SQL, rollback, opsætning). SQL dubleres ikke her; der linkes til runbookens afsnit.
>
> Verifikationsniveau pr. påstand: ✅ målt mod live-system · 📄 fra kode/dokumentation · ❓ uverificeret.

## 1. Rolle og systemer

| System | Rolle | Ejer sandheden om |
|---|---|---|
| **Resend** | Afsender-API + webhook | Om en mail blev leveret, bouncede eller blev klaget over. Domæne-autentificering (SPF/DKIM) |
| **Railway-backend** | Sweeps, crons, webhook-modtager | Hvem der er kandidat, og hvornår der sendes |
| **Supabase** | Datalag | `email_log` (én række pr. mail), `email_events` (rå webhook-leveringer), `email_sweep_runs` (kandidater vs. sendt), `users.email_prefs` (opt-out), `users.consent_preferences` (opt-in), `app_config` (flag pr. type) |
| **Infisical → Railway** | Hemmeligheder | Nøglerne i §1.2. Værdier logges aldrig |
| **Discord ops-kanal** | Alarm-flade | Sundhedsrapport kl. 08 + samlede fejl-alarmer pr. sweep-kørsel |

Dataflow ved en loop-mail 📄:

```
cron-tick → sweep (welcome|day1|race_digest) finder kandidater
          → sendLoopEmail: flag → dedupe → email_prefs → dry_run|on
          → Resend (idempotencyKey = dedupe_key)
          → email_log.status = 'sent'
          → Resend-webhook → email_events (+ email_log → delivered|bounced|complained)
          → hård bounce/klage: users.email_prefs.all = false
```

Afsender-adressen er **ikke** en env-variabel 📄: `FROM_ADDRESS = "Cycling Zone <updates@cyclingzone.org>"` er hardkodet i `backend/lib/emailService.js:42`. Skal den ændres, er det en kodeændring.

### 1.1 Kode

| Fil | Ansvar |
|---|---|
| `backend/lib/emailService.js` | `sendLoopEmail` = eneste vej til Resend. Gate-kæden, `email_log`-bogføring, fejlklassifikation, retry-planlægning |
| `backend/lib/emailLoopFlag.js` | Læser stage pr. type fra `app_config` (off/dry_run/on) med legacy-fallback |
| `backend/lib/emailPrefs.js` | Opt-out-semantik (`isEmailTypeEnabled`, fail-open) |
| `backend/lib/emailTemplates.js` | Alle skabeloner, EN+DA-copy, farve-låse mod dark mode, UTM på CTA'er |
| `backend/lib/emailWordmarkAsset.js` | Genereret: filnavnet på wordmark-PNG'en med indholds-hash |
| `backend/lib/emailWelcomeSweep.js`, `emailDay1Sweep.js`, `emailRaceDigestSweep.js` | Kandidat-udvælgelse pr. type |
| `backend/lib/emailRetrySweep.js` | Drainer `email_log`-rækker med `next_attempt_at` |
| `backend/lib/emailHealthReport.js` | Daglig sundhedsrapport + `recordEmailSweepRun` |
| `backend/lib/emailOpsAlert.js` | Én ops-alarm pr. sweep-kørsel, ikke én pr. mail |
| `backend/lib/resendWebhook.js` | Svix-signatur, replay-vindue, idempotens, undertrykkelse, videresendelse af svar |
| `backend/lib/emailUnsubRoute.js`, `emailUnsubUrl.js`, `emailUnsubToken.js` | Et-kliks-afmelding: signeret token, URL-bygning, route-handler |
| `backend/cron.js:1381-1425, 2000-2025` | Cron-wiring og kadencer |
| `backend/routes/api.js:906-916` | `GET/POST /api/email/unsubscribe`, `POST /api/email/resend-webhook` |

Migrationer 📄: `database/2026-07-20-2725-email-retention-loop.sql` (`email_log`, UNIQUE `dedupe_key`), `database/2026-08-18-3600-email-log-retry.sql` (`attempts`, `next_attempt_at`, `retry_payload`), `database/2026-09-08-2853-email-events.sql` (`email_events` + udvidet status-CHECK), `database/2026-09-08-2853-email-sweep-runs.sql` (`email_sweep_runs`).

### 1.2 Nøgle-NAVNE (værdier læses aldrig, dumpes aldrig) 📄

| Nøgle | Påkrævet | Uden den |
|---|---|---|
| `RESEND_API_KEY` | ja, når en type er `on` | `sendLoopEmail` kaster før afsendelse |
| `EMAIL_UNSUB_SECRET` | ja, når en type er `on` | Samme. I `dry_run` bruges en dummy-token, så dry_run aldrig kræver hemmeligheden (`emailUnsubUrl.js:32-50`) |
| `RESEND_WEBHOOK_SECRET` | for drift | Webhooken svarer 401 på alt; levering, bounce og klage når aldrig frem |
| `EMAIL_UNSUB_BASE_URL` | valgfri | Default `https://cyclingzone.org/api/email/unsubscribe` |
| `EMAIL_REPLY_TO` | valgfri | Intet `Reply-To`; et svar lander i intetheden |
| `EMAIL_REPLY_FORWARD_TO` | valgfri | Indgående svar logges, men videresendes ikke |

## 2. Mailtyper

Tre typer findes i kode (`TEMPLATE_TYPES`, `emailTemplates.js:137`); en fjerde er foreslået, men ikke bygget. Flag-nøglerne står i `EMAIL_LOOP_TYPE_KEYS` (`emailLoopFlag.js:29-33`) med legacy-fallback `email_loop_enabled` (`EMAIL_LOOP_FLAG_KEY`), som kun bruges hvis en types egen nøgle mangler eller har en ukendt værdi.

| Type | Flag-nøgle | Trigger og kandidat-regel | Dedupe-nøgle | Kadence | Status 8/9 |
|---|---|---|---|---|---|
| `welcome` | `email_loop_welcome` | Menneskehold oprettet inden for 48 t (`WELCOME_WINDOW_MS`); `is_ai/is_bank/is_frozen/is_test_account = false`, `user_id` sat | `welcome:<userId>` | cron hvert 5. min | **on** ✅ (sat 18:07 dansk tid) |
| `day1` | `email_loop_day1` | Samme holdfilter, oprettet 20-30 t siden (vinduet er bredt nok til at en times-cron aldrig springer et hold over); pr. hold tjekkes om der findes `race_results`, så teksten ikke påstår resultater der ikke findes | `day1:<userId>` | cron hver 60. min | **on** ✅ (sat 18:07 dansk tid) |
| `race_digest` | `email_loop_race_digest` | Kun i 19-timen dansk tid; `users.last_seen` ældre end 3 døgn; højst 2 pr. fraværsperiode (talt siden brugerens nuværende `last_seen`); højst 1 pr. ISO-uge; kun resultater importeret siden sidste besøg; ingen resultater = ingen mail; kræver `consent_preferences.email_marketing === true` | `digest:<userId>:<ISO-uge>` | cron hver 60. min | **off** ✅ |
| `winback` ❓ | `email_loop_winback` (foreslået) | Findes ikke i kode. Foreslået segment: sovende >30 d, eksplicit `email_marketing = true`, ikke afmeldt. Se §4.3 | foreslået: én pr. bruger pr. 60 d | ikke bygget | ikke bygget |

Samtykke-hjemmel og tekst-kilde pr. type:

| Type | Hjemmel | Hvorfor | Tekst-kilde | Patch note / help.json |
|---|---|---|---|---|
| `welcome` | Kontoservice (GDPR art. 6(1)(b)) 📄 | Sendes én gang, lige efter manageren selv har oprettet den konto mailen handler om. Banner-teksten siger eksplicit at transaktionelle mails ikke afhænger af `email_marketing`-valget | `docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md` §1 (låst af ejeren 2/9) | Patch note v7.266 ✅. Ingen help.json-ændring: ingen ny spilmekanik |
| `day1` | Kontoservice 📄 | Samme onboarding-forløb, ét døgn efter | Samme dokument §2 | Samme patch note ✅ |
| `race_digest` | Samtykke (art. 6(1)(a)): `consent_preferences.email_marketing === true` 📄 | Modtageren har været væk 3+ døgn; mailen understøtter ingen igangværende handling. Gaten blev tilføjet i #4654 (`emailRaceDigestSweep.js:195`) | Samme dokument §3 | Ingen (typen er off) |
| `winback` ❓ | Samtykke, samme gate | Tydeligere markedsføring end de tre ovenfor | `docs/audits/winback-consent-audit-2026-09-02.md` §3 (udkast, ikke godkendt) | Ingen |

Sprog 📄: skabelonerne vælger tekst på `users.language` (`'da'` giver dansk, alt andet engelsk). Alle tre typer læser `language` sammen med `email`.

## 3. Gate-kæden

Alle sweeps går gennem `sendLoopEmail` (`backend/lib/emailService.js:190-322`). Fem gates, hver kortslutter resten 📄:

| # | Gate | Kode | Resultat når den bider |
|---|---|---|---|
| 1 | Stage pr. type | `emailService.js:220-221` (`readEmailLoopStage`, `emailLoopFlag.js:46-54`) | `off` → `{skipped:"flag_off"}`. **Ingen `email_log`-række overhovedet** |
| 2 | Dedupe på `dedupe_key` | `emailService.js:223-226`, regel i `dedupeBlocksSend` (`:170-174`) | `sent/delivered/bounced/complained` blokerer; `failed` blokerer (både planlagt retry og terminal); `dry_run` blokerer **aldrig** (#5038) |
| 3 | `users.email_prefs` opt-out | `emailService.js:231-234` (`emailPrefs.js:81-85`) | `{"all":false}` eller `{"<type>":false}` → `{skipped:"prefs"}`. Fravær = sendt (fail-open) |
| 4 | `dry_run` | `emailService.js:236-244` | Skriver `email_log.status = 'dry_run'`, kalder aldrig Resend |
| 5 | `on` | `emailService.js:246-251` | Sender via Resend med `idempotencyKey = dedupe_key`; kræver begge hemmeligheder |

Før-gates i selve sweepsene 📄: holdfilteret (`is_ai/is_bank/is_frozen/is_test_account`), tidsvinduet pr. type, og for `race_digest` også times-gaten, fraværs-vinduet, uge- og fraværsperiode-lofterne samt consent-gaten.

**Hvad der IKKE tjekkes** 📄: `welcome` og `day1` læser aldrig `consent_preferences`. Det er et bevidst valg med skrevet begrundelse (`emailRaceDigestSweep.js:182-187`): begge er onboarding til brugerens egen netop udførte handling, og banner-teksten undtager eksplicit transaktionelle mails. Winback-auditens fund om at digesten manglede consent-gaten (audit 2/9 §1.2, gentaget i research-noten 8/9) er **lukket** af #4654 og gælder ikke længere ✅ (verificeret i koden 8/9). Det eneste der står tilbage af den tråd er formuleringen i privatlivspolitikken, se §7.

## 4. Samtykke og afmelding

### 4.1 Fire uafhængige mekanismer 📄

| # | Mekanisme | Hvad den er | Bruges af mail-loopet |
|---|---|---|---|
| A | `users.consent_preferences` (JSONB) | Cookie-bannerets fire kategorier: `necessary`, `analytics`, `marketing`, `email_marketing`. `NULL` = ikke besvaret | Ja, kun `email_marketing`, kun af `race_digest` |
| B | `users.email_prefs` (JSONB) | Opt-OUT pr. type + master-nøglen `all`. Fail-open | Ja, af alle typer |
| C | Supabase Auth-signup | Kontooprettelse. Indsamler intet markedsførings-samtykke | Nej |
| D | Founder-venteliste-checkbox (`WaitlistConsentText.jsx`) | Eget, adskilt samtykke til venteliste-opfølgning | Nej. Dækker ikke almindelige spilkonti |

Banner-teksten for `email_marketing` er den bindende samtykke-tekst brugeren faktisk så (`frontend/public/locales/en/banners.json`) 📄: "Occasional newsletters about major season updates or events. Transactional emails (auction won, etc.) do not depend on this choice." Den danske version siger det samme.

To fælder: `marketing`-kategorien er annoncer og remarketing, ikke mail, og må **aldrig** bruges som mail-gate. Og `NULL` er ikke samtykke; kun eksplicit `true` tæller (GDPR art. 4(11)).

### 4.2 Afmelding og undertrykkelse 📄

- Hver mail bærer et signeret unsubscribe-link i bunden plus headerne `List-Unsubscribe` og `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (`emailService.js:120-123`).
- `GET /api/email/unsubscribe` viser en minimal bekræftelses-side; `POST` på samme sti er mailklientens et-kliks-kald. Begge sætter `users.email_prefs.all = false`. Ugyldigt token giver 400 uden at forklare hvorfor.
- Hård bounce (`bounce.type == "Permanent"` eller en subType i `HARD_BOUNCE_SUBTYPES`) og **enhver** klage sætter samme `all: false` plus `suppressed_reason` og `suppressed_at` (`resendWebhook.js:222-236, 484, 494`). Blød bounce logges kun.
- Der findes bevidst ingen parallel suppression-tabel: én nøgle svarer på "må vi maile denne bruger?".

### 4.3 Win-back-segmentet ✅

Segment-definitionen står i `docs/audits/winback-consent-audit-2026-09-02.md` §2 (SQL dubleres ikke her). Målt 2026-09-08: **84 kandidater** (sovende >30 d, menneskehold, ikke frosne, eksplicit `email_marketing = true`, ikke afmeldt). Audit-dokumentets forventning var ca. 77 pr. 2/9.

**Regel, bindende:** kandidatlisten vises ejeren i klartekst FØR selv `dry_run` flippes. Win-back er den første type hvor forkert targeting betyder at kontakte folk der aktivt har forladt spillet. Rækkefølgen er `off` → kandidatliste til ejeren → `dry_run` i mindst 24 t → ejeren godkender teksten → `on`.

## 5. Drift

### 5.1 Crons og kadencer 📄 (`backend/cron.js:2000-2025`)

| Job | Interval | Bemærkning |
|---|---|---|
| welcome-sweep | 5 min | No-op når stage er off |
| day1-sweep | 60 min | |
| race-digest-sweep | 60 min | Arbejder kun når dansk lokaltime er 19 eller senere |
| retry-drain | 5 min + én ved boot | No-op medmindre mindst én type er `on`; derefter evalueres hver række mod sin egen types stage |
| sundhedsrapport | 60 min | Time-gate fra kl. 08 dansk tid + dags-dedupe i `ops_alert_state`, så der kommer én rapport pr. døgn |

### 5.2 Sundhedsrapport og tærskler 📄 (`emailHealthReport.js`)

Ét kompakt embed i ops-kanalen kl. 08 dansk tid. Den @mentioner kun ved brud.

| Tærskel | Grænse | Konstant |
|---|---|---|
| Bounce-rate | over 2 % af sendte, min. 10 sendte | `BOUNCE_RATE_THRESHOLD`, `MIN_SENT_FOR_RATE` |
| Klage-rate | over 0,1 % af sendte, min. 10 sendte | `COMPLAINT_RATE_THRESHOLD` |
| Døde retries | over 0 | |
| Type med kandidater men 0 sendt to døgn i træk | | Fanges via `email_sweep_runs` |

Handling ved brud: se runbookens §6.5.

### 5.3 Retry-skema 📄

`5 min, 15 min, 1 t, 3 t, 6 t, 8 t, 8 t` (sidste værdi gentages), i alt 8 forsøg (`MAX_EMAIL_ATTEMPTS`), horisont ca. 27 t. Klassifikation: 429, netværksfejl og 5xx er retryable; 4xx er permanent og prøves aldrig igen. Permanente fejl alarmerer straks (Sentry + samlet ops-alarm); retryable fejl alarmerer først når drainen giver op.

### 5.4 Webhook-idempotens 📄

Signaturen ER auth'en: Svix-HMAC over de rå bytes, verificeret før JSON-parsing, med et replay-vindue på plus/minus 5 minutter. `svix-id` gemmes i `email_events.provider_event_id` (UNIQUE) og indsættes FØR nogen sideeffekt, så en gen-levering bliver et rent no-op. Efter en verificeret signatur svares altid 200, også på events vi ignorerer.

### 5.5 Nødbremse 📄

Sæt den berørte `app_config`-nøgle til `"off"`. Ingen deploy. Sweeps no-op'er fra næste tick, og retry-drainen stopper af sig selv. SQL: runbookens §5.

### 5.6 DMARC-trappe 📄 (#1461)

I dag `p=none` med `rua` til en Gmail-adresse. Trin, uden faste datoer: 1) `rua` til en gratis aggregator, 2) 2-3 uger på `p=none` indtil rapporterne er rene, 3) `p=quarantine; pct=100`, 4) `p=reject`. **Spring aldrig et trin over**: går man direkte til reject med en glemt afsender i systemet, forsvinder dens mails uden spor.

### 5.7 Asset-regel 📄

Alt der refereres fra en mail skal ligge på en **immutable URL**. Wordmark-PNG'en bærer sin egen indholds-hash i filnavnet (`emailWordmarkAsset.js`, bygget af `scripts/build-email-wordmark.mjs`), fordi `/brand/*` serveres med en uges `Cache-Control` og mail-proxier ellers viser en gammel version i op til en uge. Ny version = nyt filnavn, aldrig samme navn med nyt indhold. Postmortem: `.claude/learnings/2026-09-08-email-asset-cache.md`.

### 5.8 Ejer-tjekliste: hvad der mangler at blive gjort

| Handling | Status |
|---|---|
| `RESEND_API_KEY` + `EMAIL_UNSUB_SECRET` i Infisical og Railway | ✅ gjort (welcome-mailen blev faktisk afsendt 8/9) |
| Webhook oprettet i Resend + `RESEND_WEBHOOK_SECRET` sat | ❓ **ikke bekræftet**: `email_events` er tom (0 rækker målt 8/9), og den ene afsendte mail står stadig som `sent`, ikke `delivered`. Enten er webhooken ikke oprettet, eller også afvises leveringerne. Runbook §6.1 |
| Receiving (MX til Resend) + `EMAIL_REPLY_TO`/`EMAIL_REPLY_FORWARD_TO` | ❓ uverificeret. Runbook §6.2 |
| DMARC-trin 1 (aggregator) | ❓ ikke bekræftet (#1461) |
| Google Postmaster Tools | ❓ ikke bekræftet. Runbook §6.4 |
| Microsoft JMRP | ❓ ikke bekræftet. SNDS er først relevant ved dedikeret IP |

## 6. Målinger

**Hvad mail-loopet skal flytte** (#4964, ejer-mål): dag-7-retention på **30 %** og dag-14 på **25 %** for signups fra 8/9 kl. 12:14 og frem. Launch-kohorten lå på 28,6 % mod 86,8 % for etablerede hold, og det er den forskel loopet er bygget for at lukke.

Hvor det aflæses:

| Spørgsmål | Kilde |
|---|---|
| Blev mailen sendt, og hvad skete der bagefter? | `email_log` (status pr. type). Runbook §3 |
| Fandt sweepen kandidater den ikke fik sendt til? | `email_sweep_runs`. Runbook §6.6 |
| Levering, bounce, klage, indgående svar | `email_events`. Runbook §6.6 |
| Retention pr. kohorte | `get_cohort_retention` via admin-growth. Definitionerne hører i `docs/ANALYTICS_STACK.md` |
| Ugentlige tal | Mandagstals-proceduren i `docs/GROWTH_STACK.md` |
| Klik fra mail | Alle CTA'er bærer `utm_source=email` og `utm_medium`/`utm_campaign` = mailtypen (`emailTemplates.js:223-226`), så klik lander i den eksisterende kanal-tragt. Discord-CTA'en er bevidst ikke tagget |
| Mail-klik i signup-attribution | Referrer-domænet fra Gmail-appen tæller som mail-klik i `signup_attribution` (11 rækker målt 8/9) |

Målt tilstand 2026-09-08 ✅ (read-only mod prod):

| Mål | Værdi |
|---|---|
| `email_log` i alt | 1 række: `welcome`, status `sent` |
| `email_events` | 0 rækker |
| `email_sweep_runs`, `welcome`/`dry_run` | 5 kørsler, 5 kandidater, 5 logget |
| `email_sweep_runs`, `welcome`/`on` | 32 kørsler, 32 kandidat-observationer, 1 sendt, 31 skippet (dedupe) |
| `day1`- eller `race_digest`-kørsler med kandidater | ingen endnu |
| Brugere undertrykt automatisk | 0 |
| Brugere med `email_prefs.all = false` | 0 |

## 7. Åbne punkter

| # | Sag | Status |
|---|---|---|
| [#2853](https://github.com/NicolaiDolmer/CyclingZone/issues/2853) | Rest af flip'et: webhook-secret bekræftes, `race_digest` står stadig `off` | Åbent |
| [#1461](https://github.com/NicolaiDolmer/CyclingZone/issues/1461) | DMARC fra `p=none` mod quarantine og reject | Åbent, trin 1 ikke bekræftet |
| [#2760](https://github.com/NicolaiDolmer/CyclingZone/issues/2760) | Win-back-mails: typen findes ikke i kode; segmentet er målt til 84 | Åbent |
| [#3981](https://github.com/NicolaiDolmer/CyclingZone/issues/3981) | Forskydning mellem løbsresultat og digest-mail (spiller-screenshots 19/8) | Åbent. Skal afklares FØR `race_digest` flippes |
| [#4616](https://github.com/NicolaiDolmer/CyclingZone/issues/4616) | Nøgleblok-session. Mail-delen (Resend-nøgler) er leveret; EUR-testkøbet hører i `docs/BILLING_STACK.md`, ikke her | Åbent |
| Privatlivspolitik | `PrivacyPolicyPageEn.jsx` nævner ikke reaktivering eller win-back eksplicit under `email_marketing`. Banner-teksten dækker det indholdsmæssigt og er den bindende tekst, så det er ikke en blocker, men det bør skærpes ved næste opdatering | Åbent, intet issue endnu |

**Betingelser for at flippe `race_digest` til `on`**: #3981 afklaret, webhooken verificeret leverende (så bounces og klager faktisk fanges), og mindst ét døgn i `dry_run` hvor kandidat-antallet ser rigtigt ud.

### Ryddet 8/9

1. ~~GDPR-gæld: `race_digest` tjekker aldrig `consent_preferences.email_marketing`~~ (winback-audit 2/9 §1.2) er lukket af #4654. Koden kræver i dag eksplicit `email_marketing === true` (`emailRaceDigestSweep.js:195`), og både `NULL` og `false` udelukkes. Verificeret i koden 8/9.
2. ~~En `dry_run`-række blokerer den rigtige mail for evigt~~ er lukket af #5038 (`dedupeBlocksSend`). Ingen manuel `DELETE` før et flip længere.
3. ~~`EMAIL_REPLY_TO` havde ingen effekt~~: feltet skal hedde `replyTo` i Resend-SDK'et, og et håndskrevet `reply_to` smides tavst væk. Rettet i #5038.
4. ~~Wordmark-PNG'en viste en gammel version i Outlook~~ er lukket af #5046 (indholds-hash i filnavnet).

### Drift-tjek

```bash
node scripts/check-email-stack-doc.mjs
```

Ingen netværk, ingen database. Scriptet læser `TEMPLATE_TYPES` fra `backend/lib/emailTemplates.js` og flag-nøglerne fra `backend/lib/emailLoopFlag.js` som tekst (ingen import, så ingen sideeffekter) og fejler med exit 1 hvis en mailtype eller en flag-nøgle ikke er nævnt i §2 ovenfor. Tilføjes en fjerde type i koden uden at §2 opdateres, fanges det her i stedet for at drive stille.

## 8. Faldgruber

1. **`email_log.created_at` er rækkens første skrivning, ikke afsendelsestidspunktet.** En `dry_run`-række opdateres til `sent` når typen flippes, og beholder sin oprindelige `created_at`. Den ene sendte mail 8/9 har derfor et tidsstempel fra før flip'et. Vil du vide hvornår der blev sendt, så brug `email_sweep_runs` eller Resends egen logging.
2. **`candidates` i `email_sweep_runs` er observationer pr. tick, ikke unikke personer.** Welcome-sweepen ser det samme nye hold hvert 5. minut i 48 timer, så 32 kandidater kan være ét hold.
3. **`dry_run` blokerer ikke længere en senere afsendelse** (#5038). Den gamle vane med at slette rækker før et flip er nu forkert og sletter kun historik.
4. **En terminal `failed`-række blokerer med vilje.** Uden den ville welcome-sweepen gentage den samme permanente fejl hvert 5. minut. Ryd den eksplicit efter at årsagen er rettet, se runbook §6.5.
5. **Afsenderadressen er hardkodet**, ikke en env-variabel.
6. **Alt i en mail skal ligge på en immutable URL.** En stabil URL med nyt indhold bliver cachet af mail-proxier i op til en uge.
7. **`marketing` er ikke `email_marketing`.** Førstnævnte dækker annoncer og bruges ikke i dag; sidstnævnte er mail-gaten. En forveksling giver enten ulovlige mails eller et tomt segment.
8. **`NULL` i `consent_preferences` er ikke et ja.**
9. **`email_prefs` er fail-open, `consent_preferences` er fail-closed.** De to felter peger i hver sin retning med vilje, og en gate der bruger det forkerte felt fejler stille i den forkerte retning.
10. **Uden webhook er `sent` alt hvad du får at vide.** `delivered`, `bounced` og `complained` skrives kun af webhooken, så uden `RESEND_WEBHOOK_SECRET` er hele driftsdelen af §5 blind.

## 9. Relateret

- [`docs/EMAIL_LOOP_GO_LIVE_RUNBOOK.md`](EMAIL_LOOP_GO_LIVE_RUNBOOK.md) er trin-for-trin: secrets, flip, verifikations-SQL, rollback, webhook-opsætning, DMARC, tærskel-handlinger
- [`docs/audits/winback-consent-audit-2026-09-02.md`](audits/winback-consent-audit-2026-09-02.md) er consent-mekanismerne A-D, segment-SQL og win-back-udkast
- [`docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md`](drafts/mailtekster-2853-v2-dolmer-2026-09-02.md) er de låste tekster og layoutrammen
- [`docs/TONE_OF_VOICE.md`](TONE_OF_VOICE.md) er jeg-stemmen, de forbudte termer og em-dash-forbuddet
- `.claude/learnings/2026-09-08-email-asset-cache.md` er proxy-cache-postmortemet
- [`docs/BILLING_STACK.md`](BILLING_STACK.md): betalingsmails og EUR-spørgsmålet hører der, ikke her
