# Startprompt: Claude Code, tirsdag 20/10 (DolmerPC)

Kør `git pull --ff-only` i `C:\Dev\CyclingZone`, læs `docs/NOW.md`, `docs/MASTERPLAN.md` og denne fil. Svar på dansk. Claude planlægger med ejeren, reviewer og merger; Codex bygger (højst 4 sessioner). **Alt ejeren skal kopiere (Codex-prompter) står i Claudes SIDSTE besked**, med sessionens navn over. Merges: én ad gangen med link, hvad den gør og status; kun ordret "merge #N" er go; UI kræver visuelt go-kort. **Ingen deploy-frys** (ejer 19/10). **Færdigt før nyt.** Spørgsmål stilles ét ad gangen med muligheder og anbefaling.

## Leveret 19/10 (merget og verificeret)
#6906 gældsmål · #6902 formtop-flag (`race_form_peaks` off) · #6819 v2 lovlig (0 løb på v2) · #6911 menu · #6899 ranglister M1 (flag off, 1 rebuild-markør) · #6907 løbsidentitet L1 (3 tomme kolonner) · #6900 vagt før skiftet · #6910 omdømme · design #6813 #6843 #6849 · patch note 7.370 (#6921, se status). Testport v2 vs v1 kørt (110 S4-løb, privat i `balance-internals/6818/2026-10-19/`).

## Ejer-beslutninger 19/10 (låst, står på issues)
- **v2-udbrudspakken #6804** (6 valg): 3 bånd (GT/korte/endagsløb), kuperet+spurt nogle gange, realistisk forspring (#6912), hvem der er med (favoritter sjældent, hold-andel efter udbrudsstørrelse, ingen ulogiske 1.-etapeudbrud), ingen ren lodtrækning (alt forklarbart i løbsfilmen), størrelse med nu. **Design først** (trin 1), så byg.
- **Jagtafstand #6814** med i v2 efter #6804. **#6820 tændes samlet**, når #6804 + #6814 + testport på S5-ruter (#6909) er grønne.
- **#6683** (ikoner + Kalender | Tabel) næste plads efter A-listen; `race_library_v2` tændes for beta sammen med den.
- Verdensklasse-køreplan `docs/superpowers/specs/2026-10-19-world-class-roadmap.md`: fundament #6917 (backend **A**: Express 5 + opdeling + Zod + job-worker) ∥ motor #6914 → mobil #6916 · desktop #6918 · palet #6915 → vækst #6919.

## I dag (rækkefølge)
1. **Tidspunkt for skiftet 25/10** (#6898): A afregn-nu-knap / B ca. 20:30 / C flyt sidste etape. Spørg ejeren først.
2. **Codex-pladser** (ejerens rækkefølge, prompter i `docs/sessions/2026-10-19-6857-codex-prompts.md`): #6909 testport S5 · #6804 trin 1 (design + baseline) · L2 · L3. #6839 ("Kør nu") er i gang hos Codex; review den (motor-risk, kræver Claude-markør).
3. **Beslutningskort** for #6804 trin 1, når Codex leverer.
4. **Første løbsfilm-gennemgang** (#6914 pkt. 3): 3 tilfældige etaper side om side med rigtige løb.
5. **Gennemtest beta-ting** (stage_page_v2, training_bulk_day, push_enabled, race_library_v2) med skærmbilleder; tænding på ejer-go.
6. **Roadmap på siden**: forslag til nye/ændrede punkter står i 19/10-sessionens sidste besked; ejeren godkender teksterne, derefter skrives de til `roadmap_items`.

## Datoer
21/10 prøvekørsel af nye ruter (med motortest) · 22/10 S5-opslag · 23/10 Udvikling 2.0-prøvekørsel · 25/10 skiftet (formtoppe on) · 28/10 S5 starter.
