# Startprompt: race engine-session efter 2/10

Kopiér alt under stregen ind som første besked i en ny Claude Code-session i `C:\Dev\CyclingZone`.

---

Race engine-session (efter morgen-sessionen 2/10). ENESTE fokus: vigtige og lovede ændringer til løbsmotoren, som spillerne mærker med det samme. Alt bygges hurtigst muligt i høj kvalitet. Ingen deadlines, ingen udskydelser, ingen Dependabot/vedligehold medmindre noget er i stykker her og nu. Intet i motoren må stå slukket, hvis det giver en stor, mærkbar forbedring for spillerne: byg, mål, vis mig, og få det live.

**Ejer 2/10 12.50: løbene åbnes igen I DAG**, så snart forbedringerne er færdige og live. Byg, mål, vis, merge, nu; ikke planlægning, ikke senere. Skemalæggeren (`stage_scheduler_enabled`) er pauset siden 09.44; kun ejeren tænder den. Giro della Penisola + 11 andre løb er ikke startet og binder ved første etape til den revision der er aktuel DA, så alt der merges før genstart når dem fra etape 1.

## Definition af færdig (i dag, før genstart)
Lav og vedligehold en tjekliste over spillernes klager om løb (Discord, issues med spillerkilde, mindst de seneste 3 uger) med status pr. punkt og bevis (replay/kalibrering/prod-data). Vis den for mig visuelt som ét billede. Mindst disse skal være løst og målt i dag: tilfældige resultater/specialister bag svagere holdkammerater, uforklarlige og alt for store tidstab for kaptajner og stjerner (især bjerg), roller og ordrer der ikke virker som valgt, udbrud der opfører sig urealistisk, store vindermarginer, og at spillerne kan se hvor og hvorfor tid blev tabt.

## Genstart i dag
- Dagens forfaldne etaper (11-19) køres én pr. løb når skemalæggeren tændes; det er OK. Tjek bagefter at aftenens træning afregnes korrekt.
- Discord-tekst om genstart (kun EN) skrives færdig til mig; jeg poster selv.

## Start
1. Læs CLAUDE.md, docs/NOW.md og docs/NIGHT_WAVE_RUNBOOK.md. Sæt dig som Working agent.
2. Verificér selv tilstanden (stol ikke på listen nedenfor): `gh pr list --state open`, `node scripts/wave-policy.mjs inspect`, prod `app_config.stage_scheduler_enabled` og `races.engine_rules_revision` for dagens løb (read-only SQL via Supabase MCP).
3. Bølger kun via `Workflow({ scriptPath: "C:\Dev\CyclingZone\.claude\workflows\wave.js", args: { tracks: [...] } })`, 4 laner, `model` eksplicit. Lav en NY session-bølge; findes en gammel markør uden levende ejer, så frigiv den efter runbookens regler.

