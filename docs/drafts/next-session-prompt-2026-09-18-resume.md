# Genoptag dagbølgen 18/9 (afbrudt kl. ca. 11:45, ejeren måtte slukke PC'en)

> Ejer-mandat 18/9 kl. 08:15: 7 timers selvkørende bølge på aftalte, færdigdesignede opgaver (listen i `next-session-prompt-2026-09-17-aften-boelge.md`, bølge 3-5 + "hvis tid"). Backend/drift/CI/docs merges selv ved grøn CI + reviewer; UI/spilmekanik/auth = ready-PR med skærmbilleder til ejer-go. Bølgen blev stoppet rent med `TaskStop`; alt arbejde er committet og pushet (0 dirty, 0 upushede i alle worktrees, verificeret ved nedlukning).

## Merget i dag (alle done-flippet)

| PR | Issues | SHA |
|---|---|---|
| #5360 | #5359 mandat-kvittering season_id (anden sessions PR, merget af bølgen) | 5f177d73e |
| #5362 | #4521 `docs/PATCH_NOTES_RULES.md` | cdf892489 |
| #5367 | CRLF-falsk alarm i policy-fn-grants-test (Refs #2671) | b23584993 |
| #5361 | #2671 RLS role-smoketest (punkt 2+3) | b3abbbb62 |
| #5363 | #4981 autobud-notifikation · #5201 scouting-tekst · #5222 holdudtagelse-panel | 418148ca4 |
| #5364 | #5091 kanalmatch · #5092 script-tests i CI | a6b29e273 |
| #5365 | #5328 #5329 ai-ops-guards | b1f0832de |
| #5368 | #5283 synlig generator-test (rapport i gitignoreret `balance-internals/`) | 881453b47 |

## Åbne bølge-PR'er (genoptag i SAMME worktree under `C:/Dev/CyclingZone-worktrees/`, reset aldrig)

| PR | Spor | Tilstand ved stop | Næste skridt |
|---|---|---|---|
| #5366 | #5203 read-only-rapporter | Ready. Reviewer-fund (tuning-tal i svarudkast) rettet; fair-play-rapporten anonymiseret (fuld udgave privat i OneDrive `balance-internals/fairplay-uge38-2026-09-18-FULD.md`) | Tjek CI grøn → merge selv (docs-only) → kommentér #5203/#5282, ingen done-flip på #5282 (ejer afgør) |
| #5370 | #5177 + #5055 perf | Draft, worker midt i arbejdet | Genoptag worker (opus) |
| #5372 | #5242 apiFetch skive A (FULL-spor, fuld e2e) | Draft, worker midt i arbejdet | Genoptag worker (opus); fil-liste for skive B-D skal stå i PR-body |
| #5373 | #5259 beta-adgang (EJER-GO) | Draft; sidste commit er `wip(beta-access)` fra nedlukningen (7 filer, ufærdigt) | Genoptag worker (opus); skærmbilleder desktop+mobil → ready, merges ALDRIG uden ejer-go |
| #5374 | #5257 samlet handelsliste (EJER-GO) | Draft, tidligt | Genoptag worker (opus) |
| (ingen) | #4582 akademi-modal (EJER-GO) | Worktree `feat-4582-demote-inherits-contract-ui` oprettet, intet bygget | Start frisk i worktreet |

Genoptag via `wave.js` med `allowExistingPr: true` for #5370/#5372/#5373/#5374 (fase 0 springer ellers spor med åben PR over) og skriv i `scopeText`: "FORTSÆT i eksisterende worktree, læs `git log` + PR-body først, reset aldrig".

## Fund ejeren skal se (ét kort ad gangen)

1. **#5093 NOW.md-guard:** issuet kræver selv ejer-valg mellem CI-guard og dokumentationsregel. CI-guard blev bygget og fjernet igen før merge (reviewer-fund). Intet på main.
2. **#5283 generator-rapporten:** tre fund, vigtigst at ungdomsbåndets loft er mættet allerede ved U23-aldrene (relevant FØR U23-generering, MASTERPLAN bølge 4). Kør `npm run riders:generator-report --prefix backend` for tallene (privat fil). Issuets punkt 2 (10 eksisterende prod-ryttere side om side) mangler; planlagt lagt ind under #5327-sporet.
3. **Fair-play uge 38 (#5203/#5282):** ringens fem hold er identificeret, og "den anden byder" er i alle 12 to-byder-auktioner et andet ringmedlem. Nyt udløb fra gennemstrømningskontoen 14/9. Fuld udgave med navne/tal kun i den private fil. Ingen sanktion foreslået.
4. **Parallel session:** PR #5371 (#5369 event-katalog-guard, tilføjer required CI-job) kommer fra en anden session (`.claude/worktrees/zen-kowalevski-11f048`). Ikke rørt af bølgen.
5. **Hændelse:** to workers lagde ting i det offentlige repo som ikke må ligge der (balance-tal i `docs/audits/`, holdnavne + et Discord-brugernavn i fair-play-rapporten/PR-body). Fanget før merge; men de ligger i branch-historikken for #5368/#5366 (squash holder dem ude af main). Orkestratorens brief bad selv om rapporten i `docs/audits/` = briefing-fejl. Postmortem mangler: `.claude/learnings/2026-09-18-wave-briefs-og-hard-rule-17.md`.

## Ikke nået (bølge 2-kandidater, samme ejer-godkendte liste)

#5327 arketype-prior (+ prod-sammenligningen fra #5283) · #3517 forum-links · #5226 rapportér auktion · #4813 + #4982 + #4875 UX-pakke · #2748 pension · #5242 skive B-D · #4702 bunch-tid · #5249/#5250 forside/cookie. Loft: maks 5 ejer-go-PR'er åbne fra bølgen.

## Close-out der mangler

Samlet patch note (spillervendt i dag: #4981 overbudt-notifikation ved autobud, #5201 scouting-tekst, #5222 holdudtagelse-panel) som egen docs-PR + Discord-udsnit · `docs/audits/night-wave-2026-09-18.md` · MASTERPLAN ✅ (#2671 #5091 #5092 #5328 #5329 #5283 #4521) · postmortem (punkt 5) · `.claude/run/wave-active.json` fjernes hvis den stadig ligger der (ellers blokerer `guard-agent-spawn.sh`) · `pwsh -File scripts/close-out-cleanup.ps1` · token-hygiejne · keep-awake-vinduet (PID 25596) lukkes af sig selv ved sluk.
