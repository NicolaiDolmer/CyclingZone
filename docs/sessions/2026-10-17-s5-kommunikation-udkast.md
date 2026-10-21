# S5-kommunikation: udkast til ejeren (#6769)

> Kun udkast. Ejeren sender selv. Intet er postet eller sendt. Tone: `docs/TONE_OF_VOICE.md` (jeg, aldrig vi; ingen em-dash; ingen AI-fyld; EN først på Discord). Intet balance-tal (hard rule 17) og ingen opfundet indhold: hver påstand nedenfor står i `frontend/src/data/patchNotes.js` (v7.356-v7.367) eller i git/issues, kilden står i parentes i verifikationstabellen til sidst.
> Målgrupper efter GDD D-005 (ejer-valgt 10/9): cykelinteresserede uden managererfaring, og managerspillere som skal lære cykelsporten. Sværhedsgrad: "nemt at komme ind i, svært at mestre". Ingen af indgangene er vigtigst, så de to varianter er lige lange og deler samme dato og samme CTA.
> Datoer: opslaget postes torsdag 22/10. Sæson 5 starter onsdag 28/10 (patch note 7.361). Sæson 4 slutter søndagen før.

## 1. Lanceringsopslag, torsdag 22/10

### Variant A: cykelinteresserede uden managererfaring

```
Season 5 of Cycling Zone starts Wednesday 28 October.

If you love watching cycling but have never run a team, this is a good moment to start. You pick a squad, enter it in real race calendars and decide who leads, who works and who goes up the road. You do not need to know a manager game. The game explains the basics as you go, and the Help pages are there when you want more.

A few things that are better since last season:

- Breakaways behave like breakaways. A strong rider can attack alone late in a stage, and if the break is caught early, a new one can go.
- A dangerous GC rider in the break gets chased harder, so the overall win is rarely decided by an escape.
- Time trials spread out more, so a strong time triallist can win real time in the general classification.
- The third week of a Grand Tour is hard. Fatigue builds up over the whole race.
- A new team sees its first race at the top of the dashboard: when it starts in your own time zone, how many stages, and one button to set your line-up.

On Android you can install the game from Chrome (menu, "Install app"). Same account, no app store.

The game is free. You cannot pay for better riders, faster training or better results.

I build this in the open, and it gets better every week. The best time to join is always now. Come as you are, play as often as you like, and tell me what feels unclear. I read everything.

cyclingzone.org
```

Billedforslag (A):
1. Dashboard for et nyt hold med kortet "Your first race" øverst (starttid, antal etaper, knappen til opstilling). Viser at man ikke skal kunne noget på forhånd.
2. En etapesides resultat med de fire stillinger og tidsforskellene (ikke tal fra balance, bare siden). Viser at løbet ligner cykling.
3. Én Help-side (fx om udbrud) i lyst tema. Viser at forklaringen er der, når man vil have mere.

### Variant B: managerspillere

```
Season 5 of Cycling Zone starts Wednesday 28 October.

If you already run teams in other manager games, the part that is new here is the racing. The race engine now makes the gaps and the breakaways, not a table:

- The gap at the finish depends on how much stronger a rider was and how much climbing was left. No more fixed steps of a few seconds.
- Time trials spread out more, so a good time triallist can gain real time in the GC.
- Bigger breakaways on hilly and mountain stages. GC riders in the break get chased harder. A new break can go after an early catch, and a strong rider can attack alone late.
- Fatigue builds up over a whole race and follows the work a rider did, so week 3 of a Grand Tour is hard.
- Your lead-out train only rides by default on flat stages now.

Also new on the management side:

- Academy 2.0: you bring in this week's intake with one click. The new Academy Expansion on the Club page decides how many candidates you get and lets you give the intake a profile (a nationality or region, a rider type and one extra choice). You learn a prospect's potential through training after you sign him.
- The Club page is rebuilt. Each facility is a card with its current effect, all five levels and what the next level costs in upkeep.
- You can withdraw a counter offer you sent, and an old price can no longer be accepted later.
- If a rider is injured after you picked him, your team now starts with the fit riders it has left.
- If your team does not start a stage race, your riders are free for other races straight away.

Season 5 starts on a Wednesday, and the last race day of a season is a Saturday from now on, as you voted in the forum.

The game is free. You cannot pay for better riders, faster training or better results.

Tell me what feels off. I read everything, and I fix in the open.

cyclingzone.org
```

