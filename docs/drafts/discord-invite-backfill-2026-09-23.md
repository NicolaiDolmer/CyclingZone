# Discord-invite backfill til eksisterende managere (#2761) - udsendelsesudkast 23/9

Refs #2761 (ejer-direktiv 20/7, udvidet 6/8 og 7/9). Bygget af
`backend/scripts/sendDiscordInviteBackfill.mjs`. Segment: menneskehold (ikke
ai/bank/frozen/test) hvor brugeren mangler `users.discord_id` og ikke allerede
har en `discord_welcome`-notifikation (hverken fra den løbende onboarding-sweep
#5130 eller en tidligere kørsel af dette script).

## Teksten er BEVIDST den samme som den allerede kørende Discord-velkomst

Dette script genbruger notifikationstypen `discord_welcome` og selve
payload'en fra `backend/lib/discordWelcomeNotification.js`
(`buildDiscordWelcomeNotification()`) i stedet for at introducere ny copy. To
grunde:

1. Teksten er allerede ejer-godkendt (`docs/drafts/discord-welcome-copy-2026-09-15.md`,
   15/9, "efter tre runder; aendr ikke ordlyden") og allerede live i
   `frontend/public/locales/{en,da}/backendMessages.json` under
   `notif.discordWelcome`. At skrive ny copy ville betyde en ny locale-nøgle, en
   ny `notifications_type_check`-værdi og en ny linje i `NotificationsPage.jsx`'
   `TYPE_CONFIG` — tre steder der ellers skal holdes i sync (samme
   parity-risiko som er dokumenteret i `sendSurveyInvite.mjs`).
2. Modtageren ser den samme besked uanset om den kom fra onboarding-sweepen
   eller backfillen — konsistent identitet i indbakken, ikke to forskellige
   "kom på Discord"-beskeder der konkurrerer om den samme klik.

Nye rækker fra DETTE script er mærket `metadata.backfill = "2026-09"` (kun
til audit/rapportering — dedupe-tjekket i scriptet er bredere end tagget, se
scriptets header).

## Teksten spilleren rent faktisk ser (uændret fra 15/9-godkendelsen)

Rendres klient-side af `notif.discordWelcome.title`/`.message` i
`frontend/public/locales/{en,da}/backendMessages.json`, i modtagerens
`users.language` — dette ER teksten der vises i indbakken i en moderne klient.

### EN
**Title:** Hep! Come join us on Discord
**Message:** Cycling Zone is more than the website. It is a community, and a
lot of it happens on Discord: that is where I hang out, where I ask you what
to build next, and where the other managers talk cycling all day. Be blunt
with me in there, it is way more useful than praise. Come as you are, you do
not need results to belong. See you in there :)

### DA
**Title:** Hep! Kom med på Discord
**Message:** Cycling Zone er mere end hjemmesiden. Det er et fællesskab, og
meget af det sker på Discord: det er der, jeg hænger ud, der jeg spørger dig
hvad jeg skal bygge næste gang, og der de andre managere snakker cykling hele
dagen. Vær ærlig over for mig derinde, det er langt mere brugbart end ros.
Kom som du er, du behøver ingen resultater for at høre til. Vi ses derinde :)

CTA-knappen (samme som `discord_welcome` allerede får i `NotificationsPage.jsx`
via `TYPE_CONFIG`) peger på `DISCORD_INVITE_URL`
(`frontend/src/lib/externalLinks.js`) — det permanente invite-link.

## Den gemte fallback-tekst (ANDEN streng, CodeRabbit-fund)

`notifications.title`/`.message` (selve raekken) er IKKE ovenstående tekst.
Kontrakten (#4734, `buildKeyedNotification`) er at denne kolonne kun er en
ENGELSK fallback — til gamle klienter uden i18n, e-mail-digestet og
dedupe-nøglen — mens en moderne klient altid rendrer teksten ovenfor fra
`metadata.titleCode`/`messageCode`. `buildDiscordWelcomeNotification()`
(genbrugt uændret af dette script) sætter denne fallback til en KORTERE,
ældre EN-tekst, ikke 15/9-godkendelsen:

**Title (fallback):** Come hang out on Discord
**Message (fallback):** I'm in there, and so are the other managers: ask me
anything, swap tactics, and get the roadbook before anyone else.

Ingen DA-fallback findes eller skal findes — fallbacken er altid engelsk
(`DEFAULT_LANGUAGE`), uanset modtagerens `users.language`.

## Ejer-direktivets scope-udvidelser 6/8 og 7/9 (IKKE dækket af denne PR)

Ejeren har to gange (Discord #feedback-from-dolmer 6/8 og 7/9, se
issue-kommentarer på #2761) bedt om at beskeden også skal nævne
manager-forummet og kontakt-knappen, med en Discord-knap direkte i beskeden.
Denne PR ændrer IKKE selve copyen eller tilføjer nye CTA'er — den lukker kun
backfill-hullet for eksisterende managere med den tekst der allerede er
godkendt og live. En opdateret copy (forum + kontakt-knap) er et separat,
ejer-gated skridt: den kræver en ny godkendelsesrunde på ordlyden (som
15/9-precedensen viser tager flere runder) og ville i givet fald ramme BÅDE
sweepen og denne backfill samtidig, så den bør laves ét sted
(`discordWelcomeNotification.js`), ikke duplikeres her.

## Udsendelse

Ejer-gated, som `sendSurveyInvite.mjs`. Denne PR har KUN kørt `--dry-run`
(read-only) — se PR-body for antal modtagere og EN/DA-fordeling.
`--execute` køres af orkestratoren efter ejerens eksplicitte "kør", jf.
merge-og-migrationsmekanikken i `CLAUDE.md` (#2642: Claude kører selv
efter merge, aldrig under implementering af selve PR'en).
