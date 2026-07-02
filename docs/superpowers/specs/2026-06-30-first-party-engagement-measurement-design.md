# First-party engagement-måling — troværdig bounce/engagement uden vendor-støj

> Spec, 2026-06-30. Måle-fundament (PR 1 af et sekvens-program). **Approach A** (ejer ejer metrikken),
> bygget tyndt (ingen nye vendors), rå anonyme events (schema-on-read), storage-less dedup.
> Relateret: meta-issue [#1369](https://github.com/NicolaiDolmer/CyclingZone/issues/1369) (CRO-loop, Fase 1),
> samt bounce-issues #2039 (translate-crash), #2040 (bounce-måleartefakt), #2041 (returning users),
> #2042 (login-væg). Denne spec lukker kernen i #2040 og leverer fundamentet #2041/#1369 forudsætter.

## Problem (bevist med egne data, ikke hypotese)

Bounce-raten i Vercel/Clarity er ~95–100% i ugevis. Det er **ikke** brugere der flygter — det er **session-fragmentering**:

| Kilde | Tal (7 dage) |
|---|---|
| Clarity sessions | 20.090, bounce 94%, returning ~5, pages/session 1,08 |
| `player_events.session_started` | **25.280 fra 50 brugere** (~72/bruger/dag) |
| Reelle engagement-events | race_viewed 1.652 (37 brugere), auction_view 1.338 (37), training_focus_set 1.284 (29), auction_bid_placed 201 (22), team_drafted 73 (46), signup 34 (31) |

Den engagerede spillerbase er **~50 mennesker**. `session_started` fyrer i [`App.jsx`](../../../frontend/src/App.jsx) ved hver `getSession()` (hver reload/tab-restore) **og** ved hver `SIGNED_IN` (auth-events). Hver reload/hard-navigation/auth-re-init bliver en ny single-page "session" → bounce per definition. Selv-referreren `cyclingzone.org→cyclingzone.org` (7.671 i Clarity) er samme fingeraftryk.

To strukturelle huller oven i fragmenteringen:

1. **Vendor-afhængighed.** Clarity, Vercel Web Analytics og GA4 er alle **consent-gated** ([`consent.jsx`](../../../frontend/src/lib/consent.jsx), default `analytics:false`) med hver sin bounce-definition og bot-filtrering → tre uenige tal, alle på en biased delmængde.
2. **Cold-populationen er umålt.** `logEvent`/`player_events` kræver **både login og consent** ([`logEvent.js`](../../../frontend/src/lib/logEvent.js)), så al logget-ud landing/bounce-trafik — netop dér bots og engangs-bouncere er — registreres ingen steder førsteparts.

## Mål

Et **førsteparts, bot-ekskluderet, consent-uafhængigt** *landed → engaged → signup*-signal vi ejer, så vi har ÉT troværdigt tal i stedet for tre uenige vendor-tal.

### Metric-filosofi (world-class reframe)
Et indlogget produkt optimerer **activation/retention**, ikke bounce. Derfor:
- **In-app (logget-ind):** drop "bounce" som begreb — mål engagement/activation på `player_events` (fundamentet findes allerede). En in-app "single-page session" er en måle-artefakt, ikke en bruger der flygter.
- **Public/cold (logget-ud):** dér er bounce et legitimt, simpelt tal — og dér lukker den anonyme beacon hullet (landed → engaged → signup-start).

Den eneste bounce vi rapporterer fremover er **public-side-bounce**, bot-ekskluderet.

### Non-goals (YAGNI / senere PR'er)
- Fjerne Clarity/GA/Vercel-SDK'erne (Clarity leverer stadig heatmaps/replays — beholdes).
- De faktiske bounce-reduktioner: translate-crash #2039 og login-væg/preview #2042 (PR 2 og 3).
- Kohorte-retention D1/D7/D30 (#1369 Fase 2).
- A/B-testing-infrastruktur. Ekstern vendor (PostHog/Plausible) — fravalgt (byg tyndt, undgå værktøjs-spredning, jf. #1369).

## Arkitektur

Følger det eksisterende attribution-mønster (ren builder + ren aggregator + tynd route + service-role-only tabel):

```
Logget-ud (public sider)                 Logget-ind (app)
  landing/login                            App.jsx
     │ anonym beacon (intet enheds-id)        │ session_started (consent+auth)
     ▼                                        ▼
  POST /api/collect ──► botDetection ──►   dedup pr. ægte session-id (sessionStorage, 30-min)
     │  (UA-filter, storage-less              │
     │   visit_hash-dedup)                    ▼
     ▼                                     player_events (uændret skema, ægte sessions)
  traffic_events (rå, anonym, schema-on-read, service-role)
     └──────────────────────┬───────────────┘
                            ▼
            GET /api/admin/metrics  (requireAdmin, SQL-aggregering)
                            ▼
        Admin-scorecard: landed → engaged → signup, bot-andel, public-bounce
```

### Komponenter

**1. `frontend/src/lib/sessionId.js` (ny, ren + unit-testbar)**
`getSessionId(storage = sessionStorage)`: flygtigt session-id med **30-min sliding expiry** (`sessionStorage`, ikke cross-session, ikke koblet til bruger). Mønster som [`anonymousId.js`](../../../frontend/src/lib/anonymousId.js) + timeout. Bruges KUN til at deduplikere `session_started` i den logget-ind, consent-gated kontekst.

**2. Fix `session_started`-fragmentering ([`App.jsx`](../../../frontend/src/App.jsx) + [`logEvent.js`](../../../frontend/src/lib/logEvent.js))**
- Ny `logSessionStart()` der kun fyrer `session_started` **én gang pr. session-id**.
- Fjern dobbelt-fyringen (getSession + SIGNED_IN); fyr aldrig på `TOKEN_REFRESHED`.
- Effekt: `player_events.session_started` går fra ~25.280 til et realistisk antal ægte sessions. Funnel/canary-detektorer (`audit-feature-liveness`) får igen et meningsfuldt session-tal.

**3. Anonym beacon (frontend, kun public sider) — `frontend/src/lib/trafficBeacon.js` (ny)**
På public-ruter (landing/login) sender via `navigator.sendBeacon`/`fetch(keepalive)` til `/api/collect`:
- `pageview` ved load + route-skift (med `path`).
- `engaged` når engagement-tærsklen krydses (se nedenfor).

Payload er **kun** `{ event, path, deviceType }` — **intet enheds-id, ingen cookie, ingen storage på enheden**. Kører uafhængigt af analytics-consent (storage-less, se Privacy). Da klienten ingen hukommelse har, dedup'er serveren via `visit_hash`.

**4. `POST /api/collect` (backend, [`api.js`](../../../backend/routes/api.js), offentligt + rate-limited)**
- Ny `collectLimiter` (genbrug `express-rate-limit` + [`rateLimiters.js`](../../../backend/lib/rateLimiters.js)). Stram grænse — offentligt endpoint.
- `botDetection.js` (ny, ren): UA-baseret klassifikation (kendt bot/crawler/headless-regex + tom-UA). Bots **tælles men flagges** (`is_bot=true`).
- `visit_hash` = `hash(IP + UA + dag + dagligt-roterende-salt)` — beregnet server-side, **gemmes på rækken men er unlinkable på tværs af dage** (salt roterer dagligt, Plausible-mønster). Ingen rå IP/UA gemmes.
- Skriver en rå event-række via service-role. Fire-and-forget; må aldrig fejle for klienten.

**5. `traffic_events` (ny tabel, migration) — rå, anonym, schema-on-read**
`(id bigserial, occurred_at timestamptz default now(), event text, path text, device text, is_bot boolean, visit_hash text)`.
- **Ingen PII:** ingen IP, ingen rå UA, intet bruger-id, intet cross-session/cross-day-id.
- **Service-role-only** (RLS aktiveret, ingen policies) — som `signup_attribution`.
- **Retention:** rækker > 180 dage slettes (pg_cron eller eksisterende cleanup-cron). Et "visit" = distinct `visit_hash` inden for en dag.
- Rå events (ikke præ-aggregerede tællere) → vi kan stille nye spørgsmål senere; aggregering sker i SQL.

**6. `trafficAggregate.js` (ny, ren aggregator)** + **`GET /api/admin/metrics` (`requireAdmin`)**
Ren funktion som [`attributionDashboard.js`](../../../backend/lib/attributionDashboard.js): tager rækker (eller pre-grupperede SQL-resultater) og beregner *landed → engaged → signup*-funnel, public-engagement-rate (1 − bounce), bot-andel over tid. Route'en kører SQL-aggregeringen og kalder den rene funktion.

**7. Admin-scorecard (frontend)**
Udvid `AdminAttributionPage` (eller nyt kort i `AdminSprintMetricsPage`) med funnellen + bot-andel + public-bounce. Bot-ekskluderet headline, bot-andel synlig ved siden af.

## Engaged-definition (eksplicit — afgjort)

Et **visit** (public) / **session** (in-app) er **engaged** hvis ÉN er sand:
- **≥ 2 in-session pageviews/route-skift** (primær — virker for SPA og logget-ud), ELLER
- **≥ 10 sek. aktiv tid med mindst én interaktion** (scroll/klik).

`public-bounce = 1 − engaged-rate` på **bot-ekskluderede** visits. In-app rapporteres som engagement/activation, ikke bounce.

## Privacy & consent-basis (afgjort: D1-(i) storage-less)

Beaconen er **ægte anonym + storage-less på enheden**: intet lægges i cookie/localStorage/sessionStorage på brugerens terminal. Dedup sker server-side via `visit_hash` (dagligt roterende salt → unlinkable på tværs af dage). ePrivacy's samtykkekrav gælder *lagring/adgang på brugerens enhed* — som vi ikke gør → consent-uafhængigt, samme legitimate-interest-basis som `signup_attribution` (privatlivspolitikkens "anonyme adfærdsdata").

**To-do i denne PR:** tilføj én sætning til privatlivspolitikken (EN+DA) der nævner aggregeret, anonym trafikstatistik uden cookies. Ingen IP/UA gemmes; intet cross-session/cross-day-id.

## Bot-håndtering

UA-regex over kendte crawlers/scrapers/headless + tom-UA, i `botDetection.js` (ren, unit-testbar). Bots flagges (`is_bot=true`), tælles separat, ekskluderes fra headline. Behavioral backstop: et visit der kun har 1 pageview, aldrig `engaged`, fra et bot-UA klassificeres som bot.

## Testing (følger pure-builder-mønstret — `node --test`, frontend + backend)

- `sessionId.test.js`: nyt id efter timeout, stabilt inden for vindue, fallback uden storage.
- `botDetection.test.js`: kendte bots klassificeres, ægte browsere ikke; tom-UA.
- `trafficAggregate.test.js`: funnel-aggregering, bot-eksklusion, engaged-tærskel, tom-input.
- `collect`-route: bot-flag + visit_hash-dedup + insert — verificér kolonner findes + kør mod ægte tabel (test-real-endpoint-reglen, ikke kun mock).
- Frontend `node --test` obligatorisk (ESM-import-fælde, CLAUDE.md §4).

## Migration & rollout

- `traffic_events` tilføjes via migration i `database/`. **PR med migration auto-merges ikke — ejer merger** (auto-applies i prod).
- Additivt og bagudkompatibelt; ingen ændring af eksisterende tabeller. `session_started`-fixet ændrer kun fyrings-frekvens, ikke skema.
- Retention-cleanup via cron. Endpointet kan gates bag `app_config`-flag, men additiv telemetri er lav-risiko.
- Patch notes + help/FAQ: intern måling — ingen brugerrettet ændring ud over privatlivspolitik-sætningen (skrives i PR).

## Scope-dekomponering (sekvens)

- **PR 1 (denne spec):** session-fix + `/api/collect` + `traffic_events` + anonym beacon + bot-filter + admin-scorecard + privatlivspolitik-sætning.
- **PR 2:** #2039 translate-crash (`<html lang>` app-bredt + DOM-mutation-resiliens).
- **PR 3:** #2042 login-væg → kontekst-login + offentlig preview af delte ruter.
- **Opfølgning:** #2041 verificér returning-attribution oven på det nye fundament.

## Afgjorte beslutninger

- **D1:** Privacy-basis = **storage-less** (server-side `visit_hash`, dagligt salt; intet på enheden).
- **D2:** Engaged-tærskel = **≥ 2 route-skift** primær (+ 10s-interaktions-backstop).
- **D3:** Session-timeout = **30 min** (industri-standard).
- **Build vs buy:** **Byg tyndt** — ingen ny vendor; `player_events` + tynd cookieless beacon.
