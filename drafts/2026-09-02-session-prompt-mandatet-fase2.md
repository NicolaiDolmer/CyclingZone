# Session: Mandatet fase 1-apply + fase 2-byg, S4-fundamentet, og kvalitets-baren op

> **PARALLEL-START 1/9 aften:** 1/9-sessionen (Session A) lukker sideløbende og ejer KUN: merge af PR #4550 + #4553 (rebase-CI kører) og bølgens close-out. RØR IKKE de to PR'er, #4388, eller close-out-committene. Status pr. start: React 19 + 5 board-PR'er MERGET (#4547/#4533/#4549/#4546/#4558/#4559), #4377-datareparation applied+verificeret, prod grøn. #4388 afventer stadig ejerens A/B/C. Koordinér via `docs/NOW.md`s Working agent-blok; pull-rebase main før docs-commits.

Kør som multiagent-session: **Fable som arkitekt, sonnet-workers til udførelse, Explore-agenter til sweeps.** Workflows til fan-out (find → adversarial verify), aldrig som erstatning for samtalen. Jeg er til stede: én beslutning ad gangen med tal i selve spørgsmålet, visuelt undervejs (mockups/canvas — ALDRIG preview-server på uafklaret design), og merge intet uden mit go.

## Arbejdsregler (uændrede fra 1/9, bindende)

- Verificér før claim. Ingen prod-mutation uden GO på netop det skridt. Migrations-apply = ejer-gated bag LIVE scorecard.
- Skær aldrig scope pga. tid. Anbefal på værdi, ikke kalender.
- Orkestrator ejer e2e-slottet; workers får tildelt verifikations-niveau; max 3 tunge samtidig; commit pr. delfix + push hvert 30. min.
- Token-effektivitet: Explore/haiku til rene sweeps, sonnet til udførelse, Fable kun til arkitektur/beslutninger/tone. Genbrug dagens research (addendum + roadmap + gap-audit) — genopdag INTET.
- Webkit verificeres KUN maskinelt (jeg har Android). CodeRabbit Pro auto-reviewer alle PR'er — behandl findings, advisory, aldrig blokerende.

## Fase 0: state of play (kort — sandheden er GitHub + docs/NOW.md)

Læs `docs/NOW.md`, `docs/slices/09-board-mandate-rework-MASTER.md` (revideret 1/9) og `docs/superpowers/specs/2026-09-01-board-mandate-addendum-personer-med-stemme.md` (A1-A8 = mine låste 1/9-valg — genåbn dem ikke). Verificér merge-status på rørets PR'er fra 1/9 (React #4547-kæden, #4549, #4550, genforhandlings-låsen, fase 1-wiring, stemme-fundamentet) og saml op på det der IKKE nåede i mål.

## Sporene (foreslå selv rækkefølge og antal workers efter fase 0-målingen)

1. **Mandatet fase 1-afslutning:** scorecardet vises mig LIVE → mit GO → re-baseline-apply (ejer-gated). Skyggedata verificeret mod prod bagefter.
2. **S-M2a-rest (#4556):** stemme-indhold for de 7 sidste arketyper (KUN hvis tone-prøven er godkendt — ellers er tone-godkendelsen første stop) + atomisk læsesteds-rewiring. Alt indhold består mod `docs/TONE_OF_VOICE.md`.
3. **Fase 2-UI start (#4557):** S-M2b Boardroom-siden bag kill-switch, tro mod `docs/design/board-mandate-mockups/`. Afvigelser vises mig som mockup-opdatering FØR bygning.
4. **S4-fundamentet:** S4-kalenderen laves (min 7-dages-frist fra 1/9, jf. #4176-fristen) → derefter #4543: aktiverings-fix + divisor-guard målt mod den FÆRDIGE kalender.
5. **Penge-værnet (#4555):** periode-rul-vagten (dagligt tjek, fejler højt). Dry-run mod prod før merge.
6. **Hygiejne-slottet (bølgens faste, ejer-kadence 1/9):** FØRST de fire ventende Dependabot-PR'er (#4560-#4563, alle minor/patch-grupper + gha — verificér grøn CI, merge, `npm run sync-deps` efter pull). DERNÆST #4552 auto-merge m. 7d cooldown (så næste bølges patch/minor kører selv) + #4551 dependabot/allowlist-vagten (kør mod brudt tilstand FØR merge).
7. **Kvalitets-challenge (udfordre status quo):** når fase 2-slices lander, kør en adversarial review-workflow på HELE board-modulet (find-dimensioner → verify-panel, jf. Workflow-mønstrene) — målet er at flippet møder spillerne fejlfrit, ikke bare "grønt". Fundene bliver issues eller fixes i samme bølge, aldrig en liste der rådner.

## Åbne ejer-beslutninger (stil dem enkeltvist, med tal)

- **#4388** S3-sponsorkompensation A/B/C (hvis stadig åben — tallene står i NOW.md).
- **#4519-genbesøg:** flip-horisonten er nu målbar efter fase 1 — skal bekræftelses-trinnet bygges i den gamle flade alligevel?
- Tone-prøven (hvis ikke godkendt i 1/9-sessionen).

## Genåbn ikke

A1-A8 i addendum · løbsdage 1-baseret · afmeldt hold stiller ikke op · minimum 6 fladt · to regenereringer forbudt · straf aldrig styrke · race-motoren gen-tændes aldrig uden mit go · CodeRabbit aldrig required check · main-skip-logik i ignoreCommand.

## Færdig betyder

PR m. udfyldt Brugerverifikation · verificeret på preview (med seed/override hvor gated) · patch note ved spillervendt ændring (KORT, jf. min 13/8-regel) · postmortem ved bugfix · `claude:done` straks efter merge · vagter kørt mod brudt tilstand · NOW.md + MASTERPLAN opdateret ved close-out · nye undtagelser får issue + dato SAMME dag.
