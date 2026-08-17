# Handoff: bitype-sessionen 15/8 → næste session

Kopiér blokken nederst ind som prompt. Alt over den er kontekst hvis du vil læse med.

## Hvad der skete

Hovedsporet #3634/#3631 er leveret og verificeret. Voksen-generatoren fødte ryttere med `archetypeDraw: { primary, secondary: null }`, klassifikatoren gættede andentypen forfra hver nat, og gættet var skævt. Målt 24 nye ryttere i døgnet ramt.

- **PR #3800 merget.** Anlægget forankres, andentypen trækkes fra `DEFAULT_DISTRIBUTION`. Patch note 7.133. Populationen er bit-identisk med før, så intet andet flyttede sig.
- **PR #3802 åben, CI grøn.** Backfill af de 72 allerede fødte, kandidat B (ejer-go). **Kørt mod prod og verificeret:** alle 8.634 levende ryttere har nu et fuldt anlæg. Patch note 7.134 + Discord-udkast.
- **PR #3801 åben.** Første udkast til 23/8-cutover-drejebogen (#3645). Docs.
- **Nye issues:** #3799 (balance-baselinen er 131 afvigelser skæv på urørt main) · #3804 (bi-typen former ikke kroppen endnu).

## Det der er værd at vide inden du fortsætter

**Vægten står på 0, og det var ikke planen.** Det godkendte design sagde at kroppen skulle formes efter begge arketyper. `race:gate` fejler ved enhver vægt over 0, også 0,02, fordi dens kalibrerings-bånd i praksis er en golden-population-fixture. Alt det presserende er uafhængigt af vægten, så den står på 0 og resten ligger i #3804. Postmortem: `.claude/learnings/2026-08-15-scorecardet-maalte-generatorens-egne-gates-men-ikke-motorens.md`.

**#3512 rører de samme filer** (`fictionalRiderGenerator.js` + dens test). Den er draft med fejlende gates siden 14/8 og vil konflikte med #3800. Ubesluttet: luk eller rebase.

**Discord-udkastet er ikke sendt.** `docs/discord/2026-08-15-andentype-rettelse.md`. Det bør postes FØR næste derive-kørsel, fordi det er dér de 60 ryttere skifter synlig andentype.

---

## Prompt til næste session

```
Luk restarbejdet fra bitype-sessionen 15/8 og tag derefter fat på trin 7.

START MED at læse docs/NOW.md og docs/sessions/2026-08-15-handoff-bitype-og-prs.md.
Hvis "Working agent" viser en anden aktiv session, STOP og spørg mig først.

SPOR 1 — luk de to åbne PR'er (ca. 30 min, ingen ny kode)

  PR #3802 (backfill af de 72, allerede kørt mod prod og verificeret, CI grøn).
  Læs patch note 7.134 igennem med mig FØR merge. Den lover at rytterens
  nuværende evner og værdi er urørte, men at udviklingsloftet flytter sig.
  Verificér den påstand i koden (buildCapsForRider returnerer max(tapered,
  current)) før du siger den er rigtig. Merge først når jeg har sagt god for
  teksten.

  PR #3801 (cutover-drejebog #3645, docs). Den stiller fire spørgsmål i bodyen.
  Det vigtigste: skal 23/8 reduceres til race-day-flippet alene, når kun 1 af 4
  komponenter er klar? Præsentér dem ÉN ad gangen med din anbefaling, ikke som
  en liste. Merge når vi er igennem dem.

  Herefter: ryd worktrees fix-3634-backfill-72 og docs-3645-cutover-drejebog.

SPOR 2 — #3512 skal afgøres (ca. 15 min)

  Den er draft siden 14/8, fejler G1-G4 på fictional/starter/ai, og rører de
  samme to filer som det netop merged #3800. Læs dens body, mål om dens præmis
  stadig holder efter #3800, og giv mig en anbefaling: luk eller rebase.
  Beslutningen er min.

SPOR 3 — trin 7 (#3746), hovedsporet resten af sessionen

  Prompt: docs/sessions/2026-08-16-trin7-potentiale-som-fart-prompt.md.
  Alle 8 ejer-beslutninger står på issuet. S5 er det vigtigste tal i forløbet.

BINDENDE FOR HELE SESSIONEN

  - Egen worktree pr. spor via scripts/new-worktree.ps1. Rør ALDRIG worktreen
    3746-trin7 eller branchen feat/3746-trin7-potentiale-som-fart uden at
    tjekke NOW.md først.
  - Kør npm run race:gate, ikke kun node --test, ved ENHVER ændring der rører
    generatoren eller race-motoren. Den er et separat CI-trin. Det kostede en
    CI-runde 15/8; se .claude/learnings/2026-08-15-scorecardet-maalte-
    generatorens-egne-gates-men-ikke-motorens.md.
  - Patch note: 7.133 og 7.134 er taget. Tjek origin/main OG åbne PR'er (#3798
    har 7.132) lige før push, og tag næste ledige nummer.
  - Ingen prod-mutation uden at spørge mig. Dry-run + tal først, altid.
  - Send ALDRIG en spillerbesked. Skriv udkast, jeg poster selv.
  - Saml det jeg skal tage stilling til, men stil det ÉN ting ad gangen i klart
    sprog med din anbefaling.

IKKE I DENNE SESSION

  #3804 (bi-typen skal forme kroppen) hører efter 23/8-cutoveren. Den kræver at
  race:gate's kalibrerings-bånd rekalibreres først, og det er ikke en lille
  opgave.
```
