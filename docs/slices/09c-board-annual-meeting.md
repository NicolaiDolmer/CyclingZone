# Slice S-M2c · Årsmødet (fuldskærm) — slice-spec

**Status:** UDKAST 2/9-2026, afventer ejer-svar på spørgsmålene i §9 FØR byg. Skrevet mod mockup `docs/design/board-mandate-mockups/AnnualMeeting.dc.html` (ejer-godkendt 1/9).
**Grundlag:** [Spec 7/8](../superpowers/specs/2026-08-07-board-mandate-rework-design.md) §3.2 + §3.1 · [Addendum 1/9](../superpowers/specs/2026-09-01-board-mandate-addendum-personer-med-stemme.md) (A7, stemme-kontrakten punkt 4: `meeting_easier`/`meeting_keep`/`meeting_stretch`) · [MASTER](09-board-mandate-rework-MASTER.md) S-M2c · [PAGE_TEMPLATES](../design/PAGE_TEMPLATES.md) · [TASTE](../design/TASTE.md).
**Forudsætning (leveret 2/9):** #4586 (navne konsistente), #4579 (reel målstatus), #4578 (kvitterings-events pr. mål). Boardroom-siden (S-M2b) er live bag `board_mandate_model_enabled = beta`.

## 1. Mål

Ét fuldskærms-møde pr. sæsonskifte, hvor bestyrelsen foreslår mandatet og manageren justerer, beder om én ting og underskriver. Hurtigste vej er to klik: "Enter annual meeting" → "Sign mandate". Mødet erstatter wizarden (3 trin + kø), "Forny plan"-knappen og den sekventielle 5→3→1-onboarding for alle hold bag flaget. Nordstjerne fra MASTER: hver bevægelse har en kvittering, forhandling er en dialog med modtilbud, alt kan nås på ≤2 klik.

## 2. Runtime-evidens (læst 2/9)

