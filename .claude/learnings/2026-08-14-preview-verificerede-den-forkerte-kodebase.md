# Preview verificerede den forkerte kodebase

**Dato:** 14. august 2026 · **Sag:** #3666 landing 1 · **Klasse:** falsk verifikation

## Hvad skete der

Jeg havde ændret ryttertype-radaren i et worktree og ville se den køre, som ejer-reglen
kræver ved UI-arbejde. Jeg startede preview-serveren med `preview_start` og navigerede
til rytterprofilen. Siden viste *"Evner endnu ikke beregnet"* og rating `—`.

Jeg brugte derefter flere runder på at fejlsøge det som en **datafejl**: tjekkede mockens
tabel-dispatch, tilføjede en manglende handler, genindlæste, tjekkede netværkskald,
inspicerede selecten i `RiderStatsPage`.

Til sidst hentede jeg den serverede modulfil og gremmede efter min egen kode. Den var der
ikke.

**`preview_start` kører fra sessionens primære arbejdsmappe — hovedmappen — ikke fra
worktreet.** Serveren leverede `main`s frontend hele vejen. Jeg fejlsøgte en kodebase der
ikke indeholdt en eneste af mine ændringer.

## Hvorfor det er værd at skrive ned

Fejlen er ikke at preview pegede forkert. Fejlen er at **jeg tolkede et negativt resultat
som et fund** i stedet for først at spørge om måleinstrumentet overhovedet målte det rigtige.
Havde jeg brugt ét kald på at bekræfte at serveren serverede min kode, var de mellemliggende
runder aldrig sket.

Det er samme mønster som `feedback_runtime_verify_first`, men vendt om: dér handler det om at
verificere en påstand mod runtime. Her handlede det om at verificere at **runtime er den
runtime man tror**.

## Regel fremadrettet

Når der arbejdes i et worktree og en preview/dev-server startes:

1. **Bekræft at serveren serverer worktreets kode, før noget tolkes som et fund.** Ét kald:
   hent en fil du lige har ændret, og grep efter ændringen.
2. Et tomt eller uventet UI i preview er et **instrument-spørgsmål før det er et datafund**.
3. `preview_start` med `.claude/launch.json` binder til hovedmappen. Skal et worktree
   previewes, startes dev-serveren med worktreet som arbejdsmappe.

## Sidegevinst

Jagten afdækkede en ægte defekt der havde ligget længe: preview-mocken havde **aldrig** haft
en handler for `rider_derived_abilities`. Rytterprofilens evner har derfor aldrig kunnet ses
på preview, hvilket betyder at rating-pladen, ryttertype-radaren og Fysiologi-fanen aldrig
har kunnet godkendes visuelt før live. Den er lukket nu, med tre tests — heraf én der
verificerer at seedets tal overhovedet kan produceres af den nye rating-model, så seedet ikke
igen kan drive væk fra virkeligheden.

Fundet er reelt, men det retfærdiggør ikke fejlen: jeg fandt det ved at fejlsøge det forkerte
sted, ikke ved at lede efter det.
