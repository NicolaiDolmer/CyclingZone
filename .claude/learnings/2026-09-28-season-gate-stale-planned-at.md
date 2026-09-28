# 2026-09-28 · Sæsonskifte-gaten spærrede alle nye auktioner efter skiftet (#5846)

**Symptom:** efter S3→S4 (27/9 22:36-22:46) kunne ingen starte auktioner. Fejlkode
`auction_end_crosses_season_transition`; spillerne gættede på "vent til kl. 8".

**Rodårsag:** `app_config.season_transition_planned_at` stod stadig på skiftets tidspunkt
(2026-09-27T17:30Z). `getAuctionSeasonBoundaryIssue` afviser enhver sluttid på/efter grænsen
og tjekkede aldrig, om grænsen allerede var passeret. Nøglen overskrives først, når næste
sæsons kalender bygges (`ensureSeasonTransitionPlannedAt`), så gaten var permanent lukket.

**Fix:** `fetchSeasonTransitionBoundary` beslutter nu grænsen ud fra skiftets tilstand
(`resolveActiveSeasonTransitionBoundary`): fremtid = gælder; kørende skifte (fase-loggens
`started`/`failed` nyere end seneste `completed`) = spær alt; `completed`-anker = grænsen er
brugt op; passeret uden anker = gælder højst 12 t (grace), så en mistet log aldrig kan lukke
markedet igen.

**Læring:** en tidsgrænse der ligger i konfiguration, skal have en "brugt op"-regel i
læseren, ikke kun en oprydning i skriveren. Test altid en gate i tre tilstande: før, under
og efter den begivenhed den beskytter.
