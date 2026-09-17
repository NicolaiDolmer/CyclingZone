# WEEKLY_STEERING — mandagens styringssession (SSOT for rytmen)

> Ejer-godkendt 17/9. Begrundelse: `superpowers/specs/2026-09-17-weekly-steering-session-design.md`. Budget ≤ 1.200 tok. Kør hver mandag som ugens første handling, Claude Code + ejer.

## Regler (viger aldrig)

- **Køen:** åbent issue = fejl, spillerfund eller placeret i MASTERPLAN. Andet → kandidat til `icebox`.
- **`triage:new`:** alle fund fra cloud-rutiner og sweeps oprettes med `triage:new`, aldrig `claude:todo`. Placeres i blok 3.
- **`icebox`:** kun med ejerens ordret go pr. batch. Luk "not planned" + label + kommentar "Parkeret <dato> i styringssession; genåbnes ved behov". Intet slettes.
- **Ejer-go:** UI, spilmekanik, prod-data. Backend/drift/CI/docs/tests merges af Claude ved grøn CI + CodeRabbit, hvis problemet var aftalt. Go = ordret "merge"/"kør".
- **Ét kort ad gangen**, anbefaling i kortet, skærmbillede ved UI i samme tur. Ejeren poster selv al spillerkommunikation.
- Claude bygger aldrig selv: bølge via `.claude/workflows/wave.js`, model pr. spor.

## De fem blokke

1. **Tal (10 min):** `infisical run --env=prod -- node scripts/monday-numbers.mjs` + MRR via Alunta → én linje i `GROWTH_STACK.md` §12. Sentry: `infisical run --env=dev -- node scripts/sentry-issues.mjs --period=7d`.
2. **Sandhed (30-45 min):** alle åbne PR'er (`gh pr list`) → go-kort pr. PR (merge / ret / luk). NOW + MASTERPLAN mod GitHub (lukkede issues i planen, high-prio uden plads). GDD mod specs siden sidst. `pwsh -File scripts/check-agent-token-hygiene.ps1`. Spillerløfter: `roadmap_items` status=active, hvert løfte → plan-henvisning.
3. **Prioritering (30 min):** ugens `triage:new` → bane i MASTERPLAN + `claude:todo`, eller icebox-kandidat. Kandidatliste pr. område; ejeren rangerer.
4. **Bølge-plan (15 min):** 1-2 bølger, maks 4 laner, model + verifikationsniveau pr. spor. Bane-rækkefølge: 🔴 brand → Bane 1 → Bane 2 → Bane 3.
5. **Vækst + close-out (30 min):** 2 klar-til-post udkast + 1 måling (signups pr. kanal). Close-out: NOW (🎯 Next action + 🤖 agent nulstilles), MASTERPLAN, patch notes, `close-out-cleanup.ps1`.

## Mål

Åbne issues < 300 (uge 40). `triage:new` ældre end 7 dage = 0. 0 BLOCKED PR'er uden aftalt næste handling. Ingen aktivt spillerløfte uden plan.

## Log

| Dato | Åbne | Nye/lukkede 7d | PR'er afgjort | Icebox | Udkast |
|---|---|---|---|---|---|
| 2026-09-17 (kørsel 1) | 669 → 656 | 105 / 67 | 10 afgjort, 8 merget (#5324 #5285 #5308 #5235 #5335 #5332 #5333 #5334 #5262), 1 lukket (#5263) | 18 (interne, batch 1) | S4-opslag åbning godkendt; win-back afvist (tone) → 18/9 |
