# Working agent-hook (#3712): tre bugs efter "empirisk verificeret" test-suite, ingen i selve gate-mekanismen

**Dato:** 2026-08-18 · **Kontekst:** Recovery-opgave #3712, videreført ucommitted arbejde fra en tidligere session.

## Fund

En tidligere session havde bygget `scripts/hooks/lib/active_sessions_engine.py` +
`set-active-sessions.sh`/`clear-active-sessions.sh` + en 15-test suite, alt sammen ucommitted
og **ikke wiret ind i `.claude/settings.json`**. Koden så solid ud (god design-dokumentation i
docstrings), men `bash scripts/hooks/__tests__/test-active-sessions-engine.sh` fejlede 6-7/15
ved første kørsel, og hang i op til 60s når output blev pipet.

## Symptom 1: kernefunktionen virkede aldrig mod den ægte fil

`FIELD_LINE_RE = re.compile(r"...:\*\*[^\r\n]*$", re.MULTILINE)` — det afsluttende `$` matcher
kun lige før et bart `\n`. `docs/NOW.md` er 100% CRLF. `[^\r\n]*` kan ikke konsumere `\r`, så
regex'en kan aldrig komme frem til `$`'s krævede position — matchen fejler for HVER linje i en
CRLF-fil. Feltet ville ALDRIG være blevet skrevet mod det ægte NOW.md, selvom advarslen
(warning-emission) virker uafhængigt af dette. Fix: fjern `$` (`[^\r\n]*` er allerede en
tilstrækkelig grænse, uafhængig af linjeskift-stil).

**Lektie:** en regex der "ser rigtig ud" og består unit-tests skrevet med samme antagelse
(LF eller manuelt matchende CRLF-håndtering) skal stadig køres mod den ÆGTE fil før den regnes
for færdig. `git status`/`file`-tjek af linjeendelser er billigt, en falsk-grøn test er dyrt.

## Symptom 2: test-suitens egen PID-simulering var i sig selv defekt

`write_session()` skrev `"cwd":"$cwd"` direkte ind i JSON uden at escape'e backslashes. Alle
kaldere sendte Windows-stier (`C:\Dev\...`, ÉN backslash efter bash'ens egen unescaping) — det
producerer ugyldig JSON (`\D`, `\C` er ikke lovlige JSON-escapes). `read_registry()`s bevidst
brede `except: continue` synkede fejlen tavst, så "den anden session" i testene reelt aldrig
eksisterede for motoren. Tests der forventede en advarsel fejlede korrekt; tests der forventede
FRAVÆR af advarsel bestod — men af den forkerte grund.

**Lektie:** en test der består, fordi begge sider af en sammenligning er tomme, beviser
ingenting. Tjek at et positivt testtilfælde (skal-udløse) rent faktisk producerer non-triviel
data undervejs, ikke kun det endelige assert.

## Symptom 3: pipe-hang pga. inherited stdout på en baggrundsproces

`pwsh -NoProfile -Command "Start-Sleep -Seconds 60" &` uden fd-redirect arver testens egen
stdout/stderr. Når testens output selv pipes (`| tail`, `$(...)`) blokerer pipe-læseren indtil
ALLE writers lukker deres ende — inklusive den 60s baggrundsproces, længe efter testene reelt er
færdige. `>/dev/null 2>&1` på selve spawnet + eksplicit `taskkill /F /PID` (ikke kun bash-niveau
`kill`, som ikke pålideligt terminerer en ægte Win32-proces under MSYS) i cleanup-trap'en fjerner
begge dele.

## Samlet regel

"Empirisk verificeret mens testen blev skrevet" er ikke det samme som "verificeret mod den
ægte fil, i den miljøkontekst hvor testen faktisk vil køre (piped output, CRLF, MSYS-Win32
process-grænser)". Ingen af de tre fund var i selve gate-logikkens design — designet
(decoupled warning vs. best-effort skriv, curated-prose-beskyttelse) var solidt og krævede
ingen ændring. Alle tre var i eksekveringslaget mellem design og virkelighed.

Refs: #3712, #559, #558.
