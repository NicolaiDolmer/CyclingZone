# PostHog-pipeline: måling af status (#5305)

> Read-only audit, 2026-09-25. Svarer på de tre spørgsmål fra #5305: rammer `/ingest`-rewriten PostHog, er init consent-gatet, og findes nøglen i env. Ingen prod-skrivning, ingen kode-ændring i dette spor (se dom nedenfor).

## Dom

**Virker: rewriten. Knækket her: `VITE_POSTHOG_KEY` er ikke sat i Vercel Production → `POSTHOG_ENABLED` er permanent `false` (`frontend/src/lib/posthogClient.js:53`).**

De "0 events nogensinde" i `docs/ANALYTICS_STACK.md` skyldes **ikke** en knækket `/ingest`-rewrite og **ikke** en fejl i consent-flowet. SDK'et bliver aldrig startet, fordi den påkrævede nøgle mangler i miljøet det kører i. Alt nedenfor er verificeret runtime/config, ikke antaget.

## 1. Rammer `/ingest`-rewriten PostHog?

Ja — verificeret med tre curl-kald mod prod-origin (`cyclingzone.org`), test-events uden persondata (`distinct_id: "ops-probe"`, ingen rigtig bruger-UUID):

| Sti | Status | Body | Bemærkning |
|---|---|---|---|
| `POST /ingest/batch/` | 200 | `{"status":"Ok"}` | Hovedstien `posthog-js-lite` bruger (`${host}/batch/`, jf. kommentar i `posthogClient.js:145`) |
| `POST /ingest/e/` | 200 | `{"status":"Ok"}` | Legacy enkelt-event-sti, samme resultat |
| `GET /ingest/array/<token>` | 404 | tom | Forventet — array-stien forventer `array/<token>/config.js`, ikke bar token. Testet kun for at bekræfte at ruten matcher, ikke for capture-flowet (feature flags er slået fra, `preloadFeatureFlags: false`) |

**Bevis for at det er en ægte PostHog-respons, ikke et Vercel-genereret 200:** response-headers fra `/ingest/batch/` indeholder `X-Envoy-Upstream-Service-Time` og identisk `Vary`/`Access-Control-Allow-Credentials`-værdier som et direkte kald mod `eu.i.posthog.com/batch/` til sammenligning. Den header sættes af PostHog's egen envoy-backend, ikke af Vercels edge — Vercel ville ikke fabrikere den. Rewriten leverer altså faktisk igennem til PostHog EU, ikke bare til `/app.html`-fallback'et.

Konklusion: proxyen fra issuets "fejltilstand ingen opdager" (rewrite knækker lydløst, eget domæne svarer 200 OK alligevel) er **ikke** til stede i dag. Ruten virker.

## 2. Er posthog-init gated bag samtykke, så 0 events er forventet uden det?

Ja, dobbelt-gatet — og den ene gate slår permanent til:

- **Consent-gate** (`frontend/src/lib/posthogIntegration.jsx:33-49`): `startPosthog()` kaldes kun i en effekt der tjekker `hasConsent("analytics")`. Uden samtykke: intet kald, ingen SDK.
- **Env-gate** (`frontend/src/lib/posthogClient.js:53`): `POSTHOG_ENABLED = Boolean(import.meta.env?.PROD) && Boolean(PROJECT_KEY)`, hvor `PROJECT_KEY = import.meta.env?.VITE_POSTHOG_KEY`. `posthogIntegration.jsx:34` returnerer tidligt hvis `!POSTHOG_ENABLED` — **før** consent-tjekket overhovedet betyder noget.

Da `VITE_POSTHOG_KEY` mangler i Production (se §3), er `POSTHOG_ENABLED` altid `false` i prod, uanset hvor mange brugere der har sagt ja til `analytics`-kategorien. De 170 brugere der har givet samtykke (jf. `docs/ANALYTICS_STACK.md` §2a) har derfor aldrig kunnet generere et PostHog-event — ikke fordi de sagde nej, men fordi SDK'et aldrig fik lov at starte.

## 3. Findes projektet/nøglen i miljøet? (navne, aldrig værdier)

