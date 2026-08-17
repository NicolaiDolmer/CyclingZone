# gh pr merge --auto direct-merger trods røde checks + vagten der målte ingenting

**Dato:** 2026-08-17 · **Kontekst:** Spillerværdi-bølge 3, merge-kæden under GitHub-hændelse.

## Symptom 1: PR merged med røde vagter
`gh pr merge N --auto --squash` på #3842 og #3848 mergede STRAKS selvom pagination-guard og
warning-budget var røde. Main arvede en eslint-warning + en baseline-udvidelse, som fik ALLE
efterfølgende PR'ers warning-budget til at fejle, indtil #3847 ryddede op.

**Rod-årsag:** `--auto` betyder "merge når required checks er grønne". Er PR'en ALLEREDE
mergeable (required grønne, strict=false), falder gh tilbage til direkte merge — de røde
IKKE-required checks ignoreres. Fejlbeskeden "unstable status" ved enablement maskerer at
et retry direct-merger.

**Regel:** Verificér selv at ALLE checks (også ikke-required) er grønne før merge-kaldet.
`--auto` kun på PR'er hvis checks stadig kører og ingen er røde.

## Symptom 2: vagten tav i 45 minutter
Merge-kø-monitoren brugte ekstern `jq`, som ikke findes på PATH i monitor-shellen. Hvert
tick fejlede tavst (tom variabel → ingen state-linje), og stilhed lignede "ingen ændring".
Opdaget først da ejeren spurgte om status.

**Rod-årsag:** Vagtscriptet emitterede kun ved success-parsing; parse-fejl producerede
ingenting. Stilhed er ikke succes.

**Regler:**
1. Brug `gh api --jq` (indbygget), aldrig ekstern `jq`, i monitors/hooks.
2. En vagt SKAL emitte sin egen målefejl (`|| echo "maalefejl"`), ikke tie.
3. Verificér vagten virker ved at se dens FØRSTE tick producere en state-linje.

Refs bølge 3-artifact `docs/audits/night-wave-2026-08-17-boelge3.md`.