## Tilstand ved overdragelse (2/10 ca. 12.45, verificér)
- Live i prod: specialister efter evne (#6032, #6051, #6077), AI-kaptajner gemmer kræfter (#6056), loft på lad-gå (#6078), udbrudsjustering (#6068), spillerflader for de nye regler (#6069), løbsfilmen nævner hvem der hentede udbruddet (#6052), patch note 7.331 (#6072).
- **Nye løb binder til `orders_gc_v1`** (#6070): roller styrer morgenudbruddet (kaptajn/spurtkaptajn/hjælper kun med "Forsøg udbrud", hunter som standard, "Kør roligt" stopper spontane forsøg, grupetto aldrig), GC-hold reagerer og kan bremse udbruddet.
- Skemalæggeren er pauset siden 09.44 og tændes af ejeren i dag, når forbedringerne er live.
- Var i gang: #6087 (rød main efter #6071), #6083 (#6079 beordret udbrud slår spontant + "Kør roligt" sparer mere i bjergene og koster mindre tid på stigninger; ejer-go givet), #6082 (#6080 mellemtider + "hvor og hvorfor tabte dine ryttere tid"; tre review-rettelser lavet i worktreet, mangler e2e-billede og ejer-"merge"), #6084 (bjergetaper, se 1).
- Private tal: `balance-internals/night-2-10/` og hver lanes `balance-internals/<issue>/`. Replay-cache med 208 S4-etaper: `C:\Dev\CyclingZone-worktrees\replay-5957-main\balance-internals\5957\replay-cache.json` (`backend/scripts/dev/replay5957.mjs`, `--rules=orders_gc_v1`). Kalibreringsharness: `balance-internals/night-2-10/cal/calibrate.mjs` + `analyze.mjs`.

## ÆGTE TEST FØRST (fund 2/10 13.00, blokerer genstart)
`backend/scripts/dev/dryRunUpcomingStage.mjs` kører en ukørt etape med prod-data gennem v4 (cache: `balance-internals/night-2-10/giro-cache.json`). Giroens rigtige felt viste: rolle-reglen holder (0 overtrædelser), MEN under `orders_gc_v1` taber GC-kaptajnerne 3-5x mere tid end legacy på kuperet/bjerg (næsten alle over 5 min) → #6088, og morgenudbruddet vinder 0/160 etaper i begge revisioner → #6089. Begge lanes kører fra denne session; fortsæt deres branches. Ingen motorændring merges uden at dry-run på Giroen + mindst ét andet løb der starter i dag er kørt før/efter og vist mig.

## Opgaver (rækkefølge efter værdi for spillerne)
1. **#6084 Bjergetaper (den største tilbageværende årsag til at kaptajner taber minutter uforklarligt).** Ejer-beslutninger 2/10: favoritgruppe ca. 15-25 ryttere ved foden af finalestigningen (i dag ca. 4), udbruddet hentes på finalestigningen (i dag ca. 38 km før mål), udbrud foran favoritterne ca. 45 % som i dag. Fortsæt lanens branch `feat/6084-mountain-selection-revision` (recovery i samme worktree, aldrig reset). Mål før/efter med #6075-harnessen og replay; vis mig ét samlet før/efter-billede. Da løbene er pauset, skal den gøres aktuel for de løb der starter ved genstart (Giroen inkl.); migration af CHECK-reglen på `races.engine_rules_revision` applies efter merge.
2. **Klage-tjeklisten** (se Definition af færdig) som første billede til mig, så vi ser hvad der mangler.
3. **#6080 mellemtider** live, hvis ikke allerede (spillerønske, forklarer tidstab).
4. **Jagten følger favoritgruppen** (forslag C i `docs/reports/2026-10-02-6075-climb-selection-timing.md`): holdenes jagt-ordrer og GC-reaktionen skal virke på bjergetaper efter første stigning.
5. **Rullende spurtfinaler**: restgabet mod S3 (se `docs/reports/2026-10-02-6073-v4-hilly-rolling.md`).
6. **Store vindermarginer** (Tour Emirates etape 6, U23-sejr med 6 min, enkeltstartsrytter der taber 21 min i bjergene): forklar i filmen eller ret, alt efter hvad målingen viser.
7. **Roller, der mangler** (design med mig, ét spørgsmål ad gangen, visuelt): #5981 beskyttet løjtnant, #5982 hjælpere gemt til bjerg/finale.
8. Én samlet patch note (EN+DA) for hver bunke spillervendte ændringer, til mit "merge".

## Regler
- Motorændringer: replay af de 208 S4-etaper + kalibreringsharness før/efter, tests, klassifikation (beregningsfejl gælder næste ikke-kørte etape; balance kun nye løb). NB: en ændring under en regel-revision rammer også løb, der allerede er bundet til den.
- Balance-tal kun privat, aldrig i PR/issues/NOW.md.
- Spillervendt adfærd eller tekst kræver mit ordrette "merge"; vis ét annoteret før/efter-billede (1440 + 390) og nøgletal i selve spørgsmålet. Tekst: docs/TONE_OF_VOICE.md, EN først, ingen em-dash.
- Merge via `scripts/merge-queue.ps1` (kendt fejl: kan melde rød for en kørsel der stadig kører, #6081; tjek selv konklusionen).
- Ingen deadlines i briefs eller status. Meld hvad der er færdigt, og start næste arbejde straks.
- Close-out: NOW.md (Next action + Working agent), issues flippet, token-hygiejne, close-out-cleanup, status-board.