Billedforslag (B):
1. Club-siden (facility-kort med effekt, niveauer og vedligehold øverst). Annotér med én pil: "Academy Expansion".
2. Academy-siden med ugens intake og knappen.
3. Et GC-resultat fra et enkeltstartsløb eller en bjergetape, så tidsforskellene kan ses. Tag det fra et afsluttet S4-løb.

Noter til ejeren:
- Begge udkast nævner kun live-funktioner. Stage page 2.0 og "sæt dagen for mange ryttere" er stadig beta-gruppe (7.361) og står derfor ikke i opslaget. Skal de med, er det en ejer-beslutning.
- Datoen 22/10 og "starter onsdag 28 oktober" følger 7.361. Er kalenderen ændret siden, skal linjen rettes.
- DA-version i tråden under opslaget (language priority): kan laves på ejerens "ja" til EN-teksten, så den ikke driver.
- Ordet "free" bruges som i Voice DNA (spillet er gratis). "Free forever" er undgået (ToV DON'T). CZ Pro er ikke nævnt, fordi opslaget er til nye spillere.

## 2. Discord-svar

### Friis (dansk)

Verifikation: se tabel 4. Rytterne er frigivet (#6747, ejerens "kør" 17/10, Friis' seks Léman-ryttere frie). Skade efter udtagelsen koster ikke længere starten (#6745, regel B, live 16/10 aften).

```
Hej Friis, dine ryttere er frigivet nu. Holdet stillede ikke op i Tour du Léman, og så skulle de ikke have stået låst til løbet var slut. Det er rettet, så et hold der ikke starter får rytterne frie med det samme, og jeg har frigivet dem for alle hold, der var i samme situation. Du kan bruge dem til de overlappende løb.

Og så det med Charpentier: hvis du har udtaget et hold, og en rytter bliver skadet efter udtagelsen, starter holdet nu med de raske ryttere, der er tilbage. Skaden koster ikke længere hele starten. Du får også en besked i indbakken, når en rytter bliver skadet i et løb, og "Train now" advarer dig og spørger først, hvis et løb i dag ville ende med for få raske ryttere.

Tak fordi du blev ved med at skrive, det var din rapport der fik det hele rettet.
```

### knud (engelsk)

Verifikation: se tabel 4. Daily Training viste "Racing" for hold, der ikke var i feltet (kilde: #6740 problemtekst + `racingTodayLookup.js` ignorerede `race_withdrawals`). Rettet i #6742 (a4a360a83, 16/10) og udvidet i #6745/#6747; patch note 7.364 og 7.366.

```
Hi knud, the badge on Daily Training is fixed. It used to say a rider was racing in Tour du Danube when your team was not actually in the field. It now only shows a race if your team really starts. If your team did not start, Planning says "Did not start", you get a message in your inbox, and the riders are free for other races straight away.

Thanks for reporting it, and sorry for the confusion in the meantime. If you still see a rider marked as racing when he should not be, send me the race and the day and I will look at it.
```

Noter: "Hej Friis" er korrekt dansk. Svaret til Friis omtaler ikke antal (73 hold, 280 ryttere), fordi det er driftsdetaljer, ikke relevant for ham.

## 3. Status på jeres rapporter (EN)

Kilde: issues lukket (COMPLETED) 10-17/10 med spillerkilde i titlen (Discord/spiller + dato), krydstjekket mod patch notes og commit. Medtaget kun hvor en patch note eller en merget PR dækker rettelsen. Udeladt (lukket, men ingen verificeret rettelse at henvise til): #5733, #5418, #3410, #6423, #6124 (sidstnævnte lukket som "ingen regression", ikke en rettelse). #6740 er stadig åbent (venter på ejerens lukning), men alle dele er live og står i listen.

```
Status on your reports

Here is what you reported and what I have fixed in the last week. Thank you, all of it started with one of you writing in Discord.

Fixed:
- Scouting missions searched only part of the market, and some reports came back with riders you could not see. Missions search every free agent again. If a report was lost, your payment was refunded and you got a message. (7.359)
- The unread count in the menu now clears when you mark everything as read, also in your other tabs. You are told when someone outbids you, and you no longer get an email about your own bids. (7.358)
- A rider who drops out of a stage race trains again from the next day. (7.357)
- An unsold youth rider stays on your team. (7.351)
- The expiring-contract badge shows on U23 and junior squads, and Graduation Day shows the rider's age in the season. (7.358)
- Time gaps show in the youth and team classifications of stage races. (7.356)
- Teams that did not start a race no longer show as racing. Planning says "Did not start", and Daily Training no longer shows those riders as racing. (7.364)
- Riders are free for other races straight away when your team does not start a stage race. (7.366)
- If a rider is injured after you picked your riders, your team starts with the fit riders it has left. (7.365)
- Crashes now message you with the date he is back and which of your races he misses, and Train now warns you before a race would end up short. (7.364)
- Your lead-out train only rides by default on flat stages. (7.363)
- The fatigue limit and the daily report now cover every race day, not only one. (7.330)
- Season points show all day on the rider page and Development tab. (7.349)

Improved from your ideas:
- Copy a day's training plan to the next days. (7.352)
- Back to the team program on the Today row for a single rider. (7.353)
- Message a manager from his team page. (7.352)
- Youth races warn you when you have picked too few riders. The squad filter shows each squad's age limit. (7.361)

Still open, I have not forgotten them: small squads that lose a whole stage race when they are short of riders, and a few smaller things on the list. I will say here when they are done.

If you reported something and do not see it here, tell me.
```

Noter til ejeren:
- Listen er skrevet uden handles, fordi repoet er offentligt og et fællesopslag ikke skal udpege enkeltpersoner. Vil ejeren takke ved navn (fx knud, egomadsen, mandia, Friis), tilføjes @-mention i Discord.
- "Still open" nævner #6739 (små trupper mister hele etapeløb) kun fordi ejeren 17/10 valgte at tage den beslutning, jf. `2026-10-17-pc1-startprompt.md`. Er beslutningen ikke truffet endnu, skal linjen ud.
- Known issues er opdateret i prod 15/10 (NOW.md). Der er ikke rørt ved dem her; ejeren bør tjekke om "Did not start"-rettelserne (7.364-7.366) gør en linje forældet.
- Rapport-sporingen kan ikke gøres fuldt maskinelt: der findes ingen `source:player`-label. Spillerkilde er aflæst i titel (handle/dato/"spiller") og kan have misset issues uden det mønster.

## 4. Verifikation af Friis- og knud-fakta (hvad jeg fandt)

| Påstand | Kilde | Fund |
|---|---|---|
| Friis' ryttere er frigivet | #6740 kommentar 17/10 08:19; commit `a03c5a48f` (#6747) | Bekræftet. Hold der ikke stillede op frigives automatisk ved start (`race_withdrawals.withdrawn_reason = 'did_not_start'`, afstemt ved hver etape). Engangsfrigivelse kørt 17/10 på ejerens "kør": 0 bundne entries tilbage, Friis' seks Léman-ryttere frie. Patch note 7.366. |
| Skade efter udtagelsen koster ikke længere starten | commit `d615ac943` (#6745), patch note 7.365 | Bekræftet. Holdet starter med de raske, mindst 1 (kode: `raceFieldIntegrity.js`, `raceRunner.js`). Test `raceRunnerInjuryStartFloor.test.js`. Gælder kun skade efter udtagelsen; falder holdet under 6 af andre grunde, starter det stadig ikke (patch note 7.365). |
| Skade-besked og Train now-advarsel (nævnt i Friis-svaret) | commit `a4a360a83` (#6742), patch note 7.364 | Bekræftet, live 16/10 aften. |
| knud: badget på Daily Training er rettet | commit `a4a360a83`; `backend/lib/racingTodayLookup.js` læser nu `race_withdrawals` og startfeltet (`teamWillStart`) | Bekræftet. Rapporten stod i #6740 ("Daily training viser ryttere som 'i Tour du Danube', selvom de ikke kører"). Rettelsen skjuler "Racing" for hold, der ikke starter. |
| Begge nævnt i `docs/sessions/2026-10-17-pc1-startprompt.md` som "ejeren skal selv" | samme fil, linje 21 | Ingen af svarene er sendt (jeg har ikke Discord-adgang og sender intet). |

Forbehold: jeg har ikke set live-prod og kan ikke se Discord-tråden, så "knud ser det selv" er bygget på kode, tests og issue-kommentarer ("verificeret live" står i #6740 kommentar 16/10 21:15). Vil ejeren være sikker på knuds konkrete Tour du Danube-hold, kan det slås op i `race_withdrawals` før svaret sendes (read-only).
