# Forum-indlæg: "The future of: The race engine" (7/9 2026, v2)

> Fjerde i ejerens "The future of:"-serie. Ejerens egen forum-stil, kategori `feedback_ideas` (eller `tactics`). EN only.
>
> **v2 (ejer-rettelse 7/9):** nyt afsnit om hvad den nye motor gør anderledes, styrt-spørgsmålet fjernet, spørgsmål om andre spil peger nu på Velo Victory og Football Manager.
>
> **Fakta verificeret 7/9:** `race_engine_v4 = off`, v3 kører S3 færdig. Alt i "what is new"-afsnittet er bygget OG koblet ind pr. `RACE_ENGINE_RULES.md` §2 (M1-M16, F3 koblet 6/9, F4 flip-infrastruktur 6/9). Taktik-fanen findes (PR #4913). Fog of war overholdt: ingen procenter, multiplikatorer eller grænser i teksten. Sidevind/vifter er IKKE med i v4 og nævnes ikke som kommende.

---

**Titel:** `The future of: The race engine`

```
Hep!

This one is the big one. Do you want to help me shape the future of the race engine?

The engine is the heart of the whole game. Transfers, training, money, none of it matters except because of what happens between the start and the finish line every hour. So this is the part I care most about getting right.

Where it is today: season 3 is running on the engine you know. I have a rewritten one on the bench. It is not live. I test it against the current engine across the whole calendar, and it goes live when it beats it, not on a date. You will hear about it in here when it does.

But let me tell you a bit about what is actually different, because it is not a tune-up. It is a new engine.

The current engine looks at the stage as one thing and works out a result. The new one rides the route. Every stage is split into its real pieces, climbs, descents, flat, cobbled sectors, and the riders go through them one by one. Groups form and split along the way, and the group you are in when you hit the line is what decides your result. That one change is what makes everything below possible.

What is new in the engine on the bench:

- Every rider has an energy model. A sustained level he can hold all day and a reserve he can burn for attacks and sprints. Burn it too early and it is gone when it matters.
- Climbs select. The front group on a mountain stage is made of the riders who can actually hold the pace, not a score.
- Descents are real. A good descender can gain time, and a worse descender can never take time from a better one in the same group.
- Breakaways behave like breakaways. You can send a rider up the road, and the peloton decides whether to chase.
- Sprint trains. Set a leadout, and your sprinter gets delivered instead of just being a fast number.
- Long days wear you down. Monuments take more out of a rider than a normal one day race, and a stage race adds up day by day.
- Cobbles and gravel are their own thing, with sectors the engine actually rides through, not a flat stage with a label.
- Weather matters. Rain and wind slow the stage down and hit some riders harder than others, and rain makes cobbles and descents more dangerous.
- Crashes are no longer all or nothing. A light crash costs you time. A hard crash costs time and days. Only the serious ones end a race. And a puncture or a broken chain is only ever time, never an injury, never the end of your race. A teammate nearby means a faster wheel change.
- A real time limit, with the grupetto. Finish too far back and you are out of the stage race. But a big group that comes in together gets saved, exactly like on a real mountain day.
- Team play. Your captain is protected by his helpers, and the helpers pay for it in the result. No free work.
- Intention per rider per stage. On top of the role, you tell each rider how hard to go today: sit in the grupetto, save, normal, protect the leader, or all out. There is a tactics tab on every race for this, with orders per stage.
- Sprint points, mountain points and bonus seconds are taken from where the riders actually are at the passage, instead of guessed afterwards.
- Team time trials are ridden as a team. Your time is the time of your fifth rider across the line, so you need a team, not one strong guy.

Everything in that list is built and connected. What I am doing now is running it against the current engine over and over until it is clearly better and not just different. It is close.

That is the technical part. Now I want the greedy version from you :) Dont filter it for "what is realistic for one guy", I will do that part myself.

Some questions for inspiration. You dont have to answer all or any of them:

- What is the moment you want to be possible? The 60 km solo that somehow sticks. The teammate who blows himself up covering a move. The sprinter dropped on the last climb who claws his way back. Name the moment you want to happen to YOUR team one day.
- What annoys you most about race days as they are today? Be blunt, it is way more useful to me than praise.
- How much should you be able to steer, and how much should the race just decide? Orders per stage, a team radio during the race, or set your roles and let it play out? I have a fairly strong opinion here, but I want yours first.
- The stage report: every stage already has a written story and tags like off day, peak, sacrifice, outsider win. If you havent opened one, do that first. Then tell me what it still doesnt tell you.
- Following a stage while it runs, instead of reading the result afterwards. Would you actually use it, or would you check the result on your phone anyway?
- Have you played Velo Victory or Football Manager? What did they do on race day or match day that made you feel like the manager, and what did they get right that this game doesnt yet?

Nothing is too big for this thread. I will tell you honestly which ideas are close and which are years away.

Lets have a chat about it - I will share progress in here when the engine has news :)

Thanks in advance!
```
