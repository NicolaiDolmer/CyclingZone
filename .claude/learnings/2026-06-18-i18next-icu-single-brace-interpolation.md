# 2026-06-18 · i18next-icu bruger ENKELT-klamme — test skal assertere interpoleret output (#1451/#1455)

## Symptom
Board-timeline (#1451) viste mål-tælleren som rå **`{{met}}/{{total}}` mål nået** i prod (set live af ejer), i stedet for fx "3/3 mål nået". Alle andre interpolationer på siden ("5 sæsoner tilbage" osv.) virkede.

## Rod-årsag
Projektet bruger **i18next-icu** (`frontend/src/i18n/index.js:108 .use(ICU)`) — ICU MessageFormat, der bruger **enkelt-klamme** `{var}` / `{count, plural, ...}`. ALLE eksisterende nøgler er enkelt-klamme. Min nye `satisfactionTimeline.goals` brugte standard-i18next **dobbelt-klamme** `{{met}}/{{total}}`, som ICU IKKE interpolerer → den blev renderet bogstaveligt.

## Fix
`{met}/{total}` (enkelt-klamme) i en+da `board.json`. PR #1455.

## Hvorfor det slap gennem alle gates
1. **Playwright-testen asserterede løbsnavne + retning/% + sparkline — men IKKE mål-teksten.** Så den rå placeholder blev aldrig set af testen. (Nu rettet: testen asserterer "2/3 mål nået" + en guard `getByText(/\{met\}|\{total\}/).toHaveCount(0)`.)
2. **i18n key-coverage-checken verificerer at nøgler EKSISTERER, ikke at interpolations-syntaksen matcher ICU.** Dobbelt-klamme er gyldig JSON + gyldig nøgle — bare forkert format for ICU.
3. Unit-tests + build renderer ikke faktisk i18n-output.

## Forward-guards
1. **Når du tilføjer i18n-nøgler i dette repo: brug ICU enkelt-klamme `{x}`, aldrig `{{x}}`.** Tjek en nabo-nøgle i samme namespace.
2. **Test/Playwright for tekst med interpolation SKAL assertere det interpolerede output** (de faktiske tal/værdier), ikke kun de statiske dele. Tilføj en guard mod rå `{...}`-placeholder.
3. ✅ **GJORT (#1305-followup):** lint-regel `scripts/i18n-check-icu-braces.mjs` (kørt i `check:i18n` + unit-testet) fejler hvis en `public/locales/**/*.json`-værdi har `{{ident}}`-antipattern (værdier med inline ICU plural/select undtages). Fanger nu klassen ved commit i stedet for i prod.

## Recurrence + class-fix (2026-06-18, #1305-followup)
Bug-klassen genopstod SAMME dag i `training.json` (#1305: `{{from}} → {{to}}`, `{{delta}} fatigue`), fundet via Playwright UI-verify (samme metode som afslørede #1455). En backwards-sweep af ALLE locales fandt yderligere fund som forward-guard #1/#2 ikke havde fanget:
- `transfers.json` `finalWhistle.seasonLabel` ("Season {{number}}") + `dealsBreakdown` — **live** (Final Whistle, `DeadlineDayBoard.jsx`).
- `rider.json` `condition.injured` ("Injured: {{days}}d left") — latent (skade-flag-gated).
Alle rettet til enkelt-klamme + forward-guard #3 implementeret som CI-gate. **Lære: en learning alene forhindrer ikke recurrence — den maskinelle guard gør.**

## Beslægtet (samme session, samme tema "merged ≠ live")
- #1454: Auto-migrate fejlede stille på stale `DB_URL`-secret — migration anvendt manuelt.
- Vercel sprang frontend-deploys over: hurtige docs/tomme commits efter merget blev skippet af "Ignored Build Step" og leapfroggede kode-commit'et → koden deployede aldrig før et **force-deploy** (`vercel --prod --force`). **Læring: efter merge, verificér at prod faktisk SERVERER det nye commit (Vercel-alias + Railway-commit), ikke kun at PR'en er merged.**
