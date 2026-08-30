# De sociale features' regler - SSOT

> **Læs denne FØR enhver opgave der rører de sociale flader: Discord-koblingen, rollesynkronisering,
> DM-udsendelse og DM-præferencer, in-app-notifikationer, achievements, opbakning i forummet,
> holdprofiler og tilstedeværelse, eller ranglister.**
>
> Sociale features er en af ejerens 10 kernefunktioner og havde indtil 30/8 intet samlet
> SSOT-dokument. Det eneste eksisterende områdedokument, [`FORUM_RULES.md`](FORUM_RULES.md),
> dækker forummets indhold og moderation. Denne fil dækker resten, og henviser til FORUM_RULES
> hvor grænsen går.
>
> Denne fil beskriver **hvad der kører i dag**, ikke hvad der er ønsket. Flere flader spilleren
> kan se er ikke bygget, og flere achievements der er synlige kan ikke opnås. Se §9 og §10.
>
> Alle tal er målt i prod 30/8 2026 (Europe/Copenhagen) via Supabase, eller læst direkte i koden.
> Kommandoen eller filstien står ved siden af hvert tal.

---

## 0. Den ufravigelige regel

**Der sendes ALDRIG spillerbeskeder på ejerens vegne.** AI laver udkast, ejeren poster selv.

| | |
|---|---|
| Låst | Ejer-instruktion 6/8 2026, aften |
| Kilde | `~/.claude/projects/C--Dev-CyclingZone/memory/feedback_never_send_player_messages_on_owners_behalf.md` |
| Ordlyd | *"Du skal ikke sende beskeder på vegne af mig."* |

Reglen dækker Discord-kanaler, Discord-DM'er, forum-opslag og enhver anden flade hvor afsenderen
læses som ejeren. Et godkendt udkast betyder "teksten er rigtig", ikke "post den for mig".
Kommunikations-leverancer er færdige udkast i chatten, EN først og DA under, klar til copy-paste.
Aldrig `discord_send` eller webhook mod en spillerkanal.

**Den eneste undtagelse er etablerede AUTOMATISKE systemer** som er features i spillet, ikke
beskeder fra ejeren: resultat-feeds til divisionskanalerne, digest-DM'en (§4.6), auktions- og
transfer-DM'er (§4.2) og ops-alarmer. De sender fordi koden er bygget til det, ikke fordi en agent
besluttede at skrive til nogen.

Beslægtet og lige så bindende: spillervendt tekst merges aldrig uden ejerens eksplicitte ja til den
konkrete ordlyd (`.claude/learnings/2026-08-28-shipped-player-copy-without-explicit-yes.md`), og
community-copy skal verificeres mod koden før den påstår at noget mangler
(`.claude/learnings/2026-08-21-community-copy-claimed-unshipped-features.md`).

---

## 1. Kortet over de sociale flader i dag

