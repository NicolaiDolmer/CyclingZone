# Patch note-udkast v7.139 (natbølge 18/8 — KUN merged ændringer)

> Udkast til PatchNotesPage-entry. Kort per ejer-krav 13/8. NB: draft-PR #3885 medbringer sin egen v7.139-entry (byttehandel/akademi-cap) — merges den, konsolideres de to entries til én.

**EN:**
Fixed: board bonus offers could disappear without paying out when accepted. Accepting is now a single safe step.
Fixed: a forced debt sale could crash halfway and leave the money without removing the rider. It now completes properly.
Fixed: riders sold from your academy now count in the academy profit overview going forward.
Stability: several behind-the-scenes guards were added around auctions, rider cleanup and race integrity.

**DA:**
Rettet: bestyrelsens bonus-tilbud kunne forsvinde uden udbetaling når de blev accepteret. Accept er nu ét sikkert skridt.
Rettet: et tvangssalg kunne fejle halvvejs og efterlade pengene uden at rytteren blev solgt. Det gennemføres nu korrekt.
Rettet: ryttere solgt fra dit akademi tæller nu med i akademiets økonomioverblik fremadrettet.
Stabilitet: flere usynlige sikkerhedsvagter omkring auktioner, rytter-oprydning og løbsintegritet.

**FAQ/help.json-behov:** Ingen ny spilmekanik i de mergede ændringer — ingen help.json-opdatering nødvendig for natten. (Race Centre #3893 kræver help-entry NÅR den merges.)
