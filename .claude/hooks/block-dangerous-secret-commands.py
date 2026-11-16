# Regelsaettet for PreToolUse-vagten block-dangerous-secret-commands.sh (#634, #8240).
#
# Koeres af .sh-wrapperen med en runtime-verificeret Python (>= 3.8) og faar hele
# PreToolUse-payloaden paa stdin. ALLE tre lag koerer her i EEN proces:
#   1. Hemmeligheds-literaler i tool_input for ALLE vaerktoejer (fx Agent-prompt,
#      MCP-argumenter, Write/Edit-indhold).
#   2. Read/Grep mod hemmeligheds-filer (.env, .mcp.json, secrets/, test-token).
#   3. Bash/PowerShell-kommandoer der dumper hemmeligheder (railway variables ...).
#
# Hvorfor i een proces (#8240): den gamle wrapper startede op til tre Pythons og
# et par dusin grep-pipelines pr. tool-kald. Paa Windows koster hver proces
# hundredvis af ms under last, saa hooken ramte sin timeout - og en timeout er
# ingen beskyttelse. Moenstrene er de samme som foer (oversat 1:1 fra grep -E);
# kommandomoenstrene matches linje for linje ligesom grep.
#
# Exit-kontrakt med wrapperen (bevidst usaedvanlige koder, saa en stub eller et
# nedbrud aldrig kan ligne en godkendelse):
#   10 = tilladt, 12 = blokeret (beskeden er allerede skrevet til stderr),
#   alt andet = scanneren fejlede -> wrapperen blokerer (fail closed).

import sys

ALLOW = 10
BLOCK = 12

if sys.version_info < (3, 8):
    sys.exit(9)

import json  # noqa: E402
import re  # noqa: E402


def err(text):
    sys.stderr.buffer.write(text.encode("utf-8"))
    sys.stderr.buffer.flush()


# --- Lag 1: hemmeligheds-literaler i tool_input (alle vaerktoejer) -----------
# HIGH-VALUE patterns kun (mindre risiko for false positive end det fulde
# sanitize-secrets-saet).
LITERAL_PATTERNS = [
    ("supabase-secret", re.compile(r"sb_secret_[A-Za-z0-9_-]{30,}")),
    ("jwt-supabase-legacy", re.compile(r"eyJh[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}")),
    ("sentry-dsn", re.compile(r"https://[a-f0-9]{32}@[a-z0-9.\-]+\.ingest(?:\.[a-z]{2})?\.sentry\.io/[0-9]+")),
    ("discord-bot-token", re.compile(r"\b[MN][A-Za-z0-9_-]{23,28}\.[A-Za-z0-9_-]{6,7}\.[A-Za-z0-9_-]{27,38}\b")),
    ("github-pat", re.compile(r"\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b")),
    ("aws-access-key", re.compile(r"\bAKIA[0-9A-Z]{16}\b")),
    ("anthropic-key", re.compile(r"\bsk-ant-[A-Za-z0-9_-]{90,}\b")),
    ("stripe-key", re.compile(r"\b(?:sk|pk|rk)_(?:test|live)_[A-Za-z0-9]{24,}\b")),
]

LITERAL_MSG = """\U0001F534 BLOCKED by block-dangerous-secret-commands.sh

Tool call input indeholder secret-pattern(s): {types}

Hvad skete der: agent forsøgte at sende et tool-call med en literal secret i
input (fx spawn_task prompt, MCP-arg, agent-besked). Selv hvis Bash-output
sanitizer ville fange et sådan secret AFTER det printes, blokerer vi nu FØR
det forwardes til et andet system (spawned session, MCP-server, etc.).

Hvad gør du nu:
1. STOP. Genkald værdien fra hukommelsen — det skal IKKE være i prompts.
2. Reference værdien indirekte (fx "line 147 i setup-sentry-frontend.ps1
   indeholder den hardcoded DSN" — uden at quote det).
3. Hvis du SKAL inkludere et secret i et tool-input, så er flowet at
   brugeren tilføjer det manuelt i en separat besked til den spawned agent.

Refs: #634 (denne hook).
"""


def collect_strings(obj, out):
    if isinstance(obj, str):
        out.append(obj)
    elif isinstance(obj, dict):
        for v in obj.values():
            collect_strings(v, out)
    elif isinstance(obj, list):
        for v in obj:
            collect_strings(v, out)


