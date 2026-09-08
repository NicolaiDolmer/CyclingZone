# Runbook — Email-loopet: dry-run → on (#2853)

Del D af #2853. Kode er merged og dormant. Denne runbook er ejerens tjekliste
for at tænde loopet — Claude flipper `app_config` og læser `email_log`,
ejeren lægger secrets og godkender copy.

## 1. Secrets (Infisical → Railway)

| Nøgle | Krav | Bruges i |
|---|---|---|
| `RESEND_API_KEY` | Gyldig Resend-nøgle. `cyclingzone.org` skal være **Verified** (DKIM/SPF) i Resend dashboard. | `backend/lib/emailService.js`, `emailRetrySweep.js` |
| `EMAIL_UNSUB_SECRET` | Vilkårlig lang random streng, samme værdi i Infisical+Railway (bruges både til at signere og verificere unsub-links). | `emailService.js`, `emailUnsubRoute.js`, `emailUnsubUrl.js` |
| `EMAIL_UNSUB_BASE_URL` | Valgfri. Default `https://cyclingzone.org/api/email/unsubscribe` (matcher From-domænet — se `emailUnsubUrl.js`). Sæt kun hvis unsub-stien flyttes. | `emailUnsubUrl.js` |
| `RESEND_WEBHOOK_SECRET` | Signing secret fra webhook-opsætningen i Resend-dashboardet (`whsec_...`). Uden den afviser webhooken alt med 401, og leveringsstatus, bounces og klager når aldrig frem. | `resendWebhook.js` |
| `EMAIL_REPLY_FORWARD_TO` | Valgfri. Adressen indgående svar videresendes til (din egen indbakke). Usat: svar logges stadig i `email_events`, men videresendes ikke. Én warn-linje i loggen, intet crasher. | `resendWebhook.js` |
| `EMAIL_REPLY_TO` | Valgfri. `Reply-To` på alle udgående loop-mails. Usat: uændret adfærd (intet `Reply-To`, og et svar lander i intetheden). Sæt den til den adresse Receiving lytter på, så et svar rammer webhooken. | `emailService.js` |

Afsender-adresse er IKKE en env var — hardkodet `FROM_ADDRESS = "Cycling Zone <updates@cyclingzone.org>"` i `emailService.js`. Skal den ændres, er det en kode-ændring, ikke en Infisical/Railway-nøgle.

**Verificér nøglen (read-only, printer aldrig værdier):**

```
infisical run --env=prod -- node scripts/check-resend-key.mjs
```

Scriptet skelner de to 401-svar fra hinanden. Netop den forskel gav en fejlkonklusion 2/9:

| Svar | Betydning |
|---|---|
| `200` | Gyldig nøgle med fuld adgang. |
| `401 restricted_api_key` | **Gyldig sende-nøgle.** En nøgle med kun "Sending access" må ikke læse domæne-listen; 401 her er forventet. |
| `401 invalid_api_key` | Ugyldig eller tilbagekaldt nøgle. |

Exit 0 = kan sende, 1 = kan ikke, 2 = netværksfejl (siger intet om nøglen). En rigtig testafsendelse er stadig den endelige prøve.

## 2. app_config-nøgler (per mailtype, #2853)

Tabel `app_config` (`key` TEXT PK, `value` JSONB). Tre uafhængige nøgler, hver `"off"` \| `"dry_run"` \| `"on"`:

- `email_loop_welcome`
- `email_loop_day1`
- `email_loop_race_digest`

Fail-safe: mangler en nøgle, eller er værdien ukendt, falder typen tilbage til den fælles legacy-nøgle `email_loop_enabled`; findes den heller ikke, er stage `"off"`. Kilde: `backend/lib/emailLoopFlag.js`.

Cron-kadence (dormant indtil stage ≠ off): welcome hvert 5 min, day1 og race-digest hvert 60 min (race-digest gør kun noget i 19:00-19:59 CET-timen). Retry-drain (`#3600`) kører hvert 5 min og no-op'er medmindre mindst én type er `"on"`.

**Sæt alle tre til dry_run:**

```sql
INSERT INTO public.app_config (key, value, description) VALUES
  ('email_loop_welcome', '"dry_run"'::jsonb, 'Email-loop stage — welcome (#2853)'),
  ('email_loop_day1', '"dry_run"'::jsonb, 'Email-loop stage — day1 (#2853)'),
  ('email_loop_race_digest', '"dry_run"'::jsonb, 'Email-loop stage — race_digest (#2853)')
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW();
```

**Flip én type til on** (kør pr. type når dens dry-run er godkendt — ikke nødvendigvis alle tre samtidig):

```sql
UPDATE public.app_config SET value = '"on"'::jsonb, updated_at = NOW()
WHERE key = 'email_loop_welcome'; -- eller email_loop_day1 / email_loop_race_digest
```

