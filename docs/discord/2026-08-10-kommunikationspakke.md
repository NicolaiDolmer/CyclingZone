# Kommunikationspakke 10/8

**Ejeren poster selv. Intet herinde er sendt, og intet må sendes af en agent.**

Grundlag: Discord-sweep 7.-10/8 (alle kanaler + begge forums) + patch-notes-audit mod `git log`.
Tal fra det daterede 10/8-snapshot (n=8.199), paritets-bevist mod repoets egne funktioner.

**Post i denne rækkefølge.** A og B kan poste nu. C når du vil. D først når reparationen er klar.

---

## A. Patch notes-indhentning → `#patch-notes`

Sidste post dér var **7/8 kl. 12:11**. Siden er der shippet fem versioner.

```
Patch notes catch-up (v7.106 to v7.110)

I've been shipping without posting here for a few days. All of this is
already live, and the full detail is on cyclingzone.org/patch-notes.

Academy (Aug 9): The intake that weekend was generated far too strong. The
whole cohort was withdrawn, the auction cancelled, and the four managers who
had signed or won one were refunded in full.

Mid-season prize money (Aug 9): A scheduling bug delayed the payouts. All
191 teams have been paid.

Board (Aug 9): You now get a warning before a mandate runs out, and the
renegotiation window is twice as long.

New teams (Aug 10): The rider generator had a floor meant for a field of 800
riders, but it was applied to every batch. In a batch of eight it promoted
the whole batch, so every new manager's starting squad came out as roughly
three quarters sprinters and one quarter GC riders, with none of the other
six types present. Fixed. It had been live for 51 days, so every team
created since June 20 is affected. I'm looking at what those teams should
have.

Daily race digest (Aug 10): The digest could fail to send entirely if the
server restarted at the wrong moment. No error, no retry, just a day with no
summary. Fixed.

Also: Season 3 calendar rebuilt, potential stars no longer coloured by age,
downhill finishes now regroup the field, and a batch of smaller fixes.
```

<details><summary>Dansk</summary>

```
Patch notes-indhentning (v7.106 til v7.110)

Jeg har shippet uden at poste her i et par dage. Alt nedenfor er allerede
live, og det står med fuld detalje på cyclingzone.org/patch-notes.

Akademiet (9/8): Weekendens kuld blev genereret alt for stærkt. Hele kuldet
blev trukket tilbage, auktionen aflyst, og de fire managere der havde
skrevet kontrakt eller vundet en, fik hele beløbet retur.

Midtvejspræmier (9/8): En planlægningsfejl forsinkede udbetalingen. Alle 191
hold har fået deres penge.

Bestyrelsen (9/8): Du får nu et varsel før et mandat udløber, og
genforhandlingsvinduet er dobbelt så langt.

Nye hold (10/8): Rytter-generatoren havde et gulv beregnet til et felt på
800 ryttere, men det blev brugt på hver eneste batch. I en batch på otte
promoverede det hele batchen, så enhver ny managers start-trup kom ud som
cirka tre fjerdedele sprintere og en fjerdedel klassementsryttere, uden en
eneste af de øvrige seks typer. Rettet. Det havde været live i 51 dage, så
alle hold oprettet siden 20. juni er ramt. Jeg kigger på hvad de hold skal
have.

Dagligt løbs-resume (10/8): Resumeet kunne udeblive helt hvis serveren
genstartede på det forkerte tidspunkt. Ingen fejl, intet nyt forsøg, bare en
dag uden resume. Rettet.

Desuden: sæson 3-kalenderen genbygget, potentiale-stjerner farves ikke
længere efter alder, nedkørselsfinaler samler feltet, og en række mindre
rettelser.
```
</details>

---

## B. Forklaringen → fastpin den

Discord-sweepen peger på denne som den der fjerner flest spørgsmål. Spillerne har opdaget en
grundlæggende modelændring gennem symptomer i stedet for gennem en forklaring.

```
How rider types work now

A rider's type used to be recalculated every night from his current
abilities. That was a loop: his type set his long term ceilings, and the
next night those ceilings set his type. Once a rider drifted, the loop kept
pushing him the same way, every night, on its own. That is how roughly three
out of four player-owned riders became fighters. It wasn't your training and
it wasn't bad luck.

The loop is closed. A rider now has one type, and the game cannot change it
on its own.

His type is no longer a description of what he's good at today. It's what he
was born with, and what his ceilings are shaped around. He can still be
strong at something outside it.

The race engine does not read rider type at all. A wrong label never cost
you a place in a race. What it cost was the shape of his ceilings.

Climbing training: some of you stopped training climbing because it stopped
producing progress, and some switched away from the mountains entirely. That
was real, and it was the same root cause. For your young riders it has
already reversed: the climbing ceiling went up for 222 of them, by up to 48
points, and down for none. The only abilities that got tighter are
aggression and punch, which is the fighter signature being trimmed away. If
you moved your training away from the mountains, move it back. Riders over
22 are covered by a correction I'll post about before it runs.

Four pairs of types are still too similar for the game to tell apart: time
trialist and GC, puncheur and climber, rouleur and cobbles rider, rouleur
and breakaway rider. A rider sitting between two of them can look unstable,
which is why a few of you have seen one change type twice in 48 hours. I
know exactly why and it's on the list.
```

