# Launch-kohorten: hvor stopper de i de foerste 7 dage? (#4964)

Status: WIP - undersoegelse i gang (14/9 2026). Dokumentet opdateres i samme PR.

Spoergsmaal: launch-ugens tilmeldte (24-30/8) holdt 28,6 % i uge 2 mod 86,8 % for etablerede spillere. Hvor i de foerste 7 dage stopper de?

Metode: trin-tragt pr. kohorte bygget paa `player_events` + `users.created_at` + `teams`, read-only SELECT via Supabase MCP. Alle tal anonymiserede.

Kohorter:
- (a) foer 1/8 - etablerede
- (b) 1-23/8 - pre-launch
- (c) 24-30/8 - launch-ugen
- (d) 31/8-13/9 - efter launch

(Tragt-tabel, stoerste frafaldstrin og anbefaling foelger.)
