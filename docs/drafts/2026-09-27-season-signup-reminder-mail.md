# Tilmeldings-påmindelse før parkering, udkast 27/9 (#5814)

Mailtype `season_signup_reminder`, sendes af `scripts/season-signup-reminder-send.mjs` (dry-run er default; `--execute` kræver `app_config.winback_send_enabled = true`, som kun ejeren flipper). Renderes af `buildSeasonSignupReminderEmail` i `backend/lib/emailTemplates.js`, samme layout og samme åbningslinje som win-back-mailen fra 22/9 (`docs/drafts/2026-09-22-winback-mail.md`, uændret).

Pladsholdere: [Holdnavn] = teamName · [placering] i [pulje] = rankInDivision + poolLabel (leddet udelades hvis holdet ikke har en stilling i den aktive sæson). Punkt 1, 2 og 5 er win-back-punkterne ordret (samme konstant i koden). Øvrige punkter og afslutning er nye, fordi 22/9-teksten er forældet: U23/junior er åbne nu, og den nye løbsmotor er ikke tændt endnu.

Modtagere: hold som sæsonskiftets parkering ville parkere (`managerParking.selectTeamsToPark`: menneskehold, ikke parkeret, ikke frosset, ikke tilmeldt næste sæson, intet aktivt abonnement, manager væk i 30+ dage) med `email_marketing = true`, ikke afmeldt (alle mails, win-back eller denne type), ingen bounce/klage. Én mail pr. bruger pr. sæson.

## EN

**Subject:** Season 4 starts Monday. One tap keeps your spot.

Hi,

[Holdnavn] is still yours, exactly as you left it. It kept racing while you were away and currently sits [placering] in [pulje].

A lot has happened since you were last here, and more lands with season 4:

- **Training has been rebuilt for season 4.** Three new hard sessions, a training score from 1 to 99 on every rider, and your riders train per race day instead of per calendar day, so a busy week and a quiet week finally feel different.
- **A real board arrives with season 4.** Your board hands you mandates and holds proper meetings. Ignore them at your own risk.
- **Your U23 and junior squads are open.** Your talents get their own U23 and junior teams with their own races in season 4, and on Graduation Day you decide who moves up, who is sold and who is released.
- **Rider values have been recalculated.** Value now follows the rating you see on the card, so training you can see becomes value you can see.
- **Same chances to develop, whatever your division.** In season 4 every division has the same number of training days, so your riders develop as fast in division 4 as in division 1.
- **A new race engine is on its way.** Races are run in segments, so breaks, climbs and finales play out where they should. I switch it on when it is ready.

Season 3 ends Sunday evening, and season 4 starts 28 September. Teams that have been away for 30 days are parked outside the divisions at the switch. One tap keeps your spot: log in and press Sign up for next season on your dashboard before 19:00 Danish time on Sunday 27 September. If you miss it, nothing is deleted, and one tap brings you back later.

[Knap: Keep my spot] (dashboard, `utm_medium=signup_reminder`, `utm_campaign=signup_reminder`)

## DA

**Emne:** Sæson 4 starter mandag. Ét tryk holder din plads.

Hej,

[Holdnavn] er stadig dit, præcis som du forlod det. Holdet kørte videre mens du var væk og ligger lige nu som nr. [placering] i [pulje].

Der er sket meget siden sidst, og mere lander med sæson 4:

- **Træningen er bygget om til sæson 4.** Tre nye hårde pas, en træningsscore fra 1 til 99 på hver rytter, og dine ryttere træner pr. løbsdag i stedet for pr. kalenderdag, så en travl uge og en stille uge endelig føles forskelligt.
- **En rigtig bestyrelse kommer med sæson 4.** Din bestyrelse giver dig mandater og holder rigtige møder. Ignorér dem på eget ansvar.
- **Dine U23- og juniorhold er åbne.** Dine talenter får egne U23- og juniorhold med egne løb i sæson 4, og på Graduation Day bestemmer du, hvem der rykker op, sælges eller frigives.
- **Rytterværdierne er regnet om.** Værdien følger nu den rating du ser på kortet, så træning du kan se bliver værdi du kan se.
- **Samme muligheder for udvikling, uanset division.** I sæson 4 har alle divisioner lige mange træningsdage, så dine ryttere udvikler sig lige så hurtigt i division 4 som i division 1.
- **En ny løbsmotor er på vej.** Løbene køres i segmenter, så udbrud, stigninger og finaler afgøres der hvor de skal. Jeg tænder den, når den er klar.

Sæson 3 slutter søndag aften, og sæson 4 starter 28. september. Hold, der har været væk i 30 dage, parkeres uden for divisionerne ved skiftet. Ét tryk holder din plads: log ind og tryk Tilmeld dig næste sæson på dit dashboard før kl. 19 søndag 27. september. Når du det ikke, slettes intet, og ét tryk henter dig tilbage senere.

[Knap: Behold min plads]

Fælles bund (uændret, som alle loop-mails): Discord-linje + knap, "Dolmer, Cycling Zone", afmeldingslink.
