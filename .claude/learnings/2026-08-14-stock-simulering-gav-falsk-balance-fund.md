# Stock-simulering af mættede ryttere gav et falsk balance-fund

**Dato:** 2026-08-14 · **Kontekst:** design-session for rytterudvikling ([#3659](https://github.com/NicolaiDolmer/CyclingZone/issues/3659) → [#3709](https://github.com/NicolaiDolmer/CyclingZone/issues/3709))

## Hvad der skete

Jeg målte en ny progressionsmodel ved at simulere **eksisterende** ryttere fra
snapshottet fremad til 30 år. Resultatet sagde, at arketype-skarpheden faldt fra
0,84 til 0,78 — et fald der pegede direkte imod #3503's mål om skarpere
arketyper, og som jeg skrev ind i specen som modellens største omkostning.

Det var forkert. Da den samme model blev målt på et **friskt kuld** genereret
gennem produktionens egen intake-sti, ramte den 0,87 mod dagens 0,87. Faldet
fandtes ikke.

## Hvorfor

Under dagens model mætter hver evne sit loft inden for karrieren. De
eksisterende ryttere i snapshottet er derfor allerede tæt på lofter, der er
formet af deres type — deres top-3 evner *er* deres type, uanset hvad man gør
med dem bagefter. Når en langsommere model simuleres oven på den tilstand,
dominerer startværdierne resultatet, og startværdierne bærer den gamle models
form. Målingen målte fortiden, ikke modellen.

Det er præcis, hvad spec §4.3 ("flow, ikke stock") advarer mod. Jeg kendte
reglen og kørte stock alligevel, fordi den var hurtigere at bygge — og skrev så
et fund ned, som reglen forudsiger er falsk.

## Reglen

**Enhver gate på en progressions- eller balancemodel måles pr. kuld.** Et
snapshot af beholdningen er kun gyldigt til at måle *nuværende* tilstand, aldrig
til at måle hvad en ny model ville producere. Beholdningen bærer den gamle
models form i sine startværdier.

Praktisk: byg flow-harnessen **først**. Den koster en generator-sti mere
(`generateAcademyCandidates` → `seedPhysiologyFromLegacy` → `deriveAbilities`),
og den er den eneste, hvis tal må stå i en spec.

## Sidegevinst

Da flow-harnessen blev bygget, afslørede den også, at jeg havde beskrevet
akademiets mekanik forkert i specen: produktionen bruger **ikke**
`computeAcademySeasonCeiling` — #2437 satte `tickCaps = caps`. Den rigtige
mekanik er `INTERIM_RATE_MULT` + `HARD_DAILY_CAP`. At bygge den ægte sti tvang
den fejl frem; stock-harnessen havde skjult den.

Se også: [[feedback_verify_numbers_from_specs_before_shipping]],
[[feedback_simulate_before_ship_balance]]
