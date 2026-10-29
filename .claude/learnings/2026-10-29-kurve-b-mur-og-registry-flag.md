# 29/10: kurve B-muren (#7316) og registry-flag-fælden

## Hvad skete
- **Kurve B-muren:** `development_curve_b` blev tændt 25/10. `curveBCapSoftness` gav 0 fart på og over det bløde loft, så programmets hovedevne (tættest på loftet) stod stille i 3-4 dage for ca. 440 ryttere. Spec 23/10 §13 S2/S8 sagde udtrykkeligt "ingen mur", men koden blev bygget og tændt uden en test af netop det. Rettet i #7340 (restfart, 0 kun ved hårdt loft), flag slukket 29/10, datareparation #7342.
- **Handoff'en var forældet:** den sagde at `ability_cap_per_date_enabled` var off; den havde været on siden 25/10. Første prod-læsning af `app_config` afslørede det og pegede direkte på rodårsagens tidsvindue.
- **Registry-flag-fælden ramte 2 PR'er:** et nyt flag i `FEATURE_REGISTRY.yml` fejler `registry-flags`, fordi prod-rækken først oprettes af seed-migrationen efter merge. Løst strukturelt i #7345.
- **Kommando-kæde med `;`:** generatoren fejlede (token-loft), men kæden committede og pushede alligevel en merge med konfliktmarkører (#7277, 04bcd2e1e). Rettet i næste commit.
- **Codex-trigger:** `@codex review` blev ignoreret 3 gange på #7338 (ca. 6 timer); draft→ready-toggle virkede straks.

## Regler fremad
1. Et designkrav af typen "aldrig X" (her: aldrig 0 fremgang) skal have en test, der fejler på den forbudte adfærd, før flaget tændes.
2. Læs prod-flag (`app_config`) før en handoff's flag-påstande bruges.
3. Commit-kæder: `|| exit 1` efter hvert led; aldrig `;` foran `git commit`/`git push`.
4. Codex tavs > 15 min → draft-toggle (hukommelse `feedback_codex_draft_toggle_retrigger`).
