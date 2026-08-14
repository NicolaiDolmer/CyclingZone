# Gaten målte en fast strategi i stedet for bedste spil

**2026-08-15 · #3709 trin 4 · kostede to forkerte hovedkonklusioner i træk**

## Hvad skete der

Specens beslutning 14 lover at fremragende træning giver dagens rating-niveau
(27 → 28). Jeg byggede en gate der skulle efterprøve det:

```js
ok: kandidat.spids.rating >= idag.spids.rating
```

Den fejlede: 29 → 27. Jeg rapporterede til ejeren at **ankeret ikke holder**, at
selv den bedst ledede rytter ender to point under i dag, og at han skulle vælge
mellem at acceptere det, genåbne en låst beslutning, eller udskyde.

Det var forkert. Gaten målte det forkerte.

## Rod-årsagen

`spids` er ikke det bedste spil. Det er *en* strategi.

Bevist på en ægte rytter fra snapshottet: Tommaso Valli, tidskører + baroudeur —
to anlæg der peger hver sin vej. Spidses han, **falder** hans enkeltstart fra 77
til 71, fordi fokusset skubber ham over mod baroudeur-siden. Roteres han, får han
enkeltstart 85. For ham er spidsning et fejltræk.

"Hvad kan en dygtig manager opnå" er derfor et **maksimum pr. rytter**, ikke en
fast strategi pålagt hele feltet. Med den rigtige måling: **29 → 30**. Ankeret
holder, og lidt bedre end specen lovede.

Pr. potentiale-bånd stiger 595 af 600 ryttere. Hovedgruppen (potentiale 1-2,
n=492) går 27 → 28, altså præcis specens tal.

## Hvorfor jeg ikke fangede det

Gaten var symmetrisk og så derfor retfærdig ud: samme strategi på begge sider,
ingen åbenlys skævhed. Men symmetri er ikke det samme som gyldighed. Under dagens
model er alle fire strategier næsten ens (agens-spænd 1 point), så det er
ligegyldigt hvilken man vælger. Under kandidaten spreder de sig med 7 point, og så
afgør valget af strategi resultatet.

**En gate der sammenligner to modeller på en fast strategi antager stiltiende at
strategien betyder det samme i begge.** Præcis når den antagelse brister, er
ændringen værd at måle — så gaten går i stykker på nøjagtig de ændringer den
findes for at vurdere.

Signalet lå der: `standard` og `rotation` gav begge 28, mens `spids` gav 27. Min
"bedste" strategi tabte til to andre i min egen tabel. Jeg læste det som støj.

## Læringen

1. **Når en gate sammenligner to modeller, spørg hvad den holder fast.** Alt hvad
   den holder fast, antages at være neutralt mellem modellerne. Skriv antagelsen
   ned og se på den.
2. **"Bedste spil" er et maksimum over spillerens valg, ikke et bestemt valg.** Så
   snart en ændring gør valget vigtigt, skal målingen optimere over valget.
3. **Et resultat der modsiger en gennemarbejdet spec er først et signal om egen
   fejl.** Specen havde en harness der målte 27 → 28. Da min gav noget andet,
   sagde jeg "specen kan ikke efterprøves" i stedet for at spørge hvad min
   måling gjorde anderledes. Det var det rigtige spørgsmål, og det havde svaret.
4. **Sig det højt når fortegnet vender.** Jeg rapporterede først "ankeret falder",
   så "det ligger inden for usikkerheden", så "det holder". To rettelser i træk er
   pinligt, men hver af dem var sandere end den før — og alternativet, at lade den
   første stå, ville have kostet en ejer-beslutning truffet på et forkert grundlag.

## Beslægtet

Samme dag, samme harness: `generateAcademyCandidates` returnerer
`{ is_serious, archetypeDraw, rider }` med rytter-rækken **indlejret**. Jeg sendte
indpakningen videre til `seedPhysiologyFromLegacy`, som gav alle 1.200 ryttere
identiske evner. Det så ud som et resultat — arketype-skarphed 1,00 og feltets
forskellighed 0,00, for alle fire modeller.

Fælles mønster: **en degenereret måling ligner et fund.** Skarphed 1,00 for alle
og et agens-spænd der peger forkert er begge tal man kan skrive en forklaring til.
Kontrollen er ikke at forklaringen lyder rigtig, men at spørge hvad der skulle
være galt for at give netop dette tal.

Se også `.claude/learnings/2026-08-14-maal-bygget-paa-et-tal-jeg-ikke-havde-sporet.md`.
