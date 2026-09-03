# Agent-playbook — hvordan vi bruger agenter

> **On-demand doc.** Auto-loader IKKE. Læs før du planlægger en bølge, skriver en spawn-prompt, eller er i tvivl om Fable/Opus/Sonnet-valg. Destilleret fra backlog-auditen 23/7 ([#2823](https://github.com/NicolaiDolmer/CyclingZone/issues/2823): 117 agenter over to runder) + natbølge-postmortems. Ingen duplikering: mekanik og protokol-detaljer bor i [`NIGHT_WAVE_RUNBOOK.md`](NIGHT_WAVE_RUNBOOK.md) (natbølger) og [`PARALLEL_WORKTREE_ORCHESTRATION.md`](PARALLEL_WORKTREE_ORCHESTRATION.md) (7-step protokol + fuld sub-agent-skabelon); denne doc er den kortere "hvorfor og hvornår" ovenpå.

## 1. Rolle-matrix

| Rolle | Gør | Gør ALDRIG |
|---|---|---|
| **Fable** | Læser issues/SSOT, beslutter scope, skriver spawn-prompter, reviewer PR'er, merger | Implementerer selv i en bølge; det er workernes job |
| **Opus** | Tunge/uklare spor: cross-domain refactor, ny motor-logik, migration med kontrakt-implikationer, adversariel modbevisnings-agent | Trivielle enkeltfil-fixes (spild af budget) |
| **Sonnet** | Afgrænsede spor: klar root cause, enkelt-fil bugfix, docs, isoleret UI-diff | Uklar spec eller kontrakt-ændring uden Fable-oplæg først |

**Bindende (ejer 2/9):** `model` sættes EKSPLICIT i Agent-tool-kald OG i hver Workflow-`agent()`-kald. Ellers arver agenten Fables model. Bidt hårdt 2/9: 7 workflow-agenter kørte utilsigtet på Fable i en hel bølge, uden at nogen bemærkede det før close-out.

## 2. Én agent, eller en bølge?

- **Én agent:** opgaven har ét scope, én fil-familie, ingen anden agent kan kollidere med den.
- **Relaterede issues i samme rod-domæne (fil-overlap) = ÉN agent**, ikke fan-out. Tjek fil-overlap før du spawner flere.
- **Bølge:** 2+ issues uden fil-overlap, nok volumen til at retfærdiggøre preflight + stall-watch-overheadet. Fuldt protokol: `PARALLEL_WORKTREE_ORCHESTRATION.md` (dagbølge, 3+ spor) eller `NIGHT_WAVE_RUNBOOK.md` (natbølge, ejer sover).
- **Hard cap:** maks 5 åbne PR'er ad gangen (AGENTS.md regel 12) og maks 3 samtidige tunge frontend-verifikationer (regel 24). Fuld kø → merge før nyt startes.
- **Chunking:** launch i chunks på 6-8 agenter, aldrig én stor barriere. Et frosset spor gidsler kun sit eget chunk (se §6).

## 3. Verifikations-trappen

Bevisbyrden stiger med hvad påstanden koster at have forkert. Fra auditen: 48 lukke-kandidater overlevede modbevisning til 16 (runde 1), 23 til 9 (runde 2). Uden modbevisnings-runden var 11 aktive hold blevet slettet fire dage før op- og nedrykning.

| Påstandstype | Krævet bevis | Eksempel |
|---|---|---|
| Om kode | `grep`/`read` med fil:linje citeret | "Funktionen findes" → cite `raceSimulator.js:44` |
| Om repo/issue-state | Faktisk `gh`-kald-resultat, ikke issue-teksten | `gh issue view N --json state` + findes en merged PR med `Refs #N`? Issue-tal >1 uge gamle GENMÅLES, citeres ikke (regel 13/22) |
| Om produktionstilstand | SQL/MCP mod skemaet (`database/schema-snapshot.json` slås op FØRST) | "21% af tiden tomt" viste sig at være ét afsluttet vindue, ikke en stående tilstand |
| Der udløser en irreversibel handling (slet, masse-opdater, regenerér, deploy) | Separat agent hvis ENESTE opgave er at modbevise påstanden + eksplicit "standard ved tvivl = behold/afvis" i prompten | Mennesket beslutter, AI'en fremskaffer beviset (regel 15) |

## 4. Faste faldgruber (pensum)

| Klasse | Hvad der gik galt | Forsvar |
|---|---|---|
| **Gennemsnit vs. median** | "36,7 timer i snit" var trukket af outliers, medianen var 22 min | Spørg altid "er dette gennemsnit eller median, og er der outliers?" |
| **Vindue vs. tilstand** | "Tomt 21% af tiden" var sandt for målevinduet, men alle nul-timerne lå i én afsluttet episode | Skeln punkt-i-tid-måling fra en stående tendens |
| **Id vs. kategori** | "Division 4 har 13 løbsløse dage" forvekslede et pulje-id med en division | Bekræft at nøglen faktisk betyder det navnet antyder |
| **Sæson vs. sæson** | En regel gjaldt sæson 1's data, blev rapporteret som gældende nu | Kør målingen mod den AKTUELLE sæsons data, ikke en gammel golden-fixture |
| **Klasse vs. fil** ([#2786](https://github.com/NicolaiDolmer/CyclingZone/issues/2786)/[#2804](https://github.com/NicolaiDolmer/CyclingZone/issues/2804), samme `Number(null)===0`-bug to dage i træk) | Et backwards-check scoped til FILEN fangede ikke søskende-forekomster andre steder i motoren | Scope ethvert backwards-check til fejl-MØNSTERET (grep-mønsteret), ikke til stien hvor den blev fundet |

## 5. Fleet-prompt: faste regler

Fuld skabelon: `PARALLEL_WORKTREE_ORCHESTRATION.md` §Sub-agent prompt template. Disse regler er ALTID med, eller bølgen reproducerer en kendt fejl:

- **Ingen `cd X && ...`.** Prefix-tilladelser matcher ikke bag `cd`, kaldet hænger permanent i en ubesvarlig permission-prompt (natbølge 2/9). Brug `--prefix <sti>` eller absolutte stier, `git -C <sti>`.
- **Ingen heredoc i Bash.** En worker frøs permanent i `<<'EOF'` (21/8). Write-værktøj + `git commit -F <fil>`.
- **Ingen under-agenter.** En agent der spawner egne baggrunds-underagenter ender i idle-vent på notifikationer den aldrig ser (12/7, 2 hæng). Skriv "arbejd sekventielt, ingen under-agenter" eksplicit.
- **Ingen chips/baggrundsopgaver/issues til ejeren fra workers.** Orkestratoren ejer al fan-out og alle opfølgninger (natbølge 2/9-læring).
- **Push-kadence:** commit efter hvert delfix, push mindst hvert 30. min (også ufærdigt: `wip(...)`), første push senest 25 min efter start. Workflow-agenter kan ikke nudges via SendMessage, så kadencen SKAL stå i selve prompten, ikke kun i orkestratorens plan.
- **Verify-niveau tildeles eksplicit i spawn-prompten** (TARGETED/FULL/BACKEND). Ingen worker vælger selv fuld lokal e2e-suite; orkestratoren ejer det ene serielle e2e-slot (regel 24).
- **UI-ændring → draft-PR + "Design-go"-linje** ("afventer ejerens visuelle go" hvis intet go findes). Regel 25-28.
- **`Refs #N`, aldrig `Closes #N`** i commits og PR. Bruger lukker selv per `GITHUB_WORKFLOW.md`.
- **gh-kald via den delte retry-wrapper** (`scripts/lib/gh-retry.sh`/`.ps1`, 4-5 forsøg, 3-4s pause). GraphQL fejler ~40% på første forsøg.

## 6. Orkestratorens pligter

- **Stall-watch.** Kør `scripts/night-wave-stall-watch.ps1` hvert 8-10 min under en bølge. Frossen transcript-mtime + 0 worktree-fremdrift = hang, ikke en langsom agent (`status="running"` beviser intet). Ét frosset spor i en 6-8-agent-chunk gidsler kun det chunk, ikke hele natten. Uden chunking gidslede ét frossent spor hele bølgen i 7 timer, fordi hverken barrieren eller det eneste heartbeat-signal fyrede ([postmortem 17/7](../.claude/learnings/2026-07-17-night-wave-orchestrator-never-woke.md)).
- **Done-flip pr. merge, ikke til sidst.** `gh issue edit N --add-label claude:done --remove-label claude:todo` umiddelbart efter HVER merge, i selve merge-løkken. Den hyppigste close-out-fejl er en samlet done-flip man glemmer.
- **Merge-rækkefølge.** Backend/lav-konflikt → store UI-PR'er → bredeste PR (med migration) sidst. Samme-fil-PR'er sekventieres. Auto-merge kan IKKE forudsættes: natbølgen 2/9 landede aldrig automatisk, orkestratoren mergede selv grønne PR'er med `gh pr merge --squash --admin` efter DERES egne checks var grønne.
- **Audit-artifact.** Skriv `docs/audits/night-wave-YYYY-MM-DD.md` ved close-out (template i `NIGHT_WAVE_RUNBOOK.md`), inkl. udfyldt "Issues → claude:done"-række. Done-flip verificeres bagefter: `gh issue list --label claude:todo` viser ingen af bølgens merged issues.
- **Commit i delt checkout kun bag `guard-commit-branch.sh`.** En TAVS guard-fejl betyder "checkoutet står forkert" og er signalet, aldrig grund til at prøve igen uden guard. Fejlklassen har bidt 5 gange, senest fordi ejerskabet af hoved-checkoutet skiftede to gange inden for én session ([postmortem 6/8](../.claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md)).

## 7. Hvad det koster

Backlog-auditens to runder brugte ~11 mio. tokens ([#2823](https://github.com/NicolaiDolmer/CyclingZone/issues/2823)). Tommelfingerregel for hvornår man skalerer op til fleet + adversariel reviewer:

- **Billigt mål:** et ødelagt sæsonskifte, en fejlagtig masse-sletning, en irreversibel prod-handling. Her retfærdiggør selv et dyrt modbevisnings-lag sig selv mange gange over.
- **Dyrt mål:** en triviel, reversibel enkeltfil-opgave. Brug ÉN agent uden modbevisnings-lag; overhead > risiko.
- **Skalér op når BEGGE gælder:** (a) opgaven har 2+ reelt uafhængige spor, OG (b) en forkert påstand koster mere end verifikations-overheadet (irreversibel handling, mange hold/spillere påvirket, eller data der ikke let gendannes).
- Token-budget master: [`AI_OPS_TOKEN_BUDGET.md`](AI_OPS_TOKEN_BUDGET.md) + [#605](https://github.com/NicolaiDolmer/CyclingZone/issues/605).

## 8. Kendte fejlklasser (postmortem-links)

| Dato | Fejlklasse | Postmortem |
|---|---|---|
| 17/7 | Orkestratoren vågnede aldrig: ét frosset spor holdt barrieren + eneste heartbeat tavs hele natten | [Link](../.claude/learnings/2026-07-17-night-wave-orchestrator-never-woke.md) |
| 6/8 (+ 18/8) | Commit landede på en parallel sessions branch i delt checkout, 5. gang samme klasse | [Link](../.claude/learnings/2026-08-06-shared-checkout-cross-session-commit.md) |
| 22/7 + 23/7 | `Number(null) === 0`-data-gate-bug fanget to dage i træk, fordi backwards-checket var scoped til filen, ikke klassen | [22/7](../.claude/learnings/2026-07-22-passage-gate-number-null-is-finite.md) · [23/7](../.claude/learnings/2026-07-23-number-null-er-nul-og-nul-er-finit.md) |

Fuldt auto-genereret katalog: [`AGENT_ARCHITECTURE.md` §Failure-mode katalog](AGENT_ARCHITECTURE.md#failure-mode-katalog).

---

_Kilder: [#2823](https://github.com/NicolaiDolmer/CyclingZone/issues/2823), `NIGHT_WAVE_RUNBOOK.md`, `PARALLEL_WORKTREE_ORCHESTRATION.md`, `AGENT_ARCHITECTURE.md`, `AGENTS.md` hard rules 10-32, `.claude/learnings/`. Refs #605._
