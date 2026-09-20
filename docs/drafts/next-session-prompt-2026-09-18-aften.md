# Aftenbølge 18/9: spilleroplevelse (2 laner) + U23-kæden (2 laner), ejeren er ved computeren

> Designet sammen med ejeren 18/9 kl. ca. 19 (seks spørgsmål, ét ad gangen). Workflow-session efter orkestrator-standarden (CLAUDE.md + `docs/PARALLEL_WORKTREE_ORCHESTRATION.md`). Forrige session: `docs/audits/night-wave-2026-09-18.md`.

## Prompt (kopiér herfra)

Kør aftenbølgen 18/9. Læs `docs/NOW.md` og `docs/drafts/next-session-prompt-2026-09-18-aften.md` først. Jeg er ved computeren hele aftenen: vis mig billeder og forslag ét ad gangen, kort og i almindeligt sprog, og merge synlige ting når jeg skriver "merge".

## Ejerens valg (låst 18/9, genåbn dem ikke)

1. **Hovedmål:** blandet 2+2. To laner til det der gør ondt for spillerne nu, to laner til sæson 4-banen (cutover 27-28/9).
2. **Sæson 4-lanerne = U23-kæden:** U23-filter i senior-læserne + forberedelse af designkortet om U23-fødselsbåndet (#5376).
3. **Løbsforsinkelser (#3624):** mål til bunds + ÉT forslag → ejer-go → byg i runde 2. Intet rører live-motoren, flags eller scheduler uden ejerens ja (memory: gen-tænd aldrig race-motoren uden ejer-go).
4. **Træningssiden på mobil:** permanent mobilvenlig i ÉN omgang, bygget på det vi allerede har tænkt. Ingen små lapper.
5. **Runde 2 (når lanerne er frie):** vagt mod tekst ud over bokse (#5383) · én besked pr. løb + dashboard der hopper (#5384 #5389) · branch- og worktree-oprydning (#5391 #4924). Dobbelthop (#5382) er IKKE valgt til i aften.
6. **Hvornår:** i aften, ejeren er til stede.

## Før bølgen (orkestrator, ca. 15 min)

1. `git pull` + **`npm run sync-deps`** i hoved-checkoutet (package-lock ændret af #5354 #5355 #5370; må kun køres når ingen laner kører).
2. `pwsh -File scripts/preflight-night-wave.ps1 -SkipPrune -StartKeepAwake` → GO.
3. **Bølge 0 (ejer-krav):** én `READ-ONLY:`-agent (sonnet) tjekker for HVERT issue i scope om det allerede er lavet/delvist lavet på main, og læser issuets SENESTE kommentarer. Find issue-nummeret for "U23-filter i senior-læserne" via `docs/superpowers/specs/2026-09-15-u23-kalender-og-trup-datamodel-design.md` + MASTERPLAN bølge 4; findes der intet issue, opret ét (dublet-søg først).
4. Rester fra i dag: er #5381 (NOW.md-vagten) merget? Har Dependabot åbnet en ny frontend-PR efter #5357 blev lukket? Merge det grønne via `scripts/merge-queue.ps1`, én ad gangen.
5. Sæt 🤖 Working agent i `docs/NOW.md` (PR-titlen/commit skal starte med `docs(now)`; NOW.md-vagten bider nu på PR'er).

## Runde 1: `wave.js`, 4 spor, 4 laner, model EKSPLICIT pr. spor

| # | Issue | Spor | Type | Model/tier |
|---|---|---|---|---|
| 1 | #3624 | **Løbsforsinkelser til bunds.** Read-only mod prod (kun SELECT): planlagt vs. faktisk tidspunkt for alle etaper de sidste 14 dage, fordelt på time, division og løbstype. Find HVOR tiden går (scheduler-tick, cron-kadence, finalization, kø, Railway). Aflever én anbefalet permanent løsning med før/efter-forventning + hvad den koster. Ingen kode der rører motoren. | `kind: "investigate"` (60 min, dom: bekræftet + fix-plan) | opus / TARGETED |
| 2 | #3643 #4613 #5350 #4982 | **Mobil-design for træningssiden: 3 mockups på 412 px** (kort pr. rytter · tabel · hybrid), med ægte data-form, program 7×5 og løbsdagens intention tænkt ind fra start. Byg på det der findes (se "Materiale" nedenfor). Aflever ÉT samlet billede "i dag vs. de tre forslag" med pins + legende. INGEN produktionskode i dette spor. | build (kun `docs/design/mockups-training-mobile-2026-09-18/`) | opus / TARGETED |
| 3 | (bølge 0 finder nr.) | **U23-filter i senior-læserne** jf. spec §-henvisning fra bølge 0. Backend + tests; ingen migration uden at den er idempotent og additiv. | build | opus / FULL (bølgens eneste) |
| 4 | #5376 | **U23-fødselsbånd: 2-3 forslag kørt gennem generator-rapporten.** Udvid `backend/scripts/generatorVisibleTest5283.js` med bånd-varianter og et afsnit "mætning pr. alder pr. variant". Tallene skrives KUN til gitignoreret `balance-internals/`; PR'en indeholder script + tests uden tal. Akademiets bånd og G5-invarianten røres ikke. | build | opus / TARGETED |

**Skal stå i HVERT scopeText (læringer 18/9):**
- Skærmbilleder tages selv: start vite direkte i DIT worktree med `VITE_PREVIEW_MOCK=1` på en fri port + Playwright, 1440 og 412 px, læg PNG i `pr-screens/` og indlejr dem i PR-body med `![..](raw.githubusercontent.com/...<SHA>...)`. Dræb serveren igen.
- Nye frontend-filer er `.ts`/`.tsx` (hard rule 31).
- Kør de statiske guards lokalt før første push (`pwsh -File scripts/preflight-pr.ps1`), ikke kun lint + tests: to spor brugte 2 røde CI-runder hver i dag på netop dem.
- En frontend-test må ikke importere `backend/lib/*` der trækker `sentry.js` ind (rød i CI, grøn lokalt).
- Dansk UI-tekst med æ/ø/å. `docs/TONE_OF_VOICE.md` først. Ingen patch note i PR'en. Rør ikke `docs/NOW.md`.

## Ejer-kort mens runde 1 kører (ét ad gangen, 2-4 sætninger + billede hvor det findes)

1. **Træningsdesign kort 1-4** fra `docs/audits/2026-09-17-traeningsdesign-session-brief.html`. Beslutning 1 (tick på dato × slot) låser ugeplanens form og skal tages FØR mobil-mockuppen vælges. Den frigiver også #5264 (B4) + #5281 (B3), som skal merges sammen bagefter.
2. **Mobil-træning:** vis billedet fra spor 2. Ejeren vælger form. Spørg også: må mobil og computer vise forskelligt INDHOLD, og skal "Gruppér efter type" væk på mobil.
3. **Løbsforsinkelser:** vis fundet fra spor 1 som ét forslag med tal. Ja → byg i runde 2.
4. **U23-båndet:** vis de 2-3 varianter side om side (tal kun i chatten, aldrig på GitHub). Ejeren vælger → #5376 kan bygges, og U23-generering er ikke længere blokeret.

## Runde 2: ny `wave.js`-kørsel når runde 1's laner er frie

- **Træningssiden på mobil, bygget i én omgang** efter ejerens valg (opus, FULL): rytterliste, ugeplan 7×5, dagens valg, kvittering, status, assistentpanel; #5350 + #4982 foldet ind; landskab; touch-mål ≥ 44 px; Playwright 412 + 375 på alle tre projekter; opdatér TASTE P10 + PAGE_TEMPLATES + TRAINING_RULES §13.1. Lukker #3643 #4613 #5350 #4982 + træningsdelen af #5124.
- **Løbsforsinkelser: den valgte løsning** (kun hvis ejeren sagde ja). Bag flag hvis den rører scheduler/motor; flip er ejer-only.
- **#5383** vagt mod tekst ud over bokse (DA+EN, mobil+desktop, fejler i CI) + ret "Overget" og den ulæselige danske tekst (ejeren har skærmbilleder; bed om dem som første skridt).
- **#5384 + #5389** én besked pr. løb + dashboardet hopper ikke (sonnet, TARGETED).
- **#5391 + #4924** branch- og worktree-oprydning + rutinen der holder det nede (sonnet). Sletning af de ca. 855 mapper kræver ejerens go på listen fra `docs/audits/2026-09-18-orphan-worktrees-uge38.md`.
- **#5376** U23-båndet bygget efter ejerens valg, hvis det er afgjort.

Loft: 4 laner, én FULL ad gangen, maks 5 åbne PR'er fra bølgen, verifikations-semafor 2.

## Merge-politik (uændret)

Backend, drift, CI og docs: orkestratoren merger selv ved grøn CI + GODKENDT reviewer, via `scripts/merge-queue.ps1`, én ad gangen, done-flip PR-for-PR. Alt spillerne kan se + spilmekanik + auth: ready-PR med skærmbilleder vist til ejeren i samme tur som spørgsmålet; merge først på ordet "merge". Migrationer kører via auto-migrate.yml; post-verificér STRAKS mod prod og skriv resultatet på issuet.

## Materiale til mobil-træning (fundet 18/9, læs FØR spor 2 briefes)

- `docs/design/mockups-training-2026-09-06/` (m1 Dagens tavle, m2 Ugetavlen, m3 Truplisten, alle med `-mobile.png`; aldrig afgjort af ejeren; m4/m5 afvist 6/9).
- `docs/design/wireframes-training-2026-09-02/` (lo-fi, kun desktop).
- #4613: ejeren valgte B "trup-først" 3/9 og trak det tilbage samme aften. Retningen er ÅBEN.
- #3643 kommentar 13/8: bindende kortindhold på 390 px (fremgangsbar, "tæller for"-chips, ugens kvittering, loft som chip, tempo som hastighed og aldrig ankomsttid).
- #5124 kommentar 15/9: ejeren AFVISTE D-047-tabelformen som mobilform for netop træning og bad om en egen mobil-designsession med 2-3 mockups. Den er aldrig holdt; spor 2 ER den session.
- `docs/TRAINING_RULES.md` §13 + §13.3 (løbsdag som tick, program 7×5, sweep ≥ kl. 20, knap uden bonus).
- I dag: `frontend/src/pages/TrainingPage.jsx` (ca. 2.270 linjer) har en D-047-gren med dokumenteret afvigelse.

## Åbent hos ejeren (nævnes én gang, ikke i hver besked)

Post `docs/drafts/discord-patch-notes-2026-09-17.md` og `...-2026-09-18.md` · fair-play-session 19/9 (#5203 #5282) · klik selv fanen "Alle handler" igennem og sæt ét flag til beta for at se beta-adgang virke · tjek i PostHog at data stadig kommer ind efter SDK-skiftet (#5055) · win-back v2 (#2760, ejeren bad 18/9 også om en fast mail før sæsonskifte: #4592) · Quad9-aflæsning 19/9 (#5323) · Discord-forum-kanalerne #bugs og #feedback-and-ideas kan ikke læses af værktøjet: find en vej (tråd-id'er eller bot-rettighed).

## Close-out

Samlet patch note som egen docs-PR + Discord-udsnit genereret ordret fra `patchNotes.js` · `docs/audits/night-wave-2026-09-18-aften.md` · MASTERPLAN ✅ + NOW.md (Next action + Working agent nulstillet) · postmortem ved bugfix · `pwsh -File scripts/close-out-cleanup.ps1` · `pwsh -File scripts/check-agent-token-hygiene.ps1` · stil ejeren designspørgsmål til næste session, ét ad gangen, og skriv næste prompt.
