# Staging-signup og Auth-profilen

Auth oprettede kontoen. Staging manglede triggeren til game-profilen, saa holdoprettelsen ramte teams_user_id_fkey. Public-fingeraftrykket omfattede ikke triggeren paa auth.users. Refreshen genskaber bindingen i restore-transaktionen og kontrollerer den foer GO.

Serveren bruger kontoens first-touch fra Auth ved holdoprettelse. Browserens tilstand kan pege paa en anden session ved e-mailbekraeftelse.
