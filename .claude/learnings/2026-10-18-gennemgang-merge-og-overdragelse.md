# 2026-10-18 · Gennemgangs-session: merges, alarm, overdragelse

Seks fælder fra en lang session (NicolaiPC, overtaget fra pc1).

1. **Remote Control viser kun slutteksten.** Tekst før et AskUserQuestion og wrap-up-boksen ses ikke af ejeren ("Hvor er min besked?", bidt 2x). Det vigtige skal stå i slutteksten, og filer sendes med SendUserFile.
2. **Forkert første diagnose af 40 min merge-vent.** Jeg sagde runner-kø; den rigtige årsag var, at Vercel aldrig byggede netop den SHA. Verificér deploy-evidensen pr. SHA, før du forklarer en ventetid (#6859).
3. **Konfliktmarkører committet af et fejlet node-trin** i `bundle-budget.json` på to grene. Kæd trin med `&&` og tæl `<<<<<<<` før commit.
4. **`git worktree add` giver ingen node_modules.** Pre-commit fejler med `Cannot find module 'lint-staged'`. Brug `scripts/new-worktree.ps1` (junction), eller lav junctions til rod/backend/frontend.
5. **`flag:` i FEATURE_REGISTRY før nøglen findes i prod gør `registry-flags` rød.** Gaten læser prod `app_config`. Når en migration opretter flaget, tilføjes `flag:` i samme post-merge-skridt (#6680).
6. **Codex-runder: stopreglen virker, men undtagelsen skal bruges.** Runde 3 på #6780 fandt et ægte tab af bonusmål (laase-token i samme ms). Det blev rettet, fordi spillerdata var i spil. P2-visningsfejl bag slukket flag gik i en opgave (#6872).
