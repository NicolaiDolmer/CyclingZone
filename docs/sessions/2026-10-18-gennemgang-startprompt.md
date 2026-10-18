# Startprompt · gennemgang af pc1-sessionen 17-18/10

Svar på dansk. Du er gennemgangs-sessionen. Den lange pc1-session 17-18/10 (samle-issue #6749) er slut. Den byggede og reviewede, men ejeren har ikke godkendt alt. Din opgave:

1. **Verificér, gæt ikke.** Læs `docs/NOW.md`, #6749 og kortene i `docs/sessions/kort-2026-10-17/`. Tjek PR- og issue-status i GitHub. Brug ikke dette dokument som facit.
2. **Gennemgå med ejeren, ét kort ad gangen**, med anbefaling. Merge kun på ejerens ordrette "merge N", og flip kun flag på "tænd".
3. **Afslut** derefter sessionens close-out (punkterne under "Ikke færdigt").

## Hændelse søndag 18/10 (læs først)
- **Hvad:** PostgREST gik i stå kl. 05:42 og kom tilbage kl. 08:20 dansk tid, ca. 2 t 40 min. Ca. 9 af 10 REST-kald gav 503 (eksempel: 9.643 fejl mod 319 vellykkede fra kl. 07). Auth og selve databasen virkede hele tiden.
- **Årsag:** sandsynligvis det kendte problem #6184, hvor PostgREST dræber 10-25 forespørgsler hvert 5. minut, indtil processen til sidst låste. Supabase meldte ingen hændelse.
- **Status efter:** verificeret 11:20. 0 Sentry-fejl den seneste time, 56 af 57 cron-jobs friske. `deadline-day` har stået stille siden 6/10, ikke pga. nedbruddet; tjek om det er forventet. Vuelta Ibérica er bundet til `s5_profiles_v1`, og 1. etape blev kørt kl. 11.
- **Åbent:**
  - Ingen alarm gik til ejeren, så der skal en alarm til: over 20 "upstream connect error" på 10 min → push + Discord.
  - #6184 rodårsag: mål de tungeste kald, flyt dem til direkte PG/RPC. Lav designet før koden.

## Færdigt i sessionen
- **Merget:** 31 PR'er og 45 issues done (målet var ≥30).
- **Lagt klar:**
  - Testport v1→v2, Fable-dommer: "TÆND-KLAR MED FORBEHOLD".
  - Tænd-pakken #6819 → #6820 (draft, ejer-gated).
- **Beta-sprog fr/es/nl:** sprogfilerne er merget, men skjult. Registeret ligger i #6837, frosset til efter 25/10. Bemærk frys-bruddet 00:19, beskrevet i `.claude/learnings/2026-10-17-pc1-worktree-og-verify-faelder.md`.
- **Designs (draft):** #6843 (jagtafstand i løbsfilmen), #6849 (inkrementelle ranglister), #6813 (kuperede udbrud).

## Venter på ejeren
| Kort | Hvad | Anbefaling |
|---|---|---|
| 1 | Frontend-frys: undtagelse? | se kortet |
| 2a-2d | Sæsonskiftet 25/10 | se kortet |
| 3 | UX-kort | se kortet |
| 4 | Lasttest: kræver `supabase login` på pc1 | ejeren logger ind |
| 5 | Dark mode #6792 | "5 go" |
| 6 | Kuperede udbrud | "6 B" |
| Tænd | `s5_profiles_v2` (#6819 → #6820 + help-tekst + patch note) | "tænd" pr. skridt |
| 7 | #6839 #6840 #6841 #6842 (tekniske, bølge 6) | "merge 7" |
| 8 | #6844 #6846 #6847 #6848 (tekniske, bølge 7) | "merge 8" |
| 9 | #6850: et gammelt løbsresultat tæller for rytterens nuværende hold | "9 A" |

**UI-PR'er, der venter på visuelt go:**
- #6680, #6643, #6763, #6770, #6792, #6808 (+#6826), #6809
- tjek frys-datoen før enhver merge, der rører `frontend/`

## Ikke færdigt (close-out)
- **Patch note:** godkend `docs/sessions/2026-10-17-patch-note-udkast.md` (EN+DA) og læg den i `PatchNotesPage.jsx` efter frysen.
- **Oprydning:** `close-out-cleanup.ps1 -Execute` (50 worktrees) **først efter #6846 er merget**. Det gamle script kan tømme hovedmappens `node_modules` via links.
- **Close-out-dokumenter:**
  - MASTERPLAN
  - FEATURE_REGISTRY + `node scripts/generate-feature-status.mjs`
  - NOW.md: nulstil "Working agent" og opdatér "Next action"
- **Opfølgnings-issues fra Codex-stopreglen:** #6845, #6851, #6838 (bundle-budget), #6828, #6836.
- **Ejerens søndagsopgaver:** `promotion_pending_enabled` på "tænd", webhook, roadbook/Discord 7.361-7.367, #6680. #6739: "spørg senere".
