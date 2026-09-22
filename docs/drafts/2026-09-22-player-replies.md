# Spillersvar 22/9 (udkast, ejeren poster selv)

> Kilde: forum (prod-DB) + Discord-sweeps 16-22/9. Ejeren har svaret alt andet i perioden; rating-klagen 17/9 blev lukket via patch notes 20-21/9. Discord = kun EN (ejer 20/9). Fakta er slået op i issues/kode 22/9; det der kræver ejer-viden er markeret.

## Forum

**1. "Long periods of inactivity" (feedback_ideas, 22/9) — Reynolds Team spørger om der sker noget FØR ligaerne sættes.**

> Yes, it runs before the season 4 divisions are set. A team with no login for 30 days is parked outside the divisions at the switch. Nothing is deleted, and the manager gets a "sign up for next season" button that puts the team back in the lowest division with room. So a team nobody has touched for weeks will not take a promotion spot. I go through the list by hand before it runs, so if I get one wrong, tell me.

Fakta: #4592 (30 dages login-grænse, parkering ved S4-skiftet, #452 tilmeld-knap). Kandidatlisten er ejer-gated.

**2. "More races for lower divisions" (feedback_ideas) — Agility Colombia 21/9: D1 har 19 endagsløb 28/8-15/9 og 2 derefter.**

> You are both right, and it is fixed in the season 4 calendar. Every division gets 140 race days, 5 per calendar date, spread evenly across the whole season instead of a pile of one-day races in two weeks and then nothing. Lower divisions get the same number of race days as division 1. I generate the calendar before the switch and post it as soon as it is set.

Fakta: #5169 merget 21/9 (140 løbsdage, måde B, 5 pr. dato), #5405 (S4-kalender, kalibrering #5469).

**3. "Themed teams" (off_topic):** ren spillersnak, intet svar nødvendigt.

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

**11. #questions-and-answers (22/9) — skal der være en "English talk"-kanal?**

> Every channel except #dansk-snak is already English, so #general is the English talk. If you want a dedicated off-topic channel, say so here and I will open it.

Ejer-valg.

**12. #feedback-and-ideas "Planning → Team" (19/9) — skift etape i udtagelsen.**

> Good one, logged. Next and previous stage right from the selection screen, without going back through the menu.

Fakta: #5479 (oprettet 22/9).
