# Svar-udkast #4261 — løb som træning (verificeret mod koden 27/8)

> Ejeren poster selv i #dansk-snak. To udgaver klar til copy-paste: EN først, DA under.
> Kilde: `race_day_development_enabled` = **off** i prod, `race_day_engine_enabled` = **on**
> (patch 7.196/7.198, PR #4279/#4277). Det betyder sæson 3 kører sæson 2's løbsdags-regler.
> Verificeret i `backend/lib/raceDayDevelopmentFlag.js`, `dailyTrainingEngine.js`,
> `trainingDayTypes.js`, `training.js`.

---

## EN (copy-paste)

Straight answer, verified against the code — this was worth clearing up properly:

**Season 3 runs on season 2's race-day rules.** The "race replaces the day's training" version we announced got switched off again (patch 7.196), because it made a Rest day give zero from racing and tied your reward to whatever session you'd picked. It comes back in season 4, simpler, once it's actually locked.

So, concretely:

1. **Fatigue: yes, both.** Your rider still does the exact session you planned that day, and the race adds its own fatigue on top. They stack, same as season 2.
2. **Intensity: matters exactly like any other day.** Rest gives zero training gain, Hard gives the most gain and the most fatigue (plus injury risk once Fatigue is high). Racing doesn't change any of that.
3. **Session matching the stage: no, not right now.** Since racing doesn't hand out its own ability reward this season, there's nothing for a session to "match." Train each rider toward what he needs long-term. A linked version is planned for season 4 but isn't designed yet, so don't build around a specific shape of it.
4. **Academy vs. racing: racing costs you nothing in development.** Your talent gets the same session either way. The real cost is fatigue, so a talent racing often needs lighter sessions/rest days, exactly like a senior rider. No academy-specific penalty. Move your talents back up if you shipped them out for this.
5. **Flat/Cobbles and Hard: by design, no Hard session hits those two today.** The three Hard sessions are Intervals (Climbing/Punch/Tempo), Threshold (Time trial/Tempo), Sprint (Sprint/Acceleration). Flat only comes from Tempo (Normal) and Aero (Easy); Cobbles only from Technique (Easy). There's currently no way to push either at Hard.

All five are now also in Help under Daily Training / FAQ, so you don't have to dig this thread up again.

---

## DA (copy-paste)

Klart svar, verificeret mod koden, det her fortjente en ordentlig opklaring:

**Sæson 3 kører på sæson 2's løbsdags-regler.** Den udgave hvor "løbet erstatter dagens træning", som vi meldte ud, er slukket igen (patch 7.196), fordi den gav en rytter sat til Hvile nul ud af at køre løb, og bandt udbyttet op på hvilket pas du havde valgt. Den kommer tilbage i sæson 4, i en enklere form, når den rent faktisk er låst.

Så konkret:

1. **Træthed: ja, begge dele.** Rytteren gennemfører stadig præcis det pas du har planlagt den dag, og løbet lægger sin egen træthed oven i. De lægger sig oven på hinanden, ligesom i sæson 2.
2. **Intensitet: betyder lige så meget som på en almindelig dag.** Hvile giver intet træningsudbytte, Hård giver mest udbytte og mest træthed (plus skaderisiko når trætheden er høj). Løbet ændrer ikke noget af det.
3. **Pas skal matche etapen: nej, ikke lige nu.** Løbet giver ikke sin egen evne-belønning denne sæson, så der er intet for et pas at "matche". Træn hver rytter mod det han har brug for på sigt. En sammenkoblet model er planlagt til sæson 4, men den er ikke designet endnu, så byg ikke din plan omkring en bestemt udgave af den.
4. **Akademi vs. løb: løb koster dig ingen udvikling.** Dit talent får samme pas uanset hvad. Den reelle pris er træthed, så et talent der ofte kører løb, har brug for lettere pas/hviledage, ligesom en senior-rytter. Ingen akademi-specifik straf. Ryk gerne dine talenter tilbage op, hvis du flyttede dem ud af den grund.
5. **Fladt/Brosten og Hård: bevidst del af designet, ingen Hård-session rammer de to i dag.** De tre Hårde sessioner er Intervaller (Bjerg/Punch/Tempo), Tærskel (Enkeltstart/Tempo), Sprint (Sprint/Acceleration). Fladt kommer kun fra Tempo (Normal) og Aero (Let); Brosten kun fra Teknik (Let). Der findes i dag ingen måde at presse nogen af de to på Hård.

Alle fem punkter står nu også i Hjælp under Daglig træning / FAQ, så I ikke skal grave denne tråd frem igen.
