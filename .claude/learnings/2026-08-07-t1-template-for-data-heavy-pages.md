# 2026-08-07 — T1-skabelon til data-tunge sider: 4. gentagelse af samme klasse (#3454)

## Symptom
Akademi-siden brugte T1 (max-w-4xl) til et dense roster-table → spildt bredde, ejer-direktiv om fuld bredde. Samme klasse som #1675 (transferliste), #1186 (Mit Hold), #2446 (daglig træning).

## Rodårsag
Skabelon-valget (T1/T2/T3, PAGE_TEMPLATES.md) træffes ved sidens fødsel og revurderes aldrig når indholdet vokser sig data-tungt. Ingen guard fangede kombinationen "kanonisk DataTable inde i T1-container".

## Fix + forward-guard
- AcademyPage → T2 (1600px) inkl. Layout-rutens WIDE_CONTENT_ROUTES (PR #3528).
- Ny guard `scripts/lint-t2-container-guard.mjs` (preflight + eget CI-job): flager DataTable-i-T1 uden begrundet allowlist-entry. Bevidste undtagelser (HallOfFame, Klub-personale) står i allowlist MED begrundelse.

## Læring
Når samme fejlklasse rammer 3+ gange, er svaret en maskinel guard, ikke en 4. manuel oprydning. Guarden koster ~50 linjer og lukker klassen permanent.
