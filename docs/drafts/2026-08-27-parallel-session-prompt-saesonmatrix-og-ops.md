# Prompt: sæsonmatrix + de to ops-issues

> Parallel-session, startet 27/8. **Kør denne som workflow.** Ejer-besluttet scope og rammer
> står nedenfor og er ikke til forhandling.
>
> **En anden session kører samtidig** med #4296, #4259, #4212 og en undersøgelse af en
> peak-mål-rapport. **Rør dem ikke.** Sæson 3 starter fredag 28/8 kl. 11.

---

## Før du gør noget

Læs `docs/design/race-planning-proposal/README.md`. Hele opgave A er defineret der, og
IA'en er ejer-låst 21/8. Læs også
`.claude/learnings/2026-08-25-spillerprototype-afsloerede-to-brudte-kalender-invarianter.md`.

**Hård regel, indlært dyrt i dag:** før et fund bliver til et issue eller en kodeændring,
læs kommentarblokken **over og omkring** den funktion du vil ændre, og slå de issue-numre
op som kommentaren nævner, også de lukkede. I denne kodebase er en lang dansk kommentarblok
et **beslutningsreferat**, ikke dokumentation. En session i dag oprettede et priority:high
issue på adfærd der var ejerens eget direktiv fra to dage før. Svaret stod femten linjer
over den funktion der skulle ændres.

Og: en dataafvigelse er først en defekt når en flade rent faktisk læser feltet. `grep` efter
feltnavnet i `frontend/src` og `backend/routes` før du kalder noget en fejl.

---

## Opgaverne

### A. Sæsonmatrixen, spiller-vendt UI (hovedopgaven)

Byg rytter × løb-matrixen fra det arkiverede design. **Gentag ikke designarbejdet.**

- **Kilde:** `docs/design/race-planning-proposal/Main.dc.html` er V3 hi-fi, allerede
  genopbygget på designsystemet. `PlayerV2.dc.html` og `V1.dc.html` er spillerens egne udkast.
