# Codex-brief: sponsorpris S4 (#4860) + sponsor-base ved oprykning (#4376)

> Til Codex-session 15/9 (ejer-godkendt rækkefølge, bølge 2, "små låste"). Selvstændigt spor: rører KUN sponsor-motoren, dens tests, `docs/SPONSOR_RULES.md` og `help.json`. Ingen overlap med Claude-bølgens laner (træning, kalender, Discord, mobiltabeller). Arbejd i eget worktree: `pwsh -File scripts/new-worktree.ps1 -Branch fix/4860-4376-sponsor-base-s4`. Læs `AGENTS.md` hard rules først. Commit kun bag `bash scripts/guard-commit-branch.sh <branch> <worktree>`.

## Hvorfor nu

Begge låses i det øjeblik S4 starter (27/9). Målt 6/9: 33 pending S4-sponsoraftaler ligger under 1,40 i multiplier, 30 af dem tegnet 23-28/8 med præcis 1,00, samlet base-gab ca. **3,0 mio. CZ$**. #4376: 21 af 24 D1-hold kører på en lavere divisions base. 3-4 spillere har selv meldt det (forum "Financial Punishment?", Discord #staff-chat 28/8).

## Ejer-valg

- **#4860 = A: genpris ved aktivering.** `expireAndRenewContracts` genberegner `guaranteed_base` (+ bonusklausuler via `freezeClauses`) for en pending aftale mod de ENDELIGE standings i sæsonen der lige sluttede, med managerens variant, længde og `signed_division` bevaret. Ingen datareparation: alle 33 rækker rettes i S4-transitionen. Tilbudsdialogen + `help.json` (`sponsorPayoutTiming`, `offers.deadline`) skal sige at beløbet fastsættes ved sæsonstart mod slutstillingen (EN først, DA under, kort, `docs/TONE_OF_VOICE.md`). `SPONSOR_RULES.md` §2 ("frosset ved valg") opdateres.
- **#4376 forward-fix:** `guaranteed_base` rebases ved op-/nedrykning i S4-cutover (basen følger den division holdet FAKTISK spiller i fra S4), samme sted i transitionen. Tilbageførslen (PR #4776) er allerede kørt; det manglende er forward-reglen + svar på de to spillerspørgsmål i issuet (race-day-delen? signeringstidspunkt vs. oprykning?) som en kort kommentar-tekst ejeren kan poste.

## Kode (verificér selv mod `main`, file:line kan være rykket)

- `backend/lib/sponsorContractsService.js`: `loadRenownTargetValue` (multiplier fra `season_standings` for `start_season - 1`), `acceptOffer` (fryser `guaranteed_base` ved klik), `expireAndRenewContracts` (aktivering, genberegner i dag kun `per_race_day_rate`, #2913), default-grenen der bruger `getOffers`.
- `backend/lib/renownEngine.js`: `computeRenownMultiplier`.
- `backend/lib/economyEngine.js`: sæsonskifte-kald.
- Kolonnenavne: slå op i `database/schema-snapshot.json` (`sponsor_contracts`, `season_standings`, `teams`). Gæt aldrig.

## Krav

1. Idempotent: transitionen må kunne køres to gange uden dobbelt-genpris (markér rækken, fx `repriced_at`, kun via idempotent migration i `database/2026-09-15-4860-*.sql` hvis en kolonne er nødvendig; ellers ingen migration).
2. Forward-guard (test): to identiske valg (samme hold, variant, division) tegnet før og efter første løb giver SAMME `guaranteed_base` ved aktivering. Plus test: oprykket hold får ny divisions base ved aktivering.
3. Dry-run-script (`backend/scripts/`, `--dry-run` default) der viser pr. hold: tegnet base → genpriset base → forskel, og summen. Kør det read-only mod prod (`infisical run --env=dev -- node ...`) og læg tabellen i PR-body. Ejeren skal se tallene FØR merge (go-kort).
4. `node --test` på rørte filer + `pwsh -File scripts/preflight-pr.ps1` i forgrunden. PR-body efter skabelonen, `Refs #4860 #4376`, ingen patch note i PR'en (samles ved close-out).
5. Ingen prod-mutation. Ingen ændring af `PRIZE_PER_POINT`, divisionsbonus eller board-modifier.

## Done

PR åben (draft indtil grøn), dry-run-tabel i body, tests grønne, kommentar-udkast til #4376's to spillerspørgsmål vedlagt i PR-body.
