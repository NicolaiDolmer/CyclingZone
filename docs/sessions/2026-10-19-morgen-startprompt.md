# Startprompt: Claude Code, 19/10 (efter aftensessionen 18/10 på DolmerPC)

Virker fra enhver PC. Kør `git pull --ff-only` i `C:\dev\CyclingZone`, læs `docs/NOW.md` og denne fil. Svar på dansk. Stil spørgsmål ÉT ad gangen, med anbefaling og en forklaring for en ikke-udvikler. Når ejeren selv skal gøre noget, er handlingen første linje og ét kort trin (18/10: et script begravet i en lang besked blev ikke forstået).

## Status ved slut 18/10

- **Merget og live:** #6680 (løbskort + løbshistorik, flag `race_library_v2` = off i prod), #6780 (mandat-læsere + sæsonskifte, #6773 done), #6874 (Codex-agentroller; DolmerPC sat op: CLI 0.163.0, `codex-setup.ps1 -Apply` = "already configured").
- **Åbne, klar til merge-køen (kategori c, grøn CI + review-gate):** #6877 (CodeQL #379/#380, kun tests), #6878 (registry `flag: race_library_v2`), #6879 (shard-plan 2→3/3→4 laner; rodårsag til rød natlig Playwright Smoke, diagnose på #5792). Kør: `scripts/merge-queue.ps1 -Pr "6877,6878,6879"`. Efter #6879: tjek at næste natkørsel er grøn, og luk #5792.
- **#6880 (#6875, egen pulje pr. vist sæson i kalenderen):** Codex clean på HEAD `febd096`; SSOT opdateret (CALENDAR_RULES §8b). Mangler Claude-markør fra en session, der IKKE skrev koden (aftensessionen skrev den) → DENNE session reviewer `origin/main..febd0961a` og sætter `node scripts/review-gate.mjs post-claude-review --pr 6880 --verdict clean`. Spillervendt (også uden for flaget: "egen pulje" i S1-S3), så ejeren ser et før/efter-billede før merge.
- **Opfølgere oprettet:** #6881 (codex_setup.py TOML-kommentarer, lav).

## Ejer-beslutninger i dag (én ad gangen, i denne rækkefølge)

1. **Mandat-oprydning (#6773):** dry-run 18/10 viste 20 hold med S3-mandat stadig aktivt (15 aktive hold med S4-mandat, 5 frosne). Hash `559cabcd4477a934`. Kør dry-run igen (listen kan have ændret sig), vis holdnavnene, og først på ordret "kør": `--apply --owner-go=6773-production --approved-list=<ny hash>`. Ejer svarede 18/10: "spørg i morgen".
2. **Push for de 14 betatestere (#6590), ejer-go 18/10 til `push_enabled = beta`:** VAPID-nøglerne mangler i Infisical prod og Railway. Hooken forbyder at sætte secrets fra Claude Code. Forklar ejeren i ét trin: kør `powershell -ExecutionPolicy Bypass -File C:\Dev\CyclingZone\scripts\set-vapid-keys.ps1` i egen PowerShell. Scriptet genererer nøgleparret og sætter `VAPID_PUBLIC_KEY`/`VAPID_PRIVATE_KEY`/`VAPID_SUBJECT=https://cyclingzone.org` i Infisical prod + Railway CyclingZone/production. Output er kun OK/FEJL. Derefter: verificér med et "sat/mangler"-script under `infisical run`, sæt `push_enabled = beta`, og test sammen på ejerens Android.
3. **#6880 visuelt:** før/efter-billede af en afsluttet sæsons kalender.
4. **Spillersvar (#6319):** 48 udkast + Discord, ejer valgte "i morgen".

## Klar til rettelse (ingen ejer-beslutning, teknisk)

- **#6504 (frigivelse uden ejerskifte → falsk `needs_reconciliation`, Sentry CYCLINGZONE-9B):** rodårsag bekræftet i koden 18/10. Ingen af frigivelsesvejene kalder `recordRiderOwnershipEvent` (`api.js` release ~2054, academy-release ~2180, `contractExpiryRelease.js:135`, `retirementRelease.js:118`, `legacyRiderRetirement.js:25`, `betaResetService.js:175`). `trainingDateClose.js:237-243`: `followsRider` er false for en rytter med `team_id = null`, så han karantæneres. Forslag: (a) alle veje skriver en ejerskifte-hændelse (`reason` findes allerede: `release`; tjek CHECK-constraint i `database/2026-08-18-3582-rider-ownership-audit.sql` for academy/kontrakt/pension), (b) en rytter der beviseligt har forladt holdet, klassificeres `left_team` og tæller ikke som `needs_reconciliation`. Kræver teknisk design før første PR (regel 36: DB/samtidighed).

## Kendt CI-hul

`pr-verification-check.yml` mangler `ready_for_review` i `types:`, så en draft markeret klar får aldrig `check-verification` (#6874 måtte have PR-teksten redigeret). Lille ops-PR.
