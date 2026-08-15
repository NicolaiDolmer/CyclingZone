# #3634 — backfill af ryttere uden anlægs-sekundær (dry-run, ingen mutation)

**Status: EJER-GATED.** Ingenting er kørt. Denne fil er beslutningsgrundlaget.
Kør selv: `infisical run --env=prod -- node backend/scripts/dev/anlaegBackfillDryRun3634.mjs`

## Omfanget er mindre end frygtet

| Målt i prod 2026-08-15 (read-only) | Antal |
|---|---:|
| Levende ryttere i alt | 8.634 |
| **Uden `archetype_draw.secondary`** | **72** |
| Heraf på menneskeejede hold | 72 |
| Heraf på AI-hold / frie | 0 |
| **Helt uden `archetype_draw`** | **0** |

De ~573-606 historiske uden anlæg findes ikke længere: #3593's oprydning holder.
De 72 er alle født **efter** #3632-merget, ad startholds-stien til nye managere.
Generator-fixet i denne PR lukker kilden; de 72 er resten.

`primary_type` afviger fra `archetype_draw.primary` for **0 af 72** — primæren er
allerede forankret. Det er kun sekundæren der mangler.

## To kandidater, begge flytter loftet

Ingen af dem er gratis. En forankret sekundær vejer **0,82** af evne-loftet i sin
retning, hvor "ingen sekundær" vejer **0,45** (`naturalSecondaryFactor` mod
`neutralFactor`). At forankre er derfor i sig selv en loft-ændring:

| Kandidat | Loft-flytning (L1 over 15 evner) | | | Uændrede |
|---|---:|---:|---:|---:|
| | median | p90 | max | |
| **A — frys klassifikatorens gæt** | 74 | 117 | 162 | 0 |
| **B — frisk træk mod `DEFAULT_DISTRIBUTION`** | 73 | 128 | 174 | 0 |

**Ingen af de 72 slipper uændret igennem.** Påstanden "forankring er usynlig"
(#3593 spec §12) holder ikke for denne årgang, fordi de har `secondary: null` og
ikke bare et andet gæt.

## Fordelingen er hele forskellen

| Sekundær | A frys % | B frisk % | Mål (`DEFAULT_DISTRIBUTION`) |
|---|---:|---:|---:|
| sprinter | 2,8 | 8,3 | 14,45 |
| tt | **0,0** | 11,1 | 10,08 |
| climber | 6,9 | 20,8 | 16,13 |
| puncheur | **0,0** | 11,1 | 13,00 |
| brostensrytter | 25,0 | 8,3 | 9,93 |
| baroudeur | **41,7** | 12,5 | 12,02 |
| rouleur | 19,4 | 13,9 | 15,89 |
| gc | 4,2 | 13,9 | 8,50 |
| **L1 mod målet** | **96,5 pp** | **23,2 pp** | — |

A og B ville vælge forskellig sekundær for **60 af 72** ryttere.

## Afvejningen

**A — frys gættet.** Samme metode som #3593. Spilleren ser den samme
sekundære type som i dag, og de to skrivestier (derive og motor) bliver enige, så
driften stopper. Prisen: den cementerer 41,7 % baroudeur og **0 % tt / 0 % puncheur**
som permanent identitet for de 72 — præcis den defekt #3631 findes for at fjerne.

**B — frisk træk.** Retter både forankringen og fordelingen (L1 96,5 → 23,2 pp).
Prisen: den skifter den **synlige** sekundære type på 60 ryttere som spillere ejer
og kan have handlet efter. #3631 kalder selv det "et spiller-vendt indgreb der
kræver særskilt ejer-go".

**Min anbefaling: B.** Begrundelsen er at A's fordel er mindre end den ser ud.
A ændrer ikke type-etiketten, men flytter alligevel rytterens loft med median 74
point — så "ingen synlig ændring" er ikke et valg der findes her. Når loftet
rykker uanset hvad, er der ingen god grund til samtidig at fryse skævheden fast.
72 ryttere er lille nok til at kunne forklares i én patch note.

**Hvis B vælges** hører der en patch note og en Discord-besked med: 60 spillere
ser en rytter skifte andentype. Det skal meldes, ikke opdages.

## Hvad der IKKE er besluttet

Selve kørslen. Der findes ikke et apply-script — kun denne dry-run. Skriv hvilken
kandidat du vil have, så bygges apply'en med idempotens + post-verify efter
#2642-rammerne.
