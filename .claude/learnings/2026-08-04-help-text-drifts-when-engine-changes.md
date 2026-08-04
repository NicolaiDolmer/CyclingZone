# Hjælpetekst driver fra motoren, og intet fanger det

**Dato:** 2026-08-04
**Udløst af:** #3301 (auktions-forlængelse), #3305/#3274 (form-reset ved sæsonskifte), #3309 (grace-kolonne)

## Hvad skete der

Tre uafhængige fund samme dag, alle samme klasse: en spillervendt tekst påstod noget om spillets regler, som motoren eller prod-konfigurationen ikke længere gjorde.

1. **#3301** — hjælpen og auktions-hintet lovede at ethvert bud i de sidste 10 minutter forlænger auktionen. Motoren har siden #257 kun forlænget når føringen faktisk skifter. To spillere diskuterede det i Discord og kaldte reglen "underlig", fordi den ikke matchede det de havde læst.
2. **#3305** — FAQ'en svarede at form slet ikke røres af sæsonskiftet. Prod-`app_config` har `season_form_reset_mode='decay'`, så form regredieres mod 50 med faktor 0,25. Teksten var sand for S1→S2 og usand fremadrettet.
3. **#3309** — `DEFAULT_AUCTION_CONFIG` har `extension_grace_minutes: 60`, men kolonnen findes ikke i `auction_timing_config`. På den normale DB-sti er grace derfor 0. En patch note annoncerede i sin tid den modsatte adfærd.

## Rodårsag

Der er ingen kobling mellem motorens adfærd og den tekst der beskriver den. Alle tre steder gælder:

- Motoren ændres i en PR med tests, der beviser den NYE adfærd.
- Teksten ligger i en locale-JSON i et andet træ og har ingen test, ingen guard og ingen reference til den regel den beskriver.
- CI validerer at nøglerne findes og at tonen er rigtig, men aldrig at **påstanden** er sand.

Konfigurations-tilfældet (#3309) er værst, fordi driften kan ske uden at nogen rører hverken kode eller tekst: et fallback-objekt i JS og et tabelskema i Postgres kan glide fra hinanden i stilhed.

## Hvad der virkede

At verificere påstanden mod BÅDE koden og prod-konfigurationen før teksten blev skrevet. På #3305 var koden alene ikke nok: `season_form_reset_mode` har default `"off"`, så kildekoden ville have givet det modsatte svar af virkeligheden. Kun opslaget i prod-`app_config` afgjorde det.

Regel: **en tekst om en flag-styret mekanik skal verificeres mod prod-konfigurationen, ikke mod kodens default.**

## Forward-guards der bør bygges

1. **Kontrakt-test config-fallback vs. skema.** Sammenlign nøglerne i `DEFAULT_AUCTION_CONFIG` med kolonnerne i `auction_timing_config`. En nøgle uden kolonne er en død knap. Samme mønster gælder ethvert `DEFAULT_*_CONFIG` med en DB-modpart.
2. **Peg tekst mod regel.** Hjælpe-entries der beskriver en motor-regel bør bære en reference (fx en kommentar eller et felt med issue-nummer/modulnavn), så en ændring i modulet kan finde de tekster der påstår noget om det.
3. **Ved enhver motor-PR:** spørg "hvilken hjælpetekst påstår noget om det her?" i samme PR. Alle tre fund var billige at rette og dyre at opdage.

## Signal at holde øje med

Spillere der kalder en regel "underlig" eller "vilkårlig" i Discord er ofte ikke uenige i reglen. De har læst en beskrivelse der ikke passer. Behandl den slags som en doc-bug indtil andet er bevist, ikke som feedback på designet.

Se [[2026-08-04-watch-alarms-on-unactionable-history]] for samme dags anden lektion om vagter der beder om handlinger der ikke findes.