<details><summary>Dansk</summary>

```
Sådan virker ryttertyper nu

En rytters type blev tidligere genberegnet hver nat ud fra hans nuværende
evner. Det var en løkke: typen satte hans lofter, og næste nat satte de
lofter hans type. Når en rytter først var gledet, blev han skubbet samme vej
hver nat, af sig selv. Sådan endte cirka tre ud af fire spiller-ejede
ryttere som fightere. Det var ikke din træning, og det var ikke uheld.

Løkken er lukket. En rytter har nu én type, og spillet kan ikke ændre den af
sig selv.

Typen er ikke længere en beskrivelse af hvad han er god til i dag. Det er
hvad han blev født med, og det hans lofter er formet efter. Han kan sagtens
være stærk i noget uden for den.

Løbsmotoren læser slet ikke ryttertype. En forkert type har aldrig kostet
dig en placering. Den kostede formen på hans lofter.

Klatretræning: nogle af jer holdt op med at træne klatring fordi det holdt
op med at give fremgang, og nogle lagde træningen helt væk fra bjergene. Det
var ægte, og det var samme rodårsag. For jeres unge ryttere er det allerede
vendt: klatre-loftet gik OP for 222 af dem, med op til 48 point, og ned for
ingen. De eneste evner der blev strammet, er aggression og punch, altså
fighter-signaturen der beskæres væk. Har du lagt træningen væk fra bjergene,
så tag den tilbage. Ryttere over 22 er dækket af en korrektion jeg skriver
om her, før den kører.

Fire par af typer ligner stadig hinanden for meget til at spillet kan skelne
dem: tidskører og klassement, puncheur og klatrer, rouleur og
brostensrytter, rouleur og baroudeur. En rytter mellem to af dem kan se
ustabil ud, og det er derfor et par stykker har set en skifte type to gange
på 48 timer. Jeg ved præcis hvorfor, og det står på listen.
```
</details>

---

## C. Known issues → `#patch-notes`

Erstatter `2026-08-10-known-issues.md`. Fire linjer i det udkast holdt ikke længere.

```
Known issues and fixes (Aug 7-10)

Academy "super riders" (Aug 7-9, resolved): A generator bug created 374
prospects with wildly inflated abilities and values. The auction was
cancelled, the riders removed, and the 4 managers who signed one were
refunded in full. If you took a loan or sold riders to bid on one, those
knock-on costs aren't covered yet. Message me and I'll sort it out.

Academy showed empty while the mail said a class had arrived (Aug 9,
resolved): That class was among the riders removed above. A new one was
seeded the same evening. I'm still fixing the underlying issue so a mail can
never point at riders that no longer exist.

Youth prospects starting slightly too weak (known, fix in progress): The Aug
9 hotfix overcorrected. A full progression rework is underway. Hidden
potential is unaffected.

Too many fighters (root cause fixed Aug 9-10, already visible on the riders
you own): Roughly 3 out of 4 player-owned youth riders were labelled
fighters regardless of their real profile, and GC talents could never come
out of an academy at all.

I called this fixed on Aug 9 and it wasn't fully. The deeper problem was
that a rider's type and his ceilings were calculated from each other every
night, so his type could drift back no matter what we corrected. That loop
is closed, and the correction to your young riders has already run. Their
ceilings followed the same night. New academy classes keep the profile they
were born with from Aug 16.

Climbing not improving in training (known, already reversed for young
riders): Same root cause. A rider relabelled away from climbing had his
climbing ceiling lowered, so there was nothing left to grow into. No young
rider's climbing ceiling was lowered, and 222 had theirs raised by up to 48
points. Riders over 22 are covered by the correction below.

New teams got squads of only sprinters and GC riders (Jun 20 - Aug 10,
fixed): The generator had a floor calibrated for 800 riders but applied to
every batch, so a new manager's 12 riders came out as roughly three quarters
sprinters and one quarter GC riders. Every team created since June 20 is
affected. Fixed. I haven't decided what those teams should have, and I'd
rather say that than promise something I haven't worked out.

One-time correction for riders over 22 (being prepared): The young riders
are done. The older ones aren't, and they were hit by the same loop. Some
will change type, some will see their ceiling adjusted. No rider loses any
current ability, and no market values change. I'll post before it runs.

Academy signing fees too high (known, not yet fixed): 760k-1M for 2-star
prospects is out of line. On the list.

Mid-season prize money (resolved): Fixed Aug 9, all 191 teams paid.
```

<details><summary>Hvad der er ændret fra dit 9/8-udkast</summary>

