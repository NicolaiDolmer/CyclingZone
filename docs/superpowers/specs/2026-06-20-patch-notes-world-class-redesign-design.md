# Patch Notes — verdensklasse-redesign (design)

**Dato:** 2026-06-20
**Issues:** lukker #1594 (sprog-filter + skjul interne) i praksis; absorberer #253 (overhaul: kategorier/søg/saml-dagens/menneske-sprog) og #43 (ikke på dansk); leverer patch-notes-delen af #413 (i18n Fase 4) og #954 (transparens-hub) **uden** Supabase-migrationen.
**Status:** godkendt design-retning (ejer-beslutninger truffet 2026-06-20). Afventer ejer-review af denne spec → writing-plans.

---

## 1. Problem

`/patch-notes` er i dag en 7.797-linjers fil med **471 versioner** (op til 13/dag) i ét stort `PATCHES`-array, renderet af en ~70-linjers komponent:

- **Begge sprog vises samtidig.** Hver nyere note ligger som `["EN · …", "DA · …"]` og komponenten renderer alle items → hver note står dobbelt. Intet i18n-filter.
- **Interne noter lækker.** ~951 af ~1.605 item-linjer er legacy enkeltsprog (mest dansk), mange med interne kategorier (`Admin`, `Infra`, `Reliability`, `Security`, `Backend`, `S-02a`…), SQL, fil-stier og RPC-navne. Siden ligner et dev-log-dump, ikke en spiller-changelog.
- **Ingen overskue­lighed.** Mikro-versioner (v5.75, v5.74…) er hver sit kort → 13 kort på én dag. Ingen overskrift pr. ændring, så man kan ikke se hvad en note handler om før klik. Ingen kategorier, ingen søg, ingen filtrering.

## 2. Mål / ikke-mål

**Mål**
- Spiller-egnet changelog i verdensklasse: kun aktivt sprog, kun spiller-rettet indhold, dag-grupperet, med overskrifter, kategori-filter og søg.
- Fuld historik bevaret og synlig (transparens), men renset for intern støj.
- CI-version-gaten (`scripts/check-patch-notes-version.js`) forbliver intakt.
- Data-formen er 1:1 migrér-klar til Supabase, hvis #954-hubben senere bygges.

