# 5/10-2026 aften: merge-sessionen fandt fejl, der burde være fundet før, og GitHub gik ned

Merge-session for de ni PR'er fra 5/10 (#6217 #6215 #6218 #6225 #6223 #6224 #6216 #6220 #6222). Tre blev merget på ca. fire timer; resten stod klar med ejer-go eller i sidste rettelsesrunde, da sessionen lukkede.

## Hvad gik galt
1. **5 af 9 PR'er havde blokerende fejl, som først blev fundet i merge-sessionen.** #6215: sponsorsatsen stod som "pr. løbsdag", men betales pr. etape. #6216: etapevindere fik "Sat af" (30 ryttere på 17 prod-etaper), fundet i ANDET review efter første rettelsesrunde. #6223: loftet på nedkørsel mod mål dækkede to af fire mekanismer, og en ny regel havde ingen test. #6224: et let_go-hold slap snoren mod kontrakten. #6220: en ny tabel i en ændret fil slap uden om vagten. Lanerne havde meldt "klar" med grøn CI; ingen af dem havde et uafhængigt review på diffen.
2. **Rettelser kørte én ad gangen** (sessionens regel 7), mens reviews kørte fire ad gangen. Rettelseskøen blev flaskehalsen; ejeren løsnede reglen til to ad gangen kl. 22:55.
3. **GitHub Actions gik ned ca. kl. 21:20** (statussiden: degraded 21:50, major outage 22:50). Merge-køen for #6225 ventede 90 min på mains CI og blev dræbt af sin timeout. Jeg opdagede årsagen først efter ca. 40 min, fordi "kø" lignede almindelig runner-trængsel.
4. **`gh pr checks --watch` afslutter med det samme**, hvis tjekkene endnu ikke er registreret på den nye commit. En baggrunds-vent meldte "færdig" med 15 tjek i kø.
5. **Et `cd` ind i Codex' worktree i en Bash-kommando flyttede hele sessionens arbejdsmappe.** Opdaget på miljø-beskeden, rettet i næste kald.
6. **En heredoc i Bash ødelagde et script** (backslashes i en regex). Reglen "aldrig heredoc" gælder også små hjælpescripts.
7. **Secret-vagten slog ud på en CodeRabbit-kommentar** (`scope=`-parameter i et offentligt link), da jeg hentede alle PR-kommentarer råt.
8. **Review-rapporter indeholdt private balance-tal** (scorecard). De blev fjernet, før reviewet blev lagt på GitHub (hard rule 17), men det krævede, at orkestratoren læste hver rapport igennem for det.

## Regler
- **En PR er først "klar til merge-session", når den har et uafhængigt review på diffen UDEN blokerende fund.** Byggesessionen ejer review + rettelse; merge-sessionen ejer go og merge. Ellers bliver merge-sessionen en byggesession med dårligere overblik.
- **Efter en rettelsesrunde, der ændrer adfærd, kommer et nyt review af rettelsesdiffen.** #6216's første rettelse indførte ikke fejlen, men gjorde den synlig; andet review fandt den på prod-data. Bed revieweren køre PR'ens egen logik på rigtige prod-rækker (read-only), ikke kun på fixtures.
- **Rettelser må køre to ad gangen i hver sit worktree** (ejer 5/10), stadig bag `verify-lock -Max 2`.
- **Står CI-kørsler i kø i over 10 min med 0 i gang, så tjek `githubstatus.com/api/v2/summary.json` først.** Ved nedbrud: fortsæt alt lokalt, saml ejerens go betinget af grøn CI, og skriv en merge-prompt til næste session i stedet for at holde sessionen åben.
- **Vent på CI med en løkke på `statusCheckRollup` (antal ikke-færdige = 0), ikke med `gh pr checks --watch`.**
- **Aldrig `cd` til et andet worktree; brug `git -C` og absolutte stier.**
- **Hent PR-/issue-kommentarer med filter på author** (`select(.author.login=="NicolaiDolmer")`); bot-kommentarer giver falske secret-alarmer og støj.
- **Review-prompter skal sige: private tal kun i rapporten til orkestratoren, aldrig i tekst der ender på GitHub.**
- **Go-kort for motor-PR'er bag en slukket revision skal vise både det, PR'en rammer, og det, den ikke rammer** (#6223: replay-ankrene grønne, scorecardets bjergmål længere fra målet). Ejeren godkendte med det på bordet.

Refs #6157 #6216 #6223 #6224 #6215 #6220 #6222 #6226
