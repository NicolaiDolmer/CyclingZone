# Undersoegelse af #8549: tændingstekster for dagens fire tændinger

Dato: 26/11 2026. Spor: undersoegelse (kind: investigate, #5220). Der er ikke ændret kode, `help.json` eller `patchNotes.js`. Alt herunder er UDKAST.

Regler fulgt: `docs/TONE_OF_VOICE.md` (jeg/I, aldrig vi, EN først, DA under, ingen em-dash, ingen forkortelser, korte noter). Forkortelser som "RD"/"LD", som UI'et selv bruger i "Locked pass moved from RD n", er bevidst skrevet ud som "race day" / "løbsdag" i teksterne.

## Dom i korte træk

Teksterne er skrevet og hører hjemme ét sted pr. flag (se tabellen). Undersøgelsen bekræftede tre konkrete huller, som skal lukkes sammen med tændingerne:

1. **Nedkørsels-loftet (`descent_regroup_cap_7644`) har ingen start-stempel i koden.** Kontakten læses ved hver etapeafvikling (`raceRunner.js` r. 352, ingen `bind...`-funktion i `raceStartStamp.js`). Et igangværende etapeløb skifter altså regler midt i løbet, når kontakten tændes. Tænd-kortet fra 7/11 ("gælder kun løb der starter efter tændingen") er forkert på det punkt, som Fable-dommen 14/11 også fandt. Patch note og Hjælp må ikke love noget om "nye løb", før stemplet er bygget.
2. **Reglen rammer bredere end "lange nedkørsler".** `descentRegroup6486Applies` (`descentRegroup6486.ts`) gælder alle bjerg- og højfjeldsetaper uden topmål, på alle segmenter efter sidste stigning (nedkørsel, flad, rullende). Dronningeetape-justeringen (#7236) har intet loft, men udkastet fra 7/11 ("Short queen stages are unchanged", "13 km") lover mere end koden. Teksterne herunder siger "efter sidste stigning på etaper uden topmål" og lover intet om korte etaper.
3. **Academy-siden (udgave A) har kun Hjælp for aldersfokus.** Den nye side har overblik, fire faner, kun egen avl i Dine talenter og et regnskab. Kun `faq.academyAgeFocusFaq` findes (gated på `academy_page_v2_8081`). De øvrige ændringer har ingen Hjælp-tekst. Rotation og Ugeblokke har allerede tekst i `sections.dailytraining.programs.steps` (index 5 til 7) og beta-patchnotes (7.506), men trinnene siger "when ... is available", som skal rettes, når de er tændt for alle.

## Oversigt: hvad hører hvor

| Flag | Tændes | Patch note (`patchNotes.js`) | Hjælp (`help.json`, alle sprog) |
|---|---|---|---|
| `training_rotation` | beta til alle | ny post, `rollout: "beta_to_live"`, `flag: "training_rotation"`, topic Training, area training, refs 8548 og 7456 | `sections.dailytraining.programs.steps.5` og `.6` omskrives (fjern "When Rotation is available") |
| `training_week_priority` | beta til alle (ejer 23/11: beta to dage, derefter on) | ny post, `rollout: "beta_to_live"`, `flag: "training_week_priority"`, topic Training, area training, refs 8549 og 7456 | `sections.dailytraining.programs.steps.7` omskrives; nyt FAQ-svar `faq.weekBlocksLockFaq` |
| `academy_page_v2_8081` | ny side for alle | ny post, `rollout: "switched_on"`, `flag: "academy_page_v2_8081"`, topic Academy, area academy, refs 8081, 6944, 8060 | nyt afsnit `sections.academy.pageOverview`, nyt FAQ `faq.academyLedgerFaq`; `faq.academyAgeFocusFaq` er allerede gated |
| `descent_regroup_cap_7644` | slukket i dag, tænding er ejer-only | ny post, `rollout: "switched_on"`, topic Races, refs 7644 | sidste sætning i `faq.raceRouteRealismFaq.a` |

Gating: alle tre akademi- og træningsflag er spiller-synlige (`featureFlagsApi`), så `helpFlagGates.js` kan gate deres nye tekster (`HELP_BLOCK_FLAGS.academy` for afsnittet, `HELP_FAQ_FLAGS` for FAQ'erne, `{ flag, when: true }` som `academyAgeFocusFaq`). Når flagene er tændt for alle, kan gaten fjernes i en senere oprydning. Nedkørsels-loftet er en motor-kontakt uden spillersynlig flag, så dets Hjælp-sætning kan ikke gates og skal lægges ind i samme PR som tændingen (som #7644-undersøgelsen allerede siger).

---

## 1. `training_rotation` (beta til alle, #8548)

Hvad spilleren oplever: under Program vælger spilleren Plantype "Rotation". Passene stilles i en rækkefølge (2 til 35 pas), hver rytter står på sin plads, og pladsen rykker kun, når passet blev kørt. Løb, skade, bundet hviledag og hvile fra træthedsgrænsen venter. Spring til pas og Start fra pas 1 flytter pladsen. Samme længde ved kopiering beholder hver rytters plads. Rytterens egen rotation vinder over gruppens ugeblokke. Pladsen fortsætter over sæsonskift.

**Patch note (udkast)**

- EN title: Training rotation is on for everyone
- EN body: Put your training passes in order and each rider works through them one by one. The rotation waits during races, injury and rest from the fatigue limit, so no pass is lost. Find it in Program under Plan type.
- DA title: Træningsrotation er tændt for alle
- DA body: Sæt dine træningspas i rækkefølge, og hver rytter tager dem et ad gangen. Rotationen venter ved løb, skade og hvile fra træthedsgrænsen, så intet pas går tabt. Du finder den under Program ved Plantype.

**Hjælp: `sections.dailytraining.programs.steps.5`**

- EN: In Program, set Plan type to Rotation and put the passes in the order you want them to run. A race, an injury or rest from the fatigue limit pauses the sequence. If the same pass runs on Light, the rotation moves on.
- DA: Under Program sætter du Plantype til Rotation og stiller passene i den rækkefølge, de skal køres. Et løb, en skade eller hvile fra træthedsgrænsen sætter rotationen på pause. Kører samme pas på Let, fortsætter rotationen.

**Hjælp: `sections.dailytraining.programs.steps.6`** (uændret i indhold; kun en note: teksten er allerede korrekt og kræver ingen "available"-formulering, den står i dag uden hedge)

Bemærk: en rytters egen rotation vinder over gruppens ugeblokke. Det står allerede i UI'et ("A rider's own plan wins over the group's"), men ikke i Hjælp. Forslag til tilføjelse sidst i trin 6:

- EN: A rider's own rotation wins over the group's week blocks.
- DA: En rytters egen rotation vinder over gruppens ugeblokke.

---

## 2. `training_week_priority` (Ugeblokke med prioritet og låst pas, #8549)

Hvad spilleren oplever: under Program, Plantype "Ugeblokke" (kun planer gemt i den nye Program-fane får reglen; gamle felt-planer er uændrede). For hver dag sætter spilleren dagens pas i prioriteret rækkefølge og kan låse ét pas. Løb ligger i deres faste felter og tager laveste prioritet; et pas, et løb tager, indhentes ikke og vises under "Races took". Et låst pas bliver i sit hjemmefelt. Ligger et løb i feltet, flytter det til nærmeste ledige felt (ved lige afstand det senere). Et felt uden etape mellem to etaper træner normalt. Ligger det låste pas i et felt, hvor rytteren stadig er skadet, og skaden udløber senere samme dag, flytter passet til dagens første raske felt og ugen viser "Locked pass moved from race day n". Passet køres aldrig to gange. Træthedsgrænsen vinder over låsen. Dagens felter låses efter Træn nu, og en gemt plan gælder så fra i morgen.

**Patch note (udkast)**

- EN title: Training priorities and a locked pass are on for everyone
- EN body: In Week blocks you order each day's passes by priority and lock one pass. Races take the lowest priority, and Races took shows what the rider missed. A locked pass moves to the nearest free field if a race is in its way, and it never runs twice.
- DA title: Træningsprioritet og låst pas er tændt for alle
- DA body: I Ugeblokke sætter du dagens pas i prioritetsrækkefølge og låser ét pas. Løb tager laveste prioritet, og Løb tog viser, hvad rytteren gik glip af. Et låst pas flytter til nærmeste ledige felt, hvis et løb står i vejen, og det køres aldrig to gange.

**Hjælp: `sections.dailytraining.programs.steps.7`**

- EN: In Program, set Plan type to Week blocks. Order each day's passes by priority and lock one pass that day. Races take the lowest priority, and Races took lists the passes that did not fit. A locked pass stays in its own field. If a race is there, it moves to the nearest free field.
- DA: Under Program sætter du Plantype til Ugeblokke. Sæt dagens pas i prioritetsrækkefølge, og lås ét pas den dag. Løb tager laveste prioritet, og Løb tog viser de pas, der ikke blev plads til. Et låst pas bliver i sit eget felt. Står et løb dér, flytter det til nærmeste ledige felt.

**Nyt FAQ: `faq.weekBlocksLockFaq` (gated på `training_week_priority`, `when: true`)**

- EN q: What happens to a locked pass when a race or an injury is in the way?
- EN a: A race always runs in its fixed fields, so the locked pass moves to the nearest free field that day, and to the later one if two are equally close. If the rider is injured in that field but fit again later the same day, the pass moves to the first fit field and the week shows where it came from. A pass a race took is not made up, and a pass never runs twice. The fatigue limit still wins over the lock.
- DA q: Hvad sker der med et låst pas, når et løb eller en skade står i vejen?
- DA a: Et løb køres altid i sine faste felter, så det låste pas flytter til nærmeste ledige felt den dag, og til det senere felt, hvis to ligger lige tæt. Er rytteren skadet i feltet, men rask senere samme dag, flytter passet til det første raske felt, og ugen viser, hvor det kom fra. Et pas, som et løb tog, indhentes ikke, og et pas køres aldrig to gange. Træthedsgrænsen vinder stadig over låsen.

---

## 3. `academy_page_v2_8081` (akademisiden udgave A, #8081, #6944, #8060)

Hvad spilleren oplever: akademisiden får et overblik med nøgletal (Optag, Juniortrup, U23-trup, Talenter, Aldersfokus) og fire faner: Ugens optag, Dine talenter, Akademi-regnskab, Profil og alder. Dine talenter viser kun egen avl (ryttere med et signeret akademitilbud fra holdets eget akademi, i én tabel med ryttertype); ungdomsauktion, transfer og ukendt oprindelse vises ikke, mens trupgrænserne stadig tæller hele truppen. Aldersfokus (Blandet eller 16 til 19) er åbent fra første profilniveau og virker efter fjorten dage. Regnskabet er pr. sæson, og udgifter og salg tæller de samme ryttere: alle hentet fra et akademitilbud eller vundet på ungdomsauktion, udgifter med minus. Kolonnen "Kom via" er fjernet efter ejerens valg. Ingen tal i teksterne (hard rule 17).

**Patch note (udkast)**

- EN title: A new Academy page
- EN body: The Academy now has an overview and four tabs: This week's intake, Your talents, Academy ledger, and Profile and age. Your talents shows the riders you brought in yourself. The ledger counts costs and sales for the same riders, season by season, and you can set an age focus for your weekly intake.
- DA title: Ny akademiside
- DA body: Akademiet har nu et overblik og fire faner: Ugens optag, Dine talenter, Akademi-regnskab samt Profil og alder. Dine talenter viser de ryttere, du selv har hentet ind. Regnskabet tæller udgifter og salg for de samme ryttere, sæson for sæson, og du kan vælge aldersfokus til ugens optag.

**Hjælp: nyt afsnit `sections.academy.pageOverview`** (gate `HELP_BLOCK_FLAGS.academy.pageOverview = { flag: "academy_page_v2_8081", when: true }`)

- EN title: The Academy page
- EN text: The Academy page opens with an overview of this week's intake, your junior and U23 squads, your talents and your age focus. Below it are four tabs. This week's intake is where you bring in and sign candidates. Your talents lists the riders you signed from your own academy offers, with their rider type. Riders from youth auctions and transfers are not in that list, but they still count towards the squad limits. The Academy ledger and the Profile and age tab are described in their own answers.
- DA title: Akademisiden
- DA text: Akademisiden åbner med et overblik over ugens optag, dine junior- og U23-trupper, dine talenter og dit aldersfokus. Under det ligger fire faner. Ugens optag er der, hvor du henter og signerer kandidater. Dine talenter viser de ryttere, du har signeret fra dit eget akademis tilbud, med deres ryttertype. Ryttere fra ungdomsauktioner og transfers står ikke på den liste, men de tæller stadig med i trupgrænserne. Akademi-regnskabet og fanen Profil og alder har deres egne svar.

**Nyt FAQ: `faq.academyLedgerFaq`** (gate `HELP_FAQ_FLAGS.academyLedgerFaq = { flag: "academy_page_v2_8081", when: true }`)

- EN q: What does the Academy ledger count?
- EN a: The ledger shows one season at a time. Costs and sales count the same riders: everyone you signed from an academy offer or won at a youth auction. Costs are shown with a minus, and running costs are a line of their own. Sales list each rider you sold, where he came from and whether he went through an auction or a transfer.
- DA q: Hvad tæller Akademi-regnskabet?
- DA a: Regnskabet viser én sæson ad gangen. Udgifter og salg tæller de samme ryttere: alle, du har hentet fra et akademitilbud eller vundet på en ungdomsauktion. Udgifter står med minus, og driftsudgifter har deres egen linje. Salg viser hver rytter, du har solgt, hvor han kom fra, og om han gik via auktion eller transfer.

`faq.academyAgeFocusFaq` er allerede skrevet og gated. Eneste anbefaling: tilføj "Open from the first profile level" / "Åbent fra første profilniveau" som første sætning i svaret, da det er ejerens valg 16/11 og i dag ikke står i teksten.

---

## 4. `descent_regroup_cap_7644` (loft på samlingens gevinst efter sidste stigning)

Hvad spilleren oplever (efter koden, ikke efter tænd-kortet): på bjerg- og højfjeldsetaper, der ikke slutter på en top, kan en gruppe bagfra efter sidste stigning højst vinde et fast antal sekunder pr. kilometer i forhold til sin egen fart. Små grupper kan ikke længere kæde sig sammen og vinde minutter på rytterne foran. Loftet kan kun gøre en gruppe langsommere, aldrig hurtigere, så rækkefølgen er uændret. Dronningeetape-justeringen (#7236) har intet loft. Større tidshuller bag vinderen er forventet, og i et tæt klassement kan føreren skifte efter en sådan etape.

Forbehold, som skal løses FØR tænding (ellers er teksterne forkerte):

- **Stempel:** uden et start-stempel skifter et igangværende etapeløb regler. Anbefaling: byg samme stempel som `ittNoDayRoll7726` og `letGoOrder7557` (`races.<flag>` stemples ved første etape-claim, jf. `RACE_ENGINE_RULES.md`), og skriv så "i løb, der ikke er startet" i patch noten. Uden stempel skal noten sige "fra næste etape, der køres".
- **Motorens testport G19** bliver rødere med kontakten tændt (8/11, 14/11). Ejerens valg (tune loftet eller genbesøg G19-båndene) står åbent. Det er ikke en tekstsag, men teksterne må ikke love, at nr. 10 holder sig tæt.

**Patch note (udkast; ordlyden "i løb, der ikke er startet" kun hvis stemplet er bygget)**

- EN title: Chasing groups gain less time after the last climb
- EN body: On mountain stages that do not finish on a summit, a group chasing from behind now gains only a little time at a time after the last climb. Small groups no longer link up and win minutes on the riders ahead. Gaps behind the winner can get bigger, and a close overall lead can change hands.
- DA title: Jagende grupper vinder mindre tid efter sidste stigning
- DA body: På bjergetaper, der ikke slutter på en top, vinder en gruppe bagfra nu kun lidt tid ad gangen efter sidste stigning. Små grupper kan ikke længere kæde sig sammen og vinde minutter på rytterne foran. Tidshullerne bag vinderen kan blive større, og en tæt føring i klassementet kan skifte hænder.

**Hjælp: sidste sætning i `faq.raceRouteRealismFaq.a`** (lægges ind i samme PR som tændingen; ingen gate mulig)

- EN: After the last climb, a group chasing from behind can only win back a limited amount of time per kilometre, as in real racing. Small groups no longer link up one after another and ride minutes back on the riders ahead.
- DA: Efter sidste stigning kan en gruppe bagfra kun hente en begrænset tid pr. kilometer, som i virkeligheden. Små grupper kan ikke længere kæde sig sammen og køre minutter ind på rytterne foran.

Nuværende FAQ-svar siger, at et dal- eller nedkørselsmål "lader feltet samle sig igen". Den sætning er stadig rigtig, men bør blødes op samtidig: "kan samle sig igen" i stedet for "lader feltet samle sig", så de to sætninger ikke modsiger hinanden.

---

## Fix-plan

1. **Hjælp og patch notes (ren tekst):** opret én PR med patch notes for flagene 1 til 3 og Hjælp-nøglerne i tabellen (alle fem sprog; en/da herfra, es/fr/nl oversættes efter `docs/i18n/GLOSSARY.md` og kontrolsøges for forbudte tiltaleformer). Tilføj gates i `frontend/src/pages/helpFlagGates.js`. Kør `node scripts/tone-check-terms.mjs`, `npm run lint`, i18n-checks og `node --test`. Risiko lav; gaten sikrer, at ingen ser teksten, før flaget er tændt for dem.
2. **Nedkørsels-loftet:** (a) bygg start-stemplet (ny `races`-kolonne, bind ved første etape-claim, `raceRunner` læser stemplet, `input_checksum` uændret med kontakten slukket); (b) ret tænd-kortet på #7644 (stempel, og "bjerg- og højfjeldsetaper uden topmål", ikke "lange nedkørsler"); (c) ejer vælger G19-vejen; (d) først derefter patch note og FAQ-sætning i samme PR som tændingen. Risiko: motor, kræver Fable-dom før merge og ejer-go til tænding.
3. **Oprydning efter tænding:** fjern gaten på de nye Hjælp-tekster, og opdatér `FEATURE_REGISTRY.yml` og `FEATURE_STATUS.md` (`node scripts/generate-feature-status.mjs`).

## Bevis

- Ingen start-stempel for loftet: `grep -n "descent_regroup_cap_7644\|bindDescent" backend/lib/raceRunner.js backend/lib/raceStartStamp.js` giver kun læsningen i `raceRunner.js` (r. 352) og ingen bind-funktion.
- Rækkevidden: `descentRegroup6486Applies` i `backend/lib/engine/v4/mechanics/descentRegroup6486.ts` (profiltype, sidste segment ikke en stigning, segmentet efter sidste stigning, terræn med lukning).
- Dronningeetaper uden loft: `maxClosingSecondsPerKm: Infinity` i `DESCENT_REGROUP_7236_TUNING` (samme fil).
- Akademi-faner og fanenavne: `frontend/public/locales/{en,da}/academyV2.json`, `academyLedger.json`; `AcademyV2.tsx` monterer fanen `ledger`.
- Programfanens ord (Plantype, Ugeblokke, Rotation, Races took, Jump to pass, Start from pass 1): `frontend/public/locales/{en,da}/trainingR5.json`.
- Eksisterende tekster: `help.json` (en/da) `sections.dailytraining.programs`, `faq.academyAgeFocusFaq`, `faq.raceRouteRealismFaq`; `frontend/src/data/patchNotes.js` 7.506 og 7.514.
- Regler: `docs/TRAINING_RULES.md` §13.8 og §13.10, `docs/YOUTH_RULES.md` (akademisiden udgave A), `docs/RACE_ENGINE_RULES.md` (#7644-afsnittet), issue-kommentarerne på #8549, #8081 og #7644.

Dom: bekraeftet + fix-plan
