# #6649 Dagsform: den bedste vinder som i virkeligheden

Ejer 26/10 (designbord S6): dagsform pr. rytter og dag ud fra træthed, form, sygdom og vejr, aldrig ren tilfældighed, og altid forklaret bagefter i løbsloggen ("havde en dårlig dag" + hvorfor). Målbånd "som virkeligheden" pr. løbsgruppe: `v3Gates.bestRiderWinShare` i den private tærskelfil. Ejer 27/10: go på dagsformen fra S5's første etape (status nedenfor).

## Status: klar, slukket ved merge

- **Ejer 27/10:** dagsformen tændes fra S5's første etape. Grand Tours og monumenterne, der stadig ligger over båndet (§5), er et eget spor; de holder ikke dagsformen tilbage.
- **Slukket ved merge.** Kontakten er `app_config`-rækken `day_form_6649` (`backend/lib/dayForm6649Flag.js`). Kun den eksakte værdi `"on"` tænder; rækken mangler, `"off"`, `"beta"`, boolean `true` eller en opslagsfejl = slukket. Rækken findes ikke ved merge, så en merge ændrer ingen løb, heller ikke igangværende v3-løb.
- **Tændes efter merge med ejerens go:** ét `app_config`-skridt, ingen deploy. Rul tilbage ved at sætte rækken til `"off"` eller slette den.
- **Kæden:** `raceRunner.resolveRaceEngineV4` læser flaget én gang pr. afvikling (whole-race) / pr. etape-invokation (stage-by-stage), som `race_form_peaks`, fail closed. Tændt markerer den motoren; `v4DayForm6649Arg` lægger `dayForm6649: true` i motor-argumenterne og i `input_checksum`, kun under `s5_profiles_v3`. Broen (`buildV4StageInput`) sætter derefter `day_form_6649`. Fordi flaget ligger i argumenterne, genskaber #1857-genafspilningen (`engine_input_snapshots`) det uden ændring i snapshot-formatet.
- **Slukket = byte-identisk med main:** ingen nøgle i motor-argumenterne, uændret `input_checksum`, samme output (`backend/lib/dayForm6649Flag.test.js`). Tændt under en ældre revision har ingen effekt.
- Målingen tænder dagsformen med `CZ_DAY_FORM_6649=1` (kun dev-værktøjet `tourScorecard.mjs`); uden den måler testporten og motor-benchen spillet, som det kører.

Repoet er offentligt (hard rule 17): her står ingen målte tal eller bånd. De ligger i `balance-internals/6649/` og `private-handoffs/6649/result.md`.

## 1. Målingen

`backend/scripts/dev/dayForm6649.mjs` læser en motor-testport-eksport (cache.json + tourDryRun-JSON pr. løb) og kører ingen motor. Samme script måler før og efter.

- **Evne på dagens rute** = etapens `demand_vector` (generatorens terrænvægte, uden `randomness`) gange rytterens evner (0-99, normaliseret).
- **Etapens bedste** = den startende rytter med højest evne på ruten. **Klassementets bedste** = højeste sum over etaper der ikke er flade/rullende.
- **bestRiderWinShare** = andelen af etaper (eller løb, for klassementet) hvor den bedste vinder. Favoritten (top 3) måles ved siden af (`raceGroupBands.favouriteWinShare`).
- **Løbsgrupper**: monument, one_day, stage_race_stage, stage_race_gc, gt_stage, gt_gc, også pr. trup (u23, junior).
- **Vagter**: G16-G19 fra testporten og `gcFromBreakaway` (klassementsvinderen i et morgenudbrud / vandt fra et udbrud der holdt), som scriptet også måler.

Kontrol: samme kode (main + denne PR) med og uden `CZ_DAY_FORM_6649=1`; uden den er broens `day_form_6649` slået fra. Genmålt 27/10 efter main-merge: tvillingen reproducerer før-målingen, og dagsformens effekt er den samme som 26/10.

Kørsel: `CZ_DAY_FORM_6649=1 motorTestport.mjs --candidate=s5_profiles_v3 --baseline=s5_profiles_v3 --from-dir=<S5-eksporten> --seeds=8 --track-fatigue --no-bench`, derefter `dayForm6649.mjs --dir=<out>/races --cache-dir=<S5-eksporten>`.

### Hvad baseline viste (kvalitativt)

Dominansen er ikke ens fordelt. Bjerg, højfjeld og enkeltstart er for forudsigelige; bakket, bølget, brosten og mellembjerg er det modsatte, fordi udbrud og finalens egne regler afgør dem. Løbsgrupperne ligger derfor på begge sider af båndet: Grand Tours, monumenter og ungdomsetapeløb over, endagsløb under, de korte etapeløb inden for (men kun som gennemsnit af for høj bjerg-dominans og for lav bakke-dominans).

## 2. Modellen (`backend/lib/engine/v4/mechanics/dayForm6649.ts`)

Under `s5_profiles_v3` erstatter modulet den gamle dagsform (`physiology.ts` `dayformComponent` + `jourSansComponent`, ren seedet støj). Formens og formtoppens faste led er uændrede. Resultatet ligger i `RiderState.dayform`, som segment-loopet, klatreselektionen, finalen og enkeltstarten allerede læser.

