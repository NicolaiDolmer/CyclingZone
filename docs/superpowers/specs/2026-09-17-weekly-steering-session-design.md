# Ugentlig styringssession (mandag) — design

Dato: 2026-09-17 · Ejer-godkendt i samtale 17/9 (afsnit 1-3) · Rytmen bor i `docs/WEEKLY_STEERING.md` (SSOT); dette dokument er begrundelsen.

## Problemet (målt 17/9)

| Måling | Tal |
|---|---|
| Åbne issues | 669 (650 `claude:todo`, 400 `priority:med`) |
| Nye / lukkede sidste 7 dage | 105 / 67 (netto +38 pr. uge) |
| Urørt > 60 dage | 107 (backloggen er frisk, ikke støvet) |
| Åbne PR'er der venter på ejeren | 9 BLOCKED + 2 DIRTY |
| Nye spillere pr. uge, 20/7 → 14/9 | 32 → 1 |
| Aktive/7d mod mål | 74 / 100 |

Konklusioner: (1) væksten i backloggen kommer fra **intake** (fire cloud-rutiner + sessions-sweeps opretter fund direkte som `claude:todo`), ikke fra gamle issues; fire store audits siden maj har ikke ændret kurven. (2) Flaskehalsen for "få ting ud af vagten" er **ejerens review-tid**, ikke byggekapacitet. (3) Tilstrømningen er kollapset, og #5323 (Quad9 SERVFAIL på `up.railway.app`) er en sandsynlig medvirkende årsag.

## Beslutninger (ejer 17/9)

1. **Fast ugentlig styringssession mandag**, samme dag som mandagstallene (GROWTH_STACK §1.2). Ikke en engangs-oprydning.
2. **Backlog-mål: en sand kø, < 300 åbne på 14 dage.** Åbent = fejl, spillerfund eller placeret i MASTERPLANs baner/venteliste. Resten er kandidat til `icebox`.
3. **Icebox kun med ejerens ordret go pr. batch.** Intet slettes: issue lukkes "not planned" + label `icebox` + kommentar med dato og "genåbnes ved behov". Kandidatlisten vises grupperet pr. område; ejeren rangerer og har det sidste ord.
4. **Ejer-go kun på UI, spilmekanik og prod-data.** Backend, drift, CI, docs og tests merges af Claude når CI + CodeRabbit er grøn og problemet var aftalt på forhånd (merge-gate = forudgående enighed). Ejeren ser ét samlet go-kort pr. session. I dag (kørsel 1) gennemgås alle 10 åbne PR'er sammen.
5. **Vækst-blok: 2 handlinger + 1 måling pr. uge.** Claude leverer klar-til-post udkast; ejeren poster altid selv.
6. **Struktur: én mandagssession i 5 faste blokke** (tal → sandhed → prioritering → bølge-plan → vækst + close-out). Tilgang C (automatisk søndagsrapport) bygges senere som forward-guard.

## Intake-gate

- Ny label **`triage:new`**: alle issues fra cloud-rutiner (daily-sentry-railway-triage, discord-daily-sweep, weekly-sentry-clarity-triage, weekly-fairplay-scan) og fra sessions-sweeps oprettes med `triage:new`, **ikke** `claude:todo`. Rutinernes prompter rettes. Et `triage:new`-issue er ikke i køen, før mandagens blok 3 har placeret det (→ `claude:todo` + bane i MASTERPLAN, eller `icebox` med ejer-go).
- Ny label **`icebox`** (kun sammen med lukning "not planned").
- Forward-guard (issue): et issue der står med `triage:new` i > 7 dage flagges i mandagsrapporten; senere CI-tjek.

## De fem blokke

| Blok | Indhold | Artefakt ejeren ser |
|---|---|---|
| 1 Tal | `infisical run --env=prod -- node scripts/monday-numbers.mjs`, Sentry-triage, signups pr. kanal | Én loglinje i GROWTH_STACK §12 |
| 2 Sandhed | PR-kø (alle åbne), NOW, MASTERPLAN mod GitHub, GDD mod nyeste specs, SSOT-budgetter (`check-agent-token-hygiene.ps1`), spillerløfter (`roadmap_items` status=active) mod plan | Ét samlet go-kort: diff-resumé + preview-billede pr. UI-PR |
| 3 Prioritering | Ugens `triage:new` placeres i baner; icebox-batch; nye fund ind i MASTERPLAN | Kandidatliste pr. område, ejeren rangerer |
| 4 Bølge-plan | 1-2 bølger for ugen via `.claude/workflows/wave.js`, maks 4 laner, model + verifikationsniveau pr. spor | Bølge-kort: spor, model, gate |
| 5 Vækst + close-out | 2 udkast + 1 måling; NOW, MASTERPLAN, patch notes, hygiejne-script, close-out-cleanup | Udkast til copy-paste |

Tværgående regler: go = ordret "merge"/"kør" · UI-PR kun med skærmbillede i samme tur · beslutninger stilles én ad gangen med anbefaling · Claude bygger aldrig selv, kun via bølge med eksplicit model pr. spor · workers rører aldrig `docs/NOW.md`.

## Løfte-tjek (spillerløfter)

Kilde: tabellen `roadmap_items` (status `active`, 23 løfter 17/9) + `frontend/public/locales/*/roadmap.json`. Hvert aktivt løfte skal pege på et MASTERPLAN-punkt eller et issue. Løfte uden plan → beslutningskort til ejeren (planlæg / omformulér / arkivér på roadmap-siden). `docs/PUBLIC_ROADMAP.md` er forældet (taler om "inden sæson 1") og erstattes af en henvisning til roadmap-siden.

## Kørsel 1 (17/9) — rækkefølge

1. Setup: labels, `docs/WEEKLY_STEERING.md`, rutine-prompter → `triage:new`.
2. PR-gennemgang af alle 10 åbne PR'er, ét kort ad gangen: #5324 → #5308 → #5285 → #5281 → #5264 → #5169 → #5263 → #5262 → #5235 → #3512.
3. Parallelt (read-only workers, sonnet): GDD mod specs 11-15/9 + SSOT over budget · løfte-register · MASTERPLAN mod GitHub.
4. Prioritering af ugens 105 nye + icebox-batch 1 (kandidater: `priority:low`, ikke i MASTERPLAN, ikke spillerfund).
5. Bølge-plan for ugen med #5323 som spor 1.
6. Vækst: handling 0 = #5323 · handling 1 = S4-start-opslag (udkast) · handling 2 = win-back-mail #2760 (ejer-prosa + go) · måling = signups pr. kanal, 5 uger.
7. Forward-guard-issues: søndagsrapport-rutine (tilgang C) · `triage:new`-alder-tjek.
8. Close-out: NOW, MASTERPLAN, patch notes, hygiejne-script (AGENTS.md + FEATURE_STATUS.md fejler i dag).

## Succeskriterier

- Uge 39: åbne issues < 500; uge 40: < 300. Nye issues uden triage-afgørelse efter 7 dage: 0.
- PR-kø ved sessionens slutning: 0 BLOCKED uden en aftalt næste handling.
- Hver mandag: én loglinje i GROWTH_STACK §12, to udkast leveret, én måling aflæst.
- Ingen aktivt spillerløfte uden plan-henvisning.

## Ikke i scope

Ny tooling ud over labels og docs. Automatisk søndagsrapport (eget issue). Ændring af MASTERPLANs tre-bane-regel.