| Linje | Ændring |
|---|---|
| "visible from Aug 16" | → **allerede synligt**. Ungdoms-baselinen gik live 9/8 18:53; sweepen kl. 22 skrev nye typer. Baroudeur blandt menneske-ejede under 22 faldt fra 74,1 % til 16,2 % samme nat. 16/8 er datoen for første akademi-kuld med fast anlæg. |
| "correction for existing **young** riders" | → gælder nu **over 22**. Type-delen for de unge er kørt, lofterne fulgte med. |
| "The correction below is what restores it" | → **allerede vendt**. Klatre-loftet sænket for **nul** unge, hævet for 222. Nyligt låste evner: aggression 136, punch 84, climbing **0**. |
| "puncheur and rouleur recognised less reliably" | → skåret. Gælder nye akademi-ryttere; blandt de eksisterende unge er rouleur tværtimod over-repræsenteret. |
| **NYT** | nye hold fik ubrugelige start-trupper (PR #3589 merged 10/8) |
| **NYT** | de fire uadskillelige typepar — forklarer type-ustabiliteten |

**Bevidst udeladt:** at 70,4 % af de menneske-ejede over 22 også er fightere. Linjen "de ældre er
ikke rettet endnu" siger det ærligt uden et tal der skaber uro. Spørger nogen: 70,4 % mod
AI-holdenes 1,4 %, fordi kun menneskehold tikkes hver nat.
</details>

---

## D. Varsel FØR reparationen kører

**Post denne før du kører noget.** Fire tal i `[parentes]` udfyldes fra den valgte indstilling.

```
A one-time correction to rider types runs on [DATO] at [TID]

This is the last part of the fighter problem. It affects riders aged 22 and
up. Your young riders were corrected on Aug 9.

Every rider gets one fixed type, chosen once, that the game can never change
on its own again. His ceilings are then rebuilt to match.

About [X] % of your squad will show a different type the next morning. On an
average squad that's [Y] riders out of [Z].

Nothing else changes. No rider loses a single point of current ability. Form,
contracts, salary, potential and results are untouched. Market values don't
move, because rider values are frozen right now. And the race engine doesn't
read rider type at all, so this changes nothing about how your riders
perform.

What does change is the shape of his ceilings. For most riders the ceilings
that belonged to a profile he never had get trimmed, and the ones that match
him get room. Your rider's own rating for his own type moves by a median of
zero. The tenth hit hardest lose 5 points on a 1 to 99 scale.

I could have run this a week ago and it would have locked in the wrong
profiles, because the data I'd have used was itself produced by the bug.
Waiting cost you a few days of odd looking types. Rushing would have cost
you a squad of permanently wrong ones.

If something looks wrong afterwards, post in #bugs with the rider and I'll
look at it directly.
```

<details><summary>De fire tal + hvad der ikke afhænger af valget</summary>

`[X] %` = andel menneske-ejede der skifter synlig type · `[Y] af [Z]` = median-manager ·
`[DATO]/[TID]` = dit valg, gerne 24 timer efter varslet.

Verificeret og uafhængigt af indstillingen: ingen rytter mister evne (`buildCapsForRider`
returnerer `max(tapered, current)`) · 0,00 % værdi flytter sig (`valuation_type` frosset, #3345) ·
race-motoren læser 0 gange `primary_type` · rating for egen type median 0, p10 −5.
</details>

---

## E. Rytme fremadrettet

1. **Byg dæknings-vagten fra [#623](https://github.com/NicolaiDolmer/CyclingZone/issues/623).**
   `check-patch-notes-version.js` tjekker i dag kun format, aldrig om en spillervendt PR manglede
   en note. #623 målte 5 % miss-rate, anbefalede BUILD 25/5, og blev aldrig bygget. De to huller
   i v7.110 er netop den 5 %.
2. **Discord-posten skal falde ud af patch-noten.** Siden opdateres som del af arbejdet;
   Discord-posten er en separat beslutning du skal huske. Den taber altid. En cron der lægger et
   **udkast** klar lørdag ville lukke det. Automatisk udsendelse frarådes — tonen i patch notes er
   skrevet til en side man opsøger.
3. **Fastpin tre forklaringer:** B ovenfor · rollback-politikken (hvorfor du ikke ruller en hel
   dag tilbage — den findes kun i en ophedet 1:1 fra 9/8) · hvad "åben beta" betyder i praksis.
4. **Sig det i UI'et, ikke kun i Discord.** Da akademiet var frosset 9/8 stod fanen bare tom, og
   to spillere læste det som tab. En banner-linje slået til fra `app_config` ville have fjernet
   tre af fire misforståelser i sweepen.
5. **Fast ugentligt tidspunkt, lav ambition.** To linjer er nok når der ikke skete mere. Sweepen
   viser at communityet bærer meget — risikoen er ikke frafald, men træthed hvis
   type-ustabiliteten fortsætter uden en synlig "vi er færdige nu"-markering.

---

## Ét løfte der mangler

9/8 kl. 22:14 lovede du @knud_r_flink et endeligt svar "i morgen" om lånegebyret efter den
aflyste auktion. Jeg kan ikke se svaret i sweep-vinduet. Issuet findes
([#3577](https://github.com/NicolaiDolmer/CyclingZone/issues/3577)), så det er ikke glemt i
systemet — men spilleren venter stadig, og det var netop dét der udløste udbruddet.
