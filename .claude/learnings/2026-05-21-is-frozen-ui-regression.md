# 2026-05-21 — is_frozen-filter manglede i UI-endpoint (regression efter v3.83)

## Hvad skete der

[v3.83 fix](https://github.com/NicolaiDolmer/CyclingZone/commit/a57b8d9) (samme dag, 13:27) gennemførte en "backwards-check + forward-guard" på `is_frozen`-flag'et: 3 baggrundsjobs i `cron.js` + `lib/deadlineDayReport.js` + `lib/squadEnforcement.js` blev opdateret til at filtrere frosne hold ud, så Inuit Cycling + 3 test-hold ikke ville blive ramt af tvungne auto-køb, bøder og notifikationer ved sæson 0→1-transitionen samme aften.

Ca. 1 time senere åbnede brugeren `/deadline-day` (Panic Board) i prod og så stadig de 4 frosne hold listet som "under minimum". Backwards-checken havde ramt cron-laget men ikke det UI-endpoint som siden bruger.

Root cause: `GET /api/deadline-day/squads` i `backend/routes/api.js` filtrerede kun på `is_bank=false`. Det samme filter-mønster som de 3 crons fik tilføjet — `.eq("is_ai", false).eq("is_frozen", false).not("user_id", "is", null)` — manglede her.

Fix landet samme aften i v3.85 ([#536](https://github.com/NicolaiDolmer/CyclingZone/issues/536)) plus 8 polish-tasks på samme side (em-dash purge, navn-konsistens, error-handling, a11y).

## Læring: udvid scope af "backwards-check" til UI-endpoints

Memory-reglen [feedback_backwards_check_forward_guard.md](../../memory/feedback_backwards_check_forward_guard.md) siger:

> Quality-issues SKAL have begge: find alle eksisterende forekomster + forebyg gentagelse + postmortem.

v3.83 fandt 3 forekomster (alle baggrundsjobs). Det var ikke "alle eksisterende forekomster" — det var "alle eksisterende forekomster i `backend/lib/` og `backend/cron.js`". Mønstret manglede i `backend/routes/api.js`.

**Konkret regel for fremtidige cross-cutting filter-fixes på `teams`-tabellen:**

Når du tilføjer/ændrer et team-filter (`is_frozen`, `is_ai`, `is_bank`, `user_id`-null), så grep efter ALLE `supabase.from("teams")` queries på tværs af:

```
backend/cron.js
backend/lib/**.js
backend/routes/**.js   ← den der blev glemt
backend/scripts/**.js
```

Hurtigste check:

```bash
grep -rn 'from("teams")' backend/ | grep -v test
```

Hver match skal vurderes: "skal det filter også gælde her?" Ja for player-facing aggregeringer (board, oversigter, notifikationer). Nej for admin-views der eksplicit skal vise alle hold inkl. frosne.

## Forward-guard (denne PR)

Patch v3.85 inkluderer kun rettelsen til squads-endpointet. Der er ikke skrevet en lint-regel eller test der enforced'er at "alle team-queries i routes/ filtrerer is_frozen", fordi det ville false-positive på admin-views. Den her postmortem + grep-tjek-listen er forward-guarden — næste gang en cross-cutting filter-fix laves skal listen ovenfor køres.

## Sekundære fund i samme review

Issue [#536](https://github.com/NicolaiDolmer/CyclingZone/issues/536) påviste også at `/deadline-day`-siden havde 8 yderligere konsistens/kvalitets-issues som ikke var direkte regressioner men brud på etablerede mønstre:

- 4 em-dashes i player-facing tekst (TONE_OF_VOICE.md regel om em-dash, tilføjet 2026-05-18 — siden var ældre)
- H1 navn "Panic Board" matchede ikke route/nav/banner ("Deadline Day")
- Fetch-fejl viste "ikke aktiv"-besked i stedet for fejl-besked
- Tabel manglede `scope`, `aria-live`, `aria-labelledby`
- `font-black` H1 vs `font-bold` på andre pages
- `overflow-hidden` på mobile i stedet for `overflow-x-auto`
- "Under min" (celle) vs "Under minimum" (heading) i samme view
- Ingen empty-state hvis alle hold OK

Alle fixet i samme PR fordi de ramte samme fil. Læringen er at en regression-fix er en god trigger til at læse hele filen igennem med tone-of-voice + a11y-briller på, ikke kun røre den ene linje.
