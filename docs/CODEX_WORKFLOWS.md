# Codex: resultatansvar og leverancepilot

Ejer-godkendt 29/9/2026 i Codex: afprøv anbefalingerne om mere leveret arbejde med mindre ejerstyring. [Beslutning og pilot-ledger: #605](https://github.com/NicolaiDolmer/CyclingZone/issues/605#issuecomment-5884484536). Erstatter den udfasede Codex-rolle fra juni, ikke projektets sikkerheds- eller produktmandater.

**SSOT:** [AGENTS.md](../AGENTS.md) ejer mandat og hard rules; [AGENT_ARCHITECTURE.md](AGENT_ARCHITECTURE.md) ejer roller/claims; [PARALLEL_WORKTREE_ORCHESTRATION.md](PARALLEL_WORKTREE_ORCHESTRATION.md) ejer bølger/isolation; [AI_OPS_REFERENCE.md](AI_OPS_REFERENCE.md#pr-preflight-og-verifikations-tiers) ejer test-tiers; [GITHUB_WORKFLOW.md](GITHUB_WORKFLOW.md) ejer issue-lukning. Denne fil ejer Codex-leveranceforløbet og pilotmålingen. Refs #5467 #1341.

## Arbejdskontrakt

Ejeren giver et mål eller issue. Hovedsessionen udleder følgende fra issue + seneste beslutninger og bekræfter kun reelle huller:

- Resultat: hvad skal være anderledes, og hvilket konkret bevis viser det?
- Scope: issue(s), prioritet, låste produktvalg, relevante SSOT'er og afhængigheder.
- Mandat: hvad må gennemføres nu, og hvilke design-, merge- eller prod-gates mangler?
- Verifikation: gældende test-tier, review, eventuelt før/efter-billeder og deploykontrol.
- Afslutning: leveret og verificeret, eller dokumenteret blokering med konkret næste handling.

Opstart følger AGENTS.md og verificerer root, GitHub-status, arbejdsejerskab og isolation. Ejeren skal ikke indsætte en opstartsprocedure. Et issue-nummer eller en kort resultatbeskrivelse er nok; agenten fremskaffer konteksten. Hook-konfiguration er ikke bevis på, at en hook faktisk kører.

## Beslutningsgrænser

| Situation | Agentens handling |
|---|---|
| Ukendt teknisk detalje | Læs relevant kode/SSOT; afprøv med sikre lokale fixtures eller read-only data. Dokumentér antagelser og resultat. |
| Reversibelt teknisk valg inden for godkendt scope | Vælg selv og verificér; spørg ikke ud fra en selvvurderet sikkerhedsprocent. |
| Produktvalg, balance eller ændret prioritet/scope | Fremskaf bevis og forelæg ét beslutningskort med anbefaling og konsekvens før afhængigt arbejde. |
| Godkendelse findes allerede og dækker handlingen | Referér den og fortsæt. Genåbn ikke låste beslutninger. |
| Manglende rettighed, prod-mandat eller destruktiv handling | Brug den krævede godkendelsesvej. Reversibilitet alene giver aldrig prod-adgang eller lov til at omgå en guard. |
| Gentagne fejl | Undersøg årsagen; gældende loop-guard (to CI-fejl med samme symptom) og recovery-regler består. |

## Hovedsessionen ejer afslutningen

Forløbet er: undersøg → implementér → verificér → uafhængigt review → ret fund/CI → godkendelsesklar → merge efter mandat → deploy/main-kontrol → dokumenteret close-out.

- Ét issue pr. worker og eksplicit filansvar. Hovedsessionen kan følge en allerede godkendt kø; nye issues ændrer ikke automatisk scope/prioritet. Brug eksisterende runtime-indgang til bølger, maks 4 laner og 2 tunge verifikationer.
- En worker med `ready` eller en draft-PR er en overdragelse til hovedsessionen, ikke en færdig leverance. Hovedsessionen følger CI, reviewrettelser og næste tilladte handling uden et nyt generelt go.
- Merge følger AGENTS.md regel 35 og merge-køen. Worker/runner merger aldrig selv. Et afvist klassifikatormandat eller en guard omgås ikke. UI, spillertekst, spillervendte tal, migrationer, flag-flips og prod-skrivninger beholder deres ejer-gates.
- Efter tilladt merge kræves observeret production READY for den relevante commit samt required og bløde checks på main, jf. regel 20/23. Et grønt PR-check eller udløbet ventetid er ikke deploybevis.
- Close-out opdaterer det eksisterende issue og relevante docs. Issue-lukning følger den eksisterende state-maskine; en del-leverance lukker ikke #605 eller andre brede issues.
- Ved manglende beslutning afleveres den færdige beslutningspakke. Uafhængigt autoriseret arbejde kan fortsætte. Ventetid eller tavshed er aldrig godkendelse.
- En commit eller et delresultat kræver ikke en ny chat. Ved et nødvendigt handoff gemmes mål, låste beslutninger, SHA/PR, bevis og næste handling på GitHub. Goals kan fastholde længere forløb, men aktiveres kun på eksplicit anmodning og erstatter ikke delt handoff.

## Beslutningspakken

Ejeren modtager problem og løsning, den præcise beslutning, alternativer/anbefaling, relevante før/efter-beviser, test- og reviewstatus og material risiko/rollback. UI følger de eksisterende billedkrav; følsomme billeder og balance-tal holdes uden for offentlige issues. Agenten samler pakken og fortsætter efter svaret inden for mandatet.

## Skills og kontekst

Læs kun skills, der løser et konkret behov i opgaven. Skill-katalogets tilstedeværelse eller en bred nøgleords-trigger er ikke i sig selv relevans. Projektets og ejerens eksplicitte instruktioner har forrang over skill-proces.

Ved allerede godkendt scope genbruges design og tilladelser; en skill må ikke indføre en ny generel godkendelsesrunde for samme beslutning. Ny spilleradfærd kræver fortsat design/testplan, og arkitekturændringer kræver en passende plan. En enkel docs-ændring kan beskrives og verificeres i PR'en. Uafhængigt review og krævede tests bevares.

Genbrug eksisterende scripts og guards. Ingen ny scheduler, automatisk plugin-afinstallation eller generelle kontoændringer indgår i piloten. Skills vurderes under de rigtige opgaver: relevant brug, ekstra læsning, overflødige godkendelser og fejl. Reducér konkret overlap; mål effekten før yderligere ændringer.

## Sammenhængende arbejde (ejer-go 7/10, #605)

Én hovedsession ejer et claim til verificeret afslutning eller en konkret beslutningspakke. En anden runtime kan levere uafhængigt review; ejerskabet flyttes ikke alene fordi en PR er klar. Konkrete ejerbeslutninger forelægges direkte med bevis og gemmes på issuet, jf. [OPERATING_PLAN §Codex](OPERATING_PLAN.md#codex-dag). Afvent kun det afhængige arbejde; fortsæt øvrige allerede godkendte opgaver uden omprioritering.

Vælg parallelitet eksplicit: del kun uafhængige spørgsmål eller filansvar. Undersøgelser kan bruge read-only subagenter efter dispatch-forfilter; byggearbejde bruger `codex-wave.mjs`. Hovedsessionen samler korte beviser, følger alle agenter til observeret terminaltilstand og bevarer fælles loft 4/verify 2. En aktiv bølgelås er aldrig ledig kapacitet. Hold aktive sessioners filer, processer, modeller og claims urørte.

**Model-forsøg på nye spor:** almindeligt byg: `gpt-6.1-sol`/`medium`; svær årsagsanalyse/review: `gpt-6-astra`/`high`; let afgrænset læsning: `gpt-6-luna`/`medium`. Vælg kun tilgængelige modeller og angiv valget i planen. Runneren ændrer ingen globale defaults; en eksisterende plan arver fortsat CLI-konfigurationen. Fast/Ultrafast og ændrede forbrugsrammer kræver særskilt ejer-go. Bedøm forsøg på leveringstid, ejertid, forbrug og genarbejde i den eksisterende pilot; ingen gevinst er målt endnu.

**Brug appens eksisterende muligheder efter konkret bestilling:**

- **Goal:** "Opret et Goal: lever de godkendte issues [numre] med reproduktion, krævede tests, uafhængigt review og afslutning efter eksisterende mandat. Fortsæt øvrigt godkendt arbejde ved en lokal blokering; rapportér beslutning, bevis og næste handling." Et Goal kræver eksplicit anmodning; en almindelig opgave aktiverer det ikke automatisk.
- **Opfølgning i samme chat:** "Følg PR [nummer] hvert 30. minut, håndtér rettelser inden for scope, og giv kun besked ved væsentlig ændring, fejl, nødvendig beslutning eller afslutning. Stop opfølgningen ved afslutning." Brug appens eksisterende thread-automation; én ejer pr. PR, kontrollér eksisterende automation først. Ingen ny scheduler. Lokale kørsler kræver tændt computer/app. Fast tidsplan kræver konkret bestilling; en Goal er ikke en tidsplan.
- **Spillerproblem til bevis:** "Undersøg denne klage: sammenhold tilgængelige data med kode, reproducer lokalt, og aflever bevis og rettelsesforslag." Read-only data indtil andet mandat; privatdata og balance-tal forbliver private. Ny spilleradfærd kræver fortsat design-go.
- **Visuel beslutning:** "Vis alternativer som lokal prototype eller simulation før build-go." Mockup-data markeres; eksisterende UI-/spillertekstmandat og krav om rigtige releasebilleder består.

Officielle produktkilder kontrolleret 7/10: [Goals](https://developers.openai.com/cookbook/examples/codex/using_goals_in_codex), [subagenter](https://learn.chatgpt.com/docs/agent-configuration/subagents), [opfølgning](https://learn.chatgpt.com/docs/automations?surface=app), [hastighed/forbrug](https://learn.chatgpt.com/docs/agent-configuration/speed). Genkontrollér tilgængelighed ved brug. Delt projekt-state forbliver på GitHub; appens trådtilstand erstatter ikke handoff.

## Pilot: næste fem egnede, godkendte opgaver

**Status ved oprettelse:** protokol klar, 0/5 pilotopgaver registreret; ingen produktivitetsgevinst målt. Denne docs-leverance er forberedelse og tæller ikke som en produktpilot.

Hovedsessionen registrerer de næste fem reelle opgaver, der allerede har prioritet og nødvendigt build-go, i eksisterende rækkefølge fra NOW/masterplan og seneste ejerbeslutninger. Før hver opgave kontrolleres issue-state, ejerskab og merged PR'er. Manglende produktvalg afklares; opgaven tæller ikke som en succes, fordi den er sprunget over. Ingen nye produktopgaver eller omprioritering følger af denne protokol.

Før første opgave vælges fem tidligere, nogenlunde sammenlignelige forløb som baseline og linkes i #605 (scope, risiko og test-tier). Historiske tal må kun bruges med evidens. Ejerens tid oplyses af ejeren, eventuelt som markeret estimat; ukendt er aldrig nul. Kan den ikke rekonstrueres, bruges fremadrettede, godkendte sammenligningsopgaver, og konklusionen afventer dem. Foregiv ikke en før/efter-måling fra PR-timestamps alene.

Registrér ved start og afslutning én kompakt blok på opgavens issue og link den i #605:

```text
Pilot-ID / baseline-match / issue / PR / scope-risiko / test-tier:
Runtime / model-effort / sekventiel eller parallel / samtidighed:
Start UTC / reviewklar UTC / leveret-verificeret UTC:
Ejerens aktive minutter (målt, estimat eller ukendt):
Ejerindgreb (antal; produktvalg, adgang, instruktion, recovery):
Kø-, CI-, review- og godkendelsesventetid (observeret eller ukendt):
Reviewrettelser / CI-omkørsler / recovery / fejl efter levering:
Agentforbrug inkl. workers/review/recovery (kilde; ellers ukendt):
Test-, review-, deploybevis / resterende gate / næste handling:
```

Agenten samler maskinmål; ejeren behøver kun oplyse aktiv tid samlet ved et naturligt afslutningspunkt. Kontoens forbrugsprocent er ikke opgavens tokenforbrug. Manglende målinger registreres eksplicit. Offentlige blokke må ikke indeholde hemmeligheder, rå private logs eller balance-tal.

**Godkendt forsøgsambition:** mindst 30 % færre aktive ejerminutter pr. accepteret, sammenlignelig leverance. Beregn gennemsnit pr. leverance for baseline og pilot og relativ reduktion; vis også enkeltopgaver og median, så én stor opgave ikke skjuler forskelle. Ved ukendt tid, nul-baseline eller utilstrækkeligt match er effekten uafklaret. Gennemløbstid og agentforbrug rapporteres ved siden af, ikke som erstatning for ejertid.

**Kvalitet:** alle gældende gates består; observerede regressioner og genarbejde sammenlignes med baseline. Notér regressionsstatus syv dage efter hver levering; tidligere status er foreløbig. Ingen stiltiende baggrundsovervågning oprettes. Opfølgningen ligger på #605 og læses ved næste relevant session, medmindre ejeren særskilt bestiller en planlagt kørsel.

Sekventiel/parallel sammenligning er observation af egnede rigtige opgaver, ikke genkørsel af løste issues. Vis forskelle i scope og samtidighed; fem opgaver er et indledende signal, ikke bevis for årsag eller statistisk sikkerhed. Hvis sammenligningen mangler, sig det.

Efter fem forløb samler hovedsessionen: behold/justér/tilbagefør, målinger, ukendte forhold og konkrete friktionspunkter. Ved forringet kvalitet standses udbredelsen; tilbagefør den konkrete regelændring via normal PR-proces. Ingen automatisk standardisering, modelskift eller udvidet mandat.

## Verifikation

Oprindelig docs-leverance (29/9): diff- og linkkontrol, `preflight-pr.ps1`, token-hygiejne og uafhængigt review. Runner-udvidelsen (7/10): desuden `node --test scripts/codex-wave.test.mjs scripts/wave-policy.test.mjs` og CLI-dry-run for modelvalg/kapacitet uden dispatch. Scenarier: eksisterende planer bevarer modelarv; reviewer kan vælges separat; ugyldig kapacitet afvises før admission; ingen model gættes ved manglende override. Arbejdsformen efterprøves på reelle pilotopgaver; en tekstkontrol beviser kun kontrakten.

Patch notes og FEATURE_REGISTRY ændres ikke: ingen spilleradfærd, feature eller flag ændres. Runneren udvides; ingen ny CI-guard eller scheduler indgår.
