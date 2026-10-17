# Startprompt: næste session efter 16/10 formiddag (pc1)

Ny session på pc1. Kør `git pull --ff-only`, læs `docs/NOW.md` og denne fil, og følg den. Du er den eneste aktive session og driver selv merge-køen (`pwsh -File scripts/merge-queue.ps1 -Pr "a,b"`, én kø-proces ad gangen). Svar på dansk i ALLE beskeder. Stil spørgsmål ét ad gangen med en anbefaling, og send et PNG/en side før hvert UI-spørgsmål. Byggearbejde køres via `.claude/workflows/wave.js` (`name: "wave"`, ejer-opt-in står i CLAUDE.md). Vær proaktiv: arbejd videre uden at stoppe, og kom kun til ejeren med beslutninger, ét kort ad gangen.

## Ejerens prioritering (16/10, ordret retning)

1. **Merge-flowet først.** De igangværende PR'er gøres færdige og merges, før nye opgaver startes.
2. **Kommunikation med spillerne er markant vigtigere.** Ingen ubesvarede spørgsmål må hobe sig op. Claude laver udkastene; **ejeren sender alle svar selv** (Discord og forum).
3. **Udskudte opgaver:** find opgaver der er udskudt igen og igen, og få dem lukket eller lavet.
4. **Hold planerne opdateret:** MASTERPLAN, roadmap (cyclingzone.org), known issues, NOW.
5. **Følg Codex-planen fra 14/10 på #5833** (29 kommentarer: pension med personlig dato og 28 dages varsel, kontraktgaranti, veteranregel, S5/S6-datoer m.m.; "privatplanen"/"planoverblik" nævnt). Saml alle ejerbeslutninger derfra i én liste og byg det, der er godkendt. Online-visningen #5385 (30 min tolerance, døgnaktive, underside) er ejer-godkendt retning.
6. **Find nye opgaver/forslag fra spillerne** og lav nogle af dem.
7. Tidskritisk: S5-motoren, akademiet, flag-beslutningerne.

**Vigtigt (ejer 16/10):** "Ingen præference" eller et ubesvaret valg er ALDRIG et ja. Indfør aldrig nye regler, lofter eller processer på ejerens flow uden udtrykkeligt ja. Der er INTET PR-loft.

## Fastlagte frister

- **Akademi pull-optag:** merge #6673 (optag 2.0) senest **lørdag 17/10 kl. 12**; er den ikke grøn, merges #6662 i stedet (ejer 16/10: "2.0, med fallback"). Flag `academy_intake_pull_enabled` tændes **før søndag 18/10 kl. 00** KUN på ejerens ordrette go. Migrationen fra #6673 skal være applied før flip (review-note a).
- **S5-motoren:** ejer 16/10: motorforbedringer skal ud løbende i S4 i bundter, når grundigt testet. Tænd-PR **#6699 er draft og må kun merges på ejerens ordrette go (merge = tænding).** Test 16/10 (read-only, privat i OneDrive `balance-internals/6367/2026-10-16-ignition-test.md`): ingen blokerende fejl, 0 exceptions i 1.056 kørsler, GT-benchmark del 1-4 grøn, ældre revisioner byte-identiske. **Rødt flag:** på S4's lange bjergetaper bliver gap til nr. 10 ca. dobbelt så stort under s5_profiles_v1 (allerede for stort under v4); brosten vindes af klatrere (uændret fra v4); kun 66 af ca. 490 etaper testet. Næste skridt: én uafhængig dommer (Fable) på testen, så ét tænd-kort til ejeren med tal; tænding efter kl. 21.
- **Aldring (`development_v2_aging_enabled`):** frisk prøvekørsel mod prod **23/10**, vis ejeren tallene, tænd kun på ordret go (effekt ved skiftet 25/10). Faktor 0,7 er låst 13/10.
- **Ungdomsdrift:** ingen beslutning; 0 i S5 (ejer 5/10). Flaget bliver off.

## Åbne PR'er (status 16/10 ca. kl. 11)

Codex-stopregel (ejer 16/10): P1-fund rettes; er der kun P2-nuancer tilbage efter en runde, merges PR'en og P2-resten samles i et opfølgnings-issue.

