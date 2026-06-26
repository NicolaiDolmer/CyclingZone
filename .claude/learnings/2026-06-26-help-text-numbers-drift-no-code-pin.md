# Postmortem · 2026-06-26 · Help-tekstens tal driftede (ingen pin til kode)

## Hvad skete der?
In-game Hjælp & Regler oplyste forkerte startværdier: startbudget 800.000 (faktisk 500.000), relaunch-trup "8-rytters" (faktisk 12), og præmie "point × 1.500 CZ$" + en eksempel-tabel med ~20× for høje beløb (faktisk × 75). Spillere blev forvirrede (Discord, 26/6). Selve spillet var korrekt — kun help-teksten var stale.

## Root cause
`frontend/public/locales/{en,da}/help.json` har spil-tal **hardcodet i prosa** uden nogen kobling til kode-konstanterne. Da `INITIAL_BALANCE` blev sænket 800k→500k (#1717) og `PRIZE_PER_POINT` ÷20'et 1500→75 (#1816), blev help-teksten ikke opdateret, og intet fangede det. `prizes.formula` var endda allerede rettet til "1 point = 75 CZ$", mens `prizeMoney.text` + `prizes.examples`-tabellen stadig stod på ×1.500 (intern inkonsistens) — klassisk delvis-opdatering.

Kontrast: **/rules-siden driftede IKKE**, fordi den interpolerer fra `frontend/src/lib/rulesNumbers.js`, som er **pinnet til backend-konstanterne af en drift-guard** (`rulesNumbers.test.js` asserter hver værdi == backend-eksporten). Help manglede den beskyttelse.

## Fix
- #1907 / PR #1913: rettede alle stale tal i help.json (EN+DA) — budget 500k, trup 12, præmie × 75 + tabel ÷20. Verificeret mod `economyConstants.js` (INITIAL_BALANCE=500000, PRIZE_PER_POINT=75) + `starterSquadAllocator.js` (TOTAL_SIZE=12).
- Fundet via en adversarielt-verificeret help-audit (workflow: fan-out per emne → kode-verifikation → uafhængig re-verifikation), ikke kun de Discord-rapporterede linjer.

## Forhindret-fremover
- #1916 oprettet: pin help-tallene til kode (interpolér fra `RULES_NUMBERS` som /rules, ELLER en drift-guard-test) så klassen ikke kan gentage sig.
- Genbrugbart værktøj: kør en faktuel copy-audit (help.json) mod kode-konstanter efter enhver økonomi-/balance-konstant-ændring.

## Læring
Enhver player-facing flade med **hardcodede spil-tal** drifter tavst når en konstant ændres. Hvis tallet ikke er pinnet til koden (drift-guard eller interpolation fra én kilde), så ER det et spørgsmål om tid før det er forkert — især efter "÷20 / sænkning"-ændringer der rammer flere flader. Backwards-check: når en konstant ændres, så sweep ALLE flader (help, rules, landing, patch-note-skabeloner, e-mails), ikke kun den åbenlyse.
