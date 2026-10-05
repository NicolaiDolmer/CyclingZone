# Prompt: Session A (Claude Code) - land motorpakken

Model: **Claude Fable 5.1**, indsats **høj**. Kopiér alt under stregen.

---

Ny session. Formål: **få motorpakken (orders_gc_v3) i mål, målt og klar til at blive tændt.** Ingen nye store designs ud over de tre punkter i trin 4. Sessionens formål er bindende: kommer der nye ønsker, skrives de til en prompt til næste session.

Arbejdsform (ejer 5/10): verdensklasse, god fart, token-effektivt. Undersøg før du spørger. Beslutninger som popup med nøgletal i spørgsmålet, højst 4 ad gangen, og ALT ejeren skal handle på eller kopiere, sendes som fil (SendUserFile) med svaret i billedteksten. Visuelt med ægte etapedata. Aldrig egne tidsskøn. Opdatér roadmappet (known_issues), MASTERPLAN og masterplan-artifacten i samme tur som hver beslutning. Sæt ikke nye laner i gang sent i sessionen uden at sige det. Start en ny session, før denne bliver stor.

**Læs først:** `docs/NOW.md`, `docs/MASTERPLAN.md`, og de seneste kommentarer på #6187 #5978 #6201 #6185 #6199 #3460 #6137 (alle har "Ejer-beslutning 5/10" med acceptkriterier). Billederne ejeren har set, ligger i `pr-screens/motor-5-10/`.

**1. Tjek først**
- Railway-deployet af `7d864d8bf` (#6213): stod på BUILDING i over 30 min 5/10 kl. 18, og "Deploy verify" blev rød på timeout to gange. Bekræft at deployet er SUCCESS, og genkør Deploy verify (`gh run rerun 37333454860 --failed`). Merge intet, før main er grøn.
- Bølgen fra forrige session (`node scripts/wave-policy.mjs inspect`): er den færdig og ryddet op? Kører den stadig i den gamle session, så vent på den; start ikke en ny bølge oven i.
- `gh workflow` "Supabase Log Watch" og "Advisor sweep": første kørsel med det nye token (ejer satte `SUPABASE_ACCESS_TOKEN` 5/10). Grøn?

**2. Land PR'erne (uafhængigt review på diffen før hvert go-kort)**
| PR | Hvad | Status 5/10 aften |
|---|---|---|
| #6217 | #6137 løbsfilm samler ens linjer | Klar. **Ejer-go givet 5/10 på før/efter-billedet:** merge, når CI + diff-tjek + CodeRabbit er grønne |
| #6216 | #6185 del 1, mærket "Sat af" + backfill-script | Klar. Kræver ejer-go på før/efter-billede; backfill køres efter merge, når ejeren har set dry-run-tallene |
| #6223 | #6199 + #6200 tidsmodel | I lane 5/10 |
| #6224 | #5978 farlig rytter + de fire review-bemærkninger fra #6213 | I lane 5/10 |
| (ny) | #3460 Spar kræfter halv støtte | I lane 5/10 |

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
