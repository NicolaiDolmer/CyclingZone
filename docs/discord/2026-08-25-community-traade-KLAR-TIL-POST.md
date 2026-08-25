# KLAR TIL POST: community-tråde (EN)

> **Sådan bruges filen:** hver blok har en META-linje (hvor og hvilken titel) og derefter selve teksten
> i en kodeboks. Kopiér KUN indholdet af kodeboksen. META-linjerne skal ikke i Discord.
> Discord-grænse: 2.000 tegn pr. besked. Opslag delt i flere beskeder er markeret.
>
> **Opdateret 25/8 kl. 08:05.** Den 21/8-version var skrevet til en uge der er overstået. Tre ting er ændret:
> 1. **Race engine v4 bestod IKKE sin gate 23/8** (#4132). Spillet kører v3 i dag. Roadmap-opslaget siger det nu ligeud, og **taktik-opslaget er trukket ud af planen**.
> 2. **Tal genmålt mod live-DB 25/8:** 240 konti (var 233), 86 inde i spillet sidste 7 dage (var 80), 132 sidste 30 dage.
> 3. **"Season 3 starts Tuesday" er nu i dag.** Alle datoformuleringer er rettet til nutid.
>
> **Ikke verificeret:** om du allerede har postet nogle af dem. Discord-forbindelsen er nede i denne session, så tjek selv før du poster.

---

## Postplan fra i dag

| Dag | Opslag |
|-----|--------|
| **TIR 25/8 før kl. 11** | F · Predict season 3 |
| **TIR 25/8 middag** | 4 · September-afstemningen (2 beskeder) |
| ONS 26/8 | 5 · Roadmap 3 måneder (3 beskeder) |
| TOR 27/8 | 6 · Dashboard |
| FRE 28/8 | 1 · Marketing |
| LØR 29/8 | 2 · Race engine-drømmen |
| SØN 30/8 | A · What nearly made you quit |
| Uge 36 | 7 · U23 · B · Your first week · E · Help-sektionen |
| ~5/9 | D · The money |
| **HOLDT TILBAGE** | 3 · Taktikskærmen (til v4 flippes) · C · Season 2-screenshot (kun hvis du vil køre den forsinket) |

---

## F · Predict season 3

**META** · Kanal `#general` · ingen titel, bare et opslag · **post FØR kl. 11**

```
Predict season 3

Racing starts today at 11:00. Get your predictions in now, while nobody has an excuse yet 😄

**1. Who wins Division 1?**
**2. Who gets promoted out of your own division?**
**3. Which rider has the season nobody sees coming?**
**4. The bold one:** something you are certain will happen, that nobody else here would guess.

I am saving this thread and dragging it back up when the season ends. No quietly editing your answers later ✌️
```

---

## 4 · September-afstemningen

**META** · Kanal `#feedback-and-ideas` · Titel: `Season 3 is here: pick the 3 things I should build in September` · **2 beskeder**

**Besked 1:**

```
Season 3 is under way 🙂 That gives me roughly a month of building before the season gets deep enough that big changes get risky, and I would much rather spend it on what you want than on what I assume you want.

So here is the honest list of what I can realistically pick from in September. All of it is real, scoped, and something I could start tomorrow.

**Reply with your top 3 by number.** One line of "why" is worth more to me than the vote itself.

**Racing**
1. Tactics beyond the first version: leadout trains, chase duties, attack triggers, protect the leader
2. Race reports that name your own orders: "he was up the road because you sent him there"
3. Follow a stage while it is actually running, instead of reading the result afterwards

**Your team**
4. Dashboard: reorder every card, not just hide them, and make the whole page far more compact
5. A settings area: pick your country and your team's country, and have the board care about it
6. Training with a lot less clicking: apply a plan to a whole group at once
7. Scouting with real capacity per scout, and routing you control

**Market and money**
8. Rider values that react to what people actually pay at auction
9. Contract length that changes the wage: longer deals cost more per year
10. Loans and buyout clauses in the transfer system
11. Email you when something happens while you are away, so you never miss an auction again

**The world**
12. U23 teams with their own calendar, fed by your academy
13. A press engine: automatic stories about your season and your rivals
14. Rivalries between teams fighting over the same riders and the same places
15. Give the team doctor something to actually do: fatigue, injuries, real medical calls

I am not going to build all 15 in September, obviously 😄 I will build some, properly, and I will come back and tell you which ones and why. And if your idea is not on the list, say it anyway. The list is what I have thought of, not what is possible ✌️
```

**Besked 2:**

```
One more thing, because it matters before you vote: a few things people keep asking for are already in there, and I do not think everyone has found them 😅 Go and look first:

- **The story of the stage.** Open any stage and you get a written account of what actually happened, plus tags on riders: off day, peak, sacrifice, outsider win, collapse, crash.
- **The Race Centre.** Today's racing collected in one place.
- **Week plan.** The training page has four tabs now, and the second one is your weekly rhythm.
- **Hall of Fame.** Records, managers and division history.
- **Swaps.** You can already trade rider for rider in the transfer system.
- **Dashboard customise.** The button in the top right corner hides the cards you never use.

If any of those were news to you, that is genuinely useful information for me on its own. Tell me where you would have expected to find them, because clearly they are not where you looked 🙂
```

---

## 5 · Roadmap, næste 3 måneder

**META** · Kanal `#the-roadbook` · **3 beskeder** · **Omskrevet 25/8:** afsnittet om motoren fortæller nu at v4 IKKE bestod, i stedet for at love at den gik live mandag.
**Valgfri blok markeret efter besked 3** (/pro). Anbefaling: slet den, så længe checkout er pauset.

**Besked 1:**

```
Where this game is going for the next three months

Season 3 is under way, so this is a good moment to say out loud where I am taking this game, and just as importantly where I am not.

One rule before the list: **I do not promise dates.** I have learned the hard way that a date I miss costs more trust than a feature I ship late gains. The order below is roughly the order I expect to work in, and it can change if something breaks or if you tell me I have it wrong.

**Right now: the new engine did not pass, so we are racing on the current one**

I have spent weeks rebuilding the race engine, and the plan was for season 3 to start on it. Before flipping it on I ran it against the current engine across the entire season 3 calendar, and it failed on three counts: the gaps it produced on climbs were several times too big, sprinters won far too often, and descents still were not right.

So it is not live. Season 3 is racing on the engine you already know, and the new one gets fixed and tested again rather than shipped because I wanted it to be ready. I would rather tell you this than quietly launch a season on something I did not trust.
```

**Besked 2:**

```
**Next, roughly September**

- Fixing those three things and running the comparison again. It ships when it beats the current engine, not on a date.
- Stage reports that also explain your own tactical orders, not just what happened.
- More tactical orders per stage.
- Rider values that react to what the market actually pays at auction, instead of only to a rider's own numbers.
- The dashboard rebuilt: reorder every card, not just hide it, and the whole page far more compact.

**After that, roughly October**

- The youth side: U23 as a real tier with its own races, fed by the academy you already have.
- Contracts and the transfer market with more depth: loans, buyout clauses, contract length that changes the wage.
- Giving the Hall of Fame something real to remember, so a season leaves a proper trace.

**Later, roughly November and beyond**

- The world around the racing: press, rivalries, fans, reputation. The things that make a season feel like a story instead of a table.
```

**Besked 3:**

```
**What I will not do**

- I will not punish you for being good. No handicaps for strong teams, no rubber banding. Balance gets fixed by structure, never by slowing the leader down.
- The fairness promise does not move: you cannot pay for better riders, faster training, or better results. Premium can unlock identity, convenience and analytics. Nothing else.
- I will not lock a date and then ship something half finished to hit it.

That is the map. Tell me where I have the order wrong.
```

**[VALGFRI, indsæt før sidste linje i besked 3 hvis du vil nævne /pro nu]**

```
On that last point, since people have asked: there is an optional supporter tier coming back online. The game stays fully competitive without it. I will post properly about it when it is actually open.
```

---

## 6 · Dashboard

**META** · Kanal `#feedback-and-ideas` · Titel: `The dashboard is too long. Help me rebuild it.`

```
Let me start by just agreeing with the complaint: the dashboard is too long. You scroll most of the page to find the one thing you came for, and that means I prioritised the content wrong. It is not you scrolling wrong 😄

So I am rebuilding it. But before I do, I would really like to know how you actually use it.

**1. What do you check FIRST when you log in?** Be honest, even if the answer is "I skip the dashboard completely and go straight to Training". That is genuinely useful to know.

**2. What would you delete from it entirely?** No feelings involved, I promise. If a card has never once been useful to you, say so.

**3. What do you open another page for every single day, that should honestly just be on the front page?**

**4. Mobile or desktop?** And if you use both: what breaks when you switch between them?

Quick note before you answer: **you can already hide cards** with the customise button in the top right corner. If that is news to you, that is a finding in itself, and it goes straight into the rebuild.

What I want to add on top of it: reordering, so you decide the sequence and not just what is visible, and a much more compact layout overall. Fewer cards, tighter cards, less air, and things that belong together sitting together instead of the same topic appearing three times down the page.

And the one I most want answered: **if the dashboard could only show you FIVE things, which five?** That answer is worth more to me than a long list of nice-to-haves ✌️
```

---

## 1 · Marketing

**META** · Kanal `#feedback-and-ideas` · Titel: `If you were me: how would you market this game?` · Tal genmålt 25/8

```
Okay, honest question, and I mean it completely literally 😄 If you had my keyboard for a week, what would you actually do to get more managers in here?

Where I am right now: 240 accounts, 86 of you have been in the game in the last week, and roughly 130 euro ever spent on advertising. Everyone who is here found us through word of mouth, or a link somebody dropped somewhere. That is the entire acquisition story.

So I would rather ask the people who already chose to stay than sit here guessing ✌️

**1. Where did YOU first hear about Cycling Zone?** Be specific. Which forum, which subreddit, which Discord, which friend at work.

**2. Where do cycling manager people actually hang out?** I know the obvious places. It is the ones I do not know that I need. Non English communities count double.

**3. If you had to sell this game to a friend in one sentence, what would the sentence be?** I am honestly bad at this part. The words you use are worth more than the words I invent sitting alone at my desk.

**4. What is the ONE screenshot that would make you click?** Race results? An auction going completely crazy? A rider profile? Your season calendar?

And then the uncomfortable one, which is probably the most useful: **is there anything in the game right now that you would be a little embarrassed to show a friend?** Better that I hear it from you than that I find out by sending strangers in there 🙂

I read every single reply in this thread.
```

---

## 2 · Race engine-drømmen

**META** · Kanal `#feedback-and-ideas` · Titel: `The race engine: what is your dream version of it?` · **Omskrevet 25/8:** siger nu at den nye motor ikke bestod, i stedet for at antyde at den er lige om hjørnet.

```
The race engine is the heart of this whole thing. Transfers, training, economy, none of it matters except because of what happens between 11:00 and the finish line. So this is the part I care about getting right more than anything else in the game.

Where it is heading: a rewritten engine with a real energy model per rider, proper group dynamics, a descent model where a good descender can gain something realistic (and a worse one can never take time from a better one in the same group), and breakaways that behave like actual breakaways.

It is not live yet. I tested it against the current engine across the whole season 3 calendar and it lost on three counts, so it goes back on the bench until it wins. You will hear about it when it does.

That is the boring technical answer though. Now I want the greedy version 😄

**What is your dream race engine?** And please do not filter it for "what is realistic for one guy". I will do that filtering myself, that is my job. Tell me what you would want if I had ten people.

Some prompts, if they help:

- **The stage report.** Every stage already has a written story and a "bigger picture" panel, with tags like off day, peak, sacrifice, outsider win and collapse. If you have not opened one, go do that first. Then tell me what it still does not tell you.
- **What moment do you want to be possible?** The 60km solo that somehow sticks. The teammate who blows himself up covering a move. The sprinter dropped on the last climb who claws his way back. Name the moment you want to happen to YOUR team one day.
- **What annoys you most about race days as they are today?** Be blunt about it. Way more useful to me than praise ✌️
- **How much should you be able to steer, and how much should the race just decide?** I have a fairly strong opinion here, but I want yours before I say mine.

Nothing is too big for this thread. I will tell you honestly which ones are years away.
```

---

## A · What nearly made you quit

**META** · Kanal `#feedback-and-ideas` · Titel: `What nearly made you quit?` · Tal genmålt 25/8

```
Here is a number I look at more than any other: 240 people have made an account. 86 of you have been in the game in the last week.

I am not posting that to guilt anyone 🙂 People try things and move on, that is completely normal. But it does mean the most useful thing I can possibly learn right now is not "which feature is missing". It is: what was the moment you nearly closed the tab for good?

You are the ones who stayed, so you got past whatever it was. That makes you the only people who can actually tell me what it was.

**1. What was your lowest point with this game?** The moment where you thought "okay, maybe this is not for me".

**2. What got you past it?** Somebody in here? A result finally going your way? Pure stubbornness?

**3. What still annoys you every single week?** Not a bug. The recurring friction you have just quietly learned to live with.

**4. If a friend of yours signed up and quit after four days, what would you guess the reason was?**

Be harsh. Genuinely harsh. I would much rather read something uncomfortable now than keep guessing while people disappear without ever saying why ✌️
```

---

## 7 · U23 og junior

**META** · Kanal `#feedback-and-ideas` · Titel: `U23 and junior teams: what should they actually be?`

```
Real cycling has senior teams, U23 teams and junior teams, and I want that in this game. You already have an academy: candidates arrive every Sunday, you scout them, sign them, and promote them when you think they are ready. What is missing is the level in between. Right now a young rider develops in your academy and then just appears in your senior squad. He never races his own age group.

So the plan is three tiers per club, each with its own calendar. The direction is decided. Almost everything about HOW is not, and that is where I need you 🙂

The open questions, and I genuinely have not settled on any of them:

**1. Should U23 races pay prize money, or only develop riders?** Prize money makes them matter. It also turns youth into yet another income optimisation, which might ruin the whole point of it.

**2. How big should a U23 squad be?** Small enough that selection is a real choice, or big enough that everybody gets a race?

**3. Should a U23 rider be allowed to race for the senior team as well?** In real cycling the best young riders get pulled up for the big races. Here it collides with the rule that a rider does one race per day, so it would be a genuine trade off: use him up top, or let him win at his own level.

**4. Junior level: real racing, or purely development?** I lean towards junior being about development and identity rather than results. Convince me otherwise ✌️

**5. How much attention should it cost you per week?** This is my biggest worry by far. Three tiers can easily become three times the clicking, and that kills it for anyone playing on a phone during a lunch break.

**6. What would make you actually care about a 19 year old in your academy?** Watching him win something at his own level? A story about him? A scout who turned out to be right about him two seasons ago?

That last one matters most to me. A youth system that is only numbers is a spreadsheet. I want it to be the part of the game you get properly attached to.
```

---

## B · Your first week

**META** · Kanal `#feedback-and-ideas` · Titel: `Your first week: what confused you?`

```
Everyone in here got through their first week. Not everyone who signs up does, and I am fairly sure the first week is where I lose most people.

The problem is that I cannot see it anymore. I have been staring at this thing for so long that everything looks obvious to me, which makes me the worst possible person to judge it 😅

So think back to your own first days:

**1. What did you simply not understand at first?**

**2. What did you click expecting one thing and get something else?**

**3. What did you only discover much later, that you wish somebody had told you on day one?**

**4. Was there a moment where it finally clicked? What was it?**

And the practical one: **if you had to explain this game to a complete newcomer in three sentences, what are the three sentences?** Whatever you write, I am going to steal it for the actual onboarding, so put some effort in 🙂
```

---

## E · Help-sektionen

**META** · Kanal `#questions-and-answers` · ingen titel, bare et opslag

```
What should the Help section explain that it does not?

There is a Help section in the game, and I have a strong suspicion it answers the questions I thought you would have, rather than the ones you actually have.

So: what have you had to work out by trial and error, or by asking in here, that should just have been written down somewhere?

Anything counts. How training focus actually works. What popularity does. Why an auction extends sometimes and not other times. What the board really wants from you. How fatigue turns into injuries.

Post them as a list if you have several. Every single one becomes a real entry, and I will come back and tell you when it is in 🙂
```

---

## D · The money

**META** · Kanal `#feedback-and-ideas` · Titel: `The money: what feels wrong right now?` · **post tidligst ~5/9**, når der er rigtige S3-tal at holde svarene op imod

```
The economy is the part of this game I have rebuilt the most times, and it is still the part I am least sure about. Wages, rider values and running costs all moved recently, and there is one more calibration pass coming once I have real season 3 numbers to look at instead of my own test data.

Before I do that pass, I want your gut feeling, because the numbers only tell me half the story.

**1. Do you ever feel genuinely rich, or genuinely broke?** Or does your balance just sort of sit there without ever really mattering?

**2. What do you spend money on, and what do you never spend money on?** If there is a whole part of the game you always skip because it never seems worth the cost, that is exactly what I need to hear.

**3. Is a rider's price ever surprising?** Too high, too low, or just plain strange?

**4. What decision would you like money to force you into, that it currently does not?**

To be completely clear about where this goes: I am not asking whether you want more money 😄 I am asking whether the choices feel meaningful. Those are very different questions ✌️
```

---

## C · Season 2 in one screenshot (VALGFRI, den er blevet forsinket)

**META** · Kanal `#team-showcase` · Var tiltænkt søndag 23/8. Sæson 3 er startet, så den er ikke længere aktuel på samme måde. Kør den kun hvis du synes den stadig har liv. **Du skal selv poste et screenshot først, ellers dør tråden.**

```
Season 2 is done. Post one screenshot.

Season 3 has started, so before season 2 disappears completely: post ONE screenshot of your season 2.

Your best result. Your final standing. The auction you massively overpaid on and still do not regret. The rider who finally came good. Whatever your season actually was.

Two rules: one screenshot each, and one line about why that one 🙂

I will go first.
```

---

## 3 · Taktikskærmen: HOLDT TILBAGE, MÅ IKKE POSTES ENDNU

**META** · **Post IKKE.** Taktik-kortet er bygget og merged (#4093), men det er flag-gated til race engine v4, og v4 bestod ikke sin gate 23/8 (#4132). Spillerne kan ikke se kortet i dag. Poster du dette nu, lover du en skærm der ikke findes. **Post det den dag v4 flippes.**

```
The new tactics card: what is missing from version 1?

With the new engine you get a Tactics card on every stage, sitting under your lineup. Your roles stay where they are: Captain, Helper and Free role are unchanged. The card is a layer on top of them, and version 1 is deliberately small.

**What version 1 gives you, per stage:**

- **Breakaway stance for the team:** Chase it down, Neutral, or Let it go.
- **Try the break, per rider:** a flag that raises the chance he goes up the road. It raises it. It never guarantees it.
- **Effort, per rider:** Protect, Normal, or Save.
- Orders lock when the stage starts at 11:00, and the card shows you the lock time.
- Doing nothing is a valid choice. No orders means neutral: your lineup roles, normal effort, neutral on the break. You are never punished for not opening the card.

That is version 1. It is small on purpose, because I would rather ship three orders that genuinely change a race than twelve that quietly do nothing.

**So: what is the next order you want, and what should it actually do?**

Already on my own list, so you know what you are adding to:

- A named leadout train for a sprint finish (right now leadout work just happens automatically on flat stages, you cannot direct it)
- Chase duties: which of your riders is allowed to burn himself in the chase
- GC protection: keep these riders with my leader at all cost
- Time targets: "do not lose more than a minute today"
- Attack triggers: attack on the final climb, attack if the gap goes under X

Two harder ones I would like your take on:

**Should orders ever be changeable mid race?** Right now they lock at the start. Live orders are a much bigger build.

**How much should a good order be worth?** A tactic that wins you a race you had no business winning is fun once and broken forever. Where is that line for you?
```

---

## DA-pointers til #dansk-snak

**META** · Post disse i `#dansk-snak` når den tilsvarende engelske tråd er oppe, så feedbacken stadig samles ét sted.

```
Jeg har lagt en liste med 15 ting op i #feedback-and-ideas, som jeg kan bygge i september. Vælg dine 3 (skriv bare numrene). Én linje om hvorfor er mere værd end selve stemmen. Det er ikke en ønskeliste jeg kigger på engang, jeg bygger nogle af dem 🙂
```

```
Dashboardet er for langt, og det er min skyld, ikke jeres. Jeg bygger det om. Der ligger en tråd i #feedback-and-ideas med fire spørgsmål. Det vigtigste: hvis dashboardet kun måtte vise FEM ting, hvilke fem så?
```

```
Ny tråd i #feedback-and-ideas om løbsmotoren. Ikke "hvad er realistisk", men hvad I ville ønske jer hvis jeg havde ti mand. Og prøv lige at åbne en etape først: der ligger allerede en skrevet historie om løbet, som jeg tror de færreste har fundet.
```

```
Tråd om U23- og juniorhold i #feedback-and-ideas. Retningen er besluttet (tre niveauer pr. klub), men næsten alt andet er åbent: præmiepenge på U23-løb eller ej, hvor stor en U23-trup skal være, om en U23-rytter må køre for seniorholdet. Sig din mening.
```

```
Ærlig tråd i #feedback-and-ideas: 240 har oprettet en konto, 86 har været inde i spillet i sidste uge. Jeg spørger dem der BLEV, hvad der var tættest på at få jer til at lukke fanen. Vær hård. Det er mere brugbart end ros.
```
