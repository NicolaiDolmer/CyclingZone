# Design: push-notifikationer og Google Play (TWA) · #6584

> **Status: UDKAST til ejer-kort.** Spor 1 (PWA-fundamentet) er bygget i PR #6585. Dette dokument er design for spor 2 (push) og spor 3 (TWA). Intet heri bygges før ejer-go (issue #6584, "ejer-kort FØR det bygges").
> **Grænser fra issuet:** ingen nye løbende udgifter · ingen spillervendte tal/tekster uden ejer-go · copy efter `docs/TONE_OF_VOICE.md`, EN først · ét spil, én kode.
> Punkter markeret **[verificér]** er platform-regler jeg har fra dokumentation, ikke målt i dag. De tjekkes mod den officielle kilde i det spor der bygger dem.

---

## 0. Hvad spor 1 allerede giver (fundamentet dette bygger på)

| Del | Fil | Betydning for spor 2/3 |
|---|---|---|
| Manifest (navn, ikoner inkl. maskable/monochrome, genveje) | `frontend/public/manifest.webmanifest` | TWA genereres direkte fra det. |
| Service worker der aldrig serverer app-kode | `frontend/public/sw.js` | Push-handleren lægges her. Kontrakten (ingen app-cache) gælder fortsat. |
| Badge = menuens ulæst-tal | `frontend/src/pwa/appBadge.ts` + `Layout.jsx` | Push opdaterer samme badge når appen er lukket. |
| Install-tilbud på tredje besøgsdag | `frontend/src/pwa/installTiming.ts` | Push-opt-in bruger samme "rigtige tidspunkt"-princip. |

