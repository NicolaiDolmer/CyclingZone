# Discord #patch-notes: udsnit v7.287 + v7.288 (18/9)

> Udkast til copy-paste. Ejeren poster selv (`docs/PATCH_NOTES_RULES.md` §3: titel + "What changed" ordret fra `frontend/src/data/patchNotes.js`, ingen nye påstande). Genereret direkte fra datafilen, så teksten er ordret. Udkastet fra 17/9 (`discord-patch-notes-2026-09-17.md`, v7.276 til v7.283 + v7.286) er en selvstændig post og står stadig som Next action. Refs #4521.

---

v7.287 and v7.288 (18 Sep)

**Transfers**
- All trades in one list. Transfers has a new tab, All trades. It shows every rider move in the game, newest first: auctions, direct transfers and swaps, with rider, teams, date and amount. You can filter by type and division, or show only your own team. The eye icon on a row opens the same report dialog you already know from the market.

**Interface**
- Ask to join the beta group. Your profile has a new card, Beta group. I open new features to a small group first, so I can read every answer. Ask to join from the card and I answer you myself in your inbox. You can leave the group again at any time without asking anyone.
- Lighter pages. The game loads less code on every page. The statistics script is about a quarter of its old size, and the country flags no longer sit inside the stylesheet. Nothing looks different; pages just have less to download.

**Academy**
- Moving a rider to the academy says that his contract follows. When you move a senior rider down to your academy, he keeps his contract: same wage, same length. The confirmation dialog showed the unchanged wage under the label Youth salary, so it looked like a new wage. It now says Wage (unchanged) and tells you that the contract follows him down.

**Notifications**
- Auto-bid messages are collected per auction. The new message you get when your auto-bid has to raise came once for every challenge. Your inbox now collects them into one line per auction with a counter, together with the outbid messages for the same auction. If you lost the lead along the way, the line says so.

**Auctions**
- You hear about it when your auto-bid has to raise. When another manager tried to outbid you and your auto-bid raised your price to keep the lead, the game told you nothing. You now get a notification with the rider, the manager who bid against you and your new price.

**Scouting**
- The Scouting Network text now states the real rule. The Scouting Network facility promised two scouting assignments at once at its top tier. That was wrong. The second assignment comes from your chief scout: one rated about 80 overall runs two at once, whatever tier the facility is. The text now says so, like the scouting page and Help already did.

**Races**
- Squad selection stays locked if it cannot reload. After Auto-select, the panel reloads your new squad. If that reload failed, the panel unlocked with your old squad and looked saved. It now stays locked, tells you the reload failed and gives you a Try again button, so you never edit a squad that is out of date.

Full detail as always at cyclingzone.org/patch-notes.

---

## DA (til tråden under, hvis du vil)

v7.287 og v7.288 (18. sep.)

**Transfers**
- Alle handler i én liste. Transfers har fået en ny fane, Alle handler. Den viser alle rytterskifter i spillet med nyeste øverst: auktioner, direkte handler og bytter, med rytter, hold, dato og beløb. Du kan filtrere på type og division eller kun vise dit eget hold. Øje-ikonet på en række åbner den samme anmeld-dialog, du allerede kender fra markedet.

**Interface**
- Bed om at komme med i beta-gruppen. Din profil har fået et nyt kort, Beta-gruppen. Jeg åbner nye funktioner for en lille gruppe først, så jeg kan nå at læse hvert svar. Bed om at komme med fra kortet, så svarer jeg dig selv i din indbakke. Du kan forlade gruppen igen når som helst uden at spørge nogen.
- Lettere sider. Spillet henter mindre kode på hver side. Statistik-scriptet fylder cirka en fjerdedel af før, og landeflagene ligger ikke længere inde i stylesheetet. Intet ser anderledes ud; siderne har bare mindre at hente.

**Akademi**
- Flyt til akademi siger nu, at kontrakten følger med. Når du flytter en senior-rytter ned i dit akademi, beholder han sin kontrakt: samme løn, samme længde. Bekræftelses-dialogen viste den uændrede løn under etiketten Ungdomsløn, så det lignede en ny løn. Nu står der Løn (uændret), og dialogen fortæller, at kontrakten følger med ned.

**Notifikationer**
- Autobud-beskeder samles pr. auktion. Den nye besked, du får når dit autobud må hæve prisen, kom én gang for hver udfordring. Din indbakke samler dem nu til én linje pr. auktion med en tæller, sammen med overbudt-beskederne for samme auktion. Hvis du mistede føringen undervejs, står det på linjen.

**Auktioner**
- Du får besked når dit autobud må hæve prisen. Når en anden manager forsøgte at overbyde dig, og dit autobud hævede din pris for at beholde føringen, fik du ingenting at vide. Nu får du en notifikation med rytteren, manageren der bød imod dig, og din nye pris.

**Scouting**
- Teksten på Scouting-netværket siger nu den rigtige regel. Faciliteten Scouting-netværk lovede to spejder-opgaver ad gangen på topniveauet. Det var forkert. Den anden opgave kommer fra din chefscout: en chefscout med omkring 80 i overall kører to ad gangen, uanset facilitetens niveau. Teksten siger det nu, ligesom scouting-siden og Hjælp allerede gjorde.

**Løb**
- Holdudtagelsen forbliver låst hvis den ikke kan genindlæses. Efter Auto-udtag genindlæser panelet din nye trup. Hvis genindlæsningen fejlede, låste panelet op med din gamle trup og så gemt ud. Nu forbliver det låst, fortæller at genindlæsningen fejlede, og giver dig en Prøv igen-knap, så du aldrig retter i en forældet trup.

Alle detaljer som altid på cyclingzone.org/patch-notes.