## 3. Verifikations-SQL (email_log)

Kolonner: `id, user_id, team_id, email_type, dedupe_key, status, provider_id, error, created_at, attempts, next_attempt_at, retry_payload` (`database/schema-snapshot.json` → `relations.email_log.columns`).

**Oversigt seneste 24 t, pr. type/status:**

```sql
SELECT email_type, status, COUNT(*)
FROM email_log
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY email_type, status
ORDER BY email_type, status;
```

**Enkeltrækker (dry_run-indhold, fejl-detaljer):**

```sql
SELECT id, user_id, email_type, dedupe_key, status, error, attempts, created_at
FROM email_log
ORDER BY created_at DESC
LIMIT 50;
```

**Kun fejlede/hængende retries:**

```sql
SELECT id, email_type, dedupe_key, status, error, attempts, next_attempt_at
FROM email_log
WHERE status = 'failed'
ORDER BY next_attempt_at NULLS LAST;
```

`status = 'dry_run'` betyder gaten virkede og targeting er korrekt — INGEN rigtig mail sendt. `status = 'sent'` sker kun når stage er `on`.

Siden #2853's driftspakke findes tre statusser mere, som Resend-webhooken skriver oven på en `sent`-række: `delivered`, `bounced` og `complained`. De fortæller hvad der skete EFTER afsendelsen.

Hvilke rækker blokerer en gen-afsendelse:

| Status | Blokerer? |
|---|---|
| `sent`, `delivered`, `bounced`, `complained` | Ja. Mailen nåede Resend. |
| `failed` | Ja. Enten permanent (adresse, nøgle, validering) eller opbrugte retries. En gentagelse ville fejle identisk, så den skal ryddes manuelt når årsagen er rettet (se §6.5). |
| `dry_run` | Nej, aldrig. Rækken bliver opdateret til den rigtige status når typen flippes til `on`. Ingen manuel DELETE før flip længere. |

## 4. Rækkefølge

