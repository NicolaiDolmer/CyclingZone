# Patch-note-audit 1/9-15/9 2026 (udkast, ejeren poster selv)

> Kilde: 367 mergede PR'er (1/9-16/9), `frontend/src/data/patchNotes.js` (48 versioner 7.226-7.275), Discord-sweeps `scripts/discord/.sweep-daily-2026-09-*.md` (#patch-notes), docs/drafts + docs/discord. Verificeret 15/9 af read-only agent; ejer-go før noget postes. Tone: docs/TONE_OF_VOICE.md.

## Hovedkonklusion

| | Status |
|---|---|
| In-app patch notes | God dækning; **16 brugerrettede PR'er mangler** en note (liste nedenfor). |
| Discord #patch-notes | **Sidste patch-note-post 7/9 14:10 UTC.** Siden da kun survey-opslag 8/9. **19 in-app-versioner aldrig postet:** 7.232-7.238 (2/9, faldt mellem to catch-ups) og 7.262-7.275 (7/9 til i dag). |
| Bag flag (skal have note VED FLIP, ikke nu) | Boardroom/mandat/årsmøde, motor v4, assistent late-fill, tilmeld næste sæson, genoptagelig løbsafslutning, træningstick pr. løbsdag (#5205). |
| Bemærk | PR #5239 hedder "draft, ikke til merge" i titlen men er merget 14/9 (tjek). Udkast aldrig postet: `docs/drafts/discord-5073-retirement-notice-2026-09-10.md` (pensionsvarsler; bør postes selvstændigt, tillidsspørgsmål), `discord-training-mockups-2026-09-06.md`, `discord-sponsors-page-2026-09-05.md`. |

## A. Brugerrettet, men INGEN in-app note (16)

| PR | Dato | Issue | Hvad spilleren ser |
|---|---|---|---|
| 4659, 5216 | 2/9, 14/9 | 4067 | De offentlige sider (how it works, PCM-sammenligning, DA) bor nu på cyclingzone.org |
| 4690 | 3/9 | 2853, 4650 | Velkomst-, dag-1- og digest-mails på dansk hvis du spiller på dansk |
| 4884 | 6/9 | 4869 | Profil-/holdopslag fejler ikke når du ikke har hold endnu |
| 5009 | 7/9 | 4999 | Discord-resultater kun i egen gruppekanal, ikke også divisionskanalen |
| 5028 | 8/9 | 5014 | Tre sidste steder hvor forældet chunk gav uforståelig fejl |
| 5044, 5039 | 8/9 | 4943 | Survey: fremdriftslinje i mørkt tema, "3 min" → 5 |
| 5100 | 10/9 | 5089 | Rytterkortet henter færre kald, faner loader efter behov |
| 5135 | 11/9 | 5133 | Akademiryttere der missede gradueringsbatchen får override-vindue |
| 5137 | 11/9 | 4959 | AI-hold markeret til nedlæggelse tager ikke pladser i nye løb |
| 5168 | 11/9 | 5161 | Boot-vagt kender buildets filliste: 404 på entry giver selvheling |
| 5174 | 11/9 | 5150 | Farvetokens uden alpha: nedtonede elementer stod i fuld styrke |
| 5185 | 13/9 | 5176 | /standings, /riders, /race-points, /honours svarede 400 for alle efter #5183, hotfixet |
| 5188 | 13/9 | 5186 | Ranglisten viser fejl i stedet for tom tabel |
| 5247 | 14/9 | 2760 | Win-back-mail til sovende managere (udsendelse, ikke patch note; evt. Discord-linje) |
| 4667, 4708, 4709, 4716, 4718 | 3/9 | 4270, 4203, 4288, 4105 | S4-kalenderens regler (egen note når S4 åbner 28/9) |

## B. In-app-versioner IKKE postet på Discord (19)

Hul 1 (2/9): 7.232 story bubbles alle etaper · 7.233 rytterne fortæller om dagen · 7.235 akademiet viser kommende Junior/U23 (+ bestyrelse, fair play, cookie) · 7.236 Pro falder ikke ud ved fornyelse · 7.237 Pro lander straks · 7.238 renere Dashboard/Indbakke.

Hul 2 (7/9 →): 7.262 anbefal-en-ven + roadmap for udloggede · 7.263 visninger, Discord-navn, Founder-mærke · 7.264 forum + beskeder (Roadmap-kategori, @-tag, kategorier, billeder, DM) · 7.266 velkomstmail · 7.267 cookie/PostHog · 7.268 præmiepenge til spillerhold · 7.269 mobiltabeller + pensionsvarsler · 7.270 survey lukker selv, site-løft · 7.271 ingen reload over ugemt arbejde (+6) · 7.272 resultater til tiden, ny kaptajn (+3) · 7.273 udtagelse overlever fane-skift, frist-påmindelse (+5) · 7.274 ugens træning med ét klik · 7.275 anmeld en handel.

Postet: 2/9 (7.226-7.231), 4/9 (to linjer af 7.252), 5/9 (7.239-7.255), 7/9 (7.256-7.261), 8/9 (7.265).

## C. Forslag: in-app version 7.276 (EN først, DA under)

1. **Interface, fixed. Fewer blank pages after an update.** When a page asked for a file that an update had just replaced, it could go blank or show a fault you could not act on. It now fetches the new file and carries on, and it tells you plainly if it cannot. / **Færre tomme sider efter en opdatering.** Når en side bad om en fil, som en opdatering lige havde skiftet ud, kunne den gå i sort eller vise en fejl, du ikke kunne gøre noget ved. Nu henter den den nye fil og kører videre, og siger det ligeud, hvis den ikke kan. refs [5014, 5161, 5028, 5168]
2. **Rankings, fixed. Rankings are back, and they say so when something breaks.** A security change on Sunday made every rankings page answer with an error. That is fixed. Rankings now show a real message instead of an empty table when a request fails. / **Ranglisterne er tilbage, og de siger til når noget går galt.** En sikkerhedsændring i søndags fik alle ranglistesider til at svare med en fejl. Det er rettet. Ranglisterne viser nu en rigtig besked i stedet for en tom tabel, når et kald fejler. refs [5176, 5186, 5185, 5188]
3. **Profile, fixed. Your profile loads before you have a team.** Looking up your own profile or a team could answer with a fault instead of simply saying there is nothing there yet. It answers plainly now. / **Din profil indlæses, før du har et hold.** Et opslag på din egen profil eller et hold kunne svare med en fejl i stedet for bare at sige, at der ikke er noget endnu. Nu svarer den ligeud. refs [4869, 4884]
4. **Academy, fixed. Academy riders who missed their graduation window get it now.** A rider who slipped past the graduation batch had no way back in, and stood still. A sweep now finds him and opens his window the way the season change would have. / **Akademiryttere, der missede deres gradueringsvindue, får det nu.** En rytter, der gled forbi gradueringsbatchen, kunne ikke komme ind igen og stod stille. Et sweep finder ham nu og åbner hans vindue, præcis som sæsonskiftet ville have gjort. refs [5133, 5135]
5. **Races, fixed. AI teams on their way out stop taking start slots.** A team marked for removal kept being entered in new races, so some pools were bigger than they should be. It stops taking slots now, and it leaves when its last race is done. / **AI-hold på vej ud tager ikke længere startpladser.** Et hold, der var markeret til nedlæggelse, blev ved med at blive tilmeldt nye løb, så nogle puljer var større end de skulle være. Det tager ikke pladser mere og forsvinder, når dets sidste løb er kørt. refs [4959, 5137]
6. **Discord, improved. Race results in Discord go to your own group channel only.** Results used to land in both your group channel and the division channel. That made the division channels noisy without adding anything. Now they land in one place. / **Løbsresultater i Discord går kun til din egen gruppekanal.** Resultater landede før både i din gruppekanal og i divisionskanalen. Det gjorde divisionskanalerne larmende uden at give noget. Nu lander de ét sted. refs [4999, 5009]
7. **Site, improved. The public pages live on cyclingzone.org now.** How it works and the comparison page sat on a separate address. They are on the main site now, in English and Danish, so a link you send lands where it should. / **De offentlige sider bor nu på cyclingzone.org.** Siden om hvordan spillet fungerer og sammenligningssiden lå på en anden adresse. De ligger på hovedsitet nu, på engelsk og dansk, så et link du sender, lander hvor det skal. refs [4067, 4659, 5216]
8. **Email, new. Emails arrive in your own language.** The welcome mail, the first day mail and the race digest are written in Danish for you if that is the language you play in. / **Mails kommer på dit eget sprog.** Velkomstmailen, dag-1-mailen og løbsopsamlingen er skrevet på dansk til dig, hvis det er det sprog du spiller på. refs [2853, 4650, 4690]
9. **Feedback, fixed. Survey polish.** The bar at the top of the survey was see-through in dark mode, and the invitation promised a shorter survey than the one I ended up writing. Both corrected. / **Spørgeskemaet er pudset af.** Linjen i toppen af skemaet var gennemsigtig i mørkt tema, og invitationen lovede et kortere skema end det, jeg endte med at skrive. Begge dele er rettet. refs [4943, 5039, 5044]
10. **Interface, improved. Toned-down elements are toned down again.** Some colours were drawn at full strength where the design called for them to fade back. They fade the way they should now. / **Nedtonede elementer er nedtonet igen.** Nogle farver blev tegnet i fuld styrke, hvor designet bad om, at de trådte tilbage. De træder tilbage nu, som de skal. refs [5150, 5174]
11. **Riders, improved. The rider card loads faster.** It shares the lookups the rest of the page already made, and a tab fetches its own data only when you open it. / **Rytterkortet indlæser hurtigere.** Det deler de opslag, resten af siden allerede har lavet, og en fane henter først sine egne data, når du åbner den. refs [5089, 5100]

Plus dagens merges (tilføjes når de er merget): tre nye træningssessioner (#5236/#5237), Discord-velkomst (#5130), mobiltabeller sidste fire (#5124), træningsscore (#4851, bag flag: note ved flip).

## D. Ét samlet Discord-opslag til #patch-notes (4 beskeder, EN; DA i dansk kanal)

**1/4**
Hep!
@everyone

I have been building and forgetting to tell you about it. Here is everything since the last catch-up on 7 September, plus a handful from early September that slipped between two posts. Full detail as always at cyclingzone.org/patch-notes.

**Forum and messages**
- You can send a manager a direct message now, block and report included.
- Tag a manager with @ in a post and they get a message about it.
- There is a Roadmap category where I post what I am working on and you reply.
- Pictures in forum posts. Choose which categories you follow. Thread views, last reply and your post count are visible. A thread in the wrong category can be moved.
- Your Discord name can show on your manager profile, and the Founder mark shows there too.

**2/4**
**Racing and your squad**
- Your squad selection survives a switch to the Stages tab. It used to quietly reset.
- Your captain abandons a stage race? You can promote a new one now.
- Race results arrive on time again when a lot of stages finish in the same hour.
- Race start no longer skips whole teams when an AI rider retires at the wrong moment.
- The latest stage result is reachable straight from Overview, on the phone too.
- Prize money goes to player teams, and AI teams on their way out stop taking start slots.
- Academy riders who missed their graduation window get it now.
- Retirement notices are stored at the start of a season and cannot move mid-season anymore.

**3/4**
**Training, planning and getting started**
- One click to run this week's training, straight from the Get started card.
- A visible reminder before the squad deadline.
- Getting started step 4 waits for you to negotiate the board plan yourself instead of accepting it for you.
- Your riders tell you how the day went, in their own words.
- The academy shows the Junior and U23 teams that are coming.

**Money and Pro**
- Pro lands right after you pay, and it no longer drops out at renewal.
- The board's goals count correctly across a whole multi-year plan.

**4/4**
**Interface, and things that were broken**
- Rankings answered with an error for everyone for a short while on Sunday after a security change. Fixed, and rankings now show a real message instead of an empty table when something fails.
- An update never reloads the page over your unsaved work anymore.
- Fewer blank pages after an update. Pages wait quietly when the server is briefly busy, and you get fewer error boxes when your session has expired.
- Mobile tables: name plus three columns, no sideways scrolling. Help explains them.
- Wishlist search is visible on mobile. An empty season summary points you to the calendar.
- Report button on every completed trade, and a Fair play category on the contact form.
- Emails arrive in Danish if that is the language you play in.
- The public pages live on cyclingzone.org now, in both languages.

That is the lot. If something in here does not behave the way it reads, say so in the forum or in here. That is far more useful to me than praise :)

**DA (samme fire blokke)**

Hep!
@everyone

Jeg har bygget og glemt at fortælle om det. Her er alt siden sidste opsamling den 7. september, plus en håndfuld fra starten af september, der gled ned mellem to opslag. Alle detaljer som altid på cyclingzone.org/patch-notes.

**Forum og beskeder**
- Du kan sende en manager en besked nu, med bloker og anmeld.
- Tag en manager med @ i et indlæg, så får han besked.
- Der er en Roadmap-kategori, hvor jeg skriver hvad jeg arbejder på, og du svarer.
- Billeder i forumindlæg. Vælg selv hvilke kategorier du følger. Visninger, seneste svar og dit antal indlæg er synlige. En tråd i den forkerte kategori kan flyttes.
- Dit Discord-navn kan vises på din managerprofil, og Founder-mærket vises der også.

**Løb og din trup**
- Din holdudtagelse overlever et skift til Etaper-fanen. Før nulstillede den sig stille.
- Udgår din kaptajn af et etapeløb? Så kan du udnævne en ny.
- Løbsresultater kommer til tiden igen, når mange etaper slutter i samme time.
- Løbsstarten springer ikke længere hele hold over, når en AI-rytter pensioneres på det forkerte tidspunkt.
- Det seneste etaperesultat kan findes direkte fra Overblik, også på telefonen.
- Præmiepenge går til spillerhold, og AI-hold på vej ud tager ikke længere startpladser.
- Akademiryttere, der missede deres gradueringsvindue, får det nu.
- Pensionsvarsler gemmes ved sæsonstart og kan ikke skifte midt i sæsonen længere.

**Træning, planlægning og kom i gang**
- Ét klik til at køre ugens træning, direkte fra Kom i gang-kortet.
- En synlig påmindelse før udtagelsesfristen.
- Kom i gang-trin 4 venter på, at du selv forhandler bestyrelsesplanen, i stedet for at acceptere den for dig.
- Dine ryttere fortæller dig selv, hvordan dagen gik.
- Akademiet viser de Junior- og U23-hold, der er på vej.
- Pro lander straks efter du har betalt, og falder ikke længere ud ved fornyelse.
- Bestyrelsens mål tæller rigtigt hen over en hel flerårsplan.

**Brugerflade, og ting der var i stykker**
- Ranglisterne svarede med en fejl for alle i en kort periode søndag efter en sikkerhedsændring. Rettet, og ranglisterne viser nu en rigtig besked i stedet for en tom tabel, når noget fejler.
- En opdatering genindlæser aldrig siden over dit ugemte arbejde længere.
- Færre tomme sider efter en opdatering. Sider venter stille, når serveren er kortvarigt travl, og du får færre fejlbokse, når din session er udløbet.
- Mobiltabeller: navn plus tre kolonner, ingen scroll til siden. Hjælpen forklarer dem.
- Søgefeltet på ønskelisten er synligt på mobil. En tom sæsonopsamling peger dig videre til kalenderen.
- Anmeld-knap på hver gennemført handel, og en Fair play-kategori på kontaktformularen.
- Mails kommer på dansk, hvis det er det sprog du spiller på.
- De offentlige sider bor nu på cyclingzone.org, på begge sprog.

Det var det hele. Hvis noget herinde ikke opfører sig, som det står, så sig til i forummet eller herinde. Det er langt mere brugbart for mig end ros :)
