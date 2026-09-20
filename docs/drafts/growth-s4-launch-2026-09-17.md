# Vækst-blok uge 38 (styringssession 17/9): to handlinger + én måling

> Udkast til copy-paste. Ejeren poster selv. Efter `TONE_OF_VOICE.md` og `COMMS_PLAYBOOK.md` §1.2 skriver Claude ikke færdig founder-prosa: `[FOUNDER-PROSA]` er ejerens slots. Ingen tal om spillere/penge i opslag (roadbook-regel 2/9).

## Måling (prod 17/9, `signup_attribution` + `users`)

Signups pr. uge: 20/7: 32 · 27/7: 19 · 3/8: 18 · 10/8: 17 · 17/8: 12 · 24/8: 20 · 31/8: 6 · 7/9: 6 · 14/9: 2 (uge i gang).

| Kilde | Sidste 28 dage | Forrige 28 dage |
|---|---:|---:|
| Direkte/ukendt | 16 | 26 |
| Google | 12 | 5 |
| ChatGPT | 2 | 7 |
| Reddit | 0 | 7 |
| Hattrick-forum | 0 | 4 |

Læsning: Google vokser (SEO-arbejdet #5239 virker). Reddit og Hattrick-forum gav 11 signups da der blev postet, 0 siden. Det er den billigste kanal at tænde igen. ChatGPT-kilden falder; det er ikke noget vi styrer direkte.

Aflæsning næste mandag: `infisical run --env=prod -- node scripts/monday-numbers.mjs` (kræver `infisical login` først; loginet var udløbet 17/9). Kanal-differencen 48 timer efter et opslag er signalet, ikke 30-dages-kolonnen. Discord sender ingen referrer, så link ALTID med `?utm_source=discord&utm_medium=community&utm_campaign=s4-launch`.

## Handling 1: S4-startopslag (Reddit + Hattrick-forum + Discord)

Nyt siden sidst (spillervendt, fra patch notes): to nye mentale evner (Holdarbejde, Lederskab) · tre nye hårde træningssessioner (brostenssektorer, vifteøvelser, angrebsintervaller) · kør din første træningsdag med ét klik · anmeld en handel.

### Reddit / forum (EN, historie før link, ingen emoji)

Åbning godkendt af ejeren 17/9 (tilpasses lidt før afsendelse):

This started as a summer game with friends: multiplayer Pro Cycling Manager, run through a Google Doc and a small Discord. It got out of hand, in the best way. So I built our own browser game around it, with its own race engine and its own riders, and now other managers race in it every day. Season 4 starts soon. If you have ever wished PCM had real opponents who check in every day, this is that.

A few things that shipped recently: two new mental rider stats (Teamwork and Leadership), three new hard training sessions built around cobbles and echelons, and a one-click way to run your first training day.

Season 4 starts September 28. Start now, so your team is ready for the first race.

What would make the biggest difference for your team this season: a stronger squad, better tactics, or more races on the calendar?

https://cyclingzone.org/?utm_source=reddit&utm_medium=community&utm_campaign=s4-launch

### Reddit / forum (DA)

Det her startede som et sommerspil med vennerne: multiplayer Pro Cycling Manager, kørt gennem et Google-dokument og en lille Discord. Det løb løbsk, på den gode måde. Så jeg byggede vores eget browserspil omkring det, med egen løbsmotor og egne ryttere, og nu kører andre managere i det hver dag. Sæson 4 starter snart. Har du nogensinde ønsket, at PCM havde rigtige modstandere, der kigger forbi hver dag, så er det det her.

Et par ting der er kommet for nylig: to nye mentale rytter-stats (Holdarbejde og Lederskab), tre nye hårde træningssessioner bygget om brosten og vifter, og en måde at køre din første træningsdag på med ét klik.

Sæson 4 starter 28. september. Start nu, så dit hold er klar til første løb.

Hvad ville gøre den største forskel for dit hold denne sæson: en stærkere trup, bedre taktik, eller flere løb på kalenderen?

https://cyclingzone.org/?utm_source=reddit&utm_medium=community&utm_campaign=s4-launch

### Discord (EN, DA i tråden under)

[FOUNDER-PROSA: personlig åbningslinje.]

New since the last patch notes:
- Two new mental abilities: Teamwork and Leadership
- Three new hard sessions: cobbled sectors, echelon drills, attack repeats
- Run your first training day with one click
- Report a trade

Season 4 starts September 28. Start now, so your team is ready for the first race: https://cyclingzone.org/?utm_source=discord&utm_medium=community&utm_campaign=s4-launch

[FOUNDER-PROSA: invitation, lav tærskel.]

## Handling 2: win-back-mailen (#2760)

Bygget og slukket (PR #5247, flag `winback_send_enabled=false`). Segment 14/9: 92 sovende med mail-samtykke (79 EN, 13 DA). Ejeren skriver prosaen i `buildWinbackEmail` (beslutning 14/9 + 16/9), Claude leverer fakta.

Emnelinje-forslag: EN "Your team is still there. Season 4 starts September 28." · DA "Dit hold står stadig der. Sæson 4 starter 28. september."

Fakta-punkter: dit hold og din trup står som du forlod dem · sæson 4 starter 28. september · nyt: to nye mentale evner og tre nye hårde træningssessioner · ingen salg i denne mail · parkerings-/tilmeldingsstatus vises ærligt (#4592).

Rækkefølge til go: frisk liste (samtykke + suppression) → dry-run med tal → ejer-go → flag on → execute → flag off. Link: `https://cyclingzone.org/?utm_source=email&utm_medium=email&utm_campaign=winback-sep`.

## Handling 0 (drift, ikke marketing): #5323 Quad9

Målingen fra PR #5324 er live fra 17/9. Aflæs Sentry-gruppen `frontend-backend-network-error` 19/9 for omfang før DNS-beslutningen.
