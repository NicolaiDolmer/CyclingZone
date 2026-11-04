# 2026-11-03 PC1-eftermiddagssession: læringer (bølge + merge-kø + CI)

**Bugfixes merget:** #7489 (falsk træningsalarm, se egen fil), #7339 A+B (løbsdag: bundne ryttere i etapeløb talte som ledige; sen fyldning skrev 1-5 ryttere i løb under gulvet), #4211 (auktion pauser transferlisten), #7560 (startryttere: klemte evner, vilkårlig bedste rolle).

**Hvad gik galt i processen og den varige rettelse:**
1. *Lanes så ikke egne CI-fejl* (.ts-krav, typecheck, registry-freshness, guard-allowlist): fire PR'er ventede. → #7587 punkt 1.
2. *Golden-tests sammenlignede ny kode med sig selv* (#7536, #5950). → frosne merge-base-digests; #7587 punkt 2.
3. *Hard rule 17 i en kodekommentar* (#7560, fanget af Codex). → #7587 punkt 3.
4. *Bølgen frigav først ejerskab ved næste intake*, så merge-køen sprang færdige PR'er over. → #7587 punkt 4 (midlertidigt: `wave-policy.mjs intake --peek --finished <branch>`).
5. *Merge-køen merger i baggrunden; Stop-hookens SHA-påmindelser nåede ejeren* (6 gange). → midlertidig vagt i sessionen; #7587 punkt 6 (køen laver selv close-out).
6. *GitHub Actions-køen fuld* (gratisplanens 20 jobs): main-CI stod 1,5 t i kø; kilder: mange docs-only main-commits fra PC1, én "Til dørs"-kørsel pr. issue-kommentar, forældede PR-kørsler. → #7582 (del 1 #7589; del 2 + docs-only-skip + Til dørs-concurrency). Saml docs-commits til main.
7. *Min egen opfølgning på #7516 tilføjede `git fetch` i en kø-funktion*, som hang CI-testen til timeout. → #7592; ingen netværkskald i funktioner testene kalder uden stub.
8. *balance-internals lå kun lokalt* (PC1 og 9 worktrees). → OneDrive-junction (`3dde6dde`) + #7587 punkt 7.
9. *Codex-review på rettede PR'er blev ikke opdaget i en time* (#7511/#7515/#7516). → tjek review-receipts aktivt efter hver rettelse.