def literal_scan(tool_input):
    strings = []
    collect_strings(tool_input, strings)
    joined = "\n".join(strings)
    return sorted({name for name, pat in LITERAL_PATTERNS if pat.search(joined)})


# --- Lag 2 (Lag A i #634): Read/Grep mod hemmeligheds-fil-stier ---------------
# Read/Grep tool_response indeholder filindhold; for secret-filer = leak til
# transcript. Lag 1 fanger det IKKE (tool_input er kun en sti). Blokken er
# proaktiv + indholds-uafhaengig. Vektoren bed 2026-05-29 (.mcp.json).
PATH_WHITELIST = re.compile(r"\.(example|sample|template)$", re.IGNORECASE)

PATH_MSG = """\U0001F534 BLOCKED by block-dangerous-secret-commands.sh

Read/Grep mod secret-fil: {path}

Filen indeholder secrets i klartekst. Tool-output ville dumpe dem til
transcript (vektoren der bed 2026-05-29 paa .mcp.json). Selv gitignored filer
laekker denne vej.

Hvad goer du nu:
1. Behoever du kun KEY-NAVNE (ikke values)?
     grep -oE '^[A-Z_][A-Z0-9_]*' backend/.env     # via Bash — kun keys
2. Behoever du strukturen i .mcp.json? Laes docs/DISCORD_MCP_SETUP.md (har
   redacted eksempel) i stedet for selve filen.
3. Skal du se en value? Aaben filen i en editor UDENFOR Claude Code.

Catalog: docs/SECRET_LEAK_VECTORS.md tabel B.

Refs: #634.
"""


def is_secret_path(p):
    pl = p.replace("\\", "/")
    base = pl.rsplit("/", 1)[-1]
    if PATH_WHITELIST.search(base):
        return False
    if base == ".mcp.json":
        return True
    if re.match(r"^\.env(\..+)?$", base):
        return True
    if "/secrets/" in pl.lower():
        return True
    # #3342: get-test-token.mjs' sikre default skriver JWT-payload til
    # .codex.local/test-token*.json - lige saa secret som en direkte Read af .env.
    pl_lower = pl.lower()
    if (pl_lower.startswith(".codex.local/") or "/.codex.local/" in pl_lower) and \
       base.lower().startswith("test-token"):
        return True
    return False


def secret_path(tool_name, tool_input):
    if tool_name not in ("Read", "Grep"):
        return None
    paths = []
    if tool_name == "Read":
        p = tool_input.get("file_path")
        if p:
            paths.append(str(p))
    else:
        # Grep uden 'path' = cwd-bred soegning; kan ikke pinnes til een fil ->
        # overlades til PostToolUse-sanitizer (lag B). Kun eksplicit fil/sti her.
        p = tool_input.get("path")
        if p:
            paths.append(str(p))
    for p in paths:
        if is_secret_path(p):
            return p
    return None


# --- Lag 3: Bash/PowerShell-kommandoer der dumper hemmeligheder ---------------
COMMAND_MSG = """\U0001F534 BLOCKED by block-dangerous-secret-commands.sh

Command matches known leak-pattern: {name}

Det blokerede command ville sandsynligvis printe secret-values til transcript.
Tidligere incidents: #296 (setup.py JWT in commit), #620 (railway variables --json).

Safe alternative:
{safe}

Catalog: docs/SECRET_LEAK_VECTORS.md (alle kendte vektorer + wrappers).
Override: hvis du SKAL køre raw command (fx for rotation), kør det fra en
terminal UDENFOR Claude Code så transcript ikke fanger output.

Refs: #634.
"""