1. Secrets i Infisical (dev+prod) → synkroniseret til Railway (§1).
2. Resend dashboard: `cyclingzone.org` viser **Verified**.
3. Sæt alle tre nøgler til `dry_run` (§2).
4. Vent ≥24 t. Kør verifikations-SQL (§3) — tjek at kandidat-antal og targeting (aktivitets-/samtykkefilter, #2853 Del B) ser rigtige ud, ingen `failed`-rækker fra config-fejl.
5. Ejer læser EN-teksten i `docs/drafts/mailtekster-2853-2026-08-03.md` og godkender (DA er opfølger, ikke del af denne flip — koden sender kun engelsk i dag).
6. Flip godkendte typer til `on` (§2, pr. type).
7. Første 24 t efter `on`: overvåg `email_log` (§3) + Sentry for `email-loop`-tag. En permanent fejl (ugyldig adresse, config) alarmerer med det samme; retryable fejl først når retry-drain opgiver (se `emailRetrySweep.js`).

## 5. Rollback

Sæt de(n) berørte nøgle(r) tilbage til `off` — ingen deploy, sweeps no-op'er fra næste tick, retry-drain stopper automatisk når ingen type er `on`:

```sql
UPDATE public.app_config SET value = '"off"'::jsonb, updated_at = NOW()
WHERE key IN ('email_loop_welcome', 'email_loop_day1', 'email_loop_race_digest');
```

Allerede sendte mails kan ikke trækkes tilbage. `email_log` bevarer historikken uændret.

## 6. Drift (#2853, mail-drift-pakken)

Alt i dette afsnit handler om hvad der sker EFTER en mail er afsendt. Uden det
er loopet blindt: en død adresse bliver ved med at få mails, en spam-klage når
aldrig nogen, og en spiller der svarer, skriver ud i intetheden.

### 6.1 Webhook i Resend-dashboardet

1. Log ind på resend.com og gå til **Webhooks**.
2. Klik **Add Webhook**.
3. Endpoint-URL: `https://cyclingzone-production.up.railway.app/api/email/resend-webhook`
4. Vælg disse events (og kun dem; resten ignoreres alligevel):
   - `email.sent`
   - `email.delivered`
   - `email.delivery_delayed`
   - `email.bounced`
   - `email.complained`
   - `email.received`
5. Gem. Resend viser nu en **Signing Secret** (`whsec_...`).
6. Læg den i Infisical som `RESEND_WEBHOOK_SECRET` (dev + prod) og synkronisér
   til Railway. Backenden genstarter og begynder at acceptere leveringer.
7. Verificér med Resends **Send test event** på webhooken. Forventet: 200, og en
   ny række i `email_events` (SQL i 6.6).

Går trin 6 galt (secret mangler eller er forkert), svarer endpointet 401 på alt.
Det er med vilje: en levering uden gyldig signatur er ikke fra Resend.

### 6.2 Receiving (indgående svar)

Receiving kræver at `cyclingzone.org` peger sine MX-poster på Resend. Det er en
DNS-ændring, ikke bare en indstilling.

1. Resend-dashboardet, **Domains**, `cyclingzone.org`, slå **Receiving** til.
2. Resend viser de MX-poster der skal oprettes hos domæne-udbyderen. Opret dem.
3. Vent på at Resend markerer Receiving som verificeret (DNS-udbredelse, typisk
   under en time).
4. Sæt `EMAIL_REPLY_FORWARD_TO` (din egen indbakke) og `EMAIL_REPLY_TO` (den
   adresse spillere skal svare til, fx `hej@cyclingzone.org`) i Infisical.

Vigtigt før du rører MX: modtager domænet allerede mail et andet sted, overtager
Resend den trafik. Har `cyclingzone.org` ingen indbakke i dag, er der intet at
miste. Er du i tvivl, så lad Receiving stå slukket. Alt andet i pakken virker
uden den, og webhooken springer bare `email.received` over.

Sådan opfører videresendelsen sig (verificeret i kode, ikke antaget):

- Videresendelsen sætter `Reply-To` til spillerens egen adresse, så du kan
  svare direkte fra din indbakke. Feltet hedder `replyTo` i SDK'et — Resends
  klient oversætter det selv til wire-feltet `reply_to`, og et håndskrevet
  `reply_to` bliver tavst smidt væk. Samme regel gælder `EMAIL_REPLY_TO` på
  udgående loop-mails.
- `Fwd:`-mails til `EMAIL_REPLY_FORWARD_TO` skrives aldrig i `email_log`.
  Bouncer eller klager din egen indbakke over en videresendelse, springer
  webhooken bruger-opslaget over og logger kun en warn-linje — den må ikke
  kunne undertrykke din egen konto fra hele mail-loopet.

### 6.3 DMARC-plan

I dag: `p=none` med `rua` til en Gmail-adresse. `p=none` betyder "rapportér,
men gør ingenting", altså ingen reel beskyttelse mod at nogen sender i vores
navn. Rå XML-rapporter i en Gmail-indbakke er desuden ulæselige i praksis.

Trin, i rækkefølge, uden faste datoer:

1. Skift `rua` til en gratis aggregator (fx dmarcian, Postmark DMARC eller
   URIports). De læser XML'en og viser hvem der sender som os.
2. Kør 2 til 3 uger på `p=none` og se rapporterne. Målet er rene rapporter:
   alt legitimt sendes gennem Resend og består SPF og DKIM, og der er intet
   ukendt system tilbage der sender i vores navn.
3. Når rapporterne har været rene i den periode: skift til
   `p=quarantine; pct=100`. Nu ryger forfalskede mails i spam i stedet for
   indbakken.
4. Efter yderligere rene uger på quarantine: skift til `p=reject`. Forfalskede
   mails afvises helt.

Spring aldrig et trin over. Går man direkte til `p=reject` med en glemt afsender
i systemet, forsvinder den afsenders mails uden spor.

### 6.4 Google Postmaster Tools og Microsoft SNDS/JMRP

Begge er gratis og viser afsender-omdømmet hos de to største modtagere. De er
den eneste måde at se en begyndende omdømme-nedtur, før den koster leverancer.

**Google Postmaster Tools** (postmaster.google.com):

1. Add domain: `cyclingzone.org`.
2. Verificér med den TXT-post Google viser.
3. Data begynder først at komme, når der sendes nok mail til Gmail-adresser.
   Med små volumener kan panelerne stå tomme længe. Det er normalt.

**Microsoft SNDS og JMRP** (sendersupport.olc.protection.outlook.com):

1. SNDS kræver den afsendende IP. Resend sender fra delte IP'er, som vi ikke
   ejer, så SNDS bliver først relevant hvis vi senere flytter til dedikeret IP.
2. JMRP (Junk Mail Reporting Program) er derimod relevant nu: tilmeld
   `cyclingzone.org`, så Microsoft sender klage-rapporter videre. De ankommer
   som `email.complained` gennem Resend og undertrykker brugeren automatisk.

### 6.5 Tærskler og hvad du gør når de brydes

Den daglige rapport lander i ops-kanalen kl. 08 dansk tid. Den @mentioner KUN
når noget er galt. En rolig rapport er en rapport du ikke behøver læse.

| Tærskel | Grænse | Hvad du gør |
|---|---|---|
| Bounce-rate | over 2 % af sendte, min. 10 sendte | Find de bouncede adresser (SQL i 6.6). Er de stavefejl eller døde konti, er brugerne allerede undertrykt automatisk. Fortsætter raten, så sæt typen til `off` og se på targeting. Over 5 % begynder Gmail at straffe hele domænet. |
| Klage-rate | over 0,1 % af sendte, min. 10 sendte | Alvorligt. Læs den mail klagen ramte. Er der noget uventet ved den (forkert modtager, for hyppig, uklar afsender), så sluk typen mens du retter. Klage-raten er den enkeltfaktor der hurtigst ødelægger et afsender-domæne. |
| Døde retries | over 0 | Mailen nåede aldrig frem og prøves ikke igen. Slå `error`-teksten op på rækken (SQL i §3). En stribe 5xx betyder Resend-nedbrud; alt andet er en fejl hos os. |
| Type med kandidater men 0 sendt, to døgn i træk | | Sweepen finder folk, men ingen får mail. Det var præcis formen på fejlen 8/9. Tjek Sentry for `email-loop`-tagget og at nøglerne står korrekt. |

Akut nødbremse er altid den samme: sæt de(n) berørte `app_config`-nøgle til
`off` (§5). Ingen deploy nødvendig.

**Efter en rettet årsag: ryd de terminale rækker.** En `failed`-række med
`next_attempt_at IS NULL` blokerer bevidst en gen-afsendelse, også efter at du
har rettet nøglen eller adressen. Det er med vilje: uden den blokering ville
welcome-sweepen prøve den samme permanente fejl hvert femte minut i 48 timer.
Har du rettet årsagen og vil give de ramte mails en chance til:

```sql
DELETE FROM public.email_log
WHERE status = 'failed'
  AND next_attempt_at IS NULL
  AND created_at > NOW() - INTERVAL '48 hours';
```

Kør altid en `SELECT` med samme `WHERE` først og se på rækkerne. Sletter du en
række for en mail der faktisk blev sendt, får modtageren den igen.

### 6.6 SQL-opslag (email_events)

Kolonner: `id, provider_event_id, provider_id, type, recipient, payload,
created_at`.

**Hvad er der sket seneste døgn, pr. event-type:**

```sql
SELECT type, COUNT(*)
FROM email_events
WHERE created_at > NOW() - INTERVAL '24 hours'
GROUP BY type
ORDER BY COUNT(*) DESC;
```

**Alle bounces med årsag (hård eller blød står i payloadens bounce-objekt):**

```sql
SELECT created_at, recipient,
       payload->'data'->'bounce'->>'type'    AS bounce_type,
       payload->'data'->'bounce'->>'subType' AS bounce_subtype,
       payload->'data'->'bounce'->>'message' AS besked
FROM email_events
WHERE type = 'email.bounced'
ORDER BY created_at DESC
LIMIT 50;
```

**Klager (skal helst være tom):**

```sql
SELECT created_at, recipient, provider_id
FROM email_events
WHERE type = 'email.complained'
ORDER BY created_at DESC;
```

**Hvem er undertrykt automatisk, og hvorfor:**

```sql
SELECT id, email,
       email_prefs->>'suppressed_reason' AS aarsag,
       email_prefs->>'suppressed_at'     AS tidspunkt
FROM users
WHERE email_prefs->>'suppressed_reason' IS NOT NULL
ORDER BY email_prefs->>'suppressed_at' DESC;
```

**Leveringsrate seneste 7 dage:**

```sql
SELECT status, COUNT(*)
FROM email_log
WHERE created_at > NOW() - INTERVAL '7 days'
GROUP BY status
ORDER BY COUNT(*) DESC;
```

**Indgående svar (uddraget er de første 200 tegn):**

```sql
SELECT created_at, recipient,
       payload->>'inbound_subject' AS emne,
       payload->>'inbound_excerpt' AS uddrag,
       payload->>'forwarded'       AS videresendt
FROM email_events
WHERE type = 'email.received'
ORDER BY created_at DESC
LIMIT 20;
```

**Sweep-kørsler: fandt vi kandidater vi ikke fik sendt til?**

```sql
SELECT email_type, stage,
       SUM(candidates) AS kandidater,
       SUM(sent)       AS sendt,
       COUNT(*)        AS koersler
FROM email_sweep_runs
WHERE created_at > NOW() - INTERVAL '48 hours'
GROUP BY email_type, stage
ORDER BY email_type;
```

**Gen-aktivér en undertrykt bruger** (kun hvis du er sikker på at adressen
virker igen, fx efter at brugeren selv har rettet den):

```sql
UPDATE public.users
SET email_prefs = (email_prefs - 'suppressed_reason' - 'suppressed_at') || '{"all": true}'::jsonb
WHERE id = '<user-uuid>';
```
