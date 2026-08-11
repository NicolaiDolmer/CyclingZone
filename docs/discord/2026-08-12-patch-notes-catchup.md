# Discord-pakke 12/8 — patch notes-indhentning v7.112 til v7.117

**Ejeren poster selv. Intet herinde er sendt, og intet må sendes af en agent.**

Grundlag: `frontend/src/data/patchNotes.js`. Sidste indhentning i `#patch-notes` var 10/8
og dækkede v7.106 til v7.110. v7.111 (ryttertyper) blev meldt ud i forum-tråden
"New update: Rider types". Alt nedenfor er shippet siden og er aldrig meldt ud.

Alle tal er hentet direkte fra patch notes, som selv er målt mod prod.

---

## A. Patch notes-indhentning → `#patch-notes`

```
Patch notes catch-up (v7.112 to v7.117)

All of this is already live. Full detail is on cyclingzone.org/patch-notes.

Training (Aug 12): Several of you said climbing would not rise no matter how
much VO2 max training you gave a rider. You were right, and the page was
hiding it. A focus trains more than one ability at once, and every ability
has its own lifetime ceiling. Once it reaches that ceiling it never rises
again. But the progress bar only showed the ability closest to its next
point, so a rider whose climbing was finished while tempo was still climbing
looked completely normal. Across the game 892 riders are in that state right
now, and 142 are in a focus where every ability has topped out, so the
training day produces nothing at all. The page now names the ability that
has reached its ceiling, and the focus list marks a focus that has nothing
left to give before you pick it. Nothing about how training works changed.
You can now see it.

Auctions (Aug 11): If your connection dropped in the moment you confirmed a
bid or saved an auto-bid limit, the button stayed on its loading state and
nothing else happened. No error, no confirmation, no way to tell whether the
bid went through. Most likely to catch you on a phone. Both actions now stop,
tell you the server could not be reached, and reset so you can try again.

Academy (Aug 11): An academy offer you never answer is meant to expire after
seven days and go to a 24 hour youth auction. Only 30 a day were allowed to
expire while far more than 30 a day were arriving, so the queue grew: 327 of
368 waiting offers were already past their seven days, the oldest since July
25. The limit is now 45 a day, lifting itself to 60 while there is a backlog.
You will see more youth riders reaching the auction market over the coming
weeks.

Academy (Aug 11): Every rider has a main type and a second type, but only
about one prospect in seven was born with the second one decided. For the
rest the game read it off their abilities and could read it differently next
time it recalculated, so the second type was never really theirs to keep.
Every new prospect is now born with both types set, and both stay put.
Riders already in the game keep everything they have.

Riders (Aug 11): The identity fix that corrected your riders under 22 on the
night of Aug 9 has now run for every rider in the game. 7,998 riders were
given a fixed primary and secondary type drawn from what they were born
with. Baroudeur, which the old loop had pushed to 76.7 percent of your
riders, is down to 11.5 percent. Values and salaries were not touched at any
point, and everything was backed up first.

Training (Aug 11): 7,708 riders got new ability ceilings to match their
corrected type. For player-owned riders the climbing ceiling went up for 32.9
percent and down for 7.2 percent. The training progress that unlocks shows
from your next training run, not immediately.

Academy (Aug 10): Sunday's intake was generated far too strong and was
removed, which left most academies empty and sent some of you an email about
a squad that was not there. Both were our mistake. Every academy has received
the two candidates Sunday should have given you, plus two extra as an
apology. That is 762 prospects across 192 academies, on the corrected
calibration: a 16 year old now starts genuinely raw and reaches graduation
level around 20, instead of arriving fully formed.

Academy (Aug 10): Prospects were being born a year older every season. The
generator measured age against the calendar year while the rest of the game
reads it from the season number. In season 3 roughly one prospect in six
would have been born outside the academy age range entirely. The generator
now reads the same age everything else does. Existing riders are untouched.

Academy (Aug 10): Fourteen prospects still sitting in academies had been
generated under an older calibration and came out well above what a young
rider should be. The most extreme was a 19 year old whose best ability was
above the average senior professional. They keep their name, age, potential
and type; only the current level changed. Nobody had paid for any of them.

Notifications (Aug 10): The academy email was sent while the candidates were
still being built, so if anything went wrong in the seconds after, it pointed
at riders that were not there. It now goes out only after every candidate is
complete, and if the batch fails, no message goes out at all.
```

---

## B. Kort version → `#dansk-snak`

```
Patch notes-indhentning (v7.112 til v7.117), det korte:

Træning (12/8): I havde ret i at klatring ikke steg. Et fokus træner flere
evner, og hver evne har sit eget livstidsloft. Når en evne rammer loftet,
stiger den aldrig igen. Men baren viste kun den evne der var tættest på
næste point, så en rytter hvis klatring var færdig, mens tempo stadig steg,
så helt normal ud. 892 ryttere står sådan lige nu, og 142 i et fokus hvor
alt er toppet. Siden navngiver nu den låste evne og markerer et fokus der
intet har tilbage at give. Selve træningen er uændret. I kan nu se den.

Auktioner (11/8): Et bud afgivet på en tabt forbindelse blev hængende i
loading uden fejl eller bekræftelse. Det siger nu selv fra.

Akademi (11/8): Ubesvarede tilbud udløb for langsomt og hobede sig op. 327
af 368 ventende tilbud var over deres syv dage. Grænsen er hævet, så flere
ungdomsryttere når auktionsmarkedet i de kommende uger.

Akademi (11/8): Nye emner fødes nu med begge ryttertyper låst fra dag ét.

Ryttere + træning (11/8): Identitets-rettelsen er kørt for alle ryttere.
Baroudeur er nede fra 76,7 % til 11,5 % af jeres ryttere. Værdier og lønninger
blev ikke rørt, og alt blev sikkerhedskopieret først.

Akademi (10/8): Søndagens kuld blev genereret for stærkt og fjernet. Alle
akademier har fået de to kandidater søndagen skulle have givet, plus to
ekstra som undskyldning.

Fuld detalje på cyclingzone.org/patch-notes.
```

---

## C. Svar på forum-spørgsmålet (ubesvaret siden 11/8 08:39)

Tråden "New update: Rider types", spørgsmålet var: *"What do you mean 'it can be reversed'?"*
Det refererer til sætningen om at ryttertype-migrationen kunne rulles tilbage.

```
Fair question, and I was too vague.

Before that migration ran, I saved a full copy of every rider's primary and
secondary type as they were beforehand. If the new types had turned out worse
than the old ones, I could have written that saved copy straight back and put
every rider exactly where he was. That is what "it can be reversed" meant.

Two things it does not mean. It was never a per rider undo, so I could not
have restored one rider and left the rest. And it does not stay available
forever: the longer riders train, get bought and sold, and race under the new
types, the less sense a rollback makes, because the rest of the game has
moved on around them.

I am not planning to use it. The new types measure much closer to what they
are supposed to be than the old ones did, and nobody's value or salary was
touched by the change. But the backup exists, and I would rather you know
that than assume I ran something I could not walk back.
```

---

## Rækkefølge

A og B kan poste når som helst, og gerne samtidig. C bør poste hurtigt, uafhængigt af de to.