Pr. rytter og dag, seedet pr. (etape-seed, rider_id) i egen stream:

1. **Dagens ben**: et signeret udsving. Ned-siden er bredere end op-siden, og ned-siden vokser med lav form, træthed og vejr. En dårlig dag er hyppigere og større end en super-dag. Udsvinget centreres, så en neutral rytter i gennemsnit hverken vinder eller taber.
2. **Den dårlige dag**: en sjælden, stor nedtur. Risikoen er summen af tre kilder (form, træthed, vejr). Den kilde hvis andel lodtrækningen ramte, er årsagen.
3. **Sygdom**: sjældnere og større; risikoen stiger med ekstrem træthed (samme retning som `conditionIllness.js` uden for motoren).

Vejr: regn og vind rammer efter rytterens vejr-teknik (nedkørsel + holdbarhed, som `mechanics/weather.ts`); hede = sol på en lang, kuperet dag.

Massespurt: dagsformen er udholdenhed og vejer mindre i en spurt end på en stigning eller i en enkeltstart. Finalens score læser dagsformen med en mindre vægt på massespurt-ruter.

### Hvorfor ned-siden er bredere

Første kalibrering med symmetrisk udsving flyttede kun lidt på bjerg-dominansen, men gav udbryderne flere gode dage: udbrud vandt oftere på bjerg, og klassementsvinderen kom oftere fra et udbrud (`gcFromBreakaway`, #7258's vagt). Med en bred ned-side og smal op-side har favoritterne deres dårlige dage, uden at udbryderne får flere super-dage. Det er også tættest på virkeligheden: en "jour sans" er en nedtur, ikke en lotterigevinst.

## 3. Løbsloggen

Motoren skriver `bad_day` ved målstregen (bagefter, ikke undervejs) for dagens kandidater (de bedste på ruten) med en tydelig nedtur. Params: `rider_id`, `reason` (`form` | `fatigue` | `illness` | `weather`) og ved vejr `weather` (`rain` | `wind` | `heat`). Fog-gate: ingen tal.

Frontend: `stageTimelineFilm.describeEvent` → `detail.film.event.bad_day_<årsag>` i alle fem sprog; historien om etapen (`stageTimelineStory.js`) vægter den lige under `favorite_crack`.

## 4. Kroge (minimal kobling)

- `dayForm6649Flag.js` + `raceRunner.js`: `app_config` `day_form_6649` (kun `"on"`) → `v4Engine.dayForm6649` → `v4DayForm6649Arg` i motor-argumenterne og `input_checksum` (begge stier).
- `raceEngineV4Bridge.js`: kontakten `dayForm6649` (default `false`); feltet `day_form_6649` sættes kun ved `true` under v3.
- `segmentLoop.ts`: start-tilstanden (`applyDayForm6649`) og events ved mål (`dayForm6649Events`), begge gated på `dayForm6649On` (feltet + `isS5ProfilesV3OrLater`).
- `mechanics/teamTimeTrial.ts` + `individualTimeTrial.ts` + `index.ts`: samme for enkeltstart og holdtidskørsel via optionen `dayForm6649`.
- `finale.ts`: dagsformens vægt i massespurten (`dayForm6649FinaleScale`, 1 uden for v3 = bit-identisk).
- `physiology.ts` er ikke ændret; modulet genbruger `deriveCp`, `formCpModifier`, `formPeakCpModifier`.

Ældre revisioner er bit-identiske (`oldRevisionDigests6199.test.ts` + modulets egne tests).

## 5. Det modellen ikke løser

Gaten (`bestRiderWinShare` i alle løbsgrupper) er ikke grøn med dagsform alene: Grand Tours (etaper og klassement) og monumenterne ligger stadig over båndet. Et forsøg med en "lang dag" (ned-siden vokser med distancen) og mere dagsform i massespurten flyttede dem næsten ikke og blev rullet tilbage.

Endagsløbenes og de bakkede etapers lave sejrsandel for den bedste skyldes udbrud og finalens regler, ikke dagsform; dagsform kan kun gøre en favorit svagere. Bjerg-dominansen ved store evne-forskelle (især ungdomsfelter og Grand Tours) kræver mere end dagsform alene, uden at udbrud og `gcFromBreakaway` bliver værre. Tallene og de reelle valg ligger til ejeren i `private-handoffs/6649/result.md`.

## 6. Kendte grænser

- Testportens endagsløb har ingen træthed eller form på startlisten (kun etapeløbene får det mellem etaperne via `--track-fatigue`). I prod sender broen begge, så træthed og form virker stærkere der end i målingen.
- `s5_profiles_v3` er den aktuelle revision siden 26/10: når kontakten tændes, ændres også igangværende v3-løb fra næste etape (stage-by-stage læser flaget pr. etape). Derfor er tænd ejer-gated og ikke en del af denne PR; ejerens plan er at tænde før S5's første etape.
- Den bedste ud fra `demand_vector` er en tilnærmelse; motoren afgør bjerg via CP og finalen via sin egen efterspørgsel.

Refs #6649 · #7258 (udbrudsvagterne) · #6156 (formtoppe) · #6938 (sygdom af træthed)
