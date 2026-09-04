# 2026-09-04 · Seks workers over 1 time, to uden en eneste push; orkestratoren reagerede for sent

## Hvad skete
Efter morgenens prod-udfald startede orkestratoren 11 workers på én formiddag (maks-reglen er 3
tunge spor). Fem passerede 1 time. Da ejeren spurgte, viste målingen: #4760-workeren (opus,
review-rettelser) havde efter 70 min ingen commit og et rent worktree; #4582-workeren havde 7
ændrede filer men ingen commit; #3426 (måling) svarede ikke på statuskrav. Ejer: "Så meget
tålmodighed har jeg slet ikke. Du skulle have reageret markant før."

## Hvorfor
1. Prompterne krævede fuld verifikation (fuld e2e på 3 projekter, verify-local, preview i
   browser) også for små rettelser. Én e2e-kørsel er 12 min; workers kørte dem flere gange.
2. Orkestratoren målte ikke fremdrift på branchen (sidste commit/push), kun "er agenten i live".
3. Statuskrav kom efter 45 min og frist +15 min. Det er for langsomt når ejeren venter.
4. For mange parallelle spor → orkestratoren mistede overblikket over hvem der var stille.

## Regel fremover
- Maks 3 tunge workers samtidig. Analyse/måling: sonnet, targeted verify, 20-min budget i prompten.
- Prompten skal indeholde: **push senest efter 15 min**, hvilke tests (præcist), og "ingen fuld suite".
- Orkestratoren måler fremdrift hvert 20. min på **remote-branchens sidste commit**, ikke på om
  agenten kører. Ingen push efter 30 min → stop + overtag med ny stramt scoped worker (worktreet
  bevarer arbejdet).
- Fuld e2e og preview-browser-test er orkestratorens slot, ÉN gang før merge-bølgen.

Refs #4760 #4582 #3426