**Opdateringsstrategien i én sætning:** workeren cacher kun en offline-side, så en gammel app kan ikke overleve et deploy; "ny version klar" ejes fortsat af `releaseWatch.js` + `ReleaseUpdateBanner` (#5159). Push ændrer ikke på det.

---

## 1. Push: princippet

Push skal føles som **et opkald fra sportsdirektøren, ikke spam**. Det betyder:

1. **Kun det der kræver spilleren nu, eller som han ville ringe hjem om.** Ikke "lønnen er udbetalt".
2. **Spilleren vælger kategorier.** Intet er slået til før han selv har sagt ja.
3. **Loft og stille timer er indbygget, ikke en indstilling man skal finde.**
4. **Hellere ét samlet digest end ti enkeltbeskeder.**
5. **Notifikations-rækken er sandheden.** Push er en ny *kanal* for de notifikationer der allerede skrives (`notifications`-tabellen, `notifyUser` i `backend/lib/notificationService.js`), præcis som e-mail (`users.email_prefs`) og Discord-DM (`users.discord_dm_prefs`) allerede er. Ingen ny begivenheds-model.

---

## 2. Push: begivenheder og kategorier

Kategorierne grupperer eksisterende `NOTIFICATION_TYPES` (backend/lib/notificationTypes.js). Spilleren ser 5 kategorier, ikke 60 typer.

| Kategori (forslag) | Typer der udløser push | Hvorfor den fortjener at ringe | Standard efter opt-in |
|---|---|---|---|
| **Auktioner, sidste minut** | `auction_outbid`, `auction_proxy_outbid` KUN når auktionen slutter inden for et kort vindue; `auction_won` | Overbudt lige før lukning er den ene situation hvor minutter betyder noget. | Til |
| **Løb** | `stage_result` (din bedste rytters placering), `race_result` | Etapen er kørt: resultatet er grunden til at åbne appen. | Til, som digest pr. løbsdag |
| **Transfers** | `transfer_offer_received`, `transfer_counter` | Et tilbud venter på en beslutning. | Til |
| **Hold og frister** | `selection_warning`, `squad_below_minimum`, `deadline_day_warning`, `contract_expiring` | Frister der koster noget hvis de misses. | Til |
| **Akademi og træning** | `academy_intake_ready`, `academy_graduation_ready`, `scout_report_ready` | Noget er klar; aldrig akut. | Fra (kun digest) |

Alt andet (forum, DM, økonomi-poster, bestyrelse) forbliver i indbakken og evt. e-mail. **Ejer-beslutning:** listen og standarderne. Vinduet for "sidste minut" er en produkt-konstant der sættes i spor 2 med ejer-go.

### Tekst i beskeden
Titel og brødtekst genbruger notifikationens eksisterende i18n-nøgler (`metadata.titleCode/messageCode`, se `notificationService.js`) på spillerens `users.language`. Ingen ny copy pr. type; de nye tekster er kun kategori-navnene, opt-in-skærmen og digest-overskriften (EN+DA, ejer-go).

---

## 3. Push: opt-in, loft, stille timer, digest

### 3.1 Opt-in (hvornår vi spørger)
- **Aldrig browserens tilladelses-dialog ved indlæsning.** Browsere straffer det (Chrome viser "stille" prompts efter mange afvisninger) og det er spam-adfærd.
- Spørgsmålet stilles i **kontekst**, første gang det giver mening: lige efter spilleren har budt på en auktion der slutter i dag ("Vil du have besked hvis du bliver overbudt?"), eller fra en ny "Notifikationer"-sektion på profilsiden. Først når spilleren trykker ja i vores egen UI, kalder vi `Notification.requestPermission()`.
- iOS: web push virker kun i den **installerede** app (iOS 16.4+) **[verificér]**. Derfor vises opt-in på iOS først når `isStandalone()` er sand; ellers viser vi install-vejledningen fra spor 1.

### 3.2 Dagligt loft
- Hårdt loft pr. spiller pr. døgn (forslag: få, fx 6; ejeren sætter tallet). Når loftet er nået, samles resten i næste digest i stedet for at forsvinde.
- Loftet tæller *afsendte push*, ikke notifikationer.

### 3.3 Stille timer
- Standard 22:00-08:00 i **spillerens tidszone**. Den findes ikke i dag i `users`; forslag: ny kolonne `users.timezone` (IANA, default `Europe/Copenhagen`), sat fra browserens `Intl.DateTimeFormat().resolvedOptions().timeZone` ved login. Spilleren kan ændre vinduet.
- Undtagelse: ingen. Heller ikke "sidste minut": en auktion der lukker kl. 03 er ikke en grund til at vække nogen. Det der falder i stille timer, kommer i morgen-digestet.

### 3.4 Digest
- En kategori i digest-tilstand (og alt der rammer loftet eller stille timer) samles og sendes som **én** besked: "3 etaper kørt · 1 transfertilbud" med link til indbakken.
- Afsendelse: ved slutningen af stille timer, og for løbs-kategorien én gang efter dagens sidste etape.
- Samme `tag` (Notification API) pr. kategori, så en ny besked erstatter den gamle i stedet for at stable sig.

---

## 4. Push: datamodel og migration

Følger mønsteret fra de to eksisterende kanaler (jsonb-præferencer på `users`).

```sql
-- database/2026-xx-xx-6584-push-channel.sql  (idempotent, apply post-merge per #2642)

-- 1) Præferencer: samme form som email_prefs / discord_dm_prefs.
alter table public.users
  add column if not exists push_prefs jsonb not null default '{}'::jsonb,
  add column if not exists timezone text;          -- IANA, null = Europe/Copenhagen
-- push_prefs = { "categories": { "auctions": true, "races": "digest", ... },
--                "quiet": { "start": "22:00", "end": "08:00" }, "daily_cap": <n> }

-- 2) Abonnementer: ét pr. browser/enhed.
create table if not exists public.push_subscriptions (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  endpoint         text not null unique,
  p256dh           text not null,
  auth             text not null,
  user_agent       text,
  created_at       timestamptz not null default now(),
  last_success_at  timestamptz,
  failure_count    int not null default 0
);
create index if not exists push_subscriptions_user_idx on public.push_subscriptions(user_id);
alter table public.push_subscriptions enable row level security;
-- Spilleren må se og slette sine egne; indsættelse sker via backend (service role),
-- så endpoint/nøgler valideres ét sted.
create policy push_subscriptions_select_own on public.push_subscriptions
  for select using (auth.uid() = user_id);
create policy push_subscriptions_delete_own on public.push_subscriptions
  for delete using (auth.uid() = user_id);

-- 3) Udsendelses-log: loft, digest og dedupe. Kun backend skriver/læser.
create table if not exists public.push_deliveries (
  id               bigserial primary key,
  user_id          uuid not null references public.users(id) on delete cascade,
  category         text not null,
  notification_ids uuid[] not null,            -- én (enkelt) eller flere (digest); notifications.id er uuid
  sent_at          timestamptz not null default now(),
  status           text not null                -- sent | gone | failed
);
create index if not exists push_deliveries_user_day_idx on public.push_deliveries(user_id, sent_at desc);
alter table public.push_deliveries enable row level security;  -- ingen policies = kun service role
```

Notes:
- `notifications.id` er uuid (database/schema.sql), så sweepens cursor er `created_at` (+ id som tie-breaker), ikke et løbenummer.
- Oprydning: `push_deliveries` ældre end 30 dage slettes af den eksisterende cron (lille tabel).
- GDPR: endpoint er personhenførbar. Abonnementet slettes ved log ud på enheden, ved konto-sletning (cascade) og når push-tjenesten svarer 404/410.

---

## 5. Push: udsendelse (backend, Railway)

```
notifyUser() ──insert──▶ notifications            (uændret, ~50 kaldsteder røres ikke)
                              │
cron hvert minut ─────────────┘  læser nye rækker siden cursor (samme mønster som raceNotifyOutbox.js)
   │  type → kategori → push_prefs? → stille timer? → loft? → digest?
   ▼
web-push (npm, VAPID) ──▶ browserens push-tjeneste (FCM / Mozilla / Apple)
   │  201 → last_success_at        404/410 → slet abonnement        andet → failure_count++
   ▼
push_deliveries
```

- **Ingen ændring i de ~50 kaldsteder:** en sweep over `notifications` med en cursor (som race-outboxen) i stedet for at hægte push på hver `notifyUser`-kald. Det gør push til en ren tilføjelse der kan slukkes med ét flag (`push_enabled`, feature-registry, stadie `beta` først).
- **Klienten** (`frontend/src/pwa/`): `PushManager.subscribe({ userVisibleOnly: true, applicationServerKey })` efter opt-in; abonnementet POSTes til et nyt backend-endpoint `POST /api/push/subscriptions` (auth påkrævet), `DELETE` ved fravalg/log ud.
- **Service worker** (`public/sw.js`): `push`-handler viser `showNotification(title, { body, tag: category, data: { url } , icon: "/icons/icon-192.png", badge: "/icons/monochrome-512.png" })` og opdaterer ikon-badget (`navigator.setAppBadge(unread)` hvis payloaden har tallet). `notificationclick` fokuserer en åben fane eller åbner `data.url`. Workerens kontrakt (ingen app-cache) står uændret.

### VAPID-nøgler i Infisical
| Navn | Hvor | Bemærkning |
|---|---|---|
| `VAPID_PUBLIC_KEY` | backend + frontend (`VITE_VAPID_PUBLIC_KEY` ved build) | offentlig, må gerne stå i bundlen |
| `VAPID_PRIVATE_KEY` | kun backend (Railway) | hemmelig; aldrig i frontend, aldrig i logs |
| `VAPID_SUBJECT` | backend | `mailto:` til projektets kontaktadresse |

Nøgleparret genereres én gang (`npx web-push generate-vapid-keys`) og lægges direkte i Infisical; det skrives aldrig til en fil i repoet. Rotation = nye nøgler + alle abonnementer genoprettes ved næste besøg (klienten sammenligner `applicationServerKey`).

### 0 kr. løbende
- Web Push går via browsernes egne push-tjenester; de koster ikke noget at bruge **[verificér]**.
- `web-push` er et npm-bibliotek, ingen SaaS (ingen OneSignal/Firebase-konto nødvendig).
- Sweepen kører i den eksisterende Railway-proces; tre små tabeller i den eksisterende Postgres.

---

## 6. Google Play via TWA

### 6.1 Hvad en TWA er
En Trusted Web Activity er en tynd Android-app der åbner cyclingzone.org i Chrome **uden URL-linje**. Det er det samme spil og den samme kode; Play-appen er en genvej med butiksside. Ingen native kode at vedligeholde.

### 6.2 Opsætning
1. **Projekt:** genereres med Bubblewrap (Googles CLI) direkte fra `manifest.webmanifest`. Pakkenavn (forslag): `org.cyclingzone.app` (kan ikke ændres efter første upload).
2. **Digital Asset Links:** fuld skærm uden URL-linje kræver at domænet beviser at det ejer appen:
   `https://cyclingzone.org/.well-known/assetlinks.json` med appens pakkenavn og SHA-256-fingeraftrykket af **Play App Signing-certifikatet** (ikke upload-nøglen). Filen lægges i `frontend/public/.well-known/` og skal serveres som `application/json` uden rewrite; `vercel.json`'s app-rewrite rammer ikke `/.well-known/`, men det verificeres på preview før upload. Fejler verifikationen, viser appen en URL-linje (Custom Tab) i stedet for at gå i stykker.
3. **Signering:** Play App Signing (Google opbevarer app-nøglen). Vi har kun en upload-nøgle; keystore + kodeord gemmes i Infisical (base64), aldrig i repoet. Mistet upload-nøgle kan nulstilles via Play Console; mistet app-nøgle kan ikke, derfor Google-opbevaring.
4. **Butiksside:** rigtige skærmbilleder fra spillet (ingen mockups, TASTE P11), feature-grafik fra brand-masteren, privatlivspolitik-URL (findes: `/privacy-policy`), data-sikkerhedsformular, aldersvurdering (IARC-spørgeskema).
5. **Konto:** Google Play-udviklerkonto, 25 USD én gang (ejeren opretter, issuet). Nye personlige konti skal køre en lukket test med et mindstetal testere i en periode før produktion **[verificér: antal og dage ved oprettelse]**. Beta-testerne fra Discord er oplagte.
6. **Opdateringer:** spillet opdateres som i dag (Vercel-deploy). Play-appen skal kun genudgives ved ændret manifest/ikon/pakke-konfiguration eller nye krav til target-API-niveau (årligt) **[verificér]**.

### 6.3 Pro-betaling og Play-politikken (skal afklares FØR køb er muligt i appen)
Google Plays betalingspolitik: apps i Play der sælger digitale goder eller funktioner skal som udgangspunkt bruge **Google Play Billing**, og må ikke lede spilleren til at købe udenfor appen **[verificér gældende politik + EØS-undtagelser]**. Pro er en digital funktion, så det rammer os.

| Mulighed | Hvad | For | Imod |
|---|---|---|---|
| **A · Intet køb i Play-appen** (anbefalet ved lancering) | TWA'en genkendes (startparameter i manifestets `start_url` for TWA-buildet eller `document.referrer` = `android-app://<pakke>`), og Pro-købsknapper skjules helt. Ingen "køb på hjemmesiden"-henvisning. | 0 kr., ingen ny integration, ingen politik-risiko. Spil er gratis og fair uanset. | Pro kan ikke købes i Play-appen. |
| B · Play Billing via Digital Goods API | Pro sælges gennem Google i TWA'en. | Køb i appen. | Googles servicegebyr; ny integration og abonnements-afstemning mod Stripe-modellen. |
| C · EØS alternativ fakturering | Under DMA kan EØS-brugere tilbydes egen betaling med reduceret gebyr. | Bevarer egen checkout i EØS. | Ansøgning, gebyr stadig, kun EØS, mere kompleksitet. |

**Anbefaling:** A ved lancering. Revurdér B når Pro-indtægt i Play-appen er en reel størrelse. Det kræver en lille TWA-detektion i frontend (spor 3), og den skal være på plads før første upload.

---

## 7. Rækkefølge og ejer-beslutninger

1. **Ejer-kort 1 (push):** kategorilisten og standarderne (§2), loftets størrelse, stille-timers standard, opt-in-stedet (§3.1). Derefter: migration (§4) → backend-sweep bag flag → opt-in UI → beta-stadie → on.
2. **Ejer-kort 2 (TWA):** pakkenavn, betalingsmulighed A/B/C (§6.3), Play-konto oprettet af ejeren. Derefter: assetlinks + TWA-detektion → Bubblewrap-build → lukket test → produktion.

Begge spor er uafhængige af hinanden og kan bygges parallelt efter go.
