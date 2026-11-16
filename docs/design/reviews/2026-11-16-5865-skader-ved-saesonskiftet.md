# #5865 · Skader ved sæsonskiftet (designnote, 16/11)

**Ejer-spørgsmål:** hvad skal der ske med en aktiv skade eller sygdom, når sæsonen skifter?
**Anbefaling: A, alle skader og sygdomme forsvinder ved skiftet.** Gælder kun fremad, første gang ved S6-skiftet, og kun hvis ejeren tænder den.

Status: mekanismen er bygget bag en kontakt der er slukket (`season_injury_reset_mode = "off"`). Intet ændrer sig for spillerne, før ejeren har valgt og tændt.

## 1. Sådan virker det i dag (main, verificeret i koden)

- **Trætheden** nulstilles ved skiftet (`backend/lib/seasonFatigueReset.js`, kaldt fra `seasonStartHooks.js`). Alle starter på samme lave niveau.
- **Skaden** røres ikke. Den bor i `rider_condition.injured_until` (dato), som er udtagelses-gaten alle steder (`riderEligibility`, `raceSelection`, `raceEntryGenerator`, `raceRunner`, frontend).
- Ved siden af ligger løbsdags-aksen fra #5462/#7414: `injury_end_game_day`, `injury_season_id`, `injury_race_days_left`. Løbsdagen hører til én sæson. En skade der rækker forbi sæsonens sidste løbsdag, kan ikke slås op på næste sæsons akse, så den **falder tilbage til datoen** (`injuryRaceDays.js`, "SAESONGRAENSEN"), og træningsmotoren nulstiller den gamle sæsons koordinat ved første tick i den nye sæson.
- **Tre årsager** i `injury_cause`: `race_crash` (styrt i løb), `training_overload` (hård træning ved høj træthed) og `illness` (sygdom af langvarig ekstrem træthed, #6938). Alle tre deler samme gate.
- Hjælp-teksten siger i dag direkte: "Injuries are NOT reset. They carry over unchanged."

Konsekvens: en rytter der styrter i sæsonens sidste uge, starter den nye sæson skadet, mens hans træthed er nulstillet. Det er præcis det spillerne undrede sig over 28/9 ("fejl eller funktion?").

## 2. Målinger (read-only, prod 16/11)

De præcise tal ligger i `balance-internals/2026-11-16-5865-skader-ved-saesonskiftet.md` (hard rule 17). Kvalitativt:

- **S4→S5-skiftet (28/10), det seneste skifte:** et lille antal ryttere startede S5 skadet, under en femtedel af dem der typisk er skadet midt i en sæson. De fordelte sig på mange forskellige menneskehold (næsten aldrig to på samme hold) plus enkelte AI-ryttere. De fleste var raske efter første løbsdato; et par rakte over en uge ind i S5.
- **Nu (midt i S5):** ingen af de skader der er aktive i dag, rækker ind i S6. S6-tallet afhænger alene af styrt og overbelastning i S5's sidste dage.
- **Forventet ved S6-start:** samme størrelsesorden som ved S4→S5. Antagelse, ikke måling: sæsonpausen er stadig få dage, og skadesvarighederne er uændrede.
- Måling gentages på skiftedagen med `scripts/dry-run-5865-season-injury-reset.mjs --season-start <skiftets dato>` (read-only, kun aggregerede tal).

Forbehold: S4→S5-tallet er rekonstrueret fra den sidste trænings-afregning før skiftet. Et styrt i et løb efter den afregning er ikke med, så tallet er snarere for lavt end for højt.

## 3. Virkelig cykelsport

- En rigtig off-season er 2-3 måneder (oktober til januar). Typiske styrtskader (kraveben, ribben, hudafskrabninger, hjernerystelse) heler inden for den tid. En rytter der styrter i et efterårsløb, starter normalt næste sæson rask.
- Kun alvorlige skader (bækken, lårben, store operationer) rækker ind i næste sæson. Den slags skader findes ikke i spillet: den længste skade er et par uger.
- Sygdom (forkølelse, overtræning) er altid væk efter en pause.
- Spillets sæsonpause er få dage, men den **står for** en hel vinter. Det er samme logik som trætheden: ingen rytter er træt efter tre måneders pause.

## 4. Mulighederne

| | A · Alle væk (`clear`) | B · Afkortet (`cap`) | C · Kun korte væk (`light`) |
|---|---|---|---|
| Hvad sker | Alle aktive skader og sygdomme forsvinder | Skaden afkortes til højst et loft af dage efter skiftet | Skader der højst rækker en kort grænse efter skiftet, forsvinder; lange løber videre |
| Fordel | Enkelt, samme princip som trætheden ("alle starter lige"), matcher virkelig off-season og spillernes ønske | Et sent styrt koster stadig lidt | Lange skader beholder deres konsekvens |
| Pris | Et styrt i sæsonens sidste dage koster intet i næste sæson | Svær at forklare ("hvorfor 1 dato?"); skaden er stadig synlig ved start | To slags skader med forskellig regel; en lang skade er stadig det spillerne klager over |
| Spillertekst | "Injuries heal over the off-season" | "Injuries are shortened over the off-season" | "Minor injuries heal over the off-season" |

De konkrete defaults for loftet (B) og grænsen (C) står i `balance-internals/2026-11-16-5865-skader-ved-saesonskiftet.md` (hard rule 17).

**Anbefaling: A.** Begrundelse: (1) det er det spillerne bad om, og ejeren svarede positivt; (2) det følger trætheds-beslutningen fra 26/7, hvor princippet "alle starter sæsonen lige" vejede tungere end en engangs-skævhed; (3) i virkeligheden heler alle skader af den længde spillet har, over en vinter; (4) antallet der påvirkes er lille, så balance-effekten er lille, men det rammer netop de hold der føler sig snydt.

Eneste reelle pris ved A: den sidste uges hårde træning bærer ikke en skade med ind i næste sæson. Den koster stadig løbsdage i de sidste dage af den gamle sæson, så afskrækkelsen er der, bare kortere. Vil ejeren bevare en lille konsekvens, er B det bedste alternativ, med et loft der passer til pausen før første løb (ejeren sætter pausen, når S6-kalenderen bygges).

## 5. Implementering (denne PR)

- `backend/lib/seasonInjuryReset.js`: ren kerne `seasonResetInjury` + `applySeasonInjuryReset`. Modes `off | clear | cap | light`, læst fra `app_config` (samme mønster som form-nulstillingen #3232). Fail-safe: alt ukendt er `off`.
- Kaldt fra `seasonStartHooks.js` lige efter trætheden, i sin egen fejl-isolerede blok. Slukket mode skriver ingen fase-række, så fase-loggen er bit-identisk med i dag.
- Rører kun skade-kolonnerne (`injured_until`, `injury_cause`, løbsdags-koordinaten, `updated_at`). Form og træthed er urørt.
- Varigheden regnes i **kalenderdage** fra den nye sæsons `start_date`, som `seasonTransition` sætter til skiftets dato. En skade der krydser skiftet lever allerede på dato-aksen (afsnit 1), og første løbsdato kendes ikke endnu, når hookene kører (kalenderen bygges bagefter).
- Gen-kørsel: ankeret er den lagrede `start_date`, så en gen-kørsel en senere dag giver samme udfald. Har den nye sæson allerede kørt løbsdage, springes trinnet over (fase-loggen viser `season_already_started`), så en skade fra den nye sæson aldrig røres.
- Idempotent i alle modes: en gen-kørsel af skiftet skriver nul rækker.
- Gælder alle ryttere (menneskehold, AI og frie ryttere), ligesom trætheden.
- Migration `database/2026-11-16-5865-season-injury-reset-app-config.sql` indsætter kun konfig-rækkerne med `off`. Ikke kørt; den kører post-merge via auto-migrate og ændrer intet spilbart.

## 6. Tænding (ejer-go, efter merge)

1. Ejeren vælger A, B eller C.
2. Før S6-skiftet: `UPDATE public.app_config SET value = '"clear"'::jsonb WHERE key = 'season_injury_reset_mode';` (eller `"cap"`/`"light"`).
3. På skiftedagen, før skiftet: kør dry-run'en og se tallet.
4. Patch note og Hjælp-tekst (udkast i PR-bodyen) samme dag som tændingen.
