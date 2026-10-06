# Prompt: Session A (Claude Code) - land motorpakken

> **Erstattet 6/10** af `2026-10-06-dagsplan.md` (Claude) og `2026-10-06-codex-dag.md` (Codex). Brug ikke denne som prompt.

Model: **Claude Fable 5.1**, indsats **høj**. Kopiér alt under stregen.

---

Ny session. Formål: **få motorpakken (orders_gc_v3) i mål, målt og klar til at blive tændt.** Ingen nye store designs ud over de tre punkter i trin 4. Sessionens formål er bindende: kommer der nye ønsker, skrives de til en prompt til næste session.

Arbejdsform (ejer 5/10): verdensklasse, god fart, token-effektivt. Undersøg før du spørger. Beslutninger som popup med nøgletal i spørgsmålet, højst 4 ad gangen, og ALT ejeren skal handle på eller kopiere, sendes som fil (SendUserFile) med svaret i billedteksten. Visuelt med ægte etapedata. Aldrig egne tidsskøn. Opdatér roadmappet (known_issues), MASTERPLAN og masterplan-artifacten i samme tur som hver beslutning. Sæt ikke nye laner i gang sent i sessionen uden at sige det. Start en ny session, før denne bliver stor.

**Læs først:** `docs/NOW.md`, `docs/MASTERPLAN.md`, og de seneste kommentarer på #6187 #5978 #6201 #6185 #6199 #3460 #6137 (alle har "Ejer-beslutning 5/10" med acceptkriterier). Billederne ejeren har set, ligger i `pr-screens/motor-5-10/`.

**1. Tjek først**
- Railway-deployet af `7d864d8bf` (#6213) blev SUCCESS 5/10 kl. 18:03 efter 32 min byg; seneste Deploy verify er grøn. Bekræft at main er grøn, før du merger.
- Bølgen fra 5/10 er færdig og ryddet op (markøren er væk). Alle seks spor har åbne, ikke-draft PR'er. Kør `pwsh -File scripts/close-out-cleanup.ps1` (dry-run) for efterladte processer.
- Masterplan-artifacten (https://claude.ai/artifact/UoZexVskbfA5xmvTnML4Bn) mangler beslutningerne fra 5/10 efter kl. 17: tidsmodellens mål, merge af #6187 og de nye PR'er. Opdatér den som noget af det første.
- `gh workflow` "Supabase Log Watch" og "Advisor sweep": første kørsel med det nye token (ejer satte `SUPABASE_ACCESS_TOKEN` 5/10). Grøn?

**2. Land PR'erne (uafhængigt review på diffen før hvert go-kort)**
| PR | Hvad | Status 5/10 aften |
|---|---|---|
| #6217 | #6137 løbsfilm samler ens linjer | **Ejer-go givet 5/10** (merge ved grøn CI). Synket med main og typefejl rettet (`e81ab78a3`). 5/10 kl. 19:20: én af to `perf-gate`-kørsler rød, den anden grøn; undersøg, før du merger |
| #6216 | #6185 del 1, mærket "Sat af" (rød pil ned, tryk viser tekst) + backfill-script + migration | **Ejer-go givet 5/10** på det nye billede, men **uafhængigt review 5/10 er BLOKERENDE** (se seneste kommentar på PR'en): (1) en rytter, der kommer tilbage i udbruddet, bliver stående som "sat af"; (2) e2e er rød, fordi `title` blev fjernet. Ret begge + bemærkningerne, nyt review, derefter merge. Backfill: dry-run først, ejeren ser tallene og vælger startdato (28/9 eller 2/10) |
| #6225 | #3460 Spar kræfter halv støtte | Klar, 3 filer. Mangler uafhængigt review og ejer-go |
| #6223 | #6199 + #6200 tidsmodel | Klar fra lanen. Mangler uafhængigt review, scorecard-dom og ejer-go |
| #6224 | #5978 farlig rytter + de fire review-bemærkninger fra #6213 | Klar fra lanen. Mangler uafhængigt review og ejer-go |

Merge-rækkefølge for de tre, der deler `tuning.ts`, `segmentLoop.ts` og RULES: **#6225 → #6223 → #6224** (bølgens egen anbefaling). Lanernes fulde rapporter: `journal.jsonl` under workflow-kørslen `wf_204e6c67-e6b` (se bølgens resultat i forrige session), ellers PR-bodies.

Derefter i samme bølge-rytme: **#6201** (bjerg typisk 6-12/loft 16, kuperet og rullende 5-9/loft 12, AI sender klatrer, farten følger antallet; bygges efter #5978, samme filer) og **#6185 del 2** (motoren udsender selv "sat af fra udbruddet").

Alt motor ligger bag `orders_gc_v3`. `CURRENT_RACE_RULES_REVISION` må ikke ændres uden ejerens ordrette go. PR'er med migration kræver ejer-go i merge-køen.

**3. Mål hele pakken samlet**
Kør `node backend/scripts/v4FlipReadiness.mjs` bag `verify-lock` under v3 og hold det op mod udgangspunktet fra 5/10 (`balance-internals/5515-v4-flip-klar/2026-10-05-v4-scorecard-baseline-tal.md`, privat) og ejerens mål: bjerg nr. 10 = 60-150 s · kort afslutning opad nr. 10 ≤ 20 s, nr. 30 ≤ 90 s, nr. 50 ≤ 300 s · nedkørsel højst ca. 1,5 s/km og halvdelen af hullet · udbrudsstørrelser pr. profil. Tal må kun stå i `balance-internals/` (hard rule 17); offentligt kun PASS/FAIL.

**4. De sidste designpunkter (med ejeren, ét ad gangen, visuelt)**
1. v4-grænser + scorecard-bånd (#2557, #5515): hvilke bånd gælder for v4, tal for tal.
2. "Arbejd" og loftet på støtte (loftet nås i dag med 2 hjælpere; se `pr-screens/motor-5-10/p5.png`).
3. Hjælpetekster og ordre-kolonne (#6186, #5059).

**5. Tænd-tjekliste for v3 (ét issue)**
Samlet hjælpetekst (EN + DA) og patch note for hele pakken, scorecard-dom, ejerens go, migration allerede lagt på. Først derefter foreslås flippet.

**6. Derefter:** form og formtoppe (#6156, embargo på roadmappet).

**Kvalitets-issues oprettet 5/10** (tag dem, hvis en lane er ledig; ellers Codex): se NOW.md.
