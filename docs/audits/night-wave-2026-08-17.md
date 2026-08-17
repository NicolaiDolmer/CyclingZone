# Dagsbølge 2026-08-17 (bølge 1 af 2)

| Metrik | Værdi |
|---|---|
| Start/slut (lokal tid) | 12:05 → ~13:50 (launch → patch note 7.135 pushet) |
| Agenter launched / fuldført / døde | 8 / 8 / 0 |
| PR'er åbnet / merged | 8 / 8 (#3820 #3821 #3822 #3823 #3824 #3825 #3827 #3828) + hale: #3816 + #3802 merged, #3790 lukket |
| Issues → claude:done | #3812 #3814 #3807 #3811 #3808 #3810 #3809 #3786 #3066 #3783 #2403 #3805 #3784 + #3482 + #3634; #3792 lukket i forfilteret (allerede løst af PR #3793) |
| Nye issues fra fund | #3826 (proxy-endpointets trup-tjek mangler akademi-fallback) |
| gh-401-retries | 0 observeret |
| Recoveries (type) | 0 |
| Preflight | GO kl. 12:05 (.codex.local/night-wave-preflight.json); 2 advarsler (gho-token, dirty main-checkout), ingen NO-GO |

## Afvigelser/læringer

- **Additiv bundle-drift væltede sidste PR:** 8 hver-især-grønne PR'er summede 1,6 KB over perf-loftet; først #3827 (sidst i køen) blev rød. Budget hævet 909 → 913 efter konventionen (målt begrundelse i `_note`). Læring for kommende bølger: mål det FORENEDE træ inden sidste merge (skrevet ind i bølge 2-prompten).
- **Snapshot-refresh glemt i ét spor:** #3827's mobil-sorteringskontrol ændrede auktionssidens smoke-referencebillede; agenten kørte targeted specs men ikke snapshot-opdateringen. Orkestrator refreshede alle 3 projekter (kun de to mobil-billeder ændrede sig, konsistent med en mobil-only kontrol).
- **Scope-flag fra agent lukket af orkestrator:** #3821's agent flagede samme trætheds-/Recovery-fejl i `training.json` som uden for scope; rettet på samme branch før merge, så PR'en dækker hele #3812.
- **Forfilteret virkede:** #3792 fanget som allerede-løst (merged PR #3793) før dispatch — sporet blev erstattet af #3808 i stedet for at bygge dobbelt.
- **Patch note-konsolidering virkede:** agenter rørte ikke patchNotes.js; én samlet 7.135-entry efter alle merges. Nul patch note-konflikter mellem 8 PR'er.
- **5-åbne-PR-loftet blev bevidst overskredet** (ejer bad om 10-15 opdateringer); patch note-konsolideringen fjernede den konflikt loftet værner mod. Ingen målte gener.
- **#3802-halen kostede to ekstra CI-runder:** gammel NOW.md-konflikt + perf-gate målt mod for-gammelt budget (kørte før #3827's hævning landede). Begge mekaniske, ingen kodeændringer.

_Sessionens øvrige leverancer uden for bølgen: staging-miljø med prod-kopi (Supabase-branch `staging-3746-trin7`) + generalprøve af trin 7-backfillen (9.048/9.048, post-verify + idempotens grøn), script-bugfix i lofterApply3746 fundet af dry-run-gaten, trin 7 parkeret af ejeren, bølge 2-prompt skrevet (`docs/sessions/2026-08-17-boelge-2-prompt.md`)._
