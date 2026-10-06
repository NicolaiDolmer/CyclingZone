# Prompt: næste Codex-session - tunge databasekald, bevist på staging

> **Erstattet 6/10** af `2026-10-06-dagsplan.md` (Claude) og `2026-10-06-codex-dag.md` (Codex). Brug ikke denne som prompt.

Kopiér alt under stregen. Start den som en NY Codex-session (den gamle "Klargør fire CyclingZone-PR'er" lukkes; dens fire PR'er reviewes og merges af Claude Code).

---

Codex-session i C:\Dev\CyclingZone. Formål: **fjern de tungeste databasekald fra målingen 5/10, hver bevist på staging med før/efter-tal.** Følg AGENTS.md. Rør ikke løbsmotoren (backend/lib/engine/v4, raceEngineV4Bridge.js, raceRunner.js), docs/NOW.md eller docs/MASTERPLAN.md. Ingen prod-skrivninger og ingen merges: hver opgave bliver én PR, som ejeren giver go til. Commit bag `scripts/guard-commit-branch.sh`.

**Verifikation (ejer 5/10):** hold højst ÉN plads i `scripts/verify-lock.ps1` ad gangen. Kør `node scripts/verify-affected.mjs` plus preflight pr. PR, og saml fulde e2e-kørsler til sidst. En kørende Claude-bølge har førsteret. CodeRabbit-review af PR-diffs plus AGENTS.md er tilladt, så længe diffet ikke indeholder secrets, spillerdata eller noget fra `balance-internals/`.

**Læs først:** seneste kommentarer på #6184 (måling 5/10 med tabel og rækkefølge), #5904 (staging-status 5/10: skema = prod, data indlæst, renset), #5893, #5692, #3511, #6102.

**Lært 5/10 (følg det):**
- "Klar" betyder grøn CI på PR'ens nyeste commit, inkl. typecheck, lint og de berørte e2e-shards. Tjek selv `gh pr view N --json statusCheckRollup`, før du melder klar.
- Lav selv et uafhængigt read-only review af diffen (frisk proces), før du melder en PR klar, og skriv dommen i PR-body. Claude reviewer igen, før ejeren ser den.
- Efter at Claude har merget noget, der rører samme filer: synk din branch med main (merge, ikke rebase), før du venter på CI.
- Stop aldrig en "hængende" databasekommando, før du har målt, om den arbejder (tabelstørrelse, ventetilstand). Læs `.claude/learnings/2026-10-05-staging-restore-afbrudt-og-rensning-fejlede.md`.
- Persondata på staging: indlæs aldrig `users` uden at køre rensningen umiddelbart efter og verificere `ikke-anonyme = 0`.

**Førsteret: dine fire PR'er fra 5/10 (#6215 #6218 #6220 #6222).** Claude reviewer og merger dem i sin næste session. Kommer der review-fund som PR-kommentar, retter du dem FØR du går videre med sporene herunder, og svarer på PR'en med hvad du ændrede.

**0. Staging-gaten:** kør isolationstjekket (`backend/scripts/staging/assertLoadtestIsolation.mjs` via `scripts/staging/with-loadtest-staging.ps1`) og dine #6170-prerequisites. Blokerer noget, så skriv det på #5904 og stop; ret ikke staging-data selv.

**Spor, i denne rækkefølge (måling 5/10, andel af top 20-forespørgslernes tid):**
1. `feature_liveness_table_counts()`: 68 kald à 8,8 s (12,5 %). Find kaldestedet (ikke fundet i backend/lib eller scripts 5/10), og gør tællingen billig (katalogets estimater eller sjældnere kørsel). Samme svar til den, der bruger tallene.
2. Ranglisternes baggrundsopdatering (`refresh_*_mv(p_concurrently)`, `backend/lib/refreshRankingMatviews.js`): 60 kald pr. matview à 4-11 s (ca. 25 %), også når intet er ændret. Ejerens låste krav: globale ranglister beregnes samlet i baggrunden, normalt senest fem minutter efter færdig finalisering, og den seneste færdige rangliste kan læses imens. Byg opdatering ved hændelse i stedet for på ur, med friskhedsbevis. Tag sæsonskiftets plain refresh med (`seasonTransition.js`, #5692; skal være klar før 25/10).
3. #3511: tre `race_results` + `races`-læsninger med 2.861 kald hver (14 %). Saml dem og mål indeks med EXPLAIN på staging. Bestyrelsens regler og facit må ikke ændres.
4. #6102 (draft PR #6136) og forespørgslen på `race_results (race_id, imported_at, prize_money)`: 266 kald à 1,3 s. Før/efter på staging; SQL-flytning kræver ejerens ordrette "kør".
5. Realtime-aflæsningen (18 %): kortlæg hvilke tabeller der ligger i publikationen, og hvem der lytter. Kun rapport og forslag, ingen ændring uden ejer-go.

**Hver PR skal have:** template, `Refs #N`, før/efter-tal fra staging (kald, snit, rækker), regressionstest, grøn preflight, og en linje om hvad der ikke er verificeret. Send en kort status, når hver PR er klar.

**Kvalitets-issues du må tage, hvis du har luft:** #6226 (verify-lock: én plads pr. runtime), #6229 (refresh-staging fail-closed), #6230 (CI-test af rensescriptet), #6214 (runnerens worktree-adgang).
