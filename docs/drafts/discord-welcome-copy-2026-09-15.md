# Discord-velkomst i indbakken (#5130 / PR #5211) - ejer-godkendt copy 15/9 kl. 11:1x

Bygges ordret ind i frontend/public/locales/{en,da}/backendMessages.json under notif.discordWelcome (title/message). Ejer-godkendt paa kort 15/9 efter tre runder; aendr ikke ordlyden.

## EN
title: Hep! Come join us on Discord
message: Cycling Zone is more than the website. It is a community, and a lot of it happens on Discord: that is where I hang out, where I ask you what to build next, and where the other managers talk cycling all day. Be blunt with me in there, it is way more useful than praise. Come as you are, you do not need results to belong. See you in there :)

## DA
title: Hep! Kom med paa Discord
message: Cycling Zone er mere end hjemmesiden. Det er et faellesskab, og meget af det sker paa Discord: det er der, jeg haenger ud, der jeg spoerger dig hvad jeg skal bygge naeste gang, og der de andre managere snakker cykling hele dagen. Vaer aerlig over for mig derinde, det er langt mere brugbart end ros. Kom som du er, du behoever ingen resultater for at hoere til. Vi ses derinde :)

NB: DA-teksten skal skrives med rigtige ae/oe/aa-tegn i JSON-filen (Kom med på Discord, fællesskab, hænger, spørger, næste, Vær ærlig, behøver, høre). Denne fil er ASCII af hensyn til shell.

## Haerdnings-scope til lanen (boelge 2, sonnet, ejer-valg 15/9: "haerd foerst, saa merge")

1. Byt raekkefoelgen i backend/lib/discordWelcomeSweep.js: skriv notifikationen (notifyUser) FOERST, markér discord_welcome_sent_at BAGEFTER; behold race-sikringen mod parallelle sweep-ticks (fx separat claim-kolonne/-tidsstempel med udloeb, eller idempotent insert paa notifications med dedupe-noegle). CodeRabbit major, discordWelcomeSweep.js:105.
2. Schema-readiness-tjek foer foerste sweep-tick (kolonnen discord_welcome_sent_at kan mangle i op til 120 s efter deploy; cron starter efter 300 s, auto-migrate efter 180 s). CodeRabbit minor, discordWelcomeSweep.js:31. Lille guard: spring tick over med log hvis kolonnen ikke findes.
3. Copy ovenfor bygges ordret ind (EN + DA med rigtige tegn).
4. FEATURE_REGISTRY.yml: ny entry discord-welcome-inbox (area comms, state beta indtil merge+verify), koer node scripts/generate-feature-status.mjs.
5. gh pr update-branch 5211 er koert 15/9 kl. 10:5x; koer igen foer merge hvis main er rykket. Ingen patch note i PR (samles ved close-out).
