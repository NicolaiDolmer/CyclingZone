# #4000 — Type-dæmpning i værdiformlen: scorecard (måling FØR flip)

**Status:** måling, INGEN ændring foretaget. Live model
(`backend/lib/riderValuationModelV4.json`) er urørt; ingen DB-skrivning.
**Bindende rækkefølge** (kommentar på #3353, ejer-godkendt 20/8):
niveaukorrektionen (#3449, gate-styret, tidligst 30/8) appliceres FØR denne
dæmpning flippes. De to må ALDRIG køre samtidig eller omvendt.

Harness: `backend/scripts/dev/typeDampeningHarness4000.mjs` (+
`backend/scripts/dev/lib/typeDampeningScenarios4000.mjs`, rene funktioner,
21 `node --test`-tests). Data: `docs/snapshots/4000/` (dateret
Supabase-snapshot, read-only, se README dér for genskabelse).

## Problemet (målt 20/8)

V4-modellens `fit.offset[type]` er fittet på meget skæve stikprøvestørrelser:

| type | n (fit) | offset | multiplikator |
|---|---:|---:|---:|
| tt | 2.622 | −0,139 | 0,87x |
| climber | 1.947 | +0,180 | 1,20x |
| sprinter | 1.190 | −0,080 | 0,92x |
| rouleur | 122 | +0,029 | 1,03x |
| brostensrytter | 59 | +0,850 | 2,34x |
| baroudeur | 34 | +0,027 | 1,03x |
| **gc** | **34** | **+0,463** | **1,60x** |
| **puncheur** | **19** | **+2,071** | **7,90x** |

Prod-population (aktiv sæson 2, 8.945 aktive ryttere, snapshot 20/8):
**214 puncheurs** (87 på menneskehold), **134 gc** (32 på menneskehold).
brostensrytter (n=59, 2,34x) er strukturelt samme problem som puncheur/gc,
blot mindre ekstremt — ikke nævnt i issuet, men fanget af målingen.

## Metode

16 scenarier: baseline + offset-regularisering (k=50/100/200) + alpha-sænkning
(α=0,85/0,7/0,5) + alle 9 kombinationer. For hvert scenarie: `predictBaseValueV4`
(URØRT produktionskode) køres for alle 8.945 aktive ryttere med den
alternative model. Offset-regularisering: `offset'[t] = offset[t] × n[t]/(n[t]+k)`
(n = model.type_stats[t].n, den ORIGINALE fit-stikprøve — jo mindre n, jo
tættere krybes mod 0).

**Normalisering:** enhver dæmpning der fjerner outsized værdi fra
puncheur/gc/brostensrytter flytter automatisk POPULATIONS-SUMMEN (de typer
sidder på uforholdsmæssigt meget af den samlede markedsværdi i dag, netop
fordi de er overvurderede). Rå sum-ændring rapporteres, men alle
pr.-type/topmover/menneskehold-tal nedenfor er **normaliserede** (skaleret med
én global faktor så populations-summen matcher baseline igen) — det er
FORDELINGEN målingen skal vise, ikke et niveau-fald der bare kommer af at
mindske hele økonomien.

## Headline: alle 16 scenarier

| scenarie | rå Δsum | norm.-faktor | puncheur median | gc median |
|---|---:|---:|---:|---:|
| offset k=50 | −16,6 % | ×1,199 | −73,3 % | −9,0 % |
| **offset k=100** | **−18,7 %** | **×1,230** | **−78,4 %** | **−12,9 %** |
| offset k=200 | −20,1 % | ×1,252 | −81,1 % | −15,7 % |
| alpha α=0,85 | −23,3 % | ×1,304 | +24,1 % | +26,1 % |
| alpha α=0,7 | −39,4 % | ×1,651 | +49,5 % | +54,4 % |
| alpha α=0,5 | −54,0 % | ×2,172 | +84,1 % | +94,2 % |
| combo k=50 + α=0,85 | −36,1 % | ×1,564 | −66,8 % | +14,8 % |
| combo k=100 + α=0,85 | −37,8 % | ×1,607 | −73,2 % | +10,0 % |
| combo k=200 + α=0,85 | −38,8 % | ×1,635 | −76,5 % | +6,4 % |
| combo k=50 + α=0,7 | −49,4 % | ×1,975 | −60,1 % | +40,2 % |
| combo k=100 + α=0,7 | −50,6 % | ×2,022 | −67,9 % | +33,9 % |
| combo k=200 + α=0,7 | −51,3 % | ×2,055 | −71,9 % | +29,4 % |
| combo k=50 + α=0,5 | −60,8 % | ×2,551 | −51,8 % | +73,2 % |
| combo k=100 + α=0,5 | −61,7 % | ×2,608 | −61,2 % | +65,1 % |
| combo k=200 + α=0,5 | −62,3 % | ×2,649 | −66,1 % | +59,5 % |

**Overraskende fund:** alpha ALENE gør puncheur/gc RELATIVT DYRERE efter
normalisering (+24 % til +94 %), ikke billigere. Alpha blander alle rytteres
O mod deres gennemsnits-evne uanset type — det rammer den BREDE population
(climber/tt/sprinter, 7.801 af 8.945 ryttere) hårdere end de smalle
speciale-typer, så når summen normaliseres tilbage op, er det puncheur/gc der
vinder mest. Alpha løser altså IKKE det problem issuet beskriver — det
forværrer det efter normalisering, og kræver en langt større
normaliserings-korrektion (×1,3 til ×2,65 mod ×1,2–1,25 for ren
offset-regularisering).

## Anbefalet scenarie: offset-regularisering, k=100 (KUN håndtag b, alpha urørt)

### Pr.-type fordelingsændring (normaliseret, n=8.945)

| type | n (pop.) | median Δ | p10 | p90 |
|---|---:|---:|---:|---:|
| puncheur | 214 | **−78,4 %** | −78,4 % | −78,4 % |
| gc | 134 | **−12,9 %** | −12,9 % | −12,9 % |
| brostensrytter | 186 | −27,9 % | −27,9 % | −27,9 % |
| climber | 3.626 | +21,9 % | +21,9 % | +22,0 % |
| tt | 3.401 | +23,7 % | +23,6 % | +23,7 % |
| sprinter | 774 | +23,8 % | +23,8 % | +23,8 % |
| baroudeur | 299 | +20,6 % | +20,6 % | +20,6 % |
| rouleur | 311 | +21,4 % | +21,4 % | +21,4 % |

Meget smal p10–p90-spredning inden for hver type — offset er en additiv
konstant i eksponenten, så dæmpningen rammer stort set alle ryttere af samme
type ens (kun elite-præmie-tærsklen giver enkelte outliers). Ingen inversion
(se sanity-tjek nedenfor): dæmpningen flytter NIVEAUET pr. type, ikke
RÆKKEFØLGEN inden for typen.

### De 20 største enkelt-udslag (absolut CZ$, k=100-scenariet)

| rytter | type | før | efter | Δ% | ΔCZ$ |
|---|---|---:|---:|---:|---:|
| Joris Coppens | puncheur | 69.237.471 | 14.950.066 | −78,4 % | −54.287.405 |
| Andrea Riva | puncheur | 23.756.219 | 5.129.549 | −78,4 % | −18.626.670 |
| Cooper Dawson | puncheur | 15.333.585 | 3.310.897 | −78,4 % | −12.022.688 |
| Ayoub Bouazza | tt | 44.928.982 | 55.554.864 | +23,7 % | +10.625.882 |
| Carlos Lozano | gc | 73.984.921 | 64.417.414 | −12,9 % | −9.567.507 |
| Marcos Ramírez | gc | 64.159.134 | 55.862.269 | −12,9 % | −8.296.865 |
| Oliver Newton | tt | 25.020.190 | 30.937.563 | +23,7 % | +5.917.373 |
| Javier Vega | tt | 15.034.888 | 18.590.698 | +23,7 % | +3.555.810 |
| Shun Kimura | puncheur | 4.172.402 | 900.923 | −78,4 % | −3.271.479 |
| Aitor Iglesias | gc | 24.693.742 | 21.500.422 | −12,9 % | −3.193.320 |
| Corentin Charpentier | tt | 12.418.075 | 15.354.999 | +23,7 % | +2.936.924 |
| Rui Tavares | brostensrytter | 10.431.902 | 7.520.351 | −27,9 % | −2.911.551 |
| Riku Yamada | gc | 15.698.936 | 13.668.797 | −12,9 % | −2.030.139 |
| Tomáš Kovač | tt | 8.348.503 | 10.322.957 | +23,7 % | +1.974.454 |
| Tommaso Sorrentino | puncheur | 2.442.640 | 527.426 | −78,4 % | −1.915.214 |
| Loïc Gauthier | gc (elite-gulv) | 8.315.500 | 10.229.755 | +23,0 % | +1.914.255 |
| Julien Moreau | gc (elite-gulv) | 8.315.500 | 10.229.755 | +23,0 % | +1.914.255 |
| Stefano Orlando | gc (elite-gulv) | 8.315.500 | 10.229.755 | +23,0 % | +1.914.255 |
| Niels Lenaerts | sprinter (elite-gulv) | 8.315.500 | 10.229.755 | +23,0 % | +1.914.255 |
| Rubén Lozano | rouleur (elite-gulv) | 8.315.500 | 10.229.755 | +23,0 % | +1.914.255 |

**Joris Coppens** (fri agent, punch=93, potentiale 5,5) er den rendyrkede
illustration af problemet: elite-præmien (`applyElitePremium`, exp-vækst over
overall-tærsklen) STABLER oveni det allerede 7,9x-forstørrede
puncheur-offset og lander på 69,2M — langt over hvad selv en verdensklasse
tt/climber-rytter med sammenlignelig overall når (`Ayoub Bouazza`, 44,9M,
tt). Rækkerne der ender på præcis 8.315.500 → 10.229.755 rammer alle
`elite_premium.floor` (den garanterede ukøbelighedsgulv for overall≥58,
type-uafhængig) og flytter derfor med normaliseringsfaktoren alene, ikke med
offset-dæmpningen — forventet og korrekt, ikke en fejl.

### Effekt på de 87 menneskehold-puncheurs

| | median | p10 | p90 |
|---|---:|---:|---:|
| Δ% | −78,4 % | −78,4 % | −78,4 % |

Alle 87 rammes praktisk talt ens (offset er en fælles konstant) — ingen enkelt
manager rammes uforholdsmæssigt hårdt relativt til de andre 86.

### Effekt på de 32 menneskehold-gc'er

| | median | p10 | p90 |
|---|---:|---:|---:|
| Δ% | −12,9 % | −12,9 % | −12,9 % |

Markant mildere end puncheur — konsistent med at gc's offset (1,6x) var langt
mindre ekstremt end puncheur's (7,9x) i udgangspunktet.

## Sanity-tjek: ingen inversion (doktrin-gate)

`checkTypeMonotonicity` konstruerer for hver (scenarie × type) en STIGENDE
serie af syntetiske, pointvis-dominerende evneprofiler (5 niveauer, 25→85 i
alle 15 evner samtidig) og verificerer at `predictBaseValueV4` er
ikke-faldende hen over serien. Kørt for alle 16 scenarier × 8 typer = **128
kontroller, 0 inversioner**. Matematisk forventet: offset er en additiv
konstant i eksponenten (rører ikke O's hældning), og selv alpha's
O-omvægtning bevarer monotoni, fordi en pointvis-dominerende evneprofil
dominerer BÅDE speciale-output og gennemsnits-evne samtidig uanset
blandingsvægt. Bedre evner giver altid ≥ værdi, i alle 16 scenarier.

## Anbefaling

**offset-regularisering ALENE, k=100** (`fit.alpha` forbliver 1,0, urørt).

Begrundelse (mindst forstyrrelse, mest dæmpning af de dårligt understøttede
offsets):

1. **Rammer PRÆCIST det issuet beskriver.** k=100 er større end n for alle de
   svageste offsets (puncheur n=19, gc/baroudeur n=34, brostensrytter n=59) —
   de dæmpes alle >50 % mod 0 — men mindre end den store klynge (tt/climber/
   sprinter, n>1.000), som forbliver praktisk talt urørt af selve
   offset-mekanikken (deres egen skift er <1 procentpoint; det de ser i
   tabellen er ren normaliserings-genfordeling).
2. **Alpha løser IKKE problemet — det forværrer det.** Målt: alpha alene gør
   puncheur/gc relativt DYRERE efter normalisering (se "overraskende fund"
   ovenfor), fordi håndtaget er for bredt (rammer alle 8.945 ryttere ens,
   ikke kun de dårligt understøttede typer). Kombinationerne arver samme
   problem i mindre grad, og kræver alle en normaliserings-faktor ×1,56–×2,65
   — 1,3–2,2× større forstyrrelse af RESTEN af populationen end
   offset-alene (×1,20–×1,25) for samme eller ringere effekt på puncheur/gc.
3. **k=100 er midtpunktet i det testede spænd** — k=50 dæmper puncheur
   "kun" 73 % (stadig en ~3,7x multiplikator tilbage, betydeligt over enhver
   anden type), k=200 dæmper gc næsten dobbelt så hårdt som k=100 (−15,7 %
   mod −12,9 %) uden en klar begrundelse for hvorfor gc (n=34, samme
   størrelsesorden som baroudeur, som knap flytter sig fordi dets offset
   allerede var ~0) skal straffes hårdere end k=100 tilsiger. k=100 er derfor
   den forsvarlige standardindstilling; k=50 er en mere konservativ
   fallback hvis ejeren ønsker en blødere flip, k=200 en mere aggressiv hvis
   puncheur-multiplikatoren (fortsat 1,7x efter k=100) stadig opleves for høj.
4. **Ingen inversion i noget scenarie** — doktrinen holder uanset valg af k.

**Global normaliseringsfaktor for det anbefalede scenarie: ×1,230**
(rapporteres eksplicit, jf. opgavens krav — rå populations-sum falder 18,7 %
FØR normalisering, fordi puncheur/gc/brostensrytter i dag bærer
uforholdsmæssigt meget af den samlede markedsværdi; EFTER normalisering er
populations-summen per definition uændret, og det er fordelingen der er
flyttet).

## Ikke gjort i denne slice

- **Ingen ændring af `riderValuationModelV4.json` eller nogen DB-række.**
  Scorecardet forelægges ejeren FØR noget flippes, og flippet sker først
  SAMMEN med #3449-niveaukorrektionen (bindende rækkefølge, se topmatter).
- Ingen re-fitning af selve modellen (a/b/c-koefficienterne) — kun
  offset-tabellen og alpha er i spil, som specificeret i #4000.
