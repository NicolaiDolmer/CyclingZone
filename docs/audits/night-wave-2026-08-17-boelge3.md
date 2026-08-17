# Spillerværdi-bølge 3 — 2026-08-17 (dagbølge)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 15:50 → ~18:50 |
| Agenter launched / fuldført / døde | 13 (11 bølge + 2 opfølgere) / 12 / 0 (staff-opfølger kørte stadig ved artifact-skrivning) |
| PR'er åbnet / merged | 11 / 10 (#3842 #3843 #3844 #3845 #3846 #3847 #3848 #3849 #3850 #3852; #3851 draft afventer kandidat-flow + ejer-flag) |
| Issues → claude:done | #3657 #3652 #2721 #3650 #2700 #3751 #3787 #3098 #3008 #3012 (+ #3550 målt, beslutning → værdi-session) |
| gh-401/503-retries | Talrige — GitHub-hændelse 17/8 eftermiddag (503 på GraphQL, 429 på action-downloads); to jobs genkørt, alle falske røde |
| Recoveries (type) | 2 post-squash-merge-konflikter løst centralt (#3847 genbygget fra ren main, #3844 merge af begge intentioner) |
| Preflight | GO kl. 15:48 (.codex.local/night-wave-preflight.json) |

## Leverancer
Talent-kanalen (masterplan C) komplet: scouting-targeting på ryttertype + rapport til hele shortlisten + 1-dags mission, klub-scouting-historik afkoblet fra 20-loftet, akademi-salg på transferliste OG auktion (ejer-scope-udvidelse midt i bølgen), staff 2-slots bag flag (draft). Signing fee #3550 målt mod prod: roden er typedrevet markedsværdi-skævhed, ikke stjerner. Bug-blokken (E) tømt: kommende-løb-filter, potentiale-sortering, navngiven udtagelses-fejl, tooltip-måling, 12 tavse fejl-læsninger + 6 forklarede disabled-knapper, pensions-advarsel i bud-modalen. Patch note v7.137.

## Afvigelser/læringer
- `gh pr merge --auto` direct-merger en mergeable PR TRODS røde ikke-required checks — bidt 2x (#3842, #3848). Ny regel: verificér grønt FØR merge-kaldet; --auto kun på PR'er uden røde checks. Se learning-fil.
- Baggrunds-vagt var blind i ~45 min: scriptet brugte ekstern `jq` som ikke findes i monitor-shellen; fejlen var tavs. Ny regel: vagter bruger `gh --jq`, og første tick verificeres manuelt. Se learning-fil.
- GitHub-nedetid midt i merge-kæden: køen blev gemt lokalt (scratchpad) + API-recovery-vagt; intet gik tabt.
- Post-squash-konflikter på opfølger-branches: genbyg branchen fra ren main + kun delta (hurtigere og sikrere end merge-resolution når hele branchen allerede ER squashet ind).
- Hjælp/FAQ ikke opdateret (bevidst): missions-varighed/targeting er selvforklarende i UI'et, og help.json omtaler hverken varighed eller targeting.

Refs #605 #3154.
