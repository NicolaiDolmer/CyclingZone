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

Afsender-adresse er IKKE en env var — hardkodet `FROM_ADDRESS = "Cycling Zone <updates@cyclingzone.org>"` i `emailService.js`. Skal den ændres, er det en kode-ændring, ikke en Infisical/Railway-nøgle.

MCP-nøglen målt ugyldig 2/9 — verificér med en rigtig testafsendelse (dry_run-trin 3), ikke kun at nøglen findes.

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
