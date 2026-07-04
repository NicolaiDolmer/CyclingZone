# 2026-07-04 — Tavst tab af holdudtagelse ved samtidige løb (#2173)

## Symptom
Spiller (jeppek, Discord) satte trup til to løb (Chesapeake + Münsterland). Siden gemte Münsterland men **ikke** Chesapeake — uden fejlbesked. Opstillingen var væk næste dag. Rapporteret som "dobbeltbooking".

## Rod-årsag (todelt)
1. **Frontend, hovedskurken** (`RaceHubBoard.saveAll`): gemte hver dirty lineup med ét PUT-kald ad gangen og **stoppede ved første fejlende kald** (`break` + `failed=true`), men viste kun én samlet fejl. Dirty-baren talte ned for de gemte kolonner → manageren troede alt gik godt. Ved næste dag/scope-skift ryddede `useEffect(() => setDrafts({}), [dayParam, scope])` de tabte kladder **tavst**.
2. **Backend, sekundært** (`saveSelection`): delete-then-insert **uden transaktion** → en fejlet insert efter delete kunne efterlade løbet med 0 entries.

## Ikke-fund (verificeret, ikke antaget)
"Dobbeltbookingen" var **ikke** en integritetsfejl: Chesapeake (in-game-dag 4) og Münsterland (dag 5) er forskellige in-game-dage → samme rytter i begge er tilladt by design. Read-only prod-scan: **0 ryttere** faktisk dobbeltbooket. Binding-logikken virkede allerede. Havde vi jagtet "dobbeltbooking-guarden", havde vi løst det forkerte problem.

## Fix
- Frontend: `saveAll` fortsætter gennem ALLE kolonner og rapporterer navngivet partial-fejl (hvilket løb der fejlede).
- Backend: ny atomisk `replace_race_selection`-RPC (delete+insert under advisory-lås) — enten gemmes hele truppen, eller intet.

## Lektie (genbrugelig)
**Mønster at fange fremover:** *sekventiel multi-item-save der stopper ved første fejl* + *tavs state-cleanup (useEffect/reset)* = data-tab-klasse. To guards:
1. En "gem alle"-operation må aldrig stoppe halvvejs og efterlade resten ugemt uden at brugeren ved præcis hvad der fejlede.
2. Delete-then-insert mod DB skal være atomisk (RPC/transaktion), ellers kan en delvis fejl tømme rækken.

**Proces-lektie:** verificér om et rapporteret symptom ("dobbeltbooking") faktisk er problemet før du bygger en guard mod det — her var det ægte problem et andet (tavst save-tab), og prod-data modbeviste symptom-diagnosen.

Refs: #2173, PR #2197 (v6.59). Migration prod-verificeret live (`replace_race_selection`).