Nej. `vercel env ls production` for `cycling-zone`-projektet (team `nicolai-dolmers-projects`) viser **ingen** variabel ved navn `VITE_POSTHOG_KEY` eller lignende (`POSTHOG_*`, `VITE_POSTHOG_*`). 44 andre variabelnavne er sat i Production (Supabase, Sentry, Resend, Alunta, Discord, GA-måling m.fl.) — nøglen mangler ikke fordi listen er tom, den mangler specifikt.

Yderligere: `VITE_POSTHOG_KEY` findes **ikke** i `frontend/.env.example` — den er ikke engang dokumenteret som en forventet variabel for lokal opsætning. Koden i `posthogClient.js:39-46` er eksplicit om at der bevidst ikke findes nogen hardkodet fallback-nøgle i repoet (gitleaks/secret-sanitize-hook ville blokere det), så den skal komme udelukkende fra Vercel-miljøet — og gør det ikke i dag.

Der er ikke undersøgt om selve PostHog EU-projektet ("Cycling Zone") eksisterer i PostHog's UI/org — det kræver adgang ud over env-navne, og var uden for denne lanes read-only scope (kun navne, aldrig værdier; ingen PostHog-dataforespørgsler).

## 4. `/api/email/unsubscribe`-rewriten (nævnt i issuet som samme fejlklasse)

Ikke testet i denne lane — issuet nævner den som et **forslag** til samme vagt-mekanisme ("bør principielt dække"), ikke som del af de tre målingsspørgsmål i scope. Efterlades som forslag, se bund.

## Hvorfor der ikke er lavet en kodefix i denne PR

Briefen tillader en et-linje-rettelse i samme PR hvis rod-årsagen er en forkert rewrite-sti/host. Det er den ikke — rewriten virker. Rod-årsagen er en manglende Vercel-miljøvariabel, og at rette den kræver:

1. Den faktiske PostHog EU-projektnøgle (en hemmelighed denne lane aldrig må se eller håndtere), og
2. En skrivning til Vercel Production-miljøet (prod-skrivning — eksplicit forbudt for et investigate-spor, og et flag/env-flip er ejer-gated under alle omstændigheder).

Derfor: kun rapport + forslag, ingen kode- eller config-ændring i denne PR.

## Forslag (ikke besluttet her)

1. **Beslut om PostHog beholdes** (jf. ejer-kommentaren 16/9 på #5305 om færre browser-vendors) FØR nøglen sættes — at sætte nøglen nu ville starte en måling der måske skal lukkes igen kort efter.
2. **Beholdes PostHog:** sæt `VITE_POSTHOG_KEY` i Vercel Production (og evt. Preview) fra PostHog EU-projektets public "project API key" (ejer-handling, kræver adgang til PostHog org). Efter det: en enkelt manuel verifikation (samtykke til analytics i en rigtig browser, se `/ingest/batch/`-kaldet i netværksfanen) bekræfter at hele kæden virker end-to-end — de facto det #5305 efterspørger som løbende vagt, blot udført én gang manuelt først.
3. `docs/ANALYTICS_STACK.md`s ❓-status for PostHog bør opdateres til at afspejle den præcise årsag ("SDK starter aldrig — mangler VITE_POSTHOG_KEY i prod", ikke længere en ukendt "0 events") — efterladt til en opfølgende PR, da denne lane er docs/audits-ejer og ikke selve SSOT-filen.
4. Selve issuets guard-leverance (daglig cron der sammenligner PostHog-events mod `traffic_events` og fejler ved 0-events-med-trafik) er stadig ugjort og kræver den ovenstående beslutning + nøgle først — giver ikke mening at bygge en vagt for et system der er bevidst slukket.
5. `/api/email/unsubscribe`-rewritens fejltilstand (samme "svarer 200 selvom den er knækket"-mønster) er ikke målt her — separat, mindre undersøgelse hvis relevant.

## Hvad denne måling IKKE dækker

- Om PostHog EU-projektet "Cycling Zone" faktisk eksisterer i PostHog's organisation (kun env-navne blev tjekket, ikke PostHog selv).
- Preview/Development-miljøernes env-vars (kun Production blev listet).
- Hvorvidt en rigtig browser med samtykke rent faktisk sender et event i dag — nødvendigvis nej, jf. §2, men ikke afprøvet manuelt i en browser.
- `/api/email/unsubscribe`-rewriten (§4).
- Hvorvidt fire browser-analytics-leverandører er det rigtige antal (issuets "bredere spørgsmål") — ejer-beslutning, ikke en målingsopgave.
