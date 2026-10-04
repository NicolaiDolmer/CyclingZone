# OPERATING_PLAN — fast dagsrytme, kanal-split og seks spor

> Ejer-godkendt 3/10 (struktur A). SSOT for **hvordan** arbejdet køres hver dag. Rækkefølgen ejes af [`MASTERPLAN.md`](MASTERPLAN.md); ugens styring af [`WEEKLY_STEERING.md`](WEEKLY_STEERING.md). Budget ≤ 1.500 tok. Prompts i ejerens hænder ændres aldrig; detaljerne står her.

## Kanal-split

| Kanal | Ejer | Rører aldrig |
|---|---|---|
| **Claude Code** (orkestrator) | §Morgen, §Aften, §Søndag, mandag · merge-køen · prod-skrivninger efter ordret go · UI, spillertekst, designkort · `NOW.md` + `MASTERPLAN.md` · spor 2-5 (byg via `wave.js`) | Codex' åbne PR'er og claims |
| **Codex** (bygger) | Spor 1 + 6 + Fabrikken · backend-fix med låst spec · PR med preflight; resultat og næste skridt som kommentar på issuet | `NOW.md`, `MASTERPLAN.md`, spillertekst, prod-skrivning uden ejer-go, status-docs-PR'er |

Claim = `claude:in-progress` + kommentar "Codex/Claude Code: <plan>" på issuet. Begge respekterer fælles bølgelås og loft (4 laner, verify-semafor 2).

## §Morgen (08.30, Claude Code)

1. Læs `NOW.md` + `MASTERPLAN.md`; `gh pr list`; `gh issue list --label triage:new`; Sentry 24 t (`scripts/sentry-issues.mjs --period=24h`).
2. Ét kort ad gangen: brand → PR-go (diff-baseret, UI med samlet før/efter-billede) → ejerbeslutninger. Anbefaling i kortet.
3. Slut: dagens byggeliste (≤ 4 laner Claude Code + Codex' næste trin) som kommentar i `NOW.md` 🎯.

## §Codex (dag)

Tag øverste ikke-startede trin i spor 1, 6 eller Fabrikken (MASTERPLAN-rækkefølge; brand-issues med `codex`-ejer går først). Claim → worktree → TDD → `scripts/preflight-pr.ps1` + tier-verifikation → PR (`Refs #N`) → kommentar på issuet. Merges PR'en, flippes issuet til `claude:done` (eller lukkes) i samme tur. Issue med flere delopgaver: resten flyttes til nyt issue ved første merge. Spørg aldrig ejeren direkte om design; skriv spørgsmålet på issuet med `needs-decision`, så tager §Morgen det.

## §Bølge (dag, Claude Code)

`wave.js` med de 1-4 øverste klare trin i spor 2-5 + løfter over dato (ældste først). Model eksplicit pr. spor. Ingen patch note i bølge-PR'er; samlet ved §Aften.

## §Aften (20.15, Claude Code)

1. Træning afregnet (sweep ≥ 20), forfaldne etaper kørt, Sentry siden morgen.
2. Merge-køen (`scripts/merge-queue.ps1`) for PR'er med ejer-go eller stående merge-regel; post-verify.
3. Patch note for dagens spillerrettede ændringer; done-flip pr. merget issue (også Codex' merges). Flip af beta → alle: luk alle issues på MASTERPLANs flip-liste i samme tur.
4. Close-out (CLAUDE.md): `NOW.md` 🎯 + 🤖, `MASTERPLAN.md`, token-hygiejne, `close-out-cleanup.ps1`, statusboard.

## Mandag

`WEEKLY_STEERING.md` + billig done-sweep (`github-housekeeping`, "Billig ugentlig sweep"). 3/10 fandt den 14 forkerte mærker på 78 issues.

## §Søndag (Claude Code + ejer)

Næste uges største spor: designkort ét ad gangen → spec i `docs/superpowers/specs/` → issues med `claude:todo` klar til byg mandag. Ingen kode.

## Seks spor (mål → rækkefølge)

1. **Stabilitet** (Codex): 0 brand 7 dage i træk; load-test før hvert sæsonskifte. #5900 → #5904 → #5905/#6102 → #5692 → #5162 → API eget domæne.
2. **Udvikling og træning** (Claude Code): alle træningsfeatures til alle; Udvikling 2.0 live i S4. Beta → alle · #6110 · #5965 · #5947/#5949/#5929.
3. **Løbsmotoren** (Claude Code): v4-drift grøn; v2-etaper holder mod testen. **Pakke fra 5/10 (ejer 4/10, spec `2026-10-04-form-og-formtoppe-i-v4-design.md`):** trin 0 sandhedstjek → #6156 ∥ #5951/#5978 ∥ genmål gamle fejl ∥ #4914/#4197/#5515. Derefter #5981/#5982 → #5575 (S5).
4. **Økonomi og marked** (Claude Code; backend til Codex): #6115 → #5916 → #5842 → #5443 → #2885.
5. **Fastholdelse** (Claude Code): D7 ≥ 45 %, aktive/7d ≥ 100. #5305 → #4964 → #6122 → #5131 → #1140.
6. **Betaling og tillid** (Codex): #4514 → #4512/#6062 → #4511 → #6121 → #6047.

**Fabrikken** (Codex, ≤ 20 % af tiden): #6081 · #3556 · #5792 · #6064/#6065 · #6120.
