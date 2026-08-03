# 2026-08-03 — Nat-batch: 18 leverancer, 5 orkestrerings-læringer

18 arbejdsstrømme (16 workers + 2 orkestrator-verifikationer) → 18 PRs merged samme aften. Metoden virkede, men fem ting kostede tid og skal være standard fremover:

## 1. CI-vagt-fejl gentog sig 4 gange (dyreste læring)
tone-em-dash (×2), swallowed-catch-guard (×2), dropped-supabase-error-guard og check-verification fangede fejl i 4 PRs — hver miss kostede en fuld CI-runde (~15-20 min) + en worker-genoptagelse. Rod-årsag: worker-prompts sagde "lint + tests", men husets specialvagter står uden for den kæde. **Forward-guard:** `scripts/preflight-pr.ps1` (committet 3/8) spejler vagterne lokalt; CLAUDE.md kræver den nu før ALLE pushes. check-verification kræver mindst én `- [x]` i Brugerverifikation ELLER docs-only/backend-only-label.

## 2. Seriel merge uden kø-driver = død ventetid
Branch protection (up-to-date + 16 checks) gør merging seriel; orkestrator-drevet update-branch ved watchdog-ticks gav op til 25 min spild pr. PR. **Fix:** baggrunds-kø-driver (poll 90 s, update-branch i sekundet forgængeren merger) — skar ventetiden til nul. Strukturelt næste skridt: GitHub Merge Queue (foreslået ejeren). To parallelle orkestrator-sessioner forværrer det: hver fremmed merge sætter køens hoved BEHIND og genstarter dens CI.

## 3. `git worktree add` med backslash-stier i Bash mangler stien
Bash æder backslashes → worktree lander på sammenklemt sti INDE i hovedrepoet. Ramte 3 workers (alle opdagede + flyttede selv). **Regel:** worktree-kommandoer i PowerShell + verificér med `git worktree list` før arbejde.

## 4. auto-migrate.yml applier database/2026-*.sql VED MERGE
En migrationsfil med seed-data blev auto-applied 3 min efter merge — FØR ejeren havde godkendt indholdet (whitelist-seeden; opdaget af post-verify, ryddet op efter 15 min). **Regel:** ALDRIG seeds/data i migrationsfiler uden eksplicit ejer-ja til indholdet; orkestrator post-verificerer efter HVER merge med SQL — det var post-verify der fangede både seeden og to default-privileges-huller (anon-grants på nye tabeller; revoke eksplicit, #2830-mønstret).

## 5. Workers skal rydde egne sub-agenter op + skrive fremdrift til disk
En forældreløs hjælpe-agent kørte 3,5 timer efter dens forælder var færdig (ejeren så den og troede en opgave hang). To workers hang reelt i screenshot-fasen uden filskrivninger — uskelneligt fra "tænker længe". **Regler:** (a) workers stopper egne sub-agenter før slutrapport; (b) fremdrifts-disciplin: skriv mellemresultater løbende, >15 min uden filskrivninger = orkestrator dræber+genstarter (genbrug worktreet — en closer-agent færdiggjorde #3197's komplette diff på 15 min); (c) screenshots via playwright-mock-mønstret — browser-panelet virker ikke i baggrunds-agenter.

Refs #3172, #3189, #3135, #3197. Fuld batch-oversigt: issues #3124/#3133-#3137/#3185/#3187-#3198/#3202-#3205 + PR #3220-#3242.
