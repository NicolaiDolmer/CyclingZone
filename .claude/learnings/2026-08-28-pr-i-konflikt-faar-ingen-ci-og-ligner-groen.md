# En PR i merge-konflikt får INGEN pull_request-workflows - og ligner dermed "bare langsom CI"

**Dato:** 2026-08-28 · **PR:** #4360 (#4306) · **Sammenhæng:** parallelle sessioner + patch note-versioner

## Hvad skete der

PR #4360 stod i 40+ minutter med kun 4 checks (Vercel/CodeRabbit/Supabase/roadmap) og nul af repoets egne CI-workflows. Tomt commit, close/reopen - intet hjalp. Årsagen: GitHub kører ikke `pull_request`-workflows når PR'en er i merge-konflikt (der findes ingen merge-ref at bygge). `gh api .../check-suites` viste ingen Actions-suite overhovedet - det er signaturen.

Konflikten var forudsigelig: den anden session mergede #4353 med patch note **7.210** til main, mens denne branch også bar 7.210. Præcis #4308-klassen (patch notes brækker enhver parallel PR-bølge).

## Læringer

- **Diagnosen tager 10 sekunder:** `gh pr view N --json mergeable` → `CONFLICTING` = derfor ingen CI. Tjek DET før tomme commits, close/reopen eller ventetid.
- **Ingen Actions-suite på head-SHA'en** (`gh api repos/.../commits/SHA/check-suites`) skelner "CI kører ikke" fra "CI er langsom".
- **Faren er retningen:** en konflikt-PR ser ud som om CI "mangler at rapportere" - required checks står bare aldrig op, og `--watch` afslutter med de få tredjeparts-checks som eneste output. Det kan læses som grønt.
- Parallelle PR-bølger: tildel patch note-versioner up front ELLER accepter én konfliktløsning pr. merge (kendt opskrift: behold begge, egen note øverst, omnummerér). #4308 er den varige fix.

## Forward-guard

Ved "CI mangler" på en PR: 1) `mergeable`-tjek, 2) check-suites-tjek, 3) først derefter kick-forsøg. Overvej i #4308-arbejdet en bot-kommentar på CONFLICTING-PR'er, så tilstanden bliver synlig i stedet for tavs.
