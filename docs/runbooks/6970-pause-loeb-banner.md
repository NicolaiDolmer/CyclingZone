# Pause af loeb: banner uden deploy (#6970)

Naar loebene pauses (ikke flyttes), saettes en raekke i `app_config`. Loebsdetaljen og dashboardet viser da "Paused" + ny start, og dashboardet skjuler de gamle starttider.

- Noegle: `race_pause_notice`
- Vaerdi (JSON): `{"paused": true, "new_start": "2026-10-23T14:00:00Z"}`. `new_start` er valgfri (ISO, UTC). Uden den staar der "New start time will be announced."
- Saet: upsert raekken (admin eller service-role). Fjern: slet raekken eller saet `paused` til `false`.
- Pausen udloeber af sig selv, naar `new_start` er naaet. Er `new_start` ikke kendt, skal raekken fjernes manuelt naar loebene koerer igen.
- Banneret haenter raekken ved sideindlaesning; en aaben fane ser aendringen foerst efter reload.
- Pausen gaelder alle loeb (ingen per-loeb-styring).
