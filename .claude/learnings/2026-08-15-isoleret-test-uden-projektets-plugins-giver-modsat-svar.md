# Jeg testede et bibliotek isoleret og fik det modsatte svar af virkeligheden

**Dato:** 15. august 2026 · **Sag:** #2884, auktionens sluttidspunkt · **Klasse:** falsk verifikation

## Hvad skete der

To gange på én session var jeg få minutter fra at rapportere en fejl der ikke fandtes. Begge gange havde jeg "verificeret" først.

**Én: i18n-interpolationen.** Jeg tilføjede locale-nøgler og brugte i18next-standardens `{{min}}`. Da jeg så at hele projektets locale-filer bruger enkelte klammer (`{amount}`), skrev jeg en isoleret node-test med projektets `interpolation`-config og fik bekræftet at enkelte klammer ikke interpolerer. Konklusion: hundredvis af strenge i alle namespaces har død interpolation. Jeg var i gang med at formulere issuet.

Projektet kalder `.use(ICU)`. Med i18next-icu er **enkelte** klammer det korrekte format, og dobbelte er literal tekst. Min isolerede test manglede pluginnet, så den målte et andet bibliotek end det der kører. Det var mine egne nøgler der var forkerte.

Det blev fanget fordi jeg åbnede fladen i browseren og læste teksten: `1-48 timer frem` stod som `{{min}}-{{max}}`.

**To: `extension_grace_minutes`.** Jeg målte at kolonnen ikke findes i prod, sporede kodestien, og fandt at grace derfor er 0 mens `DEFAULT_AUCTION_CONFIG` siger 60 og doc-kommentaren beskriver adfærden som aktiv. To issues (#1941, #3309) var lukket på præcis det fund. Jeg skrev det ind i PR-body'en som en ubemærket regression.

Grace = 0 er en **ejer-beslutning fra 3/7**: *"auktions-grace-perioden skal IKKE være en del af spillet — for kompliceret for nye spillere."* PR #2119 blev lukket uden merge med vilje. Hjælpeteksten er allerede skrevet om til at matche. Kolonnen mangler fordi featuren blev afvist.

Det blev fanget fordi jeg læste lukke-kommentaren på #3309 i stedet for kun titlen og status.

## Mønstret

Begge gange verificerede jeg **mekanikken** og sprang **konteksten** over.

- Jeg målte hvad i18next gør, ikke hvad *denne app* gør.
- Jeg målte hvad koden gør, ikke hvorfor den gør det.

En isoleret repro er ikke en verifikation af produktionsadfærd, hvis miljøet omkring den er skåret væk. Plugins, middleware og konfiguration ER adfærden. Og et lukket issue er ikke et fravær af information — lukke-kommentaren er ofte hvor beslutningen står.

## Regel fremadrettet

1. **Reproducér i den kørende app, ikke ved siden af den.** Et bibliotek der wrappes af plugins (`.use(...)`), middleware eller en adapter skal måles gennem den kæde. Er det UI, så åbn fladen og læs teksten.
2. **Før du kalder noget en regression: læs hvorfor det lukkede issue lukkede.** Titel + `state=CLOSED` er ikke svaret. Ved `NOT_PLANNED` eller "duplikat", læs kommentaren — der ligger typisk en ejer-beslutning.
3. **En manglende ting kan være en afvist ting.** Fravær af en kolonne, et flag eller en migration er lige så ofte et valg som en forglemmelse. Spørg hvad der ville stå i historikken hvis det var med vilje, og søg efter dét.

## Hvad der virkede

Browser-verifikationen. Jeg havde grønne unit-tests, grøn e2e og grøn lint på en tekst der viste `{{min}}-{{max}}` til spilleren — ingen af de tre kunne se det, fordi de alle asserterede på nøgler og struktur, ikke på det gengivne ord. Reglen om at vise fladen frem for at beskrive den fangede en fejl hele testpyramiden var blind for.

## Bør i HOT memory?

Nej. Det er en skærpelse af [[feedback_runtime_verify_first]], som allerede er HOT, og af 14/8-læringen om at spore et tal til sin producent. Det hører til som WARM detalje under samme klynge. Promotér hvis en tredje forekomst dukker op.
