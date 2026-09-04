# i18n: arkitektur og sprog-pipeline

> Refs [#4733](https://github.com/NicolaiDolmer/CyclingZone/issues/4733) (trin 1), [#4110](https://github.com/NicolaiDolmer/CyclingZone/issues/4110) (sprogplanen). Termer: [`GLOSSARY.md`](GLOSSARY.md).

## Arkitektur

- **EN er sandhed.** `frontend/public/locales/en/*.json` er kilden; alle andre sprog er afledte. Ret aldrig et målsprog for at "tilføje" en streng. Tilføj den på EN først.
- **Namespaces.** Én JSON-fil pr. namespace (46 i dag: `common`, `auctions`, `races`, `help` osv.). `defaultNS` er `common`.
- **INLINE vs lazy.** De namespaces der kan ramme first paint er importeret statisk i `frontend/src/i18n/index.js` (`ns`-listen + `resources`). Resten hentes lazy over HTTP. `scripts/i18n-check-namespace-inline.mjs` håndhæver skellet (`INLINE_EXEMPT` er de route-gatede).
- **Pseudo-locale.** `en-XA` genereres på runtime, har ingen mappe på disk og oversættes aldrig.
- **Backend-strenge** sendes som nøgler og oversættes i `backendMessages`, altså samme pipeline som resten.
- **ICU.** Enkelt-klamme MessageFormat via `i18next-icu`: `{count, plural, one {...} other {...}}`. Aldrig `{{dobbelt}}`.

### Guards i CI

| Guard | Hvad den fanger |
|---|---|
| `i18n-check-keys.mjs` | Asymmetriske nøglesæt på tværs af sprog (begge retninger) |
| `i18n-check-delta-pending.mjs` | EN-nøgle uden oversættelse (eller `__MISSING__`) i et målsprog. Fejlbeskeden peger på `npm run i18n:translate` |
| `i18n-check-icu-braces.mjs` | Dobbelt-klammer og brudt ICU |
| `tone-check-em-dash.mjs` | Em-dash i spillervendt copy |
| `i18n-check-duplicate-keys`, `-namespace-inline`, `-nav-strings`, `-page-untranslated`, `-lib-strings`, `-leaks`, `-terrain-coverage`, `-error-codes` | Øvrige struktur- og dækningskrav |

Hele kæden kører lokalt med `npm run check:i18n` (og i `scripts/preflight-pr.ps1`).

## Delta-oversætteren

`scripts/i18n-translate-delta.mjs` oversætter **kun** nye og ændrede EN-nøgler. Uændrede nøgler røres aldrig, så en sprogkaptajns rettelser overlever enhver senere kørsel.

```bash
npm run i18n:translate:dry                       # vis deltaet, ingen API-kald, ingen skrivning
infisical run --env=dev -- npm run i18n:translate
node scripts/i18n-translate-delta.mjs --lng da --ns auctions
```

Flag: `--dry-run`, `--lng <kode>`, `--ns <navn>`, `--model <id>` (default `claude-sonnet-5`), `--max-keys <N>` (default 500), `--mark-reviewed`. Bruger du `npm run`, skal flagene stå efter `--`, fx `npm run i18n:translate -- --lng da`.

API-nøglen læses kun fra `ANTHROPIC_API_KEY` og ligger i Infisical, aldrig i repoet. Mangler den, fejler scriptet med den præcise `infisical run`-kommando.

Hver oversat streng valideres før den skrives: samme placeholders som kilden, samme antal klammer, ingen `{{`, ingen em-dash, samme antal `#` i plural-grene. En nøgle der fejler valideringen skrives ikke, og kørslen slutter med exit 1.

## `frontend/i18n-state.json`

State-filen er delt sandhed om hvad der er oversat og hvad der er reviewet. Den **committes**.

Den ligger bevidst i frontend-roden og ikke under `frontend/public/`: alt under `public/` kopieres råt til `dist/` og serveres offentligt af Vercel, og en state-fil på ca. 8.300 nøgler er build-tid-metadata, ikke et deploy-artefakt.

```json
{ "version": 1, "languages": { "da": { "common": {
  "nav.dashboard": { "srcHash": "9f2c...", "status": "reviewed" } } } } }
```

- `srcHash` er en hash af EN-værdien dengang nøglen blev oversat. Afviger den fra EN nu, gen-oversættes nøglen, og status ryger tilbage til `machine`.
- `status: "machine"` betyder maskin-oversat og ikke set af et menneske. `reviewed` betyder godkendt af sprogkaptajnen.
- **Filen findes ikke endnu.** Den oprettes af den første rigtige (ikke-dry) kørsel efter merge. Den kørsel oversætter intet: den registrerer de ca. 8.300 håndskrevne DA-nøgler som `reviewed` med deres nuværende hash. Det er den forventede første-kørsel-adfærd, og resultatet skal committes.
- Dry-run skriver aldrig state.

## Kaptajn-flowet

En sprogkaptajn ejer ét sprog (gratis Pro + badge, Hattrick-modellen).

1. Delta-oversætteren skriver nye strenge som `machine`.
2. Kaptajnen retter JSON'en direkte i en PR, altså almindelig kode-review.
3. Når namespacet er gennemgået, flippes status:
   ```bash
   node scripts/i18n-translate-delta.mjs --mark-reviewed --lng fr --ns auctions
   ```
   Kun nøgler hvis `srcHash` matcher EN flippes. Er EN nået at ændre sig, siger kørslen hvor mange der blev sprunget over, og de skal gen-oversættes først.
4. Ændrer EN sig senere, ryger netop den nøgle tilbage til `machine` og lander i kaptajnens næste review. Resten står urørt.

## Tilføj et sprog

1. **Mappe:** `frontend/public/locales/<kode>/` (tom er nok, filerne bygges fra EN).
2. **Konfiguration:** tilføj en entry i `frontend/src/i18n/languages.js`. Den samler `supportedLngs`, `LanguageProvider`, `LanguageSwitcher` og landingssidens toggle ét sted, så koden ikke skal røres flere steder.
3. **Database:** udvid `users_language_check` på `public.users` med den nye kode i **samme PR** som `languages.js`. De to lister skal matche, ellers afviser databasen et sprog UI'et tilbyder. Mønstret står i `database/2026-09-03-4733-users-language-constraint-config.sql` (idempotent drop + recreate).
4. **Oversæt:** `infisical run --env=dev -- npm run i18n:translate -- --lng <kode>`. Første kørsel på et nyt sprog rammer sikkerhedsloftet, så kør med det `--max-keys`-tal fejlbeskeden angiver.
5. **Review:** sprogkaptajnen gennemgår og kører `--mark-reviewed` pr. namespace.
6. **Commit** locale-filerne og `frontend/i18n-state.json` sammen.

Uden en kaptajn tilføjes sproget ikke. Triggeren for et nyt sprog står i #4110.