**Ikke-mål (eksplicit ude af scope)**
- Supabase-migration / admin-redigering-uden-deploy / voting (#954 — ejer valgte "redesign nu på eksisterende data" 2026-06-20).
- Separat teknisk changelog-side (git-loggen er den tekniske changelog).
- Auto-oversættelse af legacy dansk-kun-bodies til engelsk.
- Nav-placering under "Hjælp & Regler" (#978) — separat lille IA-issue.
- Roadmap-siden (#1600) — egen side, eget spor.

## 3. Låste beslutninger (ejer, 2026-06-20)

| # | Beslutning | Valg |
|---|---|---|
| 1 | Scope / data-kilde | **Redesign nu på eksisterende (in-file) data**, migrér-klar form. Ikke Supabase. |
| 2 | Interne noter | **Skjul, slet ikke.** Hver ændring får et `audience`-flag; interne renderes ikke, men bevares i data. |
| 3 | Konsolidering | **Grupper efter dag.** Ét kort pr. dag, nyeste udfoldet, ældre foldet. `version` beholdes bag kulisserne (CI + sortering). |
| 4 | Overskrifter | **Håndskriv de seneste ~30 dage; auto-afled ældre.** |
| 5 | Gammel historik | **Behold alt, samme filter** (interne skjult, dag-grupperet, dansk-kun vist med diskret sprog-markør). |

## 4. Data-model (ny form)

Data flyttes ud af komponenten til et eget modul: **`frontend/src/data/patchNotes.js`** (adresserer også #521's bundle-bekymring og giver en fokuseret komponent). Envelope-strukturen `{version, date, label, changes[]}` bevares, så CI-grep'et `version:\s*["']…["']` stadig virker.

```js
// frontend/src/data/patchNotes.js
export const PATCHES = [
  {
    version: "5.75",            // bevaret: CI-ordering-nøgle + unikhed; vises evt. som tag ved expand
    date: "2026-06-20",         // ISO; UI grupperer på denne
    label: "Beta",
    changes: [
      {
        category: "improved",            // NORMALISERET enum: "new" | "improved" | "fixed"
        topic: "Getting started",        // valgfri: emnet efter "·" (til overskrift-afledning + visning)
        audience: "player",              // "player" | "internal"
        en: {                            // valgfri pr. sprog (legacy kan mangle en)
          title: "Plain-language tooltips for newcomers",
          body: "Hover the sidebar balance, Division, or Deadline Day to learn what each one means. The same tips appear on your team header."
        },
        da: {
          title: "Tooltips i klar tale til nye managere",
          body: "Hold musen over saldoen, Division eller Deadline Day for at lære hvad hver ting betyder. De samme tips findes på dit hold-header."
        },
        refs: [1593]                     // valgfri: issue-numre (parses fra "Refs #N" — til evt. fremtidig linkning)
      }
    ]
  },
  // … 470 mere
];
```

**Felt-regler**
- `category` ∈ `{new, improved, fixed}` (normaliseret — se §5). Det eneste der styrer farve/filter.
- `topic` = den rå del efter `·` (fx "Getting started", "Mobile"). Vises som lille sub-label og bruges til auto-afledte overskrifter.
- `audience` ∈ `{player, internal}`. Kun `player` renderes på siden.
- `en` / `da`: hver `{title, body}`. Mindst ét sprog skal findes. Mangler det aktive sprog → fallback til det andet med en diskret "(Dansk)/(English)"-markør.
- `version`, `date`, `label`: uændret semantik fra i dag.

## 5. Data-transform (engangs, 471 entries)

En **engangs-transform** producerer det nye data-modul fra det nuværende array. Output committes som almindelig data (ingen runtime-heuristik — testbart, reviewbart, stabilt). Transformen er det lange træk og køres som en Workflow (fan-out i batches med adversariel verifikation), fordi klassifikationen rører 150+ kategori-strenge + indholds-signaler.

**Pr. eksisterende `items`-streng:**
1. **Sprog-split.** Præfiks `"EN · "` → `en.body`; `"DA · "` → `da.body`. Et par `["EN · X","DA · X"]` bliver til ÉN `change` med begge sprog. Legacy enkeltstreng uden præfiks → `da.body` (langt de fleste er dansk; sprog detekteres, sjældne engelske → `en.body`).
2. **Kategori-normalisering** (top-level prefix før `·`) via mapping-tabel:
   - → **new**: New, Nyt, Added, Feature, Tilføjet
   - → **improved**: Improved, Forbedringer, Improvements, Changed, Updated, Update, UX, UI, Design, QoL, Quality, Copy, Tema, Localization, Language, Navigation, Display, Filtrering, …
   - → **fixed**: Fixed, Fixes, Fix, Fejlrettelser, Bugfix, Bug-bash, Robusthed, Stabilitet/Stability, …
   - Emne-kategorier (Auktioner, Økonomi, Riders, Transfers, Deadline Day, Board, Sæson, …) klassificeres på indhold (rettelse vs. ny vs. forbedring) og emnet flyttes til `topic`.
3. **Audience-klassifikation.** `internal` hvis kategori ∈ {Admin, Infra, Intern infrastruktur, Reliability, Security, Sikkerhed, Backend, Teknisk/Teknik, Tech debt, Drift, Observability/Observabilitet, Architecture, Kodekvalitet, Hardening, Verifikation, Data, Dokumentation, sprint-koder `S-0x`/`R2`} **eller** body matcher interne signaler (SQL-nøgleord, `scripts/`, `.sql`, `migration`, `RPC`, `RLS`, fil-stier, `service_role`, CI/workflow-navne). Ellers `player`. **Heuristik er første pas; en verifikations-fase (adversariel, fan-out) gennemgår grænsetilfælde** — en player-rettet note må aldrig fejlklassificeres som intern (tab af synligt indhold) og omvendt (lækage).
4. **Topic.** Delen efter `·` bevares som `topic` (trimmes; tom hvis ingen).
5. **Refs.** `"Refs #N"`/`"#N"` parses til `refs[]` og fjernes fra body-teksten (renere spiller-tekst).
6. **Title.**
   - **Seneste ~30 dage (date ≥ 2026-05-21):** håndskrevet skarp overskrift på begge sprog der findes (≤ ~6 ord, sætnings-case, menneske-sprog). Disse entries har typisk allerede EN+DA-body, så begge titler er mulige.
   - **Ældre:** auto-afledt — `topic` hvis meningsfuldt, ellers første klausul af body (til første `.`/`,` eller ~50 tegn), i kildesproget.

**Resultat-fordeling (forventet, verificeres under implementering):** ~471 versioner → en flad strøm af `change`-objekter; en betydelig andel `internal` (Admin/Infra/sprint-koder) skjules; resten dag-grupperes.

## 6. Komponent-arkitektur

Splittes i tre fokuserede enheder (erstatter den nuværende 7.797-linjers monolit):

| Fil | Ansvar | Test |
|---|---|---|
| `frontend/src/data/patchNotes.js` | Ren data (det transformerede `PATCHES`-array) | — |
| `frontend/src/utils/patchNotes.js` | Rene funktioner: `groupByDay()`, `filterChanges({lang, category, query})`, `pickLang(change, lang)`, `deriveTitle()`, `computeNewDays(lastSeen)` | **`node --test`** (obligatorisk) |
| `frontend/src/pages/PatchNotesPage.jsx` | Præsentation + state (søg, kategori-filter, udfoldede dage, last-seen) | Playwright-snapshot |

Evt. små sub-komponenter i samme fil eller `pages/patchNotes/`: `DayCard`, `CategoryGroup`, `ChangeRow`, `FilterChips` — holdes under komponent-størrelses-smerte­grænsen.

**Dataflow (runtime):**
1. Læs aktivt sprog: `const lang = i18n.language?.startsWith("da") ? "da" : "en"` (samme mønster som LandingPage/FounderSupporterPage).
2. `filterChanges` fjerner `audience === "internal"`, anvender kategori-filter + søge-query (matcher title+body+topic i aktivt sprog).
3. `groupByDay` samler alle `change`s på tværs af versioner med samme `date`, grupperet pr. `category`.
4. Render: nyeste dag udfoldet; ældre dage som klikbare rækker (dato + "N updates · topics"); uge-skillelinjer for ældre historik.
5. Hver `change`: overskrift (title) synlig + chevron; expand viser body. Mangler aktivt sprog → vis andet sprog + markør.

## 7. Features

- **Sprog-filter:** kun aktivt sprog. (Kerne i #1594.)
- **Audience-filter:** kun `player`. Diskret fod-note "Internal & technical notes are hidden".
- **Dag-gruppering:** ét kort/dag; nyeste udfoldet; ældre foldet; uge-skillelinjer.
- **Overskrift før klik:** title pr. ændring synlig i kollaps-tilstand.
- **Kategori-filter:** chips All / New / Improved / Fixed (farve-prikker: grøn/blå/rød — matcher nuværende `bg-green/blue/red`-konvention).
- **Søg:** fri-tekst over title+body+topic i aktivt sprog (client-side).
- **"Nyt siden sidst":** `localStorage` `cz_patchnotes_last_seen` (ISO-dato af nyeste sete). Dage nyere end last-seen får en diskret "New"-markør; last-seen opdateres til nyeste ved mount.

## 8. CI-gate (må ikke brækkes)

`scripts/check-patch-notes-version.js` parser `version:`-felter, kræver unikke + faldende versioner, og at top-versionen stiger + `docs/NOW.md` opdateres når patch-fil ændres.

**Ændring:** opdatér `PATCH_FILE`-konstanten fra `frontend/src/pages/PatchNotesPage.jsx` til `frontend/src/data/patchNotes.js` (hvor `version:`-felterne nu bor). Verificér at `.github/workflows/ci.yml` blot kalder scriptet (uafhængigt af stien). Envelope `{version, …}` bevarer alle 471 `version:`-felter unikke og faldende → gaten passerer uændret.

## 9. Tilgængelighed

Bevar/forbedr nuværende a11y: semantisk struktur, `aria-expanded` på dag-/ændrings-toggles, søgefelt med label, `lang`-attribut korrekt, ingen farve-only kategori-signal (kategori har også tekst-label). Sprog annonceres korrekt (jf. v5.68-arbejde).

## 10. Test & verifikation

- **`node --test` i `frontend/`** (obligatorisk pre-flight): `utils/patchNotes.js` — sprog-pick, audience-filter, dag-gruppering, søg, `computeNewDays`, title-afledning.
- **Playwright `core-smoke`** — refresh snapshots for ALLE 3 projekter (desktop-chromium + mobile-chromium + mobile-webkit), da det er en visuel ændring; commit PNG'erne.
- **Lokal verifikation af logget-ind UI** via Playwright-mocks (umasket engangs-screenshot) på begge sprog (EN + DA) — bekræft: kun aktivt sprog, ingen interne noter, dag-gruppering, søg/filter virker.
- Fuldt CI-gate-sæt før PR: build + warning-budget + i18n-keys + eslint + tone-em-dash + patch-notes-version-check.

## 11. Close-out-artefakter

- **Patch note** for selve redesignet (ny `player`-entry, EN+DA, ny top-version) + `docs/NOW.md` bump (CI-krav).
- **`help.json` (en+da)** — opdatér hvis FAQ refererer patch notes-siden; ellers skriv hvorfor ikke.
- **`FEATURE_STATUS.md`** — opdatér hvis kontrakt/feature-status ændres.
- **Issues:** kommentér/luk #1594; kommentér #253/#43/#413/#954 med hvad dette leverer; #978/#1600 forbliver åbne (ude af scope).

## 12. Risici

| Risiko | Afbødning |
|---|---|
| Fejlklassifikation (player→internal skjuler reelt indhold; internal→player lækker) | Adversariel verifikations-fase i transform; spot-check begge sprog i UI før PR. |
| CI-version-gate brækker når data flytter | Opdatér `PATCH_FILE`-konstant; verificér scriptet kører grønt lokalt før push. |
| Auto-afledte overskrifter bliver støjende på gammel historik | `topic`-først-regel; fallback til kort første-klausul; accepteret lavere bar på "Earlier"-historik. |
| Stor diff (transform af 471 entries) svær at reviewe | Data i eget modul; transform-script committes ved siden af så outputtet kan regenereres/auditeres. |
| Legacy dansk-kun i EN-mode | Vis dansk body + diskret "(Dansk)"-markør under "Earlier" — ærligt, intet tabt. |

## 13. Opfølgninger (separate issues, ikke nu)

- #954 Supabase-hub (hvis redigering-uden-deploy/voting nogensinde bliver et reelt smertepunkt).
- #978 flyt Patch Notes ind under "Hjælp & Regler".
- #1600 roadmap shipped-historik + admin-flade.
