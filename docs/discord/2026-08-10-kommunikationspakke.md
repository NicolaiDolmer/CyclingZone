# Kommunikationspakke 10/8 — copy-paste-klar

**Ejeren poster selv. Intet i denne fil er sendt, og intet må sendes af en agent.**

Baggrund: Discord-sweep 7.-10/8 (alle 43 kanaler + begge forums) + patch-notes-audit mod
`git log` 1.-10/8. Alle tal er fra det daterede 10/8-snapshot (n=8.199), paritets-bevist mod
repoets egne funktioner.

**Rækkefølge jeg vil anbefale:** A → B → C nu (de kan postes i træk i dag), D først når du har
valgt indstilling på reparationen, E er til dig selv.

| | Hvad | Hvor | Haster |
|---|---|---|---|
| **A** | Patch notes-indhentning v7.106-7.110 | `#patch-notes` | ja, 3 dage bagud |
| **B** | Forklaringen: hvordan ryttertyper virker nu | `#patch-notes` eller fastpinnet i `#general` | **højest værdi pr. minut** |
| **C** | Known issues, opdateret | `#patch-notes` | ja |
| **D** | Varsel FØR reparationen kører | `#general` + `#patch-notes` | når du har valgt |
| **E** | Forslag til kommunikations-rytme | til dig | — |

---

## Hvorfor B er den vigtigste

Discord-sweepen viser at spillerne har en **korrekt** model af symptomerne og en **forældet**
model af mekanikken. De observerer præcis det du selv har målt. Det de ikke ved, er at
ryttertype gik fra *"beregnes hver nat ud fra nuværende evner"* til *"ligger fast"* — en
grundlæggende ændring i hvordan spillet virker, som de opdagede gennem symptomer i stedet for
gennem en forklaring.

Tre af de fire misforståelser i sweepen forsvinder af sig selv hvis den forklaring findes ét
sted de kan finde den:

1. *"Mine unge udvikler sig bare forskelligt"* (@chipped26, 7/8) — det var systematisk, ikke tilfældigt.
2. *"Typen bestemmer hvad jeg allerede ER god til"* — gammel model, stadig i spillernes hoved.
3. *"Er det dynamiske typer nu, men potentialet ligger fast?"* (@thelamba, 10/8 10:28).

Og ét fund er slet ikke adresseret nogen steder: **catch-22'en i klatretræning.**
@egomadsen (10/8 11:10) og @snorkalot (8/8 08:09) beskriver at de har lagt træningstid i
bjerge uden fremgang, og @egomadsen har allerede **skiftet træning væk fra det**. Han ved ikke
om det er midlertidigt. Det er den dyreste form for uvished: den får spillere til at ændre
adfærd på et forkert grundlag. B og C lukker den.

---

# A. Patch notes-indhentning

**Kanal:** `#patch-notes`. Sidste post dér var **7/8 kl. 12:11 dansk tid**. Siden er der
shippet fem versioner, herunder hele akademi-hændelsen. Selve siden på cyclingzone.org er
opdateret og korrekt — det er kun Discord der er bagud.

```
Patch notes catch-up (v7.106 to v7.110)

I have been shipping without posting here for a few days. Everything below
is already live, and all of it is on cyclingzone.org/patch-notes with the
full detail.

Academy (Aug 9): The academy intake that weekend was generated far too
strong, so the whole cohort was withdrawn, the auction was cancelled, and
the four managers who had signed or won one were refunded in full.

Mid-season prize money (Aug 9): A scheduling bug delayed the mid-season
payouts. All 191 teams have been paid.

Board (Aug 9): You now get a warning before a board mandate runs out, and
the renegotiation window is twice as long as before.

New teams (Aug 10): The rider generator had a floor meant for a field of
800 riders, but it was applied to every batch. In a batch of eight, that
floor promoted the entire batch, so every new manager's starting squad came
out as roughly three quarters sprinters and one quarter GC riders, with none
of the other six types present at all. That is fixed. It had been live for
51 days, which means every team created since June 20 was affected. I am
looking at what those teams should have.

Daily race digest (Aug 10): The daily Discord and email summary of your
races could fail to send entirely if the server restarted at the wrong
moment. No error, no retry, just a day with no summary. Fixed.

Season 3 calendar (Aug 7), potential stars no longer colour-coded by age
(Aug 7), downhill finishes now regroup the field instead of splitting it
(Aug 7), and a batch of smaller fixes to amounts, standings and the
selection screen.
```

