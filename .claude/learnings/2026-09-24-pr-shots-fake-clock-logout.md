# 2026-09-24 · Billedstationen blev logget ud ved et tilbagestillet browser-ur

**Hvad skete:** Kl. ca. 01:35 (nat-session 24/9-b) ville orkestratoren tage før/efter-billeder af #5589 (Today's stages) med ægte data. Dashboardet viser kun DAGENS løb, og kl. 01 var ingen afsluttet. Orkestratoren lavede en scratchpad-kopi af `tools/pr-shots-v2.mjs` med et `SHOT_AT`, der erstattede `Date` i siden via `addInitScript` (uret stillet 4 timer tilbage til 23/9 kl. 21:30). Appen sendte `POST /auth/v1/logout?scope=global` (blokeret af skrive-vagten, så server-sessionen er urørt) og landede på `/login`. Et nyt forsøg UDEN `SHOT_AT` landede også på `/login`: den persistente profil (`%LOCALAPPDATA%\cz-pr-shots-profile`) er logget ud lokalt.

**Rod-årsag (sandsynlig, ikke bevist):** supabase-js rydder den lokale session ved `signOut`, også når selve kaldet fejler (her 204 fra vagten). Signout blev udløst, da appens auth-restore så en session med tider, der ikke passede til det falske ur. Det er ikke udelukket, at sessionen allerede var udløbet (sidste brug 23/9 kl. 21:51). Den ikke-fakede prøve viste kun, at profilen VAR logget ud efter forsøget.

**Følge:** Orkestratoren må ikke logge ind (adgangskoder er ejerens). Ingen billeder med ægte data i natten; ejeren skal køre `node pr-shots.mjs login` én gang (ca. 1 min).

**Læring:**
1. Skru aldrig browser-uret TILBAGE i en profil med en rigtig session. Vis i stedet et historisk tilstandsbillede via route-mocks af datasvarene (GET), eller tag billederne, når dagens løb er afgjort.
2. Skrive-vagten skal også fange `signOut` på klientsiden: route-vagten stopper kaldet, men supabase-js rydder alligevel localStorage. Billedstationen (#5565) bør åbne en KOPI af profilen pr. kørsel (eller gemme `sb-*-auth-token` og lægge den tilbage bagefter), så en uheldig kørsel aldrig logger stationen ud.
3. Tjek login-status med en kort probe FØR en lang billedserie.

**Bygget ind i `scripts/pr-shots.mjs` (#5565, cloud 24/9-d):** profil-kopi pr. kørsel (mesterprofilen åbnes kun af `--login`), `signOut` besvares 204 og tælles, login-probe (`/dashboard` → `/login`?) før serien, og `--shot-at`/`--clock` afvises med henvisning hertil. Scriptet læser aldrig storage; proben er kun en URL-sammenligning.

Refs #5565 #5589
