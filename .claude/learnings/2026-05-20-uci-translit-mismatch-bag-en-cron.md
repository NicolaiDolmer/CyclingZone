# UCI translit-mismatch bag en cron-sync (2026-05-20)

## Symptom
Cron-sync 2026-05-20 09:55 UTC efterlod 6.476 ryttere på `uci_points=5`. Mindst 45 af dem havde reelle PCS-points (10-196) men kunne ikke matches navne-mod-navne pga. transliteration-drift på slaviske/arabiske/asiatiske/latinamerikanske navne.

Konkret: PCS publicerer `BOLDYREV Matvei`, DB har `Matvey Boldyrev`. Token-set-matchet i `scripts/uci_scraper.py:find_uci_match()` kræver præcis spelling og falder lydløst tilbage til MIN=5.

## Hvorfor missede high-value safety-gate dem?
Gaten ([`_is_high_value_rider`](scripts/uci_scraper.py:314)) tjekker `popularity >= 70` ELLER `uci_points >= 100`. De 45 oversete havde alle:
- popularity 0-23 (under 70-grænsen)
- uci_points var ALLEREDE 5 fra forrige fejlede sync (under 100-grænsen)

Når en rytter først er blevet downgraded til 5 en gang, så er han under high-value-grænsen evigt — gaten beskytter altså ikke gen-misses. Det er en bevidst trade-off, men det betyder vi har brug for en separat audit.

## Hvad PR #509 leverede (forberedelse)
`scripts/uci_audit.py --mode translit` + `.github/workflows/uci-translit-audit.yml`. Workflow'et er manuelt-trigget (`workflow_dispatch`) og bruger fuzzy-match (SequenceMatcher ratio ≥0.6) på fornavne, med tvunget exact lastname-token. Output: CSV + foreslået override-blok.

## Hvad denne PR (#511) leverede (fix)
- Backwards: `database/2026-05-20-fix-uci-translit-mismatches.sql` — 45 UPDATE + 45 INSERT i én transaktion. Salary er GENERATED og opdateres automatisk.
- Forward: `UCI_NAME_OVERRIDE` udvidet med 45 verificerede DB→PCS pairs. Eksisterende 4 (Tesfazion, Bjorn, Blackmore, Prades) bevaret.
- PatchNotes v3.69 med EN+DA-tekst.

## Hvad jeg overvejede og fravalgte
- **Sænke fuzzy-threshold under 0.6.** Ville fange flere ægte translits men også oversvømme med false positives. Nuværende 0.6 fangede alle 45 + 156 false positives — acceptabel signal/støj.
- **Auto-apply alle audit-kandidater.** Nej — 78% af kandidaterne (156/201) var false positives. Mauro Schmid (2696 pts) ville være blevet tildelt Miro Schmid. Manuel verifikation er nødvendig.
- **`backend-only`-label på PR.** Nej — PatchNotes-ændringen ER frontend-rendered. Foretrak at pre-checke ét Brugerverifikation-item med "AI har verificeret datalaget".

## Loop-guard — undgik symptom-patching
Da første audit-re-run viste 156 resterende kandidater (ikke 0), var fristelsen at *udvide* UCI_NAME_OVERRIDE med dem alle for at få listen til 0. Det ville være den klassiske symptom-patch fra `2026-05-17-symptom-patching-loop-vs-root-cause.md`. De 156 ER false positives — listens størrelse er normal "støj" der ændrer sig hver uge. STOP, root-cause: en future-enhancement ville være en "verified false positive"-markering, men det er ikke nødvendigt for dette PR.

## Næste skridt (post-merge)
- Bruger verificerer UI-rendering (PatchNotes + rytter-detalje).
- Næste cron onsdag 2026-05-27 06:17 UTC vil bruge den udvidede UCI_NAME_OVERRIDE.
- Kør auditen igen på `main` 1-2 uger efter merge for at fange ny drift.

## Lookout for fremtidige translit-bidninger
PCS får løbende nye ryttere fra ikke-vestlige nationer. Hver gang en ny RU/UA/KZ/BG/AE/EG/TH/KR/CN rytter dukker op i top-3000, er der risiko for at deres DB-navn ikke matcher PCS' transliteration. Manuel audit hver ~4-6 uger bør være rigeligt.
