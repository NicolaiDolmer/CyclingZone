# Spillersvar 22/9 (udkast, ejeren poster selv)

> Kilde: forum (prod-DB) + Discord-sweeps 16-22/9. Ejeren har svaret alt andet i perioden; rating-klagen 17/9 blev lukket via patch notes 20-21/9. Discord = kun EN (ejer 20/9). Fakta er slået op i issues/kode 22/9; det der kræver ejer-viden er markeret.

## Forum

**1. "Long periods of inactivity" (feedback_ideas, 22/9) — Reynolds Team spørger om der sker noget FØR ligaerne sættes.**

> Yes, it runs before the season 4 divisions are set. A team with no login for 30 days is parked outside the divisions at the switch. Nothing is deleted, and the manager gets a "sign up for next season" button that puts the team back in the lowest division with room. So a team nobody has touched for weeks will not take a promotion spot. I go through the list by hand before it runs, so if I get one wrong, tell me.

Fakta: #4592 (30 dages login-grænse, parkering ved S4-skiftet, #452 tilmeld-knap). Kandidatlisten er ejer-gated.

**2. "More races for lower divisions" (feedback_ideas) — Agility Colombia 21/9: D1 har 19 endagsløb 28/8-15/9 og 2 derefter.**

> You are both right, and it is fixed in the season 4 calendar. Every division gets 140 race days, 5 per calendar date, spread evenly across the whole season instead of a pile of one-day races in two weeks and then nothing. Lower divisions get the same number of race days as division 1. I generate the calendar before the switch and post it as soon as it is set.

Fakta: #5169 merget 21/9 (140 løbsdage, måde B, 5 pr. dato), #5405 (S4-kalender, kalibrering #5469).

**3. "Themed teams" (off_topic):** spillersnak, men de gætter på reglen for national kerne ("35 %" vs. "14 ryttere"). Kort faktasvar:

> Love this thread. The actual rule for a national core: at least 4 riders AND at least 35 percent of your squad from the same nation. So 14 of 38 counts, 13 of 38 does not. What happens when two nations both clear the bar I will check and write into Help together with the rule, so nobody has to guess.

Fakta: `backend/lib/boardIdentity.js` linje 307-308; hjælpetekst-issue #5483.

## Discord

**4. #bugs "Unable to see my dashboard" (16/9, CORS) — du lovede at tjekke "tidligt i morgen".**

> Followed up on this. It was not CORS: Firefox reports "no response from the server" with different words than Chrome, and my error filter swallowed it, so the dashboard just looked dead. Fixed on 17/9: you now get a clear "cannot reach the game server" message instead. If you still cannot load it, tell me which DNS you use. A few players on Quad9 are blocked from the API host and I am working on that separately.

Fakta: #5312 → PR #5324 (merget 17/9). Quad9: #5323.

**5. #dansk-snak (19-20/9) + #feedback-and-ideas "Are new trainings overtuned?" (20/9) — flere skader efter de tre nye træningsformer, en 5-ugers skade.**

> Several of you report more and longer injuries since the three new training forms came in. As far as I can see the injury chance itself was not changed with them, but I am checking the numbers this week, and I have two open issues on it: whether Echelon Drills' bonus is too strong, and the missing fatigue warning at 70. Coming with the season switch: injury length is counted in race days, 5 to 25, instead of calendar days, so a five-week injury will not happen again. I will post here when I know more.

Fakta: #5456 (Echelon +2/+3), #5418 (4 skader på en uge, træthedsadvarsel), #5462/#5465 (5-25 løbsdage, bag flag). **Ejer-tjek:** er skadesrisikoen ændret i september? Ingen evidens fundet, derfor "as far as I can see".

**6. #feedback-and-ideas "Messaging system" (16/9) — indbakken åbner øverst.**

> Logged and not fixed yet. It will open at the newest message.

Fakta: #5313 (claude:todo).

**7. #general (19/9) — "View details" i Race Center viser ikke løbet på mobil.**

> Logged as a bug, not fixed yet. Race Center is the workaround until then.

Fakta: #5417 (claude:todo).

**8. #staff-chat (21/9) — D1-rangliste: ét hold fylder hele tabellen uden navn.**

> Logged it. It looks like a display bug in the division table, not the points behind it. I will confirm when it is fixed.

Fakta: #5471 (oprettet 22/9 morgen, formodet Founder-mærket).

**9. #questions-and-answers (18/9) — kan en rytter på "work" selv vinde fra et udbrud?**

> Yes. A rider on "work" rides for the captain, but nothing stops him from being in the break when it goes. If the break stays away, he can win. The role decides who he helps, not whether he is allowed to win.

Fakta: v3-motoren (raceRunner/raceSimulator): hjælpere er score-neutrale, udbrud afgøres af placering, ikke rolle.

**10. #dansk-snak (21/9) — opfølgning på sponsor/upkeep, "200k difference".**

> Not forgotten. I owe you the exact number. I am going through the sponsor payouts this week and will come back with the breakdown for your team.

**Kræver ejer-viden:** hvilket beløb og hvilket hold. Nærmeste issues: #4860 (lukket), #4385 (upkeep pr. løbsdag, åben).

**11. #questions-and-answers (22/9) — "English talk"-kanal:** besvaret af dig 22/9 kl. 08:37 (MCP-tjek). Intet at gøre. Samme for løn-spørgsmålet kl. 11:20.

**13. #dansk-snak (22/9 kl. 11:31) — "angreb hentes næsten altid midt på etapen; mere realistisk mod slutningen / på sidste bjerg". thelamba: enig.**

> Good catch, and you are right. The engine that runs season 3 decides the catch from position, not from where on the course you are, so the break rarely survives to the final climb. The new engine I am building runs the race in segments, so a break can hang on until the last climb and get caught there, or not. It goes live when it beats the current engine in the tests I run, not on a date. I will post the comparison when I have it.

Fakta: v3 = `deriveBreakawayStatus()` på placering; v4 (`backend/lib/engine/v4`, flag off) er segment-baseret. Ikke lovet på dato (roadbook 15/9). Discord kun EN, også i #dansk-snak (din regel 20/9).

## Patch note til #patch-notes (mangler: v7.293; v7.291-7.292 var med i din v7.290-post 21/9)

> v7.293 (21 Sep)
>
> Forum
> Links in forum posts and replies are clickable and open in a new tab.
>
> Assistant
> You get a message when your assistant fills a race squad you left completely empty.
>
> Academy
> Graduation Day has its own page. Choose who moves up, is sold or is released.
>
> Full detail as always at cyclingzone.org/patch-notes.

**12. #feedback-and-ideas "Planning → Team" (19/9) — skift etape i udtagelsen.**

> Good one, logged. Next and previous stage right from the selection screen, without going back through the menu.

Fakta: #5479 (oprettet 22/9).
