# #5296: gentagne kandidat-observationer gav falsk nul-send-alarm

Ejerens Resend-evidens 16/9 viste leverede welcome-mails. Rapporten læste kun
candidates/sent fra email_sweep_runs, selv om sweepen også registrerer
skipped/failed. Welcome observerer samme hold hvert femte minut i 48 timer,
før dedupe og prefs. En gammel, leveret mail kunne derfor give kandidater i
begge rullende 24-timersvinduer uden nye afsendelser og udløse en falsk alarm.

Rettelse: rapportens on-kørsler tæller observationer og alle udfald særskilt.
Nul-send-alarmen kræver candidates > skipped i begge vinduer. Exceptions og
uforklarede udfald udløser stadig alarmen. Dry-run må hverken tælle som en
afsendelse eller skabe en alarm om manglende rigtige afsendelser.

Verifikation: regressionen udløste præcis den gamle alarm før rettelsen;
rapporttests er grønne efter. Dækker også reelle fejl, dry-run og grænser ved
dansk sommer-/vintertid. Ingen afsendelseskode eller prod-data ændret.

Læring: et antal før gates er ikke antallet der skal sendes til. Bevar rå
observationer, vis udfaldene og dokumentér hvad et skip faktisk kan betyde.
SSOT: docs/EMAIL_STACK.md §5.2. Afventer ejer-merge; ikke leveret til prod.
