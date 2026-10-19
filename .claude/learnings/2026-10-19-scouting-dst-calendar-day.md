# 2026-10-19: scoutingens kalenderdato over DST (#6862)

- Trigger: kl. 00:30 Copenhagen 25/10/2026, mission klar 26/10 kl. 08.
- Rodårsag: missionReadyLabel fandt næste dag via now + 24 timer. Efterårsdøgnet er 25 timer; ved forårsskiftet kan beregningen om aftenen springe en dato over.
- Rettelse: genbrug relativeDayKey fra stageScheduleConfig. Den tæller kalenderdatoer i Europe/Copenhagen. Deadline, klokkeslæt, reel nedtælling og eksisterende oversættelser er uændrede.
- Kontrakt: missionReadyLabel lover næste danske kalenderdag i sin eksisterende dokumentation; relativeDayKey har samme kontrakt og DST-rettelsen fra #5302. Ingen ny spilregel eller SSOT-ændring.
- Design-go: ejerens A: Godkendt til build i Codex 19/10, registreret på https://github.com/NicolaiDolmer/CyclingZone/issues/6862#issuecomment-6260927897.
- Bevis: 11 nye faste unit-cases; tre fejlede mod gammel kode, alle består efter rettelsen. Eksisterende scouting-/etapetests bevares. Browserregression dækker begge overgange på de tre projekter med syntetiske fixtures.
- Læring: anvend kalenderaritmetik til relative datoetiketter og epoch-differencer til varigheder. Genbrug den eksisterende delte helper.
- Afgrænsning: #6858-filer, sæsonafslutning, backend, prod-data og migrationer er urørte.
- Patch notes: spillerrettelse; Claude skal forfatte noten før release efter AGENTS regel 5. Codex ændrer ikke spillertekst. Ingen ny feature eller flagændring; FEATURE_REGISTRY er uændret.