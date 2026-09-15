# Holdarbejde og Lederskab: to nye rytter-evner (design-session 15/9 2026)

> **Status:** ejer-låste beslutninger fra design-session 15/9 (Claude Code, ét kort ad gangen, ejer-go pr. kort). **Intet er bygget.** Build starter FØRST når #3668 (evne-skala) er besluttet og anvendt, jf. `docs/HOWTO_ADD_ABILITY.md` linje 7 (ejerens egen forudsætning). Genåbn ikke beslutningerne.
> **Intention-SSOT:** `docs/GAME_DESIGN_DOCUMENT.md` R-003/D-021 til D-031 (10/9). Denne spec omsætter dem til mekanik. **Tal er privat kalibrering** (hard rule 17): specen låser bånd og gates, aldrig konstanter.
> **Issues:** #1177 (holddynamik: kaptajner + mentor + erfaring) er design-hjem; #3668 er forudsætning. Build-issues oprettes ved close-out 15/9.
> **Forskning:** `docs/design/gdd/RIDER_ATTRIBUTES_RESEARCH.md` ("Før nogen bygger en ny evne").

## 1. Hvad dokumentet beslutter

To nye evner i det almindelige evnesystem (`backend/lib/abilityRegistry.js`, kategori `mental`, `derivation: {source: "skill"}`), begge synlige som de 15 andre. **Holdarbejde** (EN: Teamwork) virker i løbet på nytten af hjælp. **Lederskab** (EN: Leadership) virker kun i truppen via mentorpar og påvirker intet i løbet. De to øvrige kandidater fra 10/9, **Ro under pres** og **Træningsdisciplin**, er fortsat kun retning og er ikke behandlet her.

## 2. Ejerens beslutninger 15/9 (9 kort)

### 2.1 Holdarbejde (6 kort)

