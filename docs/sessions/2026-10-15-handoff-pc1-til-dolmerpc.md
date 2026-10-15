# Handoff 15/10: pc1 → DOLMERPC

**Til DOLMERPC-sessionen:** pc1 er lukket ned (NOW.md: "Ingen aktiv session på pc1"). Du er nu den **eneste aktive session** på projektet. Fortsæt det arbejde, du har i gang. Når det er færdigt efter best practice, afslutter du sessionen og skriver én samlet startprompt, som køres på pc1 bagefter. Svar ejeren på dansk og stil spørgsmål ét ad gangen med en anbefaling.

## Det har pc1 nået 15/10

- **Merget:** #6637 #6639 #6640 #6646 #6652 (formiddag), #6659 GC-ryttere i udbrud, #6663 drop af ubrugt GIN-indeks (post-verificeret: 0 rækker i pg_indexes), #6669 `--dump-plan`, #6670 S5-ungdomskalender, #6672 GT-træthed, #6675 "managere".
- **S5-kalenderen er skrevet i prod** (437 løb, 28/10-28/11, #6367).
- **Flag med ejer-go:** `stage_page_v2`=beta, `training_bulk_day`=beta, `first_race_card`=on.
- **#6643 løbshistorien:** pc1 rettede "500 M200 M"-overlap i Final 5 km (b7eedf3cd) og gav "Whole stage" samme profilhøjde som "The route" på desktop (12a34ad12). **Ejer 15/10: merges IKKE til beta, før animationerne er af meget høj standard.** Prototype med tre retninger (TV-grafik / gab-stige / finale-film): https://claude.ai/artifact/CA4LsBcohcSusZXr9gTRWG. Anbefaling: A i "Whole stage" + B's gab-kurve som strimmel + C's vej i "Final 5 km" med fotofinish-liste. Ejeren har IKKE valgt endnu ("spørg senere").
- **Terræn-ikoner (#6683):** ejer valgte "farvet streg", ét ikon pr. etapetype overalt, farve = sværhed, klassiker er ikke en rutetype. Spec og kategori-kolonnen til Kalender | Tabel står på issuet. Bygges efter #6680.
- **#6680 kalender-kort (#6514):** bølgen er færdig, men PR'en er rød (perf-gate, frontend-smoke) og har review-fund (P1: "Udtag hold" på løb afviklet i dag; registry mangler; P2: historik-links skal bære løbstype). Listen står på PR'en.
- **Forsiden #6665:** ejer: launch-mail må fjernes, Discord skal være nem at tilmelde sig. Separat session.
- **#6186:** hjælp vs. v4 kortlagt; resumé på issuet, fuld rapport privat i OneDrive `balance-internals/6186/`.
- Ejer-regel gemt i memory: **alle beskeder på dansk**.

## Forslag til prioritering i næste session (DOLMERPC bestemmer)

1. **S5-start 28/10 først:** U23/junior-kalender dry-run til ejeren (`--dump-plan`), derefter skrivning på ejer-go. Akademi pull-optag skal tændes før søn 18/10 kl. 00 (#6155: PR #6662 og #6673 skal afklares).
2. **#6680 → #6683:** ret review-fund og røde checks, før/efter-billede til ejeren, merge. Derefter ikon-sporet og Kalender | Tabel.
3. **Løbshistorien #6643:** ejerens animationsvalg, derefter byg i PR'en før beta-merge.
4. **Motor-drafts inden for bånd:** #6658 (udbrudsstørrelse), #6671 (AI-ungdom).
5. **Review-gaten #6657:** ejer-valg (Codex-miljø eller løsnet regel; anbefaling: løsn reglen).
6. **#6186 tekst-PR** til help.json + RULES, kvalitativt (ingen tal, hard rule 17).
7. **#6490:** mål aftenens træningsafregning 15/10 + 16/10 mod baseline.
8. **Forsiden #6665** med tydelig Discord-tilmelding.

Startprompten `docs/sessions/2026-10-16-pc1-fortsaettelse.md` dækker pc1's del. Byg den samlede prompt oven på den, med DOLMERPC's egen status.

## Når DOLMERPC lukker ned

Følg close-out i CLAUDE.md:

- NOW.md: Next action + "🤖 Working agent: Ingen aktiv session".
- Done-flip på merged issues.
- `check-agent-token-hygiene.ps1` (MEMORY.md ligger lige under loftet; AGENTS.md er over).
- `close-out-cleanup.ps1 -Execute` og `generate-status-board.mjs`.
- Push alt, og tjek at ingen worktree er dirty eller har upushede commits.
- Skriv den samlede startprompt til `docs/sessions/` og push den.
