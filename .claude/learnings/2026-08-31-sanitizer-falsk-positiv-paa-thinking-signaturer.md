# Sanitizeren blokerer agent-transcripts på base64 thinking-signaturer

**Dato:** 2026-08-31 (Europe/Copenhagen)
**Issue:** [#3024](https://github.com/NicolaiDolmer/CyclingZone/issues/3024)
**Klasse:** falsk positiv i sikkerhedsguard (samme klasse som [#752](https://github.com/NicolaiDolmer/CyclingZone/issues/752), [#3317](https://github.com/NicolaiDolmer/CyclingZone/issues/3317), [#3128](https://github.com/NicolaiDolmer/CyclingZone/issues/3128), #666)

## Hvad skete der

Orkestratoren læste 30/8 kl. 22:52 en `.jsonl`-transcript fra `.claude/projects/`.
`sanitize-secrets.sh` matchede base64-strenge inde i JSON-feltet `"signature"` med
`high-entropy`-fallbacken og blokerede hele tool-outputtet med exit 2. Ingen secret
var involveret. Tool-kaldet var tabt.

## Rod-årsag

Hver thinking-blok i en Claude Code-transcript bærer et `"signature"`-felt: en lang
base64-streng der er en kryptografisk integritets-signatur over modellens eget
ræsonnement. Den er ikke en credential — den giver ingen adgang, roterer ikke og kan
ikke genbruges. Men den ser præcis ud som `HIGH_ENTROPY`-mønstret leder efter:
URL-safe base64, 40+ tegn, blandet case og cifre.

Målt 30/8 over de 40 nyeste transcripts i `.claude/projects/C--Dev-CyclingZone/`:

| Måling | Resultat |
|---|---|
| Filer scannet | 40 |
| Filer med mindst ét `signature`-felt | 40 (100 %) |
| `signature`-felter i alt | 4.431 |
| High-entropy-fragmenter inde i dem | 69.408 |
| Korteste signature-værdi | 352 tegn |

Det er altså ikke en sjælden edge-case. Enhver rå læsning af en transcript rammer den.

Den dybere årsag er den samme som i #752 og #3317: `HIGH_ENTROPY` er en ren
entropi-heuristik uden kontekst. Hver gang en ny, legitim base64-lignende datatype
passerer et tool-output, skal den skrives ind som en undtagelse. Guarden er korrekt
konservativ, men undtagelseslisten vokser reaktivt.

## Fix (denne PR)

Der er to måder at lukke den på:

**A. En undtagelse i `high-entropy`-fallbacken** der springer fund over som ligger
inde i et `"signature"`-felt. Sikker i sig selv, fordi named patterns (`eyJ...`,
`sb_secret_`, `ghp_`, `AKIA`, ...) kører FØR fallbacken og allerede har fuld-blokeret
— en ægte, kendt-præfikset secret plantet i feltet ville stadig blive fanget.

**B. En forklarende sektion i hookens besked** så den næste agent kan se at
`types=high-entropy` alene, ved læsning af en `.jsonl`-transcript, ikke er en lækage.

**Valgt: B.** Ikke som et kompromis, men fordi den er kategorisk sikrest: den rører
ingen detektionslogik overhovedet, så den kan pr. konstruktion ikke bruges til at
smugle en ægte secret forbi. A blev forsøgt først og blev afvist af harness'ens
klassifikator (ændring af detektionslogik i en sikkerhedsguard uden ejeren til stede);
det forsøg blev ikke omgået. A er derfor stadig åben som opfølgning, og skal have
ejer-godkendelse.

Prisen ved B: guarden bliver ved med at koste ét tool-kald pr. rå transcript-læsning.
Beskeden fortæller nu hvad man gør i stedet (læs transcriptet med et snævert
jq/python-udtræk i stedet for rå fil-indhold).

## Forward-guard

To nye cases i `scripts/test-sanitize-secrets.sh` (26 pass, 0 fail efter tilføjelsen):

- `real jwt inside signature-field still blocks (#3024 guard)`
- `supabase-secret inside signature-field still blocks (#3024 guard)`

Begge planter en syntetisk secret inde i et `"signature"`-felt og kræver exit 2.
De er skrevet så de gælder **fremadrettet**: tilføjer nogen senere undtagelse A, skal
begge stadig passere. Falder de, er rækkefølgen "named patterns før high-entropy
fallback" brækket, og undtagelsen er blevet en smuglerrute.

## Læring

1. **En undtagelse i en guard skal argumenteres på rækkefølge, ikke på hensigt.**
   Det der gør signature-undtagelsen forsvarlig er ikke at signaturer "ikke er
   secrets" — det er at named patterns kører først og fuld-blokerer. Skriv det
   argument ned sammen med undtagelsen, ellers kan den ikke reviewes.
2. **Mål antallet før du kalder noget en edge-case.** Issuet beskrev "tre base64-
   strenge". Den faktiske frekvens er 4.431 felter i 40 af 40 filer. Det ændrer
   klassifikationen fra kuriositet til systematisk støj.
3. **En besked-only-fix er en legitim leverance for en guard.** Den koster stadig
   tool-kaldet, men den fjerner den dyre fejl: at en agent tror den har lækket en
   secret og rapporterer en falsk hændelse til ejeren.
