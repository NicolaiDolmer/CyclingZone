# Postmortem · 2026-08-05 · Kontraktudløb-mekanikkens "worst case" (#2748, 23/7) var allerede forældet ved S2→S3

## Hvad skete der?
#1150 (kontraktudløb ved sæsonskifte, S2→S3) blev bygget ud fra issuets citerede tal:
807 udløbende ryttere (625 på menneskehold), verificeret 3/8. Et read-only dry-run
mod prod 5/8 — kun 2 dage senere — fandt **1.399 udløbende ryttere** (980 menneske
+ 419 AI), og **170 af 180 menneskehold** (94%) berørt. 60 menneskehold og 28
AI-hold ville falde under MIN_RIDERS_FOR_RACE=8 hvis ingen handlede. #2748's
egen 23/7-måling ("selv i det absolut værste tilfælde falder intet hold under 8")
var altså allerede forældet af markedsaktivitet på tidspunktet #1150 blev bygget.

## Root cause
`contract_end_season` for nye/genforhandlede kontrakter beregnes som
`currentSeason + length - 1` (contractSeed.js). Enhver 1-sæsons-kontrakt signet
ELLER FORLÆNGET midt i sæson 2 (auktion, transfer, extend-contract) udløber
DERFOR ved den kommende sæson — dvs. hver dags markedsaktivitet i S2 lagde flere
ryttere til "udløber ved S2→S3"-tallet. #2748's worst-case-måling var et
øjebliksbillede fra en tidlig del af sæsonen (23/7); jo tættere sæsonen kom på sin
slutning, jo mere af trupmassen samlede sig naturligt i den kommende
udløbssæson. Ingen af de eksisterende faser (contract_expiry_release,
squadRiskGuard, squadBelowMinimumCheck) genmåler denne vækst løbende — de
regner alle korrekt PÅ TRANSITIONS-TIDSPUNKTET, men ingen af dem advarer om at
POPULATIONEN vokser undervejs.

Derudover havde AI-hold (#2744-B's oprindelige release-fase) INGEN
fornyelses-mekanisme overhovedet — kun mennesker kan trykke "forlæng" (#1720).
Ved S1→S2 (196 ryttere, 195 på AI-hold) var det trygt (værste AI-hold endte med
18 tilbage). Ved S2→S3 ville det have guttet op til 80 AI-hold til 3-5 ryttere
— et FUNKTIONELT brud (kan ikke stille løbshold), ikke kun en balance-ulejlighed.

## Fix
- `backend/lib/aiContractAutoRenewal.js` (+seasonTransition.js wiring): AI-hold
  auto-fornyer nu ALLE udløbende senior-kontrakter FØR release-fasen, samme
  prisformel som en manager ville fået (computeContractExtension, ingen ny logik
  opfundet). Beskytter alle 80 berørte AI-hold / 419 ryttere.
- `frontend/src/pages/DashboardPage.jsx`: nyt kontrakt-udløbs-varsel (samme
  visuelle sprog som det eksisterende squadWarning-banner) — den passive
  contractExpiring-badge (#3097) var ikke nok til at gøre 170/180 berørte
  menneskehold opmærksomme i tide.
- `backend/scripts/dryRunContractExpirySeasonEnd.js`: read-only dry-run-script,
  genbrugelig FØR fremtidige sæsonskifter (ikke kun denne ene gang).

## Forhindret-fremover
Dry-run-scriptet er ikke en engangs-ting — kør det igen tæt på 23/8 (og ved
fremtidige sæsonskifter) for at fange yderligere vækst i tallet, i stedet for at
stole på et tal citeret i et issue der kan være dage gammelt. `docs/NOW.md`s
"🎯 Next action" bør pege på en gentagelse af dry-run'et lige før cutover, ikke
kun selve mekanikken.

## Læring
Et "worst case, målt på tidspunkt X" er en SNAPSHOT, ikke en invariant — hvis
den population målingen dækker vokser af sig selv (her: markedsaktivitet der
konstant genererer nye kort-varige kontrakter), forældes målingen uden at nogen
kode-sti opdager det. Automatiske sikkerhedsnet (fx AI-fornyelse) bør derfor
designes til at holde uanset skala, ikke kalibreres mod ét historisk øjebliksbillede.
