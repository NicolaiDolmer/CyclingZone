#!/usr/bin/env node
/** Ejer-svar 15/7 → skriv beslutninger ind på #2437/#2454/#2176/#2456. */
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const gh = (a) => execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 1 << 26 }).trim();
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'czans-'));
const SPEC_A = 'docs/superpowers/specs/2026-06-11-kernesystemer-design.md';
const SPEC_B = 'docs/superpowers/specs/2026-07-11-training-youth-depth-design.md';

const C = [
  {
    n: 2437,
    body: `## Ejer-beslutning 15/7 — begge foreslåede muligheder afvist, ny retning

Jeg foreslog A (tids-proratér sæson-budgettet) eller B (hæv raten). Ejeren afviste præmissen bag begge:

> "**Der skal som sådan ikke være et loft over hvor meget en rytter kan træne på en sæson, men deres træninger skal bare være så 'lave', at der ikke er brug for et maks.** Vi skal også huske, at vi vil lave en **træningsscore** ved træninger og at vi vil gøre sådan, at **træninger kun træner nogle enkelte evner, fremfor hver eneste evne**, når man træner rytterne. Kan være, at 1 er bedst nu, mens vi designer denne løsning."

**Diagnosen er skarpere end min:** loftet er det forkerte værktøj — raten er det rigtige. Et sæson-loft er en nødbremse, der skjuler at den underliggende vækstrate er for høj. Sænk raten, og loftet bliver overflødigt.

### Beslutning: to spor

**Spor 1 — interim (dette issue):** tids-proratér budgettet (min oprindelige mulighed 1). Ejeren: *"Kan være, at 1 er bedst nu, mens vi designer denne løsning."* Formålet er **kun** at låse de 87% blokerede akademi-ryttere op, mens den rigtige model designes. Ikke en permanent løsning — den skal eksplicit kunne fjernes igen.

**Spor 2 — den rigtige model:** hører hjemme i den eksisterende spec (se konflikt nedenfor), ikke her.

### Begge ejer-idéer er ALLEREDE designet — og de to specs modsiger hinanden

Verificeret 15/7 (jf. læs-eksisterende-planer-før-du-bygger):

**1. "Træningsscore"** — findes i [\`${SPEC_A}\`](../blob/main/${SPEC_A}) §5.1 + §6.1:
> "hver rytter får en daglig **træningsscore**; scoren fylder synlige progress-barer pr. evne (fordelt efter rytterens program); fuld bar → +1 i evnen. Blanding af 'chunky events' og XP-bar — synlig fremdrift uden decimal-støj. **L0-motorens sæsonvise vækstbudget omlægges til den daglige strøm**."

Sidste sætning er præcis ejerens retning: væk fra sæson-budget, over til daglig strøm.

**2. "Kun enkelte evner pr. træning"** — findes i [\`${SPEC_B}\`](../blob/main/${SPEC_B}) §4.1:
> "Dagens **fokus** får sæson-budgettet; **off-focus-evner får ~0 daglig vækst**. Du kan ikke udvikle alt samtidig — du **vælger**." Og §0.3 navngiver præcis symptomet: "Alt stiger næsten uanset fokus (#1922) fjerner valgets betydning."

### ⚠️ Spec-konflikt der skal løses før slicing

De to specs er uenige om netop det, ejeren lige har udtalt sig om:

| Spec | Siger | Status vs. ejer 15/7 |
|---|---|---|
| \`2026-06-11-kernesystemer\` §5.1 | Sæsonvist vækstbudget **omlægges til daglig strøm** | ✅ Matcher |
| \`2026-07-11-training-youth-depth\` §3.2 | "**Sæson-budget-loft bevares** som anti-eksplosions-struktur" + generaliseres fra akademi til hele den daglige model | ❌ Modsiger |

\`2026-07-11\` §3.2 vil altså **udbrede** præcis den mekanik, der har dræbt træningen i prod — fra akademi til alle ryttere. Havde vi sliced den spec som skrevet, ville vi have gjort problemet større.

Til forsvar for §3.2: dens sæson-budget er **gap-proportionalt** (\`seasonBudget ∝ gap\`), hvilket er selv-aftagende og ikke den flade éngangs-pulje, vi har i dag. Det er en bedre mekanik end den nuværende. Men det er stadig et loft, og ejeren siger vi ikke skal have et.

**Handling:** §3.2 skal omskrives før træning+ungdom-dybde sliced. Den gap-drevne rate (§3.1) er stadig rigtig — det er nødbremsen ovenpå, der skal væk. Spørgsmålet til design-runden: er den gap-drevne rate i sig selv "lav nok til at et maks ikke er nødvendigt" (ejerens krav), eller skal den kalibreres ned?

### Accept (opdateret)

- [ ] **Spor 1:** tids-proratér som interim → verificér at de 1.540 låste evne-rækker låses op i prod.
- [ ] Markér interim-koden eksplicit som midlertidig, med henvisning til dette issue.
- [ ] **Spor 2:** omskriv \`2026-07-11\` §3.2 (fjern sæson-loft, sænk rate i stedet) + indarbejd træningsscore fra \`2026-06-11\` §5.1 + fokus-allokering fra §4.1.
- [ ] Simulér den loft-frie model mod ægte population FØR ship: kan raten alene holde en 16-årig pot-6 i ro over en 120-dages sæson uden nødbremse?
- [ ] Ejer godkender den samlede model, før den sliced.`,
  },
  {
    n: 2454,
    body: `## Ejer-beslutning 15/7 — mulighed A, med en vigtig tilføjelse

> "I databasen skal rytterne have potentiale fra 1-99, men vi skal bruge 1 ingame tænker jeg. **Talentspejderen må gerne fortælle hvad han forventer potentialet er, men det skal ikke nødvendigvis være rigtigt**, eller at han skal vise et spændt. Han skal selvfølgelig ikke vise håbløst forkert, bare noget der er tæt på. Så hvis en rytters potentiale er 77, må han gerne sige **75-79. Eller 70-80, eller 75-85** osv. Han må gerne være upræcist, men han skal stadig fortælle et nogenlunde rigtigt billede. Eller f.eks **71-77. Eller 77-87** osv. Flere spænd er okay."

### Kontrakten

- **Database:** potentiale er et eksakt tal **1-99**. Erstatter 1-6-skalaen.
- **In-game:** 1-99-skalaen bruges, men spilleren ser **aldrig** det sande tal — kun talentspejderens estimat.
- **Talentspejderens estimat er et interval, og det må være både upræcist OG forskudt.** Det er den vigtige nuance, jeg havde misforstået: jeg antog et interval, der altid indeholder sandheden og snævrer symmetrisk ind. Ejeren siger nej — for et sandt potentiale på 77 er alle disse legitime estimater:
  - \`75-79\` (snævert, centreret)
  - \`70-80\` (bredt, centreret)
  - \`75-85\` (forskudt opad — sandheden ligger i den nedre ende)
  - \`71-77\` (forskudt nedad — sandheden ligger i den øvre kant)
  - \`77-87\` (sandheden ligger på selve kanten)
- **Grænsen:** "han skal selvfølgelig ikke vise håbløst forkert, bare noget der er tæt på". Estimatet skal give et nogenlunde rigtigt billede.

### Hvorfor det er bedre end det jeg foreslog

Et interval der altid indeholder sandheden og kun snævrer ind, er reelt bare sandheden med støj på — spilleren kan midle sig frem til facit ved at spejde nok. Et estimat der **kan være forskudt** betyder, at spejderens vurdering er en *vurdering*, ikke en måling. Det gør spejder-kvalitet (#1138) og fejlkøb til ægte spilelementer: du kan ærligt tage fejl af en rytter.

### Åbne design-parametre (mine, ikke ejerens — jeg foreslår, ejer nikker)

- **Hvor forskudt må estimatet være?** Forslag: bias trukket fra en fordeling centreret om 0, så et centreret estimat er mest sandsynligt, men skæve forekommer. Sandheden skal ligge i eller nær intervallet — aldrig langt udenfor ("ikke håbløst forkert").
- **Hvad styrer bredden?** Kandidater: spejderens kvalitet, hvor længe/ofte rytteren er spejdet, rytterens alder (yngre = mere usikker). Alle tre er meningsfulde spilhåndtag.
- **Er estimatet stabilt?** Foreslår: **ja, per spejder-observation** — samme spejder giver ikke et nyt tal hvert refresh (så kan man ikke reroll'e sig til facit). Nyt estimat kræver ny spejder-indsats.
- **Skal to spejdere kunne være uenige?** Det ville være godt — men det afhænger af #1138's model. Åbent.

### Accept (opdateret)

- [ ] Migration: potentiale 1-6 → 1-99 (bundlet, ejer merger).
- [ ] Server-reglen består: rå potentiale forlader **aldrig** serveren — kun spejder-estimatet sendes til klienten.
- [ ] Estimat-generator: interval med variabel bredde + tilladt forskydning, deterministisk pr. observation.
- [ ] Backwards-check: alle steder potentiale/stjerner vises (rytterside, akademi, scouting, transferliste, hover-kort) opdateres i samme PR.
- [ ] Patch note + help — skala-skift er brugerrettet.

**Bemærk:** dette låser #1138 (talentspejder) fast som en **kerne**-mekanik, ikke et tilvalg. Uden spejderen har spilleren ingen potentiale-information overhovedet. Det bør afspejles i #1138's prioritet.`,
  },
  {
    n: 2176,
    body: `## Ejer-beslutning 15/7 — auto-accept er den høje

Forholdet mellem de to priser er nu afklaret:

- **Udbudspris** = minimum bud / auktionens startpris. Hvad rytteren er til salg for, og hvad andre kan byde fra.
- **Auto-accept-pris** = et **højere** tal. Rammer nogen det, udløses 30-min-auktionen straks.

Sælger får dermed to håndtag: *"byd fra X"* og *"ram Y, så går det i gang med det samme"*. Markedet får stadig sin chance, fordi auto-accept ikke er et stille "køb nu" — det starter en offentlig auktion.

Dermed er \`needs-decision\` løst på det spørgsmål, jeg rejste. Kontrakten er:

1. Sælger sætter **udbudspris** (X) og **auto-accept-pris** (Y), hvor Y > X.
2. Bud fra X og opefter er tilladt; sælger kan acceptere manuelt.
3. Bud ≥ Y → **30-minutters auktion** starter automatisk på rytteren.
4. Direkte hold-til-hold-handler afskaffes (issuets oprindelige pointe består).

**Validering der følger af kontrakten:** UI skal håndhæve Y > X. Hvad sker der, hvis sælger sætter dem lige? Foreslår: ikke tilladt — hvis Y = X, er ethvert lovligt bud et auto-accept, og udbudsprisen mister betydning.

De tre auktions-issues fra denne sweep hører sammen og bør designes i én omgang, ikke som tre løsrevne PR'er:
- **Dette issue** — to priser + 30-min auto-auktion.
- **#1905** — sælger vælger auktions-varighed (1-48t, må ikke slutte 00-08). Bemærk spændingen: her er varigheden **fast** 30 min. Skal auto-auktionen også kunne vare 1-48t, eller er 30 min bevidst kort, fordi den er reaktiv? Jeg læser ejeren som: 30 min er bevidst — det er en sidste-chance-runde, ikke en normal auktion.
- **#2452** — gebyr ved udbudspris >50% af værdi. Interagerer direkte: hvilken af de to priser måles de 50% på? Foreslår **udbudsprisen** (det er den, der spærrer markedet ved fantasital).`,
  },
];

for (const c of C) {
  const f = path.join(tmp, `c-${c.n}.md`);
  fs.writeFileSync(f, c.body, 'utf8');
  gh(['issue', 'comment', String(c.n), '--body-file', f]);
  console.log(`  #${c.n} kommenteret`);
}

// #2437 er ikke længere kun "vælg A/B" — den har nu en aftalt retning.
gh(['issue', 'edit', '2437', '--remove-label', 'needs-decision']);
console.log('  #2437: needs-decision fjernet (retning aftalt)');
gh(['issue', 'edit', '2454', '--remove-label', 'needs-decision']);
console.log('  #2454: needs-decision fjernet (kontrakt aftalt)');
gh(['issue', 'edit', '2176', '--remove-label', 'needs-decision']);
console.log('  #2176: needs-decision fjernet (kontrakt aftalt)');
console.log('\nFÆRDIG.');
