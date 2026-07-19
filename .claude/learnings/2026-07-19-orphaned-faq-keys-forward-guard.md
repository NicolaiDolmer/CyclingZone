# Forældreløse FAQ-nøgler: copy skrevet, aldrig renderet (18 stk.)

**Dato:** 2026-07-19 · **PR:** #2693 · **Relateret:** #2691 (samme fælde, 2 nøgler)

## Symptom
18 FAQ-entries lå færdigskrevne i `help.json` (en+da) men blev aldrig vist på
Hjælp-siden — i op til 3 uger (relaunch-FAQ'erne fra #1470 endda længere).

## Rodårsag
`HelpPage.jsx` renderer kun nøgler der står i den håndvedligeholdte
`FAQ_KEYS`-liste. Mindst 6 forskellige feature-PR'er (#2013, #2247, #2323,
#2385, #2366, #1470) tilføjede FAQ-copy til `help.json` uden at registrere
nøglen — og ingen check fangede det, fordi i18n-checkene kun validerer
key-parity/ICU, ikke om en nøgle faktisk bruges.

## Fix
Alle 18 verificeret mod nuværende mekanik (4 parallelle kode-audits +
prod-flag-check) og registreret; 3 svar copy-rettet hvor koden afveg
(satisfaction-clamp 5 ned/8 op; OVR-kolonne ligger på Auktioner-siden).

## Forward-guard
`frontend/src/pages/HelpPage.faqKeys.test.js` — fejler hvis en `faq.*`-nøgle i
help.json mangler i `FAQ_KEYS` eller omvendt (+ en/da-parity). Kører i den
obligatoriske frontend `node --test`-suite.

## Generalisering
Registry-lister der skal holdes i sync med data-filer (keys→liste, config→enum)
er glemsels-magneter i feature-PR'er. Giv dem en sync-test samme dag de opstår,
ikke efter tredje gentagelse.