| PR | Hvad | Status |
|---|---|---|
| #6707 | Patch note 7.362 (ikoner + hjælp), ejer-go givet | Merge ved grøn CI + ren Codex |
| #6671 | AI-ungdom på menneskeholdenes niveau (dry-run-scripts) | 2 uløste Codex-fund; lav risiko, merges selv bagefter |
| #6673 | Akademi optag 2.0 | 2 uløste Codex-fund; Claude-markør for HEAD mangler; FRIST lør 12 |
| #6680 | Kalender-kort + Løbshistorik bag `race_library_v2` (off) | 1 uløst Codex-fund; Claude-markør mangler; bundle 1.210 KB ejer-accepteret |
| #6657 | Risikostyret review-gate; rule 35 (d) rettet (ejer 16/10: lav risiko = Codex + grøn CI) | 3 uløste Codex-fund; Claude-markør for HEAD mangler |
| #6702 | Scout-loftbånd bruger sæsonalder (#6700) | 2 uløste Codex-fund; Claude-markør mangler |
| #6705 | Udløbsregel for ikke-live flag (#6701) | 1 uløst Codex-fund; Claude-markør mangler |
| #6703 | Træning: forbigående DB-fejl giver ny kørsel i stedet for træning uden bonus (#6596) | Draft; brand-fix (rule 35 a kræver Før/Efter i prod) |
| #6704 | Parkerede hold kører ikke legacy-træning (#6536) | Draft; brand-fix |
| #6699 | **TÆND S5-motoren** | Draft; KUN på ejerens ordrette go |
| #6662 | Lille akademi-knap (fallback) | Hold tilbage, medmindre #6673 ikke når fristen |
| #6643 | Løbshistorien med animationer | Ejer 16/10: idé om at sætte siden i beta UDEN animationer først; tages med ejeren |
| #6636, #6634, #6248 | Codex-bibliotek (holdes adskilt), plan-docs, gammel træning | Spørg ejeren før handling |

**Nye fund ved sessionens slutning (16/10 ca. kl. 11, ikke rettet endnu):**
- **#6699 (S5-tænding):** merge-konflikt med main, og CI-checket backend-tests fejler (ikke undersøgt; se gh pr checks 6699). CodeRabbit (major): migrationen skal tilføje den nye CHECK som `NOT VALID` og køre `VALIDATE CONSTRAINT` i en separat transaktion (ellers lang ACCESS EXCLUSIVE-lås på `races`). CodeRabbit (major): backend må ikke binde `s5_profiles_v1` før migrationen er applied (deploy før auto-migrate = CHECK-fejl ved første etape-claim); løs rækkefølgen, fx migration i separat PR først. Codex (P1): patch noten skal med i samme PR som tændingen (teksten godkendes af ejeren).
- **#6702 (scout-alder):** Codex: i sæsonpausen er der ingen `active` sæson, og `getActiveSeasonNumber()` falder tilbage til 1, så alle ryttere får sæson-1-alder; håndtér transition-sæsonen eksplicit. Codex mener desuden, at ændringen er spillervendt (prognose/pastPeak) og kræver patch note; afklar med ejeren.
- **#6705 (flag-udløb):** Codex: `decide_by` skal valideres som ægte kalenderdato (ikke kun formatet).

Kendt CI-særhed: merge-køen kræver checket `league-size-invariant`; mangler det på en PR, merge `origin/main` ind for en frisk CI-kørsel. Smoke-fejl af typen "e2e-laner blev afbrudt (cancelled)" skyldes et nyt push, ikke en test.

## Andre åbne spor fra 16/10

- **#6706 beta-besked** (ejer 16/10): når et flag går i beta, automatisk tråd i en forum-kategori kun for beta-testere + indbakke-besked + Discord-opslag via webhook. Ingen ny feedback-knap; feedback samles i beta-forummet. **Ejer-handling:** opret Discord beta-kanal + webhook og læg URL i Infisical som `DISCORD_BETA_WEBHOOK_URL`. Backfill `stage_page_v2` og `training_bulk_day`.
- **`training_bulk_day`:** tændes for alle først, når beta-testerne har fået besked og har kunnet teste (afhænger af #6706).
- **Flag-gennemgang:** https://claude.ai/artifact/VhzsaV1JRcigTGx8KmLmQk (21 flag; afgjort: aldring, ungdomsdrift, S5-plan, akademi). Resten tages ét ad gangen med ejeren.
- **Roadmap-oprydning** (https://claude.ai/artifact/WZUTZr9bRMgvo43KAYC5n6): A-E udført i prod 15-16/10 (backups `backup_roadmap_items_20261015/20261016`, `backup_known_issues_20261015`). Roadmap-automatikken #6694 er merget og verificeret.
- **Masterplan-artifact:** https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn

## Oprydning

- `pwsh -File scripts/close-out-cleanup.ps1` (dry-run, så `-Execute`). Tjek bagefter hovedcheckoutens `node_modules` (#6687); `npm run sync-deps` hvis tomme. Tomme worktree-caches genopbygges med `pwsh -File scripts/setup-worktree.ps1 -WorktreeRoot <wt> -MainRepoRoot C:\dev\CyclingZone -Rebuild`.
- Worktrees for merget arbejde kan fjernes med `pwsh -File scripts/remove-worktree.ps1 -Branch <branch>`.
- `MEMORY.md` og `AGENTS.md` ligger tæt på/over token-budget (`scripts/check-agent-token-hygiene.ps1`).
