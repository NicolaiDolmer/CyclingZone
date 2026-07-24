# i18next: inline `resources` uden `partialBundledLanguages` = backenden kaldes ALDRIG

**Dato:** 2026-07-24 · **Kontekst:** #2849 bølge 4 (PR #2874), i18n-split af help/rules/patchnotes

## Symptom
På Vercel-preview: /help crashede i error boundary, /rules og /patch-notes viste
rå i18n-nøgler ("page.title", "sections.squad.label"). Lokalt var ALT grønt
(fuld playwright-suite, check:i18n, node --test).

## Rod-årsag (to lag)
1. Når i18next har `resources` sat inline, kalder den IKKE HttpBackend for
   manglende namespaces medmindre `partialBundledLanguages: true` er sat.
   De udsplittede namespaces "loadede" som tomme, `ready` flippede true
   (i18next markerer også FEJLEDE loads som loaded), og HelpPages
   `t(..., { returnObjects: true }).map(...)` crashede på en streng.
2. Hullet i verifikationen: INGEN spec asserterede indhold på de tre sider.
   Patch-notes-headingen bestod via `defaultValue`, og skærmbillederne var
   taget FØR splittet. "Fuld suite grøn" beviste altså ikke splittet.

## Fix + guards
- `partialBundledLanguages: true` i i18n-init.
- De tre namespaces UD af `ns`-init-listen — ellers preloader boot 6 HTTP-filer
  (da + en-fallback × 3) og alt der køer på init (fx `changeLanguage`) bliver
  intermitterende langsomt (fangede forceEnglish-pollens 5s i smoke-testen).
  react-i18next `loadNamespaces`'er selv når siden mountes; ready-gaten dækker.
- Guard: /help, /rules, /patch-notes i `TRANSLATED_PAGE_SMOKE` med
  rawKeys-canaries — verificeret RØD mod den brudte tilstand før fix.

## Læring
1. **En adfærdsændring i loading-infrastruktur kræver en test der fejler uden
   den.** Bevis guarden rød mod den brudte tilstand (stash fixet → kør → rød).
2. defaultValue i en heading-assertion kan maskere at et helt namespace mangler.
3. Screenshots taget før en senere refaktor beviser intet om refaktoren —
   re-generér efter sidste kodeændring.
4. i18next-tripwire: `resources` + backend = husk `partialBundledLanguages`,
   og hold lazy namespaces ude af `ns`-listen så init ikke venter på HTTP.
