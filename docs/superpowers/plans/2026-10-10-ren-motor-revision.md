# Den rene motor-revision: byggeplan

> **For agentic workers:** Udføres som bølge via `.claude/workflows/wave.js` (orkestrator-standard, CLAUDE.md). Hvert spor er én lane, ét worktree og én PR. Trinene bruger checkbox-syntaks (`- [ ]`).

**Mål:** Alle kendte løbsmotor-fejl rettes under den slukkede revision `official_times_v3`, så den kan tændes samlet, når 7-trins-gaten er grøn.

**Arkitektur:** `official_times_v3` (fra PR #6397) er arvelinjen oven på `official_times_v2`. Hver rettelse gates på v3-revisionen via `raceEngineRulesRevision.ts`. Ældre revisioner forbliver byte-identiske (frosne digests). Ét gate-script samler trin 1-5 til ét GRØN/RØD-svar.

**Tech stack:** TypeScript-motor (`backend/lib/engine/v4`, `node --test` med strip-types), Node-bro (`backend/lib/raceEngineV4Bridge.js`), dev-scripts (`backend/scripts/dev/*.mjs`).

**Spec:** `docs/superpowers/specs/2026-10-10-ren-motor-revision-design.md` (ejer-godkendt 10/10)

## Globale krav

- Alt nyt opførsel gates på `official_times_v3`. `official_times_v2`, `orders_gc_v1/v2/v3` og legacy skal være byte-identiske: `backend/lib/engine/v4/officialTimesV2Frozen6200.test.ts` og `oldRevisionDigests6199` skal bestå uændret.
- `CURRENT_RACE_RULES_REVISION` forbliver `official_times_v2`. Intet flip og ingen migration-apply i bølgen.
- Tal og målinger må kun ligge i `balance-internals/` (privat, hard rule 17), aldrig i repoet.
- D1: bedste klatrer vinder 5-8 af 12 på en bjergetape med nedkørselsfinale; nr. 10 er 60-150 s og ikke konstant.
- D3: nedkørsel mod mål = sidste segment, eller højst 5 km uden stigning til mål.
- Udbrud uden ordre: kun `hunter` og `free_role`; `helper` aldrig uden managerens ordre; kaptajner aldrig. En eksplicit ordre vinder altid.
- Form: kun `rider_condition.form`. Intet formtop-tillæg i denne revision.
- Styrke straffes aldrig (eksisterende monotoni-tests skal bestå).
- Ingen spillertekst, hjælpetekst eller patch note i spor-PR'erne. De samles ved tænding.
- Model: motor-spor kører opus/high (håndhæves af `wave.js`).

## Review-fokus

1. **Felter med næsten kun menneskehold uden ordrer** (Hexagone-cachen). Udbrudsstørrelsen og D1 skal holde her, ikke kun i de syntetiske AI-felter. Test i spor 1 kører begge felter.
2. **Endagsløb med et passivt felt (#6428).** Et udbrud må ikke få 9-16 min på kuperet terræn. Test i spor 1 genskaber GP Criquielion-mønstret.
3. **En rytter uden `rider_condition`-række.** Form er udeladt, og motoren er neutral (byte-identisk). Test i spor 2.
4. **En kaptajn med eksplicit `try_break`.** Ordren vinder over "kaptajner aldrig", fordi det er managerens valg. Test i spor 1 (B).
5. **Enkeltstart på bjergprofil (`itt` med stor stigningsandel).** Klatring skal stadig tælle efter stigningens andel. Test i spor 3.

---

### Spor 1: Udbrud, klatring og tider (#6200 #6201 #6428 #6185)

**Branch:** `fix/6200-official-times-v3-descent-climb` (fortsætter PR #6397)

**Filer:**
- Ændres: `backend/lib/engine/v4/mechanics/climbSelection.ts`, `mechanics/timeModel.ts`, `mechanics/breakaway.ts`, `mechanics/breakawayPermission.ts`, `ai/aiTactics.ts`, `finale.ts`, `segmentLoop.ts` (kun v3-grene)
- Ændres: `backend/scripts/dev/lib/tourScorecard.mjs` (R1: trappen som bånd)
- Test: `backend/lib/engine/v4/cleanRevisionClimb.test.ts`, `mechanics/breakawaySize6201.test.ts`, `mechanics/breakawayMargin6428.test.ts`, `mechanics/breakawayDropped6185.test.ts`

**Interfaces:**
- Producerer: `isOfficialTimesV3OrLater(revision: string): boolean` i `backend/lib/raceEngineRulesRevision.ts`. Findes den allerede under et andet navn, så brug det og dokumentér navnet i PR-body. Spor 2-4 bruger samme funktion.

- [ ] **Trin 0: Genmål på main.** Kør `node backend/scripts/dev/descentFinish6200.mjs --fixture=giro --revision=official_times_v2,official_times_v3 --seeds=12 --out=balance-internals/clean-revision/s1-trin0.md` og `tourDryRun.mjs --cache=balance-internals/tour-11-10/cache.json --revision=official_times_v3 --compare=official_times_v2 --seeds=3`. Skriv i PR-body, hvilke af #6185/#6201/#6428 der stadig fejler.
- [ ] **Trin 1: D1, fejlende test.** I `cleanRevisionClimb.test.ts` køres Giro e7 under `official_times_v3` med 12 seeds. Assert: antal seeds hvor bedste klatrer vinder er `>= 5 && <= 8`. Assert: nr. 10's hul er i 60-150 s i alle seeds. Assert: antal forskellige nr.-10-huller (afrundet til 5 s) er `>= 4`. Kør, og se testen fejle (i dag 11/12 og et konstant hul).
- [ ] **Trin 2: D1, implementering.** Tilføj varians på den afgørende stigning under v3: dagsform-komponenten (`physiology.dayformComponent`) og angrebsgevinsten skal kunne vende rækkefølgen mellem nære klatrere. Kun under v3. Kør trin 1-testen til grøn, plus `officialTimesV2Frozen6200.test.ts`.
- [ ] **Trin 3: #6428, fejlende test.** `breakawayMargin6428.test.ts`: et kuperet endagsløb (genskab GP Criquielion-profilen fra prod-race 10/10 13:00 UTC via `routeFromStageProfileRow`), hvor de fleste hold ikke har jagtordre. Assert under v3: når udbruddet vinder, er nr. 10's hul ≤ båndet for udbrudssejrens margin på kuperet i `ANCHOR_BANDS` (`backend/scripts/lib/headToHeadAnchors.js`). Findes der intet bånd, tilføj det fra virkelige data med kilde i kommentar, og vis tallet i PR-body til ejeren. Kør, og se testen fejle.
- [ ] **Trin 4: #6428, implementering.** Find, hvor forspringet vokser ukontrolleret i et passivt felt (`teamChaseReaction.ts` / `rollingBreakaway.ts` / `breakaway.ts`), og ret det under v3. Testen bliver grøn, og frosne digests er uændrede.
- [ ] **Trin 5: #6201 R1-R3 + ejer-valg B.** Følg `docs/drafts/spec-6201-official-times-v3-2026-10-11.md`. R2b er afgjort: `hunter` og `free_role` uden ordre må forsøge på bjerg/kuperet/rullende; `helper` aldrig uden ordre; `captain`/`sprint_captain` aldrig uden ordre; en eksplicit ordre vinder altid. Først en fejlende test i `breakawaySize6201.test.ts`: trappen (flad 3-6, kuperet/rullende 5-9, bjerg/højfjeld 6-12) holder på Hexagone-cachen og Giro-fixturen. Plus en test pr. rolle (helper uden ordre forsøger aldrig; hunter uden ordre kan; kaptajn med `try_break` forsøger). Implementér, og få testene grønne.
- [ ] **Trin 6: #6185.** Under v3 skal en udbryder, der sættes af, have `breakaway_dropped=true` og aldrig mærkes "ikke indhentet". Udvid `breakawayDropped6185.test.ts` med en v3-case, og ret til grøn.
- [ ] **Trin 7: Fuld verifikation.** `npm --prefix backend test`, `npx tsc -p backend/tsconfig.engine.json --noEmit`, `node backend/scripts/v4FlipReadiness.mjs --rules=official_times_v3`. Opdatér PR-body med en tabel pr. seed (før/efter). Commit og push.

### Spor 2: Form uden formtoppe (#6156)

**Branch:** `fix/6156-form-official-times-v3` (fra main; genbrug koden fra PR #6305 med `git cherry-pick` eller manuel overførsel)

**Filer:**
- Ændres: `backend/lib/engine/v4/types.ts` (valgfrit `Entrant.form`), `groups.ts` (`initRiderStates`: jour sans får form; `formCpModifier`), `physiology.ts` (`formCpModifier`), `backend/lib/raceEngineV4Bridge.js` (send `rider_condition.form` under v3)
- Test: `backend/lib/engine/v4/formCleanRevision.test.ts`, `backend/lib/raceEngineV4Bridge.formCleanRevision.test.js`

**Interfaces:**
- Forbruger: `isOfficialTimesV3OrLater` fra spor 1. Merges spor 2 først, så opret funktionen her med samme signatur, og spor 1 rebaser.
- Producerer: `Entrant.form?: number` (0-100), `formCpModifier(form: number | null | undefined): number` (1.0 ved neutral og ved udeladt).

- [ ] **Trin 0:** Læs PR #6305 og spec `2026-10-04-form-og-formtoppe-i-v4-design.md` §3. Notér i PR-body, hvad der genbruges, og hvad der fjernes (toppens tillæg, `peakComponentForStage`-kaldet).
- [ ] **Trin 1: Fejlende tests.**
  (a) Broen sætter `form` = `rider_condition.form` under v3 og intet felt under v2.
  (b) To identiske ryttere, form 80 mod 40, på en bjergetape med 12 seeds: 80-rytteren ender gennemsnitligt foran.
  (c) En svag rytter med form 95 slår ikke en klart stærkere rytter med form 50 i mere end båndet fra spec §3.6. Båndet foreslås og vises ejeren.
  (d) En rytter uden `rider_condition`: ingen `form`, og stage-digest er byte-identisk med v2.
- [ ] **Trin 2:** Implementér (kun `rider_condition.form`, intet formtop-tillæg). Testene skal være grønne.
- [ ] **Trin 3:** Regressionsvagt: en test, der fejler, hvis broen igen taber `form` på vej ind i v4 under v3.
- [ ] **Trin 4:** Fuld verifikation som i spor 1, trin 7. Commit og push. PR-body: effektens størrelse som tal (privat i `balance-internals/clean-revision/form/`, kun beskrivelse i body).

### Spor 3+4: Enkeltstart, sprintertog og holdklassement (#6349 #6352 #6338)

**Branch:** `fix/6349-6352-6338-clean-revision`

**Filer:**
- Ændres: `backend/lib/engine/v4/mechanics/individualTimeTrial.ts` (#6349), `mechanics/leadout.ts` + `ai/aiTactics.ts` kun leadout-del (#6352), `backend/lib/raceClassifications.js` (#6338)
- Test: `mechanics/individualTimeTrial.test.ts`, `mechanics/leadout.test.ts`, `backend/lib/raceClassifications.test.js`

**Interfaces:**
- Forbruger: `isOfficialTimesV3OrLater`. For `raceClassifications.js`: løbets `engine_rules_revision`, så kun nye løb under v3 får den nye regel.

- [ ] **Trin 0:** Genskab hver fejl på main med en fejlende test.
- [ ] **#6349 test:** På en kuperet enkeltstart (lille stigningsandel) slår rytter A (ITT 80, klatring 60) rytter B (ITT 60, klatring 80) i ≥ 10 af 12 seeds. På en bjergenkeltstart vejer klatring efter stigningsandelen (B må vinde). Implementér under v3.
- [ ] **#6352 test:** En `sprint_captain` (eller kaptajn med sprinterprofil) i et fladt endagsløb med 3+ hjælpere får dannet et tog, og togets effekt måles (placering med/uden tog over 12 seeds). Implementér under v3.
- [ ] **#6338 test:** Holdklassementet i et etapeløb under v3 summerer tid uden bonussekunder. Under ældre revisioner er det uændret. Implementér.
- [ ] **Verifikation** som i spor 1, trin 7. Commit og push.

### Spor 5: Gate-scriptet (spec §4)

**Branch:** `feat/clean-revision-gate`

**Filer:**
- Opret: `backend/scripts/dev/cleanRevisionGate.mjs`, `backend/scripts/dev/cleanRevisionGate.test.mjs`
- Skriver til: `balance-internals/clean-revision/gate-<tid>.md` (+ `.json`)

**Interfaces:**
- CLI: `node backend/scripts/dev/cleanRevisionGate.mjs --revision=official_times_v3 --baseline=official_times_v2 --seeds=12 [--cache=balance-internals/tour-11-10/cache.json]`
- Output (JSON): `{ verdict: "GREEN"|"RED", steps: [{ id: 1..5, name, status: "PASS"|"FAIL", reasons: string[] }] }`. Exit 0 kun ved GREEN.

- [ ] **Trin 1: Fejlende test** i `cleanRevisionGate.test.mjs`: med injicerede trin-resultater giver ét FAIL `verdict: "RED"` og exit 1; alle PASS giver `GREEN`; et trin uden data giver FAIL ("ikke målt" er aldrig grønt).
- [ ] **Trin 2: Implementér** gaten som orkestrering af eksisterende værktøjer, uden ny måle-logik:
  1. `tourDryRun.mjs` (Tour-cache + `--fixture=giro`), `descentFinish6200.mjs` (D1/D3), udbrudsmålene fra RACE_ENGINE_RULES "Udbrudsmål" pr. seed.
  2. `node --test` over testfilerne fra spor 1-4 (listen står i scriptet).
  3. Ankertabellen (`headToHeadAnchors.js`) og før/efter mod `--baseline`.
  4. Monotoni-tests (find eksisterende med `grep -rl monoton backend/lib/engine/v4`).
  5. `officialTimesV2Frozen6200.test.ts` og `oldRevisionDigests6199`.
- [ ] **Trin 3:** Kør mod `official_times_v3` på main. Forventet RED (sporene er ikke merget). Rapportér hvilke trin, og commit.

## Merge-rækkefølge og efter bølgen

1. Spor 5 (kun scripts), 2. Spor 2 (opretter `isOfficialTimesV3OrLater`), 3. Spor 1 (rebase), 4. Spor 3+4. Alle via `scripts/merge-queue.ps1` som slukket revision (stående merge-regel: motor bag slukket revision, grøn CI + review).
- Herefter kører orkestratoren gaten dagligt. Rødt trin → ejeren får årsag og ny vurdering.
- Når gaten er GRØN: Fable-dommer (trin 6) → ejer-billeder pr. spor + hjælpetekst + patch note + migration til `races_engine_rules_revision_check` + `ORDERS_GC_LINEAGE` → ejerens "tænd" (trin 7) → flip-PR.
- Ved siden af (almindelige PR'er, ikke i bølgen): #6350, #6186, #5907, #2783, #6158 dry-run.
