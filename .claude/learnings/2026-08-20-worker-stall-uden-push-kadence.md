# Worker doede stille efter 2+ timer uden commit - fremdrift var usynlig

**Dato:** 2026-08-20 · **Kontekst:** #4011/#4018 fix-runden (design-sessionen)

## Hvad skete

En genoptaget baggrunds-worker fik 6 revisionsfund at fixe paa PR #4018. Den
skrev 464 linjer paa tvaers af 12 filer (alle fund adresseret, tests udvidet
7->13) - men committede ALDRIG undervejs. Saa doede den stille (formentlig i et
fastfrosset vaerktoejskald; ingen efterladte processer). I 2,5 time saa
orkestrator og ejer kun "koerer stadig" uden et eneste livstegn paa PR'en.

Sekundaer fejl: orkestratoren aflæste worktree'ets fil-mtimes MOD ET GAET paa
klokkeslaettet i stedet for at printe `date` foerst - og meldte derfor "aktivt
arbejde" mens agenten reelt havde vaeret doed i to timer.

## Rod-aarsager

1. Spawn-prompten stillede INTET krav om commit-/push-kadence eller heartbeat.
   En worker der ikke skal pushe undervejs er usynlig indtil den er faerdig -
   eller doed.
2. Orkestratoren havde ingen tavsheds-graense (max tid uden livstegn foer
   indgriben) og verificerede tid uden tidsreference.

## Forward-guards (bindende for fremtidige spawns)

1. **Enhver implementerings-worker-prompt SKAL indeholde:** "Commit efter hvert
   afsluttet delfix og push mindst hvert 30. minut - ufaerdigt arbejde pushes
   som WIP. Synlig fremdrift paa branchen er en del af opgaven."
2. **Orkestrator-regel:** ingen livstegn (push/rapport) i 45 min -> SendMessage
   med status-krav; ingen reaktion i yderligere 15 min -> TaskStop, overtag
   worktree'et (arbejdet ligger der), verificér og push selv.
3. **Tidstjek:** enhver mtime-/varigheds-vurdering starter med `date`.

Recovery-moenstret der virkede: TaskStop -> inspicér worktree read-only ->
koer targeted tests paa WIP (13/13 + 2196/2196 groenne) -> preflight -> commit
+ push fra worktree'et. Arbejdet gik IKKE tabt.