- `backend/lib/boardMandate.js`: tillids-trappe (`TRUST_LADDER`, `adjustmentsAllowedFor`, `counterofferGenerosityFor`), `MANDATE_MIN_GOALS`/`MAX_GOALS` = 3/5, `planToMandate` (kun migration i dag).
- `backend/lib/boardMandateEngine.js::allocateNegotiationPower` (ren, "wires ind i årsmøde-API'et", ikke kaldt endnu).
- `backend/lib/boardGoals.js`: `generateBoardGoals({ focus, planType, team, riders, standing, assignedMembers })` (stempler `owner_archetype_key`), `buildNegotiatedGoal` (= "Easier": lempet target, halv straf), `finalizeBoardGoals`, `buildBoardProposal` (returnerer `goals` + `negotiation_options`). **Der findes ingen "Stretch"-variant i dag** (#1235 foldet ind i spec §3.2: stretch = større bonus OG større straf).
- `backend/lib/boardRequests.js`: 4 anmodnings-typer (`lower_results_pressure`, `more_youth_focus`, `more_results_focus`, `ease_identity_requirements`), `resolveBoardRequest` (afgørelse + tradeoff-payload), `buildBoardRequestOptions`, i18n `requestDefs.*`. Afslag uden modtilbud er muligt i dag (spec kræver: afslag ALTID med modtilbud).
- `backend/lib/boardAutoAccept.js`: kalenderdags-ur pr. plan (5 dage; aktive spillere 10, `ACTIVE_PLAYER_LAST_SEEN_DAYS` 14), læser `board_profiles.negotiation_status = 'pending'`. Kender ikke `board_mandates`.
- `backend/lib/economyEngine.js::processTeamSeasonEnd` (ca. l. 1780-1800): udløbet plan → `board_profiles.negotiation_status = 'pending'`, plan-vinduet rykkes. `applySeasonEndSync` (mandat-skyggen) kaldes efter loopet. Der oprettes IKKE et nyt mandat til næste sæson (`seasonCarryOver.js` l. 120: bevidst, "mandatet forhandles forfra på årsmødet").
- `board_mandates`-kolonner: `status`, `focus`, `goals`, `adjustments_allowed/used`, `request_used`, `extraordinary_request_unlocked/used`, `proposed_at`, `signed_at`, `auto_accept_deadline`, `source`. Status-værdier i brug: kun `active` (237 rækker). `proposed_at`/`auto_accept_deadline` er tomme.
- `backend/lib/boardVoice.js`: `meeting_easier`/`meeting_keep`/`meeting_stretch`-buckets findes med 4+ varianter × 9 arketyper, EN+DA (27 nøgler pr. sprog i `board.json`).
- Frontend: `/board` → `BoardroomRoute.jsx` (flag) → `BoardroomPage.jsx` (T1). Mockup `Main.dc.html` har gold-CTA "Enter annual meeting" i headeren (spec §3.4 punkt 1: KUN når årsmødet er klart). Legacy wizard: `SetupWizardModal.jsx` + `BoardPage.jsx` (`onRenew`, `boardWizardNav.js`).
- Prod 2/9: 237 aktive mandater, 60 med 4 mål og 177 med 5 mål; mål-nøgle uden id (indholdsbaseret nøgle fra #4578).

## 3. Invarianter der beskyttes

- **Ét mandat pr. hold pr. sæson** i status `proposed`/`active` (DB: unik partial index på `(team_id, season_id) where status in ('proposed','active')`).
- **Justeringer er optjent:** `adjustments_used <= adjustments_allowed`, låst ved mødets START (`allocateNegotiationPower`, frosset i `source.negotiation_power`).
- **Én anmodning pr. møde** (`request_used`), ekstraordinær samtale rører ikke mødets anmodning.
- **Ingen genforhandling af et aktivt mandat** (A8/#4553-låsen består; mødet findes kun mens status = `proposed`).
- **Sæson 1 = baseline:** første årsmøde ved S1→S2 (uændret regel). Nye hold i S2+ får deres første møde ved dannelse (spec §3.2, lukker #2022 "stykke B").
- **Kill-switch = rollback:** alt bag `board_mandate_model_enabled`; ved `off` sker intet nyt, legacy-flowet kører uændret. Dual-write (se §4.6) sikrer at legacy-motoren aldrig står uden 1yr-plan.
- Eksisterende tests i `boardMandate*.test.js`, `boardRequests.test.js`, `boardAutoAccept.test.js`, `boardRoom.test.js` forbliver grønne.

## 4. Design (minimal change)

### 4.1 Livscyklus for et mandat

`proposed` → (`sign` | auto-accept) → `active` → sæson-slut → `completed` (eller `lapsed` hvis aldrig underskrevet og auto-accept ikke nåede det, kun teoretisk).

1. **Sæson-slut** (`processTeamSeasonEnd`, efter `applySeasonEndSync`): det aktive mandat sættes `completed` (kvittering `season_end` skrives allerede). Derefter oprettes NÆSTE sæsons mandat i status `proposed` med `proposed_at = now`, `auto_accept_deadline` = `proposed_at + N dage` (N fra `resolveThresholds`: 5 / 10 for aktive spillere, samme regler som i dag), `focus` = forrige mandats fokus (forslag), `goals` = `generateBoardGoals({ focus, planType: "1yr", assignedMembers })` (3-5 mål, ejere stemplet), `source = { method: "annual_meeting", negotiation_power: allocateNegotiationPower(confidence) }`. Ny modul-funktion `proposeNextMandate` i `boardMandateEngine.js` (flag-gated som de andre indgange).
2. **Nye hold** (S2+, ved `dna-choose`/holddannelse under flaget): samme `proposeNextMandate` med `confidence` = relationens start (50).
3. **Auto-accept:** ny cron-gren `processMandateAutoAcceptCron` (eget modul `boardMandateAutoAccept.js`, genbruger `resolveThresholds` + notifikations-kadence T-3/T-1 fra `boardAutoAccept.js`): `proposed` mandater forbi deadline → `signMandate` med "Keep" på alle mål og ingen anmodning; kvittering `mandate.auto_signed` i formandens stemme.

### 4.2 Forslag + modtilbud (trin 2 "Mandate")

Pr. mål tre valg: **Easier / Keep / Stretch** (mockup: pille-knapper, valgt = navy).

- **Keep** = forslaget uændret.
- **Easier** = `buildNegotiatedGoal` (findes): lempet target, `satisfaction_penalty × 0,5`. Mål uden reel lempelse (`null`) viser knappen deaktiveret med forklaring (aldrig et dødt klik, #3012-klassen).
- **Stretch** = ny `buildStretchGoal(goal, { generosity })` i `boardGoals.js`: target strammes ét trin den modsatte vej af `relaxGoalTarget` (spejlfunktion `stretchGoalTarget` pr. type; binære mål som `no_outstanding_debt` kan ikke strækkes → knap deaktiveret), `satisfaction_bonus × 1,5` og `satisfaction_penalty × 1,5`, afrundet, `stretch: true`. `generosity` (0,80/1,00/1,25 fra tillids-trappen) skalerer BONUS-delen (ikke straffen), så en betroet manager får mere ud af at strække sig. Mockup-teksten "Reward +9 confidence · miss -5 · was 2 debuts" = disse tal.
- **Justerings-budget:** Easier og Stretch koster hver 1 justering; Keep koster 0. Skift tilbage til Keep frigiver justeringen. UI viser "1 of 2 adjustments used" (mockup). Serveren håndhæver (`adjustments_used <= allowed`), ellers 409.
- **Medlemsreaktion inline** (mockup: "Three debuts. Now you are speaking my language." · Astrid Holm backs the stretch): ved valg af Easier/Stretch vises målets EJERS linje fra `sampleVoiceLine({ beat: meeting_<valg>, archetypeKey: owner, seed: `${mandateId}:${goalKey}:${valg}`, context: { teamId, dnaKey, members } })`. Keep viser ingen linje (mockup viser kun reaktion på afvigelser). Reaktioner leveres af backend i `GET /board/meeting` (alle tre pr. mål, forudberegnet, så frontend ikke kalder pr. klik).

### 4.3 Én anmodning (trin 3 "Request")

Genbruger de 4 typer + `resolveBoardRequest` uændret som afgørelses-motor, men:
- Afgørelsen vises som **modtilbud, aldrig et rent nej** (spec §3.2): et afslag pakkes som `{ decision: "counter", counter: <tradeoff-payload eller lempet version> }`; motoren afgør, mødet præsenterer. Konkret: afslag → bestyrelsen tilbyder samme anmodning MED tradeoff (`TRADEOFF_PAYLOADS_BY_REQUEST`) eller, hvor ingen tradeoff findes, "godkendt fra næste sæson" (deferred). Manageren kan tage modtilbuddet eller droppe anmodningen.
- Anmodningen vælges fra en liste (mockup: kort med "Change request"), default = ingen. `request_used` sættes ved underskrift.
- Mid-season ekstraordinær samtale (låst op af check-in'et) er en SEPARAT flade (S-M2c-rest eller S-M2d), ikke en del af mødet; mødet rører ikke `extraordinary_request_*`.

### 4.4 Vision-slot (A7)

Hvis `board_vision_milestones` har `slot_open = true` for holdet, får mødet et ekstra kort mellem trin 2 og 3: "The board proposes a new milestone" med ÉT forslag (`generateBoardGoals` for planType `3yr`/`5yr` matchende det tomme slots `origin`, target-sæson = slottets oprindelige sæson eller den næste ledige), Accept/Decline. Accept opretter milepælen (status `pending`) og sætter `slot_open = false`; Decline sætter kun `slot_open = false` (slottet forbliver tomt til næste møde, bevidst).

### 4.5 Underskrift + kvittering (trin 4 "Sign")

`POST /board/meeting/sign` med hele valget i ét kald (idempotent på `mandate.id` + status `proposed`):
`{ focus, adjustments: [{ goalKey, choice: "easier"|"keep"|"stretch" }], request: { type } | null, visionSlot: { accept: bool } | null }`.
Serveren: validerer justerings-budget, bygger de endelige mål (`finalizeMandateGoals`), afgør anmodningen, skriver mandatet `active` (`signed_at`, `adjustments_used`, `request_used`), skriver kvittering `mandate.signed` (formandens `meeting_keep`-linje som beat) + evt. `request.*`-kvittering, og udfører dual-write (§4.6). Svar = den nye Boardroom-payload, så siden kan skifte uden ekstra kald.

### 4.6 Dual-write til legacy (indtil BoardPage pensioneres)

Weekend-, sæson-slut- og konsekvens-motoren evaluerer stadig `board_profiles` (1yr). Ved underskrift skrives derfor OGSÅ `board_profiles` 1yr-rækken som `/board/sign` gør i dag (`current_goals` = mandatets mål, `negotiation_status = completed`, plan-vindue = sæsonen), så motoren og kvitterings-events (goal_states, #4578) fortsætter uændret. Fjernes i S-M2d-flippets oprydning når `BoardPage.jsx` slettes (spec §3.6). 3yr/5yr-planer røres ikke (de er visionen nu).

### 4.7 Frontend (per mockup, T1-header + fuldskærms-bånd)

- Rute `/board/meeting` (lazy, `board`-ns). Adgang: kun når `GET /board/meeting` svarer `{ available: true }`; ellers redirect til `/board`.
- Layout: navy bånd (titel "ANNUAL MEETING · SEASON N" i Bebas, undertitel, højre: "Confidence X · Y adjustments available" + "Unanswered mandates sign automatically in N days"), trin-strip 1 Focus / 2 Mandate / 3 Request / 4 Sign, 896px indholdsspor, kort med hairline-borders, 5px radius, pille-knapper til Easier/Keep/Stretch, én gold-knap ("Sign mandate") i footeren, "Back" sekundær. Fokus-trinnet = samme fokus-valg som legacy (eksisterende `focus.*`-i18n), default forvalgt så trin 1 kan springes over.
- Boardroom-header: gold-CTA "Enter annual meeting" vises KUN når `available` (ellers ingen knap, ikke en deaktiveret).
- Mobil (S-M2d): stakkes, lodrette modtilbud, fuld-bredde gold-CTA — kun forberedt her (ingen mobil-tuning i denne slice, men ingen fast bredde i markup).
- i18n: nye nøgler under `boardroom.meeting.*` (EN først, DA under), reaktioner via eksisterende `archetypes.*.reactions.meeting_*`.
- Ingen emoji, ingen skygger, tabular figures på tal (TASTE-tjeklisten).

### 4.8 API

- `GET /board/meeting` → `{ available, mandate: { id, seasonNumber, focus, deadlineAt, adjustments: { allowed, used }, trustTier, goals: [{ goalKey, ...rå felter, owner, options: { easier: {target,label,bonus,penalty}|null, keep: {...}, stretch: {...}|null }, reactions: { easier: {textKey, memberName}, stretch: {...} } }] }, request: { options: [...] }, visionSlot: {...}|null }`.
- `POST /board/meeting/focus` `{ focus }` → regenererer forslaget (ny mål-liste, nulstiller valg). Rate-limited som `boardWriteLimiter`.
- `POST /board/meeting/sign` (§4.5).
- Alle tre bag flag + `requireAuth` + manager-hold-tjek som `/board/room`.

### 4.8a Backend-leveret 3/9 (#4557 a+b) — kontrakt-afvigelser fra §4.8

Bygget i `backend/lib/boardMandateEngine.js` (livscyklus), `boardMandate.js`
(`buildStretchGoal`/`buildMandateGoalOptions`/`finalizeMandateGoals`),
`boardMandateMeeting.js` (API-aggregering + `signMandate`),
`boardMandateAutoAccept.js` (cron). Frontend-sporet bygger mod DENNE version:

- `GET /board/meeting` flag off → `{ available: false }` (samme konvention
  som `GET /board/room`s `{ enabled: false }`), IKKE 404 — 404 er kun for de
  to POST-endpoints.
- `mandate.goals[]`: hvert element er mål-objektet UDVIDET med `goalKey`
  (`boardGoals.js::buildGoalKey`, indholdsbaseret, ikke et id — samme mønster
  som Boardroom), `owner: { archetypeKey, name, initials } | null`,
  `options: { easier, keep, stretch }` (hver `{ target, label,
  satisfaction_bonus, satisfaction_penalty } | null`), og `reactions: {
  easier, stretch }` (hver `{ textKey, textFallback, memberName } | null`).
  `reactions.keep` findes ALDRIG (spec §4.2: "Keep viser ingen linje").
- `request.options`: bruger `buildBoardRequestOptions` uændret (samme form
  som `/board/status`); tomt array når `mandate.request_used` er sandt.
- `visionSlot`: `{ replaces_milestone_id, origin, goal, target_season_number,
  milestone_key } | null` — regenereret DETERMINISTISK ved hvert GET (ikke
  persisteret før accept), se `boardMandateMeeting.js`'s modul-header for
  begrundelsen.
- `POST /board/meeting/sign` **afviger fra §4.5's ordlyd**: svaret er
  Boardroom-payloaden (`buildBoardRoomPayload`, samme form som `GET
  /board/room`) UDVIDET med `request_outcome` (se næste punkt) og
  `vision_slot_outcome: { accepted: bool, milestone_key? } | null` — ikke en
  rå kopi af mandatet. Idempotent på `mandate.id` + status `proposed`: et
  andet kald mod et allerede-`active` mandat skriver INTET og returnerer
  bare den friske payload igen (retry-sikkert).
- Afslags-modtilbuddet (§4.3) er `request_outcome.meeting_outcome:
  "approved"|"partial"|"tradeoff"|"counter"` — ALDRIG `"rejected"`. Ved
  `"counter"` følger `counter_kind: "tradeoff"|"deferred"` (+
  `counter_tradeoff_payload` ved `"tradeoff"`). De eksisterende
  satisfaction/overallScore-gates i `resolveBoardRequest` omgås ALDRIG for
  kunstigt at tvinge et "approved" frem — se `resolveMeetingRequestOutcome`s
  modul-kommentar for fuld begrundelse.
- Justerings-budgettet (409 ved brud) returnerer `{ error, errorCode:
  "board_mandate_adjustment_budget_exceeded", used, allowed }`.
- **`proposeNextMandate` skriver KUN når målsæsonens `seasons`-række allerede
  findes** (kalenderen skal være materialiseret så langt frem) — ingen
  gættet `season_id`. Rammer kalenderen ikke langt nok frem, springes holdet
  over (`{ skipped: "target_season_not_found" }`, logget, ingen fejl) og
  fanges op ved NÆSTE sæson-slut-kørsel eller manuel efterkørsel. Dette er en
  bevidst afvigelse fra en ellers underforstået "skriver altid" — se
  `database/2026-09-03-4557-board-mandates-proposed.sql`s header for hvorfor
  den eksisterende (ikke-partial) unique-indeks gør dette sikkert.
- `negotiation_power` (tillids-trappen, frosset ved forhandlingens start)
  ligger i `board_mandates.source.negotiation_power` — IKKE en separat
  kolonne (§4.9's "vælg ved byg" er afgjort til fordel for `source`).

### 4.9 Migration `database/2026-09-03-4557-board-mandates-proposed.sql`

**Bygget 3/9, mindre end §4.9 lagde op til — verificeret mod den faktiske 18/8-migration i stedet for antaget:** `status`-check-constrainten
(`database/2026-08-18-3514-mandate-model.sql`) omfattede ALLEREDE `draft`/`proposed`/`active`/`completed`/`lapsed` — ingen ALTER nødvendig. Den eksisterende `uq_board_mandates_team_season`-indeks (IKKE partial, på `(team_id, season_id)`) er STRENGERE end den bedte partial-indeks og forbliver korrekt, fordi `proposeNextMandate` aldrig skriver et `NULL season_id` (se §4.8a) — en ny partial-indeks ville kun have lempet beskyttelsen. `negotiation_power` ligger i den eksisterende `source jsonb`-kolonne. Det eneste denne migration reelt tilføjer er et understøttende index (`idx_board_mandates_team_status`) til `GET /board/meeting`s opslag. Ingen backfill; de 237 aktive mandater fortsætter til sæson-slut 27/9, hvor det første rigtige årsmøde (S3→S4) opstår automatisk.

## 5. Verifikationssti

1. Unit: `buildStretchGoal` pr. mål-type (spejl af `relaxGoalTarget`, binære typer → null), justerings-budget (allowed/used, 409), `proposeNextMandate` (3-5 mål, ejere stemplet, deadline pr. tærskelsæt), `signMandate` (idempotent, dual-write, kvitteringer), modtilbud-garantien (ingen ren afvisning), A7-slot accept/decline, auto-accept (Keep på alt, ingen anmodning).
2. Route-tests (fake-supabase) for de tre endpoints inkl. flag off → 404/`{available:false}`.
3. Playwright (desktop + mobile chromium + webkit i CI): 2-klik-stien, Stretch med reaktion, anmodning med modtilbud, deadline-tekst, ingen døde klik (`board-*.spec.js`-mønsteret, preview-mock).
4. Prod-tørkørsel FØR flip: `proposeNextMandate` dry-run mod alle 237 hold (scorecard: mål-antal, ejere, deadline) vist ejeren LIVE; ingen skrivning før go.
5. Ejer-visuelt go på screenshots (desktop + Android-mobil) FØR merge (UI-PR-reglen).

## 6. Out of scope

Ekstraordinær samtale-fladen (mid-season), formandsskifte-beats, sponsor-siden (#4265, S-M2d), pensionering af `BoardPage.jsx`/wizard (flip-oprydning), notifikations-/DM-copy og patch note/help (S-M2d), mobil-finpudsning (S-M2d).

## 7. Risiko + mitigation

- **Stretch-tal føles vilkårlige** → ét sted (`buildStretchGoal`), vist som "Reward +X · miss -Y · was Z" på hver række, testet pr. type.
- **Dual-write drifter** → én funktion `writeLegacyOneYearBoard` genbrugt af sign + auto-accept; test asserter at `board_profiles.current_goals` == mandatets mål.
- **Auto-accept for ivrig ved S3→S4** → samme tærskler som i dag (5/10 dage), T-3/T-1-varsler, og ejeren ser tørkørslen.
- **To klik bliver fem** → e2e-test der tæller klik på den hurtigste vej.

## 8. Estimat

3 worker-PR'er: (a) backend livscyklus + stretch + migration, (b) API + auto-accept, (c) frontend-mødet. Parallelt (a)+(c) mod en frosset API-kontrakt; (b) efter (a). Ejer-visuelt go efter (c).

## 9. Spørgsmål til ejeren (besvaret 2/9 kl. 20:05, vist visuelt som mockups)

| # | Spørgsmål | A (anbefalet) | B | Svar |
|---|---|---|---|---|
| 1 | Stretch-regnestykket | Target ét trin hårdere (spejl af Easier), bonus OG straf × 1,5; tillids-trappen skalerer kun bonussen | Bonus × 2, straf × 1,5 (mere gulerod, samme pisk) | **A** |
| 2 | Anmodningen på mødet | De 4 eksisterende typer genbruges 1:1 (ingen nyt indhold i slicen) | Ny, kortere liste skrevet til mødet | **A** |
| 3 | Auto-accept-frist for et foreslået mandat | 5 dage / 10 for aktive spillere (som i dag) | Fast 7 dage for alle | **A** |
| 4 | Fokus-skift på mødet | Frit (mødet ER genforhandlingen; major-pivot-låsen udgår) | Behold major-pivot-låsen fra request-flowet | **A** |
| 5 | A7: erstatnings-milepæl i et tomt slot | Bestyrelsen foreslår ÉN, Accept/Decline | Manageren vælger mellem 2 forslag | **A** |

Status efter svar: **KLAR TIL BYG** (natbølge 2/9-3/9): (a) backend livscyklus + `buildStretchGoal` + migration, (b) API + auto-accept, (c) frontend `/board/meeting` som draft med screenshots desktop + Android. Prod-tørkørsel af `proposeNextMandate` mod alle hold vises ejeren FØR flip.