**Dansk (post under, eller i `#dansk-snak`):**

```
Patch notes-indhentning (v7.106 til v7.110)

Jeg har shippet uden at poste her i et par dage. Alt nedenfor er allerede
live, og det hele står med fuld detalje på cyclingzone.org/patch-notes.

Akademiet (9/8): Weekendens akademi-kuld blev genereret alt for stærkt, så
hele kuldet blev trukket tilbage, auktionen aflyst, og de fire managere der
havde skrevet kontrakt eller vundet en, fik hele beløbet retur.

Midtvejspræmier (9/8): En planlægningsfejl forsinkede midtvejs-udbetalingen.
Alle 191 hold har fået deres penge.

Bestyrelsen (9/8): Du får nu et varsel før et bestyrelsesmandat udløber, og
genforhandlingsvinduet er dobbelt så langt som før.

Nye hold (10/8): Rytter-generatoren havde et gulv beregnet til et felt på
800 ryttere, men det blev brugt på hver eneste batch. I en batch på otte
promoverede gulvet hele batchen, så enhver ny managers start-trup kom ud som
cirka tre fjerdedele sprintere og en fjerdedel klassementsryttere, uden en
eneste af de øvrige seks typer. Det er rettet. Det havde været live i 51
dage, så alle hold oprettet siden 20. juni er ramt. Jeg kigger på hvad de
hold skal have.

Dagligt løbs-resume (10/8): Den daglige opsummering på Discord og mail kunne
udeblive helt hvis serveren genstartede på det forkerte tidspunkt. Ingen
fejl, intet nyt forsøg, bare en dag uden resume. Rettet.

Sæson 3-kalenderen (7/8), potentiale-stjerner farves ikke længere efter
alder (7/8), nedkørselsfinaler samler feltet i stedet for at splitte det
(7/8), og en række mindre rettelser til beløb, klassementer og
udtagelsesskærmen.
```

---

# B. Forklaringen: hvordan ryttertyper virker nu

**Fastpin den.** Det er den enkeltstående tekst der fjerner flest spørgsmål.

```
How rider types work now, and why yours changed

Several of you have asked variations of the same question this week, so here
is the whole thing in one place.

What changed under the hood

A rider's type used to be recalculated every night from his current
abilities. That sounds harmless, but it was a loop: his type decided what
his long term ceilings should be, and the next night those same ceilings
decided his type. Once a rider drifted, the loop kept pushing him further in
the same direction, every night, on its own.

That is how roughly three out of four player-owned riders ended up as
fighters. It was not your training and it was not bad luck. It was the same
calculation feeding itself.

The loop is now closed. A rider has one type, and the game cannot change it
on its own any more.

What that means for you

Your rider's type is no longer a description of what he is good at right
now. It is what he was born with, and what his long term ceilings are shaped
around. A rider can still be strong at something outside his type. The type
decides how far he can eventually go in each area, not what he can do today.

Why the race results did not change

This is worth saying plainly, because a few of you have been worried about
it: the race engine does not read rider type at all. Not once. A wrong label
never cost you a place in a race. What it cost was the shape of the rider's
ceilings, which is a slower and more annoying problem, but a different one.

About climbing training

Some of you stopped training climbing because it stopped producing progress,
and some of you have already switched your training away from the mountains
because of it. That was real, and it was the same root cause: a rider
relabelled away from climbing had his climbing ceiling lowered, so there was
nothing left to grow into.

For your young riders this has already reversed. When the ceilings caught up
with the corrected types, the climbing ceiling went up for 222 of them, by
as much as 48 points, and it went down for none. If you switched away from
mountain training, it is safe to switch back.

For riders over 22 it has not reversed yet. That is the correction I am
still preparing, and I will post before it runs.

What is still not right

Four pairs of types are currently too similar for the game to tell apart:
time trialist and GC, puncheur and climber, rouleur and cobbles rider,
rouleur and breakaway rider. If a rider sits between two of them, he can
look unstable. That is why a few of you have seen a rider change type twice
in 48 hours. I know exactly why it happens now and it is on the list.
```

**Dansk:**

