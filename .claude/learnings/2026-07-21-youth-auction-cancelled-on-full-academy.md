# Youth-auktion annulleret ved fuldt akademi — 5 vundne auktioner tabt (21/7)

## Symptom
Nattens auktions-close (20/7 22:53) annullerede 5 **vundne** ungdomsauktioner for ægte hold. Rytterne blev frigivet/herreløse, vinderne fik intet, ingen blev opkrævet. Community (thelamba) havde flagget mønstret på forhånd (#2754): vundet YTH-auktion → annulleret pga. fuldt akademi → rytter fri agent igen → kunne hentes billigt.

## Rodårsag
`finalizeYouthAuctionRecord` placerede KUN vinderen i akademiet (8-plads-cap). Var akademiet fuldt (`finalize_academy_acquisition` → `academy_full`), annullerede den auktionen + slettede/frigav rytteren. Der var **ingen senior-fallback**, selvom flere af holdene havde rigelig senior-plads (21-23/30). Det brød ejer-reglen #2701: "man skal altid kunne købe en rytter hvis man samlet set har plads."

## Fix (PR #2766)
I `academy_full`-grenen: forsøg senior-placering (`tryPlaceYouthWinnerOnSenior`) FØR annullering — senior-kontrakt + løn + 30-cap, samme kapacitets-helpers som senior-auktions-stien. Annullér kun hvis både akademi og senior er fulde (eller ingen råd). Debit deler idempotency_key med akademi-vinderen → ingen dobbelt-betaling. Scope: harm-prevention-kerne, ikke fuld #2701 (bud-gate/senior-først).

## Remediation
Kørt gennem den fixede finalizer (reset cancelled→active→re-finalize) frem for håndlavet SQL — genbrug af den testede sti. Canary (mindste auktion) verificerede deploy+adfærd før batch. 3 placeret+opkrævet, 1 allerede hel (gen-købt separat), 1 gen-listet (kunne ikke betale nu).

## Læringer
1. **Verificér claim mod ALLE penge-veje, ikke kun den forventede.** Jeg påstod "Hardly fik en gratis rytter" ud fra finans knyttet til youth-auktionen. Forkert: de havde betalt 17.917 via en SEPARAT senior-auktion. Ejeren fangede det ved at spørge "er du helt sikker?". Tjek rytter-ejerskab + acquired_at + hele holdets finans, ikke kun `related_entity_id = auction_id`. Se [[feedback_runtime_verify_first]].
2. **Remediér gennem den testede kode, ikke rå mutationer.** Reset→re-finalize genbruger finalizer-logikken (kontrakt/løn/cap/idempotens korrekt) frem for at håndrulle placeringen i SQL.
3. **Canary før batch ved deploy-afhængig remediation.** Kunne ikke tjekke Railway-deploy (MCP unauthorized, /health uden commit-sha). En enkelt reset + verify af `source_path` bekræftede at nyt kode kørte, uden at gætte deploy-timing. `deleteUnsoldYouthRider`s expired-intake-keep gjorde en for-tidlig re-run harmløs.
4. **Community-flags er reelle bugs.** thelambas rapport (#2754) beskrev præcis denne fejlklasse dage før. Prioritér verifikation af flaggede exploits før den næste close.
EOF
echo "postmortem skrevet"