- **Live-prototype:** `frontend/public/race-planning-preview.html` (vores egen, #4022).
- **IA, ejer-låst 21/8:** matrixen bor i `/planning?tab=selection` bag en `Sæson / Dag`-knap.
  Klik på en løbsdag lander i dagens board. **Ét sted at gemme en udtagelse.** `RaceHubBoard`
  skal have en sæson-tilstand ved siden af sin `?day=`-navigator. `RaceSelectionPanel` på
  løbssiden består uændret.
- **Issue:** #1146. Bærer `needs-contract`, så `docs/GUARDRAILS_CORE.md` skal læses først og
  der skal foreligge en kontrakt før kode.

**Fundamentet er større end spec'en tror. Verificér før du bygger noget nyt:**
`seasonTimeline.js` har 11 rene testede funktioner. Både læse- og skrivevejen står.
`apply_race_entry_unit_batch` findes allerede og er præcis den transaktionsmekanik et
bulk-endpoint skal bruge (N løb i én transaktion under advisory-lås, deferred
dobbeltbookings-check). `PUT /races/selection/bulk` findes derimod **ikke** i koden, kun i
SSOT-tabellen.

**Åbent akse-spørgsmål, må ikke afgøres af dig:** der er 0 løbsdage over flere datoer, men op
til 5 løbsdage deler samme dato i D1. 31 dato-kolonner og 86 løbsdags-kolonner er stadig to
forskellige akser. Hvilken skal være den klikbare celle-akse? Forelæg ejeren et A/B med tal,
byg ikke videre på et gæt.

**Hård invariant:** display-tal kommer KUN fra `game_day`/`game_day_end`. `bindingWindow`
bruges KUN til den booleske overlap-test, aldrig til et tal. Den falder tilbage til
CET-ordinaler (~20.000) når én schedule-række mangler `game_day`, og ville skrive
"Deler dagene 20123-20124".

### B. #4246 — roller og ordrer siger det samme

Dette er **åben beslutning 1 i race-planning-README'en** og hører derfor sammen med A.

Motoren konsumerer allerede fem roller: `captain`, `sprint_captain`, `hunter`, `free_role`,
`helper` (`backend/lib/raceRoles.js:213`, arbejdsomkostninger `:228`). Mockup'ens eget
ordforråd (Leader / Domestique hård+let / Lead-out) har **ingen dækning**. Matrixen skal
bruge spillets ord.

Selve issuet spørger om `hunter` mod `try_break` skal afgøres FØR `TeamOrder` fryses i v4.
Afklar overlappet, og forelæg ejeren ét klart valg hvis rolle og ordre reelt siger det samme.

### C. #4308 — patch notes brækker enhver parallel PR-bølge

Samme konflikt løst fire gange 27/8, og gaten fanger ikke en syntaksfejl i den fil den vogter.
Ren ops, ingen UI. **Må merges selv.**

### D. #4309 — frontend-smoke er required, tager 20 min og flaker

19 CI-kørsler på én dag, samme check kørt fire gange på én PR. Verificér altid årsagen før du
kalder en kørsel flaky. Ren ops, ingen UI. **Må merges selv.**

---

## Rammer, ejer-besluttet 27/8

| | |
|---|---|
| **Workers** | 3 parallelle, hver i sin git-worktree (`pwsh -File scripts/new-worktree.ps1 -Branch <navn>`) |
| **Verifikation** | Lagdelt (#3556). Små UI-diffs: `node scripts/verify-affected.mjs` lokalt, CI bærer fuld suite. TIER FULL (backend, delte lib-hooks, i18n, config, over 6 filer) kræver fuld lokal suite. Orkestratoren ejer e2e-slottet, ingen worker kører fuld suite |
| **Merge** | **Backend og ops (C, D): merge selv efter grøn CI.** **Alt med UI (A, B): stop ved færdig PR, ejeren skal se det visuelt først** |
| **Prod** | **Ingen mutationer.** Læsning og dry-run er fint. Skal noget skrives, så forbered idempotent SQL plus før/efter-tal og vent på ejerens GO på netop det skridt |
| **Patch notes** | **Ingen worker rører `frontend/src/data/patchNotes.js.`** Aflever din patch note-tekst (EN + DA) som ren tekst i din rapport. Orkestratoren skriver alle ind i én commit til sidst. Filen brækkede fire PR'er i går (#4308) |

**Frontend `node --test` er obligatorisk før push.** Vite tilgiver extensionless imports,
Node's ESM-loader i CI gør ikke, så en manglende `.js` fejler først i CI (#803).
Kør også `npm run lint` — verify-local og vite-build kører ikke eslint, CI gør.

`pwsh -File scripts/preflight-pr.ps1` før hver push. Ét issue pr. PR, `Refs #N`, aldrig
`Closes`. PR-body efter `PULL_REQUEST_TEMPLATE` inklusive Brugerverifikation-sektionen.

**Loop-guard:** 2 CI-fejl på samme symptom, så STOP og spørg ejeren.

---

## Workflow-form

Kør det som én workflow med tre faser, ikke som løs agent-spawning.

1. **Grundlag** (parallelt, read-only, intet bygges). Pr. opgave: er det allerede besluttet,
   allerede bygget, eller ægte åbent? Hver påstand skal have `fil:linje` eller `#issue` bag sig.
   Verdict "allerede besluttet imod" er en succes, ikke en fiasko.
2. **Byg** (pipeline, worktrees). Hver builder får den låste kontrakt og "det der mangler" med
   ind, så den ikke genudleder scope.
3. **Refutér** (adversarisk, 3 linser pr. build). Verifikatorerne skal **forsøge at vise at
   ændringen er forkert**, default til refuteret ved tvivl. Én linse skal specifikt spørge
   "ruller det her en tidligere ejer-beslutning tilbage?" og læse diffen selv frem for
   agentens opsummering. En build falder ved 2 af 3 refutationer, eller ved én tilbagerulning.

**Stol aldrig på en agents egen CI-status.** Kør `gh pr checks <nr>` selv.

**Bruger du preview-serveren i en worktree,** så verificér at den serverer worktree'et og ikke
hoved-checkoutet: `curl http://localhost:<port>/__worktree-id`.

---

## Copy-regler

EN først, DA under. Dansk **med æøå**. **Ingen em-dash eller en-dash nogen steder**, heller
ikke i chat, docs og commits. Intet opfundet indhold, ingen opdigtede spillercitater, ingen
tal du ikke selv har målt. Kort tekst på UI-flader, prosa hører til i `help.json`.

Design: `docs/design/PAGE_TEMPLATES.md`. Sæsonmatrixen er **T2 wide data** (cap 1600px).
Opfind aldrig nyt sidehoved, container-bredde eller card-padding. Én gold primary-knap pr.
view, hairline borders uden skygger, 5px card-radius, tabular figures på al numerik,
stroke-ikoner fra `frontend/src/components/ui/icons/` og aldrig emoji som ikon.
`--accent-t` findes, `--danger-t` findes **ikke**. Klasserne hedder `text-cz-3`, ikke `cz-text-3`.

---

## Rør ikke

#4296, #4259, #4212 og peak-mål-undersøgelsen. En anden session har dem.
Trup-opfyldningen (#4307) er blokeret af #4311 og er ejer-gated.
