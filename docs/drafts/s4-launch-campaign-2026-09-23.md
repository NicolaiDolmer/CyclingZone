# S4-kampagne "Din klub til sæson 4": færdige opslag til ejeren (#2236)

> **Status:** udkast til ejerens godkendelse. Ejeren poster selv; Claude poster, sender og køber intet. Skrevet natten 23/9 efter `docs/TONE_OF_VOICE.md` (jeg-stemme, ingen emoji på Reddit, ingen em-dash, fantasien først, fairness-løftet med). Kun funktioner der er live i dag er nævnt (ingen løfter om bestyrelse, ny løbsmotor eller træning pr. løbsdag).
> **Regler for posting (fra #2236):** 90/10, historie før link, læs subredditens sidebar lige før, maks to kanaler ad gangen, tjek eksisterende posts først.
> **Links:** indtil #5310 er live bruges signup-linket direkte, så SPA'en fanger UTM: `https://cyclingzone.org/login?mode=signup&utm_source=<kilde>&utm_medium=community&utm_campaign=s4-launch`

## Faktatjek (live 23/9, verificeret i kode/NOW)

Live auktioner og transfermarked · hold-udtagelse pr. løb + taktik · fuld sæsonkalender mod rigtige managere · ligapyramide med op- og nedrykning · daglig træning · akademi med Graduation Day · forum · gratis, CZ Pro er valgfrit. Sæson 4 starter mandag 28. september.

---

## 1. r/playmygame (EN, sæt Web-flair straks efter posting)

**Title:** Cycling Zone: a browser cycling manager where every race is against real managers [Web]

**Body:**

I have been building a cycling manager game on my own for the last few months, and season 4 starts on Monday 28 September, which makes this a good moment to join.

What you do:

- Draft a team and bid on riders in live auctions against other managers
- Pick your squad for each race and set the tactics
- Race a full season calendar in a league with promotion and relegation
- Train your riders every day and bring young talents up through your academy

It runs in the browser, on desktop and phone. It is free to play, and you cannot pay for better riders, faster training or better results. There is an optional CZ Pro tier for people who want extra tools, but it never touches the racing.

I build it in the open and read every piece of feedback, so if something feels off, tell me and it will likely change.

Link: https://cyclingzone.org/login?mode=signup&utm_source=reddit&utm_medium=community&utm_campaign=s4-launch-playmygame

---

## 2. r/SideProject (EN, build-in-public)

**Title:** I am building a multiplayer cycling manager solo, and season 4 starts Monday

**Body:**

Cycling Zone started as a simple idea: a cycling manager where you do not just click through numbers, but actually build something over time, against other people instead of the AI.

A few things I have learned so far:

- Live auctions are the heart of the game. Managers bidding against each other creates stories no scripted AI market can.
- A season calendar has to feel like real cycling. I rebuilt it so that mountain stages finish uphill and stage races run on consecutive days.
- Fairness is a product decision, not a slogan. Nobody can pay for better riders, faster training or better results, and that rule decides what the optional CZ Pro tier is allowed to contain.

Season 4 starts on Monday 28 September. If you like manager games or just want to see how a solo-built multiplayer game holds up, I would love your honest take.

https://cyclingzone.org/login?mode=signup&utm_source=reddit&utm_medium=community&utm_campaign=s4-launch-sideproject

---

## 3. Hattrick-forum (EN + DA, svar først i den eksisterende tråd hvis den findes)

**EN:**

Anyone who has played Hattrick for years knows the feeling: the best part was never the graphics, it was logging in every day because something real had happened. I am building a cycling manager in that spirit: Cycling Zone. You bid on riders in live auctions, pick your squad and tactics for each race, and ride a full season in a league with promotion and relegation, against real people and in the browser. It is free, and you cannot pay for better riders or results. Season 4 starts Monday 28 September, so this week is a good time to take over a team. Feedback from manager-game veterans means more to me than anything right now.

https://cyclingzone.org/login?mode=signup&utm_source=hattrick&utm_medium=community&utm_campaign=s4-launch

**DA:**

Alle der har spillet Hattrick i årevis kender følelsen: det bedste var aldrig grafikken, men at logge ind hver dag fordi der faktisk var sket noget. Jeg bygger et cykelmanagerspil i samme ånd: Cycling Zone. Du byder på ryttere i live-auktioner, vælger hold og taktik til hvert løb og kører en hel sæson i en liga med op- og nedrykning, mod rigtige mennesker og direkte i browseren. Det er gratis, og du kan ikke betale dig til bedre ryttere eller resultater. Sæson 4 starter mandag 28. september, så denne uge er et godt tidspunkt at overtage et hold. Feedback fra erfarne managerspillere betyder mere for mig end noget andet lige nu.

https://cyclingzone.org/login?mode=signup&utm_source=hattrick&utm_medium=community&utm_campaign=s4-launch

---

## 4. PCM-Discord (EN, KUN efter moderatorens ok)

Hi all, I hope a short intro is ok here (I asked the mods first). I am the solo developer behind Cycling Zone, an online cycling manager where you race against other managers instead of the AI. You bid on riders in live auctions, pick your squad and tactics for each race, train your riders daily and bring talents up through an academy. Season 4 starts Monday 28 September. If you play PCM careers and want your decisions to count against real people, I would love to hear what you think, good and bad.

https://cyclingzone.org/login?mode=signup&utm_source=pcm-discord&utm_medium=community&utm_campaign=s4-launch

---

## 5. Eget Discord #announcements (KUN EN)

Season 4 starts on Monday 28 September.

If you know someone who would enjoy running a team, this is the week to bring them in. New managers who join now start the season with everyone else, with a full calendar ahead of them.

Invite link for friends: https://cyclingzone.org/login?mode=signup&utm_source=discord&utm_medium=referral&utm_campaign=s4-launch

---

## 6. Annonce-test til #2759 (kræver ejerens eksplicitte go og budget)

- **Budget:** 500 kr. hårdt loft i alt. Stop-regel: stop en variant når den har brugt 150 kr. uden signups.
- **Kanal:** Reddit-annoncer mod r/peloton, r/Velo og manager-spil-interesser; alternativt Meta mod interessen "Pro Cycling Manager".
- **Variant A (fællesskab):** "Run a cycling team against real managers. Live auctions, a full season, promotion and relegation. Season 4 starts 28 September."
- **Variant B (fairness):** "A cycling manager you cannot pay to win. Build your team in live auctions and race a full season against real people."
- **Links:** `utm_medium=paid&utm_campaign=s4-launch&utm_content=a|b`.

## 7. Måleplan (48 timer)

- Før første opslag: `node scripts/monday-numbers.mjs --json` gemmes som baseline.
- 48 timer efter hvert opslag: samme kommando; signups pr. `utm_source` og aktive managere efter 7 dage.
- Mål (fra vækstgennemgangen 16/9, ikke en prognose): 30 signups og 12 aktive efter 14 dage på tværs af organisk og betalt.
- Tjek Sentry for kerneflows (signup, første bud, første holdudtagelse) de første 48 timer.