| # | Spørgsmål | Valg (ejer 15/9) | Konsekvens |
|---|---|---|---|
| H1 | Hvor virker evnen i løbet? | **A: nytten for modtageren** | Holdarbejde skalerer hvor meget beskyttelse kaptajnen får (`engine/v4/mechanics/teamPlay.ts`) og hvor godt leadoutet leverer (`leadout.ts`: `QUALITY_KEYS` får `teamwork` som fjerde nøgle). Hjælperen betaler SAMME pris (`RiderLoad`/work_norm røres ikke). Kaptajnens eget Holdarbejde skalerer hvor stor del af hjælpernes ordre der faktisk leveres (D-023's startvirkning). Fravalgt: billigere hjælp (B), begge kanaler (C) |
| H2 | Hvor kommer tallet fra? | **A: afledt af profil + støj** | Fødsel: arketype + positionering/taktik/durability giver et gennemsnit, stor støj oveni; ingen kobling til rå styrke. Eksisterende ryttere: samme formel én gang ved migration. Kilde for eksisterende ryttere kan være taktik-overskuddet fra #3668 behandling D (ejer-idé 15/9), hvis den behandling vælges |
| H3 | Hvordan udvikles den? | **A: løb i hjælperrolle + holdpas** | Vækst når rytteren faktisk kørte som hjælper/leadout på en løbsdag (via løbsdags-udviklingen, kun når rollen var aktiv i motoren) OG via det rollefordelte holdpas (#4853). Ingen enkeltmands-session. Aftagende ved gentagelse (D-018). Fravalgt: kun træning, kun løb |
| H4 | Hvem ser tallet? | **A: som de andre evner, ingen særregel** | Egen rytter: tal i evne-tabellen under mental + én linje i løbsrapporten når effekten faktisk blev registreret. Fremmede ryttere følger #5107 (fog of war) når den lander |
| H5 | Hvor bor kemien? | **A: par-tabel** | Ny tabel `rider_pair_chemistry (rider_a, rider_b, value, last_shared_game_day, updated_at)`, nøglet på ryttere (ikke hold), så den bevares ved fælles transfer (D-025). +trin pr. løbsdag hvor begge kørte og den ene hjalp den anden (rolle aktiv), loft, langsomt fald når de ikke kører sammen. Vises som én linje på rytterkortet ("kører godt med X"). Fravalgt: afledt af historik (B), hold-niveau (C) |
| H6 | Hvor stor må effekten være? | **A: mildt bånd + harness-gate** | Forskellen 1 → 99 hos hjælperen flytter kaptajnens udbytte "mærkbart men aldrig afgørende" (samme klasse som positionering i leadout i dag). Kemi lægger et mindre lag oveni. **Gate:** v4-harness viser at en stærkere hjælper med lavere Holdarbejde ALDRIG er dårligere end en svagere med højt, ved ellers lige forhold (styrke straffes aldrig). Fravalgt: kraftigt bånd, nul-start |

### 2.2 Lederskab (3 kort)

| # | Spørgsmål | Valg (ejer 15/9) | Konsekvens |
|---|---|---|---|
| L1 | Hvor kommer tallet fra, hvordan vokser det? | **A: alder + profil ved fødsel, vokser af kaptajn-/mentortid** | Fødsel: lav for unge, stigende med alder, lille profil-træk (taktik/positionering) + støj. Vækst: +trin pr. sæson (alder) og +trin pr. løbsdag som udpeget kaptajn eller aktiv mentor; aftagende nær toppen, top sent (30+). Eksisterende ryttere: samme formel én gang; taktik-overskuddet (#3668 D) kan være frø for veteraner |
| L2 | Hvad lærer eleven, hvordan? | **A: ekstra evne-delta pr. løbsdag på de mentale evner** | Hver løbsdag (løb eller træning) får eleven et lille ekstra træk på taktik, positionering og Holdarbejde (senere Ro under pres) hvor mentoren er tydeligt bedre (D-029). Skaleres af mentorens Lederskab og parrets opbygning (0 → fuld over nogle uger, D-031). Under loftet +1 pr. evne pr. tick (#4850). Vises som én linje i træningsrapporten ("lærte af X"). Fravalgt: via træningsscoren (B), kun ved fælles løb (C) |
| L3 | Hvor vælges mentorpar? | **A: elevens rytterprofil + overblik på holdsiden** | Udviklingsfanen på elevens profil får et lille "Mentor"-felt (liste af egnede sorteret efter Lederskab; ikke-egnede grå med årsag). Holdsidens Squad-fane får en kort sektion "Mentorpar" (par, opbygning som bar, én linje). Ingen ny side. Fravalgt: Staff-fane, træningssiden |

## 3. Mekanik (arkitekt-udfyldning, må udfordres i build)

### 3.1 Registry og data

- To registry-poster (`HOWTO_ADD_ABILITY.md` trin 1-4): `teamwork` og `leadership`, `category: "mental"`, `derivation: {source: "skill"}`, `inContrast` efter #3668's beslutning (de skal fødes på den skala #3668 vælger for de mentale evner), `inClassifier: false`, `storageOrder`/`displayOrder` 16-17. Mindst én display-opskrift pr. evne (guard 1): `teamwork` ind i hjælper-/leadout-opskrifter, `leadership` i kaptajn-/veteran-opskrift. `classifierWeights` og `capsShapingWeights` røres ikke uden ejer-go.
- To `smallint`-kolonner på `rider_derived_abilities` (idempotent migration, grants; `riders-column-grant-guard`).
- `rider_pair_chemistry` (H5): PK `(rider_a, rider_b)` med `rider_a < rider_b`, RLS som `rider_derived_abilities` (kun de to rytteres managere, ellers service-role).
- `rider_mentor_pairs (mentor_rider_id, mentee_rider_id, team_id, started_game_day, buildup, ended_at)`; maks 2 aktive elever pr. mentor (constraint + test), samme `team_id`.
- Lofter: `buildCapsForRider` får de to evner med; ingen "dobbelt svaghed"-gulv for dem (retning A i TRAINING_RULES §12: lofter skal føles fraværende).

### 3.2 Motor (Holdarbejde)

- `teamPlay.ts`: beskyttelsesudbyttet for kaptajnen ganges med `f(hjælperens teamwork) × g(kemi)`, hvor `f` og `g` er monotone og båndet er mildt (H6). Prisen for hjælperen er uændret.
- `leadout.ts`: `teamwork` som fjerde `QUALITY_KEY`; vægten sættes i harness.
- Kaptajnens `teamwork` skalerer "leveret andel" af hjælpernes ordre-indsats (D-023/D-024), aldrig ekstra træthed.
- Løbsrapport: én linje pr. registreret effekt ("hans holdarbejde holdt kaptajnen i position"), aldrig genereret fra et højt tal alene.
- **Gate (H6):** `scripts/v4*`-harness med parvis test: stærkere hjælper/lavere teamwork mod svagere/højere; den stærkere må aldrig give kaptajnen mindre. Plus §7b-ankre uændrede.

### 3.3 Udvikling (Holdarbejde H3, Lederskab L1/L2)

- Løbsdags-udvikling (`race_day_development_enabled`, flag off, tændes til S4 i #4850): når rytterens rolle var hjælper/leadout OG rollen var aktiv i motoren, får `teamwork` et træk i samme budget som de øvrige relevante evner (`RACE_PROFILE_ABILITY_MAP` udvides pr. rolle, ikke pr. profil).
- Holdpas (#4853): `teamwork` er sessionens evne for hjælper-rollerne.
- Lederskab: +trin ved sæsonskifte (alder), +trin pr. løbsdag som udpeget kaptajn (`race_stage_roles`/team orders) eller aktiv mentor. Aftagende nær toppen.
- Mentor-delta (L2): pr. løbsdag, pr. mental evne hvor `mentor > mentee + tærskel`, `delta = base × lederskab(mentor) × buildup(par) × gap-faktor`, lagt i `ability_progress` og underlagt +1/tick-loftet. Kun positiv (D-028).
- Alt under invarianten "træning straffer aldrig" og under sæson-budgettet i `TRAINING_RULES.md` §3 (samlet udvikling pr. sæson må ikke stige; rater rekalibreres, ikke lægges oveni).

### 3.4 Flader

- Evne-tabellen (`RiderAbilityColumns.jsx`, genereret fra registry): to nye rækker under mental. Kort tekst; forklaring i `help.json` en+da.
- Rytterkort/profil: én linje "kører godt med X" (H5) når kemi > tærskel; "Mentor"-felt på udviklingsfanen (L3).
- Holdsidens Squad-fane: sektion "Mentorpar" (L3), T2-skabelon, hairline-borders, ingen ny side.
- Træningsrapport: én linje "lærte af X" (L2). Løbsrapport: én linje pr. registreret holdarbejde (H4).
- Fog of war for fremmede ryttere: følger #5107, ingen særregel.

## 4. Rækkefølge og gates før build (ejer-låst 15/9 kl. 11:4x, "A: én samlet migration")

**Ejer-beslutninger på #3668 samme dag (ordret i issuet):** taktik og aggression må fremadrettet hverken bygge på alder eller på en anden evne; de er egne evner med egen udvikling. *"Intet skal være vægtet på PCM-stats mere. Spillet skal kunne holde sig selv oppe nu."* Eksisterende ryttere må IKKE miste evne-masse: taktik/aggression sænkes, men de tabte point flyttes til de nye mentale evner. Nye mentale evner fordeles ordentligt fra start.

1. **Nye evner først som data:** `teamwork` og `leadership` får registry-poster, kolonner og egen prior ved fødsel (profil + støj, H2/L1; ingen PCM, ingen alder som input for `teamwork`; alder er en lovlig faktor for `leadership` jf. D-030).
2. **ÉN samlet migration** (idempotent, backup-tabel, rollback): taktik/aggression sænkes (byggesporet viser to varianter med tal: flad procent vs. procent pr. aldersbånd; delta-princip bevarer træningsfremgang), tabte point flyttes til `teamwork`/`leadership` (helt eller delvist, mest til den evne profilen peger på), resten af bestanden får de nye evner fordelt efter profil + støj. Lofter for taktik/aggression rettes i samme PR (capsShaping = ejer-go med tal). **Apply i prod = eget go-kort med spillerbesked** ("taktik er delt i flere mentale evner").
3. **Derefter motor og trup bag flag:** Holdarbejde i v4 (`teamwork_in_engine`, off) → harness-gate H6 → flip ejer-only → udviklingsvej (kræver #4850 løbsdags-tick + #4853 holdpas) → kemi-tabel + rytterkort-linje. Lederskab: mentorpar (data + L3-flader) → mentor-delta (`mentor_pairs_enabled`, off) → måling mod sæsonbudget → flip.
4. **PCM-afkobling af al rytter-fødsel** (#3458/#3512-retningen) kører som eget spor parallelt: `fictionalRiderGenerator.js` genererer i dag stadig `stat_*`-værdier og udleder evner via `abilityDerivation.js`; målet er at evner fødes direkte fra spillets egne priors. Ejeren har ikke sat dato; det hører til ugeplanen 15/9 eftermiddag.
4. **Gates:** G-A1 evnerne fødes på samme skala som de øvrige mentale (#3668); G-A2 H6-harness; G-A3 samlet sæsonudvikling uændret ±tolerance med mentor-delta tændt; G-A4 0 rækker hvor en rytter er mentor for >2 eller på tværs af klubber; G-A5 kemi bevares ved fælles transfer (test); G-U1 ejer-visuelt go på flader (screenshots, 3 Playwright-projekter).
5. **Docs i samme PR'er:** `PROGRESSION_RULES.md`, `RACE_ENGINE_RULES.md`, `TRAINING_RULES.md`, `RIDER_GENERATION.md`, `HOWTO_ADD_ABILITY.md` (trin verificeret), `help.json`, patch note, `FEATURE_REGISTRY.yml`.

## 5. Ikke afgjort (ikke stillet 15/9)

- Ro under pres og Træningsdisciplin: retning kun (D-021). Eget kort-forløb.
- Om `teamwork` skal indgå i markedsværdi/løn-modellen (#3564 trin 4): nej i v1, som træningsscoren (A4).
- Om Lederskab-tærsklen for mentor-egnethed skal være absolut eller relativ til truppen: kalibreres privat.
- Præcise konstanter (bånd, kurver, opbygningslængde, kemi-loft/-fald): harness + privat kalibrering.