def command_block(cmd):
    """Returnerer (navn, sikkert alternativ) for foerste ramte moenster, ellers None.

    Hvert moenster matches pr. linje paa den lowercasede kommando - samme
    semantik som den gamle `printf '%s' "$CMDLO" | grep -Eq` (grep er linjebaseret).
    """
    lines = cmd.lower().split("\n")

    def g(pattern):
        rx = re.compile(pattern)
        return any(rx.search(line) for line in lines)

    # --- Railway env-dumps ---
    # `railway variables` (med eller uden --json) printer alle values.
    # Tillader: `railway variables --json | jq 'keys'` og probe-railway-keys.*.
    if g(r"(^|[^a-z])railway\s+variables"):
        if not (g(r"jq\s+'keys'") or g(r'jq\s+"keys"') or g(r"probe-railway-keys")):
            return ("railway variables (uden jq 'keys' filter)",
                    "  pwsh -File scripts/probe-railway-keys.ps1   # Windows\n"
                    "  bash scripts/probe-railway-keys.sh           # Linux/Mac\n"
                    "  # Eller manual: railway variables --json | jq 'keys'")

    # --- Vercel env-dumps ---
    # `vercel env ls --format json` printer values. `vercel env pull` skriver
    # values til disk. `vercel env decrypt` printer values direkte.
    if g(r"vercel\s+env\s+ls.*--format\s+json"):
        if not (g(r"jq\s+'\[") or g(r"probe-vercel-keys")):
            return ("vercel env ls --format json (uden jq filter)",
                    "  pwsh -File scripts/probe-vercel-keys.ps1\n"
                    "  bash scripts/probe-vercel-keys.sh\n"
                    "  # Eller manual: vercel env ls production --format json | jq '[.[] | .key]'")

    if g(r"vercel\s+env\s+pull"):
        return ("vercel env pull (skriver values til disk)",
                "  # IKKE behov i agent-flow. Hvis du SKAL pull values lokalt for debug:\n"
                "  #   kør fra terminal UDENFOR Claude Code, og slet filen bagefter.")

    if g(r"vercel\s+env\s+decrypt"):
        return ("vercel env decrypt (printer values)",
                "  Brug probe-vercel-keys.ps1 til at se key-navne.")

    # --- Infisical secrets-dump (ALLE former printer values) ---
    # Blokeres KATEGORISK - ingen allow-pipe-undtagelse (en snaever undtagelse
    # laekkede 2026-05-30). Kun `infisical run -- <cmd>` er safe.
    if g(r"(^|[^a-z])infisical\s+(secrets|export)(\s|$)"):
        return ("infisical secrets/export (printer secret-values til transcript)",
                "  # Tjek om en key er sat (uden at printe value):\n"
                "  infisical run --env=dev -- node backend/scripts/verify-infisical-injection.js\n"
                "  # Brug værdier via runtime-injection: infisical run --env=dev -- <cmd>\n"
                "  # Se key-navne i Infisical-dashboardet. ALDRIG 'infisical secrets'/'--plain'/'export' i agent-session.")

    # --- get-test-token.mjs --print (#3342) ---
    # --print genindfoerer raw access_token paa stdout = transcript. Kategorisk.
    if g(r"get-test-token\.mjs") and g(r"(^|\s)--print([\s=]|$)"):
        return ("get-test-token.mjs --print (printer Supabase JWT til stdout = transcript)",
                "  # Sikker default (skriver til gitignored fil, printer kun stien):\n"
                "  node scripts/get-test-token.mjs --email=<email>\n"
                "  # Brug filens STI i næste kommando — læs/print ALDRIG selve indholdet.\n"
                "  # --print er KUN til manuel terminalbrug UDENFOR Claude Code.")

    # --- Fil-laesere mod .env-filer (#3342, udvidet 2026-08-06) ---
    # Desuden deterministisk backup i .claude/settings.json permissions.deny.
    if g(r"(^|\s)(cat|head|tail|less|more|nl|tac|strings|od|xxd)\s+[^|;&]*\.env") or \
       g(r"(^|\s)(sed|awk)\s+[^|;&]*\.env"):
        return ("fil-læser mod .env (direkte secret-file læsning)",
                "  # Kun key-navne:\n"
                "  grep -oE '^[A-Z_][A-Z0-9_]+' backend/.env\n"
                "  # Eller åben fil i editor manuelt (uden agent).")

    if g(r"(^|\s)(cat|type)\s+([^|;&]+/)?test-token\S*\.json") or \
       g(r"get-content\s+([^|;&]+/)?test-token\S*\.json") or \
       g(r"(^|\s)gc\s+([^|;&]+/)?test-token\S*\.json"):
        return ("cat/Get-Content på get-test-token.mjs-output (printer JWT til stdout)",
                "  # Filen ER outputtet fra get-test-token.mjs — samme leak som --print.\n"
                "  # Brug filens STI i næste kommando i stedet for at printe indholdet\n"
                "  # (fx lad en anden proces læse filen selv, uden at ekko'e værdien).")

    if g(r"get-content\s+([^|;&]+/)?\.env") or g(r"(^|\s)gc\s+([^|;&]+/)?\.env"):
        return ("Get-Content .env",
                "  Select-String -Path backend/.env -Pattern '^[A-Z_]+=' | ForEach-Object { ($_ -split '=')[0] }")

    # --- env / printenv unfiltered ---
    # `env | awk '{print $1}'` er safe; vi blokerer kun helt-ufiltreret.
    if g(r"(^|\s;|\|\||&&)(env|printenv)(\s*$|\s*[;|&])"):
        return ("env / printenv (unfiltered — dumper alle env-vars)",
                "  env | awk -F= '{print $1}' | sort   # kun key-navne\n"
                "  # Eller: env | grep -E '^(SUPABASE|RAILWAY)_'   # filter på prefix")

    # --- PowerShell env-listing unfiltered ---
    if g(r"get-childitem\s+env:\s*$") or g(r"(^|\s)(gci|ls|dir)\s+env:\s*$"):
        return ("Get-ChildItem env: (printer alle env-vars incl. values)",
                "  Get-ChildItem env: | Select-Object -ExpandProperty Name | Sort-Object")

    # --- Git show/log paa .env-filer ---
    if g(r"git\s+show\s+[^|]*\.env"):
        return ("git show <ref>:.env (læser historisk secret hvis nogensinde committed)",
                "  Hvis .env i historie: brug `git log --diff-filter=D --name-only -- .env` (kun stier)\n"
                "  Hvis du skal vurdere om secret er compromised: tjek GitHub secret-scanning.")

    if g(r"git\s+log\s+-p\s+[^|]*\.env"):
        return ("git log -p .env (printer historiske values)",
                "  git log --oneline -- backend/.env   # kun commit-summaries")

    # --- Vercel inspect (kan inkludere build-time env) ---
    # Tilladt kun hvis output filtreres (jq eller > /dev/null).
    if g(r"vercel\s+inspect\s+"):
        if not (g(r"jq") or g(r"> ?/dev/null")):
            return ("vercel inspect (kan inkludere build-time env)",
                    "  vercel inspect <url> 2>&1 | jq '{name, status, url, createdAt}'   # kun metadata")

    # --- Dotenv debug-print ---
    if g(r"console\.log\([^)]*process\.env[^)]*\)"):
        return ("console.log(process.env) (printer alle env-vars med values)",
                "  console.log(Object.keys(process.env).sort())   # kun key-navne")

    return None


