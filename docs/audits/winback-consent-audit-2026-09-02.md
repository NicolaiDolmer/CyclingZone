# Win-back consent-audit, segment og mail-udkast

> **Status:** docs-only, ingen kode aendret. Refs #2760 #4592 #2853.
> **Opgave:** ejer-direktiv 20/7 (#2760): "Har vi indsamlet korrekt tilladelse til at sende dem mails? Tjek venligst, eller forslaa endnu bedre setup."
> **Forfatter:** Claude Code (docs/2760-winback-consent), 2026-09-02.

## 1. Consent-audit

### 1.1 Hvad indsamles hvor

Cycling Zone har to uafhaengige samtykke-mekanismer i dag. De maa ikke forveksles:

**A. `users.consent_preferences` (JSONB, migration `2026-05-11-consent-preferences.sql`)**

Sat af `CookieBanner.jsx` (`frontend/src/lib/consent.jsx`), vist for alle indloggede brugere indtil de svarer. Fire kategorier, kun tre er reelle valg (`necessary` er altid `true`):

| Kategori | UI-label (EN) | UI-beskrivelse (EN, `banners.json`) |
|---|---|---|
| `analytics` | Analytics | "We anonymously measure how the game is used... (Clarity/GA/Vercel)" |
| `marketing` | Marketing | **"Not used today. If we later show ads or remarket, it only happens if you say yes here."** |
| `email_marketing` | Email | **"Occasional newsletters about major season updates or events. Transactional emails (auction won, etc.) do not depend on this choice."** |

Skema (fra migrationen): `{ version: 1, necessary: true, analytics: bool, marketing: bool, email_marketing: bool, updated_at: ISO8601 }`. `NULL` betyder banneret ikke er besvaret endnu (typisk et hold oprettet foer 2026-05-11 der aldrig loggede ind igen, eller pre-login-valg der endnu ikke er migreret).

**Konklusion (vigtigt for win-back):** `email_marketing` er **allerede skrevet ordret til at daekke** "occasional newsletters about major season updates" (spillets egen beskrivelse i banneret) og udelukker eksplicit transaktionelle mails. En win-back-mail om "dit hold koerte mens du var vaek, ny saeson starter 28/9" er en saesonopdatering, ikke en transaktionel besked til en igangvaerende handling. Den korrekte gate er derfor `consent_preferences.email_marketing === true`, IKKE `marketing` (som ifoelge egen UI-tekst "ikke bruges i dag" og daekker annoncer/remarketing, et andet formaal).

**B. `users.email_prefs` (JSONB, `backend/lib/emailPrefs.js`)**

Per-mailtype opt-OUT for retention-loopets tre typer (`welcome`, `day1`, `race_digest`). **Fail-open by design:** fravaer af noegle, fravaer af hele objektet, eller ukendt type = sendt. Kun et eksplicit `{"all": false}` eller `{"<type>": false}` blokerer. Dette er unsub-mekanikken (link i mailens bund), ikke et samtykke-indsamlings-flow, og GDPR-uafhaengigt af `consent_preferences`.

**C. Supabase Auth-signup (kontooprettelse)**

Kontooprettelse selv (e-mail/adgangskode eller magic link via Supabase Auth) indsamler intet marketing-samtykke. Det er en transaktionel handling: brugeren opretter en konto og faar service-mails der hoerer til kontoen (verifikation, adgangskode-reset). Dette daekker IKKE markedsfoering under GDPR, jaevnfoer art. 6(1)(a) (samtykke) vs. art. 6(1)(b) (kontraktopfyldelse/service).

**D. Founder-waitlist-samtykke (`WaitlistConsentText.jsx`, separat flow)**

En tredje, adskilt mekanisme: eksplicit checkbox-samtykke ("I consent to Cycling Zone storing my contact info... to be contacted about the Founder waitlist and premium launch") indsamlet ved waitlist-signup, foer konto. Dette samtykke daekker waitlist-opfoelgning, ikke generelle spilkonti, og de fleste dormante spilkonti i segmentet nedenfor gik formentlig aldrig gennem waitlisten. **Ikke en gyldig hjemmel for win-back-mails til eksisterende spillere** medmindre bruger-ID kan krydsrefereres til en waitlist-raekke med `true` her, hvilket ikke er verificeret i denne audit.

### 1.2 Kritisk fund: eksisterende retention-loop tjekker IKKE `consent_preferences`

`backend/lib/emailRaceDigestSweep.js` (linje 110-128, allerede merged og live-kapabel via `email_loop_race_digest`-flaget) filtrerer i dag KUN paa:
1. `last_seen` inden for 14 dage (aktivitetsvindue, ikke dormancy)
2. `isEmailTypeEnabled(u.email_prefs, "race_digest")` (opt-OUT, fail-open)

**Den tjekker ALDRIG `consent_preferences.email_marketing`.** Samme moenster gaelder formentlig `welcome`- og `day1`-sweepsne (ikke laest i denne audit, men samme `emailPrefs.js`-mekanisme). Konsekvens: retention-loopet (naar det taendes til `on`) sender allerede i dag til enhver aktiv bruger med en email, uanset om de eksplicit har afvist "Email"-kategorien i cookie-banneret (`rejectAll` eller et eksplicit `email_marketing: false`-valg). Det er en eksisterende GDPR-gaeld, ikke noget denne audit introducerer, men win-back-segmentet MAA IKKE arve samme fejl, fordi win-back specifikt rammer folk der ikke laengere er "aktive" (14-dages-vinduet ville alligevel udelukke dem) og fordi win-back er tydeligere markedsfoering end en digest til en spiller der lige har spillet.

**Anbefaling:** flag denne mangel i #2853/#2725-traaden som separat opfoelgning (ikke del af denne PR's scope, som er docs-only). Win-back MAA gate paa `email_marketing === true` fra dag 1 (se afsnit 4).

### 1.3 GDPR-vurdering: er "dit hold koerte mens du var vaek" service eller markedsfoering?

**Vurdering: markedsfoering, ikke service.** Begrundelse:
- Modtageren er per definition inaktiv (30+ dages fravaer). Der er ingen igangvaerende transaktion mailen understoetter (til forskel fra "auktion vundet" eller adgangskode-reset).
- Formaalet er eksplicit reaktivering: faa brugeren til at logge ind igen og engagere sig i naeste saeson. Det er by definition en markedsfoerings-/vaekst-handling, ikke kontoservice.
- Cookie-banneret selv har allerede skrevet denne kategori ind under `email_marketing` ("major season updates"), saa det er ikke engang en graazone internt i produktet: teksten er allerede skrevet til lige praecis dette use case.

**Konklusion + anbefaling:**
1. Send KUN win-back-mails til brugere med `consent_preferences.email_marketing === true` (eksplicit `true`, ikke `NULL` og ikke `false`). `NULL` maa IKKE behandles som stiltiende accept, jaevnfoer GDPR art. 4(11) (samtykke skal vaere en utvetydig, aktiv handling).
2. Respektér `email_prefs` (unsub) oveni, som en ny type (`winback`) i `EMAIL_PREF_TYPES` (se afsnit 4), saa en spiller kan afmelde win-back specifikt uden at afmelde alt.
3. Ret IKKE privacy-policy-teksten i denne PR (docs-only-scope), men noter til ejer: `PrivacyPolicyPageEn.jsx` naevner ikke eksplicit "win-back"/"re-engagement" som formaal under `email_marketing`-punktet. Den nuvaerende banner-tekst ("occasional newsletters about major season updates or events") daekker det indholdsmaessigt, men en fremtidig privacy-policy-opdatering kunne goere det endnu tydeligere. Ikke en blocker for at sende, da banner-teksten allerede er den bindende samtykke-tekst brugeren saa.
4. `marketing`-kategorien (annoncer/remarketing) er IKKE relevant her og skal ikke bruges som gate.

## 2. Segment: sovende brugere med samtykke (read-only SQL, IKKE koert af Claude)

Diskriminator for "menneske-hold" er den samme som `dormantTeamsReport.js`/`betaResetService`/`academyIntake`: `is_ai=false, is_bank=false, is_test_account=false`. Dormancy-taerskel er 30 dage (`managerActivity.js`, ejer-definition 2/9, #4307). Frosne hold (`is_frozen=true`) ekskluderes bevidst her, til forskel fra `dormantTeamsReport.js`s parkerings-rapport, fordi et allerede frosset/parkeret hold ikke er et relevant win-back-maal foer del 2/3 af #4592-epicen er bygget.

```sql
-- Kandidat-segment: sovende menneske-hold med marketing-e-mail-samtykke.
-- READ-ONLY. Koeres af orkestratoren, ikke af Claude i denne PR.
WITH candidates AS (
  SELECT
    u.id            AS user_id,
    u.email,
    u.language,
    u.last_seen,
    EXTRACT(DAY FROM NOW() - u.last_seen)::int AS days_since_last_seen,
    t.id            AS team_id,
    t.name          AS team_name,
    t.league_division_id,
    ld.label        AS pool_label,
    ss.rank_in_division,
    ss.total_points
  FROM users u
  JOIN teams t ON t.user_id = u.id
  LEFT JOIN league_divisions ld ON ld.id = t.league_division_id
  LEFT JOIN seasons s ON s.status = 'active'
  LEFT JOIN season_standings ss ON ss.team_id = t.id AND ss.season_id = s.id
  WHERE t.is_ai = false
    AND t.is_bank = false
    AND t.is_test_account = false
    AND t.is_frozen = false
    AND (u.last_seen IS NULL OR u.last_seen < NOW() - INTERVAL '30 days')
    AND u.consent_preferences ->> 'email_marketing' = 'true'
    AND COALESCE((u.email_prefs -> 'all')::text, 'true') != 'false'
    AND COALESCE((u.email_prefs -> 'winback')::text, 'true') != 'false'
)
SELECT * FROM candidates ORDER BY days_since_last_seen DESC NULLS FIRST;

-- Total antal kandidater.
SELECT COUNT(*) AS candidate_count FROM candidates;

-- Fordeling paa sprog.
SELECT language, COUNT(*) FROM candidates GROUP BY language ORDER BY 2 DESC;

-- Fordeling paa dage siden sidst set (bucket).
SELECT
  CASE
    WHEN days_since_last_seen IS NULL THEN 'aldrig set'
    WHEN days_since_last_seen < 45 THEN '30-44 dage'
    WHEN days_since_last_seen < 60 THEN '45-59 dage'
    WHEN days_since_last_seen < 90 THEN '60-89 dage'
    ELSE '90+ dage'
  END AS bucket,
  COUNT(*)
FROM candidates
GROUP BY 1
ORDER BY MIN(days_since_last_seen) NULLS FIRST;
```

**Forventet stoerrelse:** ejer-briefen angiver ca. 77 pr. 2/9. Ikke verificeret i denne audit (SQL er ikke koert, jaevnfoer opgavens instruks om at orkestratoren koerer den). Bemaerk at dette tal sandsynligvis er LAVERE end #4592's raa "64 sovende D3-menneskehold" fordi consent-filteret (`email_marketing = true`, eksplicit) leder efter et mindre delmaengde: mange dormante konti har formentlig `consent_preferences IS NULL` (oprettet foer banneret eller aldrig logget ind igen efter det), og disse tael­les ikke med, hvilket er den konservative og korrekte GDPR-fortolkning (jf. 1.3, punkt 1).

**Alternativ (bredere) forespoergsel** hvis ejeren vil se hvor mange der falder fra pga. `NULL` vs. eksplicit `false`, til beslutningsstoette (ikke til afsendelse):

```sql
SELECT
  CASE
    WHEN u.consent_preferences IS NULL THEN 'ikke svaret (NULL)'
    WHEN u.consent_preferences ->> 'email_marketing' = 'true' THEN 'email_marketing = true'
    ELSE 'email_marketing = false'
  END AS consent_state,
  COUNT(*)
FROM users u
JOIN teams t ON t.user_id = u.id
WHERE t.is_ai = false AND t.is_bank = false AND t.is_test_account = false AND t.is_frozen = false
  AND (u.last_seen IS NULL OR u.last_seen < NOW() - INTERVAL '30 days')
GROUP BY 1;
```

## 3. Mail-udkast (EN foerst, DA under)

Samme layout-ramme som `docs/drafts/mailtekster-2853-v2-dolmer-2026-09-02.md` (navy baand, hvid krop, guld primaer-knap, Discord-sekundaer-knap, underskrift "Dolmer, Cycling Zone"). Ingen tilbud, ingen rabat, ejer-krav overholdt. Vinkel: "your team raced while you were away" + konkret grund til at komme tilbage (ny saeson 28/9). Placeholders er ægte felter fra segment-SQL'en ovenfor (`{{teamName}}`, `{{poolLabel}}`, `{{rankInDivision}}`); Tilmeld-dig-knappen er betinget af at #4592's del 3 (#452) er leveret foerst.

### EN

Subject: `{{teamName}} raced while you were away`

```
Hi,

{{teamName}} kept racing while you were away. Last time you checked in was
{{daysSinceLastSeen}} days ago, and the team is currently {{rankInDivision}}
in {{poolLabel}}.

The next season starts 28 September. If you want back in before then, now is
the time.

[Open your dashboard]  https://cyclingzone.org/dashboard

Something broken or confusing? Come say hi on Discord, I read everything.
[Join the Discord]  https://discord.gg/ykysBrWUyC

Dolmer, Cycling Zone
```

*Betinget rid, kun hvis #4592 del 3 (#452, tilmeld-dig-knap) er leveret foer denne mail sendes:* erstat "Open your dashboard"-linjen med en ekstra CTA-raekke: `[Sign up for next season]  https://cyclingzone.org/dashboard` (samme link indtil endpointet fra #452 findes, tekst opdateres naar den rigtige route findes).

### DA

Subject: `{{teamName}} koerte mens du var vaek`

```
Hej,

{{teamName}} blev ved med at koere mens du var vaek. Sidst du tjekkede ind
var for {{daysSinceLastSeen}} dage siden, og holdet ligger lige nu som
{{rankInDivision}} i {{poolLabel}}.

Naeste saeson starter 28. september. Vil du med igen inden da, er det nu.

[Aabn dit dashboard]  https://cyclingzone.org/dashboard

Noget der er i stykker eller forvirrende? Sig hej paa Discord, jeg laeser alt.
[Deltag paa Discord]  https://discord.gg/ykysBrWUyC

Dolmer, Cycling Zone
```

*Bemaerk (koden-status):* per `mailtekster-2853-v2`-dokumentet sender koden i dag KUN engelsk; DA-sprog-pr.-modtager er en opfoelger-PR. Denne DA-tekst er derfor et udkast til godkendelse, ikke noget der sendes foer den opfoelger er bygget.

**Ikke inkluderet, bevidst:** resultatliste/detaljer fra "raced while you were away" (i modsaetning til den daglige digest) fordi win-back-modtagere per definition ikke har vaeret inde i 30+ dage, saa en fuld resultatliste ville vaere lang og upraecis om hvad der reelt betyder noget. Rank + pulje er det tal ejeren selv har fremhaevet som relevant i patch-note-reglen ("tal der siger om spilleren er beroert").

## 4. Teknisk forslag: ny mailtype `winback`

Foelger #2853's eksisterende moenster (`emailLoopFlag.js`, `emailPrefs.js`, `app_config`) 1:1, ingen ny infrastruktur:

1. **Ny `app_config`-noegle:** `email_loop_winback`, samme tre-tilstand `off` \| `dry_run` \| `on` som de tre eksisterende typer. Faelder tilbage til `email_loop_enabled` (legacy) hvis noeglen mangler, som de andre, jaevnfoer `emailLoopFlag.js`s eksisterende fallback-kaede, men i praksis boer denne ALDRIG staa paa noget andet end `off` foer ejeren eksplicit har sat den (winback er tydeligere markedsfoering end welcome/day1/digest, saa den fortjener sin egen eksplicitte flip, ikke en arvet legacy-vaerdi).
2. **Ny type i `EMAIL_PREF_TYPES`:** `"winback"` tilfoejes til `backend/lib/emailPrefs.js`s liste, saa `email_prefs: {"winback": false}` lader en spiller afmelde specifikt win-back-mails uden at paavirke `welcome`/`day1`/`race_digest`.
3. **Dedupe: en pr. bruger pr. 60 dage.** `dedupe_key` foelger samme moenster som digestens `digest:<userId>:<YYYY-MM-DD>`, men med en 60-dages-vindue-noegle i stedet for kalenderdag, fx `winback:<userId>:<yyyy-Www-bucket>` hvor bucket er `floor(unix_days / 60)`, eller simplere: sweep'et slaar `email_log` op for seneste `winback`-raekke pr. bruger og springer over hvis `created_at > NOW() - INTERVAL '60 days'` (samme retning som `emailService.js`'s eksisterende dedupe-mekanisme, men lookup i stedet for en beregnet noegle, fordi 60 dage ikke er en fast kalenderperiode saadan som en dags-digest er).
4. **Kandidatliste vises ejeren FOeR foerste send (dry_run-krav, jaevnfoer #2853's egen rutine):** sweep'et skal, ligesom `email_loop_welcome`/`day1`/`race_digest`, koere med `dry_run`-stage foerst og logge kandidater i `email_log` uden at kalde Resend. Derudover, fordi win-back-modtagere aldrig har set produktet for nylig, ANBEFALES et ekstra skridt ud over den eksisterende runbook: et engangs-script (a la `dormantTeamsReport.js`, men med consent-filteret fra afsnit 2 her) der udskriver den fulde kandidatliste (navn, email, dage siden login, pulje/rank) til ejerens gennemsyn i almindelig tekst/markdown, FOeR selv `dry_run`-stadiet flippes, fordi win-back er den foerste mailtype hvor "forkert targeting" betyder at kontakte folk der aktivt har forladt spillet.
5. **Rakkefoelge, samme moenster som `EMAIL_LOOP_GO_LIVE_RUNBOOK.md`:** `off` -> engangs-kandidatliste til ejer-godkendelse -> `dry_run` (>=24t, verificér `email_log`-targeting og consent-filter) -> ejer godkender EN-teksten (denne fil) -> `on`. DA foelger naar sprog-pr.-modtager (#2853-opfoelger) er live, samme begraensning som de tre eksisterende typer.
6. **Segment-forespoergslen i afsnit 2 bliver den logiske kilde** til sweep'ets `WHERE`-clause; ingen ny dormancy-definition opfindes, den genbruger `managerActivity.js`s 30-dages-taerskel (samme SSOT som #4592s parkerings-logik) og `consent_preferences.email_marketing`-gaten fra afsnit 1.3.

**Ikke bygget i denne PR** (docs-only, jaevnfoer opgavens scope): selve sweep-koden, `app_config`-raekken, `EMAIL_PREF_TYPES`-udvidelsen og mail-templaten i `emailTemplates.js`. Naeste session bygger disse efter ejer-godkendelse af mail-teksten i afsnit 3 og consent-anbefalingen i afsnit 1.3.
