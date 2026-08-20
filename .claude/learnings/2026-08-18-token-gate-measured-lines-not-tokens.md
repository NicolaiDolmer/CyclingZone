# Postmortem · 2026-08-18 · Token-gaten haandhaevede linjer, ikke tokens

## Hvad skete der?
`docs/NOW.md` og `docs/MASTERPLAN.md` var hhv. 51% og 72% over deres egne
token-budgetter fra CLAUDE.md close-out (NOW.md: ~1.200 tok primaer;
MASTERPLAN.md: <=1.500 tok), men `scripts/check-agent-token-hygiene.ps1`
bestod groent for begge. Ingen gate stoppede driften.

## Root cause
- NOW.md: scriptet HAVDE et token-baseret tjek, men Warn/Fail var hoevet til
  2000/3000 (langt over det oplyste ~1.200-budget) for at undgaa cry-wolf paa
  en linje-compliant fil (kommentar refererede sundhedsaudit 2026-06-02). Den
  reelt haandhaevede graense var i stedet det separate linje-tjek
  `now-md-budget` (warn 30/fail 40 linjer) - og en fil kan sagtens vaere under
  30 linjer og alligevel langt over 1.200 tokens, hvis linjerne er lange.
- MASTERPLAN.md havde slet intet tjek, hverken paa linjer eller tokens.

## Fix
`scripts/check-agent-token-hygiene.ps1`:
- NOW.md-token-tjekket i `$contextFiles` sat tilbage til Warn=1000/Fail=1200
  (matcher CLAUDE.md's eksplicitte tal). Linje-tjekket forbliver sekundaert,
  uaendret.
- Tilfoejet et nyt token-tjek for MASTERPLAN.md (Warn=1300/Fail=1500). Den er
  markeret `ExcludeFromColdStart`, fordi den ikke er auto-loaded ved
  session-start (kun NOW.md/CLAUDE.md/GUARDRAILS_CORE.md er), saa den skal
  ikke tselle med i cold-start-aggregatet.
- Dokumenteret chars/4-approksimationen i en kommentar ved `Get-ApproxTokens`.

## Forhindret-fremover
Gaten fejler nu faktisk (`exit 1`) naar en fil er over sit tokenbudget,
verificeret lokalt mod de reelle (stadig over-budget) filer. Selve
trimningen af NOW.md/MASTERPLAN.md er bevidst IKKE en del af denne fix -
MASTERPLAN.md's raekkefoelge er ejer-godkendt punkt for punkt, og NOW.md
baerer ofte live-koordinering mellem samtidige sessioner. Det kraever en
session uden parallelle skrivere og (for MASTERPLAN) ejer-input, jf. #3753.

## Læring
En "budget"-kommentar der hoejner en tarskel for at undgaa cry-wolf, uden at
fjerne eller nedjustere den saerskilte metrik den egentlig skulle beskytte
imod (her: linjer vs. tokens), efterlader gaten med kun én reelt haandhaevet
maalestok - og den kan vaere den forkerte. Naar to metrics maaler det samme
budget, skal begge tjekkes mod deres egen erklaerede graense, ikke mod en
"for at undgaa falske positiver"-udvidet version af den ene.