def main():
    text = sys.stdin.buffer.read().decode("utf-8")
    d = json.loads(text)
    if not isinstance(d, dict):
        raise ValueError("payload is not an object")
    tool_name = str(d.get("tool_name", "") or "")
    tool_input = d.get("tool_input", {})
    if tool_input is None:
        tool_input = {}

    found = literal_scan(tool_input)
    if found:
        err(LITERAL_MSG.format(types=",".join(found)))
        return BLOCK

    if not isinstance(tool_input, dict):
        if tool_name in ("Read", "Grep", "Bash", "PowerShell"):
            raise ValueError("tool_input is not an object")
        return ALLOW

    hit = secret_path(tool_name, tool_input)
    if hit:
        err(PATH_MSG.format(path=hit))
        return BLOCK

    if tool_name not in ("Bash", "PowerShell"):
        return ALLOW

    cmd = tool_input.get("command", "")
    cmd = "" if cmd is None else str(cmd)
    # Samme loft som den gamle wrapper (${CMD:0:8000}); kommandoer er korte.
    cmd = cmd[:8000].rstrip("\n")
    if not cmd:
        return ALLOW

    hit = command_block(cmd)
    if hit:
        err(COMMAND_MSG.format(name=hit[0], safe=hit[1]))
        return BLOCK
    return ALLOW


if __name__ == "__main__":
    try:
        code = main()
    except BaseException:  # noqa: BLE001 - fail closed uden at ekko input
        code = 3
    sys.exit(code)
