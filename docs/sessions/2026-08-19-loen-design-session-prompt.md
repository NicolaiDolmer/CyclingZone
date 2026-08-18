# LOEN-DESIGN-SESSION - 19/8 formiddag (booket i KS3, ejer-valg)

> **Model + indsats:** Hovedtraad = **Fable, effort high** (aegte design-session med ejeren, mange balance-domme). Workers = **Sonnet medium**; simulerings-/verifikationsagenter Sonnet high. Ejeren er ved computeren; beslutninger stilles ENKELTVIST med anbefaling; mockups foer byg (hard rule fra #3661-aanden). **Hard rule 24:** orkestratoren ejer e2e-slottet - parallelle workers koerer ALDRIG fuld lokal suite.

LAES FOERST: docs/NOW.md + docs/MASTERPLAN.md (B2-sporet). Claim i NOW.md. Baggrund: docs/audits/2026-08-15-oekonomi-beslutninger-1-3.md + #3757-traaden + docs/audits/2026-08-17-vaerdimodel-refit-scorecard.md + specs 14/8 (vaerdi-og-loen-fundament + oekonomi-designkritik).

## AABNING (foer designet, ~15 min)

1. Vis ejeren de parkerede drafts fra KS3 til visuelt go: S2-recap-PR + etapeside-PR-A (screenshots i deres PR'er/worktrees). Merge ved go.
2. Verificer at KS3's merge-koe landede (3925/3927/3928/3931/3932/3933/3935/3936) + flip labels/luk issues (#3915 #3913 #3916 #3101 #435 #1775 #2181) + skriv v7.144-patch-note for hele koen (kort, laesbar, EN/DA).
3. Deploy-verify prod READY + post-merge guard-tjek af main.

## SELVE DESIGNET (med ejeren, eet punkt ad gangen)

**Maal: det nye loensystem fra S3 er faerdigdesignet og bygget/klar til flip.** Beslutning 4+5 ER truffet (ankervaerdi + eet globalt A mod 35 % af genmaalt indtaegt); loenkurvens konkave form er FREDET.

1. **Niveau-korrektionen (#3449-nøglefundet):** koerende model x 0,422 slaar alt (bank clearer 0,33x, spillerauktioner 0,26x, forhandlede 0,78x). Design-beslutning: een konstant eller kilde-differentieret? Hvornaar flippes den (foer/ved/efter cutover)? Simulér-foer-ship: dry-run mod hele populationen + scorecard FOER apply.
2. **#3393 loennen:** byg det nye system oven paa korrigerede vaerdier + #2840 dagsloen (ejer-valg 18/8: nyt loensystem fra ny saeson). Verificer mod #3719/#3720-regnskabet.
3. **#3719/#3720 A/B'en:** praemie-indeks 100/50/33/10 er besluttet; A (multiplikator pr. division) er anbefalingen - A og #3720 er samme skrue. Traef dommen, kalibrer upkeep mod samme tal.
4. **#3550 signing fee:** anbefaling B (afkobl fee fra markedsvaerdi) - traef dommen nu hvor vaerdierne alligevel korrigeres.
5. **#3899 forecast-BYG:** designet er LAAST 18/8 (regnskabsopstilling, punkttal for kontraktligt, interval for praemier, erklaeret antagelses-linje "season 3 wage system"). Byg den med de nye loen-tal.
6. **#3733 soendags-kvitteringen:** design LAAST (to-linje-split, neutral no-signal-copy, profil + een soendags-notifikation). Byg hvis vaerdi-beslutningerne ovenfor giver den sit datagrundlag.
7. Ungdomsauktions-startraten (#3903-fundet): 75 % faar aldrig bud - retter niveau-korrektionen det automatisk, eller skal YOUTH_AUCTION_START_RATE justeres? Maal efter korrektionen, beslut da.

## RAMMER

Balance-tal ALDRIG paa GitHub (hard rule 17) - alle maalinger i chat/scratchpad/docs-audits uden konstanter. Migrationer: apply post-merge m. post-verify (#2642); destruktivt ejer-gated. Prod-datamutationer: dry-run -> tal -> ejer-go -> apply -> uafhaengig verify. EN foerst/DA parallelt, ingen em-dash. Patch notes ved spillersynligt.

## IKKE I DENNE SESSION

Trin 7-udrulningen (onsdag, egen session - inkl. #3592-indfoldning + frie-agent-backfill + #3924 traenings-foelelsen) - kalender-sessionen (PR #3862 + regenerering + bufferdag 24/8 + #3900-saesonoverblik) - race-UI PR B (LIVE-broadcast, tor/fre) - cutover-drejebogen (soendag; D1-komprimeringen ER bygget og merged, apply ejer-gated med frosset snapshot).

## CLOSE-OUT

Audit i docs/audits/ - NOW.md (working agent nulstil, 🎯 -> trin 7 onsdag) - masterplan/artifact ajour - token-hygiejne - done-flips straks pr. merge.