```
Sådan virker ryttertyper nu, og derfor skiftede dine

Flere af jer har stillet variationer af det samme spørgsmål i denne uge, så
her er hele forklaringen ét sted.

Hvad der blev ændret under motorhjelmen

En rytters type blev tidligere genberegnet hver nat ud fra hans nuværende
evner. Det lyder harmløst, men det var en løkke: hans type bestemte hvad
hans langsigtede lofter skulle være, og næste nat bestemte netop de lofter
hans type. Når en rytter først var gledet, blev han skubbet videre i samme
retning hver nat, af sig selv.

Sådan endte cirka tre ud af fire spiller-ejede ryttere som fightere. Det var
ikke din træning, og det var ikke uheld. Det var den samme udregning der
fodrede sig selv.

Løkken er lukket nu. En rytter har én type, og spillet kan ikke længere
ændre den af sig selv.

Hvad det betyder for dig

Din rytters type er ikke længere en beskrivelse af hvad han er god til lige
nu. Det er hvad han blev født med, og det hans langsigtede lofter er formet
efter. En rytter kan sagtens være stærk i noget uden for sin type. Typen
bestemmer hvor langt han til sidst kan nå på hvert område, ikke hvad han kan
i dag.

Hvorfor løbsresultaterne ikke ændrede sig

Det er værd at sige rent, for et par stykker har været bekymrede for det:
løbsmotoren læser slet ikke ryttertype. Ikke én gang. En forkert type har
aldrig kostet dig en placering i et løb. Den kostede formen på rytterens
lofter, hvilket er et langsommere og mere irriterende problem, men et andet
problem.

Om klatretræning

Nogle af jer holdt op med at træne klatring fordi det holdt op med at give
fremgang, og nogle har allerede lagt træningen væk fra bjergene af den
grund. Det var ægte, og det var samme rodårsag: en rytter der blev
omklassificeret væk fra klatring fik sit klatre-loft sænket, så der ikke var
mere at vokse op i.

For jeres unge ryttere er det allerede vendt. Da lofterne fulgte med de
rettede typer, gik klatre-loftet OP for 222 af dem, med op til 48 point, og
det gik ned for ingen. Har du lagt bjergtræningen væk, kan du roligt tage
den op igen.

For ryttere over 22 er det ikke vendt endnu. Det er den korrektion jeg
stadig forbereder, og jeg skriver her før den kører.

Hvad der stadig ikke er i orden

Fire par af typer ligner i øjeblikket hinanden for meget til at spillet kan
skelne dem: tidskører og klassementsrytter, puncheur og klatrer, rouleur og
brostensrytter, rouleur og baroudeur. Ligger en rytter mellem to af dem, kan
han se ustabil ud. Det er derfor et par stykker har set en rytter skifte
type to gange på 48 timer. Jeg ved præcis hvorfor det sker nu, og det står
på listen.
```

