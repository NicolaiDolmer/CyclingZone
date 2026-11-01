# Pause af loeb: besked uden deploy (#6970, #7335)

Naar loebene pauses (ikke flyttes), kommer beskeden **af sig selv** (#7335). Spillerne ser en blaa bjaelke oeverst paa alle manager-sider ("Races are paused. I will announce the new start time here."), dashboardet viser sin egen Pauset-flade og skjuler de gamle starttider.

## Hvad udloeser pausen
- **Automatisk:** `app_config.stage_scheduler_enabled` er eksplicit `off` (eller `false`), og den aktive saeson har mindst et loeb, der ikke er afsluttet. Det er den kontakt loebene pauses med (28/10 blev den slaaet fra og til med SQL). Fravaer, ukendt vaerdi og `beta` giver ingen besked.
- **Valgfri ny starttid:** saet ogsaa `race_pause_notice`, kun for at vise hvornaar loebene starter igen.
  - Vaerdi (JSON): `{"paused": true, "new_start": "2026-10-23T14:00:00Z"}`. `new_start` er valgfri (ISO, UTC).
  - En notice med `paused: true` viser beskeden, selv om kontakten er taendt.

## Hvornaar forsvinder den
- Kontakten taendes igen (`on`) og der ingen aktiv notice er.
- En notice udloeber af sig selv, naar `new_start` er naaet. Er kontakten stadig slukket, staar beskeden videre uden tid.
- Fjern noticen: slet raekken eller saet `paused` til `false`.

## Saesonskifte
Mens saesonskiftets eget banner staar (`ops_notices` med engelsk titel der starter med "Season change"), vises ingen pause-besked (samme besked maa ikke staa to gange). Dashboardet skjuler stadig de gamle starttider, hvis loebene samtidig er pauset.

## Drift
- Laesning sker direkte fra Supabase som indlogget spiller (RLS: `app_config` og `ops_notices` laesbare for authenticated, `seasons` og `races` laesbare).
- Bjaelken henter igen ved hver sidenavigation; en aaben fane uden navigation ser aendringen foerst ved naeste sideskift eller reload.
- Pausen gaelder alle loeb (ingen per-loeb-styring).
