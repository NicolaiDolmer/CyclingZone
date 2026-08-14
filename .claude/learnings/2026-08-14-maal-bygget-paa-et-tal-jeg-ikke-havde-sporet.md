# Jeg byggede to gates på tal jeg ikke havde sporet til deres kilde

**Dato:** 14. august 2026 · **Sag:** værdi- og løn-designet (#3449, #3393) · **Klasse:** falsk fundament

## Hvad skete der

Jeg designede på en formiddag et fundament for rytterværdier, og ejeren traf fire beslutninger på det. To af dem faldt samme dag, begge på det samme mønster.

**Gate 1** skulle måle om markedet var modent nok til at bestemme kroneniveauet: kontanter delt med samlet rytterværdi, målt til 35,8 %. Jeg skrev at det er et håndtag ejeren kan dreje bevidst ved at hæve præmiepenge.

To angreb, fra to uafhængige kilder, samme dag:

- En parallel session målte at nettoen pr. hold er 376k til 775k pr. sæson mod et målbånd på ±30k. Median holdsaldo er 733.410. Gaten ville altså gå grøn af **inflation** uden at markedet blev mere modent.
- Kritik-workflowet fandt det omvendte: nævneren er modellens eget output. Falder værdierne 50 %, går gaten fra 35,3 % til 70,6 % **uden en eneste ny krone**. Gaten går altså også grøn af den **deflation** den skulle forhindre.

Den peger begge veje og måler ingenting.

**Gate 2** skulle måle om den markedsdrevne model var blevet mere præcis end den simuleringsbaserede, som fejl mod salgspris. Mit eget oplåsnings-workflow fandt at en auktions startpris **defaulter til rytterens listede værdi**, som er den gamle models eget output. 149 af 228 auktioner siden 3/8 lukker på nøjagtig startprisen. Metrikken måler for to tredjedeles vedkommende hvor enige vi er med os selv.

## Mønstret

Begge gange tog jeg et tal der lå lige for, gav det en rolle i en beslutning, og undersøgte aldrig **hvor tallet kom fra**.

- 35,8 % så ud som en markedsegenskab. Det er et forhold mellem to tal som spillet selv producerer, og som begge kan flytte sig af grunde der intet har med markedet at gøre.
- "Fejl mod salgspris" så ud som en uafhængig facitliste. Salgsprisen er i 65 % af tilfældene en kopi af det tal man måler.

Ingen af de to fejl var svære at opdage. Begge kunne være fanget af ét spørgsmål: **hvad producerer det her tal, og kan det bevæge sig af en grund der ikke er den jeg tror det måler?**

## Hvorfor det er værd at skrive ned

Fordi designet lød rigtigt. Struktur-mod-niveau-opdelingen løser et ægte, målt problem, og den overlevede faktisk kritikken i sin diagnose. Det der faldt var **måleapparatet omkring den**, og det faldt fordi det var bygget på tal jeg havde behandlet som givne.

Et forkert fundament bærer langt når det lyder rigtigt. Det bar en hel formiddag, fire ejer-beslutninger og en spec.

## Regel fremadrettet

Når et tal får en rolle i en **gate**, altså i noget der afgør om et system må tage næste skridt:

1. **Spor tallet til sin producent.** Hvilken kode skriver det, og hvad er den kodes eget input? Stop først når du rammer noget uden for systemet, fx en spillerhandling.
2. **Spørg om nævneren og tælleren kan flytte sig sammen.** Et forhold hvor begge sider produceres af det samme system måler systemet, ikke virkeligheden.
3. **Spørg om facitlisten er uafhængig.** Måler du en model mod et facit, så find ud af om facittet er påvirket af den model du sammenligner med. Startprisen i en auktion er ikke en uafhængig observation, hvis den er sat af modellen.
4. **En gate skal kunne fejle af den rigtige grund.** Kan du ikke beskrive en tilstand hvor gaten er rød og systemet reelt er sundt, måler den sandsynligvis ikke det du tror.

Punkt 3 generaliserer: **en metrik der bruger systemets eget output som facit, måler enighed, ikke sandhed.**

## Bør i HOT memory?

Nej, WARM. Mønstret er specifikt for gates og kalibrerings-metrikker, og der er få af dem. Men det bør promoveres hvis det gentager sig, for prisen var høj: designet nåede fire ejer-beslutninger før fejlen blev fundet, og den blev kun fundet fordi ejeren eksplicit bad om adversariel kritik af mit eget arbejde.

## Den anden lære fra samme dag

Jeg committede to gange på den forkerte branch, fordi workflow-agenter efterlod hoved-checkoutet på deres PR-branch. Anden gang **printede jeg branchen lige før og committede alligevel**.

Reglen i `feedback_verify_branch_before_commit_shared_checkout` siger "guard i selve commit-kæden". Det er præcis pointen: et `git branch --show-current` der printer til skærmen er ikke en guard, for der er ingen der stopper. Guarden skal være i kæden:

```bash
B=$(git branch --show-current); [ "$B" = "main" ] || { echo "STOP: $B"; exit 1; }
```

Det var den der virkede tredje gang.