> **Kilder pr. påstand i B**
>
> | Påstand | Kilde | Verificeret |
> |---|---|---|
> | Løkken: type → lofter → type hver nat | `dailyTrainingEngine.js:314` + `riderValueRefresh.js` via `trainingSweep.js:56` | ✓ |
> | Løkken lukket | PR #3588, merge `98acbd73` 9/8 21:47 UTC | ✓ |
> | ~3 af 4 spiller-ejede unge var fightere | 76,7 % / 74,1 % afhængigt af dateringen, dateret snapshot | ✓ |
> | Race-motoren læser ikke typen | `raceSimulator.js` + `raceRunner.js`: 0 forekomster af `primary_type` | ✓ |
> | Klatre-loft +222 / −0, max +48 | 952 menneske-ejede under 22, målt da lofterne fulgte de nye typer | ✓ |
> | Fire typepar uadskillelige | [#3592](https://github.com/NicolaiDolmer/CyclingZone/issues/3592): positive vægte er delmængder | ✓ |
> | Ryttere over 22 er ikke rettet endnu | kun 2,6 % af seniorerne rammes af den automatiske loft-opdatering | ✓ |

---

# C. Known issues, opdateret

Erstatter `docs/discord/2026-08-10-known-issues.md`. Fire linjer i det gamle udkast holdt ikke
længere (se `2026-08-10-known-issues-gennemgang.md`); de er rettet her, og de to punkter
gennemgangen anbefalede at tilføje er nu med, fordi PR #3589 er merged.

```
Known issues and fixes (Aug 7-10)

Academy "super riders" (Aug 7-9, resolved): A generator bug created 374
academy prospects with wildly inflated abilities and values. The youth
auction was cancelled, the affected riders were removed, and the 4
managers who signed one were refunded in full. The generator was fixed
on Aug 9. If you took a loan or sold riders to bid on one of these
prospects, those knock-on costs are not covered by the refund yet.
Message me and I'll sort it out individually.

Academy showed empty while the mail said a new class had arrived
(Aug 9, resolved for now): The class the notification referred to was
among the riders removed in the cleanup above. A new class was seeded the
same evening. I'm still fixing the underlying issue so a mail can never
point at riders that no longer exist, and so an empty academy tells you
why it's empty.

Youth prospects starting slightly too weak (known, fix in progress):
The Aug 9 hotfix overcorrected, so current academy classes are born a bit
below the intended level. A full progression rework is designed and
underway. Your prospects' hidden potential is unaffected.

Too many fighters (root cause fixed Aug 9-10, already visible on the
riders you own): Roughly 3 out of 4 player-owned youth riders were
labelled fighters regardless of their real profile, and stage racer (GC)
talents could never come out of an academy at all.

I want to be straight about this one, because I called it fixed on Aug 9
and it wasn't fully. The deeper problem was that a rider's type and his
long-term ceilings were being calculated from each other every night, so
a rider's type could drift back no matter what we corrected. That loop is
now closed, and the correction to your young riders' types has already
run. Their ceilings followed the same night. New academy classes keep the
profile they were born with from Aug 16.

Two types, puncheur and rouleur, are still recognised less reliably than
the rest in new academy riders, and four pairs of types are currently too
similar for the game to tell apart. Both are on the list.

Climbing not improving in training (known, already being undone): Several
of you reported that mountain training stopped producing progress after
the type change. Same root cause: a rider reclassified away from climbing
had his climbing ceiling lowered, so there was nothing left to grow into.
For your young riders this has already reversed. No climbing ceiling was
lowered, and 222 of them had theirs raised, by up to 48 points. Riders
over 22 are covered by the correction below.

New teams got squads of only sprinters and GC riders (Jun 20 - Aug 10,
fixed): The rider generator had a floor calibrated for a field of 800 but
applied to every batch, so a new manager's 12 riders were drawn as roughly
three quarters sprinters and one quarter GC riders, with none of the other
six types present. Every team created since June 20 is affected. The
generator is fixed. I have not yet decided what the affected teams should
have, and I would rather say that than promise something I haven't worked
out.

One-time correction for riders over 22 (being prepared): The young riders
are done. The older ones are not, and they were hit by the same loop. Some
will change type and some will see their long-term ceiling adjusted, up or
down. No rider loses any current ability, and no market values change. I'm
deliberately not rushing this one. A correction that locks in the wrong
profile is worse than waiting a few days. I'll post before it runs.

Academy signing fees too high (known, not yet fixed): Signing fees of
760k-1M for 2-star prospects are out of line with what those riders are
worth. On the list.

Mid-season prize money (resolved): A scheduling bug delayed mid-season
payouts. Fixed Aug 9, all 191 teams have been paid.
```

**Dansk:** samme rækkefølge, samme indhold. Skriv den efter EN-versionen, eller læg den i
`#dansk-snak` med en henvisning.

> **Hvad der er ændret fra dit 9/8-udkast, og hvorfor**
>
> | Linje | Ændring |
> |---|---|
> | "fixed Aug 10, **visible from Aug 16**" | → "fixed Aug 9-10, **already visible**". Ungdoms-baselinen gik live 9/8 18:53 og sweepen kl. 22 skrev nye typer. Baroudeur blandt menneske-ejede under 22 faldt fra 74,1 % til 16,2 % samme nat. 16/8 er datoen for noget snævrere: første akademi-kuld der fødes med et anlæg der står fast. |
> | "One-time correction for existing **young** riders (being prepared)" | → gælder nu **over 22**. Type-delen for de unge er kørt, og lofterne fulgte med. Det du stadig kan varsle er seniorerne. |
> | "The one-time correction below is what restores it" (klatring) | → "already being undone". Genopretningen for de unge skete automatisk. Klatre-loftet blev sænket for **nul** unge og hævet for 222. |
> | "puncheur and rouleur are still recognised less reliably" | → præciseret til **nye akademi-ryttere**. Blandt de eksisterende unge er rouleur i øjeblikket over-repræsenteret (39,4 % mod mål 17), så sætningen ville forvirre en spiller der lige har set halvdelen af sin ungdomstrup blive rouleur. |
> | **NYT:** nye hold fik ubrugelige start-trupper | Tilføjet nu, fordi PR #3589 er merged (07:52 UTC 10/8). Gennemgangen anbefalede at vente til netop det. Rammer alle hold oprettet siden 20/6. |
> | **NYT:** de fire uadskillelige typepar | Forklarer type-ustabiliteten @thelamba rapporterede 10/8. |
>
> **Bevidst udeladt:** at 70,4 % af de menneske-ejede ryttere over 22 også er fightere.
> Teksten er allerede lang, og et tal uden en plan skaber mere uro end det fjerner. Linjen
> "de ældre er ikke rettet endnu, og de blev ramt af den samme løkke" siger det ærligt uden at
> sætte et tal på. Spørger nogen direkte i Discord, er tallet 70,4 % mod AI-holdenes 1,4 %,
> og forklaringen er at kun menneskehold tikkes hver nat.

---

# D. Varsel FØR reparationen kører

**Post denne FØR du kører noget.** Det var dit eget valg, og det er det rigtige: sweepen 9/8
ændrede typer på 952 ryttere uden varsel, og resultatet var en dag med spørgsmål.

Teksten nedenfor har fire tal i `[kantede parenteser]`. De afhænger af hvilken indstilling du
vælger på håndtaget (A/B/C/D). **Udfyld dem fra den valgte indstillings tal, og post ikke før
de er udfyldt.**

```
A one-time correction to rider types is running on [DATO] at [TID]

This is the last part of the fighter problem, and it affects riders aged 22
and up. Your young riders were corrected on Aug 9 already.

What happens

Every rider gets one fixed type, chosen once, that the game can never change
on its own again. His long term ceilings are then rebuilt to match that
type.

What you will see

About [X] % of the riders on your team will show a different type the next
morning. On an average squad that is [Y] riders out of [Z].

What does not change

No rider loses a single point of current ability. Nothing about his form,
his contract, his salary, his potential or his results changes. Market
values do not move, because rider values are frozen right now. And the race
engine does not read rider type at all, so nothing about this changes how
your riders perform in the next race.

What does change

A rider's long term ceilings are rebuilt around his new type. For most
riders that means the ceilings that belonged to a profile he never actually
had get trimmed, and the ones that match him get room. Your rider's own
rating for his own type moves by a median of zero points. The tenth of
riders hit hardest lose 5 points on a 1 to 99 scale.

Why now, and why not sooner

I could have run this a week ago and it would have locked in the wrong
profiles, because the data I would have used to pick them was itself
produced by the bug. Waiting cost you a few days of odd looking rider
types. Rushing would have cost you a squad of permanently wrong ones.

If something looks wrong after it runs, post in #bugs with the rider and I
will look at it directly.
```

**Dansk:** samme struktur. Skriv den under, som i A og B.

> **De fire tal, og hvor du henter dem**
>
> | Placeholder | Hvad |
> |---|---|
> | `[X] %` | andelen af menneske-ejede ryttere der skifter synlig type i den valgte indstilling |
> | `[Y] af [Z]` | median-managerens tal (fx "10 af 12") |
> | `[DATO]/[TID]` | dit valg — læg gerne 24 timer mellem varsel og kørsel |
>
> **Tallene der IKKE afhænger af indstillingen** (de er verificeret og kan stå som de er):
> ingen rytter mister evne (`buildCapsForRider` returnerer `max(tapered, current)`, så loftet
> kan ikke komme under nuværende evne) · 0,00 % værdi flytter sig (`valuation_type` er frosset,
> #3345) · race-motoren læser 0 gange `primary_type` · rating for egen type median 0, p10 −5.

---

# E. Forslag til kommunikations-rytme

Du bad om det proaktivt. Her er hvad jeg vil anbefale, prioriteret efter hvad der koster mindst
og hjælper mest.

### 1. Byg dæknings-vagten der blev anbefalet og aldrig bygget

Det er den eneste af de fem der fjerner arbejde i stedet for at tilføje det.

`scripts/check-patch-notes-version.js` tjekker i dag kun **format**: unikke versionsnumre,
faldende rækkefølge, at `NOW.md` følger med. Den tjekker aldrig om en PR der rørte spillervendt
kode **manglede** en note. Issue [#623](https://github.com/NicolaiDolmer/CyclingZone/issues/623)
undersøgte præcis det 25/5, målte en miss-rate på **5 % (4 af 80 spillervendte PR'er over 30
dage)**, endte med **BUILD**-anbefaling — og build-issuet blev aldrig oprettet. De to huller
denne PR lukker (v7.110) er netop den 5 %.

**Konkret:** en post-merge-routine der åbner et issue med et foreslået EN+DA-udkast, når en
merget PR rører `frontend/src/pages/`, `frontend/public/locales/`, `backend/lib/` eller
`database/` uden at røre `patchNotes.js`. Ikke en blokerende gate — en påmindelse med udkastet
allerede skrevet.

### 2. Discord-posten skal falde ud af patch-noten, ikke være en selvstændig opgave

Det er derfor kanalen er 3 dage bagud: siden bliver opdateret som en del af arbejdet, mens
Discord-posten er en separat beslutning du skal huske at træffe. Den taber altid.

**Konkret:** en cron der lørdag morgen samler ugens `audience: "player"`-poster og lægger et
**udkast** i din indbakke eller et privat kanal-udkast. Du redigerer og trykker post. Automatisk
udsendelse vil jeg fraråde — tonen i patch notes er skrevet til en side man opsøger, ikke til en
kanal man scroller.

### 3. Fastpin de tre forklaringer der ikke er nyheder

Sweepen viser at det samme spørgsmål bliver stillet igen og igen, fordi svaret kun findes i en
tråd fra i går. Tre kandidater, alle med bevis i sweepen:

- **B ovenfor** (hvordan ryttertyper virker nu) — @chipped26 7/8, @thelamba 10/8, @jeppek 8/8.
- **Rollback-politikken.** @knud_r_flink forventede 9/8 automatisk rollback af hele dagen. Din
  begrundelse for ikke at rulle tilbage (det ville ramme spillere der ikke var involveret,
  fx dem der købte ryttere af den berørte spiller bagefter) er rimelig, men den findes kun i en
  ophedet 1:1-udveksling. Skrevet ned én gang, som politik, er den et forsvar i stedet for et
  forsvar der skal improviseres.
- **Hvad "åben beta" betyder i praksis** — hvad du garanterer, hvad du ikke garanterer, og
  hvordan du kompenserer når noget går galt.

### 4. Sig det i UI'et, ikke kun i Discord

Da akademiet var frosset 9/8, stod fanen bare tom. @zootne og @shai2059 læste det som tab.
Forklaringen fandtes, men kun som et Discord-svar, og de fleste spillere læser ikke Discord.

**Konkret:** en enkelt banner-linje der kan slås til fra `app_config` og vises på den berørte
side. "The academy is paused while we fix a generator bug. Nothing has been lost." Det er en
lille feature, og den ville have fjernet tre af de fire misforståelser i sweepen.

### 5. Fast ugentlig kadence, lav ambition

`docs/discord/2026-06-21-content-calendar.md` beskriver allerede en tilsigtet rytme
("onsdag = community-update"). Den er ikke håndhævet, og den bliver ikke holdt.

**Konkret:** ét fast tidspunkt om ugen, og en post der må være to linjer lang hvis der ikke
skete mere. Rytmen er værd mere end længden. Sweepen viser at communityet bærer meget: en
spiller eksploderede kortvarigt 9/8 og trak det tilbage samme aften, og to andre spillere
bakkede dig op uopfordret. Risikoen lige nu er ikke frafald, det er **akkumuleret træthed hvis
type-ustabiliteten fortsætter uden en synlig "vi er færdige nu"-markering.** En fast rytme er
netop den markering, uge efter uge.

---

## Ét løfte der ser ud til at mangle

9/8 kl. 22:14 lovede du @knud_r_flink et "endeligt svar i morgen" om lånegebyret efter den
aflyste auktion. Jeg kan ikke se svaret i sweep-vinduet frem til 10/8 middag. Issuet findes
([#3577](https://github.com/NicolaiDolmer/CyclingZone/issues/3577)), så det er ikke glemt i
systemet, men spilleren venter stadig på selve svaret. Det er den slags der koster mest, fordi
det var det der udløste udbruddet i første omgang.
