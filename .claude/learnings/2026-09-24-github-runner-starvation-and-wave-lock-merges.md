# 2026-09-24: GitHub-runnere sultede, og boelgelaasen blokerede merges af faerdige spor

## Symptom
- Kl. 12-14: 60-100 workflow-runs i koe. PR'ernes checks blev groenne i tilfaeldig raekkefoelge, ofte 40-60 min efter push. Merge-blokken (10 PR'er med ejer-go) tog 3 timer i stedet for 30 min.
- `wave-policy guarded-merge --pr N` afviste merges af PR'er, hvis filer var reserveret af spor der IKKE var startet (#5632) eller allerede var faerdige, og senere med "Wave state lock busy" (#5654, #5668), selvom sporet selv var afsluttet.

## Rodaarsag
1. `ci.yml` og `playwright-smoke.yml` havde ingen `concurrency`-gruppe: hvert push paa en PR startede et nyt fuldt run uden at annullere det forrige. 12 boelge-spor der pushede hvert 15. minut gav ca. 5x flere runs end noedvendigt.
2. Fil-ejerskabet i `wave-active.json` frigives foerst naar HELE boelgen er faerdig, ikke naar sporet er merget. Og state-laasen holdes af den koerende orkestrator, saa en merge udefra kolliderer med lanens egne skrivninger.

## Fix
- PR #5667: `concurrency: group: ${{ github.workflow }}-${{ github.event_name == 'pull_request' && github.head_ref || github.sha }}`, `cancel-in-progress` kun paa PR-events. 22 overfloedige runs annulleret manuelt.
- Merges af faerdige/ustartede spors PR'er lavet med `gh pr merge --admin`, dokumenteret paa hvert issue. Issue oprettet: guarded-merge skal slippe fil-ejerskab pr. spor ved merge og vente paa state-laasen i stedet for at fejle.

## Forward guard
- Merge-koeen tjekker `mergeStateStatus` FOER den venter paa checks (DIRTY = merge main ind foerst, ikke vent).
- Naeste boelge: `rollingIntake: false` saa snart merge-blokken starter, saa ustartede spor ikke holder filer.
