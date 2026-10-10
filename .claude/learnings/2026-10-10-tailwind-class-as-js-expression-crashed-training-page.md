# En Tailwind-klasse i `${...}` crashede hele træningssiden (10/10)

**Hvad skete:** I PR #6419 (#6123) fjernede en rettelse `compact ? "min-h-10" : "min-h-6"` og efterlod `${ min-h-6 }` i en template-string. JavaScript læser det som `min - h - 6`. Det giver `ReferenceError: min is not defined` ved render, og error-boundary'en viste "The page could not be shown" for hele /training.

**Hvorfor intet fangede det før e2e:**
- `vite build` type-tjekker ikke, og udtrykket er gyldig syntaks.
- ESLint fangede ikke den udefinerede variabel i `.tsx`.
- Unit-testene rendrer ikke komponenten.
- Kun e2e (alle shards røde) og et rigtigt skærmbillede viste det. Bølgen havde markeret PR'en klar med røde e2e-shards.

**Regel:**
- En UI-PR med røde e2e-shards må aldrig kaldes klar. Åbn siden i preview-mock og se den, før PR-body siger "klar".
- Ved klasse-logik i template-strings: læg en source-guard-test ind (se `ResetToTeamProgram.test.ts`: ingen bare `${tailwind-klasse}`).
- Rettet i commit cf5e395d6 med test, der fejlede først.
