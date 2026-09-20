# marketing/ — offentligt SEO-site

Next.js App Router-site for cyclingzone.org's offentlige flade (marketing +
trust-sider). Spil-appen er uændret Vite-SPA i `frontend/`; routing mellem de to
sker via Vercel-rewrites (SPA-projektet beholder domænet). Arkitektur, beslutninger
og byggeplan: [#4067](https://github.com/NicolaiDolmer/CyclingZone/issues/4067)
(fase 1 af #1301/#2824).

```
npm run dev     # lokal udvikling (port 3000)
npm run build   # prod-build — prerenderer alle sider statisk
```

Regler: server-leveret unik title/description/canonical pr. side (canonical sættes
ALTID per page, aldrig i root layout), EN på roden + DA under `/da/` med hreflang,
ingen Google Fonts (self-hostede brand-fonte), anti-slop-designreglerne gælder.

## TypeScript 7 / typescript-eslint side-by-side (Refs #5356)

`typescript-eslint` har (pr. 20/9-2026, se
[typescript-eslint#10940](https://github.com/typescript-eslint/typescript-eslint/issues/10940))
ingen udgivet version der understøtter TypeScript 7 (kun eksplorativ tsgo-diskussion,
ingen dato). `devDependencies` bruger derfor Microsofts officielle side-by-side-opskrift
([announcing-typescript-7-0#running-side-by-side-with-typescript-6.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/#running-side-by-side-with-typescript-6.0)):

- `"typescript": "npm:@typescript/typescript6@^6.0.2"` — pakken andre værktøjer
  finder ved `require("typescript")` (typescript-eslints parser, Next.js'
  build-time typecheck-API) peger på TS 6.0-API'et, som typescript-eslint fejler
  hårdt uden.
- `"@typescript/native": "npm:typescript@^7.0.2"` — den rigtige TS 7-pakke
  (native/Go-compileren) forbliver installeret under sit eget navn med `tsc`-CLI'en
  i `node_modules/.bin/tsc`, klar til direkte brug hvis et fremtidigt script kalder
  `tsc` selvstændigt (ingen sådant script findes pt. — `npm run build` bruger kun
  Next's egen typecheck-API, som dermed kører på 6.0-API'et, ikke 7-nativen).

Fjern denne opsætning og gå tilbage til almindelig `"typescript": "^7"` så snart
typescript-eslint annoncerer TS 7-support (tjek issuet ovenfor).

## ESLint pinnet til 9.x (Refs #5356)

`"eslint": "^10"` (dependabot-bumpet 10/9 i #5081, aldrig CI-verificeret — se
nedenfor) knækker `eslint-config-next`s bundlede `eslint-plugin-react@7.37.5` og
`eslint-plugin-jsx-a11y@6.10.2`: begge kalder den deprecated `context.getFilename()`,
som ESLint 10 har fjernet helt (`TypeError: contextOrFilename.getFilename is not a
function` i `eslint-plugin-react/lib/util/version.js`). Ingen udgivet version af
nogen af de to plugins peer'er ESLint 10 endnu (`eslint-plugin-react@7.37.5` og
`eslint-plugin-jsx-a11y@6.10.2` peer'er begge kun op til `^9`). `eslint` er derfor
pinnet til `^9.39.5` (seneste 9.x, samme version som før #5081) indtil
`eslint-config-next` bumper til plugin-versioner der understøtter ESLint 10.

**Hvorfor dette ikke blev fanget da det skete:** `marketing-lint-build`-CI-jobbet
(#5085/#5339) blev først tilføjet 17/9 — en uge EFTER både eslint-bumpet (#5081,
10/9) og typescript-bumpet (#5082, 10/9) allerede var merget til main uden nogen
CI-vagt overhovedet. Jobbet kører desuden kun på `pull_request`-events (ikke
`push`), så main har aldrig kørt `npm run lint` i marketing/ siden — hverken før
eller efter #5085. Begge regressioner var derfor usynlige indtil en efterfølgende
marketing-PR (Dependabot #5356) first udløste jobbet.
