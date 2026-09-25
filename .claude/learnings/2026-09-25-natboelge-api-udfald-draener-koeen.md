# 2026-09-25: API-udfald kl. 00:50 draenede hele natboelgen paa 30 sekunder

**Haendelse.** Alle agent-processer under Workflow `wave.js` mistede forbindelsen til Anthropic-API'et samtidig (`SELF_SIGNED_CERT_IN_CHAIN`, under et minut). De fire koerende laner doede, og hver efterfoelgende spawn (nye laner, graceful stop, intake, oprydning) fejlede paa <30 s, saa 11 spor + alle redningsagenter blev til 25 agent-fejl. Orkestratorens egen session var ikke ramt; `curl`/`openssl` mod api.anthropic.com viste en ren kaede bagefter, og en haiku-testagent svarede 7 min senere.

**Hvad reddede natten.**
- Ucommitteret arbejde i tre worktrees blev committet af orkestratoren bag `guard-commit-branch.sh` og pushet (`wip:`-commits) FOER relancering.
- Relancering med samme spor: fase 0 genbruger eksisterende worktrees. Spor der allerede havde en draft-PR blev sprunget over (existing-pr-reglen) og maatte koeres i et nyt kald med `allowExistingPr: true`.
- Naeste batch blev koeet ind i den koerende boelge med `wave-policy.mjs enqueue` (rullende optag) i stedet for et nyt kald.

**Laeringer.**
1. `wave.js` boer ved N spawn-fejl i traek med samme fejltekst pause 2-5 min og proeve igen i stedet for at draene koeen (issue-kandidat).
2. Planens ejerskab skal valideres med `validateTracks` pr. batch FOER natten: `dir/**` og `dir/*.test.ts` daekker hele mappen; annotationen "(kun ...)" goer to strenge forskellige, en glob goer ikke.
3. Et Workflow-kald som auto-mode-klassifikatoren afviser EFTER hookens admission efterlader `wave-active.json` (dispatchStarted=false): `wave-policy.mjs release --wave-id <id> --children-stopped`.
4. Spor der aendrer orkestrator-vagten selv (wave-policy.mjs, guard-agent-spawn.sh, merge-queue.ps1) afvises som "Self-Modification" i auto mode; koer dem i en session med ejeren ved tastaturet.
5. `merge-queue.ps1`'s regelmotor holder alt uden for hard rule 35-kategorierne til ejer-go, ogsaa backend-only uden spillertekst; det er korrekt og skal ikke omgaas.