| Flade | Status | Hvor |
|---|---|---|
| Discord-server + kanaler | **Live** | guild `1504615050831466669`, `discordRoleSync.js:17` |
| Discord division-roller, auto-sync | **Live**, daglig reconcile | `discordRoleSync.js`, `cron.js:1421-1425` |
| Discord-DM til manageren | **Live**, 9 typer | `discordNotifier.js:566`, se §4.2 |
| Per-type DM-præferencer | **Live**, 6 nøgler | `discordDmPrefs.js:12-19` |
| Discord-kanalposter (webhooks) | **Live**, 20 konfigurerede | `discordNotifier.js:131-178` |
| In-app-notifikationer | **Live**, 54 typer | `notificationTypes.js` |
| Achievements | **Live**, 46 definitioner | `achievementEngine.js` |
| Forum med opbakning | **Live** siden 6/8 | `forum.js`, se `FORUM_RULES.md` |
| Holdprofil (offentlig) | **Live** | `frontend/src/pages/TeamProfilePage.jsx`, rute `teams/:id` |
| Managerprofil (offentlig) | **Live** | `frontend/src/pages/ManagerProfilePage.jsx`, rute `managers/:teamId` |
| Online-prik + "sidst set" | **Live**, 5-min-granularitet | `api.js:13856`, `OnlineBadge.jsx` |
| Global rangliste | **Live**, 231 hold rangeret | `globalRankFormula.js`, `global_rank_mv` |
| **Spiller-til-spiller-beskeder i spillet** | **FINDES IKKE** | ingen tabel, ingen route |
| **Notifikation når du låser en achievement op** | **FINDES IKKE** | `achievement` optræder ikke i `notificationService.js` |
| **Notifikation ved opbakning** | **FINDES IKKE**, bevidst v1-fravalg | `forum.js:781` |
| **Referral-/rekrutteringsrangliste** | **FINDES IKKE** | ønsket i [#3051](https://github.com/NicolaiDolmer/CyclingZone/issues/3051) |
| **"For sjov"-achievement-kategori** | **FINDES IKKE** | ønsket i #3051, afhænger af #3044 |

---

## 2. Discord-koblingen: hvordan en spiller bliver koblet

En spiller kobler sig selv ved at **indtaste sit Discord-bruger-id manuelt** i profilen. Der er
ingen OAuth, intet bot-verifikations-flow og ingen ejerskabskontrol.

| Regel | Værdi | Hvor |
|---|---|---|
| Felt | `users.discord_id` | `database/schema-snapshot.json`, `relations.users.columns` |
| Format-validering | `/^\d{17,19}$/`, kun i frontenden | `frontend/src/pages/ProfilePage.jsx:127` |
| Skrivevej | direkte Supabase-update fra klienten på `users` | `ProfilePage.jsx:135-138` |
| Unikhedskrav | **ingen** unique index på `discord_id` | `select indexname from pg_indexes where tablename='users' and indexdef ilike '%discord%'` gav 0 rækker |
| Verifikations-knap | `POST /api/me/discord-dm-test` sender en test-DM | `api.js:9149` |
| Status-endpoint | `GET /api/me/discord-status` | `api.js:9127` |

**Målt 30/8:** 31 af 256 brugere har et `discord_id`. Blandt de 234 menneskehold er 31 koblet, altså
**13 %**. Ingen dubletter i dag (`select discord_id, count(*) ... having count(*)>1` gav 0 rækker).

Botten kan ikke DM'e en spiller der ikke deler server med botten, eller som har slået
"Allow DMs from server members" fra. Fejlteksten i `sendTestDM` siger netop det
(`discordNotifier.js:632`).

**Nudge på dashboardet:** har brugeren intet `discord_id`, vises Discord-nudgen som betinget
engangskort. Den kan afvises, og afvisningen gemmes kun i `localStorage`
(`cz-dashboard-discord-nudge-dismissed`, `DashboardPage.jsx:758-762`), ikke server-side. Det er
modsat onboarding-kortet, som blev flyttet til server-side persistering i #2439 netop fordi
klient-lokalt dismiss ikke holder på tværs af enheder. Reglen for hvor mange nudge-bannere der må
være ad gangen står i [`DASHBOARD_RULES.md`](DASHBOARD_RULES.md) linje 44: **maks ét**, og
Discord-nudgen er det ene.

---

## 3. Division-rollesynkronisering

**Spillet er source of truth for hvilken division en spiller er i.** Discord-rollen følger efter,
aldrig omvendt. Ingen manuelle reaction-roller.

| Regel | Værdi | Hvor |
|---|---|---|
| Guild | `1504615050831466669` | `discordRoleSync.js:17` (`DIVISION_GUILD_ID`) |
| Rolle-map | 15 hårdkodede rolle-id'er, `league_division_id` 1-15 | `discordRoleSync.js:20-36` (`DIVISION_ROLE_MAP`) |
| Kadence | hver 24. time, idempotent reconcile | `cron.js:1421-1425` |
| Kilde-udvalg | `teams` hvor `is_ai=false` og `is_test_account=false` og `league_division_id` ikke null | `discordRoleSync.js:116-121` |
| Ikke-medlem | springes over (`skipped: "not-a-member"` ved HTTP 404) | `discordRoleSync.js:84` |
| Rate limit | 429 respekteres via `retry_after` + 300 ms buffer | `discordRoleSync.js:62-67` |
| Pause mellem rolle-kald | 300 ms | `discordRoleSync.js:97, 103` |

`computeDivisionRoleUpdate` rører **kun** division-roller. Enhver anden rolle på medlemmet er
urørt, fordi `toRemove` filtreres mod `ALL_DIVISION_ROLE_IDS` (`discordRoleSync.js:50`).

**Målt 30/8:** `league_divisions` har 15 rækker med max id 15, og 0 menneskehold ligger i en
division uden for rolle-mappet. Dækningen er altså komplet i dag. Den er hårdkodet, ikke udledt:
oprettes en 16. division, får dens hold ingen rolle, og intet i koden siger fra. Se §9.

---

## 4. Discord-DM

### 4.1 De fem gates en DM skal igennem

En DM sendes kun hvis **alle fem** er opfyldt. Rækkefølgen er den faktiske i `notifyDiscordDM`
(`discordNotifier.js:566-611`).

| # | Gate | Regel | Hvor |
|---|---|---|---|
| 1 | Live-guard | `SUPABASE_URL` skal indeholde prod-ref `ghwvkxzhsbbltzfnuhhz`, eller `DISCORD_LIVE_MESSAGING=allow` | `discordNotifier.js:42-49` |
| 2 | Test-/staging-routing | `teams.is_test_account=true` tvinger ALTID stdout; `DISCORD_DM_TARGET` kan sætte `stdout` eller `test-channel` | `discordDmTarget.js:4-8`, `discordNotifier.js:571-591` |
| 3 | Modtager findes | `users.discord_id` skal være sat | `discordDmRecipient.js:29` |
| 4 | Hovedafbryder | `users.discord_dm_enabled` må ikke være `false` | `discordDmRecipient.js:30` |
| 5 | Per-type-præference | den mappede nøgle i `users.discord_dm_prefs` må ikke være præcis `false` | `discordDmPrefs.js:46-50` |

Gate 5 **fejler åbent**: en manglende nøgle, et manglende prefs-objekt eller en type uden toggle
giver alle `true`. Kun en eksplicit `false` slukker.

### 4.2 De ni DM-typer og de seks præference-nøgler

Der findes **9 DM-typer** i dag. Talt som de `type`-værdier der når `notifyDiscordDM`
(`discordNotifier.js:685, 700, 713, 731, 740, 772, 798`):

`auction_outbid` · `auction_won` · `transfer_offer` · `transfer_accepted` · `transfer_rejected` ·
`watchlist_rider_auction` · `board_update` · `board_critical` · `race_result_digest`

`race_result_digest` er en **Discord-embed-type, ikke en in-app-notifikationstype**, og indsættes
aldrig i `notifications`. Derfor hedder dens injicerbare leveringsparameter `deliverDM` og ikke
`notifyFn`: `financeNotificationContract.test.js` opdager `notifyFn({ type: "<literal>" })` og
kræver at typen findes i `notifications_type_check` (`discordNotifier.js:784-790`). Omdøb den ikke.

`notifyBoardUpdateDM` og `notifyRaceResultDigestDM` har begge `cronRun = true` som **default**,
fordi deres eneste kaldere i produktion er cron (`discordNotifier.js:770, 796`).

`DM_PREF_KEYS` (`discordDmPrefs.js:12-19`), i den rækkefølge indstillings-UI'et viser dem
(Auctions, Transfers, Club):

`auction_outbid` · `auction_won` · `watchlist_rider_auction` · `transfer_offer` ·
`transfer_response` · `board_update`

Lav-niveau-typer der deler en toggle (`DM_TYPE_TO_PREF_KEY`, `discordDmPrefs.js:23-32`):

| DM-type | Præference-nøgle |
|---|---|
| `transfer_accepted`, `transfer_rejected` | `transfer_response` |
| `board_update`, `board_critical` | `board_update` |
| alle øvrige mappede | samme navn som typen |

De 6 nøgler dækker 8 af de 9 DM-typer. Den niende, **`race_result_digest`, har ingen toggle** og kan
kun slås fra ved at slukke hovedafbryderen for alle DM'er (§9, punkt 9). `transfer_completed` og
`swap_completed` er derimod kanal-typer, ikke DM-typer, og hører under §5.

**Målt 30/8:** 31 brugere har `discord_id`, alle 31 har `discord_dm_enabled` forskellig fra `false`,
og **kun 1 bruger har overhovedet gemt en per-type-præference** (`discord_dm_prefs` hverken null
eller `{}`). Præference-UI'et bliver reelt ikke brugt. Om det skyldes at defaults er rigtige eller
at ingen finder indstillingen, er ikke undersøgt.

### 4.3 API-fladen

| Endpoint | Rolle | Hvor |
|---|---|---|
| `GET /api/me/discord-status` | id, hovedafbryder, prefs, auto-afkoblings-flag | `api.js:9127` |
| `POST /api/me/discord-dm-test` | send test-DM, 400 hvis intet id | `api.js:9149` |
| `PATCH /api/me/discord-dm-enabled` | hovedafbryder | `api.js:9164` |
| `PATCH /api/me/discord-dm-prefs` | merger patch ind i eksisterende prefs | `api.js:9178-9196` |

Patchen saniteres ved API-grænsen: kun kendte nøgler med **strenge booleans** accepteres, ukendte
nøgler rapporteres tilbage så requesten kan afvises (`sanitizeDmPrefs`, `discordDmPrefs.js:57-68`).
Ingen streng- eller tal-coercion.

### 4.4 Levering, retry og outbox

| Regel | Værdi | Hvor |
|---|---|---|
| Bot-token | `DISCORD_BOT_TOKEN` **eller** `DISCORD_TOKEN`, i den rækkefølge | `discordNotifier.js:307-313` |
| Retryable fejl | havner i `discord_dm_outbox` | `discordNotifier.js:510-530` |
| Outbox-drain | hvert 5. minut | `cron.js:1427-1431` |
| Webhook-outbox-drain | hvert 5. minut | `cron.js:1434-1437` |
| Token-safety-net | hver 24. time | `cron.js:1415-1419` |

**Målt 30/8:** `discord_dm_outbox` og `discord_webhook_outbox` er begge tomme.

### 4.5 Auto-afkobling ved døde koblinger

| Regel | Værdi | Hvor |
|---|---|---|
| Tærskel | **3 på hinanden følgende** permanente recipient-blocked-fejl | `discordDeadConnection.js:25` (`DEAD_CONNECTION_THRESHOLD`) |
| Nulstilling | enhver **leveret** DM nulstiller tælleren | `discordNotifier.js:410-419` |
| Log-niveau | `console.warn`, bevidst **ikke** Sentry-error | `discordNotifier.js:483-487` |
| Felter | `users.discord_dm_failure_count`, `users.discord_disconnected_at` | `schema-snapshot.json` |

Begrundelsen for warn frem for error står i koden: fejlklassen er forventet og ikke handlingsbar pr.
bruger, og selve afkoblingen er systemets korrekte respons, ikke en hændelse.

**Målt 30/8:** 4 brugere har `discord_disconnected_at` sat. Det forklarer også hvorfor
`discord_race_digest_log` har 35 unikke brugere mens kun 31 er koblet i dag: 31 + 4 = 35.

### 4.6 Løbsresultat-digest

| Regel | Værdi | Hvor |
|---|---|---|
| Kadence | **maks 1 DM pr. manager pr. dansk kalenderdag** | `discordRaceDigestSweep.js` header |
| Time-vindue | fra kl. **20** dansk tid | `discordRaceDigestSweep.js:37` (`DISCORD_DIGEST_HOUR_COPENHAGEN`) |
| Uafhængig af | e-mail-digesten kl. 19, hverken gater den anden | samme header |
| Dedupe-anker | `discord_race_digest_log`, UNIQUE (`user_id`, `digest_date`) | samme header |
| Resultattyper | kun `gc` og `stage` | `discordRaceDigestSweep.js:53-63` |
| Udelukkede hold | `is_ai`, `is_bank`, `is_frozen`, `is_test_account` | samme sted |
| Opt-out | filtreres på forhånd via `discord_id` + `discord_dm_enabled`, og igen nedstrøms | samme header |
| Overskrift | den narrative overskrift fra `raceNarrativeNotification.js`, aldrig "Race result is in" | samme header |

Dedupe-ankeret er bevidst persisteret i en tabel og ikke i hukommelsen: en in-memory-guard ville
nulstilles ved hver Railway-redeploy og kunne slippe en anden digest igennem samme dag.

**Målt 30/8:** 611 rækker i `discord_race_digest_log` fordelt på 35 brugere, seneste `digest_date`
er 2026-08-30, og 93 rækker de seneste 7 dage. Digesten kører.

### 4.7 Rate-guarden mod tavs DM-død

Guarden leverer ingenting. Den tæller og alarmerer (`discordDmRateGuard.js`).

| Konstant | Værdi | Hvor |
|---|---|---|
| `ALL_SKIPPED_STREAK_THRESHOLD` | 3 kørsler i træk med 100 % skip | `discordDmRateGuard.js:34` |
| `MIN_SAMPLE_SIZE` | 5 forsøgte DM'er før en 100 %-skip-kørsel må tælle | `discordDmRateGuard.js:48` |

Tre tællings-regler, hver med sin egen historik:

1. **En kørsel med 0 forsøgte DM'er er NEUTRAL.** Den hverken forlænger eller nulstiller streaken.
2. **En kørsel under `MIN_SAMPLE_SIZE` er NEUTRAL.** Kun 13 % af brugerne er koblet, så en kørsel
   med `attempted=1` der skipper "alle 1" er det statistisk forventede udfald.
3. **En kørsel med mindst én leveret DM nulstiller streaken uanset sample-størrelse.** Positiv
   evidens for at leveringen virker er gyldig ved n=1; kun det negative udsagn kræver sample.

Guarden er **kun** wiret til cron-drevne strømme. `recordDmAttempt` no-op'er medmindre kalderen
sætter `cronRun: true`, og kun `cron.js` gør det. I dag flushes den for `auction_won`
(`cron.js:142`) og `board_update`/`board_critical` (`cron.js:339, 373`).

Tælle-punktet er kritisk og har været forkert én gang: der tælles **efter det faktiske sendforsøg**,
ikke ved modtager-opslag, og en muted bruger tælles **slet ikke** (`discordNotifier.js:600-611`).

---

## 5. Discord-kanaler (webhooks)

| Regel | Værdi | Hvor |
|---|---|---|
| Konfiguration | tabellen `discord_settings` | `schema-snapshot.json` |
| Kolonner | `webhook_name`, `webhook_url`, `is_default`, `webhook_type`, `league_division_id`, `tier`, `is_summary` | samme |
| Resultat-routing | gruppekanal (`league_division_id`-match) **plus** tier-samlekanal (`tier`-match og `is_summary`) | `discordNotifier.js:145-178` |
| Dedupe | division 1 har kun én pulje, så gruppe og samle kan være samme URL; `computeResultWebhookUrls` dedupliker | samme |
| Fallback | default-webhooken hvis intet division-specifikt findes | samme |
| Puljelabel i embed | `league_divisions.label`, fx "Division 3 - A"; **null hvis puljen ikke findes, og så skal kalderen udelade puljeidentifikationen** | `discordNotifier.js:139-144` |
| Serialisering | pr. URL, så samtidige kaldere ikke sender en byge til samme kanal | `discordNotifier.js:200-204` |
| Spillervendt sprog | **engelsk**, serveren er EN-first | `discordNotifier.js:81` (`TYPE_LABELS`) |

**Feedback-kanalen:** `notifyPlayerFeedback` sender **kun** hvis `DISCORD_FEEDBACK_WEBHOOK_URL` er
sat, og har **bevidst ingen fallback** til default-kanalen, fordi indholdet er umodereret fritekst
fra spillere (`discordNotifier.js:855-865`).

**Forum-pings til ejeren:** `notifyForumActivity` sender til `DISCORD_FORUM_WEBHOOK_URL`, ellers til
ops-webhooken med @mention. **Ingen fallback til spillerkanalen** ud over hvad `getOpsWebhook` selv
gør, fordi forum-pings hører hjemme hos ejeren (`discordNotifier.js:881-893`). Tre kinds:
`post`, `reply`, `report`.

**Målt 30/8:** 20 rækker i `discord_settings`, heraf 15 med `league_division_id`, 3 med `is_summary`
og 1 med `is_default`.

### 5.1 Live-messaging-guarden er en hard rule

Efter hændelsen 18/8 2026 kræver **al** udgående Discord-kontakt at processen beviseligt kører mod
prod-databasen. Guarden sidder i `discordNotifier.js`s chokepoints (`sendWebhook`, `getBotToken`,
`sendDM`, webhook-outbox-drain) og **ikke** i leveringsbibliotekerne, så deres injektionsbaserede
tests forbliver guard-frie (`discordNotifier.js:30-60`).

Baggrund: en lokal staging-backend mod en Supabase-branch, hvis datasæt indeholdt `discord_settings`
med **rigtige** webhook-URL'er, afviklede snapshot-løb og postede 60 re-simulerede resultat-embeds
med forkerte vindere til de rigtige spillerkanaler over 75 minutter (20:32 til 21:41 dansk tid).
Se `.claude/learnings/2026-08-18-staging-backend-poster-til-prod-discord.md`.

**Konsekvens for enhver fremtidig opgave:** en databaseklon "med ægte data" arver integrationer.
Webhook-URL'er, token-pointere og feature-flag peger på virkeligheden. En klon er ikke isoleret bare
fordi dens skrivninger er.

---

## 6. In-app-notifikationer

| Regel | Værdi | Hvor |
|---|---|---|
| Kanonisk typeliste | **54 typer** | `notificationTypes.js`, talt med `node -e "import('./lib/notificationTypes.js')..."` |
| Paritetskrav | listen SKAL matche `notifications_type_check` i prod | `notificationTypes.js:1-5` |
| Paritets-vagt | `notificationTypes.test.js` fejler hvis en type kun findes ét af stederne | samme |
| Rate limit på læsning | 120 kald pr. 60 s (`presencePulseLimiter`) | `rateLimiters.js:94-100` |

Paritetsreglen findes fordi den samme fejl ramte tre gange: en type tilføjet i koden men ikke i
constrainten fejler tavst i prod. Se §10.

**Forum-svar-notifikationen** er den nyeste sociale type og har sine egne regler
(`notificationService.js:966-1030`):

| Regel | Værdi |
|---|---|
| Type | `forum_thread_reply` |
| Udløser | en **anden** bruger svarer på din tråd, aldrig dit eget svar |
| Håndhævelse | i `notifyForumThreadReply` selv, ikke kun på kaldestedet |
| Dedupe | pr. (bruger, tråd). Findes en **ulæst** notifikation, opdateres den ("N new replies") og `created_at` bumpes. En tråd med 20 svar giver ÉN notifikation |
| Isolering | en fejlet notifikation må aldrig vælte selve svaret |
| i18n | ÉN kode pr. felt med ICU-plural, ikke separate title/titlePlural-koder (#666) |

**Målt 30/8:** 49.754 notifikationer i alt, heraf 25 af typen `forum_thread_reply`.

**Bevidste fravalg** (`FORUM_RULES.md` §1, ejer 25/8): ingen notifikation ved *alle* nye opslag, og
ingen notifikation ved opbakning.

---

## 7. Achievements

### 7.1 Modellen

| Regel | Værdi | Hvor |
|---|---|---|
| Definitioner | tabellen `achievements` (`id`, `category`, `title`, `description`, `icon`, `is_secret`, `sort_order`) | `schema-snapshot.json` |
| Tildelinger | tabellen `manager_achievements` (`user_id`, `achievement_id`, `unlocked_at`) | samme |
| Synk | `POST /api/achievements/check`, kun push, aldrig fjern | `api.js:14296-14312` |
| Udløsere | login/layout-mount, auktionsside, rytterside, transferside | `Layout.jsx:701`, `AuctionsPage.jsx:1344`, `RiderStatsPage.jsx:1039, 1487`, `TransfersPage.jsx:1312` |
| Rate limit | `presencePulseLimiter`, 120/60 s | `rateLimiters.js:94-100` |
| Meta-achievement | `team_5_achievements` tæller også de achievements der låses op i **samme** synk | `achievementEngine.js:201` |

Achievements er **kosmetiske**. Login-streak-mekanikken som magtfaktor blev fjernet i #1139, og
achievement-synken kører videre uafhængigt af streaken (`Layout.jsx:699-700`).

### 7.2 Spoiler-reglen for hemmelige achievements

**Låste, hemmelige achievements må ikke lække deres tekst i API-payloaden.** Frontenden maskerer dem
visuelt med "???", men den rå tekst ville ligge i DevTools' Network-fane uden redaktion.

| Regel | Værdi | Hvor |
|---|---|---|
| Betingelse | `hideSecret = !unlocked && a.is_secret` | `api.js:14285` |
| Handling | `title` og `description` sættes til `null` | `api.js:14288-14289` |
| Ruter dækket | `GET /api/achievements` og `GET /api/managers/:teamId` | samme + `api.js:14318` |
| Forward-guard | `secretAchievementLeak.routes.test.js` scanner `api.js` som kildetekst | filen selv, #1666 |

### 7.3 Progress-visning

Kun tæller-baserede achievements har progress. Tiered grupper viser **kun den næste ikke-nåede
tier**, ellers ville 7 auktionssejre vise 7/10, 7/25 og 7/50 samtidig (`achievementEngine.js:56-59`,
#1008). Bool-achievements har ingen progress.

Grupper: auktionssejre (1/5/10/25/50), transfers (1/5/15/30), holdstørrelse (15/20/25/30),
login-streak (7/30), gennemførte sæsoner (2/5). Enkeltstående: `transfer_buyer_10`,
`transfer_seller_10`, `secret_watchlist_50`, `season_board_100`, `team_5_achievements`.

### 7.4 Målt tilstand 30/8

| Måling | Værdi |
|---|---|
| Definitioner | **46** |
| Heraf hemmelige | **9** |
| Tildelinger i alt | **2.083** |
| Brugere med mindst én | **218** af 256 |
| Definitioner **ingen** har opnået | **8** |

Fordelt på kategori (kategorinavnene i databasen er **danske**, se §9):

| Kategori | Definitioner | Hemmelige | Aldrig opnået | Tildelinger |
|---|---|---|---|---|
| `auktioner` | 10 | 1 | 2 | 562 |
| `hemmelig` | 5 | 5 | 2 | 23 |
| `hold` | 10 | 1 | 0 | 661 |
| `sæson` | 13 | 1 | 3 | 709 |
| `transfers` | 8 | 1 | 1 | 128 |

i18n: `frontend/public/locales/en/achievements.json` og `.../da/achievements.json` har **begge 46
nøgler**, altså fuld paritet med antallet af definitioner.

### 7.5 Tre achievements kan ikke opnås

`auction_5_streak`, `secret_heartbreak` og `secret_rival` findes som definitioner i databasen, er
synlige for spilleren, og har **ingen unlock-logik nogen steder i backenden**. Verificeret med
`grep -rn "<id>" backend/ --include=*.js | grep -v test` som gav **0 hits** for alle tre.

Det er nøjagtigt samme fejlklasse som #817 (`season_first_result`) og #2917 (13 sæson-achievements
uden motor). Den er nu opstået tredje gang. De øvrige fem uopnåede definitioner
(`auction_high_roller`, `season_5_seasons`, `season_div1_winner`, `season_3_top3`, `transfer_30`)
**har** logik og er blot ikke nået endnu i sæson 3, hvilket er en anden ting.

---

## 8. Opbakning, holdprofiler, tilstedeværelse og ranglister

### 8.1 Opbakning i forummet

| Regel | Værdi | Hvor |
|---|---|---|
| Model | **én tæller, ikke en emoji-palet** | ejer 25/8, `FORUM_RULES.md` §1 |
| Tabel | `forum_reactions` (`target_type`, `target_id`, `user_id`, `created_at`) | `schema-snapshot.json` |
| Mål | `post` eller `reply`, ellers 400 | `forum.js:784-786` |
| Adfærd | toggle: findes rækken, slettes den; ellers upsert | `forum.js:814-831` |
| Race-sikkerhed | `onConflict: "target_type,target_id,user_id"` med `ignoreDuplicates` | `forum.js:825-828` |
| Slettet indhold | 404 `forum_reaction_target_not_found`, egen errorCode | `forum.js:800-803` |
| Notifikation | **ingen**, bevidst v1-fravalg | `forum.js:781` |
| RLS | bruger ser og skriver kun egne rækker | `FORUM_RULES.md` §2 |

**Målt 30/8: 3 opbakninger fra 3 brugere, mod 15 opslag og 108 svar.** Funktionen er reelt ubrugt.
Om det er en synligheds- eller en værdi-årsag er ikke afgjort, og det hører under
[#4235](https://github.com/NicolaiDolmer/CyclingZone/issues/4235)s aflæsning 15/9.

Til sammenligning: 378 rækker i `forum_thread_reads` fordelt på 52 brugere. Folk **læser**
forummet, de trykker bare ikke opbakning.

### 8.2 Holdprofil og managerprofil

To offentlige flader, to ruter, to komponenter:

| Flade | Rute | Fil |
|---|---|---|
| Holdprofil | `teams/:id` | `frontend/src/pages/TeamProfilePage.jsx` |
| Managerprofil | `managers/:teamId` | `frontend/src/pages/ManagerProfilePage.jsx` |

Holdprofilen er skabelon **T3** (hero plus tabs) per `docs/design/PAGE_TEMPLATES.md`. Fanerne bor i
`frontend/src/lib/teamProfileTabs.js` (`TEAM_PROFILE_TABS`, `resolveTeamProfileTab`), udskilt i
#3916 så listen og default-reglen kan testes uden at rendere komponenten. Fanerne er trup, resultater,
palmarès, transfers og klub. Klub-fanen er read-only Staff og Facilities for **ethvert** hold, eget
eller andres (#2601).

Managerprofilen viser achievements som badges. Låste hemmelige badges rendres med hængelås og
titlen "???" (`ManagerProfilePage.jsx:59-66`), altså anden forsvarslinje oven på API-redaktionen i
§7.2.

### 8.3 Tilstedeværelse

| Regel | Værdi | Hvor |
|---|---|---|
| Skrive-throttle | RPC `touch_user_presence` skriver **kun** hvis `last_seen` er over 60 s gammel | `api.js:13850-13859` |
| Online-tærskel | **5 minutter** | `api.js:14398-14399`, `TeamProfilePage.jsx:175` |
| Online-tæller | `GET /api/online-count`, samme 5-min-vindue | `api.js:13882-13887` |
| Rate limit | `presencePulseLimiter` | `api.js:13856` |
| Visning | prik plus "sidst set" i relativ tid | `frontend/src/components/OnlineBadge.jsx` |

60 s throttle er funktionelt usynlig, fordi alle tre visninger bruger 5-minutters granularitet.
Throttlen blev indført efter en disk-IO-write-amplification på 281.000 UPDATEs
(`database/2026-06-29-db-io-temp-spills-presence.sql`).

**Bemærk drift:** online-beregningen findes to steder med samme konstant, i backenden
(`api.js:14399`) og i frontenden (`TeamProfilePage.jsx:175`). De er ens i dag; der er ingen delt
konstant der holder dem ens.

**Login-streak** (`users.login_streak`) opdateres via `POST /api/login-streak` og bruges kun til de
to `secret_streak_*`-achievements. Den giver **ingen** in-game fordel (#1139).

**Målt 30/8:** 93 af 256 brugere har `last_seen` inden for 7 dage.

### 8.4 Global rangliste

Designet er **ejer-godkendt 17/7 2026** ([#2453](https://github.com/NicolaiDolmer/CyclingZone/issues/2453))
og står ordret i `globalRankFormula.js:7-16`.

| Regel | Værdi | Hvor |
|---|---|---|
| Pointkilde | løbsresultater, vægtet efter prestige/tier, allerede bagt ind i `season_standings.total_points`. **Ingen ny parallel pointkilde** | `globalRankFormula.js:8-10` |
| Decay | **alle bankede point halveres ved hvert sæsonskifte**, multiplikativt, ikke rullende vindue og ikke hard expiry | `globalRankFormula.js:11-13` |
| Selvbegrænsning | konstante P point pr. sæson konvergerer mod 2P | `globalRankFormula.js:13-14` |
| Rollover-formel | `round((banked + season) * 0.5 * 100) / 100` | `globalRankFormula.js:20-24` |
| Live-point | `banked + indeværende sæsons point` | `globalRankFormula.js:28-30` |
| Skjul-regel | ingen aktivitet i de sidste **2** sæsoner skjuler manageren fra listen. **Pointene røres aldrig**, kun visningen | `globalRankFormula.js:32-38` |
| Ties | `RANK()`-semantik: ties deler rang, næste rang springer | `globalRankFormula.js:43-57` |
| Sandheden | beregnes i Postgres i `global_rank_mv`; JS-filen er en testbar spejling | `globalRankFormula.js:1-5` |

**Bindende arbejdsregel fra samme fil:** ændrer du en formel her, skal du ændre den matchende SQL i
`database/2026-07-17-global-rank.sql` **i samme PR**.

**Målt 30/8:** 231 rækker i `global_rank_mv`, alle 231 med en rang. 221 rækker i
`team_global_rank_points`, 194 i `global_rank_weekly_snapshot`, 216 i
`global_rank_season_start_snapshot`.

"Sæsonens klatrere" beregnes som `startRank - globalRank` mod sæsonstart-snapshottet, og hold uden
rang udelades fordi bevægelse ikke kan måles uden en aktuel rang (`globalRankFormula.js:62-70`).

---

## 9. IKKE FASTLAGT - kræver ejer-beslutning

Hver post er én ting der mangler at blive afgjort. Ingen af dem er gættet på plads nogen steder i
denne fil.

| # | Spørgsmålet | De målte tal |
|---|---|---|
| 1 | **Skal `auction_5_streak`, `secret_heartbreak` og `secret_rival` bygges færdige eller slettes?** De er synlige for spilleren og har 0 unlock-logik i backenden | 3 definitioner, 0 hits i `grep -rn "<id>" backend/ --include=*.js` uden testfiler |
| 2 | **Skal `discord_id` have en unique index?** I dag kan to konti i princippet angive samme id | 0 unique index på feltet, 0 dubletter blandt 31 koblede i dag |
| 3 | **Skal Discord-koblingen verificeres (OAuth eller bot-handshake) i stedet for at spilleren selv indtaster et id?** I dag er der kun format-check i frontenden | `/^\d{17,19}$/`, `ProfilePage.jsx:127` |
| 4 | **Skal `DIVISION_ROLE_MAP` udledes fra `league_divisions` i stedet for at være hårdkodet til 15?** | 15 divisioner, 15 rolle-id'er, 0 hold uden for mappet i dag |
| 5 | **Skal opbakning have en synligheds-mekanik, eller skal den accepteres som lav-brugs?** | 3 opbakninger mod 108 svar og 52 læsende brugere |
| 6 | **Skal en oplåst achievement give en notifikation?** I dag opdager spilleren det kun ved at åbne profilen | ordet `achievement` optræder 0 gange i `notificationService.js` |
| 7 | **Skal achievement-kategorierne oversættes til engelsk i databasen?** De er danske (`auktioner`, `hemmelig`, `hold`, `sæson`, `transfers`) i et EN-first spil | 5 kategorier, alle danske; per-achievement-i18n findes derimod, 46/46 nøgler i begge sprog |
| 8 | **Skal Discord-nudgens dismiss persisteres server-side?** I dag kun `localStorage`, altså pr. browser | `DashboardPage.jsx:758-762`, mod onboarding-kortet der blev flyttet server-side i #2439 |
| 9 | **Skal `race_result_digest` have sin egen præference-nøgle?** I dag kan den kun slås fra ved at slukke for alle DM'er | `DM_TYPE_TO_PREF_KEY` mapper ikke typen, `discordDmPrefs.js:23-32` |
| 10 | **Skal 5-minutters online-tærsklen ligge i en delt konstant?** Den står som magisk tal to steder | `api.js:14399` og `TeamProfilePage.jsx:175` |
| 11 | **Forummets rolle over for Discord.** Åben ejer-beslutning med aflæsningsdato | [#4235](https://github.com/NicolaiDolmer/CyclingZone/issues/4235), aflæses **15/9 2026** |
| 12 | **"For sjov"-achievement-kategori og referral-rangliste.** Ønsket, ikke besluttet; afhænger af #3044 | [#3051](https://github.com/NicolaiDolmer/CyclingZone/issues/3051) |
| 13 | **Fast ugentlig kommunikations-rytme.** Rytmen er defineret (mandag uge-note, onsdag ét spørgsmål, søndag ugens øjeblik), men issuet er åbent og løbende | [#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428), `needs-user-action` |

### Underområder denne fil IKKE dækker

- **Forummets indhold, kategorier, moderation, rapportering og afstemninger.** De bor i
  [`FORUM_RULES.md`](FORUM_RULES.md) og er ikke gentaget her.
- **E-mail-kanalen.** `emailRaceDigestSweep.js` og `email_log` er nævnt kun hvor de afgrænser
  Discord-digesten. En e-mail-SSOT findes ikke.
- **`player_feedback` og admin-feedback-indbakken** (12 rækker 30/8). Kortlagt som flade, men
  reglerne for triage og svar er ikke gennemgået i denne omgang.
- **Hall of Fame og rytter-ranglister** (`HallOfFamePage.jsx`, `rider_rankings_mv`). Nævnt som
  eksisterende flader; kun den globale managerrangliste er dokumenteret i regeldetaljer.
- **`founder_supporter_waitlist` og supporter-badges.** Kortlagt som tabel, ikke gennemgået.

---

## 10. De fejl området historisk har lavet

Alle fra `.claude/learnings/`. De er samlet her fordi de deler én rod: **udgående sociale beskeder
fejler tavst, og tavshed ligner succes.**

| Dato | Hvad gik galt | Læringen |
|---|---|---|
| 3/6 2026 | **Discord-DM'er døde i ugevis.** Tre lag ramte samtidig: token roteret, backenden læste kun `DISCORD_BOT_TOKEN` mens det gyldige token lå under `DISCORD_TOKEN`, og fejl blev kun logget som `console.error`. Ejeren opdagede det tilfældigt | Accepter begge env-navne. Verificér tokens uden at lække værdien (`railway run -- node scripts/check-discord-bot-token.mjs` printer kun HTTP-status og bot-navn) |
| 17/7 2026 | **Bestyrelses-DM'er døde i 2 uger med 0 fejl og 0 alarmer.** `notifyBoardUpdateDM` destrukturerede kun `teamId`; `cron.js` kaldte med `userId`. JS kaster ikke ved ukendte nøgler, så parameteren forsvandt tavst. In-app-notifikationen virkede, så symptomet var usynligt i UI'et | Fejlen var **designet som ikke-en-fejl**: `[discord-dm:no-recipient]` er `console.info` fordi det er normalt for ÉN bruger. Den antagelse er forkert for ALLE brugere. Det er hele grunden til at rate-guarden i §4.7 findes |
| 18/7 2026 | **Rate-guarden talte "leveret" før den vidste det.** Muted brugere blev talt som leverede DM'er og udvandede skip-raten væk fra 100 % | Tæl efter det faktiske udfald, ikke ved modtager-opslag. Muted er et spiller-valg, ikke et leveringsforsøg |
| 18/7 2026 | **Board-DM spejlede uden for in-app 24-timers-dedup** og re-forsøgte hvert 30. minut i 8+ timer for samme bruger. Gav både spam og en falsk alarm fra guarden | Et DM-spejl skal ligge **inden for** den gate der bestemmer om in-app-notifikationen faktisk blev leveret |
| 26/7 2026 | **`notifications_type_check` ude af sync med koden, tredje gentagelse** | Derfor findes paritets-testen i `notificationTypes.test.js` (§6) |
| 27/5 2026 | **Achievement-synken fejlede på parallelle bestyrelsesplaner.** `maybeSingle()` mod `board_profiles` brød da modellen gik fra én til tre rækker pr. hold | Achievement-motoren læser fremmede domæners data. Ændrer det domæne kontrakt, følger motoren ikke automatisk med |
| 18/8 2026 | **Staging-backend postede 60 falske resultater til prod-Discord** over 75 minutter | Datakloner arver integrationer. Live-guarden i §5.1 er svaret |
| 21/8 2026 | **Community-copy påstod at shippede features manglede.** 6 af 15 punkter i en afstemning var allerede bygget; ét genåbnede en lukket ejer-beslutning | Backloggen beskriver hvad der er **ønsket**, ikke hvad der er **leveret**. Verificér mod koden før du skriver til spillerne |
| 25/8 2026 | **Forum-abonnementet brækkede ved hver mount** fordi `configure`-callbacken glemte `return channel`. Hele verifikationskæden sagde grønt | Realtime-kontrakten i `realtimeChannelCore.js:45` er ikke håndhævet af noget andet end at læse den |
| 28/8 2026 | **Spillervendt tekst merget uden ejerens eksplicitte ja** til den konkrete ordlyd | En bestilt rettelse dækker **problemet**, ikke løsningen. For spillervendt tekst er løsningen selve ordlyden |

---

## Kildedokumenter

- [`FORUM_RULES.md`](FORUM_RULES.md) - forummets indhold, datamodel, moderation og den åbne
  Discord-rolle-beslutning. Denne fil overlapper kun på opbakning (§8.1) og forum-notifikationen (§6).
- [`DASHBOARD_RULES.md`](DASHBOARD_RULES.md) - modul-rækkefølge, ét-nudge-reglen og forum-kortets
  plads på dashboardet.
- `docs/design/PAGE_TEMPLATES.md` - T3-skabelonen som hold- og managerprofil bruger.
- [#4235](https://github.com/NicolaiDolmer/CyclingZone/issues/4235) - måleplan og tærskler for
  forummets rolle, aflæses 15/9 2026.
- [#428](https://github.com/NicolaiDolmer/CyclingZone/issues/428) - fast ugentlig
  kommunikations-rytme, løbende ejer-opgave.
- [#3051](https://github.com/NicolaiDolmer/CyclingZone/issues/3051) - "for sjov"-achievements og
  rekrutteringsrangliste, ønsket 25/7, ikke besluttet.
- [#2453](https://github.com/NicolaiDolmer/CyclingZone/issues/2453) - global rank, designet
  ejer-godkendt 17/7.
- `.claude/learnings/` - de 10 postmortems i §10.
