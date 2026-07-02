# 2026-07-02 — e2e-specs uden CI-gate rådner stille ved redesigns

## Hvad skete

Fuld `test:e2e:update`-kørsel 2/7 afslørede at `race-physiology-preview.spec.js`
fejlede på ALLE 3 Playwright-projekter. Rod-årsag: rytterprofil-redesignet
(#2000, PR #2037, merget samme dag) fjernede bevidst "Effektprofil"-sektionen
fra default-visningen og flyttede fysiologien til en dedikeret fane — men
spec'en, der assertede på den gamle struktur, blev ikke opdateret i samme PR.
Fejlen blokerede ingenting, fordi CI's obligatoriske gate kun kører
`core-smoke.spec.js`; resten af e2e-suiten kører kun når nogen manuelt starter
en fuld kørsel.

`sponsor-ui.spec.js` blev rapporteret fejlende i samme kørsel, men kunne ikke
reproduceres (15/15 grønne: isoleret, `--update-snapshots`, `--repeat-each=3`,
fuld suite; stale server/build på port 4173 udelukket via dist-mtime) —
transient, ingen ændring. Fix: PR #2114.

## Læring

1. **Redesign-PR'er skal greppe e2e-suiten for berørte flader.** En PR der
   fjerner/omdøber en sektion, i18n-key eller komponent bør greppe
   `tests/e2e/*.spec.js` for de strenge/selectors den fjerner (her ville
   `grep -r "Effektprofil" tests/` have fanget det før merge).
2. **Ikke-gated tests er rådne-kandidater, ikke sikkerhedsnet.** Når kun
   core-smoke gater CI, er "alle tests grønne" i en PR-beskrivelse kun sand
   for gaten. Fuld e2e-kørsel efter store UI-redesigns bør være en eksplicit
   del af slice-close-out.
3. **Ved "X fejler" fra en fuld kørsel: reproducér FØR fix.** Sponsor-fejlen
   viste sig at være transient — at "fixe" den ville have været
   symptom-patching. Reproduktions-matrixen (isoleret → update-mode →
   repeat → fuld suite) + miljø-tjek (port/dist-mtime) afgjorde spec-rot vs.
   flake på evidens.
